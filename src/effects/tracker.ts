import { GL } from '../gl';

export interface TrackerOpts {
    threshold?: number;
    highlightColor?: [number, number, number];
    blurRadius?: number;
}

const DIFF_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_current;
uniform sampler2D u_previous;
uniform float u_threshold;
uniform vec3 u_highlight;
uniform vec2 u_texelSize;

void main(){
    vec3 curr = texture(u_current, v_uv).rgb;
    vec3 prev = texture(u_previous, v_uv).rgb;
    float diff = length(curr - prev);

    float motion = 0.0;
    int r = 2;
    for(int dy=-r; dy<=r; dy++){
        for(int dx=-r; dx<=r; dx++){
            vec2 off = vec2(float(dx), float(dy)) * u_texelSize;
            vec3 c = texture(u_current, v_uv + off).rgb;
            vec3 p = texture(u_previous, v_uv + off).rgb;
            motion += length(c - p);
        }
    }
    motion /= float((2*r+1)*(2*r+1));

    float mask = smoothstep(u_threshold * 0.5, u_threshold, motion);
    vec3 highlight = curr + u_highlight * mask * 0.6;
    o = vec4(clamp(highlight, 0.0, 1.0), 1.0);
}`;

export class MotionTrackerEngine {
    private _gl: GL;
    private _hasPrev = false;
    private w: number;
    private h: number;

    constructor(width: number, height: number) {
        this.w = width;
        this.h = height;
        this._gl = new GL(width, height);
        this._gl.loadFragmentShader(DIFF_FRAG);
    }

    public async apply(
        source: ImageBitmap | OffscreenCanvas,
        opts: TrackerOpts = {}
    ): Promise<ImageBitmap> {
        const threshold = opts.threshold ?? 0.08;
        const highlight = opts.highlightColor ?? [1, 0.2, 0.2];

        if (!this._hasPrev) {
            this._gl.bindTexture('u_current', source as TexImageSource, 0);
            this._gl.bindTexture('u_previous', source as TexImageSource, 1);
            this._hasPrev = true;
        } else {
            this._gl.bindTexture('u_current', source as TexImageSource, 0);
        }

        this._gl
            .setUniform1f('u_threshold', threshold)
            .setUniform3f('u_highlight', highlight[0], highlight[1], highlight[2])
            .setUniform2f('u_texelSize', 1 / this.w, 1 / this.h)
            .render();

        this._gl.bindTexture('u_previous', source as TexImageSource, 1);

        return this._gl.extract();
    }

    public reset(): void {
        this._hasPrev = false;
    }

    public dispose(): void {
        try { const ext = this._gl.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (_) { }
    }
}
