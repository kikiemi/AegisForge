export interface SubtitleCue {

    start: number;

    end: number;

    text: string;

    position?: number;

    align?: 'left' | 'center' | 'right';
}

export function parseSRT(text: string): SubtitleCue[] {

    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const cues: SubtitleCue[] = [];

    const blocks = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n\s*\n/);
    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 2) continue;

        let i = 0;
        if (/^\d+$/.test(lines[i].trim())) i++;

        const tsLine = lines[i++];
        const tsMatch = tsLine.match(
            /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/
        );
        if (!tsMatch) continue;
        const start = _srtTs(tsMatch, 1);
        const end = _srtTs(tsMatch, 5);
        const rawText = lines.slice(i).join('\n');
        cues.push({ start, end, text: _stripTags(rawText) });
    }
    return cues;
}

function _srtTs(m: RegExpMatchArray, offset: number): number {
    return (
        parseInt(m[offset + 0]) * 3600000 +
        parseInt(m[offset + 1]) * 60000 +
        parseInt(m[offset + 2]) * 1000 +
        parseInt(m[offset + 3].padEnd(3, '0'))
    );
}

export function parseVTT(text: string): SubtitleCue[] {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const cues: SubtitleCue[] = [];
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    let i = 0;

    while (i < lines.length && !lines[i].includes('-->')) i++;

    while (i < lines.length) {
        const line = lines[i].trim();

        if (line.startsWith('NOTE') || line.startsWith('STYLE')) {
            while (i < lines.length && lines[i].trim() !== '') i++;
            continue;
        }

        const tsMatch = line.match(
            /(\d{1,2}):(\d{2}):(\d{2}\.\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2}\.\d{1,3})(.*)/
        );
        if (tsMatch) {
            const start = _vttTs(tsMatch[1], tsMatch[2], tsMatch[3]);
            const end = _vttTs(tsMatch[4], tsMatch[5], tsMatch[6]);
            const settings = tsMatch[7] || '';
            const position = _vttSetting(settings, 'position');
            const alignStr = _vttSetting(settings, 'align');
            const align = (alignStr === 'left' || alignStr === 'right') ? alignStr : 'center';
            i++;
            const textLines: string[] = [];
            while (i < lines.length && lines[i].trim() !== '') {
                textLines.push(lines[i]);
                i++;
            }
            cues.push({
                start, end,
                text: _stripTags(textLines.join('\n')),
                position: position ? parseFloat(position) : undefined,
                align
            });
        } else {
            i++;
        }
    }
    return cues;
}

function _vttTs(h: string, m: string, s: string): number {
    return parseInt(h) * 3600000 + parseInt(m) * 60000 + Math.round(parseFloat(s) * 1000);
}

function _vttSetting(settings: string, key: string): string | null {
    const m = settings.match(new RegExp(`${key}:(\\S+)`));
    return m ? m[1] : null;
}

function _stripTags(s: string): string {
    return s.replace(/<[^>]+>/g, '').trim();
}

interface SubtitlePluginCore {
    timeline: { clips: { id: string; layer: number;[k: string]: unknown }[] };
    config: { width: number; height: number };
}

export function subtitlePlugin(
    cues: SubtitleCue[],
    opts: {
        layer?: number;
        fontSize?: number;
        color?: [number, number, number, number];
        x?: number;
        y?: number;
    } = {}
): (core: SubtitlePluginCore) => void {
    return (core: SubtitlePluginCore) => {
        for (const cue of cues) {
            core.timeline.clips.push({
                id: Math.random().toString(36).slice(2, 9),
                type: 'text',
                source: { text: cue.text, isSubtitle: true },
                start: cue.start,
                end: cue.end,
                layer: opts.layer ?? 99,
                opacity: 1.0,
                x: opts.x ?? core.config.width * 0.1,
                y: opts.y ?? core.config.height * 0.82,
                w: core.config.width * 0.8,
                h: opts.fontSize ? opts.fontSize * 2 : 60,
                scaleX: 1.0, scaleY: 1.0,
                blend: 'normal',
                audioVolume: 1.0,
                _sdfText: cue.text,
                _sdfFontSize: opts.fontSize ?? 36,
                _sdfColor: opts.color ?? [1, 1, 1, 1],
                _sdfAlign: cue.align ?? 'center'
            });
        }
        core.timeline.clips.sort((a: { layer: number }, b: { layer: number }) => a.layer - b.layer);
    };
}
