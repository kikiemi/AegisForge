import { log } from '../core';
import { OpticalFlowEngine } from './optflow';
import { GL } from '../gl';

class Kalman1D {
    private Q: number;
    private R: number;
    private P: number = 1;
    private K: number = 0;
    private x: number = 0;

    constructor(Q: number = 1e-5, R: number = 1e-2) {
        this.Q = Q; this.R = R;
    }

    public correct(measurement: number): number {
        this.P += this.Q;
        this.K = this.P / (this.P + this.R);
        this.x += this.K * (measurement - this.x);
        this.P = (1 - this.K) * this.P;
        return this.x;
    }
}

const STABILIZE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform vec2 u_offset;
uniform float u_scale;
void main(){
    vec2 uv = (v_uv - 0.5) * u_scale + 0.5 + u_offset;
    if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){ o=vec4(0,0,0,1); return; }
    o = texture(u_image, uv);
}`;

export interface StabilizerOptions {
    smoothing?: number;
    cropRatio?: number;
}

function cpuLucasKanade(
    prev: Uint8ClampedArray, curr: Uint8ClampedArray,
    W: number, H: number, winSize: number = 4
): { dx: number; dy: number } {
    const gray = (d: Uint8ClampedArray, i: number) => (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);

    const x0 = Math.floor(W * 0.3), x1 = Math.ceil(W * 0.7);
    const y0 = Math.floor(H * 0.3), y1 = Math.ceil(H * 0.7);
    const step = 2;

    let sumU = 0, sumV = 0, cnt = 0;

    for (let y = y0; y < y1; y += step) {
        for (let x = x0; x < x1; x += step) {
            let sxx = 0, sxy = 0, syy = 0, sxt = 0, syt = 0;

            for (let dy = -winSize; dy <= winSize; dy++) {
                for (let dx = -winSize; dx <= winSize; dx++) {
                    const nx = Math.min(Math.max(x + dx, 0), W - 1);
                    const ny = Math.min(Math.max(y + dy, 0), H - 1);
                    const nx1 = Math.min(nx + 1, W - 1);
                    const ny1 = Math.min(ny + 1, H - 1);

                    const pi = (ny * W + nx) * 4;
                    const pri = (ny * W + nx1) * 4;
                    const pdi = (ny1 * W + nx) * 4;
                    const qi = (ny * W + nx) * 4;

                    const p = gray(prev, pi);
                    const Ix = gray(prev, pri) - p;
                    const Iy = gray(prev, pdi) - p;
                    const It = gray(curr, qi) - p;

                    sxx += Ix * Ix; sxy += Ix * Iy; syy += Iy * Iy;
                    sxt += Ix * It; syt += Iy * It;
                }
            }

            const det = sxx * syy - sxy * sxy;
            if (Math.abs(det) > 1e-4) {
                const u = (-syy * sxt + sxy * syt) / det;
                const v = (sxy * sxt - sxx * syt) / det;
                if (Math.abs(u) < 50 && Math.abs(v) < 50) {
                    sumU += u; sumV += v; cnt++;
                }
            }
        }
    }

    return cnt > 0 ? { dx: sumU / cnt, dy: sumV / cnt } : { dx: 0, dy: 0 };
}

export class VideoStabilizer {
    private optFlow: OpticalFlowEngine;
    private gl: GL;
    private kalmanX = new Kalman1D();
    private kalmanY = new Kalman1D();
    private w: number; private h: number;
    private ready = false;
    private gpuReady = false;

    constructor(width: number, height: number) {
        this.w = width; this.h = height;
        this.optFlow = new OpticalFlowEngine();
        this.gl = new GL(width, height);
        this.gl.loadFragmentShader(STABILIZE_FRAG);
        this.ready = true;
    }

    public async init(): Promise<void> {
        this.gpuReady = await this.optFlow.init(this.w, this.h);
        if (!this.gpuReady) log.warn('[Stabilizer] WebGPU unavailable — using CPU Lucas-Kanade fallback');
        else log.info('[Stabilizer] GPU optical flow active');
    }

    private _getPixels(frame: ImageBitmap): Uint8ClampedArray {
        const c = new OffscreenCanvas(this.w, this.h);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(frame, 0, 0, this.w, this.h);
        return ctx.getImageData(0, 0, this.w, this.h).data;
    }

    public async analyzeFrames(
        frames: ImageBitmap[],
        opts: StabilizerOptions = {}
    ): Promise<{ dx: number; dy: number }[]> {
        if (!this.ready || frames.length < 2) {
            return frames.map(() => ({ dx: 0, dy: 0 }));
        }

        const W = this.w, H = this.h;
        const rawX: number[] = [0], rawY: number[] = [0];

        if (this.gpuReady) {
            for (let i = 1; i < frames.length; i++) {
                const flow = await this.optFlow.computeFlow(frames[i - 1], frames[i]);
                let sumX = 0, sumY = 0, cnt = 0;
                const x0 = Math.floor(W * 0.375), x1 = Math.ceil(W * 0.625);
                const y0 = Math.floor(H * 0.375), y1 = Math.ceil(H * 0.625);
                for (let y = y0; y < y1; y++) {
                    for (let x = x0; x < x1; x++) {
                        const idx = (y * W + x) * 2;
                        sumX += flow[idx]; sumY += flow[idx + 1]; cnt++;
                    }
                }
                rawX.push(rawX[i - 1] + sumX / cnt);
                rawY.push(rawY[i - 1] + sumY / cnt);
            }
        } else {
            let prevPixels = this._getPixels(frames[0]);
            for (let i = 1; i < frames.length; i++) {
                const currPixels = this._getPixels(frames[i]);
                const motion = cpuLucasKanade(prevPixels, currPixels, W, H);
                rawX.push(rawX[i - 1] + motion.dx);
                rawY.push(rawY[i - 1] + motion.dy);
                prevPixels = currPixels;
            }
        }

        const kx = new Kalman1D(opts.smoothing ? 1e-5 / opts.smoothing : 1e-5, 1e-2);
        const ky = new Kalman1D(opts.smoothing ? 1e-5 / opts.smoothing : 1e-5, 1e-2);
        const smoothX = rawX.map(v => kx.correct(v));
        const smoothY = rawY.map(v => ky.correct(v));

        return rawX.map((_, i) => ({
            dx: (smoothX[i] - rawX[i]) / W,
            dy: (smoothY[i] - rawY[i]) / H
        }));
    }

    public async apply(
        frame: ImageBitmap,
        correction: { dx: number; dy: number },
        cropRatio: number = 1.05
    ): Promise<ImageBitmap> {
        this.gl
            .bindTexture('u_image', frame, 0)
            .setUniform2f('u_offset', correction.dx, correction.dy)
            .setUniform1f('u_scale', cropRatio)
            .render();
        return this.gl.extract();
    }
}
