export declare class NativeEncoders {
    static encodeBMP(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob>;
    static encodeTIFF(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob>;
    static encodeGIF(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob>;
    static encodeWAV(audioBuffer: AudioBuffer): Promise<Blob>;
}
export declare class AnimatedGifEncoder {
    w: number;
    h: number;
    fps: number;
    frames: any[];
    canvas: OffscreenCanvas;
    ctx: any;
    constructor(width: number, height: number, framerate?: number);
    addFrame(videoFrame: any, delayMs?: number): void;
    encode(): Promise<unknown>;
}
