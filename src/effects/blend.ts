import { GL } from '../gl';

export type BlendModeType =
    'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' |
    'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' |
    'difference' | 'exclusion' | 'add';

export interface BlendOpts {
    mode?: BlendModeType;
    opacity?: number;
}

const BLEND_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_base;
uniform sampler2D u_blend;
uniform int u_mode;
uniform float u_opacity;

vec3 multiply(vec3 a, vec3 b) { return a * b; }
vec3 screen(vec3 a, vec3 b) { return 1.0 - (1.0 - a) * (1.0 - b); }
vec3 overlay(vec3 a, vec3 b) {
    return mix(
        2.0 * a * b,
        1.0 - 2.0 * (1.0 - a) * (1.0 - b),
        step(0.5, a)
    );
}
vec3 hardlight(vec3 a, vec3 b) { return overlay(b, a); }
vec3 softlight(vec3 a, vec3 b) {
    return mix(
        2.0*a*b + a*a*(1.0-2.0*b),
        sqrt(a)*(2.0*b-1.0) + 2.0*a*(1.0-b),
        step(0.5, b)
    );
}
vec3 colordodge(vec3 a, vec3 b) { return a / max(1.0 - b, 0.001); }
vec3 colorburn(vec3 a, vec3 b) { return 1.0 - (1.0 - a) / max(b, 0.001); }

void main(){
    vec4 base = texture(u_base, v_uv);
    vec4 blend = texture(u_blend, v_uv);
    vec3 a = base.rgb, b = blend.rgb;
    vec3 result;

    if      (u_mode == 0)  result = b * a;                         // multiply
    else if (u_mode == 1)  result = screen(a, b);                  // screen
    else if (u_mode == 2)  result = overlay(a, b);                 // overlay
    else if (u_mode == 3)  result = min(a, b);                     // darken
    else if (u_mode == 4)  result = max(a, b);                     // lighten
    else if (u_mode == 5)  result = clamp(colordodge(a, b),0.0,1.0); // color-dodge
    else if (u_mode == 6)  result = clamp(colorburn(a, b),0.0,1.0);  // color-burn
    else if (u_mode == 7)  result = hardlight(a, b);               // hard-light
    else if (u_mode == 8)  result = softlight(a, b);               // soft-light
    else if (u_mode == 9)  result = abs(a - b);                    // difference
    else if (u_mode == 10) result = a + b - 2.0*a*b;               // exclusion
    else if (u_mode == 11) result = clamp(a + b, 0.0, 1.0);       // add
    else                   result = b;                              // normal

    o = vec4(mix(a, result, u_opacity * blend.a), base.a);
}`;

const MODE_MAP: Record<BlendModeType, number> = {
    'multiply': 0, 'screen': 1, 'overlay': 2, 'darken': 3, 'lighten': 4,
    'color-dodge': 5, 'color-burn': 6, 'hard-light': 7, 'soft-light': 8,
    'difference': 9, 'exclusion': 10, 'add': 11
};

export class BlendEngine {
    private _gl: GL;

    constructor(width: number, height: number) {
        this._gl = new GL(width, height);
        this._gl.loadFragmentShader(BLEND_FRAG);
    }

    public async apply(
        base: ImageBitmap | OffscreenCanvas,
        blend: ImageBitmap | OffscreenCanvas,
        opts: BlendOpts = {}
    ): Promise<ImageBitmap> {
        const mode = opts.mode || 'screen';
        const opacity = opts.opacity ?? 1.0;
        const modeInt = MODE_MAP[mode] ?? 1;

        this._gl
            .bindTexture('u_base', base as TexImageSource, 0)
            .bindTexture('u_blend', blend as TexImageSource, 1)
            .setUniform1i('u_mode', modeInt)
            .setUniform1f('u_opacity', opacity)
            .render();
        return this._gl.extract();
    }

    public dispose(): void {
        try { const ext = this._gl.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (_) { }
    }
}
