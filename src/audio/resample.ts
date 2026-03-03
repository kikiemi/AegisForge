export class SincResampler {
    private srcRate: number;
    private dstRate: number;
    private kernelWidth: number;
    private kaiserBeta: number;
    private ratio: number;
    private filterTable: Float64Array;
    private filterSize: number;
    private tableRes: number;

    constructor(srcRate: number, dstRate: number, kernelWidth: number = 16, kaiserBeta: number = 6.0) {
        this.srcRate = srcRate;
        this.dstRate = dstRate;
        this.kernelWidth = kernelWidth;
        this.kaiserBeta = kaiserBeta;
        this.ratio = dstRate / srcRate;
        this.tableRes = 512;
        this.filterSize = kernelWidth * 2 + 1;
        this.filterTable = new Float64Array(this.tableRes * this.filterSize);
        this._buildFilterTable();
    }

    private _buildFilterTable(): void {
        const cutoff = Math.min(1.0, this.ratio < 1 ? this.ratio : 1.0 / this.ratio) * 0.95;
        for (let phase = 0; phase < this.tableRes; phase++) {
            const frac = phase / this.tableRes;
            let sum = 0;
            for (let i = 0; i < this.filterSize; i++) {
                const x = (i - this.kernelWidth) - frac;
                const sinc = Math.abs(x) < 1e-12 ? cutoff : Math.sin(Math.PI * cutoff * x) / (Math.PI * x);
                const kaiser = this._kaiser(x / (this.kernelWidth + 1));
                const val = sinc * kaiser;
                this.filterTable[phase * this.filterSize + i] = val;
                sum += val;
            }
            if (Math.abs(sum) > 1e-12) {
                const inv = 1 / sum;
                for (let i = 0; i < this.filterSize; i++) {
                    this.filterTable[phase * this.filterSize + i] *= inv;
                }
            }
        }
    }

    private _kaiser(x: number): number {
        if (Math.abs(x) > 1) return 0;
        return this._bessel0(this.kaiserBeta * Math.sqrt(1 - x * x)) / this._bessel0(this.kaiserBeta);
    }

    private _bessel0(x: number): number {
        let sum = 1, term = 1;
        const x2 = x * x * 0.25;
        for (let k = 1; k < 20; k++) {
            term *= x2 / (k * k);
            sum += term;
            if (term < 1e-15) break;
        }
        return sum;
    }

    public process(input: Float32Array): Float32Array {
        const outLen = Math.ceil(input.length * this.ratio);
        const output = new Float32Array(outLen);
        const invRatio = this.srcRate / this.dstRate;
        for (let i = 0; i < outLen; i++) {
            const srcPos = i * invRatio;
            const srcInt = Math.floor(srcPos);
            const srcFrac = srcPos - srcInt;
            const phaseIdx = Math.min(Math.floor(srcFrac * this.tableRes), this.tableRes - 1);
            const filterOffset = phaseIdx * this.filterSize;
            let sum = 0;
            for (let j = 0; j < this.filterSize; j++) {
                const idx = srcInt + j - this.kernelWidth;
                if (idx >= 0 && idx < input.length) {
                    sum += input[idx] * this.filterTable[filterOffset + j];
                }
            }
            output[i] = sum;
        }
        return output;
    }

    public processMultiChannel(input: Float32Array, channels: number): Float32Array {
        const frames = Math.floor(input.length / channels);
        const outFrames = Math.ceil(frames * this.ratio);
        const output = new Float32Array(outFrames * channels);
        for (let ch = 0; ch < channels; ch++) {
            const mono = new Float32Array(frames);
            for (let i = 0; i < frames; i++) mono[i] = input[i * channels + ch];
            const resampled = this.process(mono);
            for (let i = 0; i < outFrames && i < resampled.length; i++) {
                output[i * channels + ch] = resampled[i];
            }
        }
        return output;
    }

    public static gcdRates(a: number, b: number): number {
        while (b) { [a, b] = [b, a % b]; }
        return a;
    }
}
