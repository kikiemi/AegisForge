export interface CachedFrame {
    timestamp: number;
    data: ImageBitmap | null;
    rgba: Uint8ClampedArray | null;
    width: number;
    height: number;
    sourceId: string;
    isKey: boolean;
    accessCount: number;
    lastAccess: number;
    byteSize: number;
}

export interface GOPEntry {
    keyframePts: number;
    keyframeIdx: number;
    endPts: number;
    frameCount: number;
}

export interface FrameCacheConfig {
    maxMemoryMB: number;
    maxFrames: number;
    prefetchAhead: number;
    prefetchBehind: number;
    evictionPolicy: 'lru' | 'lfu';
}

const DEFAULT_CACHE_CFG: FrameCacheConfig = {
    maxMemoryMB: 512,
    maxFrames: 300,
    prefetchAhead: 10,
    prefetchBehind: 3,
    evictionPolicy: 'lru'
};

export class FrameCache {
    private cfg: FrameCacheConfig;
    private _frames: Map<string, CachedFrame> = new Map();
    private _usedBytes: number = 0;
    private _maxBytes: number;
    private _gopTable: Map<string, GOPEntry[]> = new Map();
    private _stats = { hits: 0, misses: 0, evictions: 0, prefetches: 0 };

    constructor(config?: Partial<FrameCacheConfig>) {
        this.cfg = { ...DEFAULT_CACHE_CFG, ...config };
        this._maxBytes = this.cfg.maxMemoryMB * 1024 * 1024;
    }

    public get(sourceId: string, timestamp: number): CachedFrame | null {
        const key = this._key(sourceId, timestamp);
        const frame = this._frames.get(key);
        if (frame) {
            frame.lastAccess = performance.now();
            frame.accessCount++;
            this._stats.hits++;
            return frame;
        }
        this._stats.misses++;
        return null;
    }

    public getNearest(sourceId: string, timestamp: number, toleranceMs: number = 33.34): CachedFrame | null {
        let best: CachedFrame | null = null;
        let bestDist = Infinity;
        for (const [_, frame] of this._frames) {
            if (frame.sourceId !== sourceId) continue;
            const dist = Math.abs(frame.timestamp - timestamp);
            if (dist < bestDist && dist <= toleranceMs) {
                bestDist = dist;
                best = frame;
            }
        }
        if (best) {
            best.lastAccess = performance.now();
            best.accessCount++;
            this._stats.hits++;
        }
        return best;
    }

    public put(frame: CachedFrame): void {
        const key = this._key(frame.sourceId, frame.timestamp);
        if (this._frames.has(key)) {
            const old = this._frames.get(key)!;
            this._usedBytes -= old.byteSize;
            this._disposeFrame(old);
        }
        while (this._usedBytes + frame.byteSize > this._maxBytes || this._frames.size >= this.cfg.maxFrames) {
            if (!this._evictOne()) break;
        }
        frame.lastAccess = performance.now();
        this._frames.set(key, frame);
        this._usedBytes += frame.byteSize;
    }

    public buildGOPTable(sourceId: string, keyframes: { pts: number; idx: number }[], totalFrames: number, fps: number): void {
        const gops: GOPEntry[] = [];
        for (let i = 0; i < keyframes.length; i++) {
            const kf = keyframes[i];
            const nextKf = i + 1 < keyframes.length ? keyframes[i + 1] : null;
            const endPts = nextKf ? nextKf.pts : kf.pts + (totalFrames - kf.idx) / fps;
            gops.push({
                keyframePts: kf.pts,
                keyframeIdx: kf.idx,
                endPts,
                frameCount: nextKf ? nextKf.idx - kf.idx : totalFrames - kf.idx
            });
        }
        this._gopTable.set(sourceId, gops);
    }

    public findKeyframeForSeek(sourceId: string, targetPts: number): GOPEntry | null {
        const gops = this._gopTable.get(sourceId);
        if (!gops || gops.length === 0) return null;
        let lo = 0, hi = gops.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (gops[mid].keyframePts <= targetPts) lo = mid;
            else hi = mid - 1;
        }
        return gops[lo];
    }

    public getFramesBetween(sourceId: string, startPts: number, endPts: number): CachedFrame[] {
        const result: CachedFrame[] = [];
        for (const [_, frame] of this._frames) {
            if (frame.sourceId === sourceId && frame.timestamp >= startPts && frame.timestamp < endPts) {
                result.push(frame);
            }
        }
        return result.sort((a, b) => a.timestamp - b.timestamp);
    }

    public prefetchRange(sourceId: string, centerPts: number, fps: number): { start: number; end: number } {
        const frameDur = 1000 / fps;
        const start = centerPts - this.cfg.prefetchBehind * frameDur;
        const end = centerPts + this.cfg.prefetchAhead * frameDur;
        this._stats.prefetches++;
        return { start, end };
    }

    public invalidateSource(sourceId: string): number {
        let freed = 0;
        const toDelete: string[] = [];
        for (const [key, frame] of this._frames) {
            if (frame.sourceId === sourceId) {
                this._usedBytes -= frame.byteSize;
                this._disposeFrame(frame);
                toDelete.push(key);
                freed += frame.byteSize;
            }
        }
        for (const k of toDelete) this._frames.delete(k);
        return freed;
    }

    public invalidateRange(sourceId: string, startPts: number, endPts: number): number {
        let freed = 0;
        const toDelete: string[] = [];
        for (const [key, frame] of this._frames) {
            if (frame.sourceId === sourceId && frame.timestamp >= startPts && frame.timestamp < endPts) {
                this._usedBytes -= frame.byteSize;
                this._disposeFrame(frame);
                toDelete.push(key);
                freed += frame.byteSize;
            }
        }
        for (const k of toDelete) this._frames.delete(k);
        return freed;
    }

    public purgeAll(): number {
        const freed = this._usedBytes;
        for (const [_, frame] of this._frames) this._disposeFrame(frame);
        this._frames.clear();
        this._usedBytes = 0;
        return freed;
    }

    public get stats() {
        return {
            ...this._stats,
            cachedFrames: this._frames.size,
            usedMB: this._usedBytes / (1024 * 1024),
            hitRate: this._stats.hits + this._stats.misses > 0
                ? this._stats.hits / (this._stats.hits + this._stats.misses) : 0
        };
    }

    private _evictOne(): boolean {
        if (this._frames.size === 0) return false;
        let victim: [string, CachedFrame] | null = null;
        if (this.cfg.evictionPolicy === 'lru') {
            let oldestAccess = Infinity;
            for (const entry of this._frames) {
                if (entry[1].lastAccess < oldestAccess) {
                    oldestAccess = entry[1].lastAccess;
                    victim = entry;
                }
            }
        } else {
            let leastFreq = Infinity;
            for (const entry of this._frames) {
                if (entry[1].accessCount < leastFreq) {
                    leastFreq = entry[1].accessCount;
                    victim = entry;
                }
            }
        }
        if (victim) {
            this._usedBytes -= victim[1].byteSize;
            this._disposeFrame(victim[1]);
            this._frames.delete(victim[0]);
            this._stats.evictions++;
            return true;
        }
        return false;
    }

    private _disposeFrame(frame: CachedFrame): void {
        if (frame.data) {
            try { frame.data.close(); } catch (_) { }
            frame.data = null;
        }
        frame.rgba = null;
    }

    private _key(sourceId: string, timestamp: number): string {
        return sourceId + ':' + Math.round(timestamp * 10);
    }
}
