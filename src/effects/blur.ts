import { GL, FBOChain, Shaders } from '../gl';

export interface GaussianBlurOptions {

    radius?: number;

    passes?: number;
}

export class GaussianBlurEngine {
    private _hPass: GL;
    private _vPass: GL;
    private _fbo: FBOChain;
    private w: number; private h: number;

    constructor(width: number, height: number) {
        this.w = width; this.h = height;
        this._hPass = new GL(width, height); this._hPass.loadFragmentShader(Shaders.GaussianBlur);
        this._vPass = new GL(width, height); this._vPass.loadFragmentShader(Shaders.GaussianBlur);
        this._fbo = new FBOChain(this._hPass.gl, width, height);
    }

    public async apply(
        source: ImageBitmap | OffscreenCanvas,
        opts: GaussianBlurOptions = {}
    ): Promise<ImageBitmap> {
        const { radius = 8, passes = 1 } = opts;
        const tw = 1 / this.w, th = 1 / this.h;

        this._hPass.bindTexture('u_image', source as TexImageSource, 0);
        this._hPass
            .setUniform2f('u_texelSize', tw, th)
            .setUniform2f('u_dir', 1, 0)
            .setUniform1f('u_radius', radius)
            .render(this._fbo.writeFBO);
        this._fbo.swap();

        for (let p = 0; p < passes; p++) {

            const gl = this._vPass.gl;
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this._fbo.readTex);
            this._vPass.setUniform1i('u_image', 0);
            this._vPass
                .setUniform2f('u_texelSize', tw, th)
                .setUniform2f('u_dir', 0, 1)
                .setUniform1f('u_radius', radius)
                .render(this._fbo.writeFBO);
            this._fbo.swap();

            if (p < passes - 1) {

                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, this._fbo.readTex);
                this._hPass.setUniform1i('u_image', 0);
                this._hPass
                    .setUniform2f('u_texelSize', tw, th)
                    .setUniform2f('u_dir', 1, 0)
                    .setUniform1f('u_radius', radius)
                    .render(this._fbo.writeFBO);
                this._fbo.swap();
            }
        }

        return this._vPass.extract();
    }

    public dispose(): void {
        this._fbo.dispose();
        for (const g of [this._hPass, this._vPass]) {
            try { const ext = g.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (_) { }
        }
    }
}
