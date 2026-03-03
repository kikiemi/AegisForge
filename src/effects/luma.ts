import { GL } from '../gl';

export interface LumaOpts {
    threshold?: number;
    smoothness?: number;
}

const LUMA_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform float u_threshold;
uniform float u_smoothness;
void main(){
    vec4 color = texture(u_image, v_uv);
    float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    float alpha = smoothstep(u_threshold, u_threshold + u_smoothness, luma);
    o = vec4(color.rgb, color.a * alpha);
}`;

export class LumaKeyEngine {
    private _gl: GL;

    constructor(width: number, height: number) {
        this._gl = new GL(width, height);
        this._gl.loadFragmentShader(LUMA_FRAG);
    }

    public async apply(
        source: ImageBitmap | OffscreenCanvas,
        opts: LumaOpts = {}
    ): Promise<ImageBitmap> {
        const threshold = opts.threshold ?? 0.1;
        const smoothness = opts.smoothness ?? 0.05;

        this._gl
            .bindTexture('u_image', source as TexImageSource, 0)
            .setUniform1f('u_threshold', threshold)
            .setUniform1f('u_smoothness', smoothness)
            .render();
        return this._gl.extract();
    }

    public dispose(): void {
        try { const ext = this._gl.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (_) { }
    }
}
