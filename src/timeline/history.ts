export interface HistoryPatch {
    op: 'replace' | 'add' | 'remove';
    path: string;
    value?: unknown;
    oldValue?: unknown;
}

export interface HistoryEntry {
    id: number;
    label: string;
    timestamp: number;
    patches: HistoryPatch[];
}

export class HistoryManager {
    private _stack: HistoryEntry[] = [];
    private _cursor: number = -1;
    private _maxDepth: number;
    private _nextId: number = 0;
    private _groupStack: HistoryPatch[][] = [];
    private _groupLabels: string[] = [];

    constructor(maxDepth: number = 200) {
        this._maxDepth = maxDepth;
    }

    public push(label: string, patches: HistoryPatch[]): void {
        if (this._groupStack.length > 0) {
            this._groupStack[this._groupStack.length - 1].push(...patches);
            return;
        }
        this._cursor++;
        this._stack.length = this._cursor;
        this._stack.push({
            id: this._nextId++,
            label,
            timestamp: Date.now(),
            patches
        });
        if (this._stack.length > this._maxDepth) {
            this._stack.shift();
            this._cursor--;
        }
    }

    public beginGroup(label: string): void {
        this._groupStack.push([]);
        this._groupLabels.push(label);
    }

    public endGroup(): void {
        const patches = this._groupStack.pop();
        const label = this._groupLabels.pop() || 'group';
        if (patches && patches.length > 0) {
            this.push(label, patches);
        }
    }

    public undo<T extends Record<string, unknown>>(state: T): T {
        if (this._cursor < 0) return state;
        const entry = this._stack[this._cursor];
        const newState = structuredClone(state);
        for (let i = entry.patches.length - 1; i >= 0; i--) {
            const p = entry.patches[i];
            if (p.op === 'replace') {
                this._setPath(newState, p.path, p.oldValue);
            } else if (p.op === 'add') {
                this._removePath(newState, p.path);
            } else if (p.op === 'remove') {
                this._setPath(newState, p.path, p.oldValue);
            }
        }
        this._cursor--;
        return newState;
    }

    public redo<T extends Record<string, unknown>>(state: T): T {
        if (this._cursor >= this._stack.length - 1) return state;
        this._cursor++;
        const entry = this._stack[this._cursor];
        const newState = structuredClone(state);
        for (const p of entry.patches) {
            if (p.op === 'replace') {
                this._setPath(newState, p.path, p.value);
            } else if (p.op === 'add') {
                this._setPath(newState, p.path, p.value);
            } else if (p.op === 'remove') {
                this._removePath(newState, p.path);
            }
        }
        return newState;
    }

    public canUndo(): boolean { return this._cursor >= 0; }
    public canRedo(): boolean { return this._cursor < this._stack.length - 1; }

    public get undoLabel(): string { return this._cursor >= 0 ? this._stack[this._cursor].label : ''; }
    public get redoLabel(): string { return this._cursor < this._stack.length - 1 ? this._stack[this._cursor + 1].label : ''; }

    public get depth(): number { return this._stack.length; }

    public clear(): void { this._stack = []; this._cursor = -1; }

    public static diff(oldState: Record<string, unknown>, newState: Record<string, unknown>, basePath: string = ''): HistoryPatch[] {
        const patches: HistoryPatch[] = [];
        if (oldState === newState) return patches;
        if (typeof oldState !== typeof newState || oldState === null || newState === null ||
            typeof oldState !== 'object') {
            patches.push({ op: 'replace', path: basePath || '/', value: newState, oldValue: oldState });
            return patches;
        }
        if (Array.isArray(oldState) && Array.isArray(newState)) {
            if (oldState.length !== newState.length || JSON.stringify(oldState) !== JSON.stringify(newState)) {
                patches.push({ op: 'replace', path: basePath || '/', value: newState, oldValue: oldState });
            }
            return patches;
        }
        const allKeys = new Set([...Object.keys(oldState), ...Object.keys(newState)]);
        for (const key of allKeys) {
            const p = basePath ? basePath + '/' + key : '/' + key;
            if (!(key in oldState)) {
                patches.push({ op: 'add', path: p, value: newState[key] });
            } else if (!(key in newState)) {
                patches.push({ op: 'remove', path: p, oldValue: oldState[key] });
            } else if (JSON.stringify(oldState[key]) !== JSON.stringify(newState[key])) {
                patches.push(...HistoryManager.diff(oldState[key] as Record<string, unknown>, newState[key] as Record<string, unknown>, p));
            }
        }
        return patches;
    }

    private _setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
        const parts = path.split('/').filter(Boolean);
        let cur: Record<string, unknown> = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            if (cur[parts[i]] === undefined) cur[parts[i]] = {};
            cur = cur[parts[i]] as Record<string, unknown>;
        }
        if (parts.length > 0) cur[parts[parts.length - 1]] = value;
    }

    private _removePath(obj: Record<string, unknown>, path: string): void {
        const parts = path.split('/').filter(Boolean);
        let cur: Record<string, unknown> = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!cur[parts[i]]) return;
            cur = cur[parts[i]] as Record<string, unknown>;
        }
        if (parts.length > 0) delete cur[parts[parts.length - 1]];
    }
}
