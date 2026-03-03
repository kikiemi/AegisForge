import { Vid } from '../codec';
import {
    log, AegisError, ResourceManager, TimestampSync,
    KeyframeEngine, BezierKeyframeEngine, BezierKey,
    CatmullRomPath, Vec2, RationalTimecode, SlabAllocator
} from '../core';
import { IntervalTree, type Interval } from './interval_tree';
import { Aud, Img } from '../media';
import { GL, MultiLayerCompositor, FBOChain, bindVideoFrameTexture, Shaders, type LayerDesc, type BlendMode } from '../gl';

export type AnimatableNumber = number | KeyframeEngine | BezierKeyframeEngine;

export interface ClipOpts {
    start: number;
    end?: number;
    duration?: number;
    layer?: number;
    opacity?: AnimatableNumber;
    audioVolume?: AnimatableNumber;
    x?: AnimatableNumber; y?: AnimatableNumber;
    w?: AnimatableNumber; h?: AnimatableNumber;
    scaleX?: AnimatableNumber; scaleY?: AnimatableNumber;
    blend?: BlendMode;

    path?: CatmullRomPath;

    timeRemap?: BezierKeyframeEngine;

    proxyUrl?: string;
}

export type ClipType = 'video' | 'audio' | 'image' | 'text' | 'comp' | 'custom';

export interface Clip {
    id: string;
    type: ClipType;
    source: Img | Aud | HTMLVideoElement | ImageBitmap | HTMLImageElement | null;
    start: number;
    end: number;
    layer: number;
    opacity: AnimatableNumber;
    x: AnimatableNumber; y: AnimatableNumber;
    w: AnimatableNumber; h: AnimatableNumber;
    scaleX: AnimatableNumber; scaleY: AnimatableNumber;
    blend: BlendMode;
    path?: CatmullRomPath;
    timeRemap?: BezierKeyframeEngine;
    proxyUrl?: string;
    audioVolume: AnimatableNumber;

    meta?: Record<string, unknown>;
}

export interface CompClip extends Clip {
    type: 'comp';
    subTimeline: Timeline;
}

export interface Timeline {
    duration: number;
    clips: Clip[];
}

export interface AegisPluginHooks {
    init?: (core: AegisCore) => void;
    onBeforeFrame?: (core: AegisCore, clips: Clip[], ms: number) => void;
    onAfterFrame?: (core: AegisCore, idx: number) => void;
    dispose?: () => void;
}

export type AegisPlugin = ((core: AegisCore) => void) | AegisPluginHooks;

export class AegisCore {
    public config: {
        width: number; height: number; fps: number; bitrate: number;
        vCodec: string;
        audio: { numberOfChannels: number; sampleRate: number } | null;
        preset: 'fast' | 'balanced' | 'quality';
        trim: { start: number; end: number } | null;
        crop: { x: number; y: number; w: number; h: number } | null;

        useProxy: boolean;

        hdr: boolean;
        gopSize: number;
    } = {
            width: 1280, height: 720, fps: 30, bitrate: 2_000_000,
            vCodec: 'vp8', audio: null, preset: 'balanced',
            trim: null, crop: null, useProxy: false, hdr: false, gopSize: 0
        };

    public timeline: Timeline = { duration: 0, clips: [] };
    public plugins: Set<AegisPlugin> = new Set();
    public onProgress: ((percent: number) => void) | null = null;
    public logPrefix = '[AegisCore V5]';

    public currentMs: number = 0;

    public ctx: null = null;

    private _compositor: MultiLayerCompositor | null = null;
    private _acesGL: GL | null = null;
    private _fboChain: FBOChain | null = null;

    private _texCache: Map<string, WebGLTexture> = new Map();
    private _proxyCache: Map<string, ImageBitmap> = new Map();
    private _emptyBitmap: ImageBitmap | null = null;

    constructor() { }

    public use(plugin: AegisPlugin): AegisCore {
        this.plugins.add(plugin);
        if (typeof plugin === 'function') plugin(this);
        else if (plugin.init) plugin.init(this);
        return this;
    }

    public input(source: Img | Aud | HTMLVideoElement | HTMLImageElement | ImageBitmap | Record<string, unknown> | (Img | Aud | HTMLVideoElement | HTMLImageElement | ImageBitmap | Record<string, unknown>)[], opts?: ClipOpts): AegisCore {
        if (Array.isArray(source)) {
            let cur = opts?.start || 0;
            for (const s of source) {
                this.input(s, { ...opts, start: cur });
                cur += (opts?.duration || 1000);
            }
            return this;
        }

        const type: ClipType =
            source instanceof Aud ? 'audio' :
                (source && typeof source === 'object' && '_isComp' in source) ? 'comp' :
                    (source instanceof HTMLVideoElement || (source && typeof source === 'object' && '_isVid' in source)) ? 'video' : 'image';

        const start = opts?.start || 0;
        const end = opts?.end || (opts?.duration ? start + opts.duration : start + 1000);

        const clip: Clip = {
            id: Math.random().toString(36).slice(2, 9),
            type, source: (source instanceof Img || source instanceof Aud || source instanceof HTMLVideoElement || source instanceof ImageBitmap || source instanceof HTMLImageElement) ? source : null, start, end,
            layer: opts?.layer ?? 0,
            x: opts?.x ?? 0, y: opts?.y ?? 0,
            w: opts?.w ?? this.config.width, h: opts?.h ?? this.config.height,
            scaleX: opts?.scaleX ?? 1.0, scaleY: opts?.scaleY ?? 1.0,
            opacity: opts?.opacity ?? 1.0,
            blend: opts?.blend ?? 'normal',
            audioVolume: opts?.audioVolume ?? 1.0,
            path: opts?.path,
            timeRemap: opts?.timeRemap,
            proxyUrl: opts?.proxyUrl
        };

        this.timeline.clips.push(clip);
        this.timeline.clips.sort((a, b) => a.layer - b.layer);
        if (end > this.timeline.duration) this.timeline.duration = end;
        return this;
    }

    public precompose(subClips: Clip[], opts?: ClipOpts): AegisCore {
        const subTimeline: Timeline = {
            duration: subClips.reduce((m, c) => Math.max(m, c.end), 0),
            clips: subClips
        };

        const start = opts?.start || 0;
        const end = opts?.end || (opts?.duration ? start + opts.duration : start + subTimeline.duration);
        const clip: CompClip = {
            id: Math.random().toString(36).slice(2, 9),
            type: 'comp', source: null,
            subTimeline, start, end,
            layer: opts?.layer ?? 0,
            x: opts?.x ?? 0, y: opts?.y ?? 0,
            w: opts?.w ?? this.config.width, h: opts?.h ?? this.config.height,
            scaleX: opts?.scaleX ?? 1.0, scaleY: opts?.scaleY ?? 1.0,
            opacity: opts?.opacity ?? 1.0, blend: opts?.blend ?? 'normal',
            audioVolume: 1.0
        };
        this.timeline.clips.push(clip);
        this.timeline.clips.sort((a, b) => a.layer - b.layer);
        if (end > this.timeline.duration) this.timeline.duration = end;
        return this;
    }

    private _val(v: AnimatableNumber, timeMs: number): number {
        if (typeof v === 'number') return v;
        if (typeof v === 'object' && v !== null && 'get' in v) return (v as KeyframeEngine).get(timeMs / 1000);
        return 0;
    }

    private _clipRect(clip: Clip, timeMs: number): { x: number; y: number; w: number; h: number } {
        let x = this._val(clip.x, timeMs);
        let y = this._val(clip.y, timeMs);
        const w = this._val(clip.w, timeMs) || this.config.width;
        const h = this._val(clip.h, timeMs) || this.config.height;

        if (clip.path) {
            const t = (timeMs - clip.start) / Math.max(1, clip.end - clip.start);
            const pt = clip.path.getPoint(Math.max(0, Math.min(1, t)));
            x = pt.x; y = pt.y;
        }
        return { x, y, w, h };
    }

    private _remapTime(clip: Clip, absoluteMs: number): number {
        const relT = (absoluteMs - clip.start) / Math.max(1, clip.end - clip.start);
        if (!clip.timeRemap) return absoluteMs - clip.start;
        const remapped = clip.timeRemap.get(relT);
        return remapped * Math.max(1, clip.end - clip.start);
    }

    private _initGL(): void {
        if (this._compositor) return;
        this._compositor = new MultiLayerCompositor(this.config.width, this.config.height);
        if (this.config.hdr) {
            this._acesGL = new GL(this.config.width, this.config.height, { hdr: true });
            this._acesGL.loadFragmentShader(Shaders.ACESToneMap);
            this._fboChain = new FBOChain(
                this._compositor.gl,
                this.config.width, this.config.height,
                true
            );
        }
    }

    private _getTex(clipId: string): WebGLTexture {
        if (!this._texCache.has(clipId)) {
            const gl = this._compositor!.gl;
            const tex = gl.createTexture();
            if (!tex) throw new AegisError('Failed to create texture for clip ' + clipId);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.bindTexture(gl.TEXTURE_2D, null);
            this._texCache.set(clipId, tex);
        }
        return this._texCache.get(clipId)!;
    }

    private async _renderFrame(activeClips: Clip[], timeMs: number): Promise<ImageBitmap> {
        const gl = this._compositor!.gl;
        const layers: LayerDesc[] = [];
        const W = this.config.width, H = this.config.height;

        for (const clip of activeClips) {
            if (clip.type === 'audio') continue;

            const { x, y, w, h } = this._clipRect(clip, timeMs);
            const opacity = this._val(clip.opacity, timeMs);
            const tex = this._getTex(clip.id);

            if (clip.type === 'video' || clip.type === 'image') {
                const sourceTimeMs = this._remapTime(clip, timeMs);
                let imgSource: TexImageSource | null = null;

                if (clip.proxyUrl && this.config.useProxy) {
                    if (this._proxyCache.has(clip.proxyUrl)) {
                        const cached = this._proxyCache.get(clip.proxyUrl);
                        if (cached) imgSource = cached;
                    } else {
                        try {
                            const bmp = await createImageBitmap(await (await fetch(clip.proxyUrl)).blob());
                            this._proxyCache.set(clip.proxyUrl, bmp);
                            imgSource = bmp;
                        } catch {
                            this._proxyCache.set(clip.proxyUrl, null as unknown as ImageBitmap);
                        }
                    }
                } else if (clip.source instanceof HTMLVideoElement) {
                    const targetSec = sourceTimeMs / 1000;
                    if (clip.source.readyState >= 2 && Math.abs(clip.source.currentTime - targetSec) > 0.04) {
                        const el = clip.source;
                        clip.source.currentTime = targetSec;
                        await new Promise<void>(resolve => {
                            try {
                                el.requestVideoFrameCallback(() => resolve());
                            } catch {
                                const onSeeked = () => { el.removeEventListener('seeked', onSeeked); resolve(); };
                                el.addEventListener('seeked', onSeeked);
                                setTimeout(resolve, 100);
                            }
                        });
                    }
                    imgSource = clip.source;
                } else if (clip.source instanceof Img && clip.source.c) {
                    imgSource = clip.source.c;
                } else if (clip.source instanceof ImageBitmap || clip.source instanceof HTMLImageElement) {
                    imgSource = clip.source;
                } else if ((clip.type as string) === 'comp') {

                    imgSource = await this._renderComp(clip as CompClip, timeMs);
                }

                if (imgSource) {
                    bindVideoFrameTexture(gl, tex, imgSource as TexImageSource, 0);

                    layers.push({
                        texture: tex,
                        opacity,
                        blend: clip.blend || 'normal',
                        rect: [x / W, y / H, w / W, h / H]
                    });
                }

            } else if (clip.type === 'text' || clip.type === 'custom') {

                if (clip.meta?.gpuTexture) {
                    layers.push({
                        texture: clip.meta.gpuTexture as WebGLTexture,
                        opacity, blend: clip.blend || 'normal',
                        rect: [x / W, y / H, w / W, h / H]
                    });
                }
            }
        }

        if (layers.length === 0) {
            if (!this._emptyBitmap) {
                const tmp = new OffscreenCanvas(Math.max(1, W), Math.max(1, H));
                this._emptyBitmap = await createImageBitmap(tmp);
                tmp.width = tmp.height = 0;
            }
            return this._emptyBitmap;
        }

        this._compositor!.composite(layers);
        return this._compositor!.canvas.transferToImageBitmap();
    }

    private async _renderComp(comp: CompClip, masterMs: number): Promise<ImageBitmap> {
        const localMs = masterMs - comp.start;
        const active = comp.subTimeline.clips.filter(c => localMs >= c.start && localMs < c.end);
        return this._renderFrame(active, localMs);
    }

    public async save(filename: string = 'output.webm'): Promise<File | void> {
        const isStream = typeof filename === 'object' && filename !== null && 'getWriter' in (filename as Record<string, unknown>);
        const finalFilename = isStream ? 'stream.webm' : String(filename);
        const res = new ResourceManager();

        this._initGL();

        let vid: Vid | null = null;
        try {
            const vidConfig = {
                video: {
                    width: this.config.width, height: this.config.height,
                    framerate: this.config.fps, bitrate: this.config.bitrate,
                    codec: this.config.vCodec, preset: this.config.preset
                },
                audio: this.config.audio,
                stream: isStream ? filename : undefined,
                mp4Container: finalFilename.toLowerCase().endsWith('.mp4') || finalFilename.toLowerCase().endsWith('.m4v'),
                directToDisk: false
            };

            vid = new Vid(vidConfig);
            await vid.init();
            res.track(vid);

            const ts = new TimestampSync(this.config.fps, this.config.audio?.sampleRate || 48000);
            const rtc = new RationalTimecode(this.config.fps);

            const trimStartMs = this.config.trim ? this.config.trim.start : 0;
            const trimEndMs = this.config.trim ? this.config.trim.end : (this.timeline.duration || 1000);
            const frameDuration = 1000 / this.config.fps;
            const totalFrames = Math.ceil((trimEndMs - trimStartMs) / frameDuration);
            const frameDurUs = Math.max(1, Math.round(1_000_000 / this.config.fps));

            let audioIterator: AsyncGenerator<{ audioData: { timestamp: number; close: () => void }; framesCount: number; timeMs: number }> | null = null;
            let audioDone = true;
            const audioClips = this.timeline.clips.filter(c => c.type === 'audio');
            if (audioClips.length > 0 && this.config.audio) {
                const sr = this.config.audio.sampleRate || 48000;
                const ch = this.config.audio.numberOfChannels || 2;
                const audInputs = audioClips
                    .map(c => ({ aud: c.source instanceof Aud ? c.source : null, start: c.start, volume: typeof c.audioVolume === 'number' ? c.audioVolume : 1.0 }))
                    .filter(x => x.aud) as { aud: Aud; start: number; volume: number }[];
                if (audInputs.length > 0) {
                    audioIterator = Aud.mixWebStreams(audInputs, sr, ch, 8192);
                    audioDone = false;
                }
            }

            const clipTree = new IntervalTree();
            clipTree.buildFromClips(this.timeline.clips.map(c => ({
                id: c.id, inPoint: c.start, outPoint: c.end, data: c
            })));

            const gopSize = this.config.gopSize > 0 ? this.config.gopSize : Math.round(this.config.fps * 2);
            for (let fIdx = 0; fIdx < totalFrames; fIdx++) {
                this.currentMs = trimStartMs + fIdx * frameDuration;
                const intervals = clipTree.queryPoint(this.currentMs);
                const activeClips = intervals.map((iv: Interval) => iv.data as Clip);

                for (const p of this.plugins) { if (typeof p !== 'function' && p.onBeforeFrame) p.onBeforeFrame(this, activeClips, this.currentMs); }

                const bitmap = await this._renderFrame(activeClips, this.currentMs);
                const tRelUs = Math.max(0, Math.round((this.currentMs - trimStartMs) * 1000));

                const vf = new VideoFrame(bitmap, { timestamp: tRelUs, duration: frameDurUs, alpha: 'discard' });
                if (bitmap !== this._emptyBitmap) bitmap.close();

                try {
                    await vid.pushVid(vf, fIdx % gopSize === 0);
                } catch (pushErr) {
                    try { vf.close(); } catch (_) { }
                    throw pushErr;
                }

                for (const p of this.plugins) { if (typeof p !== 'function' && p.onAfterFrame) p.onAfterFrame(this, fIdx); }

                if (fIdx % 60 === 0) await new Promise(r => setTimeout(r, 0));
                if (this.onProgress) {
                    try {
                        this.onProgress(Math.min(100, Math.floor(((this.currentMs - trimStartMs) / (trimEndMs - trimStartMs)) * 100)));
                    } catch (_) { }
                }

                if (audioIterator && !audioDone) {
                    while (!audioDone && (ts.peekAudioPts() / 1000) <= this.currentMs) {
                        let audioData: { timestamp: number; close: () => void } | null = null;
                        try {
                            const result = await audioIterator.next();
                            if (result.done) { audioDone = true; break; }
                            audioData = result.value.audioData;
                            const aPts = audioData.timestamp / 1000;
                            if (aPts >= trimStartMs && aPts <= trimEndMs) {
                                await vid.pushAud(audioData);
                            } else {
                                audioData.close();
                            }
                            audioData = null;
                        } catch (audioErr) {
                            if (audioData) { try { audioData.close(); } catch (_) { } }
                            log.warn('[AegisCore] Audio push error', audioErr);
                        }
                    }
                }
            }

            if (this.onProgress) this.onProgress(100);

            if (audioIterator && !audioDone) {
                while (true) {
                    let audioData: { timestamp: number; close: () => void } | null = null;
                    try {
                        const r = await audioIterator.next();
                        if (r.done) break;
                        audioData = r.value.audioData;
                        if (audioData.timestamp / 1000 <= trimEndMs) {
                            await vid.pushAud(audioData);
                        } else { audioData.close(); break; }
                        audioData = null;
                    } catch (audioErr) {
                        if (audioData) { try { audioData.close(); } catch (_) { } }
                        log.warn('[AegisCore] Audio drain error', audioErr);
                    }
                }
            }

            log.info(this.logPrefix, 'Flushing to muxer...');
            const buffer = await vid.flush();

            if (isStream) return;

            const mimeType = finalFilename.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4';
            const fileBlocks = Array.isArray(buffer) ? buffer : [buffer];
            const fileObj = new File(fileBlocks, finalFilename, { type: mimeType });

            const url = URL.createObjectURL(fileObj);
            const a = document.createElement('a');
            a.href = url; a.download = finalFilename;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            return fileObj;

        } catch (err: unknown) {
            log.error(this.logPrefix, err);
            throw err;
        } finally {
            if (vid) try { vid.close(); } catch (_) { }
            res.closeAll();
        }
    }

    public dispose(): void {
        for (const p of this.plugins) {
            if (typeof p !== 'function' && p.dispose) {
                try { p.dispose(); } catch (_) { }
            }
        }
        this._texCache.forEach(t => this._compositor?.gl.deleteTexture(t));
        this._texCache.clear();
        for (const bmp of this._proxyCache.values()) {
            try { bmp.close(); } catch (_) { }
        }
        this._proxyCache.clear();
        this._fboChain?.dispose();
        if (this._compositor) {
            const gl = this._compositor.gl;
            const ext = gl.getExtension('WEBGL_lose_context');
            if (ext) ext.loseContext();
        }
        if (this._acesGL) {
            const gl2 = this._acesGL.gl;
            const ext2 = gl2.getExtension('WEBGL_lose_context');
            if (ext2) ext2.loseContext();
        }
        this._compositor = null;
        this._acesGL = null;
        this._fboChain = null;
    }
}
