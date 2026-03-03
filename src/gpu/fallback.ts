export const enum GPUTier {
    WEBGPU = 3,
    WEBGL2 = 2,
    WEBGL1 = 1,
    CPU = 0
}

export interface GPUCapabilities {
    tier: GPUTier;
    floatTextures: boolean;
    halfFloatTextures: boolean;
    instancedArrays: boolean;
    drawBuffers: boolean;
    depthTexture: boolean;
    colorBufferFloat: boolean;
    maxTextureSize: number;
    maxRenderbufferSize: number;
    maxVertexAttribs: number;
    renderer: string;
    vendor: string;
    timerQuery: boolean;
    parallelCompile: boolean;
}

export class FallbackRouter {
    private _caps: GPUCapabilities | null = null;
    private _probeCanvas: OffscreenCanvas | null = null;

    public async detect(): Promise<GPUCapabilities> {
        if (this._caps) return this._caps;
        if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
            try {
                const gpu = navigator.gpu;
                const adapter = await gpu.requestAdapter();
                if (adapter) {
                    const device = await adapter.requestDevice();
                    if (device) {
                        device.destroy();
                        this._caps = this._buildWebGPUCaps();
                        return this._caps;
                    }
                }
            } catch (e) {  }
        }
        this._probeCanvas = new OffscreenCanvas(1, 1);
        const gl2 = this._probeCanvas.getContext('webgl2') as WebGL2RenderingContext | null;
        if (gl2) {
            this._caps = this._probeWebGL2(gl2);
            return this._caps;
        }
        const gl1 = this._probeCanvas.getContext('webgl') as WebGLRenderingContext | null;
        if (gl1) {
            this._caps = this._probeWebGL1(gl1);
            return this._caps;
        }
        this._caps = this._cpuOnly();
        return this._caps;
    }

    public get caps(): GPUCapabilities {
        if (!this._caps) return this._cpuOnly();
        return this._caps;
    }

    public get tier(): GPUTier {
        return this._caps?.tier ?? GPUTier.CPU;
    }

    public canUseEffect(effect: string): GPUTier {
        const c = this._caps || this._cpuOnly();
        const heavy = ['bloom', 'blur', 'colorGrade', 'displacement', 'crt', 'lut3d'];
        const needsFloat = ['bloom', 'colorGrade', 'lut3d'];
        if (heavy.includes(effect)) {
            if (c.tier >= GPUTier.WEBGL2 && (c.floatTextures || !needsFloat.includes(effect))) {
                return GPUTier.WEBGL2;
            }
            if (c.tier >= GPUTier.WEBGL1 && !needsFloat.includes(effect)) {
                return GPUTier.WEBGL1;
            }
            return GPUTier.CPU;
        }
        return c.tier;
    }

    public selectBlurPath(): 'gpu_separable' | 'gpu_box' | 'cpu_box' {
        const c = this._caps || this._cpuOnly();
        if (c.tier >= GPUTier.WEBGL2) return 'gpu_separable';
        if (c.tier >= GPUTier.WEBGL1) return 'gpu_box';
        return 'cpu_box';
    }

    public selectColorPath(): 'gpu_hdr' | 'gpu_ldr' | 'cpu_ldr' {
        const c = this._caps || this._cpuOnly();
        if (c.tier >= GPUTier.WEBGL2 && c.colorBufferFloat) return 'gpu_hdr';
        if (c.tier >= GPUTier.WEBGL1) return 'gpu_ldr';
        return 'cpu_ldr';
    }

    public selectCompositorPath(): 'multi_layer' | 'single_pass' | 'cpu_blend' {
        const c = this._caps || this._cpuOnly();
        if (c.tier >= GPUTier.WEBGL2 && c.drawBuffers) return 'multi_layer';
        if (c.tier >= GPUTier.WEBGL1) return 'single_pass';
        return 'cpu_blend';
    }

    private _buildWebGPUCaps(): GPUCapabilities {
        return {
            tier: GPUTier.WEBGPU,
            floatTextures: true, halfFloatTextures: true,
            instancedArrays: true, drawBuffers: true,
            depthTexture: true, colorBufferFloat: true,
            maxTextureSize: 16384, maxRenderbufferSize: 16384,
            maxVertexAttribs: 32, renderer: 'WebGPU',
            vendor: 'GPU', timerQuery: true, parallelCompile: true
        };
    }

    private _probeWebGL2(gl: WebGL2RenderingContext): GPUCapabilities {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        return {
            tier: GPUTier.WEBGL2,
            floatTextures: !!gl.getExtension('EXT_color_buffer_float'),
            halfFloatTextures: !!gl.getExtension('EXT_color_buffer_half_float'),
            instancedArrays: true,
            drawBuffers: true,
            depthTexture: true,
            colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
            maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
            maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
            maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
            renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'WebGL2',
            vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : 'Unknown',
            timerQuery: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
            parallelCompile: !!gl.getExtension('KHR_parallel_shader_compile')
        };
    }

    private _probeWebGL1(gl: WebGLRenderingContext): GPUCapabilities {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        return {
            tier: GPUTier.WEBGL1,
            floatTextures: !!gl.getExtension('OES_texture_float'),
            halfFloatTextures: !!gl.getExtension('OES_texture_half_float'),
            instancedArrays: !!gl.getExtension('ANGLE_instanced_arrays'),
            drawBuffers: !!gl.getExtension('WEBGL_draw_buffers'),
            depthTexture: !!gl.getExtension('WEBGL_depth_texture'),
            colorBufferFloat: false,
            maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
            maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
            maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
            renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'WebGL1',
            vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : 'Unknown',
            timerQuery: !!gl.getExtension('EXT_disjoint_timer_query'),
            parallelCompile: false
        };
    }

    private _cpuOnly(): GPUCapabilities {
        return {
            tier: GPUTier.CPU,
            floatTextures: false, halfFloatTextures: false,
            instancedArrays: false, drawBuffers: false,
            depthTexture: false, colorBufferFloat: false,
            maxTextureSize: 0, maxRenderbufferSize: 0,
            maxVertexAttribs: 0, renderer: 'CPU',
            vendor: 'Software', timerQuery: false, parallelCompile: false
        };
    }

    public dispose(): void {
        this._probeCanvas = null;
    }
}

export class CPUEffects {
    public static boxBlur(pixels: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
        const r = Math.max(1, Math.min(radius, 50));
        const d = 2 * r + 1;
        const inv = 1 / d;
        const tmp = new Uint8ClampedArray(pixels.length);
        const out = new Uint8ClampedArray(pixels.length);
        for (let y = 0; y < h; y++) {
            let rr = 0, gg = 0, bb = 0, aa = 0;
            for (let dx = -r; dx <= r; dx++) {
                const sx = Math.max(0, Math.min(w - 1, dx));
                const i = (y * w + sx) * 4;
                rr += pixels[i]; gg += pixels[i + 1]; bb += pixels[i + 2]; aa += pixels[i + 3];
            }
            for (let x = 0; x < w; x++) {
                const o = (y * w + x) * 4;
                tmp[o] = rr * inv; tmp[o + 1] = gg * inv; tmp[o + 2] = bb * inv; tmp[o + 3] = aa * inv;
                const addX = Math.min(w - 1, x + r + 1);
                const remX = Math.max(0, x - r);
                const ai = (y * w + addX) * 4, ri = (y * w + remX) * 4;
                rr += pixels[ai] - pixels[ri];
                gg += pixels[ai + 1] - pixels[ri + 1];
                bb += pixels[ai + 2] - pixels[ri + 2];
                aa += pixels[ai + 3] - pixels[ri + 3];
            }
        }
        for (let x = 0; x < w; x++) {
            let rr = 0, gg = 0, bb = 0, aa = 0;
            for (let dy = -r; dy <= r; dy++) {
                const sy = Math.max(0, Math.min(h - 1, dy));
                const i = (sy * w + x) * 4;
                rr += tmp[i]; gg += tmp[i + 1]; bb += tmp[i + 2]; aa += tmp[i + 3];
            }
            for (let y = 0; y < h; y++) {
                const o = (y * w + x) * 4;
                out[o] = rr * inv; out[o + 1] = gg * inv; out[o + 2] = bb * inv; out[o + 3] = aa * inv;
                const addY = Math.min(h - 1, y + r + 1);
                const remY = Math.max(0, y - r);
                const ai = (addY * w + x) * 4, ri = (remY * w + x) * 4;
                rr += tmp[ai] - tmp[ri];
                gg += tmp[ai + 1] - tmp[ri + 1];
                bb += tmp[ai + 2] - tmp[ri + 2];
                aa += tmp[ai + 3] - tmp[ri + 3];
            }
        }
        return out;
    }

    public static brightness(pixels: Uint8ClampedArray, factor: number): Uint8ClampedArray {
        const out = new Uint8ClampedArray(pixels.length);
        for (let i = 0; i < pixels.length; i += 4) {
            out[i] = Math.max(0, Math.min(255, pixels[i] * factor));
            out[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] * factor));
            out[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] * factor));
            out[i + 3] = pixels[i + 3];
        }
        return out;
    }

    public static grayscale(pixels: Uint8ClampedArray): Uint8ClampedArray {
        const out = new Uint8ClampedArray(pixels.length);
        for (let i = 0; i < pixels.length; i += 4) {
            const v = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
            out[i] = out[i + 1] = out[i + 2] = v;
            out[i + 3] = pixels[i + 3];
        }
        return out;
    }
}
