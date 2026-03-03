import { GL } from '../gl';

export const enum CSColorSpace {
    BT601_LIMITED = 0,
    BT601_FULL = 1,
    BT709_LIMITED = 2,
    BT709_FULL = 3,
    BT2020_LIMITED = 4,
    BT2020_FULL = 5
}

export const enum CSChromaFormat {
    YUV420 = 0,
    YUV422 = 1,
    YUV444 = 2,
    NV12 = 3,
    NV21 = 4
}

const COLOR_SPACE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_y;
uniform sampler2D u_u;
uniform sampler2D u_v;
uniform vec2 u_chromaSize;
uniform int u_colorSpace;
uniform float u_sigmaS;
uniform float u_sigmaR;

mat3 getMatrix(int cs) {
    if (cs == 0 || cs == 1) {
        return mat3(
            1.0, 1.0, 1.0,
            0.0, -0.344136, 1.772,
            1.402, -0.714136, 0.0
        );
    } else if (cs == 2 || cs == 3) {
        return mat3(
            1.0, 1.0, 1.0,
            0.0, -0.1873, 1.8556,
            1.5748, -0.4681, 0.0
        );
    } else {
        return mat3(
            1.0, 1.0, 1.0,
            0.0, -0.1646, 1.8814,
            1.4746, -0.5714, 0.0
        );
    }
}

vec2 getRange(int cs) {
    if (cs == 0 || cs == 2 || cs == 4) {
        return vec2(16.0 / 255.0, 219.0 / 255.0);
    }
    return vec2(0.0, 1.0);
}

float bilateral(sampler2D tex, vec2 uv, vec2 texel, float ref, float sigS, float sigR) {
    float acc = 0.0;
    float wt = 0.0;
    float s2 = sigS * sigS * 2.0;
    float r2 = sigR * sigR * 2.0;
    int r = int(ceil(sigS * 2.0));
    for (int dy = -r; dy <= r; dy++) {
        for (int dx = -r; dx <= r; dx++) {
            vec2 off = vec2(float(dx), float(dy)) * texel;
            float s = texture(tex, uv + off).r;
            float sw = exp(-float(dx * dx + dy * dy) / s2);
            float rw = exp(-((s - ref) * (s - ref)) / r2);
            float w = sw * rw;
            acc += s * w;
            wt += w;
        }
    }
    return acc / max(wt, 1e-4);
}

void main() {
    float y = texture(u_y, v_uv).r;
    vec2 range = getRange(u_colorSpace);
    float yNorm = (y - range.x) / range.y;
    vec2 chromaTexel = 1.0 / u_chromaSize;
    float sigS = max(u_sigmaS, 0.5);
    float sigR = max(u_sigmaR, 0.01);
    float cb = bilateral(u_u, v_uv, chromaTexel, yNorm, sigS, sigR) - 0.5;
    float cr = bilateral(u_v, v_uv, chromaTexel, yNorm, sigS, sigR) - 0.5;
    mat3 M = getMatrix(u_colorSpace);
    vec3 yuv = vec3(yNorm, cb, cr);
    vec3 rgb = M * yuv;
    o = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;

export class ColorSpaceConverter {
    private _gl: GL;
    private _yTex: WebGLTexture | null = null;
    private _uTex: WebGLTexture | null = null;
    private _vTex: WebGLTexture | null = null;
    private _nv12U: Uint8Array | null = null;
    private _nv12V: Uint8Array | null = null;
    private _nv12Size: number = 0;

    constructor(width: number, height: number) {
        this._gl = new GL(width, height);
        this._gl.loadFragmentShader(COLOR_SPACE_FRAG);
    }

    public convert(
        yPlane: Uint8Array, uPlane: Uint8Array, vPlane: Uint8Array,
        width: number, height: number,
        chromaW: number, chromaH: number,
        colorSpace: CSColorSpace = CSColorSpace.BT709_LIMITED,
        sigmaS: number = 1.5, sigmaR: number = 0.1
    ): void {
        const gl = this._gl.gl;
        this._yTex = this._uploadPlane(gl, this._yTex, yPlane, width, height, 0, 'u_y');
        this._uTex = this._uploadPlane(gl, this._uTex, uPlane, chromaW, chromaH, 1, 'u_u');
        this._vTex = this._uploadPlane(gl, this._vTex, vPlane, chromaW, chromaH, 2, 'u_v');
        this._gl
            .setUniform2f('u_chromaSize', chromaW, chromaH)
            .setUniform1f('u_sigmaS', sigmaS)
            .setUniform1f('u_sigmaR', sigmaR)
            .setUniform1i('u_colorSpace', colorSpace)
            .render();
    }

    public convertNV12(
        yPlane: Uint8Array, uvPlane: Uint8Array,
        width: number, height: number,
        colorSpace: CSColorSpace = CSColorSpace.BT709_LIMITED
    ): void {
        const chromaW = width >> 1;
        const chromaH = height >> 1;
        const chromaLen = chromaW * chromaH;
        if (this._nv12Size !== chromaLen) {
            this._nv12U = new Uint8Array(chromaLen);
            this._nv12V = new Uint8Array(chromaLen);
            this._nv12Size = chromaLen;
        }
        const uPlane = this._nv12U!;
        const vPlane = this._nv12V!;
        for (let i = 0; i < chromaLen; i++) {
            uPlane[i] = uvPlane[i * 2];
            vPlane[i] = uvPlane[i * 2 + 1];
        }
        this.convert(yPlane, uPlane, vPlane, width, height, chromaW, chromaH, colorSpace);
    }

    public async extract(): Promise<ImageBitmap> {
        return this._gl.extract();
    }

    public readPixels(): Uint8Array {
        const gl = this._gl.gl;
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        const pixels = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
    }

    public async toVideoFrame(timestamp: number): Promise<ImageBitmap | VideoFrame> {
        const bitmap = await this.extract();
        if (typeof VideoFrame !== 'undefined') {
            return new VideoFrame(bitmap, { timestamp });
        }
        return bitmap;
    }

    private _uploadPlane(
        gl: WebGL2RenderingContext, tex: WebGLTexture | null,
        data: Uint8Array, w: number, h: number, unit: number, name: string
    ): WebGLTexture {
        if (!tex) tex = gl.createTexture()!;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const p = this._gl.program;
        if (p) {
            const loc = gl.getUniformLocation(p, name);
            if (loc) gl.uniform1i(loc, unit);
        }
        return tex;
    }

    public dispose(): void {
        const gl = this._gl.gl;
        if (this._yTex) gl.deleteTexture(this._yTex);
        if (this._uTex) gl.deleteTexture(this._uTex);
        if (this._vTex) gl.deleteTexture(this._vTex);
    }

    public static cpuConvert(
        yPlane: Uint8Array, uPlane: Uint8Array, vPlane: Uint8Array,
        width: number, height: number,
        chromaW: number, chromaH: number,
        colorSpace: CSColorSpace = CSColorSpace.BT709_LIMITED
    ): Uint8ClampedArray {
        const out = new Uint8ClampedArray(width * height * 4);
        const matrices: Record<number, number[]> = {
            0: [1.164, 0, 1.596, 1.164, -0.392, -0.813, 1.164, 2.017, 0],
            1: [1, 0, 1.402, 1, -0.344136, -0.714136, 1, 1.772, 0],
            2: [1.164, 0, 1.793, 1.164, -0.213, -0.533, 1.164, 2.112, 0],
            3: [1, 0, 1.5748, 1, -0.1873, -0.4681, 1, 1.8556, 0],
            4: [1.164, 0, 1.679, 1.164, -0.188, -0.652, 1.164, 2.142, 0],
            5: [1, 0, 1.4746, 1, -0.1646, -0.5714, 1, 1.8814, 0]
        };
        const m = matrices[colorSpace] || matrices[2];
        const isLimited = colorSpace % 2 === 0;
        const scaleX = chromaW / width;
        const scaleY = chromaH / height;
        for (let py = 0; py < height; py++) {
            for (let px = 0; px < width; px++) {
                const yVal = yPlane[py * width + px];
                const cx = Math.min(Math.floor(px * scaleX), chromaW - 1);
                const cy = Math.min(Math.floor(py * scaleY), chromaH - 1);
                const cb = uPlane[cy * chromaW + cx] - 128;
                const cr = vPlane[cy * chromaW + cx] - 128;
                const y = isLimited ? (yVal - 16) : yVal;
                const r = m[0] * y + m[1] * cb + m[2] * cr;
                const g = m[3] * y + m[4] * cb + m[5] * cr;
                const b = m[6] * y + m[7] * cb + m[8] * cr;
                const i = (py * width + px) * 4;
                out[i] = Math.max(0, Math.min(255, r));
                out[i + 1] = Math.max(0, Math.min(255, g));
                out[i + 2] = Math.max(0, Math.min(255, b));
                out[i + 3] = 255;
            }
        }
        return out;
    }
}
