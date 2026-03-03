import { IntervalTree, Interval } from './interval_tree';
import { FrameCache, CachedFrame } from './frame_cache';
import { log } from '../core';

export interface PipelineConfig {
    width: number;
    height: number;
    fps: number;
    totalFrames: number;
    batchSize: number;
    maxConcurrentDecode: number;
    skipIdenticalFrames: boolean;
    useFrameCache: boolean;
    backpressureThreshold: number;
}

export interface RenderResult {
    frameIndex: number;
    timestamp: number;
    skipped: boolean;
    fromCache: boolean;
    renderTimeMs: number;
}

export interface PipelineStats {
    totalFrames: number;
    renderedFrames: number;
    skippedFrames: number;
    cachedFrames: number;
    avgRenderMs: number;
    totalMs: number;
    fps: number;
    cacheHitRate: number;
}

const DEFAULT_PIPE: PipelineConfig = {
    width: 1920, height: 1080, fps: 30, totalFrames: 0,
    batchSize: 8, maxConcurrentDecode: 4,
    skipIdenticalFrames: true, useFrameCache: true,
    backpressureThreshold: 16
};

export class FastRenderPipeline {
    private cfg: PipelineConfig;
    private _clipTree: IntervalTree;
    private _cache: FrameCache;
    private _lastClipSet: string = '';
    private _lastFrameHash: number = 0;
    private _pendingEncodes: number = 0;
    private _stats: PipelineStats;
    private _onFrame: ((frame: RenderResult) => void) | null = null;
    private _onBatch: ((batch: RenderResult[]) => void) | null = null;
    private _running: boolean = false;

    constructor(config?: Partial<PipelineConfig>) {
        this.cfg = { ...DEFAULT_PIPE, ...config };
        this._clipTree = new IntervalTree();
        this._cache = new FrameCache({ maxMemoryMB: 512, maxFrames: 600, prefetchAhead: 15 });
        this._stats = this._emptyStats();
    }

    public get clipTree(): IntervalTree { return this._clipTree; }
    public get cache(): FrameCache { return this._cache; }

    public loadClips(clips: { id: string; inPoint: number; outPoint: number;[k: string]: any }[]): void {
        this._clipTree.buildFromClips(clips);
    }

    public onFrame(cb: (frame: RenderResult) => void): void { this._onFrame = cb; }
    public onBatch(cb: (batch: RenderResult[]) => void): void { this._onBatch = cb; }

    public async render(
        decodeFrame: (sourceId: string, timestamp: number) => Promise<CachedFrame | null>,
        encodeFrame: (pixels: Uint8ClampedArray | ImageBitmap, timestamp: number) => Promise<void>
    ): Promise<PipelineStats> {
        this._running = true;
        this._stats = this._emptyStats();
        this._stats.totalFrames = this.cfg.totalFrames;
        const t0 = performance.now();
        const frameDur = 1000 / this.cfg.fps;
        let batchResults: RenderResult[] = [];

        for (let i = 0; i < this.cfg.totalFrames && this._running; i++) {
            const timestamp = i * frameDur;
            const frameStart = performance.now();
            const activeClips = this._clipTree.queryPoint(timestamp);
            const clipSetKey = this._clipSetHash(activeClips, timestamp);

            if (this.cfg.skipIdenticalFrames && clipSetKey === this._lastClipSet && activeClips.length > 0) {
                const result: RenderResult = {
                    frameIndex: i, timestamp, skipped: true, fromCache: false,
                    renderTimeMs: performance.now() - frameStart
                };
                this._stats.skippedFrames++;
                batchResults.push(result);
                if (this._onFrame) this._onFrame(result);
                if (batchResults.length >= this.cfg.batchSize) {
                    if (this._onBatch) this._onBatch(batchResults);
                    batchResults = [];
                }
                continue;
            }
            this._lastClipSet = clipSetKey;

            let cached: CachedFrame | null = null;
            let fromCache = false;

            if (this.cfg.useFrameCache && activeClips.length > 0) {
                const primary = activeClips[0];
                const clipData = primary.data as { sourceStart?: number; sourceId?: string } | undefined;
                const sourceTime = timestamp - primary.lo + (clipData?.sourceStart || 0);
                cached = this._cache.get(clipData?.sourceId || primary.id, sourceTime);
                if (cached) fromCache = true;
            }

            if (!cached && activeClips.length > 0) {
                const decodePromises: Promise<CachedFrame | null>[] = [];
                const toDecode = activeClips.slice(0, this.cfg.maxConcurrentDecode);
                for (const clip of toDecode) {
                    const clipData = clip.data as { sourceStart?: number; sourceId?: string } | undefined;
                    const sourceTime = timestamp - clip.lo + (clipData?.sourceStart || 0);
                    const sourceId = clipData?.sourceId || clip.id;

                    if (this.cfg.useFrameCache) {
                        const nearest = this._cache.getNearest(sourceId, sourceTime);
                        if (nearest) { cached = nearest; fromCache = true; break; }
                    }

                    decodePromises.push(decodeFrame(sourceId, sourceTime));
                }

                if (!fromCache && decodePromises.length > 0) {
                    try {
                        const results = await Promise.all(decodePromises);
                        cached = results.find(r => r !== null) || null;
                        if (cached && this.cfg.useFrameCache) {
                            this._cache.put(cached);
                        }
                    } catch (decodeErr) {
                        log.warn('[FastPipeline] Frame decode failed, skipping frame', decodeErr);
                    }
                }
            }

            while (this._pendingEncodes >= this.cfg.backpressureThreshold) {
                await new Promise(r => setTimeout(r, 1));
            }

            if (cached) {
                this._pendingEncodes++;
                try {
                    const output = cached.data || cached.rgba;
                    if (output) await encodeFrame(output, timestamp * 1000);
                } catch (encodeErr) {
                    log.error('[FastPipeline] Frame encode failed', encodeErr);
                    throw encodeErr;
                }
                this._pendingEncodes--;
                this._stats.renderedFrames++;
            }

            if (fromCache) this._stats.cachedFrames++;
            const renderTime = performance.now() - frameStart;
            const result: RenderResult = { frameIndex: i, timestamp, skipped: false, fromCache, renderTimeMs: renderTime };
            batchResults.push(result);
            if (this._onFrame) this._onFrame(result);
            if (batchResults.length >= this.cfg.batchSize) {
                if (this._onBatch) this._onBatch(batchResults);
                batchResults = [];
            }
        }

        if (batchResults.length > 0 && this._onBatch) this._onBatch(batchResults);
        const totalMs = performance.now() - t0;
        this._stats.totalMs = totalMs;
        this._stats.avgRenderMs = this._stats.renderedFrames > 0
            ? totalMs / this._stats.renderedFrames : 0;
        this._stats.fps = totalMs > 0 ? this._stats.renderedFrames / (totalMs / 1000) : 0;
        this._stats.cacheHitRate = this._cache.stats.hitRate;
        this._running = false;
        return this._stats;
    }

    public stop(): void { this._running = false; }

    public async renderRange(
        startFrame: number, endFrame: number,
        decodeFrame: (sourceId: string, timestamp: number) => Promise<CachedFrame | null>,
        encodeFrame: (pixels: Uint8ClampedArray | ImageBitmap, timestamp: number) => Promise<void>
    ): Promise<PipelineStats> {
        const originalTotal = this.cfg.totalFrames;
        this.cfg.totalFrames = endFrame - startFrame;
        const origCfg = { ...this.cfg };
        const stats = await this.render(
            (sourceId, ts) => decodeFrame(sourceId, ts + startFrame * (1000 / this.cfg.fps)),
            encodeFrame
        );
        this.cfg.totalFrames = originalTotal;
        return stats;
    }

    private _clipSetHash(clips: Interval[], timestamp: number): string {
        if (clips.length === 0) return '';
        let h = 2166136261;
        for (const c of clips) {
            for (let i = 0; i < c.id.length; i++) {
                h ^= c.id.charCodeAt(i);
                h = Math.imul(h, 16777619);
            }
        }
        h ^= Math.round(timestamp * 10);
        h = Math.imul(h, 16777619);
        return String(h >>> 0);
    }

    private _emptyStats(): PipelineStats {
        return {
            totalFrames: 0, renderedFrames: 0, skippedFrames: 0,
            cachedFrames: 0, avgRenderMs: 0, totalMs: 0, fps: 0, cacheHitRate: 0
        };
    }
}
