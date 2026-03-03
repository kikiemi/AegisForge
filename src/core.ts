export class AegisError extends Error {
    public readonly e: unknown;
    constructor(m: string, e: unknown = null) {
        super(e ? `${m} | Cause: ${(e as Error).message || e}` : m);
        this.name = 'AegisError';
        this.e = e;
    }
}

export class Logger {
    private p: string;
    constructor() { this.p = '[AF]'; }
    public info(...a: unknown[]): void { console.info(this.p, ...a); }
    public warn(...a: unknown[]): void { console.warn(this.p, ...a); }
    public error(m: string, e?: unknown): void { console.error(this.p, m, e || ''); }
    public assert(c: boolean, m: string): void {
        if (!c) { const e = new AegisError(m); this.error(e.message); throw e; }
    }
}
export const log = new Logger();

interface Closeable { close(): void }

export class ResourceManager {
    private t: Set<Closeable>;
    constructor() { this.t = new Set(); }
    public track<T>(r: T): T { if (r && typeof (r as unknown as Closeable).close === 'function') this.t.add(r as unknown as Closeable); return r; }
    public untrack(r: Closeable): void { this.t.delete(r); }
    public closeAll(): void {
        for (const r of this.t) { try { r.close(); } catch (e) { log.error('ResourceManager:err', e as Error); } }
        this.t.clear();
    }
}

export class SlabAllocator<T extends { reset(): void }> {
    private pool: T[] = [];
    private factory: () => T;
    constructor(factory: () => T, prewarm: number = 0) {
        this.factory = factory;
        for (let i = 0; i < prewarm; i++) this.pool.push(factory());
    }
    public acquire(): T {
        return this.pool.length > 0 ? this.pool.pop()! : this.factory();
    }
    public release(obj: T): void {
        obj.reset();
        this.pool.push(obj);
    }
    public get size(): number { return this.pool.length; }
}

export class RationalTimecode {
    private num: bigint;
    private den: bigint;
    private fpsNum: bigint;
    private fpsDen: bigint;

    constructor(fps: number) {
        let n = Math.round(fps * 1000);
        let d = 1000;
        if (Math.abs(fps - 29.97) < 0.01) { n = 30000; d = 1001; }
        else if (Math.abs(fps - 23.976) < 0.01) { n = 24000; d = 1001; }
        else if (Math.abs(fps - 59.94) < 0.01) { n = 60000; d = 1001; }
        this.fpsNum = BigInt(n);
        this.fpsDen = BigInt(d);
        this.num = 0n;
        this.den = 1n;
    }

    public fromFrame(frameIdx: number): this {
        this.num = BigInt(frameIdx) * this.fpsDen;
        this.den = this.fpsNum;
        return this;
    }

    public fromSeconds(sec: number): this {
        const secNum = BigInt(Math.round(sec * 1_000_000));
        this.num = secNum * this.fpsNum;
        this.den = this.fpsDen * 1_000_000n;
        return this;
    }

    public toMicros(): bigint {
        return (this.num * 1_000_000n) / (this.den === 0n ? 1n : this.den);
    }

    public toSeconds(): number {
        return Number(this.num) / Number(this.den);
    }

    public advanceFrame(n: number = 1): bigint {
        this.num += BigInt(n) * this.fpsDen;
        this.den = this.fpsNum;
        return this.toMicros();
    }

    public clone(): RationalTimecode {
        const c = Object.create(RationalTimecode.prototype) as RationalTimecode;
        Object.assign(c, { fpsNum: this.fpsNum, fpsDen: this.fpsDen, num: this.num, den: this.den });
        return c;
    }
}

export class TimestampSync {
    public vNum: bigint; public vDen: bigint;
    public a: bigint; public vf: bigint; public af: bigint;

    constructor(vFPS: number, aRate: number) {
        log.assert(vFPS > 0, 'vFPS>0');
        log.assert(aRate > 0, 'aRate>0');
        let fpsNum = Math.round(vFPS * 1000), fpsDen = 1000;
        if (Math.abs(vFPS - 29.97) < 0.01) { fpsNum = 30000; fpsDen = 1001; }
        else if (Math.abs(vFPS - 23.976) < 0.01) { fpsNum = 24000; fpsDen = 1001; }
        else if (Math.abs(vFPS - 59.94) < 0.01) { fpsNum = 60000; fpsDen = 1001; }
        this.vNum = BigInt(fpsNum); this.vDen = BigInt(fpsDen);
        this.a = BigInt(Math.round(aRate)); this.vf = 0n; this.af = 0n;
    }
    public nextVideoPts(): number { const p = (this.vf * 1_000_000n * this.vDen) / this.vNum; this.vf++; return Number(p); }
    public nextAudioPts(samples: number): number { const p = (this.af * 1_000_000n) / this.a; this.af += BigInt(samples); return Number(p); }
    public peekAudioPts(): number { return Number((this.af * 1_000_000n) / this.a); }
}

export interface BezierKey {
    t: number;
    v: number;
    cp?: [number, number, number, number];
}

export class BezierKeyframeEngine {
    public keys: BezierKey[];
    constructor(keyframes: BezierKey[]) {
        this.keys = keyframes.slice().sort((a, b) => a.t - b.t);
    }

    public get(timeSec: number): number {
        const keys = this.keys;
        if (keys.length === 0) return 0;
        if (timeSec <= keys[0].t) return keys[0].v;
        if (timeSec >= keys[keys.length - 1].t) return keys[keys.length - 1].v;

        for (let i = 0; i < keys.length - 1; i++) {
            const k1 = keys[i], k2 = keys[i + 1];
            if (timeSec >= k1.t && timeSec <= k2.t) {
                const tNorm = (timeSec - k1.t) / (k2.t - k1.t);
                const cp = k1.cp || [0, 0, 1, 1];
                const u = BezierKeyframeEngine._solveT(tNorm, cp[0], cp[2]);
                const vNorm = BezierKeyframeEngine._bezier1D(u, 0, cp[1], cp[3], 1);
                return k1.v + (k2.v - k1.v) * vNorm;
            }
        }
        return 0;
    }

    private static _solveT(tx: number, p1x: number, p2x: number): number {
        let u = tx;
        for (let i = 0; i < 8; i++) {
            const x = BezierKeyframeEngine._bezier1D(u, 0, p1x, p2x, 1) - tx;
            const dx = BezierKeyframeEngine._bezierDeriv(u, 0, p1x, p2x, 1);
            if (Math.abs(dx) < 1e-12) break;
            u -= x / dx;
            u = u < 0 ? 0 : u > 1 ? 1 : u;
        }
        return u;
    }

    private static _bezier1D(t: number, p0: number, p1: number, p2: number, p3: number): number {
        const mt = 1 - t;
        return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
    }

    private static _bezierDeriv(t: number, p0: number, p1: number, p2: number, p3: number): number {
        const mt = 1 - t;
        return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2);
    }
}

export class KeyframeEngine {
    public keys: { t: number; v: number }[];
    constructor(keyframes: { t: number; v: number }[]) {
        this.keys = keyframes.slice().sort((a, b) => a.t - b.t);
    }
    public get(timeSec: number): number {
        if (this.keys.length === 0) return 0;
        if (timeSec <= this.keys[0].t) return this.keys[0].v;
        if (timeSec >= this.keys[this.keys.length - 1].t) return this.keys[this.keys.length - 1].v;
        for (let i = 0; i < this.keys.length - 1; i++) {
            const k1 = this.keys[i], k2 = this.keys[i + 1];
            if (timeSec >= k1.t && timeSec <= k2.t) {
                const p = (timeSec - k1.t) / (k2.t - k1.t);
                return k1.v + (k2.v - k1.v) * p;
            }
        }
        return 0;
    }
}

export interface Vec2 { x: number; y: number; }

export class CatmullRomPath {
    private pts: Vec2[];
    private arcTable: number[];
    private totalLen: number;
    private samples: number;

    constructor(points: Vec2[], samples: number = 200) {
        log.assert(points.length >= 2, 'CatmullRom needs >=2 points');
        this.pts = [points[0], ...points, points[points.length - 1]];
        this.samples = samples;
        const { table, total } = this._buildArcTable(samples);
        this.arcTable = table;
        this.totalLen = total;
    }

    public getPoint(t: number): Vec2 {
        if (t <= 0) return this._rawPoint(1, 0);
        if (t >= 1) return this._rawPoint(this.pts.length - 2, 1);
        const targetLen = t * this.totalLen;
        return this._pointAtArc(targetLen);
    }

    private _pointAtArc(arcLen: number): Vec2 {
        const n = this.samples;
        let lo = 0, hi = n - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.arcTable[mid] < arcLen) lo = mid + 1; else hi = mid;
        }
        const prevArc = lo === 0 ? 0 : this.arcTable[lo - 1];
        const curArc = this.arcTable[lo];
        const segLen = curArc - prevArc;
        const tLocal = segLen < 1e-12 ? 0 : (arcLen - prevArc) / segLen;
        const globalT = (lo + tLocal) / n;
        return this._rawEval(globalT);
    }

    private _rawEval(t: number): Vec2 {
        const pts = this.pts;
        const n = pts.length - 2;
        const seg = Math.min(Math.floor(t * n), n - 1);
        const u = t * n - seg;
        return this._rawPoint(seg + 1, u);
    }

    private _rawPoint(i: number, t: number): Vec2 {
        const p = this.pts;
        const i0 = Math.max(0, i - 1), i1 = i, i2 = Math.min(p.length - 1, i + 1), i3 = Math.min(p.length - 1, i + 2);
        return {
            x: this._cr(t, p[i0].x, p[i1].x, p[i2].x, p[i3].x),
            y: this._cr(t, p[i0].y, p[i1].y, p[i2].y, p[i3].y)
        };
    }

    private _cr(t: number, p0: number, p1: number, p2: number, p3: number): number {
        return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    }

    private _buildArcTable(n: number): { table: number[]; total: number } {
        let prev = this._rawEval(0), total = 0;
        const table: number[] = [];
        for (let i = 1; i <= n; i++) {
            const cur = this._rawEval(i / n);
            const dx = cur.x - prev.x, dy = cur.y - prev.y;
            total += Math.sqrt(dx * dx + dy * dy);
            table.push(total);
            prev = cur;
        }
        return { table, total };
    }
}

export class WorkerPool {
    private max: number; private active: number;
    private q: (() => Promise<unknown>)[];
    constructor(maxConcurrency?: number) {
        this.max = maxConcurrency || ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4);
        this.active = 0; this.q = [];
    }
    public async schedule<T>(task: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.q.push(async () => { try { resolve(await task()); } catch (e) { reject(e); } finally { this.active--; this._next(); } });
            this._next();
        });
    }
    private _next(): void {
        if (this.active < this.max && this.q.length > 0) { this.active++; const t = this.q.shift(); if (t) t(); }
    }
}
