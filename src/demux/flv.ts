import { log } from '../core';

export interface FLVTag {
    type: 'video' | 'audio' | 'script';
    pts: number;
    dts: number;
    data: Uint8Array;
    isKey: boolean;
    codecId?: number;
}

export interface FLVMeta {
    duration?: number;
    width?: number;
    height?: number;
    framerate?: number;
    audioSampleRate?: number;
    audioChannels?: number;
    videoCodecId?: number;
    audioCodecId?: number;
}

export class FLVDemuxer {
    private buf: Uint8Array;
    private view: DataView;
    public meta: FLVMeta = {};
    public videoTags: FLVTag[] = [];
    public audioTags: FLVTag[] = [];
    public videoExtradata: Uint8Array | null = null;
    public audioExtradata: Uint8Array | null = null;

    constructor(buffer: ArrayBuffer) {
        this.buf = new Uint8Array(buffer);
        this.view = new DataView(buffer);
    }

    public parse(): void {
        try {
            if (this.buf[0] !== 0x46 || this.buf[1] !== 0x4C || this.buf[2] !== 0x56) return;


            const headerSize = this.view.getUint32(5);
            let pos = headerSize;
            while (pos < this.buf.length - 15) {
                pos += 4;
                if (pos >= this.buf.length - 11) break;
                const tagType = this.buf[pos];
                const dataSize = (this.buf[pos + 1] << 16) | (this.buf[pos + 2] << 8) | this.buf[pos + 3];
                const ts = ((this.buf[pos + 7] << 24) | (this.buf[pos + 4] << 16) | (this.buf[pos + 5] << 8) | this.buf[pos + 6]) >>> 0;
                const dataStart = pos + 11;
                if (dataStart + dataSize > this.buf.length) break;
                const tagData = this.buf.subarray(dataStart, dataStart + dataSize);
                if (tagType === 8) {
                    this._parseAudioTag(tagData, ts);
                } else if (tagType === 9) {
                    this._parseVideoTag(tagData, ts);
                } else if (tagType === 18) {
                    this._parseScriptTag(tagData);
                }
                pos = dataStart + dataSize;
            }
        } catch (e) {
            log.warn('[FLVDemuxer] Parse error (possibly truncated file):', e);
        }
    }

    private _parseVideoTag(data: Uint8Array, dts: number): void {
        if (data.length < 2) return;
        const firstByte = data[0];
        const isExHeader = (firstByte & 0x80) !== 0;

        if (isExHeader) {
            const packetType = firstByte & 0x0F;
            const frameType = (firstByte >> 4) & 0x07;
            const isKey = frameType === 1;
            if (data.length < 5) return;
            const fourcc = String.fromCharCode(data[1], data[2], data[3], data[4]);
            let codecStr = 'unknown';
            if (fourcc === 'hvc1' || fourcc === 'hev1') codecStr = 'hevc';
            else if (fourcc === 'av01') codecStr = 'av1';
            else if (fourcc === 'vp09') codecStr = 'vp9';
            else if (fourcc === 'avc1') codecStr = 'avc';
            this.meta.videoCodecId = -1;

            if (packetType === 0) {
                this.videoExtradata = data.subarray(5);
                return;
            }
            if (packetType === 1) {
                let cts = 0;
                if (data.length >= 8) {
                    cts = ((data[5] << 16) | (data[6] << 8) | data[7]);
                    if (cts & 0x800000) cts -= 0x1000000;
                }
                this.videoTags.push({
                    type: 'video', pts: dts + cts, dts,
                    data: data.subarray(8), isKey, codecId: -1
                });
            } else if (packetType === 3) {
                this.videoTags.push({
                    type: 'video', pts: dts, dts,
                    data: data.subarray(5), isKey, codecId: -1
                });
            }
            return;
        }

        const frameType = (firstByte >> 4) & 0x0F;
        const codecId = firstByte & 0x0F;
        const isKey = frameType === 1;
        if (codecId === 7) {
            if (data.length < 5) return;
            const avcPacketType = data[1];
            const compositionOffset = ((data[2] << 16) | (data[3] << 8) | data[4]);
            const cts = (compositionOffset & 0x800000) ? compositionOffset - 0x1000000 : compositionOffset;
            if (avcPacketType === 0) {
                this.videoExtradata = data.subarray(5);
                return;
            }
            this.videoTags.push({
                type: 'video', pts: dts + cts, dts,
                data: data.subarray(5), isKey, codecId
            });
        } else {
            this.videoTags.push({
                type: 'video', pts: dts, dts,
                data: data.subarray(1), isKey, codecId
            });
        }
    }

    private _parseAudioTag(data: Uint8Array, dts: number): void {
        if (data.length < 2) return;
        const codecId = (data[0] >> 4) & 0x0F;
        const sampleRateIdx = (data[0] >> 2) & 0x03;
        const channels = (data[0] & 0x01) + 1;
        this.meta.audioCodecId = codecId;
        this.meta.audioChannels = channels;
        const rates = [5500, 11025, 22050, 44100];
        this.meta.audioSampleRate = rates[sampleRateIdx] || 44100;
        if (codecId === 10) {
            if (data[1] === 0) {
                this.audioExtradata = data.subarray(2);
                return;
            }
            this.audioTags.push({
                type: 'audio', pts: dts, dts,
                data: data.subarray(2), isKey: true, codecId
            });
        } else {
            this.audioTags.push({
                type: 'audio', pts: dts, dts,
                data: data.subarray(1), isKey: true, codecId
            });
        }
    }

    private _parseScriptTag(data: Uint8Array): void {
        let pos = 0;
        if (data[pos] !== 2) return;
        pos++;
        if (pos + 2 > data.length) return;
        const nameLen = (data[pos] << 8) | data[pos + 1];
        pos += 2;
        if (pos + nameLen > data.length) return;
        const name = new TextDecoder().decode(data.subarray(pos, pos + nameLen));
        pos += nameLen;
        if (name !== 'onMetaData') return;
        if (data[pos] === 8) {
            pos++;
            const count = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
            pos += 4;
            for (let i = 0; i < count && pos < data.length - 3; i++) {
                const keyLen = (data[pos] << 8) | data[pos + 1];
                pos += 2;
                if (pos + keyLen > data.length) break;
                const key = new TextDecoder().decode(data.subarray(pos, pos + keyLen));
                pos += keyLen;
                const valType = data[pos++];
                if (valType === 0) {
                    if (pos + 8 > data.length) break;
                    const view = new DataView(data.buffer, data.byteOffset + pos, 8);
                    const val = view.getFloat64(0);
                    pos += 8;
                    if (key === 'duration') this.meta.duration = val;
                    else if (key === 'width') this.meta.width = val;
                    else if (key === 'height') this.meta.height = val;
                    else if (key === 'framerate') this.meta.framerate = val;
                } else if (valType === 1) {
                    pos++;
                } else if (valType === 2) {
                    const sLen = (data[pos] << 8) | data[pos + 1];
                    pos += 2 + sLen;
                } else {
                    break;
                }
            }
        }
    }
}
