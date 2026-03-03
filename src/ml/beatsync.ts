import { AegisCore, AegisPlugin } from '../core/AegisCore';
import { Aud } from '../media';
import { log } from '../core';
import { FFT, hannWindow, magnitude } from '../audio/fft';

export interface BeatSyncOpts {
    audioTargetId: string;
    videoTargetIds: string[];
    threshold?: number;
    bpmRange?: [number, number];
}

export interface BeatInfo {
    peaks: number[];
    bpm: number;
}

function detectOnsets(channelData: Float32Array, sampleRate: number, thresholdMul: number = 1.4): BeatInfo {
    const fftSize = 1024;
    const hopSize = fftSize >> 1;
    const window = hannWindow(fftSize);
    const fft = new FFT(fftSize);

    const numFrames = Math.floor((channelData.length - fftSize) / hopSize) + 1;
    const spectralFlux: number[] = [];
    let prevMag = new Float64Array(fftSize >> 1);

    for (let f = 0; f < numFrames; f++) {
        const offset = f * hopSize;
        const real = new Float64Array(fftSize);
        const imag = new Float64Array(fftSize);
        for (let i = 0; i < fftSize; i++) {
            real[i] = (channelData[offset + i] || 0) * window[i];
        }
        fft.forward(real, imag);
        const mag = magnitude(real, imag);

        let flux = 0;
        const halfN = fftSize >> 1;
        for (let k = 0; k < halfN; k++) {
            const diff = mag[k] - prevMag[k];
            if (diff > 0) flux += diff;
        }
        spectralFlux.push(flux);
        prevMag = Float64Array.from(mag.subarray(0, halfN));
    }

    const medianWin = 16;
    const peaks: number[] = [];
    for (let i = medianWin; i < spectralFlux.length - medianWin; i++) {
        const window2: number[] = [];
        for (let j = i - medianWin; j <= i + medianWin; j++) {
            window2.push(spectralFlux[j]);
        }
        window2.sort((a, b) => a - b);
        const median = window2[window2.length >> 1];
        const adaptiveThreshold = median * thresholdMul + 0.01;

        if (spectralFlux[i] > adaptiveThreshold &&
            spectralFlux[i] >= spectralFlux[i - 1] &&
            spectralFlux[i] >= spectralFlux[i + 1]) {
            const timeMs = (i * hopSize / sampleRate) * 1000;
            if (peaks.length === 0 || timeMs - peaks[peaks.length - 1] > 100) {
                peaks.push(timeMs);
            }
        }
    }

    const bpm = estimateBPM(peaks, 60, 200);
    return { peaks, bpm };
}

function estimateBPM(peaks: number[], minBPM: number, maxBPM: number): number {
    if (peaks.length < 4) return 120;

    const intervals: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
        const d = peaks[i] - peaks[i - 1];
        if (d > 0) intervals.push(d);
    }
    if (intervals.length < 2) return 120;

    const minInterval = 60000 / maxBPM;
    const maxInterval = 60000 / minBPM;

    const histogram = new Map<number, number>();
    for (const iv of intervals) {
        if (iv < minInterval || iv > maxInterval) continue;
        const bucket = Math.round(iv / 10) * 10;
        histogram.set(bucket, (histogram.get(bucket) || 0) + 1);
    }

    let bestBucket = 500, bestCount = 0;
    for (const [bucket, count] of histogram) {
        if (count > bestCount) { bestCount = count; bestBucket = bucket; }
    }

    return Math.round(60000 / bestBucket);
}

export function autoBeatSync(opts: BeatSyncOpts): AegisPlugin {
    return (core: AegisCore) => {
        const threshold = opts.threshold || 1.4;

        const audioClip = core.timeline.clips.find(c => c.id === opts.audioTargetId);
        if (!audioClip || !(audioClip.source instanceof Aud)) {
            log.warn('AutoBeatSync: Audio target not found or invalid.');
            return;
        }

        const aud = audioClip.source as Aud;
        const buffer = aud.b;

        if (!buffer) {
            log.warn('AutoBeatSync: Unresolved Aud buffer.');
            return;
        }

        const channelData = buffer.getChannelData(0);
        const sampleRate = buffer.sampleRate;
        const { peaks, bpm } = detectOnsets(channelData, sampleRate, threshold);

        log.info(`AutoBeatSync: Detected ${peaks.length} beats, estimated BPM: ${bpm}`);

        const videoClips = core.timeline.clips.filter(c => opts.videoTargetIds.includes(c.id));

        if (videoClips.length > 0 && peaks.length > 0) {
            for (let i = 0; i < videoClips.length; i++) {
                if (i < peaks.length) {
                    videoClips[i].start = peaks[i];
                    videoClips[i].end = (i + 1 < peaks.length) ? peaks[i + 1] : peaks[i] + 2000;
                }
            }
        }
    };
}

export { detectOnsets, estimateBPM };
