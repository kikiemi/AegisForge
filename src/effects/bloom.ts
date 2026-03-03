import { GL, FBOChain, Shaders } from '../gl';
import type { AegisCore } from '../core/AegisCore';

export interface BloomOptions {
    threshold?: number;
    intensity?: number;
    passes?: number;
}

export class BloomEngine {
    private _threshold: GL;
    private _down: GL;
    private _up: GL;
    private _composite: GL;
    private _chains: FBOChain[];
    private w: number; private h: number;

    constructor(width: number, height: number) {
        this.w = width; this.h = height;
        this._threshold = new GL(width, height, { hdr: true });
        this._threshold.loadFragmentShader(Shaders.BloomThreshold);

        this._down = new GL(width, height, { hdr: true });
        this._down.loadFragmentShader(Shaders.KawaseDown);

        this._up = new GL(width, height, { hdr: true });
        this._up.loadFragmentShader(Shaders.KawaseUp);

        this._composite = new GL(width, height, { hdr: true });
        this._composite.loadFragmentShader(Shaders.BloomComposite);

        this._chains = Array.from({ length: 5 }, () =>
            new FBOChain(this._down.gl, width, height, true)
        );
    }

    public async apply(source: ImageBitmap | OffscreenCanvas, opts: BloomOptions = {}): Promise<ImageBitmap> {
        const { threshold = 0.8, intensity = 1.0, passes = 4 } = opts;
        const n = Math.min(Math.max(1, Math.floor(passes)), 5);
        const tw = 1 / this.w, th = 1 / this.h;

        this._threshold
            .bindTexture('u_image', source as TexImageSource, 0)
            .setUniform1f('u_threshold', threshold)
            .render(this._chains[0].writeFBO);
        this._chains[0].swap();

        for (let i = 0; i < n; i++) {
            const src = this._chains[i];
            const dst = this._chains[Math.min(i + 1, n - 1)];
            const gl = this._down.gl;
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, src.readTex);
            this._down.setUniform1i('u_image', 0);
            this._down
                .setUniform1f('u_iteration', i)
                .setUniform2f('u_texelSize', tw * (i + 1), th * (i + 1))
                .render(dst.writeFBO);
            dst.swap();
        }

        for (let i = n - 1; i >= 0; i--) {
            const src = this._chains[Math.min(i + 1, n - 1)];
            const dst = this._chains[i];
            const gl2 = this._up.gl;
            gl2.activeTexture(gl2.TEXTURE0);
            gl2.bindTexture(gl2.TEXTURE_2D, src.readTex);
            this._up.setUniform1i('u_image', 0);
            this._up
                .setUniform1f('u_iteration', i)
                .setUniform2f('u_texelSize', tw, th)
                .render(dst.writeFBO);
            dst.swap();
        }

        const gl3 = this._composite.gl;
        this._composite.bindTexture('u_image', source as TexImageSource, 0);
        gl3.activeTexture(gl3.TEXTURE1);
        gl3.bindTexture(gl3.TEXTURE_2D, this._chains[0].readTex);
        this._composite.setUniform1i('u_bloom', 1);
        this._composite.setUniform1f('u_intensity', intensity).render();

        return this._composite.extract();
    }

    public dispose(): void {
        this._chains.forEach(c => c.dispose());
        for (const g of [this._threshold, this._down, this._up, this._composite]) {
            try {
                const ext = g.gl.getExtension('WEBGL_lose_context');
                if (ext) ext.loseContext();
            } catch (_) { }
        }
    }
}

export function bloomPlugin(opts: BloomOptions = {}): { init: (core: AegisCore) => void; applyBloom: (frame: ImageBitmap) => Promise<ImageBitmap>; dispose: () => void } {
    let engine: BloomEngine | null = null;

    const applyBloom = async (frame: ImageBitmap): Promise<ImageBitmap> => {
        if (!engine) throw new Error('[BloomPlugin] Not initialized — call init() first');
        return engine.apply(frame, opts);
    };

    return {
        init(core: AegisCore) {
            engine = new BloomEngine(core.config.width, core.config.height);
        },
        applyBloom,
        dispose() {
            if (engine) { engine.dispose(); engine = null; }
        }
    };
}
