import { AegisError } from './core';
/**
 * AegisForge GL (WebGL) Engine
 * An ultra-high-performance GPU Fragment Shader rendering pipeline.
 * Designed to execute complex VFX (Bloom, CRT, Displacements) at <1ms per frame.
 */
export class GL {
    canvas;
    gl;
    program = null;
    textures = new Map();
    uniformLocs = new Map();
    constructor(width, height) {
        if (typeof OffscreenCanvas !== 'undefined') {
            this.canvas = new OffscreenCanvas(width, height);
        }
        else {
            this.canvas = document.createElement('canvas');
            this.canvas.width = width;
            this.canvas.height = height;
        }
        const opts = { alpha: true, antialias: false, depth: false, preserveDrawingBuffer: true };
        const ctxList = ['webgl2', 'webgl', 'experimental-webgl'];
        let ctx = null;
        for (const c of ctxList) {
            ctx = this.canvas.getContext(c, opts);
            if (ctx)
                break;
        }
        if (!ctx)
            throw new AegisError('WebGL is not supported in this environment.');
        this.gl = ctx;
    }
    /**
     * Compiles a WebGL Shader
     */
    compileShader(source, type) {
        const shader = this.gl.createShader(type);
        if (!shader)
            throw new AegisError('Failed to create WebGL shader.');
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const info = this.gl.getShaderInfoLog(shader);
            this.gl.deleteShader(shader);
            throw new AegisError(`WebGL Shader Compilation Error:\n${info}`);
        }
        return shader;
    }
    /**
     * Loads and compiles a Fragment Shader string into the GPU pipeline.
     */
    loadFragmentShader(fragmentSource) {
        const vertexSource = `
            attribute vec2 a_position;
            varying vec2 v_uv;
            void main() {
                v_uv = a_position * 0.5 + 0.5;
                v_uv.y = 1.0 - v_uv.y; // Flip Y for WebGL
                gl_Position = vec4(a_position, 0.0, 1.0);
            }
        `;
        const vShader = this.compileShader(vertexSource, this.gl.VERTEX_SHADER);
        const fShader = this.compileShader(fragmentSource, this.gl.FRAGMENT_SHADER);
        const program = this.gl.createProgram();
        if (!program)
            throw new AegisError('Failed to create WebGL program.');
        this.gl.attachShader(program, vShader);
        this.gl.attachShader(program, fShader);
        this.gl.linkProgram(program);
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            const info = this.gl.getProgramInfoLog(program);
            throw new AegisError(`WebGL Program Link Error:\n${info}`);
        }
        this.program = program;
        this.gl.useProgram(this.program);
        // Setup the full-screen quad geometry
        const positionBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
        const positions = new Float32Array([
            -1.0, -1.0,
            1.0, -1.0,
            -1.0, 1.0,
            -1.0, 1.0,
            1.0, -1.0,
            1.0, 1.0,
        ]);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);
        const positionLocation = this.gl.getAttribLocation(this.program, "a_position");
        this.gl.enableVertexAttribArray(positionLocation);
        this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 0, 0);
        return this;
    }
    /**
     * Set a uniform float value in the shader
     */
    setUniform1f(name, value) {
        if (!this.program)
            throw new AegisError('No WebGL program loaded.');
        if (!this.uniformLocs.has(name)) {
            const loc = this.gl.getUniformLocation(this.program, name);
            if (loc)
                this.uniformLocs.set(name, loc);
            else
                return this;
        }
        this.gl.uniform1f(this.uniformLocs.get(name), value);
        return this;
    }
    /**
     * Binds an external image/canvas as a WebGL Texture on the given uniform unit.
     */
    bindTexture(name, source, unit = 0) {
        if (!this.program)
            throw new AegisError('No WebGL program loaded.');
        let tex = this.textures.get(name);
        if (!tex) {
            const newTex = this.gl.createTexture();
            if (!newTex)
                throw new AegisError('Failed to create WebGL texture.');
            tex = newTex;
            this.textures.set(name, tex);
        }
        this.gl.activeTexture(this.gl.TEXTURE0 + unit);
        this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        // Upload pixels
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, source);
        if (!this.uniformLocs.has(name)) {
            const loc = this.gl.getUniformLocation(this.program, name);
            if (loc)
                this.uniformLocs.set(name, loc);
        }
        const locMap = this.uniformLocs.get(name);
        if (locMap)
            this.gl.uniform1i(locMap, unit);
        return this;
    }
    /**
     * Executes the WebGL draw call and renders output to the canvas
     */
    render() {
        if (!this.program)
            throw new AegisError('No WebGL program loaded.');
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
        return this;
    }
    /**
     * Retrieves the rendered output as an ImageBitmap (requires async)
     * Extremely fast zero-copy memory transfer natively supported by browser.
     */
    async extract() {
        this.render();
        if (typeof createImageBitmap !== 'undefined') {
            return await createImageBitmap(this.canvas);
        }
        throw new AegisError('createImageBitmap not supported in this environment.');
    }
}
/**
 * Keyframe Interpolation Engine
 * Calculates properties based on timeline position for seamless animations (opacity, PIP position).
 */
export class KeyframeEngine {
    keys;
    constructor(keyframes) {
        this.keys = keyframes.sort((a, b) => a.t - b.t);
    }
    get(timeSec) {
        if (this.keys.length === 0)
            return 0;
        if (timeSec <= this.keys[0].t)
            return this.keys[0].v;
        if (timeSec >= this.keys[this.keys.length - 1].t)
            return this.keys[this.keys.length - 1].v;
        for (let i = 0; i < this.keys.length - 1; i++) {
            const k1 = this.keys[i];
            const k2 = this.keys[i + 1];
            if (timeSec >= k1.t && timeSec <= k2.t) {
                const progress = (timeSec - k1.t) / (k2.t - k1.t);
                return k1.v + (k2.v - k1.v) * progress; // Linear
            }
        }
        return 0;
    }
}
/**
 * CompositeGL (Multi-Layer Engine)
 * Automatically compiles a PIP and translucency shader for overlapping video arrays.
 */
export class CompositeGL extends GL {
    constructor(width, height) {
        super(width, height);
        const compositeShader = `
            precision highp float;
            varying vec2 v_uv;
            uniform sampler2D u_base;
            uniform sampler2D u_overlay;
            uniform float u_overlay_alpha;
            uniform vec4 u_pip_rect; // x, y, w, h in normalized coords (0.0 -> 1.0)
            
            void main() {
                vec4 baseColor = texture2D(u_base, v_uv);
                
                // Check if fragment is within PIP rect
                if (v_uv.x >= u_pip_rect.x && v_uv.x <= u_pip_rect.x + u_pip_rect.z &&
                    v_uv.y >= u_pip_rect.y && v_uv.y <= u_pip_rect.y + u_pip_rect.w) {
                    
                    vec2 pipUV = vec2(
                        (v_uv.x - u_pip_rect.x) / u_pip_rect.z,
                        (v_uv.y - u_pip_rect.y) / u_pip_rect.w
                    );
                    vec4 overColor = texture2D(u_overlay, pipUV);
                    gl_FragColor = mix(baseColor, overColor, u_overlay_alpha * overColor.a);
                } else {
                    gl_FragColor = baseColor;
                }
            }
        `;
        this.loadFragmentShader(compositeShader);
    }
    drawPIP(base, overlay, alpha, rect) {
        this.bindTexture("u_base", base, 0);
        this.bindTexture("u_overlay", overlay, 1);
        this.setUniform1f("u_overlay_alpha", alpha);
        // Custom 4f uniform bind
        const loc = this.gl.getUniformLocation(this.program, "u_pip_rect");
        this.gl.uniform4f(loc, rect[0], rect[1], rect[2], rect[3]);
        return this.render();
    }
}
/**
 * WebGPUEngine
 * Experimental Compute Shader dispatcher for bleeding-edge heavy pixel workloads (AI filters, complex chroma key)
 */
export class WebGPUEngine {
    device;
    pipeline;
    async init(computeShaderWGSL) {
        if (!navigator.gpu)
            throw new AegisError('WebGPU is not supported in this browser.');
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter)
            throw new AegisError('No suitable WebGPU adapter found.');
        this.device = await adapter.requestDevice();
        const module = this.device.createShaderModule({ code: computeShaderWGSL });
        this.pipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module, entryPoint: 'main' }
        });
    }
    async compute(width, height) {
        // High level compute pipeline invocation scaffolding
        // The exact buffer binding logic depends heavily on the injected shader interfaces
        if (!this.device || !this.pipeline)
            throw new AegisError("WebGPU not initialized");
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.pipeline);
        passEncoder.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
