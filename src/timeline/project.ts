import type { TimelineState } from './magnetic';
import { HistoryManager } from './history';
import { log } from '../core';

export interface AegisProjectFile {
    version: number;
    name: string;
    created: number;
    modified: number;
    timeline: TimelineState;
    assets: AssetRef[];
    settings: ProjectSettings;
}

export interface AssetRef {
    id: string;
    name: string;
    type: 'video' | 'audio' | 'image' | 'subtitle' | 'lottie';
    size: number;
    duration?: number;
    width?: number;
    height?: number;
    opfsPath?: string;
    blobUrl?: string;
}

export interface ProjectSettings {
    exportWidth: number;
    exportHeight: number;
    exportFPS: number;
    exportCodec: string;
    exportBitrate: number;
    audioSampleRate: number;
    audioChannels: number;
    proxyEnabled: boolean;
    proxyScale: number;
    autoSaveInterval: number;
}

const DEFAULT_SETTINGS: ProjectSettings = {
    exportWidth: 1920,
    exportHeight: 1080,
    exportFPS: 30,
    exportCodec: 'avc1.42E01E',
    exportBitrate: 8_000_000,
    audioSampleRate: 48000,
    audioChannels: 2,
    proxyEnabled: false,
    proxyScale: 0.5,
    autoSaveInterval: 30000
};

export class ProjectManager {
    public project: AegisProjectFile;
    public history: HistoryManager;
    private _autoSaveTimer: number | null = null;
    private _opfsRoot: FileSystemDirectoryHandle | null = null;

    constructor(name: string = 'Untitled') {
        this.project = {
            version: 2,
            name,
            created: Date.now(),
            modified: Date.now(),
            timeline: {
                tracks: [], duration: 0,
                fps: 30, width: 1920, height: 1080,
                sampleRate: 48000, gridSnap: 1 / 30
            },
            assets: [],
            settings: { ...DEFAULT_SETTINGS }
        };
        this.history = new HistoryManager(200);
    }

    public async initOPFS(): Promise<void> {
        if (typeof navigator !== 'undefined' && 'storage' in navigator) {
            try {
                this._opfsRoot = await navigator.storage.getDirectory();
            } catch (e) { log.warn('[Project] OPFS unavailable:', e); }
        }
    }

    public addAsset(asset: Omit<AssetRef, 'id'>): string {
        const id = 'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        this.project.assets.push({ ...asset, id });
        this.project.modified = Date.now();
        return id;
    }

    public removeAsset(assetId: string): void {
        this.project.assets = this.project.assets.filter(a => a.id !== assetId);
        this.project.modified = Date.now();
    }

    public getAsset(assetId: string): AssetRef | undefined {
        return this.project.assets.find(a => a.id === assetId);
    }

    public serialize(): string {
        this.project.modified = Date.now();
        const cleaned = structuredClone(this.project);
        for (const asset of (cleaned.assets || [])) {
            if ('blobUrl' in asset) delete (asset as unknown as Record<string, unknown>).blobUrl;
        }
        return JSON.stringify(cleaned);
    }

    public async deserialize(blob: Blob): Promise<void> {
        const text = await blob.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            throw new Error('[ProjectManager] Invalid JSON in project file: ' + (e instanceof Error ? e.message : String(e)));
        }
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('[ProjectManager] Project data must be an object');
        }
        this.project = parsed as AegisProjectFile;
        this.history.clear();
    }

    public async exportFile(): Promise<Blob> {
        const json = JSON.stringify(this.project, null, 0);
        const encoder = new TextEncoder();
        const data = encoder.encode(json);
        const header = new Uint8Array(16);
        const view = new DataView(header.buffer);
        view.setUint32(0, 0x41454749);
        view.setUint32(4, this.project.version);
        view.setUint32(8, data.length);
        view.setUint32(12, 0);
        const result = new Uint8Array(header.length + data.length);
        result.set(header);
        result.set(data, header.length);
        return new Blob([result], { type: 'application/x-aegis' });
    }

    public importFile(text: string): void {
        let parsed: any;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            throw new Error('[ProjectManager] Invalid JSON in project file');
        }
        if (!parsed || typeof parsed !== 'object') {
            throw new Error('[ProjectManager] Project data must be an object');
        }
        if (parsed.magic && parsed.magic !== 'AEGIS') {
            throw new Error(`[ProjectManager] Unknown project format: ${parsed.magic}`);
        }
        if (parsed.version && typeof parsed.version === 'number' && parsed.version > 5) {
            throw new Error(`[ProjectManager] Unsupported project version ${parsed.version} (max: 5)`);
        }
        if (!parsed.assets || !Array.isArray(parsed.assets)) {
            parsed.assets = [];
        }
        if (!parsed.timeline || typeof parsed.timeline !== 'object') {
            parsed.timeline = { duration: 0, tracks: [] };
        }
        this.project = parsed;
        this.history.clear();
    }

    public async autoSave(): Promise<void> {
        if (!this._opfsRoot) return;
        try {
            const name = 'aegis_autosave_' + this.project.name.replace(/[^a-zA-Z0-9]/g, '_') + '.json';
            const handle = await this._opfsRoot.getFileHandle(name, { create: true });
            const writable = await handle.createWritable();
            const data = JSON.stringify(this.project);
            await writable.write(data);
            await writable.close();
        } catch (e) { log.error('[Project] Auto-save failed', e as Error); }
    }

    public startAutoSave(): void {
        this.stopAutoSave();
        const interval = this.project.settings.autoSaveInterval;
        if (interval > 0) {
            this._autoSaveTimer = setInterval(() => this.autoSave(), interval) as unknown as number;
        }
    }

    public stopAutoSave(): void {
        if (this._autoSaveTimer !== null) {
            clearInterval(this._autoSaveTimer);
            this._autoSaveTimer = null;
        }
    }

    public async loadAutoSave(): Promise<boolean> {
        if (!this._opfsRoot) return false;
        try {
            const name = 'aegis_autosave_' + this.project.name.replace(/[^a-zA-Z0-9]/g, '_') + '.json';
            const handle = await this._opfsRoot.getFileHandle(name);
            const file = await handle.getFile();
            const text = await file.text();
            this.project = JSON.parse(text);
            return true;
        } catch (_) { return false; }
    }

    public snapshot(): TimelineState {
        return structuredClone(this.project.timeline);
    }

    public commitChange(label: string, oldTimeline: TimelineState): void {
        const patches = HistoryManager.diff(oldTimeline, this.project.timeline);
        if (patches.length > 0) {
            this.history.push(label, patches);
            this.project.modified = Date.now();
        }
    }

    public undo(): void {
        this.project.timeline = this.history.undo(this.project.timeline);
    }

    public redo(): void {
        this.project.timeline = this.history.redo(this.project.timeline);
    }
}
