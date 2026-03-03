import { AutoSync } from '../audio/autosync';

export interface CameraAngle {
    id: string;
    sourceId: string;
    label: string;
    audioOffset: number;
    synced: boolean;
}

export interface CutDecision {
    angleIdx: number;
    inPoint: number;
    outPoint: number;
}

export class MulticamEditor {
    public angles: CameraAngle[] = [];
    public cutList: CutDecision[] = [];
    private _activeAngle: number = 0;

    public addAngle(sourceId: string, label: string): number {
        const idx = this.angles.length;
        this.angles.push({
            id: 'angle_' + idx + '_' + Date.now().toString(36),
            sourceId, label,
            audioOffset: 0, synced: false
        });
        return idx;
    }

    public async syncAngles(
        getAudio: (sourceId: string) => Promise<{ data: Float32Array; channels: number; sampleRate: number }>
    ): Promise<void> {
        if (this.angles.length < 2) return;
        const refAudio = await getAudio(this.angles[0].sourceId);
        const refMono = AutoSync.downmixToMono(refAudio.data, refAudio.channels);
        const refDown = AutoSync.downsample(refMono, 4);
        this.angles[0].audioOffset = 0;
        this.angles[0].synced = true;
        for (let i = 1; i < this.angles.length; i++) {
            const tgtAudio = await getAudio(this.angles[i].sourceId);
            const tgtMono = AutoSync.downmixToMono(tgtAudio.data, tgtAudio.channels);
            const tgtDown = AutoSync.downsample(tgtMono, 4);
            const result = AutoSync.correlate(refDown, tgtDown, refAudio.sampleRate / 4);
            this.angles[i].audioOffset = result.offsetSeconds;
            this.angles[i].synced = result.confidence > 0.3;
        }
    }

    public switchAngle(angleIdx: number, atTime: number): void {
        if (angleIdx < 0 || angleIdx >= this.angles.length) return;
        if (this.cutList.length > 0) {
            const last = this.cutList[this.cutList.length - 1];
            if (last.outPoint > atTime) last.outPoint = atTime;
            if (last.angleIdx === angleIdx && last.outPoint >= atTime) return;
        }
        this._activeAngle = angleIdx;
        this.cutList.push({
            angleIdx,
            inPoint: atTime,
            outPoint: Infinity
        });
    }

    public finalize(endTime: number): void {
        if (this.cutList.length > 0) {
            this.cutList[this.cutList.length - 1].outPoint = endTime;
        }
        this.cutList = this.cutList.filter(c => c.inPoint < c.outPoint);
    }

    public getAngleAtTime(time: number): number {
        for (let i = this.cutList.length - 1; i >= 0; i--) {
            const c = this.cutList[i];
            if (time >= c.inPoint && time < c.outPoint) return c.angleIdx;
        }
        return 0;
    }

    public getSourceTimeForAngle(angleIdx: number, timelineTime: number): number {
        const angle = this.angles[angleIdx];
        if (!angle) return timelineTime;
        return timelineTime - angle.audioOffset;
    }

    public toJSON(): { angles: CameraAngle[]; cutList: CutDecision[] } {
        return { angles: [...this.angles], cutList: [...this.cutList] };
    }

    public fromJSON(data: { angles: CameraAngle[]; cutList: CutDecision[] }): void {
        this.angles = data.angles;
        this.cutList = data.cutList;
    }
}
