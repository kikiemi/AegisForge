import { log } from '../core';

const TE = new TextEncoder();

export interface TranscodeConfig {
    outputFormat: 'mp4' | 'webm';
    videoCodec: string;
    audioCodec: string;
    width: number;
    height: number;
    fps: number;
    videoBitrate: number;
    audioBitrate: number;
    audioSampleRate: number;
    audioChannels: number;
}

export interface TranscodeProgress {
    phase: 'demux' | 'decode' | 'encode' | 'mux' | 'done' | 'error';
    framesProcessed: number;
    totalEstimate: number;
    percent: number;
    elapsedMs: number;
}

const DEFAULT_TRANSCODE: TranscodeConfig = {
    outputFormat: 'mp4',
    videoCodec: 'avc1.42E01E',
    audioCodec: 'mp4a.40.2',
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 5_000_000,
    audioBitrate: 128000,
    audioSampleRate: 48000,
    audioChannels: 2
};

interface StoredChunk {
    data: Uint8Array;
    isKey: boolean;
    timestamp: number;
}

export class DirectTranscoder {
    private cfg: TranscodeConfig;
    private _videoChunks: StoredChunk[] = [];
    private _audioChunks: StoredChunk[] = [];
    private _chunkBytes: number = 0;
    private static readonly SOFT_LIMIT = 256 * 1024 * 1024;
    private static readonly HARD_LIMIT = 512 * 1024 * 1024;
    private _softWarnEmitted = false;
    private _progress: TranscodeProgress;
    private _onProgress: ((p: TranscodeProgress) => void) | null = null;
    private _startTime: number = 0;
    private _videoFrameCount: number = 0;
    private _audioSampleCount: number = 0;
    private _videoEncoder: VideoEncoder | null = null;
    private _audioEncoder: AudioEncoder | null = null;
    private _videoDecoderConfig: Uint8Array | null = null;

    constructor(config?: Partial<TranscodeConfig>) {
        this.cfg = { ...DEFAULT_TRANSCODE, ...config };
        this._progress = {
            phase: 'demux', framesProcessed: 0,
            totalEstimate: 0, percent: 0, elapsedMs: 0
        };
    }

    public onProgress(cb: (p: TranscodeProgress) => void): void { this._onProgress = cb; }

    public async transcode(
        videoFrames: AsyncIterable<{ data: Uint8Array | ImageBitmap; timestamp: number; isKey: boolean }>,
        audioFrames: AsyncIterable<{ data: Float32Array; timestamp: number }> | null
    ): Promise<Blob> {
        this._startTime = performance.now();
        this._videoChunks = [];
        this._audioChunks = [];
        this._videoFrameCount = 0;
        this._audioSampleCount = 0;
        await this._initEncoders();
        this._updateProgress('encode', 0);
        try {
            const videoPromise = this._processVideoStream(videoFrames);
            const audioPromise = audioFrames ? this._processAudioStream(audioFrames) : Promise.resolve();
            await Promise.all([videoPromise, audioPromise]);
        } finally {
            await this._flushEncoders();
        }
        this._updateProgress('mux', this._videoFrameCount);
        const muxed = this._muxToContainer();
        this._updateProgress('done', this._videoFrameCount);
        return muxed;
    }

    public async transcodeFromRawBuffers(
        videoRGBA: { pixels: Uint8ClampedArray; width: number; height: number; timestamp: number }[],
        audioPCM: { samples: Float32Array; sampleRate: number; timestamp: number }[]
    ): Promise<Blob> {
        this._startTime = performance.now();
        this._videoChunks = [];
        this._audioChunks = [];
        await this._initEncoders();
        try {
            for (const frame of videoRGBA) {
                try {
                    const vf = new VideoFrame(
                        frame.pixels.buffer as ArrayBuffer,
                        { timestamp: frame.timestamp, codedWidth: frame.width, codedHeight: frame.height, format: 'RGBA' }
                    );
                    this._videoEncoder!.encode(vf, { keyFrame: this._videoFrameCount % 30 === 0 });
                    vf.close();
                    this._videoFrameCount++;
                    if (this._videoFrameCount % 10 === 0) this._updateProgress('encode', this._videoFrameCount);
                } catch (e) {
                    log.warn('[DirectTranscoder]', e);
                }
            }
            for (const chunk of audioPCM) {
                try {
                    const ad = new AudioData({
                        format: 'f32-planar' as AudioSampleFormat,
                        sampleRate: chunk.sampleRate,
                        numberOfFrames: chunk.samples.length / this.cfg.audioChannels,
                        numberOfChannels: this.cfg.audioChannels,
                        timestamp: chunk.timestamp,
                        data: chunk.samples.buffer as ArrayBuffer
                    });
                    this._audioEncoder!.encode(ad);
                    ad.close();
                } catch (e) {
                    log.warn('[DirectTranscoder]', e);
                }
            }
        } finally {
            await this._flushEncoders();
        }
        return this._muxToContainer();
    }

    private async _initEncoders(): Promise<void> {
        if (typeof VideoEncoder !== 'undefined') {
            this._videoEncoder = new VideoEncoder({
                output: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => this._onVideoChunk(chunk, meta),
                error: (e: DOMException) => log.warn('[DirectTranscoder] VideoEncoder error:', e)
            });
            this._videoEncoder.configure({
                codec: this.cfg.videoCodec,
                width: this.cfg.width,
                height: this.cfg.height,
                bitrate: this.cfg.videoBitrate,
                framerate: this.cfg.fps
            });
        }
        if (typeof AudioEncoder !== 'undefined') {
            this._audioEncoder = new AudioEncoder({
                output: (chunk: EncodedAudioChunk) => this._onAudioChunk(chunk),
                error: (e: DOMException) => log.warn('[DirectTranscoder] AudioEncoder error:', e)
            });
            this._audioEncoder.configure({
                codec: this.cfg.audioCodec,
                sampleRate: this.cfg.audioSampleRate,
                numberOfChannels: this.cfg.audioChannels,
                bitrate: this.cfg.audioBitrate
            });
        }
    }

    private async _processVideoStream(
        frames: AsyncIterable<{ data: Uint8Array | ImageBitmap; timestamp: number; isKey: boolean }>
    ): Promise<void> {
        if (!this._videoEncoder) return;
        for await (const frame of frames) {
            try {
                let vf: VideoFrame;
                if (frame.data instanceof ImageBitmap) {
                    vf = new VideoFrame(frame.data, { timestamp: frame.timestamp });
                } else {
                    const rgba = frame.data;
                    vf = new VideoFrame(
                        rgba.buffer as ArrayBuffer,
                        { timestamp: frame.timestamp, codedWidth: this.cfg.width, codedHeight: this.cfg.height, format: 'RGBA' }
                    );
                }
                this._videoEncoder.encode(vf, { keyFrame: frame.isKey || this._videoFrameCount % 60 === 0 });
                vf.close();
                this._videoFrameCount++;
                if (this._videoFrameCount % 10 === 0) this._updateProgress('encode', this._videoFrameCount);
            } catch (e) {
                log.warn('[DirectTranscoder]', e);
            }
        }
    }

    private async _processAudioStream(
        frames: AsyncIterable<{ data: Float32Array; timestamp: number }>
    ): Promise<void> {
        if (!this._audioEncoder) return;
        for await (const frame of frames) {
            try {
                const ad = new AudioData({
                    format: 'f32-planar' as AudioSampleFormat,
                    sampleRate: this.cfg.audioSampleRate,
                    numberOfFrames: Math.floor(frame.data.length / this.cfg.audioChannels),
                    numberOfChannels: this.cfg.audioChannels,
                    timestamp: frame.timestamp,
                    data: frame.data.buffer as ArrayBuffer
                });
                this._audioEncoder.encode(ad);
                ad.close();
                this._audioSampleCount += frame.data.length;
            } catch (e) {
                log.warn('[DirectTranscoder]', e);
            }
        }
    }

    private _onVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        if (meta?.decoderConfig?.description && !this._videoDecoderConfig) {
            const desc = meta.decoderConfig.description;
            if (desc instanceof ArrayBuffer) {
                this._videoDecoderConfig = new Uint8Array(desc);
            } else if (ArrayBuffer.isView(desc)) {
                this._videoDecoderConfig = new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength);
            }
            log.info(`[DirectTranscoder] Captured ${this._videoDecoderConfig?.length || 0}B codec config`);
        }
        this._videoChunks.push({
            data,
            isKey: chunk.type === 'key',
            timestamp: chunk.timestamp
        });
        this._chunkBytes += data.byteLength;
        this._checkMemoryLimit();
    }

    private _onAudioChunk(chunk: EncodedAudioChunk): void {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        this._audioChunks.push({
            data,
            isKey: true,
            timestamp: chunk.timestamp
        });
        this._chunkBytes += data.byteLength;
        this._checkMemoryLimit();
    }

    private _checkMemoryLimit(): void {
        if (this._chunkBytes >= DirectTranscoder.HARD_LIMIT) {
            throw new Error(`[DirectTranscoder] Chunk accumulation exceeded ${DirectTranscoder.HARD_LIMIT / (1024 * 1024)}MB hard limit. ` +
                `Input file is too large for in-memory transcoding. Use AegisMuxer in streaming mode instead.`);
        }
        if (!this._softWarnEmitted && this._chunkBytes >= DirectTranscoder.SOFT_LIMIT) {
            this._softWarnEmitted = true;
            log.warn(`[DirectTranscoder] Chunk accumulation at ${(this._chunkBytes / (1024 * 1024)).toFixed(0)}MB — ` +
                `approaching memory limit. Consider using streaming mode for large files.`);
        }
    }

    private async _flushEncoders(): Promise<void> {
        if (this._videoEncoder && this._videoEncoder.state === 'configured') {
            try { await this._videoEncoder.flush(); } catch (e) { log.warn('[DirectTranscoder] flush error:', e); }
            try { this._videoEncoder.close(); } catch (_) { }
        }
        if (this._audioEncoder && this._audioEncoder.state === 'configured') {
            try { await this._audioEncoder.flush(); } catch (e) { log.warn('[DirectTranscoder] flush error:', e); }
            try { this._audioEncoder.close(); } catch (_) { }
        }
    }

    private _muxToContainer(): Blob {
        if (this.cfg.outputFormat === 'mp4') return this._muxMP4();
        return this._muxWebM();
    }

    private _muxMP4(): Blob {
        const vChunks = this._videoChunks;
        const aChunks = this._audioChunks;

        let mdatPayload = 0;
        for (const c of vChunks) mdatPayload += c.data.length;
        for (const c of aChunks) mdatPayload += c.data.length;

        const ftyp = this._buildFtyp();

        const dummyMoov = this._buildMoov(vChunks, aChunks, 0);
        const moovSize = dummyMoov.length;

        const needs64bitMdat = mdatPayload + 8 > 0xFFFFFFFF;
        const mdatHeaderSize = needs64bitMdat ? 16 : 8;

        const dataOffset = ftyp.length + moovSize + mdatHeaderSize;
        const moov = this._buildMoov(vChunks, aChunks, dataOffset);

        const mdatHeader = new Uint8Array(mdatHeaderSize);
        const mdDv = new DataView(mdatHeader.buffer);
        if (needs64bitMdat) {
            mdDv.setUint32(0, 1);
            mdatHeader.set([0x6D, 0x64, 0x61, 0x74], 4);
            const totalMdat = mdatPayload + 16;
            mdDv.setUint32(8, Math.floor(totalMdat / 0x100000000));
            mdDv.setUint32(12, totalMdat >>> 0);
        } else {
            mdDv.setUint32(0, mdatPayload + 8);
            mdatHeader.set([0x6D, 0x64, 0x61, 0x74], 4);
        }

        const parts: (Uint8Array | ArrayBuffer)[] = [ftyp, moov, mdatHeader];
        for (const c of vChunks) parts.push(c.data);
        for (const c of aChunks) parts.push(c.data);
        return new Blob(parts as BlobPart[], { type: 'video/mp4' });
    }

    private _buildFtyp(): Uint8Array {
        const buf = new Uint8Array(32);
        const dv = new DataView(buf.buffer);
        dv.setUint32(0, 32);
        buf.set([0x66, 0x74, 0x79, 0x70], 4);
        buf.set([0x69, 0x73, 0x6F, 0x6D], 8);
        dv.setUint32(12, 0x200);
        buf.set([0x69, 0x73, 0x6F, 0x6D], 16);
        buf.set([0x69, 0x73, 0x6F, 0x32], 20);
        buf.set([0x61, 0x76, 0x63, 0x31], 24);
        buf.set([0x6D, 0x70, 0x34, 0x31], 28);
        return buf;
    }

    private _buildMoov(vChunks: StoredChunk[], aChunks: StoredChunk[], dataOffset: number): Uint8Array {
        const timescale = 90000;
        const vDurationTicks = vChunks.length > 0 ? Math.round(this._videoFrameCount / this.cfg.fps * timescale) : 0;
        const aDurationTicks = aChunks.length > 0 ? Math.round(this._audioSampleCount / this.cfg.audioChannels / this.cfg.audioSampleRate * timescale) : 0;
        const totalDuration = Math.max(vDurationTicks, aDurationTicks);

        const mvhd = this._buildMvhd(timescale, totalDuration);
        const children: Uint8Array[] = [mvhd];

        let currentOffset = dataOffset;
        if (vChunks.length > 0) {
            const vTrak = this._buildVideoTrak(vChunks, currentOffset);
            children.push(vTrak);
            for (const c of vChunks) currentOffset += c.data.length;
        }
        if (aChunks.length > 0) {
            const aTrak = this._buildAudioTrak(aChunks, currentOffset);
            children.push(aTrak);
        }

        return this._mp4Container('moov', children);
    }

    private _buildMvhd(timescale: number, duration: number): Uint8Array {
        const buf = new Uint8Array(116);
        const dv = new DataView(buf.buffer);
        dv.setUint32(0, 116);
        buf.set([0x6D, 0x76, 0x68, 0x64], 4);
        dv.setUint32(12, timescale);
        dv.setUint32(16, duration);
        dv.setUint32(20, 0x00010000);
        dv.setUint16(24, 0x0100);
        const identity = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
        for (let i = 0; i < 9; i++) dv.setUint32(36 + i * 4, identity[i]);
        dv.setUint32(112, (this._videoChunks.length > 0 && this._audioChunks.length > 0) ? 3 : 2);
        return buf;
    }

    private _buildVideoTrak(chunks: StoredChunk[], startOffset: number): Uint8Array {
        const timescale = 90000;
        const sampleDelta = Math.round(timescale / this.cfg.fps);
        const duration = chunks.length * sampleDelta;

        const tkhd = new Uint8Array(100);
        const tkDv = new DataView(tkhd.buffer);
        tkDv.setUint32(0, 100);
        tkhd.set([0x74, 0x6B, 0x68, 0x64], 4);
        tkhd[11] = 0x03;
        tkDv.setUint32(12, 1);
        tkDv.setUint32(20, duration);
        const identity = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
        for (let i = 0; i < 9; i++) tkDv.setUint32(44 + i * 4, identity[i]);
        tkDv.setUint32(84, this.cfg.width << 16);
        tkDv.setUint32(88, this.cfg.height << 16);

        const mdhd = new Uint8Array(40);
        const mdDv = new DataView(mdhd.buffer);
        mdDv.setUint32(0, 40);
        mdhd.set([0x6D, 0x64, 0x68, 0x64], 4);
        mdDv.setUint32(12, timescale);
        mdDv.setUint32(16, duration);
        mdDv.setUint16(20, 0x55C4);

        const hdlr = new Uint8Array(45);
        new DataView(hdlr.buffer).setUint32(0, 45);
        hdlr.set([0x68, 0x64, 0x6C, 0x72], 4);
        hdlr.set([0x76, 0x69, 0x64, 0x65], 16);
        hdlr.set([0x56, 0x69, 0x64, 0x65, 0x6F, 0x00], 36);

        const stsdEntry = this._buildVideoStsdEntry();
        const stsd = this._mp4Box('stsd', stsdEntry, 1);

        const sttsData = new Uint8Array(8);
        const sttsDv = new DataView(sttsData.buffer);
        sttsDv.setUint32(0, chunks.length);
        sttsDv.setUint32(4, sampleDelta);
        const stts = this._mp4FullBox('stts', sttsData, 1);

        const stszData = new Uint8Array(4 + 4 + chunks.length * 4);
        const szDv = new DataView(stszData.buffer);
        szDv.setUint32(0, 0);
        szDv.setUint32(4, chunks.length);
        for (let i = 0; i < chunks.length; i++) {
            szDv.setUint32(8 + i * 4, chunks[i].data.length);
        }
        const stsz = this._mp4FullBox('stsz', stszData);

        const keyIndices: number[] = [];
        for (let i = 0; i < chunks.length; i++) {
            if (chunks[i].isKey) keyIndices.push(i + 1);
        }
        let stss: Uint8Array | null = null;
        if (keyIndices.length > 0 && keyIndices.length < chunks.length) {
            const stssData = new Uint8Array(keyIndices.length * 4);
            const ssDv = new DataView(stssData.buffer);
            for (let i = 0; i < keyIndices.length; i++) ssDv.setUint32(i * 4, keyIndices[i]);
            stss = this._mp4FullBox('stss', stssData, keyIndices.length);
        }

        const stscData = new Uint8Array(12);
        const scDv = new DataView(stscData.buffer);
        scDv.setUint32(0, 1);
        scDv.setUint32(4, chunks.length);
        scDv.setUint32(8, 1);
        const stsc = this._mp4FullBox('stsc', stscData, 1);

        const usesCo64 = startOffset > 0xFFFFFFFF;
        let stco: Uint8Array;
        if (usesCo64) {
            const coData = new Uint8Array(8);
            const coDv = new DataView(coData.buffer);
            coDv.setUint32(0, Math.floor(startOffset / 0x100000000));
            coDv.setUint32(4, startOffset >>> 0);
            stco = this._mp4FullBox('co64', coData, 1);
        } else {
            const coData = new Uint8Array(4);
            new DataView(coData.buffer).setUint32(0, startOffset);
            stco = this._mp4FullBox('stco', coData, 1);
        }

        const stblParts = [stsd, stts, stsz, stsc, stco];
        if (stss) stblParts.splice(2, 0, stss);
        const stbl = this._mp4Container('stbl', stblParts);

        const vmhd = new Uint8Array(20);
        new DataView(vmhd.buffer).setUint32(0, 20);
        vmhd.set([0x76, 0x6D, 0x68, 0x64], 4);
        vmhd[11] = 0x01;

        const dref = this._mp4FullBox('dref', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 12, 0x75, 0x72, 0x6C, 0x20, 0, 0, 0, 1]));
        const dinf = this._mp4Container('dinf', [dref]);
        const minf = this._mp4Container('minf', [vmhd, dinf, stbl]);
        const mdia = this._mp4Container('mdia', [mdhd, hdlr, minf]);
        return this._mp4Container('trak', [tkhd, mdia]);
    }

    private _buildVideoStsdEntry(): Uint8Array {
        const codecBase = this.cfg.videoCodec.split('.')[0].toLowerCase();
        const isH264 = codecBase.startsWith('avc');
        const isH265 = codecBase.startsWith('hvc') || codecBase.startsWith('hev');
        const isVP9 = codecBase.startsWith('vp09') || codecBase.startsWith('vp9');
        const isAV1 = codecBase.startsWith('av01') || codecBase.startsWith('av1');

        let fourcc: [number, number, number, number];
        let configBoxType: string;
        if (isH265) { fourcc = [0x68, 0x76, 0x63, 0x31]; configBoxType = 'hvcC'; }
        else if (isVP9) { fourcc = [0x76, 0x70, 0x30, 0x39]; configBoxType = 'vpcC'; }
        else if (isAV1) { fourcc = [0x61, 0x76, 0x30, 0x31]; configBoxType = 'av1C'; }
        else { fourcc = [0x61, 0x76, 0x63, 0x31]; configBoxType = 'avcC'; }

        let configBox: Uint8Array;
        if (this._videoDecoderConfig && this._videoDecoderConfig.length > 0) {
            configBox = this._mp4Container(configBoxType, [this._videoDecoderConfig]);
        } else {
            log.warn('[DirectTranscoder] No codec config from encoder — MP4 may not be playable');
            if (isH264) {
                const profile = parseInt(this.cfg.videoCodec.split('.')[1] || '42', 16) || 0x42;
                const compat = parseInt(this.cfg.videoCodec.split('.')[2] || 'C0', 16) || 0xC0;
                const level = parseInt(this.cfg.videoCodec.split('.')[3] || '1E', 16) || 0x1E;
                const minAvcC = new Uint8Array([
                    1, profile, compat, level, 0xFF,
                    0xE1, 0x00, 0x00,
                    0x01, 0x00, 0x00
                ]);
                configBox = this._mp4Container('avcC', [minAvcC]);
            } else {
                configBox = new Uint8Array(0);
            }
        }

        const totalSize = 86 + configBox.length;
        const entry = new Uint8Array(totalSize);
        const dv = new DataView(entry.buffer);
        dv.setUint32(0, totalSize);
        entry.set(fourcc, 4);
        dv.setUint16(14, 1);
        dv.setUint16(32, this.cfg.width);
        dv.setUint16(34, this.cfg.height);
        dv.setUint32(36, 0x00480000);
        dv.setUint32(40, 0x00480000);
        dv.setUint16(48, 1);
        dv.setUint16(82, 0x0018);
        dv.setInt16(84, -1);
        if (configBox.length > 0) entry.set(configBox, 86);
        return entry;
    }

    private _buildAudioTrak(chunks: StoredChunk[], startOffset: number): Uint8Array {
        const timescale = this.cfg.audioSampleRate;
        const samplesPerChunk = 1024;
        const totalSamples = chunks.length * samplesPerChunk;
        const duration = totalSamples;

        const tkhd = new Uint8Array(100);
        const tkDv = new DataView(tkhd.buffer);
        tkDv.setUint32(0, 100);
        tkhd.set([0x74, 0x6B, 0x68, 0x64], 4);
        tkhd[11] = 0x07;
        tkDv.setUint32(12, 2);
        tkDv.setUint32(20, Math.round(duration / timescale * 90000));
        tkDv.setUint16(36, 0x0100);
        const identity = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
        for (let i = 0; i < 9; i++) tkDv.setUint32(44 + i * 4, identity[i]);

        const mdhd = new Uint8Array(40);
        const mdDv = new DataView(mdhd.buffer);
        mdDv.setUint32(0, 40);
        mdhd.set([0x6D, 0x64, 0x68, 0x64], 4);
        mdDv.setUint32(12, timescale);
        mdDv.setUint32(16, duration);
        mdDv.setUint16(20, 0x55C4);

        const hdlr = new Uint8Array(45);
        new DataView(hdlr.buffer).setUint32(0, 45);
        hdlr.set([0x68, 0x64, 0x6C, 0x72], 4);
        hdlr.set([0x73, 0x6F, 0x75, 0x6E], 16);
        hdlr.set([0x53, 0x6F, 0x75, 0x6E, 0x64, 0x00], 36);

        const stsdEntry = this._buildAudioStsdEntry();
        const stsd = this._mp4Box('stsd', stsdEntry, 1);

        const sttsData = new Uint8Array(8);
        const sttsDv = new DataView(sttsData.buffer);
        sttsDv.setUint32(0, chunks.length);
        sttsDv.setUint32(4, samplesPerChunk);
        const stts = this._mp4FullBox('stts', sttsData, 1);

        const stszData = new Uint8Array(4 + 4 + chunks.length * 4);
        const szDv = new DataView(stszData.buffer);
        szDv.setUint32(0, 0);
        szDv.setUint32(4, chunks.length);
        for (let i = 0; i < chunks.length; i++) szDv.setUint32(8 + i * 4, chunks[i].data.length);
        const stsz = this._mp4FullBox('stsz', stszData);

        const stscData = new Uint8Array(12);
        const scDv = new DataView(stscData.buffer);
        scDv.setUint32(0, 1);
        scDv.setUint32(4, chunks.length);
        scDv.setUint32(8, 1);
        const stsc = this._mp4FullBox('stsc', stscData, 1);

        const usesCo64 = startOffset > 0xFFFFFFFF;
        let stco: Uint8Array;
        if (usesCo64) {
            const coData = new Uint8Array(8);
            const coDv = new DataView(coData.buffer);
            coDv.setUint32(0, Math.floor(startOffset / 0x100000000));
            coDv.setUint32(4, startOffset >>> 0);
            stco = this._mp4FullBox('co64', coData, 1);
        } else {
            const coData = new Uint8Array(4);
            new DataView(coData.buffer).setUint32(0, startOffset);
            stco = this._mp4FullBox('stco', coData, 1);
        }

        const stbl = this._mp4Container('stbl', [stsd, stts, stsz, stsc, stco]);

        const smhd = new Uint8Array(16);
        new DataView(smhd.buffer).setUint32(0, 16);
        smhd.set([0x73, 0x6D, 0x68, 0x64], 4);

        const dref = this._mp4FullBox('dref', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 12, 0x75, 0x72, 0x6C, 0x20, 0, 0, 0, 1]));
        const dinf = this._mp4Container('dinf', [dref]);
        const minf = this._mp4Container('minf', [smhd, dinf, stbl]);
        const mdia = this._mp4Container('mdia', [mdhd, hdlr, minf]);
        return this._mp4Container('trak', [tkhd, mdia]);
    }

    private _buildAudioStsdEntry(): Uint8Array {

        const aacProfile = 2;

        const srIdx = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
            .indexOf(this.cfg.audioSampleRate);
        const srIndex = srIdx >= 0 ? srIdx : 4;
        const audioConfig = new Uint8Array([(aacProfile << 3) | (srIndex >> 1), ((srIndex & 1) << 7) | (this.cfg.audioChannels << 3)]);

        const esdsPayloadSize = 23 + audioConfig.length;
        const esdsBox = new Uint8Array(12 + esdsPayloadSize);
        const eDv = new DataView(esdsBox.buffer);
        eDv.setUint32(0, 12 + esdsPayloadSize);
        esdsBox.set([0x65, 0x73, 0x64, 0x73], 4);

        let p = 12;
        esdsBox[p++] = 3;
        esdsBox[p++] = 19 + audioConfig.length;
        eDv.setUint16(p, 1); p += 2;
        esdsBox[p++] = 0;
        esdsBox[p++] = 4;
        esdsBox[p++] = 11 + audioConfig.length;
        esdsBox[p++] = 0x40;
        esdsBox[p++] = 0x15;
        p += 3;
        eDv.setUint32(p, this.cfg.audioBitrate); p += 4;
        eDv.setUint32(p, this.cfg.audioBitrate); p += 4;
        esdsBox[p++] = 5;
        esdsBox[p++] = audioConfig.length;
        esdsBox.set(audioConfig, p); p += audioConfig.length;
        esdsBox[p++] = 6; esdsBox[p++] = 1; esdsBox[p++] = 2;

        const totalSize = 36 + esdsBox.length;
        const entry = new Uint8Array(totalSize);
        const dv = new DataView(entry.buffer);
        dv.setUint32(0, totalSize);
        entry.set([0x6D, 0x70, 0x34, 0x61], 4);
        dv.setUint16(14, 1);
        dv.setUint16(24, this.cfg.audioChannels);
        dv.setUint16(26, 16);
        dv.setUint32(32, this.cfg.audioSampleRate << 16);
        entry.set(esdsBox, 36);
        return entry;
    }

    private _muxWebM(): Blob {
        const ebml = this._ebml;
        const parts: Uint8Array[] = [];

        parts.push(ebml(0x1A45DFA3, [
            ebml(0x4286, this._ebmlUint(1)),
            ebml(0x42F7, this._ebmlUint(1)),
            ebml(0x42F2, this._ebmlUint(4)),
            ebml(0x42F3, this._ebmlUint(8)),
            ebml(0x4282, TE.encode('webm')),
            ebml(0x4287, this._ebmlUint(4)),
            ebml(0x4285, this._ebmlUint(2))
        ]));

        const durationMs = this._videoFrameCount / this.cfg.fps * 1000;

        const info = ebml(0x1549A966, [
            ebml(0x2AD7B1, this._ebmlUint(1000000)),
            ebml(0x4D80, TE.encode('AegisForge')),
            ebml(0x5741, TE.encode('AegisForge')),
            ebml(0x4489, this._ebmlFloat64(durationMs))
        ]);

        const trackEntries: Uint8Array[] = [];

        const codecId = this.cfg.videoCodec.includes('vp9') ? 'V_VP9' :
            this.cfg.videoCodec.includes('av1') ? 'V_AV1' : 'V_VP8';
        trackEntries.push(ebml(0xAE, [
            ebml(0xD7, this._ebmlUint(1)),
            ebml(0x73C5, this._ebmlUint(1)),
            ebml(0x83, this._ebmlUint(1)),
            ebml(0x86, TE.encode(codecId)),
            ebml(0xE0, [
                ebml(0xB0, this._ebmlUint(this.cfg.width)),
                ebml(0xBA, this._ebmlUint(this.cfg.height))
            ])
        ]));

        if (this._audioChunks.length > 0) {
            const aCodecId = this.cfg.audioCodec.includes('opus') ? 'A_OPUS' : 'A_AAC';
            trackEntries.push(ebml(0xAE, [
                ebml(0xD7, this._ebmlUint(2)),
                ebml(0x73C5, this._ebmlUint(2)),
                ebml(0x83, this._ebmlUint(2)),
                ebml(0x86, TE.encode(aCodecId)),
                ebml(0xE1, [
                    ebml(0xB5, this._ebmlFloat64(this.cfg.audioSampleRate)),
                    ebml(0x9F, this._ebmlUint(this.cfg.audioChannels))
                ])
            ]));
        }
        const tracks = ebml(0x1654AE6B, trackEntries);

        const MAX_CLUSTER_MS = 30000;
        const frameDurMs = 1000 / this.cfg.fps;
        const clusters: Uint8Array[] = [];
        let clusterStartMs = 0;
        let clusterChildren: Uint8Array[] = [];
        let needsNewCluster = true;

        for (let i = 0; i < this._videoChunks.length; i++) {
            const timeMs = Math.round(i * frameDurMs);
            const chunk = this._videoChunks[i];
            const relativeMs = timeMs - clusterStartMs;

            if (needsNewCluster || (chunk.isKey && relativeMs >= MAX_CLUSTER_MS)) {
                if (clusterChildren.length > 0) {
                    clusters.push(ebml(0x1F43B675, clusterChildren));
                }
                clusterStartMs = timeMs;
                clusterChildren = [ebml(0xE7, this._ebmlUint(timeMs))];
                needsNewCluster = false;
            }

            const blockTimecode = timeMs - clusterStartMs;
            const tc16 = Math.max(-32768, Math.min(32767, blockTimecode));
            const simpleBlockHeader = new Uint8Array(4);
            simpleBlockHeader[0] = 0x81;
            simpleBlockHeader[1] = (tc16 >> 8) & 0xFF;
            simpleBlockHeader[2] = tc16 & 0xFF;
            simpleBlockHeader[3] = chunk.isKey ? 0x80 : 0x00;
            const blockData = new Uint8Array(4 + chunk.data.length);
            blockData.set(simpleBlockHeader);
            blockData.set(chunk.data, 4);
            clusterChildren.push(ebml(0xA3, blockData));
        }

        for (let i = 0; i < this._audioChunks.length; i++) {
            const achunk = this._audioChunks[i];
            const timeMs = Math.round(achunk.timestamp / 1000);
            const tc16 = Math.max(-32768, Math.min(32767, timeMs - clusterStartMs));
            const simpleBlockHeader = new Uint8Array(4);
            simpleBlockHeader[0] = 0x82;
            simpleBlockHeader[1] = (tc16 >> 8) & 0xFF;
            simpleBlockHeader[2] = tc16 & 0xFF;
            simpleBlockHeader[3] = 0x80;
            const blockData = new Uint8Array(4 + achunk.data.length);
            blockData.set(simpleBlockHeader);
            blockData.set(achunk.data, 4);
            clusterChildren.push(ebml(0xA3, blockData));
        }

        if (clusterChildren.length > 0) {
            clusters.push(ebml(0x1F43B675, clusterChildren));
        }

        const segContent = this._concatArrays([info, tracks, ...clusters]);
        const segHeader = this._ebmlId(0x18538067);
        const segSize = new Uint8Array([0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);

        parts.push(segHeader, segSize, segContent);
        return new Blob(parts as BlobPart[], { type: 'video/webm' });
    }

    private _ebml(id: number, content: Uint8Array | Uint8Array[]): Uint8Array {
        const idBytes = this._ebmlId(id);
        const data = Array.isArray(content) ? this._concatArrays(content) : content;
        const sizeBytes = this._ebmlSize(data.length);
        const result = new Uint8Array(idBytes.length + sizeBytes.length + data.length);
        result.set(idBytes);
        result.set(sizeBytes, idBytes.length);
        result.set(data, idBytes.length + sizeBytes.length);
        return result;
    }

    private _ebmlId(id: number): Uint8Array {
        if (id <= 0xFF) return new Uint8Array([id]);
        if (id <= 0xFFFF) return new Uint8Array([(id >> 8) & 0xFF, id & 0xFF]);
        if (id <= 0xFFFFFF) return new Uint8Array([(id >> 16) & 0xFF, (id >> 8) & 0xFF, id & 0xFF]);
        return new Uint8Array([(id >> 24) & 0xFF, (id >> 16) & 0xFF, (id >> 8) & 0xFF, id & 0xFF]);
    }

    private _ebmlSize(size: number): Uint8Array {
        if (size < 0x7F) return new Uint8Array([0x80 | size]);
        if (size < 0x3FFF) return new Uint8Array([0x40 | ((size >> 8) & 0x3F), size & 0xFF]);
        if (size < 0x1FFFFF) return new Uint8Array([0x20 | ((size >> 16) & 0x1F), (size >> 8) & 0xFF, size & 0xFF]);
        if (size < 0x0FFFFFFF) return new Uint8Array([
            0x10 | ((size >> 24) & 0x0F), (size >> 16) & 0xFF, (size >> 8) & 0xFF, size & 0xFF
        ]);

        const buf = new Uint8Array(8);
        buf[0] = 0x01;
        const dv = new DataView(buf.buffer);
        dv.setUint32(4, size >>> 0);
        return buf;
    }

    private _ebmlUint(val: number): Uint8Array {
        if (val <= 0xFF) return new Uint8Array([val]);
        if (val <= 0xFFFF) return new Uint8Array([(val >> 8) & 0xFF, val & 0xFF]);
        if (val <= 0xFFFFFF) return new Uint8Array([(val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF]);
        const buf = new Uint8Array(4);
        new DataView(buf.buffer).setUint32(0, val);
        return buf;
    }

    private _ebmlFloat64(val: number): Uint8Array {
        const buf = new Uint8Array(8);
        new DataView(buf.buffer).setFloat64(0, val);
        return buf;
    }

    private _concatArrays(arrays: Uint8Array[]): Uint8Array {
        let total = 0;
        for (const a of arrays) total += a.length;
        const result = new Uint8Array(total);
        let off = 0;
        for (const a of arrays) { result.set(a, off); off += a.length; }
        return result;
    }

    private _mp4Box(type: string, data: Uint8Array, entryCount?: number): Uint8Array {
        const hasEntry = entryCount !== undefined;
        const size = 8 + 4 + (hasEntry ? 4 : 0) + data.length;
        const buf = new Uint8Array(size);
        const dv = new DataView(buf.buffer);
        dv.setUint32(0, size);
        buf.set(TE.encode(type), 4);
        let off = 12;
        if (hasEntry) {
            dv.setUint32(off, entryCount!); off += 4;
        }
        buf.set(data, off);
        return buf;
    }

    private _mp4FullBox(type: string, data: Uint8Array, entryCount?: number): Uint8Array {
        const hasEntry = entryCount !== undefined;
        const size = 12 + (hasEntry ? 4 : 0) + data.length;
        const buf = new Uint8Array(size);
        new DataView(buf.buffer).setUint32(0, size);
        buf.set(TE.encode(type), 4);

        let off = 12;
        if (hasEntry) {
            new DataView(buf.buffer).setUint32(off, entryCount!);
            off += 4;
        }
        buf.set(data, off);
        return buf;
    }

    private _mp4Container(type: string, children: Uint8Array[]): Uint8Array {
        let childSize = 0;
        for (const c of children) childSize += c.length;
        const size = 8 + childSize;
        const buf = new Uint8Array(size);
        new DataView(buf.buffer).setUint32(0, size);
        buf.set(TE.encode(type), 4);
        let off = 8;
        for (const c of children) { buf.set(c, off); off += c.length; }
        return buf;
    }

    private _updateProgress(phase: TranscodeProgress['phase'], frames: number): void {
        this._progress = {
            phase, framesProcessed: frames,
            totalEstimate: Math.max(frames, this._progress.totalEstimate),
            percent: this._progress.totalEstimate > 0 ? frames / this._progress.totalEstimate * 100 : 0,
            elapsedMs: performance.now() - this._startTime
        };
        if (this._onProgress) this._onProgress(this._progress);
    }
}
