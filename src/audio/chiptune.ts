import { AegisCore, AegisPlugin, Clip } from '../core/AegisCore';
import { log } from '../core';
import { Aud } from '../media';

export interface ChiptuneOpts {
    notes: string;
    bpm?: number;
    wave?: OscillatorType;
    startMs?: number;
}

export function chiptune(opts: ChiptuneOpts): AegisPlugin {
    return (core: AegisCore) => {
        const bpm = opts.bpm || 120;
        const noteDurationMs = (60 / bpm) * 1000;
        const startMs = opts.startMs || 0;

        const noteFreqs: { [key: string]: number } = {
            "C4": 261.63, "C#4": 277.18, "D4": 293.66, "D#4": 311.13,
            "E4": 329.63, "F4": 349.23, "F#4": 369.99, "G4": 392.00,
            "G#4": 415.30, "A4": 440.00, "A#4": 466.16, "B4": 493.88,
            "C5": 523.25, "E5": 659.25, "G5": 783.99, "REST": 0
        };

        const notes = opts.notes.split(/\s+/).map(n => n.toUpperCase());
        const totalDurationMs = notes.length * noteDurationMs;

        const sampleRate = core.config.audio?.sampleRate || 48000;
        const offlineCtx = new OfflineAudioContext(2, sampleRate * (totalDurationMs / 1000), sampleRate);

        notes.forEach((note, index) => {
            const freq = noteFreqs[note] || noteFreqs["REST"];
            if (freq > 0) {
                const osc = offlineCtx.createOscillator();
                const gain = offlineCtx.createGain();

                osc.type = opts.wave || "square";
                osc.frequency.setValueAtTime(freq, offlineCtx.currentTime);

                const startTime = index * (noteDurationMs / 1000);
                const stopTime = startTime + (noteDurationMs / 1000);

                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(0.5, startTime + 0.05);
                gain.gain.setValueAtTime(0.5, stopTime - 0.05);
                gain.gain.linearRampToValueAtTime(0, stopTime);

                osc.connect(gain);
                gain.connect(offlineCtx.destination);

                osc.start(startTime);
                osc.stop(stopTime);
            }
        });

        offlineCtx.startRendering().then((renderedBuffer) => {
            const audSource = new Aud(renderedBuffer);
            core.input(audSource, { start: startMs, duration: totalDurationMs, layer: -1 });
        }).catch(err => {
            log.error('Chiptune render failed', err);
        });
    };
}
