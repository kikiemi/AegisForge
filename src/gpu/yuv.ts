import { GL } from '../gl';

const YUV_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_y;
uniform sampler2D u_u;
uniform sampler2D u_v;
uniform vec2 u_chromaSize;
uniform float u_sigmaS;
uniform float u_sigmaR;
uniform int u_colorSpace;

vec3 bt601(float y, float cb, float cr) {
    return vec3(
        y + 1.402 * cr,
        y - 0.344136 * cb - 0.714136 * cr,
        y + 1.772 * cb
    );
}

vec3 bt709(float y, float cb, float cr) {
    return vec3(
        y + 1.5748 * cr,
        y - 0.1873 * cb - 0.4681 * cr,
        y + 1.8556 * cb
    );
}

float chromaBilateral(sampler2D tex, vec2 uv, vec2 texelSize, float refLuma, float sigS, float sigR) {
    float acc = 0.0;
    float wt = 0.0;
    float s2 = sigS * sigS * 2.0;
    float r2 = sigR * sigR * 2.0;
    int r = int(sigS * 2.0);
    for (int dy = -r; dy <= r; dy++) {
        for (int dx = -r; dx <= r; dx++) {
            vec2 off = vec2(float(dx), float(dy)) * texelSize;
            float sample_val = texture(tex, uv + off).r;
            float spatialW = exp(-float(dx * dx + dy * dy) / s2);
            float diff = sample_val - refLuma;
            float rangeW = exp(-(diff * diff) / r2);
            float w = spatialW * rangeW;
            acc += sample_val * w;
            wt += w;
        }
    }
    return acc / max(wt, 0.0001);
}

void main() {
    float y = texture(u_y, v_uv).r;
    float sigS = max(u_sigmaS, 0.5);
    float sigR = max(u_sigmaR, 0.01);
    vec2 chromaTexel = 1.0 / u_chromaSize;
    float cb = chromaBilateral(u_u, v_uv, chromaTexel, y, sigS, sigR) - 0.5;
    float cr = chromaBilateral(u_v, v_uv, chromaTexel, y, sigS, sigR) - 0.5;
    vec3 rgb;
    if (u_colorSpace == 1) {
        rgb = bt709(y, cb, cr);
    } else {
        rgb = bt601(y, cb, cr);
    }
    o = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;

export const enum ColorSpace {
    BT601 = 0,
    BT709 = 1
}

export class YUVConverter {
    private _gl: GL;
    private _yTex: WebGLTexture | null = null;
    private _uTex: WebGLTexture | null = null;
    private _vTex: WebGLTexture | null = null;

    constructor(width: number, height: number) {
        this._gl = new GL(width, height);
        this._gl.loadFragmentShader(YUV_FRAG);
    }

    public async convert(
        yPlane: Uint8Array, uPlane: Uint8Array, vPlane: Uint8Array,
        width: number, height: number,
        chromaW: number, chromaH: number,
        colorSpace: ColorSpace = ColorSpace.BT709,
        sigmaS: number = 1.5,
        sigmaR: number = 0.1
    ): Promise<ImageBitmap> {
        const gl = this._gl.gl;
        this._yTex = this._uploadPlane(gl, this._yTex, yPlane, width, height, 0);
        this._uTex = this._uploadPlane(gl, this._uTex, uPlane, chromaW, chromaH, 1);
        this._vTex = this._uploadPlane(gl, this._vTex, vPlane, chromaW, chromaH, 2);
        this._gl
            .setUniform2f('u_chromaSize', chromaW, chromaH)
            .setUniform1f('u_sigmaS', sigmaS)
            .setUniform1f('u_sigmaR', sigmaR)
            .setUniform1i('u_colorSpace', colorSpace)
            .render();
        return this._gl.extract();
    }

    public async extract(): Promise<ImageBitmap> {
        return this._gl.extract();
    }

    private _uploadPlane(
        gl: WebGL2RenderingContext, tex: WebGLTexture | null,
        data: Uint8Array, w: number, h: number, unit: number
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
            const names = ['u_y', 'u_u', 'u_v'];
            const loc = gl.getUniformLocation(p, names[unit]);
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
}
