import { log } from '../core';

export interface DOMClipOpts {
    html: string;
    width: number;
    height: number;
    css?: string;
}

export class DOMRenderer {
    private w: number;
    private h: number;

    constructor(width: number, height: number) {
        this.w = width;
        this.h = height;
    }

    public async render(opts: DOMClipOpts): Promise<ImageBitmap> {
        const { html, width, height, css } = opts;

        const safeCss = css ? css.replace(/<\/?style[^>]*>/gi, '').replace(/<\/foreignObject/gi, '') : '';
        const styleBlock = safeCss ? `<style>${safeCss}</style>` : '';

        const safeHtml = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
            .replace(/<\/foreignObject/gi, '');

        const svgString = `
            <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
                <foreignObject width="100%" height="100%">
                    <div xmlns="http://www.w3.org/1999/xhtml"
                         style="width:${width}px;height:${height}px;overflow:hidden;">
                        ${styleBlock}
                        ${safeHtml}
                    </div>
                </foreignObject>
            </svg>
        `.trim();

        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        try {
            const response = await fetch(url);
            const svgBlob = await response.blob();
            const bitmap = await createImageBitmap(svgBlob, {
                resizeWidth: this.w,
                resizeHeight: this.h
            });
            return bitmap;
        } catch (e) {
            log.warn('[DOMRenderer] SVG foreignObject render failed, using fallback', e);
            return this._fallback(html, width, height);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    private async _fallback(html: string, width: number, height: number): Promise<ImageBitmap> {
        const canvas = new OffscreenCanvas(this.w, this.h);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, this.w, this.h);
        ctx.fillStyle = 'white';
        ctx.font = '16px sans-serif';
        ctx.textBaseline = 'top';

        const text = html.replace(/<[^>]*>/g, '').trim();
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i].trim(), 10, 10 + i * 20);
        }
        return createImageBitmap(canvas);
    }

    public async overlay(
        source: ImageBitmap,
        domOpts: DOMClipOpts,
        x: number = 0,
        y: number = 0,
        opacity: number = 1
    ): Promise<ImageBitmap> {
        const domBitmap = await this.render(domOpts);
        const canvas = new OffscreenCanvas(source.width, source.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(source, 0, 0);
        ctx.globalAlpha = opacity;
        ctx.drawImage(domBitmap, x, y, domOpts.width, domOpts.height);
        domBitmap.close();
        return createImageBitmap(canvas);
    }
}
