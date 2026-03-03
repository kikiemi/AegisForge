import { GL, Shaders } from '../gl';

export interface DistortOptions {

    strength?: number;

    time?: number;

    dispMap?: ImageBitmap | HTMLImageElement;
}

export class DistortEngine {
    private _gl: GL;

    constructor(width: number, height: number) {
        this._gl = new GL(width, height);
        this._gl.loadFragmentShader(Shaders.Displacement);
    }

    public async apply(source: ImageBitmap | OffscreenCanvas, opts: DistortOptions = {}): Promise<ImageBitmap> {
        const gl = this._gl;
        gl.bindTexture('u_image', source as TexImageSource, 0);
        if (opts.dispMap) {
            gl.bindTexture('u_dispMap', opts.dispMap as TexImageSource, 1);
        }
        gl.setUniform1f('u_strength', opts.strength ?? 0.02);
        gl.setUniform1f('u_time', (opts.time ?? 0) / 1000);
        gl.render();
        return gl.extract();
    }

    public dispose(): void {
        try { const ext = this._gl.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (_) { }
    }
}

export class CRTEngine {
    private _gl: GL;

    constructor(width: number, height: number) {
        this._gl = new GL(width, height);
        this._gl.loadFragmentShader(Shaders.CRT);
    }

    public async apply(
        source: ImageBitmap | OffscreenCanvas,
        opts: { scanlineStrength?: number; barrel?: number; time?: number } = {}
    ): Promise<ImageBitmap> {
        this._gl
            .bindTexture('u_image', source as TexImageSource, 0)
            .setUniform1f('u_scanlineStrength', opts.scanlineStrength ?? 0.3)
            .setUniform1f('u_barrel', opts.barrel ?? 0.1)
            .setUniform1f('u_time', (opts.time ?? 0) / 1000)
            .render();
        return this._gl.extract();
    }

    public dispose(): void {
        try { const ext = this._gl.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (_) { }
    }
}
