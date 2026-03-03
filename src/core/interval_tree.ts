export interface Interval {
    lo: number;
    hi: number;
    id: string;
    data?: unknown;
}

interface ITNode {
    interval: Interval;
    maxHi: number;
    left: ITNode | null;
    right: ITNode | null;
    height: number;
}

export class IntervalTree {
    private root: ITNode | null = null;
    private _size: number = 0;

    public get size(): number { return this._size; }

    public insert(interval: Interval): void {
        this.root = this._insert(this.root, interval);
        this._size++;
    }

    public remove(id: string): boolean {
        const [newRoot, removed] = this._remove(this.root, id);
        this.root = newRoot;
        if (removed) this._size--;
        return removed;
    }

    public queryPoint(point: number): Interval[] {
        const result: Interval[] = [];
        this._queryPoint(this.root, point, result);
        return result;
    }

    public queryRange(lo: number, hi: number): Interval[] {
        const result: Interval[] = [];
        this._queryRange(this.root, lo, hi, result);
        return result;
    }

    public clear(): void {
        this.root = null;
        this._size = 0;
    }

    public buildFromClips(clips: { id: string; inPoint: number; outPoint: number;[k: string]: unknown }[]): void {
        this.clear();
        const sorted = clips.slice().sort((a, b) => a.inPoint - b.inPoint);
        this.root = this._buildBalanced(sorted, 0, sorted.length - 1);
        this._size = sorted.length;
    }

    private _buildBalanced(clips: { id: string; inPoint: number; outPoint: number;[k: string]: unknown }[], lo: number, hi: number): ITNode | null {
        if (lo > hi) return null;
        const mid = (lo + hi) >> 1;
        const c = clips[mid];
        const node: ITNode = {
            interval: { lo: c.inPoint, hi: c.outPoint, id: c.id, data: c },
            maxHi: c.outPoint,
            left: null, right: null, height: 1
        };
        node.left = this._buildBalanced(clips, lo, mid - 1);
        node.right = this._buildBalanced(clips, mid + 1, hi);
        this._updateNode(node);
        return node;
    }

    private _insert(node: ITNode | null, interval: Interval): ITNode {
        if (!node) return { interval, maxHi: interval.hi, left: null, right: null, height: 1 };
        if (interval.lo < node.interval.lo) {
            node.left = this._insert(node.left, interval);
        } else {
            node.right = this._insert(node.right, interval);
        }
        this._updateNode(node);
        return this._balance(node);
    }

    private _remove(node: ITNode | null, id: string): [ITNode | null, boolean] {
        if (!node) return [null, false];
        if (node.interval.id === id) {
            if (!node.left) return [node.right, true];
            if (!node.right) return [node.left, true];
            let successor = node.right;
            while (successor.left) successor = successor.left;
            node.interval = successor.interval;
            const [newRight, _] = this._remove(node.right, successor.interval.id);
            node.right = newRight;
            this._updateNode(node);
            return [this._balance(node), true];
        }
        let removed = false;
        const [newLeft, removedLeft] = this._remove(node.left, id);
        if (removedLeft) {
            node.left = newLeft;
            removed = true;
        } else {
            const [newRight, removedRight] = this._remove(node.right, id);
            node.right = newRight;
            removed = removedRight;
        }
        if (removed) {
            this._updateNode(node);
            return [this._balance(node), true];
        }
        return [node, false];
    }

    private _queryPoint(node: ITNode | null, point: number, result: Interval[]): void {
        if (!node) return;
        if (point > node.maxHi) return;
        this._queryPoint(node.left, point, result);
        if (point >= node.interval.lo && point < node.interval.hi) {
            result.push(node.interval);
        }
        if (point >= node.interval.lo) {
            this._queryPoint(node.right, point, result);
        }
    }

    private _queryRange(node: ITNode | null, lo: number, hi: number, result: Interval[]): void {
        if (!node) return;
        if (lo > node.maxHi) return;
        this._queryRange(node.left, lo, hi, result);
        if (node.interval.lo < hi && node.interval.hi > lo) {
            result.push(node.interval);
        }
        if (hi > node.interval.lo) {
            this._queryRange(node.right, lo, hi, result);
        }
    }

    private _height(node: ITNode | null): number { return node ? node.height : 0; }

    private _updateNode(node: ITNode): void {
        node.height = 1 + Math.max(this._height(node.left), this._height(node.right));
        node.maxHi = node.interval.hi;
        if (node.left && node.left.maxHi > node.maxHi) node.maxHi = node.left.maxHi;
        if (node.right && node.right.maxHi > node.maxHi) node.maxHi = node.right.maxHi;
    }

    private _balance(node: ITNode): ITNode {
        const bf = this._height(node.left) - this._height(node.right);
        if (bf > 1) {
            if (node.left && this._height(node.left.left) < this._height(node.left.right)) {
                node.left = this._rotateLeft(node.left);
            }
            return this._rotateRight(node);
        }
        if (bf < -1) {
            if (node.right && this._height(node.right.right) < this._height(node.right.left)) {
                node.right = this._rotateRight(node.right);
            }
            return this._rotateLeft(node);
        }
        return node;
    }

    private _rotateRight(node: ITNode): ITNode {
        const x = node.left!;
        node.left = x.right;
        x.right = node;
        this._updateNode(node);
        this._updateNode(x);
        return x;
    }

    private _rotateLeft(node: ITNode): ITNode {
        const x = node.right!;
        node.right = x.left;
        x.left = node;
        this._updateNode(node);
        this._updateNode(x);
        return x;
    }
}
