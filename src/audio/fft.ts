export class FFT {
    private n: number;
    private levels: number;
    private cosTable: Float64Array;
    private sinTable: Float64Array;
    private revBits: Uint32Array;

    constructor(size: number) {
        this.n = size;
        this.levels = Math.round(Math.log2(size));
        this.cosTable = new Float64Array(size >> 1);
        this.sinTable = new Float64Array(size >> 1);
        for (let i = 0; i < (size >> 1); i++) {
            const angle = 2 * Math.PI * i / size;
            this.cosTable[i] = Math.cos(angle);
            this.sinTable[i] = Math.sin(angle);
        }
        this.revBits = new Uint32Array(size);
        for (let i = 0; i < size; i++) {
            let rev = 0, val = i;
            for (let j = 0; j < this.levels; j++) {
                rev = (rev << 1) | (val & 1);
                val >>= 1;
            }
            this.revBits[i] = rev;
        }
    }

    public forward(real: Float64Array, imag: Float64Array): void {
        this._bitReverse(real, imag);
        this._butterfly(real, imag, false);
    }

    public inverse(real: Float64Array, imag: Float64Array): void {
        this._bitReverse(real, imag);
        this._butterfly(real, imag, true);
        const s = 1 / this.n;
        for (let i = 0; i < this.n; i++) {
            real[i] *= s;
            imag[i] *= s;
        }
    }

    private _bitReverse(real: Float64Array, imag: Float64Array): void {
        for (let i = 0; i < this.n; i++) {
            const j = this.revBits[i];
            if (j > i) {
                let tmp = real[i]; real[i] = real[j]; real[j] = tmp;
                tmp = imag[i]; imag[i] = imag[j]; imag[j] = tmp;
            }
        }
    }

    private _butterfly(real: Float64Array, imag: Float64Array, inv: boolean): void {
        const n = this.n, half = n >> 1;
        for (let size = 2; size <= n; size <<= 1) {
            const halfSize = size >> 1;
            const step = n / size;
            for (let i = 0; i < n; i += size) {
                for (let j = 0; j < halfSize; j++) {
                    const idx = (j * step) % half;
                    const wr = this.cosTable[idx];
                    const wi = inv ? this.sinTable[idx] : -this.sinTable[idx];
                    const k = i + j;
                    const l = k + halfSize;
                    const tr = wr * real[l] - wi * imag[l];
                    const ti = wr * imag[l] + wi * real[l];
                    real[l] = real[k] - tr;
                    imag[l] = imag[k] - ti;
                    real[k] += tr;
                    imag[k] += ti;
                }
            }
        }
    }

    public static powerOfTwo(n: number): number {
        let p = 1;
        while (p < n) p <<= 1;
        return p;
    }
}

export function hannWindow(size: number): Float64Array {
    const w = new Float64Array(size);
    for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
    return w;
}

export function hammingWindow(size: number): Float64Array {
    const w = new Float64Array(size);
    for (let i = 0; i < size; i++) w[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (size - 1));
    return w;
}

export function blackmanHarrisWindow(size: number): Float64Array {
    const w = new Float64Array(size);
    const a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
    for (let i = 0; i < size; i++) {
        const x = 2 * Math.PI * i / (size - 1);
        w[i] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x) - a3 * Math.cos(3 * x);
    }
    return w;
}

export function magnitude(real: Float64Array, imag: Float64Array): Float64Array {
    const m = new Float64Array(real.length);
    for (let i = 0; i < real.length; i++) m[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    return m;
}
