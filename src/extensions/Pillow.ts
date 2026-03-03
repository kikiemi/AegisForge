import { Img } from '../media';
import { log, AegisError } from '../core';

export class Pillow {
    public img: Img;

    constructor(imgInstance: Img) {
        this.img = imgInstance;
    }

    public static async open(src: string | Blob | File): Promise<Pillow> {
        return new Pillow(await Img.load(src));
    }

    public filter(filterName: string, value: number): Pillow {
        const opt: Record<string, number> = {};
        opt[filterName.toLowerCase()] = value;
        this.img.color(opt);
        return this;
    }

    public resize(width: number, height: number, fit: 'contain' | 'cover' | 'stretch' = 'contain'): Pillow {
        this.img.resize(width, height, fit);
        return this;
    }

    public chromaKey(targetColor: [number, number, number] = [0, 255, 0], tolerance: number = 50): Pillow {
        this.img.chromaKey(targetColor, tolerance);
        return this;
    }

    public text(txt: string, x: number, y: number, options: { font?: string; color?: string; size?: number } = {}): Pillow {
        this.img.text(txt, x, y, options);
        return this;
    }

    public opacity(v: number): Pillow {
        const ctx = this.c.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (ctx) {
            const dat = ctx.getImageData(0, 0, this.c.width, this.c.height);
            for (let i = 3; i < dat.data.length; i += 4) dat.data[i] = dat.data[i] * v;
            ctx.putImageData(dat, 0, 0);
        }
        return this;
    }

    public steganography(text: string): Pillow {
        const ctx = this.c.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (!ctx) return this;
        const imgData = ctx.getImageData(0, 0, this.c.width, this.c.height);
        const data = imgData.data;

        const bin = text.split('').map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join('') + '00000000';
        let p = 0;

        for (let i = 0; i < data.length && p < bin.length; i += 4) {
            const bit = parseInt(bin[p], 10);
            data[i] = (data[i] & ~1) | bit;
            p++;
        }

        ctx.putImageData(imgData, 0, 0);
        return this;
    }

    public async save(filename: string = "output.png", quality: number = 0.92): Promise<File> {
        let finalFilename = filename;
        const validImageExts = ['png', 'jpg', 'jpeg', 'webp'];
        const currentExt = finalFilename.split('.').pop()?.toLowerCase() || "";

        if (!finalFilename.includes('.') || !validImageExts.includes(currentExt)) {
            finalFilename += ".png";
        }

        let mimeType = "image/png";
        const ext = finalFilename.split('.').pop()?.toLowerCase();
        if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
        else if (ext === "webp") mimeType = "image/webp";

        return new Promise((resolve, reject) => {
            try {
                const canvas = this.img.c;
                if (!canvas) throw new Error("Canvas is null");

                const blobPromise = (canvas instanceof OffscreenCanvas)
                    ? canvas.convertToBlob({ type: mimeType, quality: quality })
                    : new Promise<Blob>((res, rej) => (canvas as HTMLCanvasElement).toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), mimeType, quality));

                blobPromise.then((blob: Blob) => {
                    const fileObj = new File([blob], finalFilename, { type: mimeType });
                    const url = URL.createObjectURL(fileObj);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = finalFilename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    resolve(fileObj);
                }).catch(reject);
            } catch (err: unknown) {
                reject(new AegisError("Failed to save Pillow Image locally.", err));
            }
        });
    }

    public get c(): OffscreenCanvas | HTMLCanvasElement {
        if (!this.img.c) throw new AegisError('Pillow canvas already closed');
        return this.img.c;
    }

    public close(): void {
        this.img.close();
    }
}
