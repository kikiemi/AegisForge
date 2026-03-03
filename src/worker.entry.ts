import { AegisMuxer } from './AegisMuxer';

let ve: VideoEncoder | null = null;
let ae: AudioEncoder | null = null;
let mx: InstanceType<typeof AegisMuxer.Engine> | null = null;
let sink: InstanceType<typeof AegisMuxer.MemSink> | InstanceType<typeof AegisMuxer.FileSink> | InstanceType<typeof AegisMuxer.WebStreamSink> | null = null;

let veConfig: VideoEncoderConfig | null = null;
let aeConfig: AudioEncoderConfig | null = null;

function initVideoEncoder() {
    if (ve) { try { ve.close(); } catch (_) { } }
    ve = new VideoEncoder({
        output: (c: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => { mx!.addVideo(c, meta); },
        error: (err: DOMException) => {
            self.postMessage({ type: 'error', error: `VideoEncoder fatal: ${err.message}` });
        }
    });
    ve.configure(veConfig!);
}

function initAudioEncoder() {
    if (ae) { try { ae.close(); } catch (_) { } }
    ae = new AudioEncoder({
        output: (c: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => { mx!.addAudio(c, meta); },
        error: (err: DOMException) => {
            self.postMessage({ type: 'error', error: `AudioEncoder fatal: ${err.message}` });
        }
    });
    ae.configure(aeConfig!);
}

self.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;
    try {
        if (type === 'init') {
            const directToDisk = payload.directToDisk || false;
            const formatStr = payload.mp4Container ? 'mp4' : 'webm';

            if (payload.stream) {
                sink = new AegisMuxer.WebStreamSink(payload.stream, (err: Error) => self.postMessage({ type: 'error', error: err.message }));
            } else if (directToDisk) {
                const ext = '.' + formatStr;
                const d = await navigator.storage.getDirectory();
                const f = await d.getFileHandle('af_' + Date.now() + ext, { create: true });
                const opfsH = await f.createSyncAccessHandle();
                sink = new AegisMuxer.FileSink(opfsH, (err: Error) => self.postMessage({ type: 'error', error: err.message }));
            } else {
                sink = new AegisMuxer.MemSink();
            }

            mx = new AegisMuxer.Engine({
                format: formatStr,
                mode: formatStr === 'mp4' ? "fragmented" : "interleaved",
                autoSync: false,
                sink: sink,
                video: payload.video,
                audio: payload.audio ? { ...payload.audio, codec: formatStr === 'mp4' ? 'mp4a.40.2' : 'opus' } : undefined,
                onError: (err: Error) => self.postMessage({ type: 'error', error: err.message })
            });

            if (payload.video) {
                veConfig = payload.video;
                initVideoEncoder();
            }
            if (payload.audio) {
                aeConfig = { ...payload.audio, codec: formatStr === 'mp4' ? 'mp4a.40.2' : 'opus' };
                initAudioEncoder();
            }
        } else if (type === 'encode-video') {
            if (!ve || ve.state !== 'configured') {
                self.postMessage({ type: 'error', error: 'VideoEncoder not configured — cannot encode frame' });
                try { payload.frame.close(); } catch (_) { }
                return;
            }
            ve.encode(payload.frame, { keyFrame: payload.keyFrame });
            try { payload.frame.close(); } catch (_) { }
            self.postMessage({ type: 'queue-capacity', active: ve.encodeQueueSize < 10 });
        } else if (type === 'encode-audio') {
            if (!ae || ae.state !== 'configured') {
                self.postMessage({ type: 'error', error: 'AudioEncoder not configured — cannot encode audio' });
                try { payload.audioData.close(); } catch (_) { }
                return;
            }
            ae.encode(payload.audioData);
            try { payload.audioData.close(); } catch (_) { }
        } else if (type === 'flush') {
            try {
                const ar: Promise<void>[] = [];
                if (ve && ve.state === 'configured') ar.push(ve.flush());
                if (ae && ae.state === 'configured') ar.push(ae.flush());
                await Promise.all(ar);
            } finally {
                try { if (ve) ve.close(); } catch (_) { }
                try { if (ae) ae.close(); } catch (_) { }
                try { if (mx) mx.finalize(); } catch (_) { }
            }
            if (sink instanceof AegisMuxer.FileSink || sink instanceof AegisMuxer.WebStreamSink) {
                try { (sink as { close: () => void }).close(); } catch (_) { }
                const dummy = new ArrayBuffer(0);
                self.postMessage({ type: 'done', buffer: dummy }, { transfer: [dummy] });
            } else {
                const b = (sink as InstanceType<typeof AegisMuxer.MemSink>).buffer;
                self.postMessage({ type: 'done', buffer: b }, { transfer: Array.isArray(b) ? b : [b] });
            }
        }
    } catch (err: unknown) {
        self.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
    }
};
