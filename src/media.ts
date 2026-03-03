import { log, AegisError } from './core';
import { SincResampler } from './audio/resample';

type ImgSource = CanvasImageSource & { displayWidth?: number; displayHeight?: number; videoWidth?: number; videoHeight?: number; close?(): void };

export interface ColorOptions {
    brightness?: number;
    contrast?: number;
    blur?: number;
    grayscale?: number;
    invert?: number;
}

export interface TextOptions {
    weight?: string;
    size?: number;
    font?: string;
    color?: string;
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
    outline?: string;
    outlineWidth?: number;
}

export class Img {
    public w: number;
    public h: number;
    public c: HTMLCanvasElement | OffscreenCanvas | null;
    public x: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

    constructor(s: ImgSource) {
        log.assert(s != null, 'src!null');
        try {
            this.w = ('width' in s ? (s as { width: number }).width : 0) || s.displayWidth || ('videoWidth' in s ? (s as { videoWidth: number }).videoWidth : 0) || 100;
            this.h = ('height' in s ? (s as { height: number }).height : 0) || s.displayHeight || ('videoHeight' in s ? (s as { videoHeight: number }).videoHeight : 0) || 100;
            const { c, x } = Img._c(this.w, this.h);
            this.c = c;
            this.x = x;
            this.x.drawImage(s, 0, 0, this.w, this.h);
        } catch (e: unknown) {
            throw new AegisError('ImgInitFail', e);
        } finally {
            if (s && typeof s.close === 'function') s.close();
        }
    }

    private static _c(w: number, h: number): { c: HTMLCanvasElement | OffscreenCanvas, x: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
        if (typeof OffscreenCanvas !== 'undefined') {
            const c = new OffscreenCanvas(w, h);
            const x = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
            return { c, x };
        }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
        return { c, x };
    }

    public static async load(s: string | Blob | File | ImgSource): Promise<Img> {
        log.assert(s != null, 'null src');
        if (s instanceof Blob || s instanceof File) {
            return new Img(await createImageBitmap(s) as unknown as ImgSource);
        }
        if (typeof s === 'string') {
            const r = await fetch(s);
            log.assert(r.ok, 'HTTP ' + r.status);
            return new Img(await createImageBitmap(await r.blob()) as unknown as ImgSource);
        }
        return new Img(await createImageBitmap(s as ImageBitmapSource) as unknown as ImgSource);
    }

    public resize(w: number, h: number, f: 'contain' | 'cover' | 'stretch' = 'contain'): Img {
        w = Math.max(1, w | 0);
        h = Math.max(1, h | 0);
        const { c, x } = Img._c(w, h);
        let dx = 0, dy = 0, dw = w, dh = h;
        if (f !== 'stretch') {
            const rs = this.w / this.h, rt = w / h;
            if ((f === 'contain' && rs > rt) || (f === 'cover' && rs < rt)) {
                dh = w / rs;
                dy = (h - dh) / 2;
            } else {
                dw = h * rs;
                dx = (w - dw) / 2;
            }
        }
        x.imageSmoothingEnabled = true;
        x.imageSmoothingQuality = 'high';
        x.drawImage(this.c as CanvasImageSource, 0, 0, this.w, this.h, dx, dy, dw, dh);
        this.close();
        this.c = c;
        this.x = x;
        this.w = w;
        this.h = h;
        return this;
    }

    public color(o: ColorOptions = {}): Img {
        const f: string[] = [];
        if (o.brightness !== undefined) f.push(`brightness(${o.brightness})`);
        if (o.contrast !== undefined) f.push(`contrast(${o.contrast})`);
        if (o.blur !== undefined) f.push(`blur(${o.blur}px)`);
        if (o.grayscale !== undefined) f.push(`grayscale(${o.grayscale})`);
        if (o.invert !== undefined) f.push(`invert(${o.invert})`);
        if (f.length && this.x) {
            const { c, x } = Img._c(this.w, this.h);
            x.filter = f.join(' ');
            x.drawImage(this.c as CanvasImageSource, 0, 0);
            x.filter = 'none';
            this.close();
            this.c = c;
            this.x = x;
        }
        return this;
    }

    public chromaKey(tc: [number, number, number] = [0, 255, 0], tol: number = 50): Img {
        if (!this.x) return this;
        const id = this.x.getImageData(0, 0, this.w, this.h);
        const d = id.data;
        const u32 = new Uint32Array(d.buffer);
        const [tr, tg, tb] = tc;
        const tolSq = tol * tol;
        for (let i = 0, len = u32.length; i < len; i++) {
            const px = u32[i];
            const dr = (px & 0xFF) - tr;
            const dg = ((px >> 8) & 0xFF) - tg;
            const db = ((px >> 16) & 0xFF) - tb;
            if (dr * dr + dg * dg + db * db < tolSq) u32[i] = px & 0x00FFFFFF;
        }
        this.x.putImageData(id, 0, 0);
        return this;
    }

    public overlay(i: Img, x: number = 0, y: number = 0, a: number = 1.0): Img {
        if (!this.x || !i.c) return this;
        const p = this.x.globalAlpha;
        this.x.globalAlpha = a;
        this.x.drawImage(i.c as CanvasImageSource, x, y);
        this.x.globalAlpha = p;
        return this;
    }

    public text(t: string, x: number, y: number, o: TextOptions = {}): Img {
        if (!this.x) return this;
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

    public createFrame(ts: number, d: number = 0): unknown {
        return new VideoFrame(this.c as CanvasImageSource, { timestamp: ts, duration: d, alpha: 'discard' });
    }

    public close(): void {
        if (this.c) {
            this.c.width = this.c.height = 0;
            this.c = null;
        }
        this.x = null;
    }
}

export class Aud {
    public b: AudioBuffer;
    private static _ctx: AudioContext | null = null;
    public static get ctx(): AudioContext {
        if (!Aud._ctx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) throw new AegisError('AudioContext not available');
            Aud._ctx = new AudioContextClass() as AudioContext;
        }
        return Aud._ctx;
    }

    constructor(b: AudioBuffer) {
        this.b = b;
    }

    public static async load(s: string | Blob | File | ArrayBuffer): Promise<Aud> {
        let x = Aud.ctx;
        if (x.state === 'suspended') {
            try { await x.resume(); } catch (e) { log.warn('AudioContext resume failed', e); }
        }
        try {
            let b: AudioBuffer;
            if (s instanceof Blob || s instanceof File) {
                b = await x.decodeAudioData(await s.arrayBuffer());
            } else if (s instanceof ArrayBuffer) {
                b = await x.decodeAudioData(s.slice(0));
            } else if (typeof s === 'string') {
                const r = await fetch(s);
                b = await x.decodeAudioData(await r.arrayBuffer());
            } else {
                throw new Error('Unknown Audio Source');
            }
            return new Aud(b);
        } catch (e: unknown) {
            throw new AegisError('AudLoadFail', e);
        }
    }

    public static async stream(mediaStream: MediaStream): Promise<AudStream> {
        const actx = Aud.ctx;
        const src = actx.createMediaStreamSource(mediaStream);
        const dest = actx.createMediaStreamDestination();
        src.connect(dest);
        return new AudStream(dest.stream);
    }

    public async mix(o: Aud, st: number = 0, v: number = 1.0): Promise<Aud> {
        const x = new OfflineAudioContext(
            Math.max(this.b.numberOfChannels, o.b.numberOfChannels),
            Math.max(this.b.length, (st * this.b.sampleRate) + o.b.length),
            this.b.sampleRate
        );
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

    private _offCtx(len: number): OfflineAudioContext {
        const Ctx = globalThis.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!Ctx) throw new AegisError('OfflineAudioContext not available');
        return new Ctx(this.b.numberOfChannels, len, this.b.sampleRate);
    }

    public async pan(value: number): Promise<Aud> {
        const x = this._offCtx(this.b.length);
        const s = x.createBufferSource();
        s.buffer = this.b;

        if (x.createStereoPanner) {
            const p = x.createStereoPanner();
            p.pan.value = Math.max(-1, Math.min(1, value));
            s.connect(p);
            p.connect(x.destination);
        } else {
            const p = x.createPanner();
            p.panningModel = 'equalpower';
            p.setPosition(value, 0, 1 - Math.abs(value));
            s.connect(p);
            p.connect(x.destination);
        }

        s.start(0);
        this.b = await x.startRendering();
        return this;
    }

    public async normalize(threshold: number = -24, ratio: number = 12): Promise<Aud> {
        const x = this._offCtx(this.b.length);
        const s = x.createBufferSource();
        s.buffer = this.b;

        const c = x.createDynamicsCompressor();
        c.threshold.value = threshold;
        c.ratio.value = ratio;
        c.knee.value = 30;
        c.attack.value = 0.003;
        c.release.value = 0.25;

        s.connect(c);
        c.connect(x.destination);
        s.start(0);

        this.b = await x.startRendering();
        return this;
    }

    public async reverb(duration: number = 2.0, decay: number = 2.0): Promise<Aud> {
        const ch = Math.max(2, this.b.numberOfChannels);
        const Ctx = globalThis.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!Ctx) throw new AegisError('OfflineAudioContext not available');
        const x = new Ctx(ch, this.b.length, this.b.sampleRate) as OfflineAudioContext;
        const s = x.createBufferSource();
        s.buffer = this.b;

        const len = x.sampleRate * duration;
        const imp = x.createBuffer(2, len, x.sampleRate);
        for (let i = 0; i < 2; i++) {
            const c = imp.getChannelData(i);
            for (let j = 0; j < len; j++) c[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / len, decay);
        }

        const conv = x.createConvolver();
        conv.buffer = imp;

        s.connect(conv);
        conv.connect(x.destination);
        s.start(0);

        this.b = await x.startRendering();
        return this;
    }

    public async echo(delayTime: number = 0.5, feedback: number = 0.5): Promise<Aud> {
        const x = this._offCtx(this.b.length + (delayTime * 5 * this.b.sampleRate));
        const s = x.createBufferSource();
        s.buffer = this.b;

        const d = x.createDelay(delayTime * 2);
        d.delayTime.value = delayTime;

        const fb = x.createGain();
        fb.gain.value = feedback;

        const wet = x.createGain();
        wet.gain.value = 0.5;

        s.connect(x.destination);
        s.connect(d);
        d.connect(fb);
        fb.connect(d);
        d.connect(wet);
        wet.connect(x.destination);

        s.start(0);
        this.b = await x.startRendering();
        return this;
    }

    public async pitchScale(rate: number): Promise<Aud> {
        const newLen = Math.floor(this.b.length / rate);
        const x = this._offCtx(newLen);
        const s = x.createBufferSource();
        s.buffer = this.b;
        s.playbackRate.value = rate;

        s.connect(x.destination);
        s.start(0);

        this.b = await x.startRendering();
        return this;
    }

    public async karaoke(): Promise<Aud> {
        if (this.b.numberOfChannels < 2) return this;
        const x = this._offCtx(this.b.length);
        const s = x.createBufferSource();
        s.buffer = this.b;

        const spl = x.createChannelSplitter(2);
        const gL = x.createGain(); gL.gain.value = 1;
        const gR = x.createGain(); gR.gain.value = -1;

        s.connect(spl);
        spl.connect(gL, 0);
        spl.connect(gR, 1);
        gL.connect(x.destination);
        gR.connect(x.destination);

        s.start(0);
        this.b = await x.startRendering();
        return this;
    }

    public async bleep(startSec: number, endSec: number, freq: number = 1000): Promise<Aud> {
        const x = this._offCtx(this.b.length);
        const s = x.createBufferSource();
        s.buffer = this.b;

        const dry = x.createGain();
        dry.gain.setValueAtTime(1, 0);
        dry.gain.setValueAtTime(1, Math.max(0, startSec - 0.01));
        dry.gain.setValueAtTime(0, startSec);
        dry.gain.setValueAtTime(0, endSec);
        dry.gain.setValueAtTime(1, endSec + 0.01);
        s.connect(dry);
        dry.connect(x.destination);
        s.start(0);

        const osc = x.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const oGain = x.createGain();
        oGain.gain.setValueAtTime(0, 0);
        oGain.gain.setValueAtTime(0, Math.max(0, startSec - 0.01));
        oGain.gain.setValueAtTime(1, startSec);
        oGain.gain.setValueAtTime(1, endSec);
        oGain.gain.setValueAtTime(0, endSec + 0.01);
        osc.connect(oGain);
        oGain.connect(x.destination);
        osc.start(0);
        osc.stop(endSec + 0.1);

        this.b = await x.startRendering();
        return this;
    }

    public removeSilence(thresholdDb: number = -50, minDurationSec: number = 0.5): Aud {
        const th = Math.pow(10, thresholdDb / 20);
        const minLen = Math.floor(minDurationSec * this.b.sampleRate);

        const numCh = this.b.numberOfChannels;
        const len = this.b.length;
        const channels: Float32Array[] = [];
        for (let c = 0; c < numCh; c++) channels.push(this.b.getChannelData(c));

        let runs: { s: number, e: number }[] = [], cur = -1;
        for (let i = 0; i < len; i++) {
            let maxAbs = 0;
            for (let c = 0; c < numCh; c++) maxAbs = Math.max(maxAbs, Math.abs(channels[c][i]));
            if (maxAbs < th) {
                if (cur === -1) cur = i;
            } else if (cur !== -1) {
                if (i - cur >= minLen) runs.push({ s: cur, e: i });
                cur = -1;
            }
        }
        if (cur !== -1 && len - cur >= minLen) runs.push({ s: cur, e: len });

        if (!runs.length) return this;

        let removed = 0;
        for (let r of runs) removed += (r.e - r.s);
        const newLen = this.b.length - removed;
        const x = this._offCtx(newLen);
        const nb = x.createBuffer(this.b.numberOfChannels, newLen, this.b.sampleRate);

        for (let c = 0; c < this.b.numberOfChannels; c++) {
            const oldD = this.b.getChannelData(c), newD = nb.getChannelData(c);
            let ptr = 0, ridx = 0;
            for (let i = 0; i < oldD.length; i++) {
                if (ridx < runs.length && i >= runs[ridx].s && i < runs[ridx].e) {
                    if (i === runs[ridx].e - 1) ridx++;
                    continue;
                }
                newD[ptr++] = oldD[i];
            }
        }
        this.b = nb;
        return this;
    }

    public getWaveform(bins: number = 100): number[] {
        const d = this.b.getChannelData(0), step = Math.floor(d.length / bins), res = [];
        for (let i = 0; i < bins; i++) {
            let sum = 0;
            for (let j = 0; j < step; j++) sum += Math.abs(d[i * step + j]);
            res.push(sum / step);
        }
        return res;
    }

    public *generate(f: number = 1024, sp: number = 0): Generator<{ audioData: { timestamp: number; close: () => void }, framesCount: number }> {
        if (!('AudioData' in globalThis)) throw new Error('[Aud] AudioData API not available — requires Chromium-based browser');
        const AudioDataCtor = (globalThis as Record<string, unknown>).AudioData as new (opts: unknown) => { timestamp: number; close: () => void };
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
                audioData: new AudioDataCtor({
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

    public static async *mixWebStreams(
        inputs: { aud: Aud, start: number, volume?: number }[],
        targetSr: number,
        targetCh: number,
        chunkSize: number = 8192
    ): AsyncGenerator<{ audioData: { timestamp: number; close: () => void }; framesCount: number; timeMs: number }> {
        if (!inputs.length) return;

        type MixTrack = { aud: Aud, startSamples: number, length: number, volume: number, needsResample: boolean };
        const tracks: MixTrack[] = inputs.map(i => ({
            aud: i.aud,
            startSamples: Math.floor((i.start / 1000) * targetSr),
            length: 0,
            volume: i.volume ?? 1.0,
            needsResample: i.aud.b.sampleRate !== targetSr
        }));

        const resamplers = new Map<number, Map<number, SincResampler>>();
        for (let ti = 0; ti < tracks.length; ti++) {
            if (tracks[ti].needsResample) {
                const chMap = new Map<number, SincResampler>();
                for (let ch = 0; ch < targetCh && ch < tracks[ti].aud.b.numberOfChannels; ch++) {
                    chMap.set(ch, new SincResampler(tracks[ti].aud.b.sampleRate, targetSr));
                }
                resamplers.set(ti, chMap);
            }
        }

        let maxLen = 0;
        for (const t of tracks) {
            const durInSeconds = t.aud.b.length / t.aud.b.sampleRate;
            t.length = t.startSamples + Math.floor(durInSeconds * targetSr);
            if (t.length > maxLen) maxLen = t.length;
        }

        let p = 0;
        for (let i = 0; i < maxLen; i += chunkSize) {
            const s = Math.min(chunkSize, maxLen - i);
            const d = new Float32Array(s * targetCh);
            let o = 0;

            for (let j = 0; j < targetCh; j++) {
                const channelData = new Float32Array(s);

                for (const t of tracks) {
                    const trackStartInChunk = Math.max(0, t.startSamples - i);
                    const trackEndInChunk = Math.min(s, t.length - i);

                    if (trackStartInChunk < trackEndInChunk && j < t.aud.b.numberOfChannels) {
                        const srcChannel = t.aud.b.getChannelData(j);
                        const writeLen = trackEndInChunk - trackStartInChunk;
                        const vol = t.volume;

                        if (t.needsResample) {
                            const ti = tracks.indexOf(t);
                            const resampler = resamplers.get(ti)!.get(j)!;
                            const srcStart = Math.floor(((i + trackStartInChunk) - t.startSamples) * (t.aud.b.sampleRate / targetSr));
                            const srcEnd = Math.min(srcChannel.length, srcStart + Math.ceil(writeLen * (t.aud.b.sampleRate / targetSr)));
                            const seg = srcChannel.subarray(Math.max(0, srcStart), srcEnd);
                            const resampled = resampler.process(seg);
                            for (let k = 0; k < writeLen && k < resampled.length; k++) {
                                channelData[trackStartInChunk + k] += resampled[k] * vol;
                            }
                        } else {
                            const srcOffset = (i + trackStartInChunk) - t.startSamples;
                            for (let k = 0; k < writeLen; k++) {
                                const srcIdx = srcOffset + k;
                                if (srcIdx >= 0 && srcIdx < srcChannel.length) {
                                    channelData[trackStartInChunk + k] += srcChannel[srcIdx] * vol;
                                }
                            }
                        }
                    }
                }
                d.set(channelData, o);
                o += s;
            }

            const timeMs = (i / targetSr) * 1000;
            const audioData = new ((globalThis as Record<string, unknown>).AudioData as new (opts: unknown) => { timestamp: number; close: () => void })({
                format: 'f32-planar',
                sampleRate: targetSr,
                numberOfFrames: s,
                numberOfChannels: targetCh,
                timestamp: Math.floor(timeMs * 1000),
                data: d
            });

            yield { audioData, framesCount: s, timeMs };
            p += s;
            await new Promise(r => setTimeout(r, 0));
        }
    }

}

export class AudStream {
    public stream: MediaStream;

    private _processor: { readable: ReadableStream; track: MediaStreamTrack };

    private _reader: ReadableStreamDefaultReader;

    constructor(s: MediaStream) {
        this.stream = s;
        if (!('MediaStreamTrackProcessor' in globalThis)) throw new Error('[AudStream] MediaStreamTrackProcessor not available — requires Chromium-based browser');
        this._processor = new ((globalThis as Record<string, unknown>).MediaStreamTrackProcessor as new (opts: { track: MediaStreamTrack }) => { readable: ReadableStream; track: MediaStreamTrack })({ track: s.getAudioTracks()[0] });
        this._reader = this._processor.readable.getReader();
    }

    public async read(): Promise<unknown> {
        const { done, value } = await this._reader.read();
        return done ? null : value;
    }

    public close(): void {
        this._processor.track.stop();
    }
}
