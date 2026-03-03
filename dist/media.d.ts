export declare class Img {
    w: number;
    h: number;
    c: HTMLCanvasElement | OffscreenCanvas | null;
    x: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    constructor(s: any);
    private static _c;
    static load(s: any): Promise<Img>;
    resize(w: number, h: number, f?: 'contain' | 'cover' | 'stretch'): Img;
    color(o?: any): Img;
    chromaKey(tc?: [number, number, number], tol?: number): Img;
    overlay(i: Img, x?: number, y?: number, a?: number): Img;
    text(t: string, x: number, y: number, o?: any): Img;
    createFrame(ts: number, d?: number): any;
    close(): void;
}
export declare class Aud {
    b: AudioBuffer;
    constructor(b: AudioBuffer);
    static load(s: any): Promise<Aud>;
    static stream(mediaStream: MediaStream): Promise<any>;
    mix(o: Aud, st?: number, v?: number): Promise<Aud>;
    generate(f?: number, sp?: number): Generator<{
        audioData: any;
        framesCount: number;
    }>;
    static mixWebStreams(audios: Aud[], targetSr: number, targetCh: number, chunkSize?: number): Generator<{
        audioData: any;
        framesCount: number;
    }>;
}
export declare class AudStream {
    s: MediaStream;
    x: AudioContext;
    p: any;
    r: any;
    constructor(s: MediaStream, x: AudioContext);
    read(): Promise<any>;
    close(): void;
}
