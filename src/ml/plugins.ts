import { AegisCore, AegisPluginHooks, Clip } from '../core/AegisCore';
import { VideoStabilizer } from './stabilize';
import { AISegmentEngine } from './segment';
import { detectOnsets } from './beatsync';
import { Aud } from '../media';
import { log } from '../core';

export interface StabilizePluginOpts {
    smoothing?: number;
    cropRatio?: number;
}

export function stabilizePlugin(opts: StabilizePluginOpts = {}): AegisPluginHooks {
    let stabilizer: VideoStabilizer | null = null;
    const corrections = new Map<string, { dx: number; dy: number }[]>();

    return {
        init(core: AegisCore) {
            stabilizer = new VideoStabilizer(core.config.width, core.config.height);
            stabilizer.init().catch(e => log.warn('[StabilizePlugin] init failed', e));
        },
        onBeforeFrame(core: AegisCore, clips: Clip[], ms: number) {
            if (!stabilizer) return;
            for (const clip of clips) {
                if (clip.type !== 'video' || !clip.source) continue;
                const corrs = corrections.get(clip.id);
                if (!corrs) continue;
                const frameIdx = Math.round(ms / (1000 / core.config.fps));
                if (frameIdx >= 0 && frameIdx < corrs.length) {
                    clip.x = (typeof clip.x === 'number' ? clip.x : 0) + corrs[frameIdx].dx * core.config.width;
                    clip.y = (typeof clip.y === 'number' ? clip.y : 0) + corrs[frameIdx].dy * core.config.height;
                }
            }
        }
    };
}

export interface SegmentPluginOpts {
    modelSize?: number;
    threshold?: number;
    background?: 'blur' | 'remove' | 'replace';
}

export function segmentPlugin(opts: SegmentPluginOpts = {}): AegisPluginHooks {
    let engine: AISegmentEngine | null = null;
    let ready = false;

    return {
        async init(_core: AegisCore) {
            const S = opts.modelSize || 256;
            engine = new AISegmentEngine(S, S);
            try {
                await engine.init();
                ready = true;
                log.info('[SegmentPlugin] initialized');
            } catch (e) {
                log.warn('[SegmentPlugin] init failed — segmentation disabled', e);
            }
        },
        onBeforeFrame(_core: AegisCore, clips: Clip[], _ms: number) {
            if (!ready || !engine) return;
            for (const clip of clips) {
                if (clip.type !== 'video' && clip.type !== 'image') continue;
                if (!clip.meta?.['segmentEnabled']) continue;
                clip.meta['_segEngine'] = engine;
                clip.meta['_segMode'] = opts.background || 'blur';
            }
        }
    };
}

export interface BeatsyncPluginOpts {
    threshold?: number;
}

export function beatsyncPlugin(opts: BeatsyncPluginOpts = {}): AegisPluginHooks {
    const beatTimestamps: number[] = [];
    let analyzed = false;

    return {
        init(core: AegisCore) {
            const audioClips = core.timeline.clips.filter(c => c.type === 'audio');
            if (audioClips.length === 0) return;

            for (const clip of audioClips) {
                if (!(clip.source instanceof Aud)) continue;
                const buffer = clip.source.b;
                if (!buffer) continue;
                try {
                    const channelData = buffer.getChannelData(0);
                    const { peaks } = detectOnsets(channelData, buffer.sampleRate, opts.threshold || 1.4);
                    for (const p of peaks) {
                        beatTimestamps.push(clip.start + p);
                    }
                    log.info(`[BeatsyncPlugin] detected ${peaks.length} beats`);
                } catch (e) {
                    log.warn('[BeatsyncPlugin] beat detection failed', e);
                }
            }
            beatTimestamps.sort((a, b) => a - b);
            analyzed = true;
        },
        onBeforeFrame(core: AegisCore, clips: Clip[], ms: number) {
            if (!analyzed || beatTimestamps.length === 0) return;
            const halfFrame = 1000 / core.config.fps / 2;
            const nearestBeat = beatTimestamps.find(b => Math.abs(b - ms) < halfFrame);
            if (nearestBeat !== undefined) {
                for (const clip of clips) {
                    if (clip.meta?.['beatsyncEnabled']) {
                        clip.meta['_onBeat'] = true;
                        clip.meta['_beatMs'] = nearestBeat;
                    }
                }
            }
        }
    };
}
