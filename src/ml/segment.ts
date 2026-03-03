import { log, AegisError } from '../core';
import { GL } from '../gl';

const SEGMENT_FRAG_GL = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform sampler2D u_bg;
uniform vec3 u_bgColor;
uniform float u_threshold;
uniform float u_edgeSoft;
uniform vec2 u_texelSize;

float lum(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }

float edge(sampler2D tex, vec2 uv, vec2 ts){
    float tl=lum(texture(tex,uv+vec2(-ts.x, ts.y)).rgb);
    float tm=lum(texture(tex,uv+vec2( 0.0,  ts.y)).rgb);
    float tr=lum(texture(tex,uv+vec2( ts.x, ts.y)).rgb);
    float ml=lum(texture(tex,uv+vec2(-ts.x, 0.0 )).rgb);
    float mr=lum(texture(tex,uv+vec2( ts.x, 0.0 )).rgb);
    float bl=lum(texture(tex,uv+vec2(-ts.x,-ts.y)).rgb);
    float bm=lum(texture(tex,uv+vec2( 0.0, -ts.y)).rgb);
    float br=lum(texture(tex,uv+vec2( ts.x,-ts.y)).rgb);
    float gx=(-tl-2.0*ml-bl)+(tr+2.0*mr+br);
    float gy=(-tl-2.0*tm-tr)+(bl+2.0*bm+br);
    return sqrt(gx*gx+gy*gy);
}

void main(){
    vec4 col = texture(u_image, v_uv);
    float dist = distance(col.rgb, u_bgColor);
    float edgeMag = edge(u_image, v_uv, u_texelSize);
    float mask = smoothstep(u_threshold - u_edgeSoft, u_threshold + u_edgeSoft, dist + edgeMag*0.5);
    vec4 bg = texture(u_bg, v_uv);
    o = mix(bg, col, mask);
}`;

const GUIDED_FILTER_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform sampler2D u_mask;
uniform vec2 u_texelSize;
uniform float u_eps;
uniform int u_radius;

void main(){
    float sumI = 0.0, sumP = 0.0, sumIP = 0.0, sumII = 0.0;
    float count = 0.0;
    int r = u_radius;
    for(int dy=-r; dy<=r; dy++){
        for(int dx=-r; dx<=r; dx++){
            vec2 off = vec2(float(dx), float(dy)) * u_texelSize;
            float I = dot(texture(u_image, v_uv + off).rgb, vec3(0.2126,0.7152,0.0722));
            float P = texture(u_mask, v_uv + off).r;
            sumI += I; sumP += P;
            sumIP += I * P; sumII += I * I;
            count += 1.0;
        }
    }
    float meanI = sumI / count;
    float meanP = sumP / count;
    float corrIP = sumIP / count;
    float varI = sumII / count - meanI * meanI;
    float a = (corrIP - meanI * meanP) / (varI + u_eps);
    float b = meanP - a * meanI;
    float I = dot(texture(u_image, v_uv).rgb, vec3(0.2126,0.7152,0.0722));
    float result = clamp(a * I + b, 0.0, 1.0);
    o = vec4(result, result, result, 1.0);
}`;

const RAW_MASK_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform vec3 u_bgColor;
uniform float u_threshold;
uniform float u_edgeSoft;
uniform vec2 u_texelSize;

float lum(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
float edge(sampler2D tex, vec2 uv, vec2 ts){
    float tl=lum(texture(tex,uv+vec2(-ts.x, ts.y)).rgb);
    float tm=lum(texture(tex,uv+vec2( 0.0,  ts.y)).rgb);
    float tr=lum(texture(tex,uv+vec2( ts.x, ts.y)).rgb);
    float ml=lum(texture(tex,uv+vec2(-ts.x, 0.0 )).rgb);
    float mr=lum(texture(tex,uv+vec2( ts.x, 0.0 )).rgb);
    float bl=lum(texture(tex,uv+vec2(-ts.x,-ts.y)).rgb);
    float bm=lum(texture(tex,uv+vec2( 0.0, -ts.y)).rgb);
    float br=lum(texture(tex,uv+vec2( ts.x,-ts.y)).rgb);
    float gx=(-tl-2.0*ml-bl)+(tr+2.0*mr+br);
    float gy=(-tl-2.0*tm-tr)+(bl+2.0*bm+br);
    return sqrt(gx*gx+gy*gy);
}
void main(){
    vec4 col = texture(u_image, v_uv);
    float dist = distance(col.rgb, u_bgColor);
    float edgeMag = edge(u_image, v_uv, u_texelSize);
    float mask = smoothstep(u_threshold - u_edgeSoft, u_threshold + u_edgeSoft, dist + edgeMag*0.5);
    o = vec4(mask, mask, mask, 1.0);
}`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform sampler2D u_bg;
uniform sampler2D u_mask;
void main(){
    vec4 fg = texture(u_image, v_uv);
    vec4 bg = texture(u_bg, v_uv);
    float alpha = texture(u_mask, v_uv).r;
    o = mix(bg, fg, alpha);
}`;

const MASK_COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform sampler2D u_bg;
uniform sampler2D u_aiMask;
void main(){
    vec4 fg = texture(u_image, v_uv);
    vec4 bg = texture(u_bg, v_uv);
    float alpha = texture(u_aiMask, v_uv).r;
    o = mix(bg, fg, alpha);
}`;

export interface SegmentOpts {
    bgColor?: [number, number, number];
    threshold?: number;
    edgeSoft?: number;
    background?: ImageBitmap | OffscreenCanvas;
    guidedFilterRadius?: number;
    guidedFilterEps?: number;
}

export class SegmentEngine {
    private _gl: GL;
    private _rawMaskGL: GL;
    private _guidedGL: GL;
    private _compositeGL: GL;
    private w: number; private h: number;
    private _bgTex: WebGLTexture | null = null;

    constructor(width: number, height: number) {
        this.w = width; this.h = height;
        this._gl = new GL(width, height);
        this._gl.loadFragmentShader(SEGMENT_FRAG_GL);
        this._rawMaskGL = new GL(width, height);
        this._rawMaskGL.loadFragmentShader(RAW_MASK_FRAG);
        this._guidedGL = new GL(width, height);
        this._guidedGL.loadFragmentShader(GUIDED_FILTER_FRAG);
        this._compositeGL = new GL(width, height);
        this._compositeGL.loadFragmentShader(COMPOSITE_FRAG);
    }

    public async apply(
        source: ImageBitmap | OffscreenCanvas,
        opts: SegmentOpts = {}
    ): Promise<ImageBitmap> {
        const {
            bgColor = [0.05, 0.35, 0.05],
            threshold = 0.25,
            edgeSoft = 0.05,
            background,
            guidedFilterRadius = 4,
            guidedFilterEps = 0.01
        } = opts;

        this._rawMaskGL
            .bindTexture('u_image', source as TexImageSource, 0)
            .setUniform3f('u_bgColor', bgColor[0], bgColor[1], bgColor[2])
            .setUniform1f('u_threshold', threshold)
            .setUniform1f('u_edgeSoft', edgeSoft)
            .setUniform2f('u_texelSize', 1 / this.w, 1 / this.h)
            .render();
        const rawMask = await this._rawMaskGL.extract();

        this._guidedGL
            .bindTexture('u_image', source as TexImageSource, 0)
            .bindTexture('u_mask', rawMask as TexImageSource, 1)
            .setUniform2f('u_texelSize', 1 / this.w, 1 / this.h)
            .setUniform1f('u_eps', guidedFilterEps)
            .setUniform1i('u_radius', guidedFilterRadius)
            .render();
        const refinedMask = await this._guidedGL.extract();
        rawMask.close();

        if (background) {
            this._compositeGL
                .bindTexture('u_image', source as TexImageSource, 0)
                .bindTexture('u_bg', background as TexImageSource, 1)
                .bindTexture('u_mask', refinedMask as TexImageSource, 2)
                .render();
            refinedMask.close();
            return this._compositeGL.extract();
        }

        this._gl.bindTexture('u_image', source as TexImageSource, 0);
        if (!this._bgTex) {
            const gl = this._gl.gl;
            this._bgTex = gl.createTexture();
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this._bgTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array([0, 0, 0, 0]));
        }
        this._gl
            .setUniform3f('u_bgColor', bgColor[0], bgColor[1], bgColor[2])
            .setUniform1f('u_threshold', threshold)
            .setUniform1f('u_edgeSoft', edgeSoft)
            .setUniform2f('u_texelSize', 1 / this.w, 1 / this.h)
            .render();
        refinedMask.close();
        return this._gl.extract();
    }
}

interface ConvWeights {
    w: Float32Array;
    b: Float32Array;
}

interface SegModelWeights {
    enc1: ConvWeights;
    enc2: ConvWeights;
    enc3: ConvWeights;
    enc4: ConvWeights;
    dec4: ConvWeights;
    dec3: ConvWeights;
    dec2: ConvWeights;
    dec1: ConvWeights;
    head: ConvWeights;
}

const MODEL_INPUT_SIZE = 256;

export class AISegmentEngine {
    private _chromaKey: SegmentEngine;
    private _compositeGL: GL;
    private _guidedGL: GL;
    private _nnGraph: any = null;
    private _nnCtx: any = null;
    private _ready = false;
    private _weights: SegModelWeights | null = null;
    private w: number;
    private h: number;

    constructor(width: number, height: number) {
        this.w = width;
        this.h = height;
        this._chromaKey = new SegmentEngine(width, height);
        this._compositeGL = new GL(width, height);
        this._compositeGL.loadFragmentShader(MASK_COMPOSITE_FRAG);
        this._guidedGL = new GL(width, height);
        this._guidedGL.loadFragmentShader(GUIDED_FILTER_FRAG);
    }

    public async loadWeights(data: ArrayBuffer): Promise<void> {
        const f32 = new Float32Array(data);
        let offset = 0;
        const read = (n: number): Float32Array => {
            const slice = new Float32Array(f32.buffer, offset * 4, n);
            offset += n;
            return slice;
        };
        const readConv = (wSize: number, bSize: number): ConvWeights => ({
            w: read(wSize),
            b: read(bSize)
        });

        this._weights = {
            enc1: readConv(16 * 3 * 3 * 3, 16),
            enc2: readConv(32 * 16 * 3 * 3, 32),
            enc3: readConv(64 * 32 * 3 * 3, 64),
            enc4: readConv(128 * 64 * 3 * 3, 128),
            dec4: readConv(64 * 128 * 3 * 3, 64),
            dec3: readConv(32 * 64 * 3 * 3, 32),
            dec2: readConv(16 * 32 * 3 * 3, 16),
            dec1: readConv(16 * 16 * 3 * 3, 16),
            head: readConv(1 * 16 * 1 * 1, 1),
        };

        log.info(`[AISegment] Loaded ${offset} weight parameters (~${(offset * 4 / 1024).toFixed(0)}KB)`);
    }

    public async init(): Promise<void> {
        const ml = navigator.ml;
        if (!ml) {
            log.warn('[AISegment] navigator.ml not available — using chroma-key fallback');
            return;
        }
        if (!this._weights) {
            log.warn('[AISegment] No weights loaded — call loadWeights() first, using chroma-key fallback');
            return;
        }
        try {
            const ctx = await ml.createContext({ deviceType: 'gpu' });
            const builder = new MLGraphBuilder(ctx);

            const S = MODEL_INPUT_SIZE;
            const input = builder.input('input', { dataType: 'float32', dimensions: [1, 3, S, S] });

            const convBlock = (
                x: any, wData: Float32Array, bData: Float32Array,
                outCh: number, inCh: number, kH: number, kW: number,
                pad: number, stride: number
            ): any => {
                const w = builder.constant(
                    { dataType: 'float32', dimensions: [outCh, inCh, kH, kW] }, wData
                );
                const b = builder.constant(
                    { dataType: 'float32', dimensions: [outCh] }, bData
                );
                const conv = builder.conv2d(x, w, {
                    padding: [pad, pad, pad, pad],
                    strides: [stride, stride]
                });
                return builder.relu(builder.add(conv, builder.reshape(b, [1, outCh, 1, 1])));
            };

            const wt = this._weights;

            const e1 = convBlock(input, wt.enc1.w, wt.enc1.b, 16, 3, 3, 3, 1, 2);

            const e2 = convBlock(e1, wt.enc2.w, wt.enc2.b, 32, 16, 3, 3, 1, 2);

            const e3 = convBlock(e2, wt.enc3.w, wt.enc3.b, 64, 32, 3, 3, 1, 2);

            const e4 = convBlock(e3, wt.enc4.w, wt.enc4.b, 128, 64, 3, 3, 1, 2);

            const d4 = convBlock(e4, wt.dec4.w, wt.dec4.b, 64, 128, 3, 3, 1, 1);

            const d4up = builder.resample2d(d4, {
                mode: 'nearest',
                sizes: [S / 4, S / 4]
            });
            const d3 = convBlock(d4up, wt.dec3.w, wt.dec3.b, 32, 64, 3, 3, 1, 1);

            const d3up = builder.resample2d(d3, {
                mode: 'nearest',
                sizes: [S / 2, S / 2]
            });
            const d2 = convBlock(d3up, wt.dec2.w, wt.dec2.b, 16, 32, 3, 3, 1, 1);

            const d2up = builder.resample2d(d2, {
                mode: 'nearest',
                sizes: [S, S]
            });
            const d1 = convBlock(d2up, wt.dec1.w, wt.dec1.b, 16, 16, 3, 3, 1, 1);

            const headW = builder.constant(
                { dataType: 'float32', dimensions: [1, 16, 1, 1] }, wt.head.w
            );
            const headB = builder.constant(
                { dataType: 'float32', dimensions: [1] }, wt.head.b
            );
            const headConv = builder.conv2d(d1, headW, { padding: [0, 0, 0, 0] });
            const output = builder.sigmoid(builder.add(
                headConv, builder.reshape(headB, [1, 1, 1, 1])
            ));

            this._nnGraph = await builder.build({ output });
            this._nnCtx = ctx;
            this._ready = true;
            log.info('[AISegment] WebNN segmentation graph compiled successfully');
        } catch (e) {
            log.warn('[AISegment] WebNN graph build failed, using chroma-key fallback', e);
        }
    }

    public async apply(
        source: ImageBitmap | OffscreenCanvas,
        opts: SegmentOpts = {}
    ): Promise<ImageBitmap> {
        if (!this._ready || !this._nnGraph) {
            return this._chromaKey.apply(source, opts);
        }

        try {
            const mask = await this._infer(source);

            if (opts.guidedFilterRadius && opts.guidedFilterRadius > 0) {
                this._guidedGL
                    .bindTexture('u_image', source as TexImageSource, 0)
                    .bindTexture('u_mask', mask as TexImageSource, 1)
                    .setUniform2f('u_texelSize', 1 / this.w, 1 / this.h)
                    .setUniform1f('u_eps', opts.guidedFilterEps ?? 0.01)
                    .setUniform1i('u_radius', opts.guidedFilterRadius)
                    .render();
                const refined = await this._guidedGL.extract();
                mask.close();

                if (opts.background) {
                    return this._composite(source, opts.background, refined);
                }
                return refined;
            }

            if (opts.background) {
                return this._composite(source, opts.background, mask);
            }
            return mask;
        } catch (e) {
            log.warn('[AISegment] Inference failed, falling back to chroma-key', e);
            return this._chromaKey.apply(source, opts);
        }
    }

    public get isAIReady(): boolean { return this._ready; }

    private async _infer(source: ImageBitmap | OffscreenCanvas): Promise<ImageBitmap> {
        const S = MODEL_INPUT_SIZE;
        const canvas = new OffscreenCanvas(S, S);
        const ctx2d = canvas.getContext('2d')!;
        ctx2d.drawImage(source as CanvasImageSource, 0, 0, S, S);
        const imgData = ctx2d.getImageData(0, 0, S, S);

        const inputBuf = new Float32Array(1 * 3 * S * S);
        const px = imgData.data;
        for (let y = 0; y < S; y++) {
            for (let x = 0; x < S; x++) {
                const pi = (y * S + x) * 4;
                const idx = y * S + x;
                inputBuf[0 * S * S + idx] = px[pi] / 255.0;
                inputBuf[1 * S * S + idx] = px[pi + 1] / 255.0;
                inputBuf[2 * S * S + idx] = px[pi + 2] / 255.0;
            }
        }

        const outputBuf = new Float32Array(1 * 1 * S * S);
        await this._nnGraph.compute(
            { input: inputBuf },
            { output: outputBuf }
        );

        const outW = ('width' in source ? (source as { width: number }).width : 0) || this.w;
        const outH = ('height' in source ? (source as { height: number }).height : 0) || this.h;
        const outCanvas = new OffscreenCanvas(outW, outH);
        const outCtx = outCanvas.getContext('2d')!;
        const outImg = outCtx.createImageData(outW, outH);

        const scaleX = S / outW;
        const scaleY = S / outH;

        for (let y = 0; y < outH; y++) {
            for (let x = 0; x < outW; x++) {
                const srcX = Math.min(S - 1, Math.floor(x * scaleX));
                const srcY = Math.min(S - 1, Math.floor(y * scaleY));
                const alpha = outputBuf[srcY * S + srcX];
                const val = Math.max(0, Math.min(255, Math.round(alpha * 255)));
                const pi = (y * outW + x) * 4;
                outImg.data[pi] = val;
                outImg.data[pi + 1] = val;
                outImg.data[pi + 2] = val;
                outImg.data[pi + 3] = 255;
            }
        }
        outCtx.putImageData(outImg, 0, 0);
        return createImageBitmap(outCanvas);
    }

    private async _composite(
        fg: ImageBitmap | OffscreenCanvas,
        bg: ImageBitmap | OffscreenCanvas,
        mask: ImageBitmap
    ): Promise<ImageBitmap> {
        this._compositeGL
            .bindTexture('u_image', fg as TexImageSource, 0)
            .bindTexture('u_bg', bg as TexImageSource, 1)
            .bindTexture('u_aiMask', mask as TexImageSource, 2)
            .render();
        mask.close();
        return this._compositeGL.extract();
    }
}

export class WebGPUSegmentEngine {
    private _aiEngine: AISegmentEngine;
    private w: number; private h: number;

    constructor(width: number, height: number) {
        this.w = width; this.h = height;
        this._aiEngine = new AISegmentEngine(width, height);
    }

    public async loadWeights(data: ArrayBuffer): Promise<void> {
        return this._aiEngine.loadWeights(data);
    }

    public async init(): Promise<void> {
        return this._aiEngine.init();
    }

    public get isAIReady(): boolean { return this._aiEngine.isAIReady; }

    public async apply(source: ImageBitmap, opts: SegmentOpts = {}): Promise<ImageBitmap> {
        return this._aiEngine.apply(source, opts);
    }
}
