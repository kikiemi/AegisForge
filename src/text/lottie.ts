import { log, AegisError } from '../core';

interface LottieKeyframe {
    t: number;
    s?: number | number[];
    e?: number | number[];
    [k: string]: unknown;
}


type LottieEvalResult = any;

interface LottieValue {
    a: number;
    k: number | number[] | LottieKeyframe[];
}

interface LottieTransform {
    p?: LottieValue;
    a?: LottieValue;
    s?: LottieValue;
    r?: LottieValue;
    o?: LottieValue;
}

interface LottieFill { ty: 'fl'; c: LottieValue; o: LottieValue; }
interface LottieStroke { ty: 'st'; c: LottieValue; o: LottieValue; w: LottieValue; }
interface LottieRect { ty: 'rc'; p: LottieValue; s: LottieValue; r: LottieValue; }
interface LottieEllipse { ty: 'el'; p: LottieValue; s: LottieValue; }
interface LottiePath { ty: 'sh'; ks: LottieValue; }
interface LottieGroup { ty: 'gr'; it: LottieShape[]; nm?: string; ks?: LottieTransform; }
type LottieShape = LottieFill | LottieStroke | LottieRect | LottieEllipse | LottiePath | LottieGroup;

interface LottieLayer {
    ty: number;
    nm?: string;
    ks?: LottieTransform;
    shapes?: LottieShape[];
    sc?: string;
    sw?: number; sh?: number;
    ip?: number; op?: number;
    ind?: number;
}

export interface LottieAnimation {
    v: string;
    ip: number; op: number;
    fr: number;
    w: number; h: number;
    layers: LottieLayer[];
}

function evalValue(val: LottieValue, frame: number): LottieEvalResult {
    if (!val) return 0;
    if (!val.a) return val.k;

    const keys = val.k as LottieKeyframe[];
    if (!Array.isArray(keys) || keys.length === 0) return 0;
    if (frame <= keys[0].t) return keys[0].s ?? keys[0];
    if (frame >= keys[keys.length - 1].t) {
        const last = keys[keys.length - 1];
        return last.e ?? last.s ?? last;
    }
    for (let i = 0; i < keys.length - 1; i++) {
        const k1 = keys[i], k2 = keys[i + 1];
        if (frame >= k1.t && frame < k2.t) {
            const t = (frame - k1.t) / (k2.t - k1.t);
            const s: any = k1.s ?? k1, e: any = k1.e ?? (k2.s ?? k2);
            if (Array.isArray(s)) return s.map((v: number, j: number) => v + (e[j] - v) * t);
            return s + (e - s) * t;
        }
    }
    return 0;
}

function evalColor(val: LottieValue, frame: number): [number, number, number, number] {
    const c = evalValue(val, frame);
    if (Array.isArray(c)) return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 1];
    return [0, 0, 0, 1];
}

function toRGB(arr: number[]): string {
    return `rgba(${Math.round(arr[0] * 255)},${Math.round(arr[1] * 255)},${Math.round(arr[2] * 255)},${arr[3] ?? 1})`;
}

function applyTransform(
    ctx: OffscreenCanvasRenderingContext2D,
    ks: LottieTransform | undefined,
    frame: number,
    w: number, h: number
): void {
    if (!ks) return;
    const pos = evalValue(ks.p!, frame) ?? [0, 0];
    const anc = evalValue(ks.a!, frame) ?? [0, 0];
    const scl = evalValue(ks.s!, frame) ?? [100, 100];
    const rot = evalValue(ks.r!, frame) ?? 0;
    ctx.translate(pos[0] ?? 0, pos[1] ?? 0);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.scale((scl[0] ?? 100) / 100, (scl[1] ?? 100) / 100);
    ctx.translate(-(anc[0] ?? 0), -(anc[1] ?? 0));
}

function drawShape(
    ctx: OffscreenCanvasRenderingContext2D,
    shape: LottieShape,
    frame: number,
    fills: LottieFill[],
    strokes: LottieStroke[]
): void {
    if (shape.ty === 'gr') {

        const grp = shape as LottieGroup;
        const gFills = grp.it.filter((s): s is LottieFill => s.ty === 'fl');
        const gStrokes = grp.it.filter((s): s is LottieStroke => s.ty === 'st');
        ctx.save();
        applyTransform(ctx, grp.ks, frame, 0, 0);
        for (const item of grp.it) {
            if (item.ty !== 'fl' && item.ty !== 'st') {
                drawShape(ctx, item, frame, gFills, gStrokes);
            }
        }
        ctx.restore();
    } else if (shape.ty === 'rc') {
        const rc = shape as LottieRect;
        const pos = evalValue(rc.p, frame) ?? [0, 0];
        const sz = evalValue(rc.s, frame) ?? [50, 50];
        const r = evalValue(rc.r, frame) ?? 0;
        ctx.beginPath();
        ctx.roundRect(pos[0] - sz[0] / 2, pos[1] - sz[1] / 2, sz[0], sz[1], r);
        _applyFillStroke(ctx, frame, fills, strokes);
    } else if (shape.ty === 'el') {
        const el = shape as LottieEllipse;
        const pos = evalValue(el.p, frame) ?? [0, 0];
        const sz = evalValue(el.s, frame) ?? [50, 50];
        ctx.beginPath();
        ctx.ellipse(pos[0], pos[1], sz[0] / 2, sz[1] / 2, 0, 0, Math.PI * 2);
        _applyFillStroke(ctx, frame, fills, strokes);
    } else if (shape.ty === 'sh') {
        const sh = shape as LottiePath;
        const ks = evalValue(sh.ks, frame);
        if (ks && ks.v) {
            const p2d = new Path2D();
            const verts = ks.v, tin = ks.i, tout = ks.o;
            if (verts.length > 0) {
                p2d.moveTo(verts[0][0], verts[0][1]);
                for (let i = 0; i < verts.length; i++) {
                    const ni = (i + 1) % verts.length;
                    const cp1 = [verts[i][0] + tout[i][0], verts[i][1] + tout[i][1]];
                    const cp2 = [verts[ni][0] + tin[ni][0], verts[ni][1] + tin[ni][1]];
                    p2d.bezierCurveTo(cp1[0], cp1[1], cp2[0], cp2[1], verts[ni][0], verts[ni][1]);
                }
                if (ks.c) p2d.closePath();
            }
            ctx.stroke(p2d);
            _applyFillStroke(ctx, frame, fills, strokes, p2d);
        }
    }
}

function _applyFillStroke(
    ctx: OffscreenCanvasRenderingContext2D,
    frame: number,
    fills: LottieFill[],
    strokes: LottieStroke[],
    path?: Path2D
): void {
    for (const fill of fills) {
        const c = evalColor(fill.c, frame);
        const op = (evalValue(fill.o, frame) ?? 100) / 100;
        ctx.globalAlpha = op;
        ctx.fillStyle = toRGB(c);
        path ? ctx.fill(path) : ctx.fill();
    }
    for (const stroke of strokes) {
        const c = evalColor(stroke.c, frame);
        const op = (evalValue(stroke.o, frame) ?? 100) / 100;
        const w = evalValue(stroke.w, frame) ?? 1;
        ctx.globalAlpha = op;
        ctx.strokeStyle = toRGB(c);
        ctx.lineWidth = w;
        path ? ctx.stroke(path) : ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

export class LottieDecoder {
    public anim: LottieAnimation;

    constructor(json: LottieAnimation | string) {
        this.anim = typeof json === 'string' ? JSON.parse(json) : json;
    }

    public get duration(): number {
        return (this.anim.op - this.anim.ip) / this.anim.fr * 1000;
    }

    public get framerate(): number { return this.anim.fr; }

    public async renderAt(timeMs: number): Promise<ImageBitmap> {
        const frame = this.anim.ip + (timeMs / 1000) * this.anim.fr;
        return this.renderFrame(frame);
    }

    public async renderFrame(frame: number): Promise<ImageBitmap> {
        const { w, h, layers } = this.anim;
        const cv = new OffscreenCanvas(w, h);
        const ctx = cv.getContext('2d')!;

        const sorted = [...layers].reverse();

        for (const layer of sorted) {
            const ip = layer.ip ?? 0, op = layer.op ?? this.anim.op;
            if (frame < ip || frame >= op) continue;

            ctx.save();
            applyTransform(ctx, layer.ks, frame, w, h);

            const opacity = evalValue(layer.ks?.o ?? { a: 0, k: 100 }, frame) / 100;
            ctx.globalAlpha = opacity;

            if (layer.ty === 1) {

                ctx.fillStyle = layer.sc ?? '#000000';
                ctx.fillRect(0, 0, layer.sw ?? w, layer.sh ?? h);
            } else if (layer.ty === 4 && layer.shapes) {

                const fills = layer.shapes.filter((s): s is LottieFill => s.ty === 'fl');
                const strokes = layer.shapes.filter((s): s is LottieStroke => s.ty === 'st');
                for (const shape of layer.shapes) {
                    if (shape.ty === 'fl' || shape.ty === 'st') continue;
                    drawShape(ctx, shape, frame, fills, strokes);
                }
            }
            ctx.restore();
        }

        return createImageBitmap(cv);
    }
}
