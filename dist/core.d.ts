/**
 * AegisForge Core Utilities
 */
export declare class AegisError extends Error {
    e: any;
    constructor(m: string, e?: any);
}
export declare class Logger {
    private p;
    constructor();
    info(...a: any[]): void;
    warn(...a: any[]): void;
    error(m: string, e?: any): void;
    assert(c: boolean, m: string): void;
}
export declare const log: Logger;
export declare class ResourceManager {
    private t;
    constructor();
    track<T>(r: T): T;
    untrack(r: any): void;
    closeAll(): void;
}
export declare class TimestampSync {
    vNum: bigint;
    vDen: bigint;
    a: bigint;
    vf: bigint;
    af: bigint;
    constructor(vFPS: number, aRate: number);
    nextVideoPts(): number;
    nextAudioPts(samples: number): number;
}
