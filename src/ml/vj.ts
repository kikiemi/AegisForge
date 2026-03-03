import { AegisCore, AegisPlugin } from '../core/AegisCore';
import { log } from '../core';

export interface VJOpts {
    midiChannel?: number;
    ccMapping?: Record<number, string>;
}

const _vjParams = new WeakMap<AegisCore, Map<string, number>>();

export function vjMidiMap(opts: VJOpts = {}): AegisPlugin {
    return (core: AegisCore) => {
        const mapping = opts.ccMapping || { 1: 'alpha', 7: 'brightness', 10: 'hue' };
        _vjParams.set(core, new Map());

        if (typeof navigator !== 'undefined' && navigator.requestMIDIAccess) {
            navigator.requestMIDIAccess().then(access => {
                access.inputs.forEach(input => {
                    input.onmidimessage = (message) => {
                        if (!message.data) return;
                        const status = message.data[0];
                        const channel = status & 0x0f;
                        const type = status & 0xf0;

                        if (opts.midiChannel !== undefined && channel !== opts.midiChannel) return;

                        if (type === 0xb0) {
                            const cc = message.data[1];
                            const value = message.data[2] / 127.0;
                            const paramName = mapping[cc];
                            if (paramName) {
                                _vjParams.get(core)!.set(paramName, value);
                            }
                        }
                    };
                });

                access.onstatechange = (event: Event) => {
                    const port = (event as MIDIConnectionEvent).port;
                    if (port && port.state === 'connected' && port.type === 'input') {
                        log.info(`[VJ] MIDI input connected: ${port.name}`);
                    }
                };

                log.info(`[VJ] MIDI access granted — listening on ${access.inputs.size} input(s)`);
            }).catch(err => {
                log.warn('[VJ] MIDI access denied or unsupported', err);
            });
        } else {
            log.warn('[VJ] Web MIDI API not available');
        }
    };
}

export function getVJParam(core: AegisCore, name: string, fallback: number = 0): number {
    const params = _vjParams.get(core);
    if (!params) return fallback;
    return params.get(name) ?? fallback;
}
