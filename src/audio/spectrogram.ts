import { AegisCore, AegisPlugin } from '../core/AegisCore';
import { Aud, Img } from '../media';

export interface SpectrogramOpts {
    imageSrc: string | Blob | File;
    startMs?: number;
    durationMs?: number;
    minFreq?: number;
    maxFreq?: number;
}

export function spectrogramStego(opts: SpectrogramOpts): AegisPlugin {
    return async (core: AegisCore) => {
        const startMs = opts.startMs || 0;
        const durationMs = opts.durationMs || 5000;
        const minFreq = opts.minFreq || 200;
        const maxFreq = opts.maxFreq || 15000;

        const sampleRate = core.config.audio?.sampleRate || 48000;
        const offlineCtx = new OfflineAudioContext(1, sampleRate * (durationMs / 1000), sampleRate);

        const imgWrap = await Img.load(opts.imageSrc);
        if (!imgWrap.c) { imgWrap.close(); return; }

        const width = 100;
        const height = 64;

        const scratchCanvas = new OffscreenCanvas(width, height);
        const scratchCtx = scratchCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        scratchCtx.drawImage(imgWrap.c as CanvasImageSource, 0, 0, width, height);

        const imgData = scratchCtx.getImageData(0, 0, width, height);
        const data = imgData.data;

        const timeStep = durationMs / 1000 / width;
        const freqStep = (maxFreq - minFreq) / height;

        for (let y = 0; y < height; y++) {
            const freq = maxFreq - (y * freqStep);

            const osc = offlineCtx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = freq;

            const gainNode = offlineCtx.createGain();
            gainNode.gain.setValueAtTime(0, 0);

            let activePoints = 0;

            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];

                const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;

                const timePos = x * timeStep;

                if (brightness > 0.05) {
                    gainNode.gain.linearRampToValueAtTime(brightness * 0.01, timePos);
                    activePoints++;
                } else if (activePoints > 0) {
                    gainNode.gain.linearRampToValueAtTime(0, timePos);
                }
            }

            if (activePoints > 0) {
                osc.connect(gainNode);
                gainNode.connect(offlineCtx.destination);
                osc.start(0);
                osc.stop(durationMs / 1000);
            }
        }

        imgWrap.close();

        const renderedBuffer = await offlineCtx.startRendering();
        core.input(new Aud(renderedBuffer), { start: startMs, duration: durationMs, layer: -1 });
    };
}
