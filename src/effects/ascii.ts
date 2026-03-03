import { GL } from '../gl';

export interface AsciiOpts {
    fontSize?: number;
    color?: [number, number, number];
    charset?: string;
    invert?: boolean;
}

export class AsciiEngine {
    private w: number;
    private h: number;
    private cfg: Required<AsciiOpts>;

    constructor(width: number, height: number, opts: AsciiOpts = {}) {
        this.w = width;
        this.h = height;
        this.cfg = {
            fontSize: opts.fontSize || 8,
            color: opts.color || [1, 1, 1],
            charset: opts.charset || " .:-=+*#%@",
            invert: opts.invert ?? false
        };
    }

    public async apply(source: ImageBitmap | OffscreenCanvas): Promise<ImageBitmap> {
        const { fontSize, color, charset, invert } = this.cfg;
        const W = this.w, H = this.h;

        const scratch = new OffscreenCanvas(W, H);
        const sCtx = scratch.getContext('2d', { willReadFrequently: true })!;
        sCtx.drawImage(source as CanvasImageSource, 0, 0, W, H);
        const imgData = sCtx.getImageData(0, 0, W, H);
        const data = imgData.data;

        const out = new OffscreenCanvas(W, H);
        const ctx = out.getContext('2d')!;
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, W, H);

        const r = Math.round(color[0] * 255);
        const g = Math.round(color[1] * 255);
        const b = Math.round(color[2] * 255);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.font = `${fontSize}px monospace`;
        ctx.textBaseline = 'top';

        const cols = Math.floor(W / fontSize);
        const rows = Math.floor(H / fontSize);

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const px = col * fontSize + (fontSize >> 1);
                const py = row * fontSize + (fontSize >> 1);
                const idx = (Math.min(py, H - 1) * W + Math.min(px, W - 1)) * 4;

                const brightness = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) / 255;
                const val = invert ? 1 - brightness : brightness;
                const charIdx = Math.min(Math.floor(val * charset.length), charset.length - 1);

                ctx.fillText(charset[charIdx], col * fontSize, row * fontSize);
            }
        }

        return createImageBitmap(out);
    }
}
