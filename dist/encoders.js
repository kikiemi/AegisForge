export class NativeEncoders {
    static async encodeBMP(canvas) {
        return new Promise((resolve) => {
            const ctx = canvas.getContext('2d');
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const w = canvas.width;
            const h = canvas.height;
            const data = imgData.data;
            // BMP Header: 14 bytes
            // DIB Header: 40 bytes
            const fileSize = 54 + (w * h * 4);
            const buf = new ArrayBuffer(fileSize);
            const view = new DataView(buf);
            // BM
            view.setUint16(0, 0x424D, false);
            view.setUint32(2, fileSize, true);
            view.setUint32(6, 0, true);
            view.setUint32(10, 54, true); // Offset to pixel data
            // DIB Header (BITMAPINFOHEADER)
            view.setUint32(14, 40, true); // DIB header size
            view.setUint32(18, w, true); // Width
            view.setUint32(22, h, true); // Height
            view.setUint16(26, 1, true); // Planes
            view.setUint16(28, 32, true); // Bits per pixel
            view.setUint32(30, 0, true); // Compression (0 = none)
            view.setUint32(34, w * h * 4, true); // Image size
            view.setUint32(38, 2835, true); // X pixels per meter
            view.setUint32(42, 2835, true); // Y pixels per meter
            view.setUint32(46, 0, true); // Colors in color table
            view.setUint32(50, 0, true); // Important color count
            // Pixel Data (Bottom-Up, BGRA)
            const p = new Uint8Array(buf, 54);
            let offset = 0;
            for (let y = h - 1; y >= 0; y--) { // Bottom up
                for (let x = 0; x < w; x++) {
                    const i = (y * w + x) * 4;
                    p[offset++] = data[i + 2]; // B
                    p[offset++] = data[i + 1]; // G
                    p[offset++] = data[i]; // R
                    p[offset++] = data[i + 3]; // A
                }
            }
            resolve(new Blob([buf], { type: "image/bmp" }));
        });
    }
    static async encodeTIFF(canvas) {
        return new Promise((resolve) => {
            const ctx = canvas.getContext('2d');
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const w = canvas.width;
            const h = canvas.height;
            const data = imgData.data;
            // Strip RGBA to RGB to simplify TIFF payload
            const rgbSize = w * h * 3;
            // Header (8) + IFD Directory (2 + 12*11 + 4 = 138) + Values (X/Y Res 16) + Pixels
            const ifdOffset = 8;
            const valOffset = ifdOffset + 138;
            const pixelOffset = valOffset + 24;
            const buf = new ArrayBuffer(pixelOffset + rgbSize);
            const v = new DataView(buf);
            // Header (Little Endian: II)
            v.setUint16(0, 0x4949, false); // II
            v.setUint16(2, 42, true); // Magic 42
            v.setUint32(4, ifdOffset, true); // IFD Offset
            // IFD
            v.setUint16(ifdOffset, 11, true); // 11 Directory Entries
            let p = ifdOffset + 2;
            const addTag = (tag, type, count, valOrOffset) => {
                v.setUint16(p, tag, true);
                v.setUint16(p + 2, type, true);
                v.setUint32(p + 4, count, true);
                if (type === 3 && count === 1) { // SHORT
                    v.setUint16(p + 8, valOrOffset, true);
                }
                else if (type === 3 && count === 3) {
                    v.setUint32(p + 8, valOrOffset, true);
                }
                else {
                    v.setUint32(p + 8, valOrOffset, true);
                }
                p += 12;
            };
            addTag(256, 4, 1, w); // ImageWidth
            addTag(257, 4, 1, h); // ImageLength
            addTag(258, 3, 3, valOffset + 16); // BitsPerSample [8,8,8] (written later)
            addTag(259, 3, 1, 1); // Compression (1 = Uncompressed)
            addTag(262, 3, 1, 2); // PhotometricInterpretation (2 = RGB)
            addTag(273, 4, 1, pixelOffset); // StripOffsets
            addTag(277, 3, 1, 3); // SamplesPerPixel
            addTag(278, 4, 1, h); // RowsPerStrip
            addTag(279, 4, 1, rgbSize); // StripByteCounts
            addTag(282, 5, 1, valOffset); // XResolution (RATIONAL)
            addTag(283, 5, 1, valOffset + 8); // YResolution (RATIONAL)
            v.setUint32(p, 0, true); // IFD end mark
            // Write X/Y Res (72 DPI)
            v.setUint32(valOffset, 72, true);
            v.setUint32(valOffset + 4, 1, true);
            v.setUint32(valOffset + 8, 72, true);
            v.setUint32(valOffset + 12, 1, true);
            // Write BitsPerSample
            v.setUint16(valOffset + 16, 8, true);
            v.setUint16(valOffset + 18, 8, true);
            v.setUint16(valOffset + 20, 8, true);
            // Write Pixels
            const px = new Uint8Array(buf, pixelOffset);
            let ptr = 0;
            for (let i = 0; i < w * h * 4; i += 4) {
                px[ptr++] = data[i]; // R
                px[ptr++] = data[i + 1]; // G
                px[ptr++] = data[i + 2]; // B
            }
            resolve(new Blob([buf], { type: "image/tiff" }));
        });
    }
    static async encodeGIF(canvas) {
        // Minimal uncompressed GIF static frame generator
        return new Promise((resolve) => {
            const ctx = canvas.getContext('2d');
            const w = canvas.width;
            const h = canvas.height;
            const imgData = ctx.getImageData(0, 0, w, h).data;
            // Extremely simplified dynamic palette generator (max 255 colors)
            const pal = [];
            const palMap = new Map();
            const indices = new Uint8Array(w * h);
            // Extract colors and quantize blindly for this minimal demo
            for (let i = 0; i < w * h; i++) {
                const r = imgData[i * 4];
                const g = imgData[i * 4 + 1];
                const b = imgData[i * 4 + 2];
                // Compress color space to 6x6x6
                const key = `${Math.round(r / 51) * 51},${Math.round(g / 51) * 51},${Math.round(b / 51) * 51}`;
                if (!palMap.has(key)) {
                    if (pal.length < 255) {
                        const vals = key.split(',').map(Number);
                        pal.push(vals);
                        palMap.set(key, pal.length - 1);
                    }
                }
                indices[i] = palMap.has(key) ? palMap.get(key) : 0;
            }
            // GIF Header + LSD
            const buf = [];
            const writeStr = (s) => { for (let i = 0; i < s.length; i++)
                buf.push(s.charCodeAt(i)); };
            const write16 = (v) => { buf.push(v & 0xFF); buf.push((v >> 8) & 0xFF); };
            writeStr("GIF89a");
            write16(w);
            write16(h);
            buf.push(0xF7); // Global Color Table Flag, 256 colors
            buf.push(0); // BG Color
            buf.push(0); // Aspect Ratio
            // Write Global Color Table
            for (let i = 0; i < 256; i++) {
                if (i < pal.length) {
                    buf.push(pal[i][0]);
                    buf.push(pal[i][1]);
                    buf.push(pal[i][2]);
                }
                else {
                    buf.push(0);
                    buf.push(0);
                    buf.push(0);
                }
            }
            // Image Descriptor
            buf.push(0x2C);
            write16(0);
            write16(0); // Left, Top
            write16(w);
            write16(h); // Width, Height
            buf.push(0); // Local flags
            // Image Data (Uncompressed LZW block trick)
            const minCodeSize = 8;
            buf.push(minCodeSize); // LZW Minimum Code Size
            const clearCode = 256;
            const endCode = 257;
            let bitBuf = 0;
            let bitCnt = 0;
            let byteBlock = [];
            const writeBits = (val, size) => {
                bitBuf |= (val << bitCnt);
                bitCnt += size;
                while (bitCnt >= 8) {
                    byteBlock.push(bitBuf & 0xFF);
                    bitBuf >>= 8;
                    bitCnt -= 8;
                    if (byteBlock.length === 255) {
                        buf.push(255);
                        buf.push(...byteBlock);
                        byteBlock = [];
                    }
                }
            };
            let idx = 0;
            while (idx < indices.length) {
                writeBits(clearCode, 9);
                let chunk = Math.min(254, indices.length - idx);
                for (let k = 0; k < chunk; k++) {
                    writeBits(indices[idx + k], 9);
                }
                idx += chunk;
            }
            writeBits(endCode, 9);
            if (bitCnt > 0) {
                byteBlock.push(bitBuf & 0xFF);
            }
            if (byteBlock.length > 0) {
                buf.push(byteBlock.length);
                buf.push(...byteBlock);
            }
            buf.push(0); // Block Terminator
            buf.push(0x3B); // Trailer
            const blob = new Blob([new Uint8Array(buf)], { type: "image/gif" });
            resolve(blob);
        });
    }
    static async encodeWAV(audioBuffer) {
        return new Promise((resolve) => {
            const numChannels = audioBuffer.numberOfChannels;
            const sampleRate = audioBuffer.sampleRate;
            const format = 1; // PCM
            const bitDepth = 16;
            const result = new Float32Array(audioBuffer.length * numChannels);
            for (let channel = 0; channel < numChannels; channel++) {
                const channelData = audioBuffer.getChannelData(channel);
                for (let i = 0; i < audioBuffer.length; i++) {
                    result[i * numChannels + channel] = channelData[i];
                }
            }
            const buffer = new ArrayBuffer(44 + result.length * 2);
            const view = new DataView(buffer);
            const writeString = (v, offset, string) => {
                for (let i = 0; i < string.length; i++) {
                    v.setUint8(offset + i, string.charCodeAt(i));
                }
            };
            writeString(view, 0, 'RIFF');
            view.setUint32(4, 36 + result.length * 2, true);
            writeString(view, 8, 'WAVE');
            writeString(view, 12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, format, true);
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * numChannels * 2, true);
            view.setUint16(32, numChannels * 2, true);
            view.setUint16(34, bitDepth, true);
            writeString(view, 36, 'data');
            view.setUint32(40, result.length * 2, true);
            let offset = 44;
            for (let i = 0; i < result.length; i++, offset += 2) {
                let s = Math.max(-1, Math.min(1, result[i]));
                view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            }
            resolve(new Blob([view], { type: 'audio/wav' }));
        });
    }
}
export class AnimatedGifEncoder {
    w;
    h;
    fps;
    frames;
    canvas;
    ctx;
    constructor(width, height, framerate = 30) {
        this.w = width;
        this.h = height;
        this.fps = framerate;
        this.frames = [];
        this.canvas = new OffscreenCanvas(width, height);
        this.ctx = this.canvas.getContext('2d');
    }
    addFrame(videoFrame, delayMs = Math.round(1000 / this.fps)) {
        // Direct synchronous pass. VideoFrame MUST NOT be awaited. 
        // Calling API MUST pass videoFrame natively and leave it open until this returns.
        try {
            this.ctx.drawImage(videoFrame, 0, 0, this.w, this.h);
            const data = this.ctx.getImageData(0, 0, this.w, this.h).data;
            // Force slice to detach the heap array from the volatile Canvas context buffer
            const pixels = new Uint8ClampedArray(data.buffer.slice(0));
            this.frames.push({ pixels, delayMs });
        }
        catch (err) {
            console.error("Failed to extract VideoFrame pixel matrix natively for GIF", err);
        }
    }
    async encode() {
        return new Promise((resolve) => {
            const pal = [];
            const palMap = new Map();
            const w = this.w;
            const h = this.h;
            // Build global palette (simplistic 4x4x4 extraction)
            for (let f of this.frames) {
                f.indices = new Uint8Array(w * h);
                for (let i = 0; i < w * h; i++) {
                    const r = f.pixels[i * 4];
                    const g = f.pixels[i * 4 + 1];
                    const b = f.pixels[i * 4 + 2];
                    const key = `${Math.round(r / 85) * 85},${Math.round(g / 85) * 85},${Math.round(b / 85) * 85}`;
                    if (!palMap.has(key)) {
                        if (pal.length < 255) {
                            pal.push(key.split(',').map(Number));
                            palMap.set(key, pal.length - 1);
                        }
                    }
                    f.indices[i] = palMap.has(key) ? palMap.get(key) : 0;
                }
            }
            const buf = [];
            const writeStr = (s) => { for (let i = 0; i < s.length; i++)
                buf.push(s.charCodeAt(i)); };
            const write16 = (v) => { buf.push(v & 0xFF); buf.push((v >> 8) & 0xFF); };
            writeStr("GIF89a");
            write16(w);
            write16(h);
            buf.push(0xF7);
            buf.push(0);
            buf.push(0); // GCT 256
            for (let i = 0; i < 256; i++) {
                if (i < pal.length) {
                    buf.push(pal[i][0]);
                    buf.push(pal[i][1]);
                    buf.push(pal[i][2]);
                }
                else {
                    buf.push(0);
                    buf.push(0);
                    buf.push(0);
                }
            }
            // NETSCAPE2.0 for Looping
            buf.push(0x21);
            buf.push(0xFF);
            buf.push(11);
            writeStr("NETSCAPE2.0");
            buf.push(3);
            buf.push(1);
            write16(0);
            buf.push(0);
            for (let f of this.frames) {
                buf.push(0x21);
                buf.push(0xF9);
                buf.push(4); // Graphic Control
                buf.push(0x00); // flags
                write16(Math.round(f.delayMs / 10)); // delay in 100ths of sec
                buf.push(0); // transparent index
                buf.push(0); // terminator
                buf.push(0x2C);
                write16(0);
                write16(0);
                write16(w);
                write16(h);
                buf.push(0); // img desc
                buf.push(8); // LZW min
                let bitBuf = 0, bitCnt = 0, byteBlock = [];
                const writeBits = (val, size) => {
                    bitBuf |= (val << bitCnt);
                    bitCnt += size;
                    while (bitCnt >= 8) {
                        byteBlock.push(bitBuf & 0xFF);
                        bitBuf >>= 8;
                        bitCnt -= 8;
                        if (byteBlock.length === 255) {
                            buf.push(255);
                            buf.push(...byteBlock);
                            byteBlock = [];
                        }
                    }
                };
                const clearCode = 256;
                const endCode = 257;
                writeBits(clearCode, 9); // always start LZW block with clear code
                let dict = new Map();
                for (let i = 0; i < 256; i++)
                    dict.set(String.fromCharCode(i), i);
                let currentStr = String.fromCharCode(f.indices[0]);
                let nextCode = 258;
                let codeSize = 9;
                for (let i = 1; i < f.indices.length; i++) {
                    let k = String.fromCharCode(f.indices[i]);
                    let combined = currentStr + k;
                    if (dict.has(combined)) {
                        currentStr = combined;
                    }
                    else {
                        writeBits(dict.get(currentStr), codeSize);
                        if (nextCode < 4096) {
                            dict.set(combined, nextCode++);
                            if (nextCode === (1 << codeSize) && codeSize < 12) {
                                codeSize++;
                            }
                        }
                        else {
                            // Max dictionary size reached, emit clear code and reset
                            writeBits(clearCode, codeSize);
                            dict.clear();
                            for (let j = 0; j < 256; j++)
                                dict.set(String.fromCharCode(j), j);
                            nextCode = 258;
                            codeSize = 9;
                        }
                        currentStr = k;
                    }
                }
                writeBits(dict.get(currentStr), codeSize);
                writeBits(endCode, codeSize); // end code
                if (bitCnt > 0)
                    byteBlock.push(bitBuf & 0xFF);
                if (byteBlock.length > 0) {
                    buf.push(byteBlock.length);
                    buf.push(...byteBlock);
                }
                buf.push(0);
            }
            buf.push(0x3B);
            resolve(new Blob([new Uint8Array(buf)], { type: "image/gif" }));
        });
    }
}
