export const AUDIO_WORKLET_CODE = `
class AegisGainProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [{ name: 'gain', defaultValue: 1, minValue: 0, maxValue: 10, automationRate: 'a-rate' }];
    }
    constructor(opts) {
        super();
        this._sab = null;
        this._sabView = null;
        this._readPos = 0;
        this.port.onmessage = (e) => {
            if (e.data.type === 'sab') {
                this._sab = e.data.buffer;
                this._sabView = new Float32Array(this._sab);
            }
        };
    }
    process(inputs, outputs, parameters) {
        const gain = parameters.gain;
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !input[0]) return true;
        for (let ch = 0; ch < output.length; ch++) {
            const inCh = input[ch] || input[0];
            const outCh = output[ch];
            for (let i = 0; i < outCh.length; i++) {
                const g = gain.length > 1 ? gain[i] : gain[0];
                outCh[i] = inCh[i] * g;
            }
        }
        return true;
    }
}

class AegisDuckProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._rms = 0;
        this._attack = 0.003;
        this._release = 0.25;
        this._threshold = 0.1;
        this._ratio = 4;
        this._gain = 1;
        this.port.onmessage = (e) => {
            if (e.data.attack !== undefined) this._attack = e.data.attack;
            if (e.data.release !== undefined) this._release = e.data.release;
            if (e.data.threshold !== undefined) this._threshold = e.data.threshold;
            if (e.data.ratio !== undefined) this._ratio = e.data.ratio;
        };
    }
    static get parameterDescriptors() {
        return [{ name: 'sidechain', defaultValue: 0, automationRate: 'a-rate' }];
    }
    process(inputs, outputs) {
        const sidechain = inputs[1] || inputs[0];
        const main = inputs[0];
        const output = outputs[0];
        if (!main || !main[0]) return true;
        
        let sum = 0;
        const scCh = sidechain?.[0] || main[0];
        for (const s of scCh) sum += s * s;
        const rms = Math.sqrt(sum / scCh.length);
        const dt = 128 / sampleRate;
        const coeff = rms > this._rms ? Math.exp(-dt / this._attack) : Math.exp(-dt / this._release);
        this._rms = this._rms * coeff + rms * (1 - coeff);
        const targetGain = this._rms > this._threshold
            ? 1 - (this._rms - this._threshold) / this._ratio
            : 1;
        const gCoeff = targetGain < this._gain ? Math.exp(-dt / this._attack) : Math.exp(-dt / this._release);
        this._gain = this._gain * gCoeff + targetGain * (1 - gCoeff);
        for (let ch = 0; ch < output.length; ch++) {
            const inCh = main[ch] || main[0];
            const outCh = output[ch];
            for (let i = 0; i < outCh.length; i++) outCh[i] = inCh[i] * Math.max(0, this._gain);
        }
        return true;
    }
}

registerProcessor('aegis-gain', AegisGainProcessor);
registerProcessor('aegis-duck', AegisDuckProcessor);
`;

export class AegisAudioWorklet {
    private ctx: AudioContext;
    private _blobUrl: string | null = null;
    private _loaded = false;

    constructor(ctx: AudioContext) {
        this.ctx = ctx;
    }

    public async load(): Promise<void> {
        if (this._loaded) return;
        const blob = new Blob([AUDIO_WORKLET_CODE], { type: 'application/javascript' });
        this._blobUrl = URL.createObjectURL(blob);
        await this.ctx.audioWorklet.addModule(this._blobUrl);
        this._loaded = true;
    }

    public createGainNode(): AudioWorkletNode {
        const node = new AudioWorkletNode(this.ctx, 'aegis-gain');

        const sab = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 128);
        const view = new Float32Array(sab);
        view.fill(1.0);
        node.port.postMessage({ type: 'sab', buffer: sab });

        return node;
    }

    public createDuckNode(opts: {
        attack?: number;
        release?: number;
        threshold?: number;
        ratio?: number;
    } = {}): AudioWorkletNode {
        const node = new AudioWorkletNode(this.ctx, 'aegis-duck', {
            numberOfInputs: 2,
            numberOfOutputs: 1,
            channelCount: 2
        });
        node.port.postMessage({ ...opts });
        return node;
    }

    public dispose(): void {
        if (this._blobUrl) { URL.revokeObjectURL(this._blobUrl); this._blobUrl = null; }
    }
}

export function scheduleGainAutomation(
    param: AudioParam,
    keyframes: { t: number; v: number }[],
    startTime: number = 0
): void {
    if (keyframes.length === 0) return;
    param.setValueAtTime(keyframes[0].v, startTime + keyframes[0].t);
    for (let i = 1; i < keyframes.length; i++) {
        param.linearRampToValueAtTime(keyframes[i].v, startTime + keyframes[i].t);
    }
}
