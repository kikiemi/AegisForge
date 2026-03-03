export interface Sprite {
    id: string;
    source: TexImageSource | null;
    x: number; y: number;
    w: number; h: number;
    rotation: number;
    scaleX: number; scaleY: number;
    opacity: number;
    locked: boolean;
    visible: boolean;
}

export type SpriteEvent = 'select' | 'deselect' | 'move' | 'scale' | 'rotate' | 'change';

export interface InteractiveCanvasOpts {
    width?: number;
    height?: number;
    handleSize?: number;
    handleColor?: string;
    guideColor?: string;
    snapThreshold?: number;
    onChange?: (sprite: Sprite, event: SpriteEvent) => void;
}

const enum HitZone { None, Body, TL, TR, BL, BR, RotateHandle }

export class InteractiveCanvas {
    public canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    public sprites: Sprite[] = [];
    public selected: Sprite | null = null;
    private _dragging = false;
    private _zone: HitZone = HitZone.None;
    private _startX = 0; _startY = 0;
    private _origX = 0; _origY = 0;
    private _origW = 0; _origH = 0;
    private _origR = 0;
    private _hSize: number;
    private _hColor: string;
    private _gColor: string;
    private _snap: number;
    private _onChange: ((s: Sprite, e: SpriteEvent) => void) | null;
    private _pinchDist = 0;
    private _pinchAngle = 0;
    private _rafId = 0;

    constructor(container: HTMLElement, opts?: InteractiveCanvasOpts) {
        const w = opts?.width ?? 1280, h = opts?.height ?? 720;
        this._hSize = opts?.handleSize ?? 8;
        this._hColor = opts?.handleColor ?? '#00aaff';
        this._gColor = opts?.guideColor ?? 'rgba(0,170,255,0.4)';
        this._snap = opts?.snapThreshold ?? 5;
        this._onChange = opts?.onChange ?? null;

        this.canvas = document.createElement('canvas');
        this.canvas.width = w; this.canvas.height = h;
        this.canvas.style.cssText = 'touch-action:none;user-select:none;display:block;max-width:100%;cursor:default;';
        this.ctx = this.canvas.getContext('2d')!;
        container.appendChild(this.canvas);

        this.canvas.addEventListener('pointerdown', this._onDown);
        this.canvas.addEventListener('pointermove', this._onMove);
        this.canvas.addEventListener('pointerup', this._onUp);
        this.canvas.addEventListener('pointercancel', this._onUp);
        this.canvas.addEventListener('touchstart', this._onTouch, { passive: false });
        this.canvas.addEventListener('touchmove', this._onTouch, { passive: false });
        this.canvas.addEventListener('touchend', this._onTouchEnd);

        this._loop();
    }

    public addSprite(opts: Partial<Sprite> & { source: TexImageSource }): Sprite {
        const s: Sprite = {
            id: opts.id ?? Math.random().toString(36).slice(2, 9),
            source: opts.source,
            x: opts.x ?? 0, y: opts.y ?? 0,
            w: opts.w ?? 200, h: opts.h ?? 200,
            rotation: opts.rotation ?? 0,
            scaleX: opts.scaleX ?? 1, scaleY: opts.scaleY ?? 1,
            opacity: opts.opacity ?? 1,
            locked: opts.locked ?? false,
            visible: opts.visible ?? true
        };
        this.sprites.push(s);
        return s;
    }

    public removeSprite(id: string): void {
        this.sprites = this.sprites.filter(s => s.id !== id);
        if (this.selected?.id === id) this.selected = null;
    }

    public dispose(): void {
        cancelAnimationFrame(this._rafId);
        this.canvas.removeEventListener('pointerdown', this._onDown);
        this.canvas.removeEventListener('pointermove', this._onMove);
        this.canvas.removeEventListener('pointerup', this._onUp);
        this.canvas.removeEventListener('pointercancel', this._onUp);
        this.canvas.removeEventListener('touchstart', this._onTouch);
        this.canvas.removeEventListener('touchmove', this._onTouch);
        this.canvas.removeEventListener('touchend', this._onTouchEnd);
        this.canvas.remove();
    }

    private _loop = (): void => {
        this._draw();
        this._rafId = requestAnimationFrame(this._loop);
    };

    private _draw(): void {
        const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
        c.clearRect(0, 0, W, H);
        c.fillStyle = '#111';
        c.fillRect(0, 0, W, H);

        for (const s of this.sprites) {
            if (!s.visible || !s.source) continue;
            c.save();
            c.globalAlpha = s.opacity;
            c.translate(s.x + s.w * s.scaleX / 2, s.y + s.h * s.scaleY / 2);
            c.rotate(s.rotation);
            c.scale(s.scaleX, s.scaleY);
            c.drawImage(s.source as CanvasImageSource, -s.w / 2, -s.h / 2, s.w, s.h);
            c.restore();
        }

        if (this.selected && !this.selected.locked) this._drawHandles(this.selected);
    }

    private _drawHandles(s: Sprite): void {
        const c = this.ctx, hw = s.w * s.scaleX / 2, hh = s.h * s.scaleY / 2;
        c.save();
        c.translate(s.x + hw, s.y + hh);
        c.rotate(s.rotation);
        c.strokeStyle = this._hColor; c.lineWidth = 1.5;
        c.setLineDash([4, 3]);
        c.strokeRect(-hw, -hh, hw * 2, hh * 2);
        c.setLineDash([]);

        const hs = this._hSize, corners: [number, number][] = [
            [-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]
        ];
        c.fillStyle = '#fff'; c.strokeStyle = this._hColor; c.lineWidth = 2;
        for (const [cx, cy] of corners) {
            c.beginPath(); c.arc(cx, cy, hs, 0, Math.PI * 2); c.fill(); c.stroke();
        }

        c.beginPath();
        c.moveTo(0, -hh); c.lineTo(0, -hh - 25);
        c.strokeStyle = this._gColor; c.lineWidth = 1.5; c.stroke();
        c.fillStyle = this._hColor;
        c.beginPath(); c.arc(0, -hh - 25, hs, 0, Math.PI * 2); c.fill();
        c.restore();
    }

    private _toLocal(e: PointerEvent | Touch): [number, number] {
        const r = this.canvas.getBoundingClientRect();
        return [
            (e.clientX - r.left) * (this.canvas.width / r.width),
            (e.clientY - r.top) * (this.canvas.height / r.height)
        ];
    }

    private _hitTest(mx: number, my: number): [Sprite | null, HitZone] {
        for (let i = this.sprites.length - 1; i >= 0; i--) {
            const s = this.sprites[i];
            if (!s.visible || s.locked) continue;
            const hw = s.w * s.scaleX / 2, hh = s.h * s.scaleY / 2;
            const cx = s.x + hw, cy = s.y + hh;
            const cos = Math.cos(-s.rotation), sin = Math.sin(-s.rotation);
            const dx = mx - cx, dy = my - cy;
            const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;

            const rh = this._hSize + 4;
            if (Math.abs(lx) < rh && Math.abs(ly - (-hh - 25)) < rh) return [s, HitZone.RotateHandle];
            if (Math.abs(lx - (-hw)) < rh && Math.abs(ly - (-hh)) < rh) return [s, HitZone.TL];
            if (Math.abs(lx - hw) < rh && Math.abs(ly - (-hh)) < rh) return [s, HitZone.TR];
            if (Math.abs(lx - (-hw)) < rh && Math.abs(ly - hh) < rh) return [s, HitZone.BL];
            if (Math.abs(lx - hw) < rh && Math.abs(ly - hh) < rh) return [s, HitZone.BR];
            if (lx >= -hw && lx <= hw && ly >= -hh && ly <= hh) return [s, HitZone.Body];
        }
        return [null, HitZone.None];
    }

    private _onDown = (e: PointerEvent): void => {
        const [mx, my] = this._toLocal(e);
        const [hit, zone] = this._hitTest(mx, my);
        if (hit) {
            if (this.selected !== hit) {
                if (this.selected) this._onChange?.(this.selected, 'deselect');
                this.selected = hit;
                this._onChange?.(hit, 'select');
            }
            this._dragging = true;
            this._zone = zone;
            this._startX = mx; this._startY = my;
            this._origX = hit.x; this._origY = hit.y;
            this._origW = hit.w * hit.scaleX; this._origH = hit.h * hit.scaleY;
            this._origR = hit.rotation;
            this.canvas.setPointerCapture(e.pointerId);
        } else {
            if (this.selected) this._onChange?.(this.selected, 'deselect');
            this.selected = null;
        }
    };

    private _onMove = (e: PointerEvent): void => {
        if (!this._dragging || !this.selected) {
            const [mx, my] = this._toLocal(e);
            const [, z] = this._hitTest(mx, my);
            this.canvas.style.cursor = z === HitZone.Body ? 'move'
                : z === HitZone.RotateHandle ? 'crosshair'
                    : z !== HitZone.None ? 'nwse-resize' : 'default';
            return;
        }
        const [mx, my] = this._toLocal(e);
        const s = this.selected;
        const hw = this._origW / 2, hh = this._origH / 2;
        const cx = this._origX + hw, cy = this._origY + hh;

        if (this._zone === HitZone.Body) {
            s.x = this._origX + (mx - this._startX);
            s.y = this._origY + (my - this._startY);
            const snap = this._snap, cw = this.canvas.width, ch = this.canvas.height;
            const scx = s.x + s.w * s.scaleX / 2, scy = s.y + s.h * s.scaleY / 2;
            if (Math.abs(scx - cw / 2) < snap) s.x = cw / 2 - s.w * s.scaleX / 2;
            if (Math.abs(scy - ch / 2) < snap) s.y = ch / 2 - s.h * s.scaleY / 2;
            this._onChange?.(s, 'move');
        } else if (this._zone === HitZone.RotateHandle) {
            s.rotation = Math.atan2(my - cy, mx - cx) + Math.PI / 2;
            this._onChange?.(s, 'rotate');
        } else {
            const cos = Math.cos(-s.rotation), sin = Math.sin(-s.rotation);
            const dx = mx - cx, dy = my - cy;
            const lx = Math.abs(dx * cos - dy * sin), ly = Math.abs(dx * sin + dy * cos);
            const newW = Math.max(20, lx * 2), newH = Math.max(20, ly * 2);
            s.scaleX = newW / s.w; s.scaleY = newH / s.h;
            s.x = cx - newW / 2; s.y = cy - newH / 2;
            this._onChange?.(s, 'scale');
        }
        this._onChange?.(s, 'change');
    };

    private _onUp = (_: PointerEvent): void => {
        this._dragging = false; this._zone = HitZone.None;
    };

    private _onTouch = (e: TouchEvent): void => {
        e.preventDefault();
        if (e.touches.length === 2 && this.selected) {
            const [ax, ay] = this._toLocal(e.touches[0]);
            const [bx, by] = this._toLocal(e.touches[1]);
            const dist = Math.hypot(bx - ax, by - ay);
            const angle = Math.atan2(by - ay, bx - ax);
            if (this._pinchDist > 0) {
                const ratio = dist / this._pinchDist;
                this.selected.scaleX *= ratio; this.selected.scaleY *= ratio;
                this.selected.rotation += angle - this._pinchAngle;
                this._onChange?.(this.selected, 'change');
            }
            this._pinchDist = dist; this._pinchAngle = angle;
        }
    };

    private _onTouchEnd = (): void => { this._pinchDist = 0; };
}
