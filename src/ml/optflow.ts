import { log, AegisError } from '../core';

const WGSL_OPTICAL_FLOW = `
@group(0) @binding(0) var frame0 : texture_2d<f32>;
@group(0) @binding(1) var frame1 : texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> flow : array<vec2<f32>>;
@group(0) @binding(3) var<uniform> params : Params;

struct Params {
    width  : u32,
    height : u32,
    winSize: u32,
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    let W = i32(params.width);
    let H = i32(params.height);
    if (x >= W || y >= H) { return; }

    let win = i32(params.winSize);
    var sxx = 0.0; var sxy = 0.0; var syy = 0.0;
    var sxt = 0.0; var syt = 0.0;

    for (var dy = -win; dy <= win; dy++) {
        for (var dx = -win; dx <= win; dx++) {
            let nx = clamp(x + dx, 0, W - 1);
            let ny = clamp(y + dy, 0, H - 1);
            let nx1 = clamp(nx + 1, 0, W - 1);
            let ny1 = clamp(ny + 1, 0, H - 1);

            let p  = textureLoad(frame0, vec2<i32>(nx,  ny),  0).r;
            let pr = textureLoad(frame0, vec2<i32>(nx1, ny),  0).r;
            let pd = textureLoad(frame0, vec2<i32>(nx,  ny1), 0).r;
            let q  = textureLoad(frame1, vec2<i32>(nx,  ny),  0).r;

            let Ix = pr - p;
            let Iy = pd - p;
            let It = q  - p;

            sxx += Ix * Ix; sxy += Ix * Iy;
            syy += Iy * Iy; sxt += Ix * It;
            syt += Iy * It;
        }
    }

    let det = sxx * syy - sxy * sxy;
    var u = 0.0; var v = 0.0;
    if (abs(det) > 1e-6) {
        u = (-syy * sxt + sxy * syt) / det;
        v = ( sxy * sxt - sxx * syt) / det;
    }

    flow[u32(y * W + x)] = vec2<f32>(u, v);
}
`;

const WGSL_WARP = `
@group(0) @binding(0) var src   : texture_2d<f32>;
@group(0) @binding(1) var<storage, read> flow : array<vec2<f32>>;
@group(0) @binding(2) var dst   : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params : WarpParams;
struct WarpParams { width : u32, height : u32, scale : f32, _pad : f32 }

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    let W = i32(params.width);
    let H = i32(params.height);
    if (x >= W || y >= H) { return; }

    let mv  = flow[u32(y * W + x)] * params.scale;
    let srcX = f32(x) + mv.x;
    let srcY = f32(y) + mv.y;

    let x0 = clamp(i32(floor(srcX)), 0, W-1);
    let y0 = clamp(i32(floor(srcY)), 0, H-1);
    let x1 = clamp(x0 + 1, 0, W-1);
    let y1 = clamp(y0 + 1, 0, H-1);
    let fx = srcX - floor(srcX);
    let fy = srcY - floor(srcY);

    let c00 = textureLoad(src, vec2<i32>(x0, y0), 0);
    let c10 = textureLoad(src, vec2<i32>(x1, y0), 0);
    let c01 = textureLoad(src, vec2<i32>(x0, y1), 0);
    let c11 = textureLoad(src, vec2<i32>(x1, y1), 0);
    let col = mix(mix(c00, c10, fx), mix(c01, c11, fx), fy);

    textureStore(dst, vec2<i32>(x, y), col);
}
`;

export class OpticalFlowEngine {
    private device: GPUDevice | null = null;
    private flowPipeline: GPUComputePipeline | null = null;
    private warpPipeline: GPUComputePipeline | null = null;
    private w = 0; private h = 0;
    private flowBuf: GPUBuffer | null = null;
    private paramBuf: GPUBuffer | null = null;

    public get available(): boolean { return !!navigator.gpu; }

    public async init(width: number, height: number): Promise<boolean> {
        const gpu = navigator.gpu;
        if (!gpu) { log.warn('[OptFlow] WebGPU unavailable'); return false; }
        const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) { log.warn('[OptFlow] No adapter'); return false; }
        this.device = await adapter.requestDevice();
        this.w = width; this.h = height;

        this.flowBuf = this.device.createBuffer({
            size: width * height * 8,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        this.paramBuf = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        const flowMod = this.device.createShaderModule({ code: WGSL_OPTICAL_FLOW, label: 'OptFlow' });
        const warpMod = this.device.createShaderModule({ code: WGSL_WARP, label: 'Warp' });

        this.flowPipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: flowMod, entryPoint: 'main' }
        });
        this.warpPipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: warpMod, entryPoint: 'main' }
        });

        return true;
    }

    public async computeFlow(
        frame0: ImageBitmap,
        frame1: ImageBitmap,
        winSize: number = 4
    ): Promise<Float32Array> {
        if (!this.device || !this.flowPipeline) throw new AegisError('OptFlow not initialized');
        const dev = this.device;
        const W = this.w, H = this.h;

        const mkTex = (img: ImageBitmap): GPUTexture => {
            const tex = dev.createTexture({
                size: [W, H],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
            });
            dev.queue.copyExternalImageToTexture({ source: img }, { texture: tex }, [W, H]);
            return tex;
        };

        const tex0 = mkTex(frame0), tex1 = mkTex(frame1);

        dev.queue.writeBuffer(this.paramBuf!, 0, new Uint32Array([W, H, winSize, 0]));

        const bg = dev.createBindGroup({
            layout: this.flowPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: tex0.createView() },
                { binding: 1, resource: tex1.createView() },
                { binding: 2, resource: { buffer: this.flowBuf! } },
                { binding: 3, resource: { buffer: this.paramBuf! } }
            ]
        });

        const enc = dev.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(this.flowPipeline);
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
        pass.end();

        const readBuf = dev.createBuffer({
            size: W * H * 8,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        enc.copyBufferToBuffer(this.flowBuf!, 0, readBuf, 0, W * H * 8);
        dev.queue.submit([enc.finish()]);
        await dev.queue.onSubmittedWorkDone();

        await readBuf.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(readBuf.getMappedRange().slice(0));
        readBuf.unmap();
        readBuf.destroy();
        tex0.destroy(); tex1.destroy();
        return result;
    }

    public async interpolate(
        frame0: ImageBitmap,
        frame1: ImageBitmap,
        t: number = 0.5
    ): Promise<ImageBitmap> {
        if (!this.device || !this.warpPipeline || !this.flowPipeline) {
            return this._cpuBlend(frame0, frame1, t);
        }
        const dev = this.device;
        const W = this.w, H = this.h;

        const flow01 = await this.computeFlow(frame0, frame1);
        const flow10 = await this.computeFlow(frame1, frame0);

        const warpFrame = async (
            src: ImageBitmap, flow: Float32Array, scale: number
        ): Promise<ImageBitmap> => {
            const srcTex = dev.createTexture({
                size: [W, H], format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
            });
            dev.queue.copyExternalImageToTexture({ source: src }, { texture: srcTex }, [W, H]);

            const flowBuf = dev.createBuffer({
                size: flow.byteLength,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            });
            dev.queue.writeBuffer(flowBuf, 0, flow.buffer);

            const dstTex = dev.createTexture({
                size: [W, H], format: 'rgba8unorm',
                usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC
            });

            const warpParams = dev.createBuffer({
                size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
            const paramData = new ArrayBuffer(16);
            new Uint32Array(paramData, 0, 2).set([W, H]);
            new Float32Array(paramData, 8, 2).set([scale, 0]);
            dev.queue.writeBuffer(warpParams, 0, new Uint8Array(paramData));

            const bg = dev.createBindGroup({
                layout: this.warpPipeline!.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: srcTex.createView() },
                    { binding: 1, resource: { buffer: flowBuf } },
                    { binding: 2, resource: dstTex.createView() },
                    { binding: 3, resource: { buffer: warpParams } }
                ]
            });

            const enc = dev.createCommandEncoder();
            const pass = enc.beginComputePass();
            pass.setPipeline(this.warpPipeline!);
            pass.setBindGroup(0, bg);
            pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
            pass.end();

            const readBuf = dev.createBuffer({
                size: W * H * 4,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
            });
            enc.copyTextureToBuffer(
                { texture: dstTex },
                { buffer: readBuf, bytesPerRow: W * 4 },
                [W, H]
            );
            dev.queue.submit([enc.finish()]);
            await dev.queue.onSubmittedWorkDone();

            await readBuf.mapAsync(GPUMapMode.READ);
            const pixels = new Uint8ClampedArray(readBuf.getMappedRange().slice(0));
            readBuf.unmap();

            const outCanvas = new OffscreenCanvas(W, H);
            const ctx = outCanvas.getContext('2d')!;
            ctx.putImageData(new ImageData(pixels, W, H), 0, 0);

            srcTex.destroy(); dstTex.destroy();
            flowBuf.destroy(); warpParams.destroy(); readBuf.destroy();

            return createImageBitmap(outCanvas);
        };

        const warped0 = await warpFrame(frame0, flow01, t);
        const warped1 = await warpFrame(frame1, flow10, 1 - t);

        const outCanvas = new OffscreenCanvas(W, H);
        const ctx = outCanvas.getContext('2d')!;
        ctx.globalAlpha = 1 - t;
        ctx.drawImage(warped0, 0, 0);
        ctx.globalAlpha = t;
        ctx.drawImage(warped1, 0, 0);
        warped0.close(); warped1.close();

        return createImageBitmap(outCanvas);
    }

    private async _cpuBlend(f0: ImageBitmap, f1: ImageBitmap, t: number): Promise<ImageBitmap> {
        const c = new OffscreenCanvas(this.w || f0.width, this.h || f0.height);
        const ctx = c.getContext('2d')!;
        ctx.globalAlpha = 1 - t;
        ctx.drawImage(f0, 0, 0);
        ctx.globalAlpha = t;
        ctx.drawImage(f1, 0, 0);
        return createImageBitmap(c);
    }
}
