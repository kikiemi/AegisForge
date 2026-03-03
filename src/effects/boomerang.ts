import { AegisCore, AegisPlugin, Clip } from '../core/AegisCore';
import { BezierKeyframeEngine, BezierKey } from '../core';

export interface BoomerangOpts {
    targetClipIds?: string[];
    loopCount?: number;
}

export function boomerang(opts: BoomerangOpts = {}): AegisPlugin {
    return (core: AegisCore) => {
        const loops = opts.loopCount || 1;
        const targets = opts.targetClipIds || [];

        core.timeline.clips.forEach(clip => {
            if (clip.type !== 'video') return;
            if (targets.length > 0 && !targets.includes(clip.id)) return;

            const originalDuration = clip.end - clip.start;
            const cycleDurationSec = originalDuration / 1000;
            const totalDuration = originalDuration * loops * 2;

            clip.end = clip.start + totalDuration;

            const keys: BezierKey[] = [];
            for (let i = 0; i < loops; i++) {
                const cycleStartSec = i * cycleDurationSec * 2;

                keys.push({
                    t: cycleStartSec,
                    v: 0,
                    cp: [0.33, 0.33, 0.66, 0.66]
                });

                keys.push({
                    t: cycleStartSec + cycleDurationSec,
                    v: cycleDurationSec,
                    cp: [0.33, 0.66, 0.66, 0.33]
                });

                if (i === loops - 1) {
                    keys.push({
                        t: cycleStartSec + cycleDurationSec * 2,
                        v: 0
                    });
                }
            }

            clip.timeRemap = new BezierKeyframeEngine(keys);
        });
    };
}

export class BoomerangEngine {
    public static computeTime(
        currentMs: number,
        clipStartMs: number,
        originalDurationMs: number,
        loopCount: number = 1
    ): number {
        const elapsed = currentMs - clipStartMs;
        const cycleDuration = originalDurationMs;
        const fullCycle = cycleDuration * 2;
        const phase = elapsed % fullCycle;

        if (phase < cycleDuration) {
            return phase;
        }
        return fullCycle - phase;
    }
}
