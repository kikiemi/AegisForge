import { log } from '../core';

export interface AVITrack {
    id: number;
    type: 'video' | 'audio';
    codec: string;
    width?: number;
    height?: number;
    sampleRate?: number;
    channelCount?: number;
    bitsPerSample?: number;
    scale: number;
    rate: number;
    samples: AVISample[];
    extradata?: Uint8Array;
}

export interface AVISample {
    offset: number;
    size: number;
    isKey: boolean;
    pts: number;
    duration: number;
}

export class AVIDemuxer {
    private buf: DataView;
    private raw: Uint8Array;
    public tracks: AVITrack[] = [];
    private _streams: Partial<AVITrack>[] = [];
    private _moviStart: number = -1;

    constructor(buffer: ArrayBuffer) {
        this.raw = new Uint8Array(buffer);
        this.buf = new DataView(buffer);
    }

    public parse(): void {
        try {
            const sig = this._fourcc(0);
            if (sig !== 'RIFF') return;
            const fileSize = this.buf.getUint32(4, true);
            const fileType = this._fourcc(8);
            if (fileType !== 'AVI ') return;
            this._parseList(12, Math.min(fileSize + 8, this.buf.byteLength));
        } catch (e) {
            log.warn('[AVIDemuxer] Parse error (possibly truncated file):', e);
        }
    }

    private _parseList(start: number, end: number): void {
        let pos = start;
        while (pos < end - 8) {
            const id = this._fourcc(pos);
            const size = this.buf.getUint32(pos + 4, true);
            if (size === 0 || pos + 8 + size > end) break;
            if (id === 'LIST' || id === 'RIFF') {
                const listType = this._fourcc(pos + 8);
                if (listType === 'hdrl' || listType === 'strl' || listType === 'movi' || listType === 'odml') {
                    if (listType === 'strl') this._streams.push({ samples: [], type: 'video' });
                    if (listType === 'movi') this._moviStart = pos + 12;
                    this._parseList(pos + 12, pos + 8 + size);
                }
            } else {
                this._handleChunk(id, pos + 8, size);
            }
            pos += 8 + size + (size & 1);
        }
    }

    private _handleChunk(id: string, offset: number, size: number): void {
        const cur = this._streams.length > 0 ? this._streams[this._streams.length - 1] : null;
        switch (id) {
            case 'avih': break;
            case 'strh': {
                if (!cur) break;
                const fccType = this._fourcc(offset);
                cur.type = fccType === 'vids' ? 'video' : 'audio';
                cur.codec = this._fourcc(offset + 4);
                cur.scale = this.buf.getUint32(offset + 20, true);
                cur.rate = this.buf.getUint32(offset + 24, true);
                break;
            }
            case 'strf': {
                if (!cur) break;
                if (cur.type === 'video') {
                    cur.width = this.buf.getUint32(offset + 4, true);
                    cur.height = Math.abs(this.buf.getInt32(offset + 8, true));
                    if (size > 40) cur.extradata = this.raw.subarray(offset + 40, offset + size);
                } else if (cur.type === 'audio') {
                    cur.channelCount = this.buf.getUint16(offset + 2, true);
                    cur.sampleRate = this.buf.getUint32(offset + 4, true);
                    cur.bitsPerSample = this.buf.getUint16(offset + 14, true);
                    if (size > 18) cur.extradata = this.raw.subarray(offset + 18, offset + size);
                }
                break;
            }
            case 'idx1': {
                this._parseIdx1(offset, size);
                break;
            }
            case 'indx': {
                this._parseSuperIndex(offset, size);
                break;
            }
        }
    }

    private _parseIdx1(offset: number, size: number): void {
        const entryCount = size / 16;
        const streamSamples: Map<number, AVISample[]> = new Map();

        const moviOffset = this._moviStart >= 0 ? this._moviStart : 0;

        let useAbsolute = false;
        if (entryCount > 0 && moviOffset > 0) {
            const firstOffset = this.buf.getUint32(offset + 8, true);
            if (firstOffset >= moviOffset) {
                useAbsolute = true;
            }
        }

        for (let i = 0; i < entryCount; i++) {
            const pos = offset + i * 16;
            if (pos + 16 > this.buf.byteLength) break;
            const chunkId = this._fourcc(pos);
            const streamIdx = parseInt(chunkId.substring(0, 2), 10);
            if (isNaN(streamIdx)) continue;
            const flags = this.buf.getUint32(pos + 4, true);
            const chunkOffset = this.buf.getUint32(pos + 8, true);
            const chunkSize = this.buf.getUint32(pos + 12, true);
            const isKey = (flags & 0x10) !== 0;
            if (!streamSamples.has(streamIdx)) streamSamples.set(streamIdx, []);
            const list = streamSamples.get(streamIdx)!;
            const stream = this._streams[streamIdx];
            const rate = stream?.rate || 1;
            const scale = stream?.scale || 1;
            const pts = list.length * scale / rate;

            const sampleOffset = useAbsolute ? chunkOffset + 8 : moviOffset + chunkOffset + 8;

            list.push({
                offset: sampleOffset,
                size: chunkSize,
                isKey,
                pts,
                duration: scale / rate
            });
        }
        for (const [idx, samples] of streamSamples) {
            if (idx < this._streams.length) {
                const s = this._streams[idx];
                s.samples = samples;
                s.id = idx;
                this.tracks.push(s as AVITrack);
            }
        }
    }

    private _parseSuperIndex(offset: number, size: number): void {
        if (offset + 24 > this.buf.byteLength) return;
        const longsPerEntry = this.buf.getUint16(offset, true);
        const indexSubType = this.buf.getUint8(offset + 2);
        const indexType = this.buf.getUint8(offset + 3);
        const entriesInUse = this.buf.getUint32(offset + 4, true);
        const chunkId = this._fourcc(offset + 8);
        const streamIdx = parseInt(chunkId.substring(0, 2), 10);

        if (isNaN(streamIdx) || indexType !== 0x00) return;

        const allSamples: AVISample[] = [];
        const stream = streamIdx < this._streams.length ? this._streams[streamIdx] : null;
        const rate = stream?.rate || 1;
        const scale = stream?.scale || 1;

        for (let i = 0; i < entriesInUse; i++) {
            const entryPos = offset + 24 + i * (longsPerEntry > 0 ? longsPerEntry * 4 : 16);
            if (entryPos + 16 > this.buf.byteLength) break;

            const qwOffset = Number(this.buf.getBigUint64(entryPos, true));
            const dwSize = this.buf.getUint32(entryPos + 8, true);
            const dwDuration = this.buf.getUint32(entryPos + 12, true);

            if (qwOffset === 0 || dwSize === 0) continue;
            if (qwOffset + 32 > this.buf.byteLength) continue;

            this._parseStandardIndex(qwOffset, dwSize, streamIdx, allSamples, rate, scale);
        }

        if (allSamples.length > 0 && stream) {
            stream.samples = allSamples;
            stream.id = streamIdx;
            const existing = this.tracks.findIndex(t => t.id === streamIdx);
            if (existing >= 0) this.tracks[existing] = stream as AVITrack;
            else this.tracks.push(stream as AVITrack);
        }
    }

    private _parseStandardIndex(offset: number, size: number, streamIdx: number, allSamples: AVISample[], rate: number, scale: number): void {
        if (offset + 24 > this.buf.byteLength) return;
        const entriesInUse = this.buf.getUint32(offset + 4, true);
        const qwBaseOffset = Number(this.buf.getBigUint64(offset + 12, true));

        for (let i = 0; i < entriesInUse; i++) {
            const entryPos = offset + 24 + i * 8;
            if (entryPos + 8 > this.buf.byteLength) break;
            const dwOffset = this.buf.getUint32(entryPos, true);
            let dwSizeRaw = this.buf.getUint32(entryPos + 4, true);
            const isKey = (dwSizeRaw & 0x80000000) === 0;
            dwSizeRaw = dwSizeRaw & 0x7FFFFFFF;

            const pts = allSamples.length * scale / rate;
            allSamples.push({
                offset: qwBaseOffset + dwOffset,
                size: dwSizeRaw,
                isKey,
                pts,
                duration: scale / rate
            });
        }
    }

    public getSampleData(sample: AVISample): Uint8Array {
        return this.raw.subarray(sample.offset, sample.offset + sample.size);
    }

    private _fourcc(pos: number): string {
        if (pos + 4 > this.buf.byteLength) return '\0\0\0\0';
        return String.fromCharCode(
            this.buf.getUint8(pos), this.buf.getUint8(pos + 1),
            this.buf.getUint8(pos + 2), this.buf.getUint8(pos + 3)
        );
    }
}
