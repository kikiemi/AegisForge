/**
 * AegisForge Core Utilities
 */
export class AegisError extends Error {
    e;
    constructor(m, e = null) {
        super(e ? `${m} | Cause: ${e.message || e}` : m);
        this.name = 'AegisError';
        this.e = e;
    }
}
export class Logger {
    p;
    constructor() {
        this.p = '[AF]';
    }
    info(...a) {
        console.info(this.p, ...a);
    }
    warn(...a) {
        console.warn(this.p, ...a);
    }
    error(m, e) {
        console.error(this.p, m, e || '');
    }
    assert(c, m) {
        if (!c) {
            const e = new AegisError(m);
            this.error(e.message);
            throw e;
        }
    }
}
export const log = new Logger();
export class ResourceManager {
    t;
    constructor() {
        this.t = new Set();
    }
    track(r) {
        if (r && typeof r.close === 'function') {
            this.t.add(r);
        }
        return r;
    }
    untrack(r) {
        this.t.delete(r);
    }
    closeAll() {
        for (const r of this.t) {
            try {
                r.close();
            }
            catch (e) {
                log.error('ResourceManager:err', e);
            }
        }
        this.t.clear();
    }
}
export class TimestampSync {
    vNum;
    vDen;
    a;
    vf;
    af;
    constructor(vFPS, aRate) {
        log.assert(vFPS > 0, 'vFPS>0');
        log.assert(aRate > 0, 'aRate>0');
        let fpsNum = Math.round(vFPS * 1000);
        let fpsDen = 1000;
        // Exact fraction for NTSC standards
        if (Math.abs(vFPS - 29.97) < 0.01) {
            fpsNum = 30000;
            fpsDen = 1001;
        }
        else if (Math.abs(vFPS - 23.976) < 0.01) {
            fpsNum = 24000;
            fpsDen = 1001;
        }
        else if (Math.abs(vFPS - 59.94) < 0.01) {
            fpsNum = 60000;
            fpsDen = 1001;
        }
        this.vNum = BigInt(fpsNum);
        this.vDen = BigInt(fpsDen);
        this.a = BigInt(Math.round(aRate));
        this.vf = 0n;
        this.af = 0n;
    }
    nextVideoPts() {
        const ptsNode = (this.vf * 1000000n * this.vDen) / this.vNum;
        this.vf++;
        return Number(ptsNode);
    }
    nextAudioPts(samples) {
        const ptsNode = (this.af * 1000000n) / this.a;
        this.af += BigInt(samples);
        return Number(ptsNode);
    }
}
