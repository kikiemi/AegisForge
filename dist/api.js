import { Img, Aud } from './media';
import { Vid } from './codec';
import { GL } from './gl';
import { log, AegisError, ResourceManager, TimestampSync } from './core';
export class Pillow {
    img;
    constructor(imgInstance) {
        this.img = imgInstance;
    }
    /**
     * Python Pillow `Image.open(src)` equivalent.
     * @param src HTMLImageElement | HTMLCanvasElement | Blob | File | string
     */
    static async open(src) {
        return new Pillow(await Img.load(src));
    }
    /**
     * Pillow `Image.filter(name, value)`
     */
    filter(filterName, value) {
        const opt = {};
        opt[filterName.toLowerCase()] = value;
        this.img.color(opt);
        return this;
    }
    /**
     * Pillow `Image.resize((width, height))`
     */
    resize(width, height, fit = 'contain') {
        this.img.resize(width, height, fit);
        return this;
    }
    /**
     * Advanced Chroma Key (Green Screen) filter
     */
    chromaKey(targetColor = [0, 255, 0], tolerance = 50) {
        this.img.chromaKey(targetColor, tolerance);
        return this;
    }
    /**
     * Python Pillow `ImageDraw.text()`
     */
    text(txt, x, y, options = {}) {
        this.img.text(txt, x, y, options);
        return this;
    }
    /**
     * Python Pillow `Image.save(filename)`
     * Automatically extracts the blob from the canvas and triggers a native browser download.
     */
    async save(filename = "output.png", quality = 0.92) {
        let finalFilename = filename;
        const validImageExts = ['png', 'jpg', 'jpeg', 'webp'];
        const currentExt = finalFilename.split('.').pop()?.toLowerCase() || "";
        if (!finalFilename.includes('.') || !validImageExts.includes(currentExt)) {
            finalFilename += ".png";
        }
        let mimeType = "image/png";
        const ext = finalFilename.split('.').pop()?.toLowerCase();
        if (ext === "jpg" || ext === "jpeg")
            mimeType = "image/jpeg";
        else if (ext === "webp")
            mimeType = "image/webp";
        return new Promise((resolve, reject) => {
            try {
                const canvas = this.img.c;
                if (!canvas)
                    throw new Error("Canvas is null");
                const blobPromise = canvas.convertToBlob
                    ? canvas.convertToBlob({ type: mimeType, quality: quality })
                    : new Promise(res => canvas.toBlob(res, mimeType, quality));
                blobPromise.then((blob) => {
                    const fileObj = new File([blob], finalFilename, { type: mimeType });
                    const url = URL.createObjectURL(fileObj);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = finalFilename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 1000); // Safari fix
                    resolve(fileObj);
                }).catch(reject);
            }
            catch (err) {
                reject(new AegisError("Failed to save Pillow Image locally.", err));
            }
        });
    }
    /** Cleanup memory */
    close() {
        this.img.close();
    }
}
export class FFmpeg {
    _inputs = [];
    _vCodec = "vp8"; // Safe fallback default
    _size = { width: 1280, height: 720 };
    _fps = 30;
    _bitrate = 2_000_000;
    _audio = null; // { channels: 2, sampleRate: 48000 }
    logPrefix = "[FFmpeg Native Wrapper]";
    // WebGL FX Extrusion 
    _glShader = null;
    _glUniforms = {};
    _glFrames = 0;
    _videoDisabled = false;
    _trim = null;
    _crop = null;
    _preset = 'balanced';
    _onProgress = null;
    /**
     * Start an FFmpeg chain safely
     */
    static run() {
        return new FFmpeg();
    }
    /**
     * ffmpeg -i <input.png>
     * Can accept array of Canvases/Images or an Audio source.
     */
    input(source) {
        if (Array.isArray(source)) {
            this._inputs.push(...source);
        }
        else {
            this._inputs.push(source);
        }
        return this;
    }
    /**
     * Advanced: Decode a real Video File completely and pass it to the muxer.
     * This automates loading an HTMLVideoElement and scraping frames and audio.
     */
    async loadFile(fileOrBlob) {
        return new Promise((resolve, reject) => {
            const video = document.createElement("video");
            video.src = URL.createObjectURL(fileOrBlob);
            video.muted = true;
            video.onloadeddata = async () => {
                this.size(video.videoWidth, video.videoHeight);
                this._inputs.push(video);
                try {
                    const stream = video.captureStream ? video.captureStream() : video.mozCaptureStream ? video.mozCaptureStream() : null;
                    if (stream && stream.getAudioTracks().length > 0) {
                        const aud = await Aud.stream(stream);
                        this._inputs.push(aud);
                        this.audioTrack(2, 48000);
                    }
                    else {
                        throw new Error("No Audio Track or captureStream unavailable");
                    }
                }
                catch (e) {
                    try {
                        const arr = await fileOrBlob.arrayBuffer();
                        const actx = new (window.AudioContext || window.webkitAudioContext)();
                        const decoded = await actx.decodeAudioData(arr);
                        const aud = new Aud(decoded);
                        this._inputs.push(aud);
                        this.audioTrack(decoded.numberOfChannels, decoded.sampleRate);
                    }
                    catch (e2) {
                        log.warn(this.logPrefix, "Audio fallback failed for loadFile. File might be video-only or unsupported container.", e2);
                    }
                }
                resolve(this);
            };
            video.onerror = (e) => reject(e);
            video.load();
        });
    }
    /**
     * Completely disable video track (useful for video -> audio extraction).
     */
    noVideo() {
        this._videoDisabled = true;
        return this;
    }
    /**
     * Loads a raw Fragment Shader to process the entire video stream at 10000x performance.
     * Bypasses the CPU Canvas generation ring.
     * @param glslString The GLSL Fragment shader source
     * @param frameCount How many frames to generate from this shader
     * @param uniforms Additional custom float uniform values
     */
    webgl(glslString, frameCount, uniforms = {}) {
        this._glShader = glslString;
        this._glFrames = frameCount;
        this._glUniforms = uniforms;
        return this;
    }
    /**
     * ffmpeg -c:v <codec>
     * e.g., 'av1', 'vp9', 'h264'
     */
    videoCodec(codecName) {
        this._videoDisabled = false;
        const c = codecName.toLowerCase();
        if (c.includes("av1") || c.includes("av01"))
            this._vCodec = "av01.0.04M.08";
        else if (c.includes("vp9") || c.includes("vp09"))
            this._vCodec = "vp09.00.10.08";
        else if (c.includes("h264") || c.includes("avc1"))
            this._vCodec = "avc1.42001E";
        else
            this._vCodec = "vp8"; // fallback
        return this;
    }
    /**
     * ffmpeg -s <width>x<height>
     */
    size(width, height) {
        // Enforce even dimensions for hardware encoder safety
        this._size = { width: width + (width % 2), height: height + (height % 2) };
        return this;
    }
    /**
     * ffmpeg -r <fps>
     */
    fps(framerate) {
        this._fps = framerate;
        return this;
    }
    /**
     * ffmpeg -b:v <bitrate>
     */
    videoBitrate(bps) {
        this._bitrate = bps;
        return this;
    }
    /**
     * Set a callback to track encoding progress
     */
    onProgress(callback) {
        this._onProgress = callback;
        return this;
    }
    /**
     * Trim the output (in seconds)
     */
    trim(startSec, endSec) {
        this._trim = { start: startSec, end: endSec };
        return this;
    }
    /**
     * Crop the output
     */
    crop(x, y, w, h) {
        this._crop = { x, y, w, h };
        return this;
    }
    /**
     * Encoding Preset
     */
    preset(mode) {
        this._preset = mode;
        return this;
    }
    /**
     * Auto-detect Audio settings
     */
    audioTrack(channels = 2, rate = 48000) {
        this._audio = { numberOfChannels: channels, sampleRate: rate };
        return this;
    }
    /**
     * FFmpeg Save/Mux trigger
     * Internally boots AegisForge `Vid`, processes the array inputs or WebGL engine, and downloads the output.
     */
    async save(filenameOrStream = "output", options = {}) {
        const isStream = typeof filenameOrStream !== 'string';
        let finalFilename = isStream ? "stream" : filenameOrStream;
        const currentExt = isStream ? '' : finalFilename.split('.').pop()?.toLowerCase() || "";
        const isWAV = currentExt === 'wav';
        const isMP4 = currentExt === 'mp4' || currentExt === 'm4a';
        const isGIF = currentExt === 'gif';
        if (!finalFilename.includes('.')) {
            finalFilename += this._videoDisabled ? (this._audio ? '.m4a' : '') : ((this._vCodec.includes('avc1') || this._vCodec.includes('h264') || this._vCodec.includes('av01')) ? '.mp4' : '.webm');
        }
        // Fast Native WAV intercept
        if (isWAV) {
            log.info(this.logPrefix, `Executing direct Native WAV Exporter -> ${finalFilename}`);
            const audInput = this._inputs.find(i => i instanceof Aud);
            if (!audInput)
                throw new AegisError("No audio source provided for WAV extraction");
            // Dynamic import to break dependency cycle if any
            const { NativeEncoders } = await import('./encoders');
            const blob = await NativeEncoders.encodeWAV(audInput.b);
            const fileObj = new File([blob], finalFilename, { type: 'audio/wav' });
            const url = URL.createObjectURL(fileObj);
            const a = document.createElement("a");
            a.href = url;
            a.download = finalFilename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000); // Safari fix
            return fileObj;
        }
        log.info(this.logPrefix, `Executing native video builder -> ${finalFilename}`);
        // GIF Auto-Optimization Hook
        if (isGIF && this._preset !== 'quality') {
            if (this._fps > 15) {
                log.info(this.logPrefix, `Auto-Optimizing GIF: Capping FPS from ${this._fps} to 15`);
                this._fps = 15;
            }
            if (this._size.width > 720 || this._size.height > 720) {
                log.info(this.logPrefix, `Auto-Optimizing GIF: Halving massive ${this._size.width}x${this._size.height} resolution`);
                this._size.width = Math.round(this._size.width / 2);
                this._size.height = Math.round(this._size.height / 2);
                // Re-enforce hardware constraints
                this._size.width += (this._size.width % 2);
                this._size.height += (this._size.height % 2);
            }
        }
        const res = new ResourceManager();
        try {
            const vid = res.track(new Vid({
                video: this._videoDisabled ? null : {
                    codec: this._vCodec,
                    width: this._size.width,
                    height: this._size.height,
                    bitrate: this._bitrate,
                    framerate: this._fps,
                    hardwareAcceleration: this._preset === 'fast' ? 'prefer-hardware' : (this._preset === 'quality' ? 'prefer-software' : 'no-preference'),
                    bitrateMode: this._preset === 'quality' ? 'variable' : 'constant'
                },
                audio: this._audio,
                mp4Container: isStream ? !!options.mp4Container : (finalFilename.includes('.mp4') || finalFilename.includes('.m4a')),
                isGif: isStream ? !!options.isGif : finalFilename.includes('.gif'),
                stream: isStream ? filenameOrStream : undefined
            }));
            log.info(this.logPrefix, "Checking hardware compatibility...");
            await vid.init(); // Wait for Hardware Validation and automatic fallback handling
            const ts = new TimestampSync(this._fps, this._audio ? this._audio.sampleRate : 48000);
            const frameDuration = Math.floor(1_000_000 / this._fps);
            // Path A: WebGL Ultra Fast Processing Engine
            if (this._glShader) {
                log.info(this.logPrefix, `Booting GPU Fragment Shader Pipeline (${this._glFrames} frames)`);
                const engine = new GL(this._size.width, this._size.height);
                engine.loadFragmentShader(this._glShader);
                for (let i = 0; i < this._glFrames; i++) {
                    const timeSec = i / this._fps;
                    engine.setUniform1f("u_time", timeSec);
                    engine.setUniform1f("u_progress", i / this._glFrames);
                    // Inject custom uniforms
                    for (const [key, val] of Object.entries(this._glUniforms)) {
                        engine.setUniform1f(key, val);
                    }
                    const bitmap = await engine.extract();
                    const vf = new VideoFrame(bitmap, { timestamp: ts.nextVideoPts(), duration: frameDuration });
                    await vid.pushVid(vf, i % 60 === 0);
                    bitmap.close();
                }
                // Inject silent audio to match the video length if an audio track was configured
                if (this._audio && typeof OfflineAudioContext !== 'undefined') {
                    const targetAudioDuration = this._glFrames / this._fps;
                    log.info(this.logPrefix, `Generating ${targetAudioDuration}s of silent audio to match WebGL video...`);
                    const sr = this._audio.sampleRate || 48000;
                    const ch = this._audio.numberOfChannels || 2;
                    let generatedMs = 0;
                    const targetMs = targetAudioDuration * 1000;
                    while (generatedMs < targetMs) {
                        const oCtx = new OfflineAudioContext(ch, sr, sr); // 1 sec chunks repeatedly to save RAM
                        const silentBuf = oCtx.createBuffer(ch, sr, sr);
                        const silentAud = new Aud(silentBuf);
                        for (const chunk of silentAud.generate(8192, 0)) {
                            await vid.pushAud(chunk.audioData);
                        }
                        generatedMs += 1000;
                    }
                }
            }
            // Path B: Standard Canvas / Array CPU Processing
            else {
                let frameCount = 0;
                let trimStartMs = this._trim ? this._trim.start * 1000 : 0;
                let trimEndMs = this._trim ? this._trim.end * 1000 : Infinity;
                for (let item of this._inputs) {
                    if (!(item instanceof Img) && item.constructor.name !== "Pillow" && !(item instanceof Aud)) {
                        item = new Img(item);
                    }
                    if (item instanceof Img || item.constructor.name === "Pillow") {
                        const imgOb = item instanceof Img ? item : item.img;
                        // Apply cropping if requested
                        if (this._crop) {
                            imgOb.crop(this._crop.x, this._crop.y, this._crop.w, this._crop.h);
                        }
                        let curPtsMs = ts.nextVideoPts() / 1000;
                        if (curPtsMs >= trimStartMs && curPtsMs <= trimEndMs) {
                            const vf = imgOb.createFrame(curPtsMs * 1000, frameDuration);
                            await vid.pushVid(vf, frameCount % 60 === 0);
                            frameCount++;
                            // Main Thread UI Unblocking (Force yield every 60 frames to allow browser paint & event listeners)
                            if (frameCount % 60 === 0) {
                                await new Promise(r => setTimeout(r, 0));
                            }
                            if (this._onProgress) {
                                // Calculate percentage based on total expected frames if trimEndMs is finite
                                if (trimEndMs !== Infinity) {
                                    const totalExpectedMs = trimEndMs - trimStartMs;
                                    const currentMs = curPtsMs - trimStartMs;
                                    this._onProgress(Math.min(100, Math.floor((currentMs / totalExpectedMs) * 100)));
                                }
                                else {
                                    this._onProgress(Math.min(100, Math.floor((frameCount / this._inputs.length) * 100))); // Rough estimate if discrete frames
                                }
                            }
                        }
                    }
                    else if (item instanceof Aud) {
                        for (const chunk of item.generate(8192, 0)) {
                            let aPts = ts.nextAudioPts(chunk.audioData.numberOfFrames) / 1000;
                            if (aPts >= trimStartMs && aPts <= trimEndMs) {
                                await vid.pushAud(chunk.audioData);
                            }
                            else {
                                chunk.audioData.close();
                            }
                        }
                    }
                }
                // Audio Stream Muxing & Mixing (Mix all Aud inputs via chunk streams)
                let audInputs = this._inputs.filter(i => i instanceof Aud);
                if (audInputs.length > 0 && !this._videoDisabled) {
                    log.info(this.logPrefix, `Mixing ${audInputs.length} audio streams into a singular master track via Float32Array chunks...`);
                    const sr = this._audio?.sampleRate || 48000;
                    const ch = this._audio?.numberOfChannels || 2;
                    for (const chunk of Aud.mixWebStreams(audInputs, sr, ch, 8192)) {
                        let aPts = ts.nextAudioPts(chunk.audioData.numberOfFrames) / 1000;
                        if (aPts >= trimStartMs && aPts <= trimEndMs) {
                            await vid.pushAud(chunk.audioData);
                        }
                        else {
                            chunk.audioData.close();
                        }
                    }
                }
                if (this._onProgress)
                    this._onProgress(100);
            }
            log.info(this.logPrefix, "Flushing stream to Muxer...");
            const buffer = await vid.flush();
            if (isStream) {
                log.info(this.logPrefix, "Stream muxing complete.");
                return;
            }
            let mimeType = 'video/mp4';
            let ext = finalFilename.split('.').pop()?.toLowerCase();
            if (ext === 'webm')
                mimeType = 'video/webm';
            else if (ext === 'm4a')
                mimeType = 'audio/mp4';
            else if (ext === 'gif')
                mimeType = 'image/gif';
            // Native Browser Download Trigger
            const fileObj = new File([buffer], finalFilename, { type: mimeType });
            const url = URL.createObjectURL(fileObj);
            const a = document.createElement("a");
            a.href = url;
            a.download = finalFilename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000); // Safari fix
            return fileObj;
        }
        catch (err) {
            log.error(this.logPrefix, err);
            throw err;
        }
        finally {
            res.closeAll();
        }
    }
}
