import { GL } from '../gl';

export interface FractalOpts {
    type?: 'mandelbrot' | 'julia';
    centerX?: number;
    centerY?: number;
    zoomSpeed?: number;
    maxIter?: number;
    juliaC?: [number, number];
}

const MANDELBROT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform float u_time;
uniform float u_zoom;
uniform vec2 u_center;
uniform float u_maxIter;
void main(){
    vec2 c = (v_uv - 0.5) * 4.0 / u_zoom + u_center;
    vec2 z = c;
    float iter = 0.0;
    for(float i=0.0; i<500.0; i++){
        if(i >= u_maxIter) break;
        if(dot(z,z) > 4.0) break;
        z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
        iter++;
    }
    if(iter >= u_maxIter){
        o = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
        float si = iter + 1.0 - log(log(length(z))) / log(2.0);
        float hue = si / u_maxIter;
        vec3 col = 0.5 + 0.5*cos(3.0 + hue*6.2831 + vec3(0.0,0.6,1.0));
        o = vec4(col, 1.0);
    }
}`;

const JULIA_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform float u_time;
uniform float u_zoom;
uniform vec2 u_center;
uniform vec2 u_juliaC;
uniform float u_maxIter;
void main(){
    vec2 z = (v_uv - 0.5) * 4.0 / u_zoom + u_center;
    vec2 c = u_juliaC;
    float iter = 0.0;
    for(float i=0.0; i<500.0; i++){
        if(i >= u_maxIter) break;
        if(dot(z,z) > 4.0) break;
        z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
        iter++;
    }
    if(iter >= u_maxIter){
        o = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
        float si = iter + 1.0 - log(log(length(z))) / log(2.0);
        float hue = si / u_maxIter;
        vec3 col = 0.5 + 0.5*cos(3.0 + hue*6.2831 + vec3(0.0,0.6,1.0));
        o = vec4(col, 1.0);
    }
}`;

export class FractalEngine {
    private _mandelbrotGL: GL;
    private _juliaGL: GL;
    private cfg: Required<FractalOpts>;

    constructor(width: number, height: number, opts: FractalOpts = {}) {
        this.cfg = {
            type: opts.type || 'mandelbrot',
            centerX: opts.centerX ?? -0.743643887037151,
            centerY: opts.centerY ?? 0.131825904205330,
            zoomSpeed: opts.zoomSpeed ?? 0.5,
            maxIter: opts.maxIter ?? 200,
            juliaC: opts.juliaC || [-0.7, 0.27015]
        };
        this._mandelbrotGL = new GL(width, height);
        this._mandelbrotGL.loadFragmentShader(MANDELBROT_FRAG);
        this._juliaGL = new GL(width, height);
        this._juliaGL.loadFragmentShader(JULIA_FRAG);
    }

    public async apply(timeMs: number): Promise<ImageBitmap> {
        const zoom = 1.0 + (timeMs / 1000) * this.cfg.zoomSpeed;

        if (this.cfg.type === 'julia') {
            this._juliaGL
                .setUniform1f('u_time', timeMs / 1000)
                .setUniform1f('u_zoom', zoom)
                .setUniform2f('u_center', this.cfg.centerX, this.cfg.centerY)
                .setUniform2f('u_juliaC', this.cfg.juliaC[0], this.cfg.juliaC[1])
                .setUniform1f('u_maxIter', this.cfg.maxIter)
                .render();
            return this._juliaGL.extract();
        }

        this._mandelbrotGL
            .setUniform1f('u_time', timeMs / 1000)
            .setUniform1f('u_zoom', zoom)
            .setUniform2f('u_center', this.cfg.centerX, this.cfg.centerY)
            .setUniform1f('u_maxIter', this.cfg.maxIter)
            .render();
        return this._mandelbrotGL.extract();
    }

    public async overlay(source: ImageBitmap, timeMs: number, blend: number = 0.3): Promise<ImageBitmap> {
        const fractal = await this.apply(timeMs);
        const c = new OffscreenCanvas(source.width, source.height);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(source, 0, 0);
        ctx.globalAlpha = blend;
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(fractal, 0, 0, source.width, source.height);
        fractal.close();
        return createImageBitmap(c);
    }

    public dispose(): void {
        for (const g of [this._mandelbrotGL, this._juliaGL]) {
            try {
                const ext = g.gl.getExtension('WEBGL_lose_context');
                if (ext) ext.loseContext();
            } catch (_) { }
        }
    }
}
