export interface TimelineClip {
    id: string;
    trackIdx: number;
    inPoint: number;
    outPoint: number;
    sourceStart: number;
    sourceEnd: number;
    sourceId: string;
    type: 'video' | 'audio' | 'title' | 'generator';
    speed: number;
    connectedTo?: string;
    locked: boolean;
    disabled: boolean;
    effects: string[];
    metadata: Record<string, unknown>;
}

export interface TimelineTrack {
    id: string;
    type: 'video' | 'audio' | 'subtitle';
    clips: TimelineClip[];
    locked: boolean;
    muted: boolean;
    solo: boolean;
    volume: number;
    pan: number;
}

export interface TimelineState {
    [k: string]: unknown;
    tracks: TimelineTrack[];
    duration: number;
    fps: number;
    width: number;
    height: number;
    sampleRate: number;
    gridSnap: number;
}

export class MagneticTimeline {
    public state: TimelineState;

    constructor(fps: number = 30, width: number = 1920, height: number = 1080) {
        this.state = {
            tracks: [],
            duration: 0,
            fps, width, height,
            sampleRate: 48000,
            gridSnap: 1 / fps
        };
    }

    public addTrack(type: 'video' | 'audio' | 'subtitle'): string {
        const id = 't_' + this.state.tracks.length + '_' + Date.now().toString(36);
        this.state.tracks.push({
            id, type, clips: [],
            locked: false, muted: false, solo: false,
            volume: 1, pan: 0
        });
        return id;
    }

    public insertClip(trackIdx: number, clip: Omit<TimelineClip, 'id'>, magnetic: boolean = true): string {
        const track = this.state.tracks[trackIdx];
        if (!track || track.locked) return '';
        const id = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        const newClip: TimelineClip = { ...clip, id };
        if (magnetic) this._rippleInsert(track, newClip);
        else track.clips.push(newClip);
        track.clips.sort((a, b) => a.inPoint - b.inPoint);
        this._updateDuration();
        return id;
    }

    public removeClip(trackIdx: number, clipId: string, ripple: boolean = true): void {
        const track = this.state.tracks[trackIdx];
        if (!track || track.locked) return;
        const idx = track.clips.findIndex(c => c.id === clipId);
        if (idx < 0) return;
        const removed = track.clips.splice(idx, 1)[0];
        if (ripple) {
            const gap = removed.outPoint - removed.inPoint;
            for (let i = idx; i < track.clips.length; i++) {
                track.clips[i].inPoint -= gap;
                track.clips[i].outPoint -= gap;
                this._moveConnected(track.clips[i].id, -gap);
            }
        }
        this._updateDuration();
    }

    public moveClip(trackIdx: number, clipId: string, newInPoint: number, magnetic: boolean = true): void {
        const track = this.state.tracks[trackIdx];
        if (!track || track.locked) return;
        const clip = track.clips.find(c => c.id === clipId);
        if (!clip || clip.locked) return;
        const duration = clip.outPoint - clip.inPoint;
        const snapped = magnetic ? this._snapToGrid(newInPoint) : newInPoint;
        const delta = snapped - clip.inPoint;
        clip.inPoint = snapped;
        clip.outPoint = snapped + duration;
        this._moveConnected(clipId, delta);
        if (magnetic) this._resolveOverlaps(track);
        track.clips.sort((a, b) => a.inPoint - b.inPoint);
        this._updateDuration();
    }

    public trimClip(trackIdx: number, clipId: string, edge: 'start' | 'end', newTime: number, ripple: boolean = false): void {
        const track = this.state.tracks[trackIdx];
        if (!track || track.locked) return;
        const clip = track.clips.find(c => c.id === clipId);
        if (!clip || clip.locked) return;
        if (edge === 'start') {
            const delta = newTime - clip.inPoint;
            clip.inPoint = newTime;
            clip.sourceStart += delta * clip.speed;
            if (ripple) {
                const idx = track.clips.indexOf(clip);
                for (let i = 0; i < idx; i++) {
                    track.clips[i].inPoint -= delta;
                    track.clips[i].outPoint -= delta;
                }
            }
        } else {
            const oldOut = clip.outPoint;
            clip.outPoint = newTime;
            clip.sourceEnd = clip.sourceStart + (newTime - clip.inPoint) * clip.speed;
            if (ripple) {
                const delta = newTime - oldOut;
                const idx = track.clips.indexOf(clip);
                for (let i = idx + 1; i < track.clips.length; i++) {
                    track.clips[i].inPoint += delta;
                    track.clips[i].outPoint += delta;
                }
            }
        }
        this._updateDuration();
    }

    public splitClip(trackIdx: number, clipId: string, splitTime: number): [string, string] {
        const track = this.state.tracks[trackIdx];
        if (!track) return ['', ''];
        const clip = track.clips.find(c => c.id === clipId);
        if (!clip || splitTime <= clip.inPoint || splitTime >= clip.outPoint) return ['', ''];
        const splitSource = clip.sourceStart + (splitTime - clip.inPoint) * clip.speed;
        const rightId = 'c_' + Date.now().toString(36) + '_r';
        const right: TimelineClip = {
            ...clip, id: rightId,
            inPoint: splitTime,
            sourceStart: splitSource
        };
        clip.outPoint = splitTime;
        clip.sourceEnd = splitSource;
        track.clips.push(right);
        track.clips.sort((a, b) => a.inPoint - b.inPoint);
        return [clip.id, rightId];
    }

    public connectClips(parentId: string, childId: string): void {
        for (const track of this.state.tracks) {
            const child = track.clips.find(c => c.id === childId);
            if (child) { child.connectedTo = parentId; return; }
        }
    }

    public getClipsAtTime(time: number): TimelineClip[] {
        const result: TimelineClip[] = [];
        for (const track of this.state.tracks) {
            if (track.muted) continue;
            for (const clip of track.clips) {
                if (clip.disabled) continue;
                if (time >= clip.inPoint && time < clip.outPoint) result.push(clip);
            }
        }
        return result;
    }

    private _rippleInsert(track: TimelineTrack, clip: TimelineClip): void {
        const duration = clip.outPoint - clip.inPoint;
        const insertAt = clip.inPoint;
        for (let i = 0; i < track.clips.length; i++) {
            if (track.clips[i].inPoint >= insertAt) {
                track.clips[i].inPoint += duration;
                track.clips[i].outPoint += duration;
            }
        }
        track.clips.push(clip);
    }

    private _resolveOverlaps(track: TimelineTrack): void {
        for (let i = 0; i < track.clips.length - 1; i++) {
            const cur = track.clips[i], next = track.clips[i + 1];
            if (cur.outPoint > next.inPoint) {
                const shift = cur.outPoint - next.inPoint;
                for (let j = i + 1; j < track.clips.length; j++) {
                    track.clips[j].inPoint += shift;
                    track.clips[j].outPoint += shift;
                }
            }
        }
    }

    private _moveConnected(parentId: string, delta: number): void {
        for (const track of this.state.tracks) {
            for (const clip of track.clips) {
                if (clip.connectedTo === parentId) {
                    clip.inPoint += delta;
                    clip.outPoint += delta;
                }
            }
        }
    }

    private _snapToGrid(time: number): number {
        const grid = this.state.gridSnap;
        return Math.round(time / grid) * grid;
    }

    private _updateDuration(): void {
        let max = 0;
        for (const track of this.state.tracks) {
            for (const clip of track.clips) {
                if (clip.outPoint > max) max = clip.outPoint;
            }
        }
        this.state.duration = max;
    }

    public toJSON(): TimelineState {
        return structuredClone(this.state);
    }

    public fromJSON(data: TimelineState): void {
        this.state = data;
    }
}
