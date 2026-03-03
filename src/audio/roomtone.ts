import { AegisCore, AegisPlugin } from '../core/AegisCore';
import { log } from '../core';
import { Aud } from '../media';

export interface RoomToneOpts {
    startMs?: number;
    durationMs?: number;
    volume?: number;
    type?: 'white' | 'pink' | 'brown';
}

export function roomTone(opts: RoomToneOpts = {}): AegisPlugin {
    return async (core: AegisCore) => {
        const startMs = opts.startMs || 0;
        const durationMs = opts.durationMs || (core.timeline.duration ? core.timeline.duration : 10000);
        const volume = opts.volume ?? 0.1;
        const noiseType = opts.type || 'white';

        const sampleRate = core.config.audio?.sampleRate || 48000;
        const offlineCtx = new OfflineAudioContext(2, sampleRate * (durationMs / 1000), sampleRate);

        const bufferSize = sampleRate * (durationMs / 1000);
        const noiseBuffer = offlineCtx.createBuffer(2, bufferSize, sampleRate);
        const outputL = noiseBuffer.getChannelData(0);
        const outputR = noiseBuffer.getChannelData(1);

        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

        for (let i = 0; i < bufferSize; i++) {
            let white = Math.random() * 2 - 1;

            if (noiseType === 'pink') {
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.96900 * b2 + white * 0.1538520;
                b3 = 0.86650 * b3 + white * 0.3104856;
                b4 = 0.55000 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.0168980;
                let pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
                pink *= 0.11;
                b6 = white * 0.115926;
                white = pink;
            } else if (noiseType === 'brown') {
                white = (b0 + (0.02 * white)) / 1.02;
                b0 = white;
                white *= 3.5;
            }

            outputL[i] = white;
            outputR[i] = white;
        }

        const noiseSource = offlineCtx.createBufferSource();
        noiseSource.buffer = noiseBuffer;

        const gainNode = offlineCtx.createGain();
        gainNode.gain.value = volume;

        const filter = offlineCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1000;

        noiseSource.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(offlineCtx.destination);
        noiseSource.start();

        try {
            const renderedBuffer = await offlineCtx.startRendering();
            const audSource = new Aud(renderedBuffer);
            core.input(audSource, { start: startMs, duration: durationMs, layer: -1 });
        } catch (err) {
            log.error('Room tone render failed', err as Error);
        }
    };
}
