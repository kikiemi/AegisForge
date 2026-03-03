import { log, AegisError } from '../core';
import { GL } from '../gl';
import type { AegisCore, AegisPlugin } from '../core/AegisCore';

const BILATERAL_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform float u_sigmaS;
uniform float u_sigmaR;
void main(){
    vec3 center = texture(u_image, v_uv).rgb;
    vec3 acc = vec3(0.0);
    float wt = 0.0;
    int r = int(u_sigmaS * 2.0);
    float s2 = u_sigmaS * u_sigmaS * 2.0;
    float r2 = u_sigmaR * u_sigmaR * 2.0;
    for(int dy=-r; dy<=r; dy++){
        for(int dx=-r; dx<=r; dx++){
            vec2 uv = v_uv + vec2(float(dx),float(dy)) * u_texelSize;
            vec3 nb = texture(u_image, uv).rgb;
            float spatialW = exp(-float(dx*dx+dy*dy)/s2);
            float rangeW   = exp(-dot(nb-center,nb-center)/r2);
            float w = spatialW * rangeW;
            acc += nb * w; wt += w;
        }
    }
    o = vec4(acc / wt, 1.0);
}`;

const SHARPEN_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform float u_strength;
void main(){
    vec3 c  = texture(u_image, v_uv).rgb;
    vec3 t  = texture(u_image, v_uv + vec2( 0, u_texelSize.y)).rgb;
    vec3 b  = texture(u_image, v_uv + vec2( 0,-u_texelSize.y)).rgb;
    vec3 l  = texture(u_image, v_uv + vec2(-u_texelSize.x, 0)).rgb;
    vec3 r  = texture(u_image, v_uv + vec2( u_texelSize.x, 0)).rgb;
    vec3 laplacian = c - (t+b+l+r)*0.25;
    o = vec4(clamp(c + u_strength * laplacian, 0.0, 1.0), 1.0);
}`;

const PIXEL_SHUFFLE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_features;
uniform vec2 u_texelSize;
uniform int u_scale;
void main(){
    int sx = u_scale;
    float invScale = 1.0 / float(sx);
    vec2 srcUV = v_uv * invScale;
    int px = int(floor(v_uv.x / u_texelSize.x)) % sx;
    int py = int(floor(v_uv.y / u_texelSize.y)) % sx;
    int channelIdx = py * sx + px;
    vec2 srcTexel = floor(srcUV / u_texelSize) * u_texelSize + u_texelSize * 0.5;
    vec4 feat = texture(u_features, srcTexel);
    float val = channelIdx == 0 ? feat.r : (channelIdx == 1 ? feat.g : (channelIdx == 2 ? feat.b : feat.a));
    o = vec4(val, val, val, 1.0);
}`;



async function buildSuperResGraph(
    ml: NavigatorML['ml'] & {},
    width: number, height: number,
    weights: { w1: Float32Array; b1: Float32Array; w2: Float32Array; b2: Float32Array; w3: Float32Array; b3: Float32Array }
): Promise<{ graph: MLGraph; ctx: MLContext } | null> {
    if (!ml) {
        log.warn('[WebNN] navigator.ml not available');
        return null;
    }
    let ctx: MLContext;
    try {
        ctx = await ml.createContext({ deviceType: 'gpu' });
    } catch (e) {
        log.warn('[WebNN] Failed to create MLContext — GPU may not support WebNN', e);
        return null;
    }
    try {
        const builder = new MLGraphBuilder(ctx);

        const input = builder.input('input', { type: 'float32', dimensions: [1, 3, height, width] });

        const w1 = builder.constant({ type: 'float32', dimensions: [64, 3, 5, 5] }, weights.w1);
        const b1 = builder.constant({ type: 'float32', dimensions: [64] }, weights.b1);
        const conv1 = builder.relu(builder.add(
            builder.conv2d(input, w1, { padding: [2, 2, 2, 2], strides: [1, 1] }),
            builder.reshape(b1, [1, 64, 1, 1])
        ));

        const w2 = builder.constant({ type: 'float32', dimensions: [32, 64, 3, 3] }, weights.w2);
        const b2 = builder.constant({ type: 'float32', dimensions: [32] }, weights.b2);
        const conv2 = builder.relu(builder.add(
            builder.conv2d(conv1, w2, { padding: [1, 1, 1, 1], strides: [1, 1] }),
            builder.reshape(b2, [1, 32, 1, 1])
        ));

        const scale = 2;
        const outChannels = 3 * scale * scale;
        const w3 = builder.constant({ type: 'float32', dimensions: [outChannels, 32, 3, 3] }, weights.w3);
        const b3 = builder.constant({ type: 'float32', dimensions: [outChannels] }, weights.b3);
        const conv3 = builder.add(
            builder.conv2d(conv2, w3, { padding: [1, 1, 1, 1] }),
            builder.reshape(b3, [1, outChannels, 1, 1])
        );

        const graph = await builder.build({ output: conv3 });
        return { graph, ctx };
    } catch (e) {
        log.warn('[WebNN] Graph build failed — model architecture incompatible with WebNN backend', e);
        return null;
    }
}

export class AegisWebNN {
    private _bilateralGL: GL;
    private _sharpenGL: GL;
    private _nnGraph: { compute: (i: Record<string, Float32Array>, o: Record<string, Float32Array>) => Promise<void> } | null = null;
    private _nnCtx: unknown = null;
    private _nnAvailable = false;
    private _weights: { w1: Float32Array; b1: Float32Array; w2: Float32Array; b2: Float32Array; w3: Float32Array; b3: Float32Array } | null = null;
    private w: number; private h: number;

    constructor(width: number, height: number) {
        this.w = width; this.h = height;
        this._bilateralGL = new GL(width, height);
        this._bilateralGL.loadFragmentShader(BILATERAL_FRAG);
        this._sharpenGL = new GL(width, height);
        this._sharpenGL.loadFragmentShader(SHARPEN_FRAG);
    }

    public async loadWeights(data: ArrayBuffer): Promise<void> {
        const f32 = new Float32Array(data);
        let offset = 0;
        const read = (n: number) => { const s = f32.subarray(offset, offset + n); offset += n; return s; };
        this._weights = {
            w1: read(64 * 3 * 5 * 5), b1: read(64),
            w2: read(32 * 64 * 3 * 3), b2: read(32),
            w3: read(12 * 32 * 3 * 3), b3: read(12)
        };
        log.info(`[WebNN] Loaded ${f32.length} weight parameters`);
    }

    public async init(): Promise<void> {
        const ml = navigator.ml;
        if (!ml) {
            log.warn('[WebNN] navigator.ml not available — using multi-pass enhance fallback');
            return;
        }
        if (!this._weights) {
            log.warn('[WebNN] No model weights loaded — call loadWeights() first or provide weightsUrl. Super-resolution disabled.');
            return;
        }
        const result = await buildSuperResGraph(ml, this.w, this.h, this._weights);
        if (result) {
            this._nnGraph = result.graph;
            this._nnCtx = result.ctx;
            this._nnAvailable = true;
            log.info('[WebNN] ESPCN super-resolution graph compiled with loaded weights');
        }
    }

    public async denoise(
        source: ImageBitmap | OffscreenCanvas,
        sigmaS: number = 3,
        sigmaR: number = 0.15
    ): Promise<ImageBitmap> {
        this._bilateralGL
            .bindTexture('u_image', source as TexImageSource, 0)
            .setUniform2f('u_texelSize', 1 / this.w, 1 / this.h)
            .setUniform1f('u_sigmaS', sigmaS)
            .setUniform1f('u_sigmaR', sigmaR)
            .render();
        return this._bilateralGL.extract();
    }

    public async sharpen(
        source: ImageBitmap | OffscreenCanvas,
        strength: number = 0.5
    ): Promise<ImageBitmap> {
        this._sharpenGL
            .bindTexture('u_image', source as TexImageSource, 0)
            .setUniform2f('u_texelSize', 1 / this.w, 1 / this.h)
            .setUniform1f('u_strength', strength)
            .render();
        return this._sharpenGL.extract();
    }

    public async enhance(source: ImageBitmap): Promise<ImageBitmap> {
        const d = await this.denoise(source, 2.0, 0.12);
        const s = await this.sharpen(d, 0.6);
        d.close();
        return s;
    }

    public async superRes(source: ImageBitmap): Promise<ImageBitmap> {
        if (this._nnAvailable && this._nnGraph && this._nnCtx) {
            try {
                const canvas = new OffscreenCanvas(this.w, this.h);
                const ctx2d = canvas.getContext('2d')!;
                ctx2d.drawImage(source, 0, 0, this.w, this.h);
                const imgData = ctx2d.getImageData(0, 0, this.w, this.h);

                const inputSize = 1 * 3 * this.h * this.w;
                const inputBuf = new Float32Array(inputSize);
                for (let y = 0; y < this.h; y++) {
                    for (let x = 0; x < this.w; x++) {
                        const pi = (y * this.w + x) * 4;
                        inputBuf[0 * this.h * this.w + y * this.w + x] = imgData.data[pi] / 255;
                        inputBuf[1 * this.h * this.w + y * this.w + x] = imgData.data[pi + 1] / 255;
                        inputBuf[2 * this.h * this.w + y * this.w + x] = imgData.data[pi + 2] / 255;
                    }
                }

                const scale = 2;
                const outChannels = 3 * scale * scale;
                const outputBuf = new Float32Array(1 * outChannels * this.h * this.w);
                const inputs = { input: inputBuf };
                const outputs = { output: outputBuf };
                await this._nnGraph.compute(inputs, outputs);

                const outW = this.w * scale, outH = this.h * scale;
                const outCanvas = new OffscreenCanvas(outW, outH);
                const outCtx = outCanvas.getContext('2d')!;
                const outImg = outCtx.createImageData(outW, outH);

                for (let c = 0; c < 3; c++) {
                    for (let y = 0; y < this.h; y++) {
                        for (let x = 0; x < this.w; x++) {
                            for (let sy = 0; sy < scale; sy++) {
                                for (let sx = 0; sx < scale; sx++) {
                                    const subCh = c * scale * scale + sy * scale + sx;
                                    const val = outputBuf[subCh * this.h * this.w + y * this.w + x];
                                    const outX = x * scale + sx;
                                    const outY = y * scale + sy;
                                    const outPi = (outY * outW + outX) * 4;
                                    outImg.data[outPi + c] = Math.max(0, Math.min(255, Math.round(val * 255)));
                                    if (c === 0) outImg.data[outPi + 3] = 255;
                                }
                            }
                        }
                    }
                }
                outCtx.putImageData(outImg, 0, 0);
                return createImageBitmap(outCanvas);
            } catch (e) {
                log.warn('[WebNN] Inference failed, falling back to enhance', e);
            }
        }

        return this.enhance(source);
    }
}

export interface WebNNOpts {
    targetClipIds?: string[];
    modelType?: 'segmentation' | 'depth' | 'superres' | 'denoise';
    weightsUrl?: string;
}

export function windowAIModel(opts: WebNNOpts = {}): AegisPlugin {
    return async (core: AegisCore) => {
        const webnn = new AegisWebNN(core.config.width, core.config.height);

        if (opts.weightsUrl) {
            try {
                const resp = await fetch(opts.weightsUrl);
                const buf = await resp.arrayBuffer();
                await webnn.loadWeights(buf);
            } catch (e) {
                log.warn('[WebNN] Failed to load weights from', opts.weightsUrl, e);
            }
        }
        await webnn.init();
        log.info('[WebNN] Plugin initialized');
    };
}
