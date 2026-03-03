import { log, AegisError } from './core';
import { WORKER_SCRIPT } from './worker';
import type { AnimatedGifEncoder } from './encoders';

export interface VidConfig {
    video?: { codec: string; width: number; height: number; framerate?: number; bitrate?: number };
    audio?: { codec?: string; numberOfChannels?: number; sampleRate?: number } | null;
    isGif?: boolean;
    directToDisk?: boolean;
    mp4Container?: boolean;
    stream?: ReadableStream | string;
}

export class Vid {
    private _flushed: boolean;
    private _capacityReady: boolean;
    private _waitQueue: (() => void)[];
    private _config: VidConfig;
    private _workerUrl: string;
    private _worker!: Worker;
    private _onComplete?: (buf: ArrayBuffer) => void;
    private _onError?: (err: Error) => void;
    private _isGif: boolean;
    private _gifEncoder?: AnimatedGifEncoder;
    private _hasVideo: boolean;
    private _cleaned: boolean = false;

    constructor(config: VidConfig) {
        this._flushed = false;
        this._capacityReady = true;
        this._waitQueue = [];
        this._config = config;
        this._isGif = !!config.isGif;
        this._workerUrl = '';
        this._hasVideo = !!config.video;
        if (!this._isGif) {
            const b = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
            this._workerUrl = URL.createObjectURL(b);
            this._worker = new Worker(this._workerUrl);
        } else {
            this._worker = {} as Worker;
        }
    }

    public async init(): Promise<void> {
        const cfg = this._config;
        if (this._isGif) {
            const { AnimatedGifEncoder } = await import('./encoders');
            this._gifEncoder = new AnimatedGifEncoder(cfg.video!.width, cfg.video!.height, cfg.video?.framerate || 30);
            this._capacityReady = true;
            return;
        }

        if (cfg.video) {
            let vc = cfg.video.codec;
            const VideoEncoderClass = (globalThis as Record<string, unknown>).VideoEncoder as { isConfigSupported: (cfg: unknown) => Promise<{ supported: boolean }> } | undefined;
            if (!VideoEncoderClass) throw new AegisError('VideoEncoder API not available in this browser');
            const sup = await VideoEncoderClass.isConfigSupported(cfg.video);
            if (!sup.supported) {
                log.warn(`Codec ${vc} strict hardware reject. Falling back to software vp8.`);
                vc = 'vp8';
                cfg.video.codec = vc;
            }
        }

        this._worker.onmessage = (e) => {
            const { type } = e.data;
            if (type === 'done') {
                if (this._onComplete) this._onComplete(e.data.buffer);
                this._clean();
            } else if (type === 'error') {
                const err = new AegisError(`MuxFail:${e.data.error}`);
                log.error('WorkerErr', err);
                if (this._onError) this._onError(err);
                this._clean();
            } else if (type === 'queue-capacity') {
                this._capacityReady = e.data.active;
                if (this._capacityReady && this._waitQueue.length > 0) {
                    const r = this._waitQueue.shift();
                    if (r) r();
                }
            }
        };

        this._worker.onerror = (e) => {
            const err = new AegisError('FatalWorkerErr', e);
            if (this._onError) this._onError(err);
            this._clean();
        };

        const payload: Record<string, unknown> = {
            video: cfg.video,
            audio: cfg.audio ? {
                codec: 'opus',
                numberOfChannels: cfg.audio.numberOfChannels || 2,
                sampleRate: cfg.audio.sampleRate || 48000
            } : undefined,
            directToDisk: !!cfg.directToDisk,
            mp4Container: !!cfg.mp4Container
        };
        const transfers: Transferable[] = [];
        if (cfg.stream) {
            payload.stream = cfg.stream;
            transfers.push(cfg.stream as unknown as Transferable);
        }
        this._worker.postMessage({ type: 'init', payload }, transfers);
    }

    private async _waitCapacity(): Promise<void> {
        if (this._capacityReady) return;
        return new Promise(r => this._waitQueue.push(r));
    }

    public async pushVid(f: VideoFrame, k: boolean = false): Promise<void> {
        await this._waitCapacity();
        try {
            log.assert(f instanceof VideoFrame, 'NotVideoFrame');
            if (this._flushed) {
                throw new AegisError('VidFlushed');
            }

            if (this._isGif) {
                await this._gifEncoder?.addFrame(f, Math.round(1000 / (this._config.video?.framerate || 30)));
                f.close();
                return;
            }

            if (!this._worker || !this._hasVideo) return;

            this._worker.postMessage({ type: 'encode-video', payload: { frame: f, keyFrame: k } }, [f]);

        } catch (err: unknown) {
            try { f.close(); } catch (e) {  }
            throw err;
        }
    }

    public async pushAud(a: { timestamp: number; close: () => void }): Promise<void> {
        await this._waitCapacity();
        try {
            log.assert(typeof a === 'object' && a !== null && 'timestamp' in a, 'NotAudioData');
            if (this._flushed) {
                throw new AegisError('VidFlushed');
            }
            if (this._isGif) {
                return;
            }
            this._worker.postMessage({
                type: 'encode-audio',
                payload: { audioData: a }
            }, [a]);
        } catch (err: unknown) {
            try { a.close(); } catch (e) {  }
            throw err;
        }
    }

    public async flush(): Promise<ArrayBuffer> {
        log.assert(!this._flushed, 'DupFlush');
        this._flushed = true;
        return new Promise((resolve, reject) => {
            this._onComplete = resolve;
            this._onError = reject;
            if (this._isGif) {
                this._gifEncoder!.encode()
                    .then((blob: Blob) => blob.arrayBuffer())
                    .then(resolve)
                    .catch(reject);
                return;
            }
            this._worker.postMessage({ type: 'flush' });
        });
    }

    public close(): void {
        this._clean();
    }

    private _clean(): void {
        if (this._cleaned) return;
        this._cleaned = true;
        if (!this._isGif) {
            this._worker.terminate();
            URL.revokeObjectURL(this._workerUrl);
        }
    }
}
