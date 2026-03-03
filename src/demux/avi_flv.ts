export interface StreamFrame {
    type: 'video' | 'audio';
    pts: number;
    dts: number;
    isKey: boolean;
    data: Uint8Array;
    codec: string;
}

export interface StreamDemuxResult {
    frames: StreamFrame[];
    videoCodec: string;
    audioCodec: string;
    width: number;
    height: number;
    fps: number;
    sampleRate: number;
    channels: number;
    duration: number;
    errors: number;
}

export class StreamingAVIDemuxer {
    private result: StreamDemuxResult;
    private moviBase: number = 0;
    private streamInfo: { type: 'video' | 'audio'; codec: string; scale: number; rate: number }[] = [];

    constructor() {
        this.result = this._empty();
    }

    public parse(buffer: ArrayBuffer): StreamDemuxResult {
        const buf = new Uint8Array(buffer);
        const view = new DataView(buffer);
        this.result = this._empty();
        let pos = 0;
        if (buf.length < 12) return this.result;
        const magic = this._str4(buf, 0);
        if (magic !== 'RIFF') return this.result;
        const fileType = this._str4(buf, 8);
        if (fileType !== 'AVI ') return this.result;
        try {
            pos = 12;
            pos = this._parseAVIList(buf, view, pos, Math.min(view.getUint32(4, true) + 8, buf.length));
        } catch (_) { this.result.errors++; }
        return this.result;
    }

    private _parseAVIList(buf: Uint8Array, view: DataView, start: number, end: number): number {
        let pos = start;
        while (pos < end - 8) {
            const id = this._str4(buf, pos);
            if (pos + 4 >= end) break;
            const size = view.getUint32(pos + 4, true);
            if (size === 0) { pos += 8; continue; }
            if (pos + 8 + size > end + 256) break;
            const chunkEnd = Math.min(pos + 8 + size, end);
            if (id === 'LIST') {
                const listType = this._str4(buf, pos + 8);
                if (listType === 'hdrl' || listType === 'strl') {
                    this._parseAVIList(buf, view, pos + 12, chunkEnd);
                } else if (listType === 'movi') {
                    this.moviBase = pos + 12;
                    this._extractMoviFrames(buf, view, pos + 12, chunkEnd);
                }
            } else {
                this._handleAVIChunk(buf, view, id, pos + 8, size);
            }
            pos = chunkEnd + (size & 1);
        }
        return pos;
    }

    private _currentStreamIdx: number = -1;

    private _handleAVIChunk(buf: Uint8Array, view: DataView, id: string, offset: number, size: number): void {
        if (id === 'strh' && offset + 28 <= buf.length) {
            const fccType = this._str4(buf, offset);
            const codec = this._str4(buf, offset + 4);
            const scale = view.getUint32(offset + 20, true);
            const rate = view.getUint32(offset + 24, true);
            const type: 'video' | 'audio' = fccType === 'vids' ? 'video' : 'audio';
            this.streamInfo.push({ type, codec, scale, rate });
            this._currentStreamIdx = this.streamInfo.length - 1;
            if (type === 'video') {
                this.result.videoCodec = codec;
                this.result.fps = scale > 0 ? rate / scale : 30;
            } else {
                this.result.audioCodec = codec;
            }
        } else if (id === 'strf') {
            const si = this.streamInfo[this._currentStreamIdx];
            if (si?.type === 'video' && offset + 12 <= buf.length) {
                this.result.width = view.getUint32(offset + 4, true);
                this.result.height = Math.abs(view.getInt32(offset + 8, true));
            } else if (si?.type === 'audio' && offset + 14 <= buf.length) {
                this.result.channels = view.getUint16(offset + 2, true);
                this.result.sampleRate = view.getUint32(offset + 4, true);
            }
        }
    }

    private _extractMoviFrames(buf: Uint8Array, view: DataView, start: number, end: number): void {
        let pos = start;
        const videoFrameCounts: Map<number, number> = new Map();
        while (pos < end - 8) {
            const id = this._str4(buf, pos);
            const size = view.getUint32(pos + 4, true);
            if (size === 0 || pos + 8 + size > end + 4) { pos += 8; this.result.errors++; continue; }
            if (id === 'LIST') { pos += 12; continue; }
            const streamIdx = parseInt(id.substring(0, 2), 10);
            const chunkType = id.substring(2, 4);
            if (!isNaN(streamIdx) && streamIdx < this.streamInfo.length) {
                const si = this.streamInfo[streamIdx];
                const isVideo = chunkType === 'dc' || chunkType === 'db';
                const isAudio = chunkType === 'wb';
                if ((isVideo || isAudio) && pos + 8 + size <= buf.length) {
                    const trackFrameCount = videoFrameCounts.get(streamIdx) || 0;
                    const pts = si.scale > 0 ? trackFrameCount * si.scale / si.rate : trackFrameCount / 30;
                    const isKey = chunkType === 'db' || (isVideo && trackFrameCount === 0);
                    this.result.frames.push({
                        type: si.type,
                        pts, dts: pts,
                        isKey,
                        data: buf.subarray(pos + 8, pos + 8 + size),
                        codec: si.codec
                    });
                    if (isVideo) videoFrameCounts.set(streamIdx, trackFrameCount + 1);
                }
            }
            pos += 8 + size + (size & 1);
        }
    }

    private _str4(buf: Uint8Array, pos: number): string {
        if (pos + 4 > buf.length) return '';
        return String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]);
    }

    private _empty(): StreamDemuxResult {
        return {
            frames: [], videoCodec: '', audioCodec: '',
            width: 0, height: 0, fps: 0,
            sampleRate: 0, channels: 0, duration: 0, errors: 0
        };
    }
}

export class StreamingFLVDemuxer {
    public parse(buffer: ArrayBuffer): StreamDemuxResult {
        const buf = new Uint8Array(buffer);
        const view = new DataView(buffer);
        const result: StreamDemuxResult = {
            frames: [], videoCodec: '', audioCodec: '',
            width: 0, height: 0, fps: 0,
            sampleRate: 0, channels: 0, duration: 0, errors: 0
        };
        if (buf.length < 13 || buf[0] !== 0x46 || buf[1] !== 0x4C || buf[2] !== 0x56) return result;
        const headerSize = view.getUint32(5);
        let pos = headerSize;
        while (pos < buf.length - 15) {
            pos += 4;
            if (pos + 11 > buf.length) break;
            const tagType = buf[pos];
            const dataSize = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
            const ts = ((buf[pos + 7] << 24) | (buf[pos + 4] << 16) | (buf[pos + 5] << 8) | buf[pos + 6]) >>> 0;
            const dataStart = pos + 11;
            if (dataStart + dataSize > buf.length) { result.errors++; break; }
            try {
                if (tagType === 9 && dataSize > 5) {
                    const frameType = (buf[dataStart] >> 4) & 0x0F;
                    const codecId = buf[dataStart] & 0x0F;
                    result.videoCodec = codecId === 7 ? 'H.264' : codecId === 2 ? 'H.263' : 'FLV' + codecId;
                    let cts = 0;
                    if (codecId === 7 && dataSize > 5) {
                        const avcType = buf[dataStart + 1];
                        cts = ((buf[dataStart + 2] << 16) | (buf[dataStart + 3] << 8) | buf[dataStart + 4]);
                        if (cts & 0x800000) cts -= 0x1000000;
                        if (avcType === 0) { pos = dataStart + dataSize; continue; }
                    }
                    result.frames.push({
                        type: 'video', pts: ts + cts, dts: ts,
                        isKey: frameType === 1,
                        data: buf.subarray(codecId === 7 ? dataStart + 5 : dataStart + 1, dataStart + dataSize),
                        codec: result.videoCodec
                    });
                } else if (tagType === 8 && dataSize > 2) {
                    const audioCodecId = (buf[dataStart] >> 4) & 0x0F;
                    result.audioCodec = audioCodecId === 10 ? 'AAC' : audioCodecId === 2 ? 'MP3' : 'FLV_A' + audioCodecId;
                    const rates = [5500, 11025, 22050, 44100];
                    result.sampleRate = rates[(buf[dataStart] >> 2) & 0x03] || 44100;
                    result.channels = (buf[dataStart] & 0x01) + 1;
                    if (audioCodecId === 10) {
                        if (buf[dataStart + 1] === 0) { pos = dataStart + dataSize; continue; }
                        result.frames.push({
                            type: 'audio', pts: ts, dts: ts, isKey: true,
                            data: buf.subarray(dataStart + 2, dataStart + dataSize),
                            codec: result.audioCodec
                        });
                    } else {
                        result.frames.push({
                            type: 'audio', pts: ts, dts: ts, isKey: true,
                            data: buf.subarray(dataStart + 1, dataStart + dataSize),
                            codec: result.audioCodec
                        });
                    }
                }
            } catch (_) { result.errors++; }
            pos = dataStart + dataSize;
        }
        if (result.frames.length > 0) {
            const last = result.frames[result.frames.length - 1];
            result.duration = Math.max(last.pts, last.dts) / 1000;
        }
        return result;
    }
}
