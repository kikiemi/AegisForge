import { AegisCore, AegisPlugin } from '../core/AegisCore';
import { Aud } from '../media';

export interface BinauralOpts {
    baseFreq?: number;
    beatFreq?: number;
    durationMs?: number;
    startMs?: number;
    volume?: number;
}

export function binauralBeats(opts: BinauralOpts = {}): AegisPlugin {
    return async (core: AegisCore) => {
        const baseFreq = opts.baseFreq || 400;
        const beatFreq = opts.beatFreq || 10;
        const durationMs = opts.durationMs || 10000;
        const startMs = opts.startMs || 0;
        const volume = opts.volume ?? 0.5;

        const sampleRate = core.config.audio?.sampleRate || 48000;
        const offlineCtx = new OfflineAudioContext(2, sampleRate * (durationMs / 1000), sampleRate);

        const oscL = offlineCtx.createOscillator();
        const pannerL = offlineCtx.createStereoPanner();
        oscL.frequency.value = baseFreq;
        pannerL.pan.value = -1;

        const oscR = offlineCtx.createOscillator();
        const pannerR = offlineCtx.createStereoPanner();
        oscR.frequency.value = baseFreq + beatFreq;
        pannerR.pan.value = 1;

        const masterGain = offlineCtx.createGain();
        masterGain.gain.value = volume;

        oscL.connect(pannerL);
        pannerL.connect(masterGain);

        oscR.connect(pannerR);
        pannerR.connect(masterGain);

        masterGain.connect(offlineCtx.destination);

        oscL.start();
        oscR.start();
        oscL.stop(durationMs / 1000);
        oscR.stop(durationMs / 1000);

        const renderedBuffer = await offlineCtx.startRendering();
        core.input(new Aud(renderedBuffer), { start: startMs, duration: durationMs, layer: -1 });
    };
}
