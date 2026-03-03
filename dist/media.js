/**
 * AegisForge Media Utilities (Img & Aud)
 */
import { log, AegisError } from './core';
export class Img {
    w;
    h;
    c;
    x;
    constructor(s) {
        log.assert(s != null, 'src!null');
        try {
            this.w = s.width || s.displayWidth || s.videoWidth || 100;
            this.h = s.height || s.displayHeight || s.videoHeight || 100;
            const { c, x } = Img._c(this.w, this.h);
            this.c = c;
            this.x = x;
            this.x.drawImage(s, 0, 0, this.w, this.h);
        }
        catch (e) {
            throw new AegisError('ImgInitFail', e);
        }
        finally {
            if (s && typeof s.close === 'function')
                s.close();
        }
    }
    static _c(w, h) {
        if (typeof OffscreenCanvas !== 'undefined') {
            const c = new OffscreenCanvas(w, h);
            const x = c.getContext('2d', { willReadFrequently: true });
            return { c, x };
        }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const x = c.getContext('2d', { willReadFrequently: true });
        return { c, x };
    }
    static async load(s) {
        log.assert(s != null, 'null src');
        if (s instanceof Blob || s instanceof File) {
            return new Img(await createImageBitmap(s));
        }
        if (typeof s === 'string') {
            const r = await fetch(s);
            log.assert(r.ok, 'HTTP ' + r.status);
            return new Img(await createImageBitmap(await r.blob()));
        }
        return new Img(await createImageBitmap(s));
    }
    resize(w, h, f = 'contain') {
        w = Math.max(1, w | 0);
        h = Math.max(1, h | 0);
        const { c, x } = Img._c(w, h);
        let dx = 0, dy = 0, dw = w, dh = h;
        if (f !== 'stretch') {
            const rs = this.w / this.h, rt = w / h;
            if ((f === 'contain' && rs > rt) || (f === 'cover' && rs < rt)) {
                dh = w / rs;
                dy = (h - dh) / 2;
            }
            else {
                dw = h * rs;
                dx = (w - dw) / 2;
            }
        }
        x.imageSmoothingEnabled = true;
        x.imageSmoothingQuality = 'high';
        x.drawImage(this.c, 0, 0, this.w, this.h, dx, dy, dw, dh);
        this.close();
        this.c = c;
        this.x = x;
        this.w = w;
        this.h = h;
        return this;
    }
    color(o = {}) {
        const f = [];
        if (o.brightness !== undefined)
            f.push(`brightness(${o.brightness})`);
        if (o.contrast !== undefined)
            f.push(`contrast(${o.contrast})`);
        if (o.blur !== undefined)
            f.push(`blur(${o.blur}px)`);
        if (o.grayscale !== undefined)
            f.push(`grayscale(${o.grayscale})`);
        if (o.invert !== undefined)
            f.push(`invert(${o.invert})`);
        if (f.length && this.x) {
            const { c, x } = Img._c(this.w, this.h);
            x.filter = f.join(' ');
            x.drawImage(this.c, 0, 0);
            x.filter = 'none';
            this.close();
            this.c = c;
            this.x = x;
        }
        return this;
    }
    chromaKey(tc = [0, 255, 0], tol = 50) {
        if (!this.x)
            return this;
        const id = this.x.getImageData(0, 0, this.w, this.h);
        const d = id.data;
        const [tr, tg, tb] = tc;
        for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i + 1], b = d[i + 2];
            if (Math.sqrt((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2) < tol)
                d[i + 3] = 0;
        }
        this.x.putImageData(id, 0, 0);
        return this;
    }
    overlay(i, x = 0, y = 0, a = 1.0) {
        if (!this.x || !i.c)
            return this;
        const p = this.x.globalAlpha;
        this.x.globalAlpha = a;
        this.x.drawImage(i.c, x, y);
        this.x.globalAlpha = p;
        return this;
    }
    text(t, x, y, o = {}) {
        if (!this.x)
            return this;
        this.x.font = `${o.weight || 'bold'} ${o.size || 24}px ${o.font || 'sans-serif'}`;
        this.x.fillStyle = o.color || 'white';
        this.x.textAlign = o.align || 'left';
        this.x.textBaseline = o.baseline || 'top';
        if (o.outline) {
            this.x.strokeStyle = o.outline || 'black';
            this.x.lineWidth = o.outlineWidth || 4;
            this.x.strokeText(t, x, y);
        }
        this.x.fillText(t, x, y);
        return this;
    }
    createFrame(ts, d = 0) {
        return new window.VideoFrame(this.c, { timestamp: ts, duration: d, alpha: 'discard' });
    }
    close() {
        if (this.c) {
            this.c.width = this.c.height = 0;
            this.c = null;
        }
        this.x = null;
    }
}
export class Aud {
    b;
    constructor(b) {
        this.b = b;
    }
    static async load(s) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const x = new AudioContextClass();
        try {
            let b;
            if (s instanceof Blob || s instanceof File) {
                b = await x.decodeAudioData(await s.arrayBuffer());
            }
            else if (s instanceof ArrayBuffer) {
                b = await x.decodeAudioData(s);
            }
            else if (typeof s === 'string') {
                const r = await fetch(s);
                b = await x.decodeAudioData(await r.arrayBuffer());
            }
            else {
                throw new Error("Unknown Audio Source");
            }
            return new Aud(b);
        }
        finally {
            if (x.state !== 'closed')
                x.close();
        }
    }
    static async stream(mediaStream) {
        const actx = new AudioContext();
        const src = actx.createMediaStreamSource(mediaStream);
        const dest = actx.createMediaStreamDestination();
        src.connect(dest);
        return new AudStream(dest.stream, actx);
    }
    async mix(o, st = 0, v = 1.0) {
        const x = new OfflineAudioContext(Math.max(this.b.numberOfChannels, o.b.numberOfChannels), Math.max(this.b.length, (st * this.b.sampleRate) + o.b.length), this.b.sampleRate);
        const s1 = x.createBufferSource();
        s1.buffer = this.b;
        s1.connect(x.destination);
        s1.start(0);
        const s2 = x.createBufferSource();
        s2.buffer = o.b;
        const g = x.createGain();
        g.gain.value = v;
        s2.connect(g);
        g.connect(x.destination);
        s2.start(st);
        const ab = await x.startRendering();
        this.b = ab;
        return this;
    }
    *generate(f = 1024, sp = 0) {
        const r = this.b.sampleRate;
        const c = this.b.numberOfChannels;
        const l = this.b.length;
        let p = sp;
        for (let i = 0; i < l; i += f) {
            const s = Math.min(f, l - i);
            const d = new Float32Array(s * c);
            let o = 0;
            for (let j = 0; j < c; j++) {
                d.set(this.b.getChannelData(j).subarray(i, i + s), o);
                o += s;
            }
            yield {
                audioData: new window.AudioData({
                    format: 'f32-planar',
                    sampleRate: r,
                    numberOfFrames: s,
                    numberOfChannels: c,
                    timestamp: p,
                    data: d
                }),
                framesCount: s
            };
            p += Math.floor((s / r) * 1_000_000);
        }
    }
    static *mixWebStreams(audios, targetSr, targetCh, chunkSize = 8192) {
        if (!audios.length)
            return;
        let maxLen = 0;
        for (let a of audios) {
            let l = a.b.length;
            if (l > maxLen)
                maxLen = l;
        }
        let p = 0;
        for (let i = 0; i < maxLen; i += chunkSize) {
            const s = Math.min(chunkSize, maxLen - i);
            const d = new Float32Array(s * targetCh);
            let o = 0;
            for (let j = 0; j < targetCh; j++) {
                const channelData = new Float32Array(s);
                for (let a of audios) {
                    if (j < a.b.numberOfChannels && i < a.b.length) {
                        const len = Math.min(s, a.b.length - i);
                        const src = a.b.getChannelData(j).subarray(i, i + len);
                        for (let k = 0; k < len; k++)
                            channelData[k] += src[k]; // Additive synthesis
                    }
                }
                d.set(channelData, o);
                o += s;
            }
            yield {
                audioData: new window.AudioData({
                    format: 'f32-planar',
                    sampleRate: targetSr,
                    numberOfFrames: s,
                    numberOfChannels: targetCh,
                    timestamp: p,
                    data: d
                }),
                framesCount: s
            };
            p += Math.floor((s / targetSr) * 1_000_000);
        }
    }
}
export class AudStream {
    s;
    x;
    p; // MediaStreamTrackProcessor
    r; // ReadableStreamDefaultReader
    constructor(s, x) {
        this.s = s;
        this.x = x;
        this.p = new window.MediaStreamTrackProcessor({ track: s.getAudioTracks()[0] });
        this.r = this.p.readable.getReader();
    }
    async read() {
        const { done, value } = await this.r.read();
        return done ? null : value;
    }
    close() {
        this.p.track.stop();
        this.x.close();
    }
}
