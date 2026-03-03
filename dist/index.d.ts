import { AegisError, Logger, ResourceManager, TimestampSync } from './core';
import { Img, Aud } from './media';
import { Vid } from './codec';
import { Pillow, FFmpeg } from './api';
declare const AegisForgeAPI: {
    AegisError: typeof AegisError;
    Logger: typeof Logger;
    ResourceManager: typeof ResourceManager;
    TimestampSync: typeof TimestampSync;
    Img: typeof Img;
    Aud: typeof Aud;
    Vid: typeof Vid;
    log: Logger;
    Image: typeof Pillow;
    ff: typeof FFmpeg.run;
    convert: (fileOrBlob: File | Blob, options?: {
        noVideo?: boolean;
        output?: string;
        vCodec?: string;
    }) => Promise<void | File>;
};
export default AegisForgeAPI;
