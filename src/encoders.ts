import { log } from './core';

export class NativeEncoders {
    static async encodeBMP(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const w = canvas.width, h = canvas.height, data = imgData.data;
        const fileSize = 54 + w * h * 4;

        if (fileSize > 0xFFFFFFFF) throw new Error(`[BMP] Image too large: ${w}x${h} exceeds 4GB BMP limit`);
        const buf = new ArrayBuffer(fileSize);
        const view = new DataView(buf);
        view.setUint16(0, 0x424D, false);
        view.setUint32(2, fileSize, true); view.setUint32(6, 0, true); view.setUint32(10, 54, true);
        view.setUint32(14, 40, true); view.setUint32(18, w, true); view.setUint32(22, h, true);
        view.setUint16(26, 1, true); view.setUint16(28, 32, true);
        view.setUint32(38, 2835, true); view.setUint32(42, 2835, true);
        const p = new Uint8Array(buf, 54); let offset = 0;
        for (let y = h - 1; y >= 0; y--) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                p[offset++] = data[i + 2]; p[offset++] = data[i + 1];
                p[offset++] = data[i]; p[offset++] = data[i + 3];
            }
        }
        return new Blob([buf], { type: 'image/bmp' });
    }

    static async encodeWAV(audioBuffer: AudioBuffer): Promise<Blob> {
        const nc = audioBuffer.numberOfChannels, sr = audioBuffer.sampleRate;
        const result = new Float32Array(audioBuffer.length * nc);
        for (let ch = 0; ch < nc; ch++) {
            const d = audioBuffer.getChannelData(ch);
            for (let i = 0; i < audioBuffer.length; i++) result[i * nc + ch] = d[i];
        }
        const dataSize = result.length * 2;
        if (dataSize > 0xFFFFFFFF - 44) throw new Error(`[WAV] Audio too large: ${result.length} samples exceeds WAV limit`);
        const buf = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buf);
        const ws = (v: DataView, o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        ws(view, 0, 'RIFF'); view.setUint32(4, 36 + result.length * 2, true);
        ws(view, 8, 'WAVE'); ws(view, 12, 'fmt '); view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); view.setUint16(22, nc, true);
        view.setUint32(24, sr, true); view.setUint32(28, sr * nc * 2, true);
        view.setUint16(32, nc * 2, true); view.setUint16(34, 16, true);
        ws(view, 36, 'data'); view.setUint32(40, result.length * 2, true);
        let off = 44;
        for (let i = 0; i < result.length; i++, off += 2) {
            const s = Math.max(-1, Math.min(1, result[i]));
            view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        return new Blob([view], { type: 'audio/wav' });
    }
}

const NQ_NETSIZE = 256;
const NQ_PRIME1 = 499;
const NQ_PRIME2 = 491;
const NQ_PRIME3 = 487;
const NQ_PRIME4 = 503;
const NQ_MINQUALITY = 1;
const NQ_MAXQUALITY = 30;
const NQ_INITRAD = 32;
const NQ_RADIUSDEC = 30;
const NQ_INIT_ALPHA = 1024;
const NQ_GAMMA = 1024.0;
const NQ_BETA = 1.0 / 1024.0;
const NQ_BETAGAMMA = 1.0;

class NeuQuant {
    private net: Float64Array[] = [];
    private netindex: number[] = new Array(256).fill(0);
    private bias: number[] = new Array(NQ_NETSIZE).fill(0);
    private freq: number[] = new Array(NQ_NETSIZE).fill(NQ_INIT_ALPHA);
    private radpower: number[] = [];

    constructor(private pixels: Uint8ClampedArray, private quality: number = 10) {
        for (let i = 0; i < NQ_NETSIZE; i++) {
            const v = (i << 8) / NQ_NETSIZE;
            this.net[i] = new Float64Array([v, v, v, 0]);
        }
        this.freq.fill(NQ_INIT_ALPHA / NQ_NETSIZE);
        this.bias.fill(0);
    }

    private contest(r: number, g: number, b: number): number {
        let bestd = Infinity, bestbias = Infinity, best = -1, bestb = -1;
        for (let i = 0; i < NQ_NETSIZE; i++) {
            const n = this.net[i];
            const dist = Math.abs(n[2] - b) + Math.abs(n[1] - g) + Math.abs(n[0] - r);
            if (dist < bestd) { bestd = dist; best = i; }
            const biasdist = dist - this.bias[i];
            if (biasdist < bestbias) { bestbias = biasdist; bestb = i; }
            this.freq[i] -= this.freq[i] * NQ_BETA;
            this.bias[i] += this.freq[i] * NQ_BETAGAMMA;
        }
        this.freq[best] += NQ_BETA;
        this.bias[best] -= NQ_BETAGAMMA;
        return bestb;
    }

    private alterSingle(alpha: number, i: number, r: number, g: number, b: number): void {
        const n = this.net[i];
        n[0] -= alpha * (n[0] - r) / NQ_INIT_ALPHA;
        n[1] -= alpha * (n[1] - g) / NQ_INIT_ALPHA;
        n[2] -= alpha * (n[2] - b) / NQ_INIT_ALPHA;
    }

    private alterNeighbours(rad: number, i: number, r: number, g: number, b: number): void {
        const lo = Math.max(i - rad, 0), hi = Math.min(i + rad, NQ_NETSIZE - 1);
        let j = i + 1, k = i - 1, m = 1;
        while (j <= hi || k >= lo) {
            const alpha = this.radpower[m++] ?? 0;
            if (j <= hi) this.alterSingle(alpha, j++, r, g, b);
            if (k >= lo) this.alterSingle(alpha, k--, r, g, b);
        }
    }

    public learn(): void {
        const pixels = this.pixels;
        const len = pixels.length;
        const samplefac = Math.max(NQ_MINQUALITY, Math.min(NQ_MAXQUALITY, this.quality));
        const alphaDec = 30 + (samplefac - 1) / 3;
        const samplepixels = Math.floor(len / (4 * samplefac));
        const delta = Math.max(1, Math.floor(samplepixels / 100));
        let alpha = NQ_INIT_ALPHA;
        let radius = NQ_INITRAD;
        let rad = radius >> 0;

        for (let i = 0; i < rad; i++) {
            this.radpower[i] = alpha * ((rad * rad - i * i) * NQ_GAMMA / (rad * rad));
        }

        let step: number;
        if (len < 400) step = 4;
        else if (len % NQ_PRIME1) step = 4 * NQ_PRIME1;
        else if (len % NQ_PRIME2) step = 4 * NQ_PRIME2;
        else if (len % NQ_PRIME3) step = 4 * NQ_PRIME3;
        else step = 4 * NQ_PRIME4;

        let pix = 0;
        for (let i = 0; i < samplepixels; i++) {
            const pos = (pix % len) & ~3;
            const r = pixels[pos], g = pixels[pos + 1], b = pixels[pos + 2];
            const j = this.contest(r, g, b);
            this.alterSingle(alpha, j, r, g, b);
            if (rad > 0) this.alterNeighbours(rad, j, r, g, b);
            pix += step;
            if (i % delta === 0 && i > 0) {
                alpha -= Math.floor(alpha / alphaDec);
                radius -= Math.floor(radius / NQ_RADIUSDEC);
                rad = radius >> 0;
                if (rad <= 1) rad = 0;
                for (let k = 0; k < rad; k++) {
                    this.radpower[k] = alpha * ((rad * rad - k * k) * NQ_GAMMA / (rad * rad));
                }
            }
        }
    }

    public buildIndex(): void {
        let previouscol = 0, startpos = 0;
        for (let i = 0; i < NQ_NETSIZE; i++) {
            const n = this.net[i];
            let smallpos = i, smallval = Math.round(n[1]);
            for (let j = i + 1; j < NQ_NETSIZE; j++) {
                const q = this.net[j];
                if (Math.round(q[1]) < smallval) { smallpos = j; smallval = Math.round(q[1]); }
            }
            [this.net[i], this.net[smallpos]] = [this.net[smallpos], this.net[i]];
            if (smallval !== previouscol) {
                this.netindex[previouscol] = (startpos + i) >> 1;
                for (let k = previouscol + 1; k < smallval; k++) this.netindex[k] = i;
                previouscol = smallval; startpos = i;
            }
        }
        this.netindex[previouscol] = (startpos + NQ_NETSIZE - 1) >> 1;
        for (let k = previouscol + 1; k < 256; k++) this.netindex[k] = NQ_NETSIZE - 1;
    }

    public map(r: number, g: number, b: number): number {
        let bestd = 1000, best = -1;
        let i = this.netindex[g], j = i - 1;
        while (i < NQ_NETSIZE || j >= 0) {
            if (i < NQ_NETSIZE) {
                const n = this.net[i];
                let dist = Math.round(n[1]) - g;
                if (dist > bestd) { i = NQ_NETSIZE; } else {
                    i++;
                    dist = Math.abs(dist) + Math.abs(Math.round(n[0]) - r);
                    if (dist < bestd) { dist += Math.abs(Math.round(n[2]) - b); if (dist < bestd) { bestd = dist; best = i - 1; } }
                }
            }
            if (j >= 0) {
                const n = this.net[j];
                let dist = g - Math.round(n[1]);
                if (dist > bestd) { j = -1; } else {
                    j--;
                    dist = Math.abs(dist) + Math.abs(Math.round(n[0]) - r);
                    if (dist < bestd) { dist += Math.abs(Math.round(n[2]) - b); if (dist < bestd) { bestd = dist; best = j + 1; } }
                }
            }
        }
        return best;
    }

    public getPalette(): Uint8Array {
        const p = new Uint8Array(NQ_NETSIZE * 3);
        for (let i = 0; i < NQ_NETSIZE; i++) {
            p[i * 3 + 0] = Math.round(this.net[i][0]);
            p[i * 3 + 1] = Math.round(this.net[i][1]);
            p[i * 3 + 2] = Math.round(this.net[i][2]);
        }
        return p;
    }
}

export class AnimatedGifEncoder {
    w: number; h: number; fps: number;
    private _indices: Uint8Array[] = [];
    private _delays: number[] = [];
    private _palette: Uint8Array | null = null;
    private _nq: NeuQuant | null = null;
    private _samplePixels: Uint8ClampedArray[] = [];
    private _sampleCount = 0;
    canvas: OffscreenCanvas;
    ctx: OffscreenCanvasRenderingContext2D;
    quantizerQuality: number = 10;
    private _maxSamples = 16;

    constructor(w: number, h: number, fps: number = 30) {
        this.w = w; this.h = h; this.fps = fps;
        this.canvas = new OffscreenCanvas(w, h);
        this.ctx = this.canvas.getContext('2d')!;
    }

    async addFrame(videoFrame: CanvasImageSource, delayMs: number = Math.round(1000 / this.fps)): Promise<void> {
        try {
            try {
                this.ctx.drawImage(videoFrame, 0, 0, this.w, this.h);
            } catch (_) {
                const bmp = await createImageBitmap(videoFrame as ImageBitmapSource);
                this.ctx.drawImage(bmp, 0, 0, this.w, this.h);
                try { bmp.close(); } catch (__) { }
            }
            const data = this.ctx.getImageData(0, 0, this.w, this.h).data;
            if (this._sampleCount < this._maxSamples) {
                this._samplePixels.push(new Uint8ClampedArray(data.buffer.slice(0)));
                this._sampleCount++;
            }
            if (!this._nq) {
                this._indices.push(new Uint8Array(0));
            } else {
                const idx = new Uint8Array(this.w * this.h);
                for (let i = 0, n = this.w * this.h; i < n; i++) {
                    idx[i] = this._nq.map(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
                }
                this._indices.push(idx);
            }
            this._delays.push(delayMs);
        } catch (err: unknown) {
            try { log.error('[GIF] addFrame error', err instanceof Error ? err : new Error(String(err))); } catch (_) { }
        }
    }

    async encode(): Promise<Blob> {
        const w = this.w, h = this.h;
        const sampleCount = Math.min(this._maxSamples, this._samplePixels.length);
        let totalLen = 0;
        for (let i = 0; i < sampleCount; i++) totalLen += this._samplePixels[i].length;
        const combined = new Uint8ClampedArray(totalLen);
        let off = 0;
        for (let i = 0; i < sampleCount; i++) { combined.set(this._samplePixels[i], off); off += this._samplePixels[i].length; }
        this._samplePixels = [];
        const nq = new NeuQuant(combined, this.quantizerQuality);
        nq.learn();
        nq.buildIndex();
        this._nq = nq;
        this._palette = nq.getPalette();
        for (let i = 0; i < this._indices.length; i++) {
            if (this._indices[i].length === 0 && i < this._samplePixels.length) break;
        }
        const palette = this._palette;
        const chunks: Uint8Array[] = [];
        const hdr: number[] = [];
        const w16 = (v: number) => { hdr.push(v & 0xFF, (v >> 8) & 0xFF); };
        const wstr = (s: string) => { for (const c of s) hdr.push(c.charCodeAt(0)); };
        wstr('GIF89a'); w16(w); w16(h);
        hdr.push(0xF7, 0, 0);
        for (let i = 0; i < 256; i++) {
            hdr.push(palette[i * 3] ?? 0, palette[i * 3 + 1] ?? 0, palette[i * 3 + 2] ?? 0);
        }
        hdr.push(0x21, 0xFF, 11);
        wstr('NETSCAPE2.0');
        hdr.push(3, 1); w16(0); hdr.push(0);
        chunks.push(new Uint8Array(hdr));
        for (let fi = 0; fi < this._indices.length; fi++) {
            let indices = this._indices[fi];
            if (indices.length === 0 && fi < sampleCount) {
                const pxData = this.ctx.getImageData(0, 0, w, h).data;
                indices = new Uint8Array(w * h);
                for (let i = 0; i < w * h; i++) {
                    indices[i] = nq.map(pxData[i * 4], pxData[i * 4 + 1], pxData[i * 4 + 2]);
                }
                this._indices[fi] = indices;
            }
            const frameBuf: number[] = [];
            frameBuf.push(0x21, 0xF9, 4, 0x00);
            const delay = Math.round(this._delays[fi] / 10);
            frameBuf.push(delay & 0xFF, (delay >> 8) & 0xFF);
            frameBuf.push(0, 0);
            frameBuf.push(0x2C);
            frameBuf.push(0, 0, 0, 0);
            frameBuf.push(w & 0xFF, (w >> 8) & 0xFF);
            frameBuf.push(h & 0xFF, (h >> 8) & 0xFF);
            frameBuf.push(0, 8);
            this._lzwEncode(indices, frameBuf);
            frameBuf.push(0);
            chunks.push(new Uint8Array(frameBuf));
        }
        chunks.push(new Uint8Array([0x3B]));
        return new Blob(chunks as BlobPart[], { type: 'image/gif' });
    }

    private _lzwEncode(indices: Uint8Array, out: number[]): void {
        const clearCode = 256, endCode = 257;
        let nextCode = 258, codeSize = 9;
        let bitBuf = 0, bitCnt = 0, block: number[] = [];
        const writeBits = (val: number, size: number) => {
            bitBuf |= (val << bitCnt); bitCnt += size;
            while (bitCnt >= 8) {
                block.push(bitBuf & 0xFF); bitBuf >>= 8; bitCnt -= 8;
                if (block.length === 255) { out.push(255, ...block); block = []; }
            }
        };
        writeBits(clearCode, codeSize);
        const dict = new Map<number, number>();
        let prefix = indices[0];
        for (let i = 1; i < indices.length; i++) {
            const suffix = indices[i];
            const key = prefix * 4096 + suffix;
            if (dict.has(key)) {
                prefix = dict.get(key)!;
            } else {
                writeBits(prefix, codeSize);
                if (nextCode < 4096) {
                    dict.set(key, nextCode++);
                    if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
                } else {
                    writeBits(clearCode, codeSize);
                    dict.clear(); nextCode = 258; codeSize = 9;
                }
                prefix = suffix;
            }
        }
        writeBits(prefix, codeSize);
        writeBits(endCode, codeSize);
        if (bitCnt > 0) block.push(bitBuf & 0xFF);
        if (block.length > 0) { out.push(block.length, ...block); }
    }
}

export class WebPEncoder {
    static async encode(
        source: OffscreenCanvas | HTMLCanvasElement | ImageBitmap,
        quality: number = 0.9
    ): Promise<Blob> {
        if ('convertToBlob' in source) {
            return (source as OffscreenCanvas).convertToBlob({ type: 'image/webp', quality });
        }
        if (source instanceof HTMLCanvasElement) {
            return new Promise<Blob>((res, rej) =>
                source.toBlob(b => b ? res(b) : rej(new Error('WebP failed')), 'image/webp', quality)
            );
        }
        const oc = new OffscreenCanvas(
            (source as ImageBitmap).width,
            (source as ImageBitmap).height
        );
        const ctx = oc.getContext('2d')!;
        ctx.drawImage(source as ImageBitmap, 0, 0);
        return oc.convertToBlob({ type: 'image/webp', quality });
    }

    static async encodeFromBitmap(frame: ImageBitmap, quality: number = 0.9): Promise<Blob> {
        const oc = new OffscreenCanvas(frame.width, frame.height);
        const ctx = oc.getContext('2d')!;
        ctx.drawImage(frame, 0, 0);
        return oc.convertToBlob({ type: 'image/webp', quality });
    }
}

export class APNGEncoder {
    private frames: { data: Uint8Array; delay: number }[] = [];
    private w: number; private h: number;

    constructor(width: number, height: number) {
        this.w = width; this.h = height;
    }

    async addFrame(source: ImageBitmap | OffscreenCanvas, delayMs: number): Promise<void> {
        let oc: OffscreenCanvas;
        if (source instanceof OffscreenCanvas) {
            oc = source;
        } else {
            oc = new OffscreenCanvas(this.w, this.h);
            oc.getContext('2d')!.drawImage(source as ImageBitmap, 0, 0);
        }
        const blob = await oc.convertToBlob({ type: 'image/png' });
        const ab = await blob.arrayBuffer();
        this.frames.push({ data: new Uint8Array(ab), delay: delayMs });
    }

    async encode(): Promise<Blob> {
        if (this.frames.length === 0) throw new Error('No frames');
        const out: Uint8Array[] = [];
        const u32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v); return b; };
        const crc32 = APNGEncoder._crc32;
        const chunk = (type: string, data: Uint8Array): Uint8Array => {
            const tBytes = new TextEncoder().encode(type);
            const payload = new Uint8Array(tBytes.length + data.length);
            payload.set(tBytes); payload.set(data, tBytes.length);
            const result = new Uint8Array(4 + 4 + data.length + 4);
            result.set(u32(data.length)); result.set(tBytes, 4);
            result.set(data, 8);
            new DataView(result.buffer).setUint32(8 + data.length, crc32(payload));
            return result;
        };
        const base = this.frames[0].data;
        const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        out.push(PNG_SIG);
        const readChunk = (src: Uint8Array, at: number) => {
            const dv = new DataView(src.buffer, src.byteOffset + at);
            const length = dv.getUint32(0);
            const type = String.fromCharCode(...src.slice(at + 4, at + 8));
            const data = src.slice(at + 8, at + 8 + length);
            return { type, data, next: at + 12 + length };
        };
        const ihdr = readChunk(base, 8);
        out.push(chunk('IHDR', ihdr.data));
        const actl = new Uint8Array(8);
        const actlDV = new DataView(actl.buffer);
        actlDV.setUint32(0, this.frames.length);
        actlDV.setUint32(4, 0);
        out.push(chunk('acTL', actl));
        let seqNum = 0;
        for (let fi = 0; fi < this.frames.length; fi++) {
            const f = this.frames[fi];
            const fctl = new Uint8Array(26);
            const fctlDV = new DataView(fctl.buffer);
            fctlDV.setUint32(0, seqNum++);
            fctlDV.setUint32(4, this.w); fctlDV.setUint32(8, this.h);
            fctlDV.setUint32(12, 0); fctlDV.setUint32(16, 0);
            fctlDV.setUint16(20, f.delay); fctlDV.setUint16(22, 1000);
            fctl[24] = 1;
            fctl[25] = 0;
            out.push(chunk('fcTL', fctl));
            const framePng = f.data;
            let fpos = 8;
            while (fpos < framePng.length - 12) {
                const { type, data, next } = readChunk(framePng, fpos);
                fpos = next;
                if (type === 'IDAT') {
                    if (fi === 0) {
                        out.push(chunk('IDAT', data));
                    } else {
                        const fdat = new Uint8Array(4 + data.length);
                        new DataView(fdat.buffer).setUint32(0, seqNum++);
                        fdat.set(data, 4);
                        out.push(chunk('fdAT', fdat));
                    }
                }
                if (type === 'IEND') break;
            }
        }
        out.push(chunk('IEND', new Uint8Array(0)));
        const total = out.reduce((s, b) => s + b.length, 0);
        const result = new Uint8Array(total);
        let offset = 0;
        for (const b of out) { result.set(b, offset); offset += b.length; }
        return new Blob([result], { type: 'image/apng' });
    }

    private static _crc32Table: Uint32Array | null = null;
    private static _initCrcTable(): Uint32Array {
        if (APNGEncoder._crc32Table) return APNGEncoder._crc32Table;
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c;
        }
        APNGEncoder._crc32Table = t;
        return t;
    }
    private static _crc32(data: Uint8Array): number {
        const t = APNGEncoder._initCrcTable();
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < data.length; i++) crc = t[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }
}
