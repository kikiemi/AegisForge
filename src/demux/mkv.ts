import { log } from '../core';

export interface MKVTrackInfo {
    number: number;
    uid: number;
    type: 'video' | 'audio' | 'subtitle' | 'other';
    codecId: string;
    codecPrivate?: Uint8Array;
    width?: number;
    height?: number;
    sampleRate?: number;
    channels?: number;
    bitDepth?: number;
    defaultDuration?: number;
    language?: string;
}

export interface MKVFrame {
    trackNumber: number;
    pts: number;
    duration: number;
    isKey: boolean;
    data: Uint8Array;
    discardable: boolean;
}

const EBML_ID_EBML = 0x1A45DFA3;
const EBML_ID_SEGMENT = 0x18538067;
const EBML_ID_INFO = 0x1549A966;
const EBML_ID_TIMECODE_SCALE = 0x2AD7B1;
const EBML_ID_DURATION = 0x4489;
const EBML_ID_TRACKS = 0x1654AE6B;
const EBML_ID_TRACK_ENTRY = 0xAE;
const EBML_ID_TRACK_NUMBER = 0xD7;
const EBML_ID_TRACK_UID = 0x73C5;
const EBML_ID_TRACK_TYPE = 0x83;
const EBML_ID_CODEC_ID = 0x86;
const EBML_ID_CODEC_PRIVATE = 0x63A2;
const EBML_ID_VIDEO = 0xE0;
const EBML_ID_PIXEL_WIDTH = 0xB0;
const EBML_ID_PIXEL_HEIGHT = 0xBA;
const EBML_ID_AUDIO = 0xE1;
const EBML_ID_SAMPLE_RATE = 0xB5;
const EBML_ID_CHANNELS = 0x9F;
const EBML_ID_BIT_DEPTH = 0x6264;
const EBML_ID_DEFAULT_DURATION = 0x23E383;
const EBML_ID_LANGUAGE = 0x22B59C;
const EBML_ID_CLUSTER = 0x1F43B675;
const EBML_ID_CLUSTER_TIMECODE = 0xE7;
const EBML_ID_SIMPLE_BLOCK = 0xA3;
const EBML_ID_BLOCK_GROUP = 0xA0;
const EBML_ID_BLOCK = 0xA1;
const EBML_ID_BLOCK_DURATION = 0x9B;
const EBML_ID_CUES = 0x1C53BB6B;
const EBML_ID_SEEK_HEAD = 0x114D9B74;
const EBML_ID_CHAPTERS = 0x1043A770;
const EBML_ID_TAGS = 0x1254C367;
const EBML_ID_ATTACHMENTS = 0x1941A469;

const CONTAINER_IDS = new Set([
    EBML_ID_EBML, EBML_ID_SEGMENT, EBML_ID_INFO, EBML_ID_TRACKS,
    EBML_ID_TRACK_ENTRY, EBML_ID_VIDEO, EBML_ID_AUDIO,
    EBML_ID_CLUSTER, EBML_ID_BLOCK_GROUP, EBML_ID_SEEK_HEAD,
    EBML_ID_CUES, EBML_ID_CHAPTERS, EBML_ID_TAGS, EBML_ID_ATTACHMENTS
]);

export class MKVDemuxer {
    private buf: Uint8Array;
    private pos: number = 0;
    public tracks: Map<number, MKVTrackInfo> = new Map();
    public frames: MKVFrame[] = [];
    private timecodeScale: number = 1000000;
    private duration: number = 0;
    private clusterPts: number = 0;

    constructor(buffer: ArrayBuffer) {
        this.buf = new Uint8Array(buffer);
    }

    public parse(): void {
        this.pos = 0;
        try {
            while (this.pos < this.buf.length - 4) {
                this._parseTopLevel();
            }
        } catch (e) {
            log.warn('[MKVDemuxer] Parse error (possibly truncated file):', e);
        }
    }

    public *iterateClusters(): Generator<MKVFrame[]> {
        this.pos = 0;
        try {
            while (this.pos < this.buf.length - 4) {
                const prevCount = this.frames.length;
                this._parseTopLevel();
                if (this.frames.length > prevCount) {
                    yield this.frames.splice(prevCount);
                }
            }
        } catch (e) {
            log.warn('[MKVDemuxer] Parse error during iteration:', e);
        }
    }

    private _parseTopLevel(): void {
        const startPos = this.pos;
        const [id, idLen] = this._readElementId();
        if (idLen <= 0) { this.pos = this.buf.length; return; }
        const [size, szLen, isUnknown] = this._readVint();
        if (szLen <= 0 || size < 0) { this.pos = this.buf.length; return; }
        const dataStart = this.pos;
        const dataEnd = isUnknown ? this.buf.length : Math.min(dataStart + size, this.buf.length);

        if (CONTAINER_IDS.has(id)) {
            this._parseContainer(id, dataStart, dataEnd);
        } else {
            this._handleLeaf(id, dataStart, dataEnd);
            this.pos = dataEnd;
        }
    }

    private _parseContainer(id: number, start: number, end: number): void {
        if (id === EBML_ID_CLUSTER) {
            this._parseCluster(start, end);
            return;
        }
        this.pos = start;
        while (this.pos < end - 2) {
            const [childId, childIdLen] = this._readElementId();
            if (childIdLen <= 0) break;
            const [childSize, childSzLen, childUnknown] = this._readVint();
            if (childSzLen <= 0 || childSize < 0) break;
            const childStart = this.pos;
            const childEnd = childUnknown ? end : Math.min(childStart + childSize, end);
            if (CONTAINER_IDS.has(childId)) {
                this._parseContainer(childId, childStart, childEnd);
            } else {
                this._handleLeaf(childId, childStart, childEnd);
            }
            this.pos = childEnd;
        }
        if (id === EBML_ID_TRACK_ENTRY) this.finalizeTrack();
        this.pos = end;
    }

    private _currentTrack: Partial<MKVTrackInfo> = {};

    private _handleLeaf(id: number, start: number, end: number): void {
        const size = end - start;
        switch (id) {
            case EBML_ID_TIMECODE_SCALE:
                this.timecodeScale = this._readUintData(start, size);
                break;
            case EBML_ID_DURATION:
                this.duration = size === 4
                    ? new DataView(this.buf.buffer, this.buf.byteOffset + start, 4).getFloat32(0)
                    : size === 8
                        ? new DataView(this.buf.buffer, this.buf.byteOffset + start, 8).getFloat64(0)
                        : this._readUintData(start, size);
                break;
            case EBML_ID_TRACK_NUMBER:
                this._currentTrack.number = this._readUintData(start, size);
                break;
            case EBML_ID_TRACK_UID:
                this._currentTrack.uid = this._readUintData(start, size);
                break;
            case EBML_ID_TRACK_TYPE: {
                const t = this._readUintData(start, size);
                this._currentTrack.type = t === 1 ? 'video' : t === 2 ? 'audio' : t === 17 ? 'subtitle' : 'other';
                break;
            }
            case EBML_ID_CODEC_ID:
                this._currentTrack.codecId = new TextDecoder().decode(this.buf.subarray(start, end));
                break;
            case EBML_ID_CODEC_PRIVATE:
                this._currentTrack.codecPrivate = this.buf.subarray(start, end);
                break;
            case EBML_ID_PIXEL_WIDTH:
                this._currentTrack.width = this._readUintData(start, size);
                break;
            case EBML_ID_PIXEL_HEIGHT:
                this._currentTrack.height = this._readUintData(start, size);
                break;
            case EBML_ID_SAMPLE_RATE:
                this._currentTrack.sampleRate = size === 4
                    ? new DataView(this.buf.buffer, this.buf.byteOffset + start, 4).getFloat32(0)
                    : new DataView(this.buf.buffer, this.buf.byteOffset + start, 8).getFloat64(0);
                break;
            case EBML_ID_CHANNELS:
                this._currentTrack.channels = this._readUintData(start, size);
                break;
            case EBML_ID_BIT_DEPTH:
                this._currentTrack.bitDepth = this._readUintData(start, size);
                break;
            case EBML_ID_DEFAULT_DURATION:
                this._currentTrack.defaultDuration = this._readUintData(start, size);
                break;
            case EBML_ID_LANGUAGE:
                this._currentTrack.language = new TextDecoder().decode(this.buf.subarray(start, end));
                break;
        }
    }

    private _parseCluster(start: number, end: number): void {
        this.pos = start;
        while (this.pos < end - 2) {
            const [id, idLen] = this._readElementId();
            if (idLen <= 0) break;
            const [size, szLen, _unknown] = this._readVint();
            if (szLen <= 0 || size < 0) break;
            const dStart = this.pos;
            const dEnd = Math.min(dStart + size, end);
            switch (id) {
                case EBML_ID_CLUSTER_TIMECODE:
                    this.clusterPts = this._readUintData(dStart, size);
                    break;
                case EBML_ID_SIMPLE_BLOCK:
                    this._parseBlock(dStart, dEnd, true);
                    break;
                case EBML_ID_BLOCK_GROUP:
                    this._parseBlockGroup(dStart, dEnd);
                    break;
            }
            this.pos = dEnd;
        }
    }

    private _parseBlockGroup(start: number, end: number): void {
        this.pos = start;
        let blockStart = -1, blockEnd = -1, blockDuration = 0;
        while (this.pos < end - 2) {
            const [id, idLen] = this._readElementId();
            if (idLen <= 0) break;
            const [size, szLen, _unk2] = this._readVint();
            if (szLen <= 0) break;
            const dStart = this.pos;
            const dEnd = Math.min(dStart + size, end);
            if (id === EBML_ID_BLOCK) { blockStart = dStart; blockEnd = dEnd; }
            else if (id === EBML_ID_BLOCK_DURATION) blockDuration = this._readUintData(dStart, size);
            this.pos = dEnd;
        }
        if (blockStart >= 0) this._parseBlock(blockStart, blockEnd, false, blockDuration);
    }

    private _parseBlock(start: number, end: number, isSimple: boolean, forceDuration: number = 0): void {
        if (start >= end - 3) return;
        this.pos = start;
        const [trackNum, tLen] = this._readVintAt(start, false);
        if (tLen <= 0 || this.pos + 2 >= end) return;
        const relTs = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 2).getInt16(0);
        this.pos += 2;
        const flags = this.buf[this.pos++];
        const isKey = isSimple ? (flags & 0x80) !== 0 : false;
        const discardable = (flags & 0x01) !== 0;
        const lacing = (flags >> 1) & 0x03;
        const dataStart = this.pos;
        if (dataStart >= end) return;
        const pts = (this.clusterPts + relTs) * this.timecodeScale / 1_000_000_000;
        const track = this.tracks.get(trackNum);
        const defaultDur = track?.defaultDuration
            ? track.defaultDuration / 1_000_000
            : forceDuration > 0 ? forceDuration * this.timecodeScale / 1_000_000 : 0;

        if (lacing === 0) {
            this.frames.push({
                trackNumber: trackNum, pts, duration: defaultDur,
                isKey, data: this.buf.subarray(dataStart, end), discardable
            });
        } else {
            this._parseLacedFrames(dataStart, end, lacing, trackNum, pts, defaultDur, isKey, discardable);
        }
    }

    private _parseLacedFrames(
        start: number, end: number, lacing: number,
        track: number, pts: number, dur: number, isKey: boolean, disc: boolean
    ): void {
        if (start >= end) return;
        const frameCount = this.buf[start] + 1;
        let pos = start + 1;
        const sizes: number[] = [];
        if (lacing === 1) {
            for (let i = 0; i < frameCount - 1 && pos < end; i++) {
                let sz = 0;
                while (pos < end && this.buf[pos] === 0xFF) { sz += 255; pos++; }
                if (pos < end) { sz += this.buf[pos++]; }
                sizes.push(sz);
            }
        } else if (lacing === 2) {
            const total = end - pos;
            const each = Math.floor(total / frameCount);
            for (let i = 0; i < frameCount - 1; i++) sizes.push(each);
        } else if (lacing === 3) {
            if (frameCount > 1) {
                const [first, fLen] = this._readVintAt(pos, false);
                pos += fLen;
                sizes.push(first);
                for (let i = 1; i < frameCount - 1; i++) {
                    const [delta, dLen] = this._readSignedVintAt(pos);
                    if (dLen <= 0) break;
                    pos += dLen;
                    sizes.push(sizes[i - 1] + delta);
                }
            }
        }
        let lastSize = end - pos;
        for (const s of sizes) lastSize -= s;
        sizes.push(Math.max(0, lastSize));
        const frameDur = dur > 0 ? dur / frameCount : 0;
        for (let i = 0; i < sizes.length && pos < end; i++) {
            const sz = Math.min(sizes[i], end - pos);
            if (sz > 0) {
                this.frames.push({
                    trackNumber: track, pts: pts + i * frameDur,
                    duration: frameDur, isKey: i === 0 && isKey,
                    data: this.buf.subarray(pos, pos + sz), discardable: disc
                });
            }
            pos += sz;
        }
    }

    public finalizeTrack(): void {
        if (this._currentTrack.number != null) {
            this.tracks.set(this._currentTrack.number, this._currentTrack as MKVTrackInfo);
        }
        this._currentTrack = {};
    }

    private _readElementId(): [number, number] {
        if (this.pos >= this.buf.length) return [0, -1];
        const b = this.buf[this.pos];
        if (b === 0) return [0, -1];
        let len = 1;
        if (b & 0x80) len = 1;
        else if (b & 0x40) len = 2;
        else if (b & 0x20) len = 3;
        else if (b & 0x10) len = 4;
        else return [0, -1];
        if (this.pos + len > this.buf.length) return [0, -1];
        let val = 0;
        for (let i = 0; i < len; i++) val = (val << 8) | this.buf[this.pos + i];
        this.pos += len;
        return [val, len];
    }

    private _readVint(): [number, number, boolean] {
        return this._readVintAt(this.pos, true);
    }

    private _readVintAt(pos: number, advance: boolean = false): [number, number, boolean] {
        if (pos >= this.buf.length) return [0, -1, false];
        const b = this.buf[pos];
        if (b === 0) return [0, -1, false];
        let mask = 0x80, len = 1;
        while (len <= 8 && !(b & mask)) { mask >>= 1; len++; }
        if (len > 8 || pos + len > this.buf.length) return [0, -1, false];
        let val = b & (mask - 1);
        for (let i = 1; i < len; i++) val = val * 256 + this.buf[pos + i];
        let isUnknown = true;
        const maxVal = (1 << (7 * len)) - 1;
        if (val !== maxVal) isUnknown = false;
        if (advance) this.pos = pos + len;
        return [isUnknown ? -1 : val, len, isUnknown];
    }

    private _readSignedVintAt(pos: number): [number, number] {
        const [raw, len] = this._readVintAt(pos);
        if (len <= 0) return [0, len];
        const bias = Math.pow(2, 7 * len - 1) - 1;
        return [raw - bias, len];
    }

    private _readUintData(pos: number, size: number): number {
        let v = 0;
        for (let i = 0; i < size && pos + i < this.buf.length; i++) v = v * 256 + this.buf[pos + i];
        return v;
    }

    public getVideoTracks(): MKVTrackInfo[] {
        return [...this.tracks.values()].filter(t => t.type === 'video');
    }

    public getAudioTracks(): MKVTrackInfo[] {
        return [...this.tracks.values()].filter(t => t.type === 'audio');
    }

    public getFramesForTrack(trackNumber: number): MKVFrame[] {
        return this.frames.filter(f => f.trackNumber === trackNumber);
    }

    

    private _clusterOffsets: { offset: number; size: number }[] = [];
    private _source: Blob | null = null;

    public static async fromBlob(blob: Blob): Promise<MKVDemuxer> {
        const HEADER_PROBE = 256 * 1024;
        const probeBuf = await blob.slice(0, Math.min(HEADER_PROBE, blob.size)).arrayBuffer();
        const demuxer = new MKVDemuxer(probeBuf);
        demuxer._source = blob;
        demuxer.pos = 0;

        try {
            while (demuxer.pos < demuxer.buf.length - 4) {
                const elementStart = demuxer.pos;
                const [id, idLen] = demuxer._readElementId();
                if (idLen <= 0) break;
                const [size, szLen, isUnknown] = demuxer._readVint();
                if (szLen <= 0 || size < 0) break;
                const dataStart = demuxer.pos;

                if (id === EBML_ID_CLUSTER) {
                    const clusterSize = isUnknown ? (blob.size - elementStart) : (dataStart - elementStart + size);
                    demuxer._clusterOffsets.push({ offset: elementStart, size: clusterSize });
                    demuxer.pos = isUnknown ? demuxer.buf.length : Math.min(dataStart + size, demuxer.buf.length);
                    while (demuxer.pos < demuxer.buf.length - 4) {
                        const cStart = demuxer.pos;
                        const [cId, cIdLen] = demuxer._readElementId();
                        if (cIdLen <= 0) break;
                        const [cSize, cSzLen, cUnk] = demuxer._readVint();
                        if (cSzLen <= 0) break;
                        if (cId === EBML_ID_CLUSTER) {
                            const cFullSize = cUnk ? (blob.size - cStart) : (demuxer.pos - cStart + cSize);
                            demuxer._clusterOffsets.push({ offset: cStart, size: cFullSize });
                        }
                        demuxer.pos = cUnk ? demuxer.buf.length : Math.min(demuxer.pos + cSize, demuxer.buf.length);
                    }
                    break;
                } else if (CONTAINER_IDS.has(id) && id !== EBML_ID_CLUSTER) {
                    demuxer._parseContainer(id, dataStart, isUnknown ? demuxer.buf.length : Math.min(dataStart + size, demuxer.buf.length));
                } else {
                    demuxer.pos = isUnknown ? demuxer.buf.length : Math.min(dataStart + size, demuxer.buf.length);
                }
            }
        } catch (e) {
            log.warn('[MKVDemuxer] Header parse error:', e);
        }

        if (demuxer._clusterOffsets.length === 0 && blob.size > HEADER_PROBE) {
            log.warn('[MKVDemuxer] No clusters found in probe — need full scan');
            const fullBuf = await blob.arrayBuffer();
            const full = new MKVDemuxer(fullBuf);
            full._source = blob;
            full.parse();
            return full;
        }

        log.info(`[MKVDemuxer] Streaming: ${demuxer.tracks.size} tracks, ${demuxer._clusterOffsets.length} clusters from ${(blob.size / (1024 * 1024)).toFixed(1)}MB file`);
        return demuxer;
    }

    public async *iterateClustersFromBlob(): AsyncGenerator<MKVFrame[]> {
        if (!this._source) throw new Error('[MKVDemuxer] No source — use fromBlob() for streaming mode');

        for (const entry of this._clusterOffsets) {
            const clusterBuf = await this._source.slice(entry.offset, entry.offset + entry.size).arrayBuffer();
            const clusterParser = new MKVDemuxer(clusterBuf);
            clusterParser.tracks = this.tracks;
            clusterParser.timecodeScale = this.timecodeScale;
            clusterParser.pos = 0;
            try {
                clusterParser._parseTopLevel();
            } catch (e) {
                log.warn('[MKVDemuxer] Cluster parse error:', e);
            }
            if (clusterParser.frames.length > 0) {
                yield clusterParser.frames;
            }
        }

        if (this._source.size > 256 * 1024 && this._clusterOffsets.length > 0) {
            const lastCluster = this._clusterOffsets[this._clusterOffsets.length - 1];
            const scannedEnd = lastCluster.offset + lastCluster.size;
            if (scannedEnd < this._source.size - 1024) {
                const remainBuf = await this._source.slice(scannedEnd, this._source.size).arrayBuffer();
                const remain = new MKVDemuxer(remainBuf);
                remain.tracks = this.tracks;
                remain.timecodeScale = this.timecodeScale;
                for (const frames of remain.iterateClusters()) {
                    yield frames;
                }
            }
        }
    }
}
