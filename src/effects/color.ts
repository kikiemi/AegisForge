import { GL, Shaders } from '../gl';

export interface ColorGradeOptions {

    lift?: [number, number, number];

    gamma?: [number, number, number];

    gain?: [number, number, number];

    saturation?: number;

    hue?: number;
}

export interface ACESOpts {

    exposure?: number;
}

export class ColorGradeEngine {
    private _gl: GL;

    constructor(width: number, height: number) {
        this._gl = new GL(width, height, { hdr: true });
        this._gl.loadFragmentShader(Shaders.ColorGrade);
    }

    public async apply(source: ImageBitmap | OffscreenCanvas, opts: ColorGradeOptions = {}): Promise<ImageBitmap> {
        const lift = opts.lift ?? [0, 0, 0];
        const gamma = opts.gamma ?? [1, 1, 1];
        const gain = opts.gain ?? [1, 1, 1];
        this._gl
            .bindTexture('u_image', source as TexImageSource, 0)
            .setUniform3f('u_lift', lift[0], lift[1], lift[2])
            .setUniform3f('u_gamma', gamma[0] - 1, gamma[1] - 1, gamma[2] - 1)
            .setUniform3f('u_gain', gain[0] - 1, gain[1] - 1, gain[2] - 1)
            .setUniform1f('u_saturation', opts.saturation ?? 1)
            .setUniform1f('u_hue', opts.hue ?? 0)
            .render();
        return this._gl.extract();
    }

    public dispose(): void {
        try { const ext = this._gl.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (_) { }
    }
}

export class ACESToneMappingEngine {
    private _gl: GL;

    constructor(width: number, height: number) {
        this._gl = new GL(width, height, { hdr: true });
        this._gl.loadFragmentShader(Shaders.ACESToneMap);
    }

    public async apply(source: ImageBitmap | OffscreenCanvas, opts: ACESOpts = {}): Promise<ImageBitmap> {
        this._gl
            .bindTexture('u_image', source as TexImageSource, 0)
            .setUniform1f('u_exposure', opts.exposure ?? 1.0)
            .render();
        return this._gl.extract();
    }

    public dispose(): void {
        try { const ext = this._gl.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (_) { }
    }
}

export class LUT3DEngine {
    private _gl: GL;

    constructor(width: number, height: number) {
        this._gl = new GL(width, height);
        this._gl.loadFragmentShader(Shaders.LUT3D);
    }

    public async apply(
        source: ImageBitmap | OffscreenCanvas,
        lut: ImageBitmap | HTMLImageElement,
        intensity: number = 1.0
    ): Promise<ImageBitmap> {
        this._gl
            .bindTexture('u_image', source as TexImageSource, 0)
            .bindTexture('u_lut', lut as TexImageSource, 1)
            .setUniform1f('u_intensity', intensity)
            .render();
        return this._gl.extract();
    }

    public dispose(): void {
        try { const ext = this._gl.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (_) { }
    }
}
