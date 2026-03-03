import { FFT } from './fft';

export class IMDCT {
    private n: number;
    private halfN: number;
    private fft: FFT;
    private preTwiddle: { cos: Float64Array; sin: Float64Array };
    private postTwiddle: { cos: Float64Array; sin: Float64Array };
    private window: Float64Array;

    constructor(n: number) {
        this.n = n;
        this.halfN = n >> 1;
        const quarter = n >> 2;
        this.fft = new FFT(quarter);
        this.preTwiddle = { cos: new Float64Array(quarter), sin: new Float64Array(quarter) };
        this.postTwiddle = { cos: new Float64Array(quarter), sin: new Float64Array(quarter) };
        for (let k = 0; k < quarter; k++) {
            const preAngle = Math.PI / n * (2 * k + 1 + n / 2);
            this.preTwiddle.cos[k] = Math.cos(preAngle);
            this.preTwiddle.sin[k] = Math.sin(preAngle);
            const postAngle = Math.PI / n * (2 * k + 1 + n / 4);
            this.postTwiddle.cos[k] = Math.cos(postAngle);
            this.postTwiddle.sin[k] = Math.sin(postAngle);
        }
        this.window = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            this.window[i] = Math.sin(Math.PI / n * (i + 0.5));
        }
    }

    public process(coefficients: Float64Array, output: Float64Array): void {
        const quarter = this.halfN >> 1;
        const real = new Float64Array(quarter);
        const imag = new Float64Array(quarter);
        for (let k = 0; k < quarter; k++) {
            const xr = coefficients[2 * k];
            const xi = coefficients[this.halfN - 1 - 2 * k];
            real[k] = xr * this.preTwiddle.cos[k] + xi * this.preTwiddle.sin[k];
            imag[k] = xi * this.preTwiddle.cos[k] - xr * this.preTwiddle.sin[k];
        }
        this.fft.forward(real, imag);
        for (let k = 0; k < quarter; k++) {
            const yr = real[k] * this.postTwiddle.cos[k] - imag[k] * this.postTwiddle.sin[k];
            const yi = real[k] * this.postTwiddle.sin[k] + imag[k] * this.postTwiddle.cos[k];
            real[k] = yr;
            imag[k] = yi;
        }
        for (let k = 0; k < quarter; k++) {
            output[2 * k] = real[k];
            output[2 * k + 1] = imag[k];
            output[this.halfN + 2 * k] = -imag[quarter - 1 - k];
            output[this.halfN + 2 * k + 1] = -real[quarter - 1 - k];
        }
        for (let i = 0; i < this.n; i++) output[i] *= this.window[i];
    }

    public overlapAdd(
        prevBlock: Float64Array, currCoeffs: Float64Array, outputSamples: Float64Array, offset: number
    ): Float64Array {
        const temp = new Float64Array(this.n);
        this.process(currCoeffs, temp);
        for (let i = 0; i < this.halfN; i++) {
            outputSamples[offset + i] = prevBlock[this.halfN + i] + temp[i];
        }
        return temp;
    }
}
