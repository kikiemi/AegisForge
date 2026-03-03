import { MKVDemuxer, MKVTrackInfo, MKVFrame } from './mkv';

export type WebMTrack = MKVTrackInfo;
export type WebMBlock = MKVFrame;

export class WebMDemuxer extends MKVDemuxer {
    constructor(buffer: ArrayBuffer) {
        super(buffer);
    }
}
