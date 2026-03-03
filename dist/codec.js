/**
 * AegisForge Video Encoder Base
 */
import { log, AegisError } from './core';
import { WORKER_SCRIPT } from './worker';
import { AnimatedGifEncoder } from './encoders';
export class Vid {
    f;
    cp;
    bw;
    o;
    wu;
    w;
    oc;
    oe;
    isGif;
    gifEncoder;
    hasV;
    qActive;
    constructor(o) {
        this.f = false;
        this.cp = true;
        this.bw = [];
        this.o = o;
        this.isGif = !!o.isGif;
        this.wu = "";
        this.hasV = !!o.video;
        this.qActive = true;
        if (!this.isGif) {
            const b = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
            this.wu = URL.createObjectURL(b);
            this.w = new Worker(this.wu);
        }
        else {
            this.w = {};
        }
    }
    async init() {
        const o = this.o;
        if (this.isGif) {
            this.gifEncoder = new AnimatedGifEncoder(o.video.width, o.video.height, o.video.framerate || 30);
            this.cp = true;
            return;
        }
        if (o.video) {
            let vc = o.video.codec;
            const VideoEncoderClass = window.VideoEncoder;
            const sup = await VideoEncoderClass.isConfigSupported(o.video);
            if (!sup.supported) {
                log.warn(`Codec ${vc} strict hardware reject. Falling back to software vp8.`);
                vc = 'vp8';
                o.video.codec = vc;
            }
        }
        this.w.onmessage = (e) => {
            const { type } = e.data;
            if (type === 'done') {
                if (this.oc)
                    this.oc(e.data.buffer);
                this._clean();
            }
            else if (type === 'error') {
                const err = new AegisError(`MuxFail:${e.data.error}`);
                log.error('WorkerErr', err);
                if (this.oe)
                    this.oe(err);
                this._clean();
            }
            else if (type === 'queue-capacity') {
                this.cp = e.data.active;
                this.qActive = e.data.active; // Added this line
                if (this.cp && this.bw.length > 0) {
                    const r = this.bw.shift();
                    if (r)
                        r();
                }
            }
        };
        this.w.onerror = (e) => {
            const err = new AegisError('FatalWorkerErr', e);
            if (this.oe)
                this.oe(err);
            this._clean();
        };
        const payload = {
            video: o.video,
            audio: o.audio ? {
                codec: 'opus',
                numberOfChannels: o.audio.numberOfChannels || 2,
                sampleRate: o.audio.sampleRate || 48000
            } : undefined,
            directToDisk: !!o.directToDisk,
            mp4Container: !!o.mp4Container
        };
        const transfers = [];
        if (o.stream) {
            payload.stream = o.stream;
            transfers.push(o.stream);
        }
        this.w.postMessage({ type: 'init', payload }, transfers);
    }
    async wc() {
        if (this.cp)
            return;
        return new Promise(r => this.bw.push(r));
    }
    async pushVid(f, k = false) {
        await this.wc();
        try {
            log.assert(f instanceof window.VideoFrame, 'NotVideoFrame');
            if (this.f) {
                throw new AegisError("VidFlushed");
            }
            if (this.isGif) {
                await this.gifEncoder?.addFrame(f, Math.round(1000 / (this.o.video.framerate || 30)));
                return;
            }
            if (!this.w || !this.hasV)
                return;
            while (!this.qActive) {
                await new Promise(r => setTimeout(r, 5));
            }
            // Zero-Copy Transfer: Pass ownership of the frame buffer exactly to the worker thread without copying bytes.
            this.w.postMessage({ type: 'encode-video', payload: { frame: f, keyFrame: k } }, [f]);
        }
        catch (err) {
            try {
                f.close();
            }
            catch (e) { } // Only close if transfer failed or GIF encoding, otherwise Worker owns it now.
            throw err;
        }
    }
    async pushAud(a) {
        await this.wc();
        try {
            log.assert(a instanceof window.AudioData, 'NotAudioData');
            if (this.f) {
                throw new AegisError("VidFlushed");
            }
            if (this.isGif) {
                return;
            }
            this.w.postMessage({
                type: 'encode-audio',
                payload: { audioData: a }
            }, [a]);
        }
        catch (err) {
            try {
                a.close();
            }
            catch (e) { }
            throw err;
        }
    }
    async flush() {
        log.assert(!this.f, "DupFlush");
        this.f = true;
        return new Promise((r, j) => {
            this.oc = r;
            this.oe = j;
            if (this.isGif) {
                this.gifEncoder.encode()
                    .then((blob) => blob.arrayBuffer())
                    .then(r)
                    .catch(j);
                return;
            }
            this.w.postMessage({ type: 'flush' });
        });
    }
    _clean() {
        if (!this.isGif) {
            this.w.terminate();
            URL.revokeObjectURL(this.wu);
        }
    }
}
