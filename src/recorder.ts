import { WORKER_SCRIPT } from './worker';

export interface RecorderOpts {
    width?: number;
    height?: number;
    fps?: number;
    videoBitrate?: number;
    videoCodec?: string;
    audioBitrate?: number;
    audioSampleRate?: number;
    audioChannels?: number;
    mp4?: boolean;
    onError?: (err: Error) => void;
    onProgress?: (durationSec: number) => void;
}

const FLUSH_TIMEOUT_MS = 10_000;

export class MediaStreamRecorder {
    private _stream: MediaStream | null = null;
    private _worker: Worker | null = null;
    private _workerBlobUrl: string | null = null;
    private _vReader: ReadableStreamDefaultReader<VideoFrame> | null = null;
    private _aReader: ReadableStreamDefaultReader<AudioData> | null = null;
    private _running = false;
    private _paused = false;
    private _startTs = 0;
    private _pauseTs = 0;
    private _pauseAcc = 0;
    private _opts: Required<RecorderOpts>;
    private _resolveFlush: ((v: ArrayBuffer | ArrayBuffer[]) => void) | null = null;
    private _rejectFlush: ((e: Error) => void) | null = null;

    constructor(opts?: RecorderOpts) {
        this._opts = {
            width: opts?.width ?? 1280,
            height: opts?.height ?? 720,
            fps: opts?.fps ?? 30,
            videoBitrate: opts?.videoBitrate ?? 4_000_000,
            videoCodec: opts?.videoCodec ?? 'vp8',
            audioBitrate: opts?.audioBitrate ?? 128_000,
            audioSampleRate: opts?.audioSampleRate ?? 48000,
            audioChannels: opts?.audioChannels ?? 2,
            mp4: opts?.mp4 ?? true,
            onError: opts?.onError ?? (() => { }),
            onProgress: opts?.onProgress ?? (() => { })
        };
    }

    public async start(stream: MediaStream): Promise<void> {
        this._stream = stream;
        this._running = true; this._paused = false;
        this._pauseAcc = 0; this._startTs = -1;

        const hasVideo = stream.getVideoTracks().length > 0;
        const hasAudio = stream.getAudioTracks().length > 0;

        const blob = new Blob([WORKER_SCRIPT], { type: 'text/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        this._worker = new Worker(workerUrl);

        this._workerBlobUrl = workerUrl;
        this._worker.onmessage = (e) => {
            if (e.data.type === 'done') this._resolveFlush?.(e.data.buffer);
            if (e.data.type === 'error') {
                const err = new Error(e.data.error);
                this._rejectFlush?.(err);
                this._opts.onError(err);
            }
        };
        this._worker.onerror = (e) => {
            const err = new Error(`Worker error: ${e.message}`);
            this._rejectFlush?.(err);
            this._opts.onError(err);
        };

        const o = this._opts;
        this._worker.postMessage({
            type: 'init',
            payload: {
                mp4Container: o.mp4,
                video: hasVideo ? { width: o.width, height: o.height, framerate: o.fps, bitrate: o.videoBitrate, codec: o.videoCodec } : undefined,
                audio: hasAudio ? { sampleRate: o.audioSampleRate, numberOfChannels: o.audioChannels, bitrate: o.audioBitrate } : undefined
            }
        });

        if (hasVideo) this._pumpVideo(stream);
        if (hasAudio) this._pumpAudio(stream);
    }

    private async _pumpVideo(stream: MediaStream): Promise<void> {
        try {
            const track = stream.getVideoTracks()[0];
            if (!MediaStreamTrackProcessor) throw new Error('[Recorder] MediaStreamTrackProcessor not available');
            const processor = new MediaStreamTrackProcessor({ track });
            this._vReader = processor.readable.getReader();
            let frameIdx = 0;
            while (this._running) {
                const { value: frame, done } = await this._vReader.read();
                if (done || !frame) break;
                if (this._paused) { frame.close(); continue; }
                if (this._startTs < 0) this._startTs = frame.timestamp;
                const ts = frame.timestamp - this._startTs - this._pauseAcc;
                this._opts.onProgress(ts / 1_000_000);
                if (!this._worker) { frame.close(); break; }
                this._worker.postMessage({
                    type: 'encode-video',
                    payload: { frame, keyFrame: frameIdx % 60 === 0 }
                }, [frame] as Transferable[]);
                frameIdx++;
            }
        } catch (e: unknown) { this._opts.onError(e instanceof Error ? e : new Error(String(e))); }
    }

    private async _pumpAudio(stream: MediaStream): Promise<void> {
        try {
            const track = stream.getAudioTracks()[0];
            if (!MediaStreamTrackProcessor) throw new Error('[Recorder] MediaStreamTrackProcessor not available');
            const processor = new MediaStreamTrackProcessor({ track });
            this._aReader = processor.readable.getReader();
            while (this._running) {
                const { value: audioData, done } = await this._aReader.read();
                if (done || !audioData) break;
                if (this._paused) { audioData.close(); continue; }
                if (!this._worker) { audioData.close(); break; }
                this._worker.postMessage({
                    type: 'encode-audio',
                    payload: { audioData }
                }, [audioData] as Transferable[]);
            }
        } catch (e: unknown) { this._opts.onError(e instanceof Error ? e : new Error(String(e))); }
    }

    public pause(): void {
        if (!this._running || this._paused) return;
        this._paused = true;

        this._pauseTs = performance.now() * 1000;
    }

    public resume(): void {
        if (!this._running || !this._paused) return;
        this._pauseAcc += performance.now() * 1000 - this._pauseTs;
        this._paused = false;
    }

    public async stop(): Promise<Blob> {
        this._running = false;
        try { this._vReader?.cancel(); } catch {  }
        try { this._aReader?.cancel(); } catch {  }

        this._stream?.getTracks().forEach(t => t.stop());

        if (!this._worker) throw new Error('[Recorder] No active worker');

        let settled = false;
        const buffer = await new Promise<ArrayBuffer | ArrayBuffer[]>((resolve, reject) => {
            this._resolveFlush = (v) => { if (!settled) { settled = true; resolve(v); } };
            this._rejectFlush = (e) => { if (!settled) { settled = true; reject(e); } };
            this._worker!.postMessage({ type: 'flush' });
            setTimeout(() => {
                if (!settled) {
                    settled = true;
                    reject(new Error('[Recorder] Flush timed out after 10s — worker unresponsive'));
                }
            }, FLUSH_TIMEOUT_MS);
        }).finally(() => {
            if (this._workerBlobUrl) {
                URL.revokeObjectURL(this._workerBlobUrl);
                this._workerBlobUrl = null;
            }
            this._worker?.terminate();
            this._worker = null;
        });

        const parts = Array.isArray(buffer) ? buffer : [buffer];
        const mime = this._opts.mp4 ? 'video/mp4' : 'video/webm';
        return new Blob(parts, { type: mime });
    }

    public get isRecording(): boolean { return this._running && !this._paused; }
    public get isPaused(): boolean { return this._paused; }
}
