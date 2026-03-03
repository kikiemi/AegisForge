"use strict";
const AegisMuxer = (() => {
    const TS_FREQ = 90000;
    const EPOCH_OFFSET = 2082844800;
    const MAX_U32 = 0xFFFFFFFF;
    const CPRI = { "bt709": 1, "bt470bg": 5, "smpte170m": 6, "bt2020": 9, "smpte432": 12 };
    const CTRC = { "bt709": 1, "smpte170m": 6, "iec61966-2-1": 13, "smpte2084": 16, "pq": 16, "hlg": 18 };
    const CMAT = { "rgb": 0, "bt709": 1, "bt470bg": 5, "smpte170m": 6, "bt2020": 9, "smpte2084": 9 };
    const guard = (cond, msg, errCb) => {
        if (!cond) {
            const e = new Error(`[AegisMuxer] ${msg}`);
            if (errCb)
                errCb(e);
            else
                throw e;
            return false;
        }
        return true;
    };
    class MemSink {
        chunks;
        len;
        constructor() { this.chunks = []; this.len = 0; }
        write(d) { if (d && d.byteLength) {
            this.chunks.push(d);
            this.len += d.byteLength;
        } }
        get buffer() {
            const b = new Uint8Array(this.len);
            let o = 0;
            for (let i = 0; i < this.chunks.length; i++) {
                b.set(this.chunks[i], o);
                o += this.chunks[i].byteLength;
            }
            return b.buffer;
        }
    }
    class StreamSink {
        cb;
        pos;
        constructor(cb) { this.cb = cb; this.pos = 0; }
        write(d) { if (d && d.byteLength) {
            this.cb(d, this.pos);
            this.pos += d.byteLength;
        } }
    }
    class FileSink {
        handle;
        pos;
        errCb;
        constructor(handle, errCb) {
            this.handle = handle; // SyncAccessHandle
            this.pos = 0;
            this.errCb = errCb;
        }
        write(d) {
            if (!d || !d.byteLength)
                return;
            try {
                const buf = new Uint8Array(d.buffer || d, d.byteOffset, d.byteLength);
                this.handle.write(buf, { at: this.pos });
                this.pos += buf.byteLength;
            }
            catch (e) {
                if (this.errCb)
                    this.errCb(new Error("FileSink IO Error: " + e.message));
            }
        }
        close() {
            try {
                this.handle.flush();
                this.handle.close();
            }
            catch (e) { }
        }
    }
    class Scribe {
        err;
        cap;
        buf;
        view;
        p;
        stack;
        constructor(errCb) {
            this.err = errCb;
            this.cap = 4 * 1024 * 1024;
            this.buf = new Uint8Array(this.cap);
            this.view = new DataView(this.buf.buffer);
            this.p = 0;
            this.stack = [];
        }
        ensure(n) {
            if (this.p + n > this.cap) {
                try {
                    let nCap = this.cap;
                    while (this.p + n > nCap)
                        nCap = Math.floor(nCap * 1.5);
                    const nBuf = new Uint8Array(nCap);
                    nBuf.set(this.buf.subarray(0, this.p));
                    this.buf = nBuf;
                    this.view = new DataView(this.buf.buffer);
                    this.cap = nCap;
                }
                catch (e) {
                    guard(false, "OOM during buffer expansion", this.err);
                }
            }
        }
        u8(x) { this.ensure(1); this.buf[this.p++] = x; }
        u16(x) { this.ensure(2); this.view.setUint16(this.p, x); this.p += 2; }
        u24(x) { this.ensure(3); this.view.setUint16(this.p, x >> 8); this.buf[this.p + 2] = x & 0xff; this.p += 3; }
        u32(x) { this.ensure(4); this.view.setUint32(this.p, x); this.p += 4; }
        i16(x) { this.ensure(2); this.view.setInt16(this.p, x); this.p += 2; }
        i32(x) { this.ensure(4); this.view.setInt32(this.p, x); this.p += 4; }
        u64(x) { this.ensure(8); this.view.setUint32(this.p, Math.floor(x / 4294967296)); this.view.setUint32(this.p + 4, x >>> 0); this.p += 8; }
        f32(x) { this.ensure(4); this.view.setFloat32(this.p, x); this.p += 4; }
        str(s) {
            const encoded = new TextEncoder().encode(s);
            this.ensure(encoded.length);
            this.buf.set(encoded, this.p);
            this.p += encoded.length;
        }
        bytes(d) { this.ensure(d.byteLength); this.buf.set(new Uint8Array(d.buffer || d, d.byteOffset || 0, d.byteLength), this.p); this.p += d.byteLength; }
        zero(n) { if (n <= 0)
            return; this.ensure(n); this.buf.fill(0, this.p, this.p + n); this.p += n; }
        ebv(x) {
            let l = 1;
            while (x >= Math.pow(2, 7 * l) - 1)
                l++;
            this.ensure(l);
            for (let i = l - 1; i >= 0; i--) {
                let b = Math.floor(x / Math.pow(2, 8 * i)) & 0xff;
                if (i === l - 1)
                    b |= (1 << (8 - l));
                this.buf[this.p++] = b;
            }
        }
        ebm(hex) { for (let i = 0; i < hex.length; i += 2)
            this.u8(parseInt(hex.substring(i, i + 2), 16)); this.ensure(8); const s = this.p; this.p += 8; this.stack.push({ s, m: 'e' }); }
        ebu(hex) { for (let i = 0; i < hex.length; i += 2)
            this.u8(parseInt(hex.substring(i, i + 2), 16)); this.ensure(8); this.buf[this.p++] = 0x01; for (let i = 0; i < 7; i++)
            this.buf[this.p++] = 0xff; }
        box(t) { this.ensure(8); const s = this.p; this.p += 4; this.str(t); this.stack.push({ s, m: 'm' }); }
        box64(t) { this.ensure(16); const s = this.p; this.u32(1); this.str(t); this.p += 8; this.stack.push({ s, m: 'm64' }); }
        rif(t) { this.ensure(8); const s = this.p; this.str(t); this.p += 4; this.stack.push({ s, m: 'r' }); }
        end() {
            if (!guard(this.stack.length > 0, "Stack underflow", this.err))
                return;
            const n = this.stack.pop(), sz = this.p - n.s;
            if (n.m === 'm') {
                if (!guard(sz <= MAX_U32, "Box exceeds 4GB, use box64", this.err))
                    return;
                this.view.setUint32(n.s, sz);
            }
            else if (n.m === 'm64') {
                this.view.setUint32(n.s + 8, Math.floor(sz / 4294967296));
                this.view.setUint32(n.s + 12, sz >>> 0);
            }
            else if (n.m === 'r') {
                this.view.setUint32(n.s + 4, sz - 8, true);
                if ((sz - 8) % 2)
                    this.u8(0);
            }
            else if (n.m === 'e') {
                const d = sz - 8;
                for (let i = 7; i >= 0; i--) {
                    let b = Math.floor(d / Math.pow(2, 8 * i)) & 0xff;
                    if (i === 7)
                        b |= 1;
                    this.buf[n.s + (7 - i)] = b;
                }
            }
        }
        get data() { return this.buf.subarray(0, this.p); }
        reset() { this.p = 0; this.stack.length = 0; }
    }
    class Track {
        id;
        isV;
        codec;
        scale;
        fps;
        w;
        h;
        sr;
        ch;
        rot;
        cs;
        cfgData;
        queue;
        stts;
        ctts;
        stss;
        stsc;
        stsz;
        stco;
        lastDts;
        lastPts;
        minPts;
        audioCount;
        hasNegCto;
        constructor(id, isVideo, config) {
            this.id = id;
            this.isV = isVideo;
            this.codec = String(config.codec || "").toLowerCase();
            this.scale = isVideo ? TS_FREQ : (config.sampleRate || 48000);
            this.w = config.width | 0;
            this.h = config.height | 0;
            this.fps = config.framerate || 30;
            this.sr = config.sampleRate | 0;
            this.ch = config.numberOfChannels | 0;
            this.rot = config.rotation | 0;
            this.cs = config.colorSpace || null;
            this.cfgData = null;
            this.queue = [];
            this.stts = [];
            this.ctts = [];
            this.stss = [];
            this.stsc = [];
            this.stsz = [];
            this.stco = [];
            this.lastDts = -1;
            this.lastPts = -1;
            this.minPts = Infinity;
            this.audioCount = 0;
            this.hasNegCto = false;
        }
    }
    class Engine {
        opt;
        err;
        fmt;
        sink;
        sc;
        vt;
        at;
        sealed;
        cTime;
        dataOff;
        seq;
        tBase;
        wClus;
        constructor(options) {
            this.opt = { format: "mp4", mode: "fragmented", autoSync: true, maxFragDur: 2.0, ...options };
            this.err = this.opt.onError || ((e) => console.error(e));
            if (!guard(this.opt.sink, "Sink output required", this.err))
                return;
            this.fmt = String(this.opt.format).toLowerCase();
            this.sink = this.opt.sink;
            this.sc = new Scribe(this.err);
            this.vt = null;
            this.at = null;
            this.sealed = false;
            this.cTime = Math.floor(Date.now() / 1000) + EPOCH_OFFSET;
            this.dataOff = 0;
            this.seq = 1;
            this.tBase = -1;
            this.wClus = -1;
            if (this.opt.video) {
                this.vt = new Track(1, true, this.opt.video);
            }
            if (this.opt.audio) {
                this.at = new Track(this.vt ? 2 : 1, false, this.opt.audio);
                if (this.at.codec.includes("aac")) {
                    const freqs = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
                    let idx = freqs.indexOf(this.at.sr);
                    if (idx < 0)
                        idx = 4;
                    this.at.cfgData = new Uint8Array([(2 << 3) | (idx >> 1), ((idx & 1) << 7) | (this.at.ch << 3)]);
                }
            }
            if (!guard(!!(this.vt || this.at), "No valid tracks configured", this.err))
                return;
            this._initHdr();
        }
        _initHdr() {
            try {
                if (this.fmt === "mp4" || this.fmt === "mov") {
                    this.sc.box("ftyp");
                    if (this.fmt === "mov") {
                        this.sc.str("qt  ");
                        this.sc.u32(512);
                        this.sc.str("qt  ");
                    }
                    else {
                        this.sc.str(this.opt.mode === "fragmented" ? "iso5" : "isom");
                        this.sc.u32(512);
                        this.sc.str(this.opt.mode === "fragmented" ? "iso5iso6mp41" : "isomiso2avc1mp41");
                    }
                    this.sc.end();
                }
                else if (this.fmt === "webm" || this.fmt === "mkv") {
                    this.sc.ebm("1A45DFA3");
                    this.sc.ebm("4286");
                    this.sc.u8(1);
                    this.sc.end();
                    this.sc.ebm("42F7");
                    this.sc.u8(1);
                    this.sc.end();
                    this.sc.ebm("42F2");
                    this.sc.u8(4);
                    this.sc.end();
                    this.sc.ebm("42F3");
                    this.sc.u8(8);
                    this.sc.end();
                    this.sc.ebm("4282");
                    this.sc.str(this.fmt === "mkv" ? "matroska" : "webm");
                    this.sc.end();
                    this.sc.ebm("4287");
                    this.sc.u8(4);
                    this.sc.end();
                    this.sc.ebm("4285");
                    this.sc.u8(2);
                    this.sc.end();
                    this.sc.end();
                    this.sc.ebu("18538067"); // Segment with Unknown Size
                    this.sc.ebm("1549A966"); // Info
                    this.sc.ebm("2AD7B1");
                    this.sc.u32(1000000);
                    this.sc.end();
                    this.sc.ebm("4D80");
                    this.sc.str("AegisMuxer");
                    this.sc.end();
                    this.sc.end(); // close Info
                    this.sc.ebm("1654AE6B");
                    if (this.vt) {
                        this.sc.ebm("AE");
                        this.sc.ebm("D7");
                        this.sc.u8(this.vt.id);
                        this.sc.end();
                        this.sc.ebm("83");
                        this.sc.u8(1);
                        this.sc.end();
                        const cName = this.vt.codec.includes("vp9") ? "V_VP9" : (this.vt.codec.includes("vp8") ? "V_VP8" : (this.vt.codec.includes("av1") ? "V_AV1" : (this.vt.codec.includes("hevc") || this.vt.codec.includes("hvc1") ? "V_MPEGH/ISO/HEVC" : "V_MPEG4/ISO/AVC")));
                        this.sc.ebm("86");
                        this.sc.str(cName);
                        this.sc.end();
                        this.sc.ebm("E0");
                        this.sc.ebm("B0");
                        this.sc.u16(this.vt.w);
                        this.sc.end();
                        this.sc.ebm("BA");
                        this.sc.u16(this.vt.h);
                        this.sc.end();
                        this.sc.end();
                        this.sc.end();
                    }
                    if (this.at) {
                        this.sc.ebm("AE");
                        this.sc.ebm("D7");
                        this.sc.u8(this.at.id);
                        this.sc.end();
                        this.sc.ebm("83");
                        this.sc.u8(2);
                        this.sc.end();
                        this.sc.ebm("86");
                        this.sc.str(this.at.codec.includes("opus") ? "A_OPUS" : "A_AAC");
                        this.sc.end();
                        this.sc.ebm("E1");
                        this.sc.ebm("B5");
                        this.sc.f32(this.at.sr);
                        this.sc.end();
                        this.sc.ebm("9F");
                        this.sc.u8(this.at.ch);
                        this.sc.end();
                        this.sc.end();
                        this.sc.end();
                    }
                    this.sc.end(); // close Tracks
                }
                else if (this.fmt === "avi") {
                    throw new Error("AVI is currently not supported for streaming muxing due to mandatory Seek headers.");
                }
                this._flushSc();
            }
            catch (e) {
                this.err(e);
            }
        }
        _flushSc() {
            if (this.sc.p > 0) {
                const d = this.sc.data.slice();
                try {
                    this.sink.write(d);
                }
                catch (e) {
                    this.err(e);
                }
                if (this.opt.mode !== "fragmented" || this.fmt === "avi")
                    this.dataOff += d.byteLength;
                this.sc.reset();
            }
        }
        addVideo(chunk, meta) {
            if (this.sealed || !this.vt || !chunk)
                return;
            try {
                let ts = (chunk.timestamp || 0) / 1e6, dur = (chunk.duration || 0) / 1e6, cto = (meta?.compositionTimeOffset || 0) / 1e6;
                // Auto-Recovery: Corrupted timestamp bypass
                if (dur <= 0.0)
                    dur = 1.0 / this.vt.fps;
                if (isNaN(ts) || isNaN(dur) || ts < 0)
                    return;
                let raw = new Uint8Array(chunk.byteLength);
                if (chunk.copyTo)
                    chunk.copyTo(raw);
                else
                    raw.set(new Uint8Array(chunk));
                if (meta?.decoderConfig) {
                    if (meta.decoderConfig.description && !this.vt.cfgData)
                        this.vt.cfgData = new Uint8Array(meta.decoderConfig.description);
                    if (meta.decoderConfig.colorSpace && !this.vt.cs)
                        this.vt.cs = meta.decoderConfig.colorSpace;
                }
                this._push(this.vt, raw, chunk.type === "key", ts, ts - cto, dur, cto);
            }
            catch (e) {
                console.warn("[AegisMuxer] Recovered from corrupted video chunk: ", e);
            }
        }
        addAudio(chunk, meta) {
            if (this.sealed || !this.at || !chunk)
                return;
            try {
                let ts = (chunk.timestamp || 0) / 1e6, dur = (chunk.duration || 0) / 1e6;
                // Auto-Recovery: Corrupted timestamp bypass
                if (isNaN(ts) || isNaN(dur) || ts < 0)
                    return;
                if (this.opt.autoSync) {
                    let exactDur = this.at.codec.includes("aac") ? 1024 / this.at.sr : (dur || (this.at.codec.includes("opus") ? 960 / this.at.sr : 0.02));
                    ts = this.at.audioCount * exactDur;
                    dur = exactDur;
                    this.at.audioCount++;
                }
                let raw = new Uint8Array(chunk.byteLength);
                if (chunk.copyTo)
                    chunk.copyTo(raw);
                else
                    raw.set(new Uint8Array(chunk));
                if (meta?.decoderConfig?.description && !this.at.cfgData)
                    this.at.cfgData = new Uint8Array(meta.decoderConfig.description);
                this._push(this.at, raw, true, ts, ts, dur, 0);
            }
            catch (e) {
                console.warn("[AegisMuxer] Recovered from corrupted audio chunk: ", e);
            }
        }
        _push(trk, data, isKey, pts, dts, dur, cto) {
            if (this.tBase === -1)
                this.tBase = Math.min(pts, dts);
            pts -= this.tBase;
            dts -= this.tBase;
            if (dts < trk.lastDts)
                dts = trk.lastDts + 0.000001;
            if (pts < trk.lastPts && !trk.isV)
                pts = trk.lastPts + 0.000001;
            trk.lastDts = dts;
            trk.lastPts = pts;
            if (pts < trk.minPts)
                trk.minPts = pts;
            let dU = Math.max(1, Math.round(dur * trk.scale));
            let cU = Math.round((pts - dts) * trk.scale);
            if (cU < 0)
                trk.hasNegCto = true;
            if (this.opt.mode !== "fragmented") {
                let lastSt = trk.stts[trk.stts.length - 1];
                if (lastSt && lastSt.d === dU)
                    lastSt.c++;
                else
                    trk.stts.push({ c: 1, d: dU });
                if (trk.isV) {
                    let lastCt = trk.ctts[trk.ctts.length - 1];
                    if (lastCt && lastCt.o === cU)
                        lastCt.c++;
                    else
                        trk.ctts.push({ c: 1, o: cU });
                    if (isKey)
                        trk.stss.push(trk.stsz.length + 1);
                }
                trk.stsz.push(data.byteLength);
            }
            trk.queue.push({ d: data, k: isKey, p: pts, dt: dts, du: dU, c: cU });
            if (this.opt.mode === "fragmented") {
                this._checkFrag();
            }
            else if (this.fmt === "webm" || this.fmt === "mkv" || this.fmt === "avi") {
                this._flushInterleaved();
            }
        }
        _flushInterleaved() {
            for (let t of [this.vt, this.at].filter(Boolean)) {
                if (t.queue.length === 0)
                    continue;
                if (this.fmt === "webm" || this.fmt === "mkv") {
                    // Check if current cluster duration exceeds e.g. 2 seconds (2 * scale)
                    // Optimization: WebM clusters shouldn't wrap every frame
                    let shouldCluster = false;
                    if (this.wClus === -1) {
                        this.wClus = t.queue[0].p;
                        shouldCluster = true;
                    }
                    else if (t.queue[t.queue.length - 1].p - this.wClus >= t.scale * 2) {
                        shouldCluster = true;
                    }
                    if (shouldCluster) {
                        if (this.wClus !== -1 && this.wClus !== t.queue[0].p) {
                            this.sc.end(); // close previous Cluster immediately if opened in stream
                        }
                        let tc = Math.round(t.queue[0].p * 1000);
                        this.sc.ebm("1F43B675"); // Cluster
                        this.sc.ebm("E7");
                        this.sc.u32(tc);
                        this.sc.end(); // Timecode
                        this.wClus = t.queue[0].p;
                    }
                    while (t.queue.length) {
                        let f = t.queue.shift();
                        let relTs = Math.round(f.p * 1000) - Math.round(this.wClus * 1000);
                        if (relTs < 0)
                            relTs = 0;
                        else if (relTs > 32767)
                            relTs = 32767;
                        this.sc.ebm("A3");
                        this.sc.ebv(t.id);
                        this.sc.i16(relTs);
                        this.sc.u8(f.k ? 0x80 : 0x00);
                        this.sc.bytes(f.d);
                        this.sc.end();
                        f.d = null; // Aggressive GC
                    }
                    // Close cluster on finalize or wrap
                }
                else if (this.fmt === "avi") {
                    while (t.queue.length) {
                        let f = t.queue.shift();
                        this.sc.rif(t.id === 1 ? "00dc" : "01wb");
                        this.sc.bytes(f.d);
                        this.sc.end();
                        f.d = null;
                    }
                }
            }
            this._flushSc();
        }
        _checkFrag() {
            if (this.fmt !== "mp4" && this.fmt !== "mov") {
                this._flushInterleaved();
                return;
            }
            let primary = (this.vt && this.vt.queue.length) ? this.vt : ((this.at && this.at.queue.length) ? this.at : null);
            if (primary) {
                let curDur = primary.queue[primary.queue.length - 1].p - primary.queue[0].p;
                if (curDur >= this.opt.maxFragDur && (!this.vt || this.vt.queue[this.vt.queue.length - 1].k)) {
                    this._writeFrag();
                }
            }
        }
        _writeFrag() {
            if (this.seq === 1) {
                this._writeMoov(true);
                this._flushSc();
            }
            let tks = [this.vt, this.at].filter(t => t && t.queue.length);
            if (!tks.length)
                return;
            this.sc.box("moof");
            this.sc.box("mfhd");
            this.sc.u32(0);
            this.sc.u32(this.seq++);
            this.sc.end();
            let trunOffs = [];
            for (let t of tks) {
                this.sc.box("traf");
                this.sc.box("tfhd");
                this.sc.u32(0x20020);
                this.sc.u32(t.id);
                this.sc.end();
                this.sc.box("tfdt");
                this.sc.u32(0x01000000);
                this.sc.u64(Math.round(t.queue[0].dt * t.scale));
                this.sc.end();
                let flags = t.isV ? 0x00000F01 : 0x00000301;
                let hasCto = t.isV && t.queue.some(x => x.c !== 0);
                if (hasCto)
                    flags |= 0x00000800;
                this.sc.box("trun");
                this.sc.u8(t.hasNegCto ? 1 : 0);
                this.sc.u24(flags);
                this.sc.u32(t.queue.length);
                let ptr = this.sc.p;
                this.sc.u32(0);
                for (let f of t.queue) {
                    this.sc.u32(f.du);
                    this.sc.u32(f.d.byteLength);
                    if (t.isV)
                        this.sc.u32(f.k ? 0x02000000 : (0x01010000 | 0x00010000));
                    if (hasCto) {
                        if (t.hasNegCto)
                            this.sc.i32(f.c);
                        else
                            this.sc.u32(f.c);
                    }
                }
                this.sc.end();
                this.sc.end();
                trunOffs.push({ p: ptr, t });
            }
            this.sc.end();
            let moofSize = this.sc.p, mdatOffset = moofSize + 8;
            for (let x of trunOffs) {
                this.sc.view.setUint32(x.p, mdatOffset);
                for (let f of x.t.queue)
                    mdatOffset += f.d.byteLength;
            }
            this._flushSc();
            this.sc.u32((mdatOffset - moofSize - 8) + 8);
            this.sc.str("mdat");
            this._flushSc();
            for (let t of tks) {
                for (let f of t.queue) {
                    try {
                        this.sink.write(f.d);
                    }
                    catch (e) {
                        this.err(e);
                    }
                    f.d = null;
                }
                t.queue.length = 0;
            }
        }
        finalize() {
            if (this.sealed)
                return;
            this.sealed = true;
            try {
                if (this.opt.mode === "fragmented") {
                    if (this.fmt === "mp4" || this.fmt === "mov") {
                        this._writeFrag();
                        let tks = [this.vt, this.at].filter(Boolean);
                        this.sc.box("mfra");
                        for (let t of tks) {
                            this.sc.box("tfra");
                            this.sc.u32(0x01000000);
                            this.sc.u32(t.id);
                            this.sc.u32(0x3F);
                            this.sc.u32(0);
                            this.sc.end();
                        }
                        this.sc.box("mfro");
                        this.sc.u32(0);
                        this.sc.u32(16 + (tks.length * 32));
                        this.sc.end();
                        this.sc.end();
                        this._flushSc();
                    }
                    else
                        this._flushInterleaved();
                    // WebM / MKV Unknown segment doesn't require closing or sizes here
                }
                else if (this.fmt === "mp4" || this.fmt === "mov") {
                    let tks = [this.vt, this.at].filter(Boolean), ofs = this.dataOff;
                    for (let t of tks) {
                        t.stsc = [{ f: 1, n: 1, i: 1 }];
                        for (let i = 0; i < t.queue.length; i++) {
                            t.stco.push(ofs);
                            ofs += t.queue[i].d.byteLength;
                            if (i > 0)
                                t.stsc.push({ f: i + 1, n: 1, i: 1 });
                        }
                        let cp = [];
                        for (let c of t.stsc) {
                            if (!cp.length || cp[cp.length - 1].n !== c.n)
                                cp.push(c);
                        }
                        t.stsc = cp;
                    }
                    let mPos = this.sc.p;
                    this._writeMoov(false);
                    let hdrSize = this.sc.p - mPos;
                    this.sc.reset();
                    let fixOff = hdrSize + 8, dataSize = ofs - this.dataOff, is64 = dataSize + 16 > MAX_U32;
                    if (is64)
                        fixOff += 8;
                    for (let t of tks)
                        for (let i = 0; i < t.stco.length; i++)
                            t.stco[i] += fixOff;
                    this._writeMoov(false);
                    this._flushSc();
                    if (is64) {
                        this.sc.u32(1);
                        this.sc.str("mdat");
                        this.sc.u64(dataSize + 16);
                    }
                    else {
                        this.sc.u32(dataSize + 8);
                        this.sc.str("mdat");
                    }
                    this._flushSc();
                    for (let t of tks) {
                        for (let f of t.queue) {
                            try {
                                this.sink.write(f.d);
                            }
                            catch (e) {
                                this.err(e);
                            }
                            f.d = null;
                        }
                        t.queue.length = 0;
                    }
                }
            }
            catch (e) {
                this.err(e);
            }
        }
        _writeMoov(isFrag) {
            this.sc.box("moov");
            this.sc.box("mvhd");
            this.sc.u32(0);
            this.sc.u32(this.cTime);
            this.sc.u32(this.cTime);
            this.sc.u32(TS_FREQ);
            let maxDur = 0;
            if (!isFrag) {
                for (let t of [this.vt, this.at].filter(Boolean)) {
                    let d = 0;
                    for (let s of t.stts)
                        d += (s.c * s.d);
                    let r = (d / t.scale) * TS_FREQ;
                    if (r > maxDur)
                        maxDur = r;
                }
            }
            this.sc.u32(Math.round(maxDur));
            this.sc.u32(0x00010000);
            this.sc.u16(0x0100);
            this.sc.zero(10);
            let mat = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
            for (let x of mat)
                this.sc.u32(x);
            this.sc.zero(24);
            this.sc.u32((this.vt && this.at) ? 3 : 2);
            this.sc.end();
            if (this.vt)
                this._writeTrak(this.vt, isFrag);
            if (this.at)
                this._writeTrak(this.at, isFrag);
            if (isFrag) {
                this.sc.box("mvex");
                for (let t of [this.vt, this.at].filter(Boolean)) {
                    this.sc.box("trex");
                    this.sc.u32(0);
                    this.sc.u32(t.id);
                    this.sc.u32(1);
                    this.sc.zero(12);
                    this.sc.end();
                }
                this.sc.end();
            }
            this.sc.end();
        }
        _writeTrak(t, isFrag) {
            this.sc.box("trak");
            this.sc.box("tkhd");
            this.sc.u32(t.isV ? 0x00000003 : 0x00000007);
            this.sc.u32(this.cTime);
            this.sc.u32(this.cTime);
            this.sc.u32(t.id);
            this.sc.u32(0);
            let d = 0;
            if (!isFrag)
                for (let s of t.stts)
                    d += (s.c * s.d);
            this.sc.u32(Math.round((d / t.scale) * TS_FREQ));
            this.sc.zero(8);
            this.sc.u16(0);
            this.sc.u16(0);
            this.sc.u16(t.isV ? 0 : 0x0100);
            this.sc.u16(0);
            let rm = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
            if (t.isV && t.rot) {
                let r = t.rot * Math.PI / 180;
                rm[0] = Math.round(Math.cos(r) * 65536) >>> 0;
                rm[1] = Math.round(Math.sin(r) * 65536) >>> 0;
                rm[3] = Math.round(-Math.sin(r) * 65536) >>> 0;
                rm[4] = Math.round(Math.cos(r) * 65536) >>> 0;
            }
            for (let x of rm)
                this.sc.u32(x);
            this.sc.u32(t.isV ? (t.w << 16) : 0);
            this.sc.u32(t.isV ? (t.h << 16) : 0);
            this.sc.end();
            if (!isFrag && t.isV && t.minPts !== Infinity && t.minPts > 0) {
                this.sc.box("edts");
                this.sc.box("elst");
                this.sc.u32(0);
                this.sc.u32(1);
                this.sc.u32(Math.round((d / t.scale) * TS_FREQ));
                this.sc.u32(Math.round(t.minPts * t.scale));
                this.sc.u32(0x00010000);
                this.sc.end();
                this.sc.end();
            }
            this.sc.box("mdia");
            this.sc.box("mdhd");
            this.sc.u32(0);
            this.sc.u32(this.cTime);
            this.sc.u32(this.cTime);
            this.sc.u32(t.scale);
            this.sc.u32(d);
            this.sc.u16(0x55c4);
            this.sc.u16(0);
            this.sc.end();
            this.sc.box("hdlr");
            this.sc.u32(0);
            this.sc.str("mhlr");
            this.sc.str(t.isV ? "vide" : "soun");
            this.sc.zero(12);
            this.sc.str("Aegis\0");
            this.sc.end();
            this.sc.box("minf");
            if (t.isV) {
                this.sc.box("vmhd");
                this.sc.u32(0x00000001);
                this.sc.zero(8);
                this.sc.end();
            }
            else {
                this.sc.box("smhd");
                this.sc.u32(0);
                this.sc.zero(4);
                this.sc.end();
            }
            this.sc.box("dinf");
            this.sc.box("dref");
            this.sc.u32(0);
            this.sc.u32(1);
            this.sc.box("url ");
            this.sc.u32(0x00000001);
            this.sc.end();
            this.sc.end();
            this.sc.end();
            this.sc.box("stbl");
            this._wStsd(t);
            if (!isFrag) {
                this.sc.box("stts");
                this.sc.u32(0);
                this.sc.u32(t.stts.length);
                for (let s of t.stts) {
                    this.sc.u32(s.c);
                    this.sc.u32(s.d);
                }
                this.sc.end();
                if (t.isV && t.stss.length) {
                    this.sc.box("stss");
                    this.sc.u32(0);
                    this.sc.u32(t.stss.length);
                    for (let s of t.stss)
                        this.sc.u32(s);
                    this.sc.end();
                }
                if (t.isV && t.ctts.some((c) => c.o !== 0)) {
                    this.sc.box("ctts");
                    this.sc.u8(t.hasNegCto ? 1 : 0);
                    this.sc.u24(0);
                    this.sc.u32(t.ctts.length);
                    for (let c of t.ctts) {
                        this.sc.u32(c.c);
                        if (t.hasNegCto)
                            this.sc.i32(c.o);
                        else
                            this.sc.u32(c.o);
                    }
                    this.sc.end();
                }
                this.sc.box("stsc");
                this.sc.u32(0);
                this.sc.u32(t.stsc.length);
                for (let s of t.stsc) {
                    this.sc.u32(s.f);
                    this.sc.u32(s.n);
                    this.sc.u32(s.i);
                }
                this.sc.end();
                this.sc.box("stsz");
                this.sc.u32(0);
                this.sc.u32(0);
                this.sc.u32(t.stsz.length);
                for (let s of t.stsz)
                    this.sc.u32(s);
                this.sc.end();
                let i64 = t.stco.some((c) => c > MAX_U32);
                this.sc.box(i64 ? "co64" : "stco");
                this.sc.u32(0);
                this.sc.u32(t.stco.length);
                for (let c of t.stco) {
                    if (i64)
                        this.sc.u64(c);
                    else
                        this.sc.u32(c);
                }
                this.sc.end();
            }
            else {
                ["stts", "stsc", "stsz", "stco"].forEach(x => { this.sc.box(x); this.sc.u32(0); this.sc.u32(0); if (x === "stsz")
                    this.sc.u32(0); this.sc.end(); });
            }
            this.sc.end();
            this.sc.end();
            this.sc.end();
            this.sc.end();
        }
        _wStsd(t) {
            this.sc.box("stsd");
            this.sc.u32(0);
            this.sc.u32(1);
            if (t.isV) {
                let nP = t.codec.split('.')[0];
                let bName = "avc1";
                if (nP.startsWith("avc"))
                    bName = "avc1";
                else if (nP.startsWith("hvc") || nP.startsWith("hev"))
                    bName = "hvc1";
                else if (nP.startsWith("av01"))
                    bName = "av01";
                else if (nP.startsWith("vp09"))
                    bName = "vp09";
                this.sc.box(bName);
                this.sc.zero(6);
                this.sc.u16(1);
                this.sc.zero(16);
                this.sc.u16(t.w);
                this.sc.u16(t.h);
                this.sc.u32(0x00480000);
                this.sc.u32(0x00480000);
                this.sc.u32(0);
                this.sc.u16(1);
                this.sc.zero(32);
                this.sc.u16(0x0018);
                this.sc.u16(0xffff);
                if (t.cfgData) {
                    if (nP.startsWith("avc")) {
                        this.sc.box("avcC");
                        this.sc.bytes(t.cfgData);
                        this.sc.end();
                    }
                    else if (nP.startsWith("hvc") || nP.startsWith("hev")) {
                        this.sc.box("hvcC");
                        this.sc.bytes(t.cfgData);
                        this.sc.end();
                    }
                    else if (nP.startsWith("av01")) {
                        this.sc.box("av1C");
                        this.sc.bytes(t.cfgData);
                        this.sc.end();
                    }
                    else if (nP.startsWith("vp09")) {
                        this.sc.box("vpcC");
                        this.sc.u32(0x01000000);
                        this.sc.u8(t.cfgData[0] || 0);
                        this.sc.u8(t.cfgData[1] || 10);
                        this.sc.u8(0x08);
                        this.sc.u8(1);
                        this.sc.u8(1);
                        this.sc.u8(1);
                        this.sc.u16(0);
                        this.sc.end();
                    }
                }
                if (t.cs) {
                    this.sc.box("colr");
                    this.sc.str("nclx");
                    this.sc.u16(CPRI[t.cs.primaries] || 2);
                    this.sc.u16(CTRC[t.cs.transfer] || 2);
                    this.sc.u16(CMAT[t.cs.matrix] || 2);
                    this.sc.u8(t.cs.fullRange ? 0x80 : 0x00);
                    this.sc.end();
                }
                this.sc.end();
            }
            else {
                let bName = t.codec.includes("opus") ? "Opus" : "mp4a";
                this.sc.box(bName);
                this.sc.zero(6);
                this.sc.u16(1);
                this.sc.zero(8);
                this.sc.u16(t.ch);
                this.sc.u16(16);
                this.sc.zero(4);
                this.sc.u32(t.sr << 16);
                if (t.codec.includes("aac")) {
                    this.sc.box("esds");
                    this.sc.u32(0);
                    let c = t.cfgData || new Uint8Array([0x11, 0x90]);
                    this.sc.u8(0x03);
                    this.sc.u8(23 + c.byteLength);
                    this.sc.u16(1);
                    this.sc.u8(0);
                    this.sc.u8(0x04);
                    this.sc.u8(15 + c.byteLength);
                    this.sc.u8(0x40);
                    this.sc.u8(0x15);
                    this.sc.u24(0);
                    this.sc.u32(128000);
                    this.sc.u32(128000);
                    this.sc.u8(0x05);
                    this.sc.u8(c.byteLength);
                    this.sc.bytes(c);
                    this.sc.u8(0x06);
                    this.sc.u8(1);
                    this.sc.u8(2);
                    this.sc.end();
                }
                else if (t.codec.includes("opus")) {
                    this.sc.box("dOps");
                    this.sc.u8(0);
                    this.sc.u8(t.ch);
                    this.sc.u16(3840);
                    this.sc.u32(t.sr);
                    this.sc.u16(0);
                    this.sc.u8(0);
                    this.sc.end();
                }
                this.sc.end();
            }
            this.sc.end();
        }
    }
    return { MemSink, StreamSink, FileSink, Engine };
})();
// @ts-ignore
if (typeof module !== "undefined" && module.exports)
    module.exports = AegisMuxer;
