import { AegisError, Logger, ResourceManager, TimestampSync, log } from './core';
import { Img, Aud } from './media';
import { Vid } from './codec';
import { Pillow, FFmpeg } from './api';
// Export everything as a unified API object attached to the window
const AegisForgeAPI = {
    AegisError,
    Logger,
    ResourceManager,
    TimestampSync,
    Img,
    Aud,
    Vid,
    log,
    Image: Pillow,
    ff: FFmpeg.run,
    convert: async (fileOrBlob, options = {}) => {
        const ff = await FFmpeg.run().loadFile(fileOrBlob);
        if (options.noVideo)
            ff.noVideo();
        if (options.vCodec)
            ff.videoCodec(options.vCodec);
        return await ff.save(options.output || "converted_output");
    }
};
if (typeof window !== "undefined") {
    window.AegisForge = AegisForgeAPI;
}
else if (typeof globalThis !== "undefined") {
    globalThis.AegisForge = AegisForgeAPI;
}
export default AegisForgeAPI;
