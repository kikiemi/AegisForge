import { FFT } from './fft';

export interface SyncResult {
    offsetSamples: number;
    offsetSeconds: number;
    confidence: number;
}

export class AutoSync {
    public static correlate(refSignal: Float32Array, targetSignal: Float32Array, sampleRate: number): SyncResult {
        const maxLen = Math.max(refSignal.length, targetSignal.length);
        const fftSize = FFT.powerOfTwo(maxLen * 2);
        const fft = new FFT(fftSize);
        const refReal = new Float64Array(fftSize);
        const refImag = new Float64Array(fftSize);
        const tgtReal = new Float64Array(fftSize);
        const tgtImag = new Float64Array(fftSize);
        for (let i = 0; i < refSignal.length; i++) refReal[i] = refSignal[i];
        for (let i = 0; i < targetSignal.length; i++) tgtReal[i] = targetSignal[i];
        fft.forward(refReal, refImag);
        fft.forward(tgtReal, tgtImag);
        const corrReal = new Float64Array(fftSize);
        const corrImag = new Float64Array(fftSize);
        for (let i = 0; i < fftSize; i++) {
            corrReal[i] = refReal[i] * tgtReal[i] + refImag[i] * tgtImag[i];
            corrImag[i] = refReal[i] * tgtImag[i] - refImag[i] * tgtReal[i];
        }
        fft.inverse(corrReal, corrImag);
        let peakVal = -Infinity, peakIdx = 0;
        for (let i = 0; i < fftSize; i++) {
            if (corrReal[i] > peakVal) { peakVal = corrReal[i]; peakIdx = i; }
        }
        let offset = peakIdx;
        if (offset > fftSize / 2) offset -= fftSize;
        let subSampleOffset = offset;
        if (peakIdx > 0 && peakIdx < fftSize - 1) {
            const alpha = corrReal[(peakIdx - 1 + fftSize) % fftSize];
            const beta = corrReal[peakIdx];
            const gamma = corrReal[(peakIdx + 1) % fftSize];
            const denom = alpha - 2 * beta + gamma;
            if (Math.abs(denom) > 1e-12) {
                subSampleOffset = offset + (alpha - gamma) / (2 * denom);
            }
        }
        let refEnergy = 0, tgtEnergy = 0;
        for (let i = 0; i < refSignal.length; i++) refEnergy += refSignal[i] * refSignal[i];
        for (let i = 0; i < targetSignal.length; i++) tgtEnergy += targetSignal[i] * targetSignal[i];
        const normFactor = Math.sqrt(refEnergy * tgtEnergy);
        const confidence = normFactor > 1e-12 ? peakVal / normFactor : 0;
        return {
            offsetSamples: Math.round(subSampleOffset),
            offsetSeconds: subSampleOffset / sampleRate,
            confidence: Math.min(1, Math.max(0, confidence))
        };
    }

    public static downmixToMono(buffer: Float32Array, channels: number): Float32Array {
        if (channels === 1) return buffer;
        const frames = Math.floor(buffer.length / channels);
        const mono = new Float32Array(frames);
        const inv = 1 / channels;
        for (let i = 0; i < frames; i++) {
            let sum = 0;
            for (let c = 0; c < channels; c++) sum += buffer[i * channels + c];
            mono[i] = sum * inv;
        }
        return mono;
    }

    public static downsample(signal: Float32Array, factor: number): Float32Array {
        if (factor <= 1) return signal;
        const outLen = Math.floor(signal.length / factor);
        const out = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) {
            const srcIdx = i * factor;
            const lo = Math.floor(srcIdx);
            const frac = srcIdx - lo;
            out[i] = lo + 1 < signal.length
                ? signal[lo] * (1 - frac) + signal[lo + 1] * frac
                : signal[lo];
        }
        return out;
    }
}
