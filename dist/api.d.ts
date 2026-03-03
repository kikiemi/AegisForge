import { Img } from './media';
export declare class Pillow {
    img: Img;
    constructor(imgInstance: Img);
    /**
     * Python Pillow `Image.open(src)` equivalent.
     * @param src HTMLImageElement | HTMLCanvasElement | Blob | File | string
     */
    static open(src: any): Promise<Pillow>;
    /**
     * Pillow `Image.filter(name, value)`
     */
    filter(filterName: string, value: any): Pillow;
    /**
     * Pillow `Image.resize((width, height))`
     */
    resize(width: number, height: number, fit?: 'contain' | 'cover' | 'stretch'): Pillow;
    /**
     * Advanced Chroma Key (Green Screen) filter
     */
    chromaKey(targetColor?: [number, number, number], tolerance?: number): Pillow;
    /**
     * Python Pillow `ImageDraw.text()`
     */
    text(txt: string, x: number, y: number, options?: any): Pillow;
    /**
     * Python Pillow `Image.save(filename)`
     * Automatically extracts the blob from the canvas and triggers a native browser download.
     */
    save(filename?: string, quality?: number): Promise<File>;
    /** Cleanup memory */
    close(): void;
}
export declare class FFmpeg {
    private _inputs;
    private _vCodec;
    private _size;
    private _fps;
    private _bitrate;
    private _audio;
    private logPrefix;
    private _glShader;
    private _glUniforms;
    private _glFrames;
    private _videoDisabled;
    private _trim;
    private _crop;
    private _preset;
    private _onProgress;
    /**
     * Start an FFmpeg chain safely
     */
    static run(): FFmpeg;
    /**
     * ffmpeg -i <input.png>
     * Can accept array of Canvases/Images or an Audio source.
     */
    input(source: any): FFmpeg;
    /**
     * Advanced: Decode a real Video File completely and pass it to the muxer.
     * This automates loading an HTMLVideoElement and scraping frames and audio.
     */
    loadFile(fileOrBlob: File | Blob): Promise<FFmpeg>;
    /**
     * Completely disable video track (useful for video -> audio extraction).
     */
    noVideo(): FFmpeg;
    /**
     * Loads a raw Fragment Shader to process the entire video stream at 10000x performance.
     * Bypasses the CPU Canvas generation ring.
     * @param glslString The GLSL Fragment shader source
     * @param frameCount How many frames to generate from this shader
     * @param uniforms Additional custom float uniform values
     */
    webgl(glslString: string, frameCount: number, uniforms?: any): FFmpeg;
    /**
     * ffmpeg -c:v <codec>
     * e.g., 'av1', 'vp9', 'h264'
     */
    videoCodec(codecName: string): FFmpeg;
    /**
     * ffmpeg -s <width>x<height>
     */
    size(width: number, height: number): FFmpeg;
    /**
     * ffmpeg -r <fps>
     */
    fps(framerate: number): FFmpeg;
    /**
     * ffmpeg -b:v <bitrate>
     */
    videoBitrate(bps: number): FFmpeg;
    /**
     * Set a callback to track encoding progress
     */
    onProgress(callback: (percent: number) => void): FFmpeg;
    /**
     * Trim the output (in seconds)
     */
    trim(startSec: number, endSec: number): FFmpeg;
    /**
     * Crop the output
     */
    crop(x: number, y: number, w: number, h: number): FFmpeg;
    /**
     * Encoding Preset
     */
    preset(mode: 'fast' | 'balanced' | 'quality'): FFmpeg;
    /**
     * Auto-detect Audio settings
     */
    audioTrack(channels?: number, rate?: number): FFmpeg;
    /**
     * FFmpeg Save/Mux trigger
     * Internally boots AegisForge `Vid`, processes the array inputs or WebGL engine, and downloads the output.
     */
    save(filenameOrStream?: string | WritableStream, options?: any): Promise<File | void>;
}
