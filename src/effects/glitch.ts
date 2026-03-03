import { AegisCore, AegisPlugin, Clip } from '../core/AegisCore';
import { GL, Shaders } from '../gl';
import { log } from '../core';

export interface GlitchOpts {
    amount?: number;
    intervalMs?: number;
    seed?: number;
}

const GLITCH_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform float u_amount;
uniform float u_active;
uniform float u_seed;

float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233)) + u_seed) * 43758.5453);
}

void main() {
    vec2 uv = v_uv;
    if (u_active > 0.5) {
        float shift = u_amount / 100.0;
        float scanLine = rand(vec2(0.0, floor(uv.y * 50.0))) * shift;
        float r = texture(u_image, vec2(uv.x - shift + scanLine, uv.y)).r;
        float g = texture(u_image, uv).g;
        float b = texture(u_image, vec2(uv.x + shift - scanLine, uv.y)).b;
        float a = texture(u_image, uv).a;
        o = vec4(r, g, b, a);
    } else {
        o = texture(u_image, uv);
    }
}`;

export function rgbGlitch(opts: GlitchOpts = {}): AegisPlugin {
    const amt = opts.amount ?? 5;
    const interval = opts.intervalMs ?? 500;
    const seed = opts.seed ?? Math.random() * 100;

    let glitchGL: GL | null = null;
    let glitchActive = 0;
    let glitchSeed = 0;

    return {
        init(core: AegisCore) {
            glitchGL = new GL(core.config.width, core.config.height);
            glitchGL.loadFragmentShader(GLITCH_FRAG);
        },
        onBeforeFrame(_core: AegisCore, _clips: Clip[], timeMs: number) {
            const shouldGlitch = Math.floor(timeMs / interval) % 2 === 0;
            glitchActive = shouldGlitch ? 1.0 : 0.0;
            glitchSeed = seed + timeMs * 0.01;
        },
        onAfterFrame: async (_core: AegisCore, _fIdx: number) => {
            if (!glitchGL || glitchActive < 0.5) return;
            const compositor = (_core as unknown as { _compositor?: { gl: WebGL2RenderingContext; canvas: OffscreenCanvas | HTMLCanvasElement } })._compositor;
            if (!compositor) return;
            try {
                const bitmap = await createImageBitmap(compositor.canvas as HTMLCanvasElement);
                glitchGL.bindTexture('u_image', bitmap as TexImageSource, 0)
                    .setUniform1f('u_amount', amt)
                    .setUniform1f('u_active', glitchActive)
                    .setUniform1f('u_seed', glitchSeed)
                    .render();
                const result = await glitchGL.extract();
                const gl = compositor.gl;
                gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, result);
                bitmap.close();
                result.close();
            } catch (e) { log.warn('[Glitch] Post-process failed', e); }
        },
        dispose() {
            if (glitchGL) {
                try {
                    const ext = glitchGL.gl.getExtension('WEBGL_lose_context');
                    if (ext) ext.loseContext();
                } catch (_) { }
                glitchGL = null;
            }
        }
    };
}
