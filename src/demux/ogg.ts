import { log } from '../core';

export interface OggPage {
    version: number;
    headerType: number;
    granulePosition: bigint;
    serialNumber: number;
    sequenceNumber: number;
    segments: Uint8Array[];
    isBOS: boolean;
    isEOS: boolean;
    isContinued: boolean;
}

export interface OggStream {
    serialNumber: number;
    codec: 'vorbis' | 'opus' | 'theora' | 'unknown';
    packets: Uint8Array[];
    headers: Uint8Array[];
    sampleRate?: number;
    channels?: number;
}

const OGG_CRC_TABLE: Uint32Array = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let r = i << 24;
        for (let j = 0; j < 8; j++) r = (r << 1) ^ ((r & 0x80000000) ? 0x04C11DB7 : 0);
        t[i] = r >>> 0;
    }
    return t;
})();

export class OggDemuxer {
    private buf: Uint8Array;
    private view: DataView;
    public streams: Map<number, OggStream> = new Map();

    constructor(buffer: ArrayBuffer) {
        this.buf = new Uint8Array(buffer);
        this.view = new DataView(buffer);
    }

    public parse(): void {
        try {
            let pos = 0;
            const pendingPackets: Map<number, Uint8Array[]> = new Map();
            while (pos < this.buf.length - 27) {
                const page = this._readPage(pos);
                if (!page) {
                    pos = this._findNextPage(pos + 1);
                    if (pos < 0) break;
                    continue;
                }
                pos = page.nextPos;
                const serial = page.page.serialNumber;
                if (!this.streams.has(serial)) {
                    this.streams.set(serial, {
                        serialNumber: serial,
                        codec: 'unknown',
                        packets: [],
                        headers: []
                    });
                }
                const stream = this.streams.get(serial)!;
                if (!pendingPackets.has(serial)) pendingPackets.set(serial, []);
                const pending = pendingPackets.get(serial)!;
                for (let i = 0; i < page.page.segments.length; i++) {
                    const seg = page.page.segments[i];
                    pending.push(seg);
                    const isComplete = i < page.segmentSizes.length && page.segmentSizes[i] < 255;
                    if (isComplete || i === page.page.segments.length - 1 && !page.page.isContinued) {
                        const fullPacket = this._concatSegments(pending.splice(0));
                        if (page.page.isBOS && stream.packets.length === 0) {
                            this._identifyCodec(stream, fullPacket);
                            stream.headers.push(fullPacket);
                        } else if (stream.headers.length < 3 && this._isHeader(stream.codec, fullPacket)) {
                            stream.headers.push(fullPacket);
                        } else {
                            stream.packets.push(fullPacket);
                        }
                    }
                }
            }
        } catch (e) {
            log.warn('[OggDemuxer] Parse error (possibly truncated file):', e);
        }
    }

    private _readPage(pos: number): { page: OggPage; nextPos: number; segmentSizes: number[] } | null {
        if (pos + 27 > this.buf.length) return null;
        if (this.buf[pos] !== 0x4F || this.buf[pos + 1] !== 0x67 ||
            this.buf[pos + 2] !== 0x67 || this.buf[pos + 3] !== 0x53) return null;
        const version = this.buf[pos + 4];
        const headerType = this.buf[pos + 5];
        const granule = this.view.getBigInt64(pos + 6, true);
        const serial = this.view.getUint32(pos + 14, true);
        const seqNum = this.view.getUint32(pos + 18, true);
        const storedCrc = this.view.getUint32(pos + 22, true);
        const numSegments = this.buf[pos + 26];
        if (pos + 27 + numSegments > this.buf.length) return null;
        const segmentSizes: number[] = [];
        let totalSegmentBytes = 0;
        for (let i = 0; i < numSegments; i++) {
            const sz = this.buf[pos + 27 + i];
            segmentSizes.push(sz);
            totalSegmentBytes += sz;
        }
        const pageEnd = pos + 27 + numSegments + totalSegmentBytes;
        if (pageEnd > this.buf.length) return null;

        const computedCrc = this._oggCrc32(pos, pageEnd - pos, pos + 22);
        if (computedCrc !== storedCrc) {
            log.warn(`[OggDemuxer] CRC32 mismatch at page offset ${pos}: stored=0x${storedCrc.toString(16)}, computed=0x${computedCrc.toString(16)}`);
            return null;
        }

        let dataPos = pos + 27 + numSegments;
        const segments: Uint8Array[] = [];
        for (const sz of segmentSizes) {
            if (dataPos + sz > this.buf.length) break;
            segments.push(this.buf.subarray(dataPos, dataPos + sz));
            dataPos += sz;
        }
        return {
            page: {
                version, headerType,
                granulePosition: granule,
                serialNumber: serial,
                sequenceNumber: seqNum,
                segments,
                isBOS: (headerType & 0x02) !== 0,
                isEOS: (headerType & 0x04) !== 0,
                isContinued: (headerType & 0x01) !== 0
            },
            nextPos: dataPos,
            segmentSizes
        };
    }

    private _oggCrc32(start: number, length: number, checksumOffset: number): number {
        let crc = 0;
        for (let i = 0; i < length; i++) {
            const bytePos = start + i;
            const b = (bytePos >= checksumOffset && bytePos < checksumOffset + 4) ? 0 : this.buf[bytePos];
            crc = ((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) ^ b) & 0xFF]) >>> 0;
        }
        return crc;
    }

    private _findNextPage(start: number): number {
        for (let i = start; i < this.buf.length - 4; i++) {
            if (this.buf[i] === 0x4F && this.buf[i + 1] === 0x67 &&
                this.buf[i + 2] === 0x67 && this.buf[i + 3] === 0x53) return i;
        }
        return -1;
    }

    private _concatSegments(parts: Uint8Array[]): Uint8Array {
        if (parts.length === 1) return parts[0];
        let total = 0;
        for (const p of parts) total += p.length;
        const result = new Uint8Array(total);
        let offset = 0;
        for (const p of parts) { result.set(p, offset); offset += p.length; }
        return result;
    }

    private _identifyCodec(stream: OggStream, firstPacket: Uint8Array): void {
        if (firstPacket.length >= 7 && firstPacket[0] === 0x01 &&
            firstPacket[1] === 0x76 && firstPacket[2] === 0x6F &&
            firstPacket[3] === 0x72 && firstPacket[4] === 0x62 &&
            firstPacket[5] === 0x69 && firstPacket[6] === 0x73) {
            stream.codec = 'vorbis';
            if (firstPacket.length >= 16) {
                const dv = new DataView(firstPacket.buffer, firstPacket.byteOffset);
                stream.channels = firstPacket[11];
                stream.sampleRate = dv.getUint32(12, true);
            }
        } else if (firstPacket.length >= 8 &&
            firstPacket[0] === 0x4F && firstPacket[1] === 0x70 &&
            firstPacket[2] === 0x75 && firstPacket[3] === 0x73 &&
            firstPacket[4] === 0x48 && firstPacket[5] === 0x65 &&
            firstPacket[6] === 0x61 && firstPacket[7] === 0x64) {
            stream.codec = 'opus';
            if (firstPacket.length >= 12) {
                stream.channels = firstPacket[9];
                const dv = new DataView(firstPacket.buffer, firstPacket.byteOffset);
                stream.sampleRate = dv.getUint32(12, true);
            }
        } else if (firstPacket.length >= 7 && firstPacket[0] === 0x80 &&
            firstPacket[1] === 0x74 && firstPacket[2] === 0x68 &&
            firstPacket[3] === 0x65 && firstPacket[4] === 0x6F &&
            firstPacket[5] === 0x72 && firstPacket[6] === 0x61) {
            stream.codec = 'theora';
        }
    }

    private _isHeader(codec: string, packet: Uint8Array): boolean {
        if (codec === 'vorbis' && packet.length > 0 && (packet[0] === 0x03 || packet[0] === 0x05)) return true;
        if (codec === 'opus' && packet.length >= 8 &&
            packet[0] === 0x4F && packet[1] === 0x70 && packet[2] === 0x75 && packet[3] === 0x73) return true;
        return false;
    }

    public getVorbisStreams(): OggStream[] {
        return [...this.streams.values()].filter(s => s.codec === 'vorbis');
    }

    public getOpusStreams(): OggStream[] {
        return [...this.streams.values()].filter(s => s.codec === 'opus');
    }
}
