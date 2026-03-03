import { AegisCore } from './AegisCore';
import { log } from '../core';

export interface SwarmClient {
    id: string;
    conn: RTCPeerConnection;
    channel: RTCDataChannel;
    fpsCap: number;
}

interface ChunkResult {
    peerId: string;
    startMs: number;
    endMs: number;
    data: ArrayBuffer;
}

export class AegisSwarm {
    private core: AegisCore;
    private peers: Map<string, SwarmClient> = new Map();
    private _chunks: Map<string, ChunkResult> = new Map();
    private _pendingPeers: Set<string> = new Set();
    private _resolveAll: (() => void) | null = null;
    private _timeoutMs: number = 60000;

    constructor(core: AegisCore) {
        this.core = core;
    }

    public async invitePeer(signalingOfferStr: string): Promise<string> {
        const peer = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        const dataChannel = peer.createDataChannel('aegis-swarm-tx', {
            ordered: true, maxRetransmits: 3
        });

        const peerId = Math.random().toString(36).substring(2, 9);
        this.peers.set(peerId, { id: peerId, conn: peer, channel: dataChannel, fpsCap: 30 });

        peer.ondatachannel = (event) => {
            const rxChannel = event.channel;
            rxChannel.binaryType = 'arraybuffer';
            rxChannel.onmessage = (msg) => this._handleSwarmPayload(peerId, msg);
        };

        peer.oniceconnectionstatechange = () => {
            if (peer.iceConnectionState === 'disconnected' || peer.iceConnectionState === 'failed') {
                log.warn(`AegisSwarm: Peer ${peerId} disconnected`);
                this._handlePeerDisconnect(peerId);
            }
        };

        const offer = new RTCSessionDescription(JSON.parse(signalingOfferStr));
        await peer.setRemoteDescription(offer);

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        return JSON.stringify(peer.localDescription);
    }

    public async executeSwarmRender(filename: string = "swarm_output.mp4"): Promise<ArrayBuffer> {
        if (this.peers.size === 0) {
            log.warn('AegisSwarm: No connected peers. Falling back to local compute.');
            await this.core.save(filename);
            return new ArrayBuffer(0);
        }

        const totalDurationMs = this.core.timeline.duration || 1000;
        const totalNodes = this.peers.size + 1;
        const chunkDuration = totalDurationMs / totalNodes;

        log.info(`AegisSwarm: Distributing ${totalDurationMs}ms across ${totalNodes} nodes`);

        this._chunks.clear();
        this._pendingPeers.clear();

        let i = 0;
        for (const [id, peer] of this.peers) {
            const startCmdMs = i * chunkDuration;
            const endCmdMs = (i + 1) * chunkDuration;

            const payload = {
                action: 'RENDER_CHUNK',
                projectId: 'aegis-v4',
                startMs: startCmdMs,
                endMs: endCmdMs,
                config: this.core.config
            };

            if (peer.channel.readyState === 'open') {
                try {
                    peer.channel.send(JSON.stringify(payload));
                } catch (serErr) {
                    log.warn(`AegisSwarm: Failed to serialize payload for peer ${id}:`, serErr);
                    continue;
                }
                this._pendingPeers.add(id);
                log.info(`AegisSwarm: TX → Node [${id}] Range: ${startCmdMs.toFixed(0)}-${endCmdMs.toFixed(0)}ms`);
            } else {
                log.warn(`AegisSwarm: Peer ${id} not ready, redistributing`);
            }
            i++;
        }

        const savedConfig = { ...this.core.config };
        const savedTrim = this.core.config.trim ? { ...this.core.config.trim } : undefined;
        this.core.config.trim = { start: i * chunkDuration, end: totalDurationMs };
        log.info(`AegisSwarm: Local node rendering ${this.core.config.trim.start.toFixed(0)}-${this.core.config.trim.end.toFixed(0)}ms`);

        const [localResult] = await Promise.all([
            this.core.save(`local_${filename}`),
            this._waitForAllPeers()
        ]);

        this.core.config.trim = savedTrim as typeof this.core.config.trim;

        return this._assembleChunks(chunkDuration, totalNodes);
    }

    private _waitForAllPeers(): Promise<void> {
        if (this._pendingPeers.size === 0) return Promise.resolve();

        return new Promise((resolve, reject) => {
            this._resolveAll = resolve;

            setTimeout(() => {
                if (this._pendingPeers.size > 0) {
                    log.warn(`AegisSwarm: Timeout — ${this._pendingPeers.size} peers did not respond. Proceeding with available data.`);
                    this._pendingPeers.clear();
                    resolve();
                }
            }, this._timeoutMs);
        });
    }

    private _handleSwarmPayload(peerId: string, event: MessageEvent): void {
        if (event.data instanceof ArrayBuffer) {
            const data = event.data as ArrayBuffer;
            log.info(`AegisSwarm: Received ${data.byteLength} bytes from [${peerId}]`);

            const chunkIdx = this._chunks.size;
            const totalDur = this.core.timeline.duration || 1000;
            const chunkDur = totalDur / Math.max(1, this.peers.size + 1);
            this._chunks.set(peerId, {
                peerId,
                startMs: chunkIdx * chunkDur,
                endMs: (chunkIdx + 1) * chunkDur,
                data
            });
            this._pendingPeers.delete(peerId);
            if (this._pendingPeers.size === 0 && this._resolveAll) {
                this._resolveAll();
                this._resolveAll = null;
            }
        } else if (typeof event.data === 'string') {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'progress') {
                    log.info(`AegisSwarm: [${peerId}] progress: ${msg.percent}%`);
                } else if (msg.type === 'error') {
                    log.warn(`AegisSwarm: [${peerId}] error: ${msg.message}`);
                    this._pendingPeers.delete(peerId);
                    if (this._pendingPeers.size === 0 && this._resolveAll) {
                        this._resolveAll();
                        this._resolveAll = null;
                    }
                } else if (msg.type === 'ice-candidate' && msg.candidate) {
                    const peer = this.peers.get(peerId);
                    if (peer) {
                        peer.conn.addIceCandidate(new RTCIceCandidate(msg.candidate))
                            .catch(e => log.warn(`AegisSwarm: ICE candidate error for [${peerId}]:`, e));
                    }
                }
            } catch (_) {
                log.warn(`AegisSwarm: Failed to parse message from [${peerId}]`);
            }
        }
    }

    private _handlePeerDisconnect(peerId: string): void {
        this._pendingPeers.delete(peerId);
        this.peers.delete(peerId);
        if (this._pendingPeers.size === 0 && this._resolveAll) {
            this._resolveAll();
            this._resolveAll = null;
        }
    }

    private _assembleChunks(chunkDuration: number, totalNodes: number): ArrayBuffer {

        const entries = Array.from(this._chunks.values())
            .sort((a, b) => a.startMs - b.startMs);

        if (entries.length === 0) {
            log.warn('AegisSwarm: No remote chunks received');
            return new ArrayBuffer(0);
        }

        if (entries.length < this.peers.size) {
            log.warn(`AegisSwarm: Incomplete — received ${entries.length}/${this.peers.size} chunks`);
        }

        
        log.warn('AegisSwarm: Multi-peer assembly not yet implemented — returning first peer chunk only. Each peer must produce fMP4 fragments for correct assembly.');
        return entries[0].data;
    }

    public get connectedPeers(): number {
        return this.peers.size;
    }

    public disconnect(): void {
        for (const [id, peer] of this.peers) {
            try { peer.channel.close(); } catch (_) { }
            try { peer.conn.close(); } catch (_) { }
        }
        this.peers.clear();
        this._pendingPeers.clear();
        this._chunks.clear();
    }
}
