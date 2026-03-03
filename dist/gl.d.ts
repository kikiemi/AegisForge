/**
 * AegisForge GL (WebGL) Engine
 * An ultra-high-performance GPU Fragment Shader rendering pipeline.
 * Designed to execute complex VFX (Bloom, CRT, Displacements) at <1ms per frame.
 */
export declare class GL {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    gl: WebGL2RenderingContext | WebGLRenderingContext;
    program: WebGLProgram | null;
    textures: Map<string, WebGLTexture>;
    private uniformLocs;
    constructor(width: number, height: number);
    /**
     * Compiles a WebGL Shader
     */
    private compileShader;
    /**
     * Loads and compiles a Fragment Shader string into the GPU pipeline.
     */
    loadFragmentShader(fragmentSource: string): this;
    /**
     * Set a uniform float value in the shader
     */
    setUniform1f(name: string, value: number): this;
    /**
     * Binds an external image/canvas as a WebGL Texture on the given uniform unit.
     */
    bindTexture(name: string, source: TexImageSource | any, unit?: number): this;
    /**
     * Executes the WebGL draw call and renders output to the canvas
     */
    render(): this;
    /**
     * Retrieves the rendered output as an ImageBitmap (requires async)
     * Extremely fast zero-copy memory transfer natively supported by browser.
     */
    extract(): Promise<ImageBitmap>;
}
/**
 * Keyframe Interpolation Engine
 * Calculates properties based on timeline position for seamless animations (opacity, PIP position).
 */
export declare class KeyframeEngine {
    keys: {
        t: number;
        v: number;
    }[];
    constructor(keyframes: {
        t: number;
        v: number;
    }[]);
    get(timeSec: number): number;
}
/**
 * CompositeGL (Multi-Layer Engine)
 * Automatically compiles a PIP and translucency shader for overlapping video arrays.
 */
export declare class CompositeGL extends GL {
    constructor(width: number, height: number);
    drawPIP(base: any, overlay: any, alpha: number, rect: [number, number, number, number]): this;
}
/**
 * WebGPUEngine
 * Experimental Compute Shader dispatcher for bleeding-edge heavy pixel workloads (AI filters, complex chroma key)
 */
export declare class WebGPUEngine {
    device: any;
    pipeline: any;
    init(computeShaderWGSL: string): Promise<void>;
    compute(width: number, height: number): Promise<void>;
}
