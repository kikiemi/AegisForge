import { log } from '../core';

export interface MP4Track {
    id: number;
    type: 'video' | 'audio' | 'other';
    codec: string;
    width?: number;
    height?: number;
    sampleRate?: number;
    channelCount?: number;
    timescale: number;
    duration: number;
    samples: MP4Sample[];
    extradata?: Uint8Array;
}

export interface MP4Sample {
    offset: number;
    size: number;
    pts: number;
    dts: number;
    isKey: boolean;
    duration: number;
}

export class MP4Demuxer {
    private buf: DataView;
    private raw: Uint8Array;
    public tracks: MP4Track[] = [];
    private _mvhdTimescale = 1;

    constructor(buffer: ArrayBuffer) {
        this.raw = new Uint8Array(buffer);
        this.buf = new DataView(buffer);
    }

    public parse(): void {
        try {
            this._parseBoxes(0, this.buf.byteLength, null);
        } catch (e) {
            log.warn('[MP4Demuxer] Parse error (possibly truncated file):', e);
        }
    }

    private _parseBoxes(start: number, end: number, parent: string | null): void {
        let pos = start;
        while (pos < end - 8) {
            let size = this.buf.getUint32(pos);
            const type = this._fourcc(pos + 4);
            let dataStart = pos + 8;

            if (size === 1) {
                if (pos + 16 > end) break;
                size = Number(this.buf.getBigUint64(pos + 8));
                dataStart = pos + 16;
            } else if (size === 0) {
                size = end - pos;
            }

            if (size < 8 || pos + size > end) break;
            const boxEnd = pos + size;

            if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'edts'].includes(type)) {
                this._parseBoxes(dataStart, boxEnd, type);
            } else {
                this._handleBox(type, dataStart, boxEnd, parent);
            }
            pos = boxEnd;
        }
    }

    private _ctx: { track?: Partial<MP4Track> } = {};

    private _handleBox(type: string, start: number, end: number, parent: string | null): void {
        switch (type) {
            case 'mvhd': this._mvhdTimescale = this.buf.getUint32(start + 4 + (this.buf.getUint8(start) === 1 ? 16 : 4)); break;
            case 'tkhd': {
                const v = this.buf.getUint8(start);
                const id = this.buf.getUint32(start + (v === 1 ? 16 : 8) + 4);
                if (!this._ctx.track || this._ctx.track.id !== id) {
                    this._ctx.track = { id, samples: [], type: 'other' };
                    this._tmpStts = []; this._tmpCtts = []; this._tmpSizes = [];
                    this._tmpChunkMap = []; this._tmpChunkOffsets = [];
                    this._tmpKeyFrames.clear();
                }
                break;
            }
            case 'mdhd': {
                const v = this.buf.getUint8(start);
                const ts = v === 1 ? Number(this.buf.getBigUint64(start + 20)) : this.buf.getUint32(start + 12);
                const dur = v === 1 ? Number(this.buf.getBigUint64(start + 28)) : this.buf.getUint32(start + 16);
                if (this._ctx.track) { this._ctx.track.timescale = ts; this._ctx.track.duration = dur; }
                break;
            }
            case 'hdlr': {
                const hdlr = this._fourcc(start + 8);
                if (this._ctx.track) this._ctx.track.type = hdlr === 'vide' ? 'video' : hdlr === 'soun' ? 'audio' : 'other';
                break;
            }
            case 'avc1': case 'hev1': case 'hvc1': case 'av01': case 'vp09': {
                if (this._ctx.track) {
                    this._ctx.track.codec = type;
                    this._ctx.track.width = this.buf.getUint16(start + 24);
                    this._ctx.track.height = this.buf.getUint16(start + 26);
                    this._parseBoxes(start + 78, end, type);
                }
                break;
            }
            case 'mp4a': case 'opus': case 'ac-3': case 'ec-3': case 'Opus': {
                if (this._ctx.track) {
                    this._ctx.track.codec = type === 'mp4a' ? 'mp4a' : type;
                    this._ctx.track.channelCount = this.buf.getUint16(start + 16);
                    this._ctx.track.sampleRate = this.buf.getUint32(start + 24) >>> 16;
                    this._parseBoxes(start + 28, end, type);
                }
                break;
            }
            case 'avcC': case 'hvcC': case 'av1C': case 'vpcC': case 'dOps': case 'esds': {
                if (this._ctx.track) this._ctx.track.extradata = this.raw.subarray(start, end);
                break;
            }
            case 'stsd': this._parseBoxes(start + 8, end, 'stsd'); break;
            case 'stts': this._parseStts(start); break;
            case 'ctts': this._parseCtts(start); break;
            case 'stsc': this._parseStsc(start); break;
            case 'stsz': this._parseStsz(start); break;
            case 'stco': case 'co64': this._parseStco(start, type === 'co64'); break;
            case 'stss': this._parseStss(start); break;
        }
        if (type === 'stss') {
            if (this._ctx.track && this._ctx.track.samples && this._tmpKeyFrames.size > 0) {
                for (let i = 0; i < this._ctx.track.samples.length; i++) {
                    this._ctx.track.samples[i].isKey = this._tmpKeyFrames.has(i + 1);
                }
                this._tmpKeyFrames.clear();
            }
        }
        if (type === 'stco' || type === 'co64') { this._finalizeSamples(); }
    }

    private _tmpStts: { count: number; delta: number }[] = [];
    private _tmpCtts: { count: number; offset: number }[] = [];
    private _tmpSizes: number[] = [];
    private _tmpChunkMap: { firstChunk: number; samplesPerChunk: number; sdIndex: number }[] = [];
    private _tmpChunkOffsets: number[] = [];
    private _tmpKeyFrames: Set<number> = new Set();

    private _parseStts(s: number): void {
        const n = Math.min(this.buf.getUint32(s + 4), Math.floor((this.raw.byteLength - s - 8) / 8));
        this._tmpStts = [];
        for (let i = 0; i < n; i++) this._tmpStts.push({ count: this.buf.getUint32(s + 8 + i * 8), delta: this.buf.getUint32(s + 12 + i * 8) });
    }
    private _parseCtts(s: number): void {
        const ver = this.buf.getUint8(s);
        const n = Math.min(this.buf.getUint32(s + 4), Math.floor((this.raw.byteLength - s - 8) / 8));
        this._tmpCtts = [];
        for (let i = 0; i < n; i++) this._tmpCtts.push({ count: this.buf.getUint32(s + 8 + i * 8), offset: ver === 1 ? this.buf.getInt32(s + 12 + i * 8) : this.buf.getUint32(s + 12 + i * 8) });
    }
    private _parseStsc(s: number): void {
        const n = Math.min(this.buf.getUint32(s + 4), Math.floor((this.raw.byteLength - s - 8) / 12));
        this._tmpChunkMap = [];
        for (let i = 0; i < n; i++) this._tmpChunkMap.push({
            firstChunk: this.buf.getUint32(s + 8 + i * 12),
            samplesPerChunk: this.buf.getUint32(s + 12 + i * 12),
            sdIndex: this.buf.getUint32(s + 16 + i * 12)
        });
    }
    private _parseStsz(s: number): void {
        const defaultSize = this.buf.getUint32(s + 4);
        const n = Math.min(this.buf.getUint32(s + 8), Math.floor((this.raw.byteLength - s - 12) / 4));
        this._tmpSizes = [];
        if (defaultSize > 0) { for (let i = 0; i < n; i++) this._tmpSizes.push(defaultSize); }
        else { for (let i = 0; i < n; i++) this._tmpSizes.push(this.buf.getUint32(s + 12 + i * 4)); }
    }
    private _parseStco(s: number, co64: boolean): void {
        const itemSize = co64 ? 8 : 4;
        const n = Math.min(this.buf.getUint32(s + 4), Math.floor((this.raw.byteLength - s - 8) / itemSize));
        this._tmpChunkOffsets = [];
        for (let i = 0; i < n; i++) {
            this._tmpChunkOffsets.push(co64
                ? Number(this.buf.getBigUint64(s + 8 + i * 8))
                : this.buf.getUint32(s + 8 + i * 4));
        }
    }
    private _parseStss(s: number): void {
        const n = Math.min(this.buf.getUint32(s + 4), Math.floor((this.raw.byteLength - s - 8) / 4));
        this._tmpKeyFrames.clear();
        for (let i = 0; i < n; i++) this._tmpKeyFrames.add(this.buf.getUint32(s + 8 + i * 4));
    }

    private _sttsLookup(sampleIdx: number): { dts: number; delta: number } {
        let dts = 0, idx = 0;
        for (const e of this._tmpStts) {
            if (sampleIdx < idx + e.count) {
                dts += (sampleIdx - idx) * e.delta;
                return { dts, delta: e.delta };
            }
            dts += e.count * e.delta;
            idx += e.count;
        }
        return { dts, delta: this._tmpStts.length > 0 ? this._tmpStts[this._tmpStts.length - 1].delta : 0 };
    }

    private _cttsLookup(sampleIdx: number): number {
        if (this._tmpCtts.length === 0) return 0;
        let idx = 0;
        for (const e of this._tmpCtts) {
            if (sampleIdx < idx + e.count) return e.offset;
            idx += e.count;
        }
        return 0;
    }

    private _finalizeSamples(): void {
        if (!this._ctx.track || !this._tmpSizes.length || !this._tmpChunkOffsets.length) return;
        const samples: MP4Sample[] = [];
        const ts = this._ctx.track.timescale ?? 90000;
        let sampleIdx = 0;

        for (let ci = 0; ci < this._tmpChunkOffsets.length; ci++) {
            const chunkNum = ci + 1;
            let spc = this._tmpChunkMap[0]?.samplesPerChunk ?? 1;
            for (let mi = 0; mi < this._tmpChunkMap.length; mi++) {
                if (chunkNum >= this._tmpChunkMap[mi].firstChunk) spc = this._tmpChunkMap[mi].samplesPerChunk;
                else break;
            }
            let off = this._tmpChunkOffsets[ci];
            for (let si = 0; si < spc && sampleIdx < this._tmpSizes.length; si++) {
                const sz = this._tmpSizes[sampleIdx];
                const { dts: rawDts, delta } = this._sttsLookup(sampleIdx);
                const cts = this._cttsLookup(sampleIdx);
                samples.push({
                    offset: off, size: sz,
                    dts: rawDts, pts: rawDts + cts,
                    duration: delta,
                    isKey: !this._tmpKeyFrames.size || this._tmpKeyFrames.has(sampleIdx + 1)
                });
                off += sz; sampleIdx++;
            }
        }
        this._ctx.track.samples = samples;
        const existing = this.tracks.findIndex(t => t.id === this._ctx.track!.id);
        if (existing >= 0) this.tracks[existing] = this._ctx.track as MP4Track;
        else this.tracks.push(this._ctx.track as MP4Track);
        this._tmpStts = []; this._tmpCtts = []; this._tmpSizes = []; this._tmpChunkMap = []; this._tmpChunkOffsets = [];
    }

    public async decode(track: MP4Track, raw: ArrayBuffer): Promise<VideoFrame[]> {
        const results: VideoFrame[] = [];
        if (track.type !== 'video') return results;
        const init: VideoDecoderConfig = {
            codec: this._mapCodec(track),
            codedWidth: track.width ?? 0,
            codedHeight: track.height ?? 0,
            description: track.extradata
        };
        const dec = new VideoDecoder({
            output: f => results.push(f),
            error: e => log.error('[MP4Demuxer] Decode error', e as Error)
        });
        try {
            dec.configure(init);
            const src = new Uint8Array(raw);
            for (const s of track.samples) {
                if (s.offset + s.size > src.length) continue;
                const chunk = new EncodedVideoChunk({
                    type: s.isKey ? 'key' : 'delta',
                    timestamp: Math.round(s.pts / track.timescale * 1e6),
                    duration: Math.round(s.duration / track.timescale * 1e6),
                    data: src.subarray(s.offset, s.offset + s.size)
                });
                dec.decode(chunk);
            }
            await dec.flush();
        } catch (e) {
            log.warn('[MP4Demuxer] Decode failed — closing partial results', e);
            for (const f of results) { try { f.close(); } catch (_) { } }
            results.length = 0;
        } finally {
            try { dec.close(); } catch (_) { }
        }
        return results;
    }

    private _mapCodec(track: MP4Track): string {
        const c = track.codec;
        const ed = track.extradata;
        if (c === 'avc1' && ed && ed.length >= 4) {
            const profile = ed[1], compat = ed[2], level = ed[3];
            return `avc1.${profile.toString(16).padStart(2, '0')}${compat.toString(16).padStart(2, '0')}${level.toString(16).padStart(2, '0')}`;
        }
        if ((c === 'hev1' || c === 'hvc1') && ed && ed.length >= 4) {
            const generalProfileSpace = (ed[1] >> 6) & 0x03;
            const generalTierFlag = (ed[1] >> 5) & 0x01;
            const generalProfileIdc = ed[1] & 0x1F;
            const generalLevelIdc = ed.length >= 13 ? ed[12] : 93;
            const spaceChar = ['', 'A', 'B', 'C'][generalProfileSpace];
            return `${c}.${spaceChar}${generalProfileIdc}.${generalTierFlag ? 'H' : 'L'}${generalLevelIdc}`;
        }
        if (c === 'av01' && ed && ed.length >= 4) {
            const seqProfile = (ed[1] >> 5) & 0x07;
            const seqLevelIdx = ed[1] & 0x1F;
            const highBitdepth = (ed[2] >> 6) & 0x01;
            const bitDepth = seqProfile === 2 && highBitdepth ? (((ed[2] >> 5) & 0x01) ? 12 : 10) : (highBitdepth ? 10 : 8);
            return `av01.${seqProfile}.${String(seqLevelIdx).padStart(2, '0')}M.${String(bitDepth).padStart(2, '0')}`;
        }
        if (c === 'vp09' && ed && ed.length >= 4) {
            return `vp09.${String(ed[0]).padStart(2, '0')}.${String(ed[1]).padStart(2, '0')}.${String(ed[2]).padStart(2, '0')}`;
        }
        if (c === 'avc1') return 'avc1.42E01E';
        if (c === 'hev1' || c === 'hvc1') return 'hev1.1.6.L93.B0';
        if (c === 'av01') return 'av01.0.08M.08';
        if (c === 'vp09') return 'vp09.00.10.08';
        return c;
    }

    private _fourcc(pos: number): string {
        return String.fromCharCode(
            this.buf.getUint8(pos), this.buf.getUint8(pos + 1),
            this.buf.getUint8(pos + 2), this.buf.getUint8(pos + 3)
        );
    }

    

    private _source: Blob | null = null;

    public static async fromBlob(blob: Blob): Promise<MP4Demuxer> {
        const PROBE_SIZE = 64 * 1024;
        const headerBuf = await blob.slice(0, Math.min(PROBE_SIZE, blob.size)).arrayBuffer();
        const headerView = new DataView(headerBuf);

        let moovOffset = -1;
        let moovSize = 0;
        let pos = 0;
        while (pos < headerBuf.byteLength - 8) {
            let size = headerView.getUint32(pos);
            const type = String.fromCharCode(
                headerView.getUint8(pos + 4), headerView.getUint8(pos + 5),
                headerView.getUint8(pos + 6), headerView.getUint8(pos + 7)
            );
            if (size === 1 && pos + 16 <= headerBuf.byteLength) {
                size = Number(headerView.getBigUint64(pos + 8));
            } else if (size === 0) {
                size = blob.size - pos;
            }
            if (size < 8) break;
            if (type === 'moov') { moovOffset = pos; moovSize = size; break; }
            pos += size;
            if (pos > headerBuf.byteLength) break;
        }

        if (moovOffset < 0 && blob.size > PROBE_SIZE) {
            const tailSize = Math.min(blob.size, 4 * 1024 * 1024);
            const tailStart = blob.size - tailSize;
            const tailBuf = await blob.slice(tailStart, blob.size).arrayBuffer();
            const tailView = new DataView(tailBuf);
            pos = 0;
            while (pos < tailBuf.byteLength - 8) {
                let size = tailView.getUint32(pos);
                const type = String.fromCharCode(
                    tailView.getUint8(pos + 4), tailView.getUint8(pos + 5),
                    tailView.getUint8(pos + 6), tailView.getUint8(pos + 7)
                );
                if (size === 1 && pos + 16 <= tailBuf.byteLength) {
                    size = Number(tailView.getBigUint64(pos + 8));
                } else if (size === 0) {
                    size = tailBuf.byteLength - pos;
                }
                if (size < 8) break;
                if (type === 'moov') {
                    moovOffset = tailStart + pos;
                    moovSize = size;
                    break;
                }
                pos += size;
            }
        }

        if (moovOffset < 0) {
            log.warn('[MP4Demuxer] moov box not found — falling back to full load');
            const full = await blob.arrayBuffer();
            const demuxer = new MP4Demuxer(full);
            demuxer._source = blob;
            demuxer.parse();
            return demuxer;
        }

        const moovBuf = await blob.slice(moovOffset, moovOffset + moovSize).arrayBuffer();
        const demuxer = new MP4Demuxer(moovBuf);
        demuxer._source = blob;
        demuxer.parse();
        log.info(`[MP4Demuxer] Streaming: parsed ${(moovSize / 1024).toFixed(0)}KB moov from ${(blob.size / (1024 * 1024)).toFixed(1)}MB file`);
        return demuxer;
    }

    public async readSample(sample: MP4Sample): Promise<Uint8Array> {
        if (!this._source) throw new Error('[MP4Demuxer] No source — use fromBlob() for streaming mode');
        const buf = await this._source.slice(sample.offset, sample.offset + sample.size).arrayBuffer();
        return new Uint8Array(buf);
    }

    public async readSamples(samples: MP4Sample[]): Promise<Uint8Array[]> {
        if (!this._source) throw new Error('[MP4Demuxer] No source — use fromBlob() for streaming mode');
        const results: Uint8Array[] = [];
        let batchStart = samples[0]?.offset ?? 0;
        let batchEnd = batchStart;
        for (const s of samples) batchEnd = Math.max(batchEnd, s.offset + s.size);
        const batchSize = batchEnd - batchStart;
        if (batchSize < 16 * 1024 * 1024) {
            const buf = await this._source.slice(batchStart, batchEnd).arrayBuffer();
            const view = new Uint8Array(buf);
            for (const s of samples) {
                results.push(view.slice(s.offset - batchStart, s.offset - batchStart + s.size));
            }
        } else {
            for (const s of samples) {
                results.push(await this.readSample(s));
            }
        }
        return results;
    }
}
