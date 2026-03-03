"use strict";
var AegisForge = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/core.ts
  var AegisError, Logger, log, ResourceManager, SlabAllocator, RationalTimecode, TimestampSync, BezierKeyframeEngine, KeyframeEngine, CatmullRomPath, WorkerPool;
  var init_core = __esm({
    "src/core.ts"() {
      "use strict";
      AegisError = class extends Error {
        e;
        constructor(m, e = null) {
          super(e ? `${m} | Cause: ${e.message || e}` : m);
          this.name = "AegisError";
          this.e = e;
        }
      };
      Logger = class {
        p;
        constructor() {
          this.p = "[AF]";
        }
        info(...a) {
          console.info(this.p, ...a);
        }
        warn(...a) {
          console.warn(this.p, ...a);
        }
        error(m, e) {
          console.error(this.p, m, e || "");
        }
        assert(c, m) {
          if (!c) {
            const e = new AegisError(m);
            this.error(e.message);
            throw e;
          }
        }
      };
      log = new Logger();
      ResourceManager = class {
        t;
        constructor() {
          this.t = /* @__PURE__ */ new Set();
        }
        track(r) {
          if (r && typeof r.close === "function")
            this.t.add(r);
          return r;
        }
        untrack(r) {
          this.t.delete(r);
        }
        closeAll() {
          for (const r of this.t) {
            try {
              r.close();
            } catch (e) {
              log.error("ResourceManager:err", e);
            }
          }
          this.t.clear();
        }
      };
      SlabAllocator = class {
        pool = [];
        factory;
        constructor(factory, prewarm = 0) {
          this.factory = factory;
          for (let i = 0; i < prewarm; i++)
            this.pool.push(factory());
        }
        acquire() {
          return this.pool.length > 0 ? this.pool.pop() : this.factory();
        }
        release(obj) {
          obj.reset();
          this.pool.push(obj);
        }
        get size() {
          return this.pool.length;
        }
      };
      RationalTimecode = class _RationalTimecode {
        num;
        den;
        fpsNum;
        fpsDen;
        constructor(fps) {
          let n = Math.round(fps * 1e3);
          let d = 1e3;
          if (Math.abs(fps - 29.97) < 0.01) {
            n = 3e4;
            d = 1001;
          } else if (Math.abs(fps - 23.976) < 0.01) {
            n = 24e3;
            d = 1001;
          } else if (Math.abs(fps - 59.94) < 0.01) {
            n = 6e4;
            d = 1001;
          }
          this.fpsNum = BigInt(n);
          this.fpsDen = BigInt(d);
          this.num = 0n;
          this.den = 1n;
        }
        fromFrame(frameIdx) {
          this.num = BigInt(frameIdx) * this.fpsDen;
          this.den = this.fpsNum;
          return this;
        }
        fromSeconds(sec) {
          const secNum = BigInt(Math.round(sec * 1e6));
          this.num = secNum * this.fpsNum;
          this.den = this.fpsDen * 1000000n;
          return this;
        }
        toMicros() {
          return this.num * 1000000n / (this.den === 0n ? 1n : this.den);
        }
        toSeconds() {
          return Number(this.num) / Number(this.den);
        }
        advanceFrame(n = 1) {
          this.num += BigInt(n) * this.fpsDen;
          this.den = this.fpsNum;
          return this.toMicros();
        }
        clone() {
          const c = Object.create(_RationalTimecode.prototype);
          Object.assign(c, { fpsNum: this.fpsNum, fpsDen: this.fpsDen, num: this.num, den: this.den });
          return c;
        }
      };
      TimestampSync = class {
        vNum;
        vDen;
        a;
        vf;
        af;
        constructor(vFPS, aRate) {
          log.assert(vFPS > 0, "vFPS>0");
          log.assert(aRate > 0, "aRate>0");
          let fpsNum = Math.round(vFPS * 1e3), fpsDen = 1e3;
          if (Math.abs(vFPS - 29.97) < 0.01) {
            fpsNum = 3e4;
            fpsDen = 1001;
          } else if (Math.abs(vFPS - 23.976) < 0.01) {
            fpsNum = 24e3;
            fpsDen = 1001;
          } else if (Math.abs(vFPS - 59.94) < 0.01) {
            fpsNum = 6e4;
            fpsDen = 1001;
          }
          this.vNum = BigInt(fpsNum);
          this.vDen = BigInt(fpsDen);
          this.a = BigInt(Math.round(aRate));
          this.vf = 0n;
          this.af = 0n;
        }
        nextVideoPts() {
          const p = this.vf * 1000000n * this.vDen / this.vNum;
          this.vf++;
          return Number(p);
        }
        nextAudioPts(samples) {
          const p = this.af * 1000000n / this.a;
          this.af += BigInt(samples);
          return Number(p);
        }
        peekAudioPts() {
          return Number(this.af * 1000000n / this.a);
        }
      };
      BezierKeyframeEngine = class _BezierKeyframeEngine {
        keys;
        constructor(keyframes) {
          this.keys = keyframes.slice().sort((a, b) => a.t - b.t);
        }
        get(timeSec) {
          const keys = this.keys;
          if (keys.length === 0)
            return 0;
          if (timeSec <= keys[0].t)
            return keys[0].v;
          if (timeSec >= keys[keys.length - 1].t)
            return keys[keys.length - 1].v;
          for (let i = 0; i < keys.length - 1; i++) {
            const k1 = keys[i], k2 = keys[i + 1];
            if (timeSec >= k1.t && timeSec <= k2.t) {
              const tNorm = (timeSec - k1.t) / (k2.t - k1.t);
              const cp = k1.cp || [0, 0, 1, 1];
              const u = _BezierKeyframeEngine._solveT(tNorm, cp[0], cp[2]);
              const vNorm = _BezierKeyframeEngine._bezier1D(u, 0, cp[1], cp[3], 1);
              return k1.v + (k2.v - k1.v) * vNorm;
            }
          }
          return 0;
        }
        static _solveT(tx, p1x, p2x) {
          let u = tx;
          for (let i = 0; i < 8; i++) {
            const x = _BezierKeyframeEngine._bezier1D(u, 0, p1x, p2x, 1) - tx;
            const dx = _BezierKeyframeEngine._bezierDeriv(u, 0, p1x, p2x, 1);
            if (Math.abs(dx) < 1e-12)
              break;
            u -= x / dx;
            u = u < 0 ? 0 : u > 1 ? 1 : u;
          }
          return u;
        }
        static _bezier1D(t, p0, p1, p2, p3) {
          const mt = 1 - t;
          return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
        }
        static _bezierDeriv(t, p0, p1, p2, p3) {
          const mt = 1 - t;
          return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2);
        }
      };
      KeyframeEngine = class {
        keys;
        constructor(keyframes) {
          this.keys = keyframes.slice().sort((a, b) => a.t - b.t);
        }
        get(timeSec) {
          if (this.keys.length === 0)
            return 0;
          if (timeSec <= this.keys[0].t)
            return this.keys[0].v;
          if (timeSec >= this.keys[this.keys.length - 1].t)
            return this.keys[this.keys.length - 1].v;
          for (let i = 0; i < this.keys.length - 1; i++) {
            const k1 = this.keys[i], k2 = this.keys[i + 1];
            if (timeSec >= k1.t && timeSec <= k2.t) {
              const p = (timeSec - k1.t) / (k2.t - k1.t);
              return k1.v + (k2.v - k1.v) * p;
            }
          }
          return 0;
        }
      };
      CatmullRomPath = class {
        pts;
        arcTable;
        totalLen;
        samples;
        constructor(points, samples = 200) {
          log.assert(points.length >= 2, "CatmullRom needs >=2 points");
          this.pts = [points[0], ...points, points[points.length - 1]];
          this.samples = samples;
          const { table, total } = this._buildArcTable(samples);
          this.arcTable = table;
          this.totalLen = total;
        }
        getPoint(t) {
          if (t <= 0)
            return this._rawPoint(1, 0);
          if (t >= 1)
            return this._rawPoint(this.pts.length - 2, 1);
          const targetLen = t * this.totalLen;
          return this._pointAtArc(targetLen);
        }
        _pointAtArc(arcLen) {
          const n = this.samples;
          let lo = 0, hi = n - 1;
          while (lo < hi) {
            const mid = lo + hi >> 1;
            if (this.arcTable[mid] < arcLen)
              lo = mid + 1;
            else
              hi = mid;
          }
          const prevArc = lo === 0 ? 0 : this.arcTable[lo - 1];
          const curArc = this.arcTable[lo];
          const segLen = curArc - prevArc;
          const tLocal = segLen < 1e-12 ? 0 : (arcLen - prevArc) / segLen;
          const globalT = (lo + tLocal) / n;
          return this._rawEval(globalT);
        }
        _rawEval(t) {
          const pts = this.pts;
          const n = pts.length - 2;
          const seg = Math.min(Math.floor(t * n), n - 1);
          const u = t * n - seg;
          return this._rawPoint(seg + 1, u);
        }
        _rawPoint(i, t) {
          const p = this.pts;
          const i0 = Math.max(0, i - 1), i1 = i, i2 = Math.min(p.length - 1, i + 1), i3 = Math.min(p.length - 1, i + 2);
          return {
            x: this._cr(t, p[i0].x, p[i1].x, p[i2].x, p[i3].x),
            y: this._cr(t, p[i0].y, p[i1].y, p[i2].y, p[i3].y)
          };
        }
        _cr(t, p0, p1, p2, p3) {
          return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
        }
        _buildArcTable(n) {
          let prev = this._rawEval(0), total = 0;
          const table = [];
          for (let i = 1; i <= n; i++) {
            const cur = this._rawEval(i / n);
            const dx = cur.x - prev.x, dy = cur.y - prev.y;
            total += Math.sqrt(dx * dx + dy * dy);
            table.push(total);
            prev = cur;
          }
          return { table, total };
        }
      };
      WorkerPool = class {
        max;
        active;
        q;
        constructor(maxConcurrency) {
          this.max = maxConcurrency || (typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4);
          this.active = 0;
          this.q = [];
        }
        async schedule(task) {
          return new Promise((resolve, reject) => {
            this.q.push(async () => {
              try {
                resolve(await task());
              } catch (e) {
                reject(e);
              } finally {
                this.active--;
                this._next();
              }
            });
            this._next();
          });
        }
        _next() {
          if (this.active < this.max && this.q.length > 0) {
            this.active++;
            const t = this.q.shift();
            if (t)
              t();
          }
        }
      };
    }
  });

  // src/encoders.ts
  var encoders_exports = {};
  __export(encoders_exports, {
    APNGEncoder: () => APNGEncoder,
    AnimatedGifEncoder: () => AnimatedGifEncoder,
    NativeEncoders: () => NativeEncoders,
    WebPEncoder: () => WebPEncoder
  });
  var NativeEncoders, NQ_NETSIZE, NQ_PRIME1, NQ_PRIME2, NQ_PRIME3, NQ_PRIME4, NQ_MINQUALITY, NQ_MAXQUALITY, NQ_INITRAD, NQ_RADIUSDEC, NQ_INIT_ALPHA, NQ_GAMMA, NQ_BETA, NQ_BETAGAMMA, NeuQuant, AnimatedGifEncoder, WebPEncoder, APNGEncoder;
  var init_encoders = __esm({
    "src/encoders.ts"() {
      "use strict";
      init_core();
      NativeEncoders = class {
        static async encodeBMP(canvas) {
          const ctx = canvas.getContext("2d");
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const w = canvas.width, h = canvas.height, data = imgData.data;
          const fileSize = 54 + w * h * 4;
          if (fileSize > 4294967295)
            throw new Error(`[BMP] Image too large: ${w}x${h} exceeds 4GB BMP limit`);
          const buf = new ArrayBuffer(fileSize);
          const view = new DataView(buf);
          view.setUint16(0, 16973, false);
          view.setUint32(2, fileSize, true);
          view.setUint32(6, 0, true);
          view.setUint32(10, 54, true);
          view.setUint32(14, 40, true);
          view.setUint32(18, w, true);
          view.setUint32(22, h, true);
          view.setUint16(26, 1, true);
          view.setUint16(28, 32, true);
          view.setUint32(38, 2835, true);
          view.setUint32(42, 2835, true);
          const p = new Uint8Array(buf, 54);
          let offset = 0;
          for (let y = h - 1; y >= 0; y--) {
            for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4;
              p[offset++] = data[i + 2];
              p[offset++] = data[i + 1];
              p[offset++] = data[i];
              p[offset++] = data[i + 3];
            }
          }
          return new Blob([buf], { type: "image/bmp" });
        }
        static async encodeWAV(audioBuffer) {
          const nc = audioBuffer.numberOfChannels, sr = audioBuffer.sampleRate;
          const result = new Float32Array(audioBuffer.length * nc);
          for (let ch = 0; ch < nc; ch++) {
            const d = audioBuffer.getChannelData(ch);
            for (let i = 0; i < audioBuffer.length; i++)
              result[i * nc + ch] = d[i];
          }
          const dataSize = result.length * 2;
          if (dataSize > 4294967295 - 44)
            throw new Error(`[WAV] Audio too large: ${result.length} samples exceeds WAV limit`);
          const buf = new ArrayBuffer(44 + dataSize);
          const view = new DataView(buf);
          const ws = (v, o, s) => {
            for (let i = 0; i < s.length; i++)
              v.setUint8(o + i, s.charCodeAt(i));
          };
          ws(view, 0, "RIFF");
          view.setUint32(4, 36 + result.length * 2, true);
          ws(view, 8, "WAVE");
          ws(view, 12, "fmt ");
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true);
          view.setUint16(22, nc, true);
          view.setUint32(24, sr, true);
          view.setUint32(28, sr * nc * 2, true);
          view.setUint16(32, nc * 2, true);
          view.setUint16(34, 16, true);
          ws(view, 36, "data");
          view.setUint32(40, result.length * 2, true);
          let off = 44;
          for (let i = 0; i < result.length; i++, off += 2) {
            const s = Math.max(-1, Math.min(1, result[i]));
            view.setInt16(off, s < 0 ? s * 32768 : s * 32767, true);
          }
          return new Blob([view], { type: "audio/wav" });
        }
      };
      NQ_NETSIZE = 256;
      NQ_PRIME1 = 499;
      NQ_PRIME2 = 491;
      NQ_PRIME3 = 487;
      NQ_PRIME4 = 503;
      NQ_MINQUALITY = 1;
      NQ_MAXQUALITY = 30;
      NQ_INITRAD = 32;
      NQ_RADIUSDEC = 30;
      NQ_INIT_ALPHA = 1024;
      NQ_GAMMA = 1024;
      NQ_BETA = 1 / 1024;
      NQ_BETAGAMMA = 1;
      NeuQuant = class {
        constructor(pixels, quality = 10) {
          this.pixels = pixels;
          this.quality = quality;
          for (let i = 0; i < NQ_NETSIZE; i++) {
            const v = (i << 8) / NQ_NETSIZE;
            this.net[i] = new Float64Array([v, v, v, 0]);
          }
          this.freq.fill(NQ_INIT_ALPHA / NQ_NETSIZE);
          this.bias.fill(0);
        }
        net = [];
        netindex = new Array(256).fill(0);
        bias = new Array(NQ_NETSIZE).fill(0);
        freq = new Array(NQ_NETSIZE).fill(NQ_INIT_ALPHA);
        radpower = [];
        contest(r, g, b) {
          let bestd = Infinity, bestbias = Infinity, best = -1, bestb = -1;
          for (let i = 0; i < NQ_NETSIZE; i++) {
            const n = this.net[i];
            const dist = Math.abs(n[2] - b) + Math.abs(n[1] - g) + Math.abs(n[0] - r);
            if (dist < bestd) {
              bestd = dist;
              best = i;
            }
            const biasdist = dist - this.bias[i];
            if (biasdist < bestbias) {
              bestbias = biasdist;
              bestb = i;
            }
            this.freq[i] -= this.freq[i] * NQ_BETA;
            this.bias[i] += this.freq[i] * NQ_BETAGAMMA;
          }
          this.freq[best] += NQ_BETA;
          this.bias[best] -= NQ_BETAGAMMA;
          return bestb;
        }
        alterSingle(alpha, i, r, g, b) {
          const n = this.net[i];
          n[0] -= alpha * (n[0] - r) / NQ_INIT_ALPHA;
          n[1] -= alpha * (n[1] - g) / NQ_INIT_ALPHA;
          n[2] -= alpha * (n[2] - b) / NQ_INIT_ALPHA;
        }
        alterNeighbours(rad, i, r, g, b) {
          const lo = Math.max(i - rad, 0), hi = Math.min(i + rad, NQ_NETSIZE - 1);
          let j = i + 1, k = i - 1, m = 1;
          while (j <= hi || k >= lo) {
            const alpha = this.radpower[m++] ?? 0;
            if (j <= hi)
              this.alterSingle(alpha, j++, r, g, b);
            if (k >= lo)
              this.alterSingle(alpha, k--, r, g, b);
          }
        }
        learn() {
          const pixels = this.pixels;
          const len = pixels.length;
          const samplefac = Math.max(NQ_MINQUALITY, Math.min(NQ_MAXQUALITY, this.quality));
          const alphaDec = 30 + (samplefac - 1) / 3;
          const samplepixels = Math.floor(len / (4 * samplefac));
          const delta = Math.max(1, Math.floor(samplepixels / 100));
          let alpha = NQ_INIT_ALPHA;
          let radius = NQ_INITRAD;
          let rad = radius >> 0;
          for (let i = 0; i < rad; i++) {
            this.radpower[i] = alpha * ((rad * rad - i * i) * NQ_GAMMA / (rad * rad));
          }
          let step;
          if (len < 400)
            step = 4;
          else if (len % NQ_PRIME1)
            step = 4 * NQ_PRIME1;
          else if (len % NQ_PRIME2)
            step = 4 * NQ_PRIME2;
          else if (len % NQ_PRIME3)
            step = 4 * NQ_PRIME3;
          else
            step = 4 * NQ_PRIME4;
          let pix = 0;
          for (let i = 0; i < samplepixels; i++) {
            const pos = pix % len & ~3;
            const r = pixels[pos], g = pixels[pos + 1], b = pixels[pos + 2];
            const j = this.contest(r, g, b);
            this.alterSingle(alpha, j, r, g, b);
            if (rad > 0)
              this.alterNeighbours(rad, j, r, g, b);
            pix += step;
            if (i % delta === 0 && i > 0) {
              alpha -= Math.floor(alpha / alphaDec);
              radius -= Math.floor(radius / NQ_RADIUSDEC);
              rad = radius >> 0;
              if (rad <= 1)
                rad = 0;
              for (let k = 0; k < rad; k++) {
                this.radpower[k] = alpha * ((rad * rad - k * k) * NQ_GAMMA / (rad * rad));
              }
            }
          }
        }
        buildIndex() {
          let previouscol = 0, startpos = 0;
          for (let i = 0; i < NQ_NETSIZE; i++) {
            const n = this.net[i];
            let smallpos = i, smallval = Math.round(n[1]);
            for (let j = i + 1; j < NQ_NETSIZE; j++) {
              const q = this.net[j];
              if (Math.round(q[1]) < smallval) {
                smallpos = j;
                smallval = Math.round(q[1]);
              }
            }
            [this.net[i], this.net[smallpos]] = [this.net[smallpos], this.net[i]];
            if (smallval !== previouscol) {
              this.netindex[previouscol] = startpos + i >> 1;
              for (let k = previouscol + 1; k < smallval; k++)
                this.netindex[k] = i;
              previouscol = smallval;
              startpos = i;
            }
          }
          this.netindex[previouscol] = startpos + NQ_NETSIZE - 1 >> 1;
          for (let k = previouscol + 1; k < 256; k++)
            this.netindex[k] = NQ_NETSIZE - 1;
        }
        map(r, g, b) {
          let bestd = 1e3, best = -1;
          let i = this.netindex[g], j = i - 1;
          while (i < NQ_NETSIZE || j >= 0) {
            if (i < NQ_NETSIZE) {
              const n = this.net[i];
              let dist = Math.round(n[1]) - g;
              if (dist > bestd) {
                i = NQ_NETSIZE;
              } else {
                i++;
                dist = Math.abs(dist) + Math.abs(Math.round(n[0]) - r);
                if (dist < bestd) {
                  dist += Math.abs(Math.round(n[2]) - b);
                  if (dist < bestd) {
                    bestd = dist;
                    best = i - 1;
                  }
                }
              }
            }
            if (j >= 0) {
              const n = this.net[j];
              let dist = g - Math.round(n[1]);
              if (dist > bestd) {
                j = -1;
              } else {
                j--;
                dist = Math.abs(dist) + Math.abs(Math.round(n[0]) - r);
                if (dist < bestd) {
                  dist += Math.abs(Math.round(n[2]) - b);
                  if (dist < bestd) {
                    bestd = dist;
                    best = j + 1;
                  }
                }
              }
            }
          }
          return best;
        }
        getPalette() {
          const p = new Uint8Array(NQ_NETSIZE * 3);
          for (let i = 0; i < NQ_NETSIZE; i++) {
            p[i * 3 + 0] = Math.round(this.net[i][0]);
            p[i * 3 + 1] = Math.round(this.net[i][1]);
            p[i * 3 + 2] = Math.round(this.net[i][2]);
          }
          return p;
        }
      };
      AnimatedGifEncoder = class {
        w;
        h;
        fps;
        _indices = [];
        _delays = [];
        _palette = null;
        _nq = null;
        _samplePixels = [];
        _sampleCount = 0;
        canvas;
        ctx;
        quantizerQuality = 10;
        _maxSamples = 16;
        constructor(w, h, fps = 30) {
          this.w = w;
          this.h = h;
          this.fps = fps;
          this.canvas = new OffscreenCanvas(w, h);
          this.ctx = this.canvas.getContext("2d");
        }
        async addFrame(videoFrame, delayMs = Math.round(1e3 / this.fps)) {
          try {
            try {
              this.ctx.drawImage(videoFrame, 0, 0, this.w, this.h);
            } catch (_) {
              const bmp = await createImageBitmap(videoFrame);
              this.ctx.drawImage(bmp, 0, 0, this.w, this.h);
              try {
                bmp.close();
              } catch (__) {
              }
            }
            const data = this.ctx.getImageData(0, 0, this.w, this.h).data;
            if (this._sampleCount < this._maxSamples) {
              this._samplePixels.push(new Uint8ClampedArray(data.buffer.slice(0)));
              this._sampleCount++;
            }
            if (!this._nq) {
              this._indices.push(new Uint8Array(0));
            } else {
              const idx = new Uint8Array(this.w * this.h);
              for (let i = 0, n = this.w * this.h; i < n; i++) {
                idx[i] = this._nq.map(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
              }
              this._indices.push(idx);
            }
            this._delays.push(delayMs);
          } catch (err) {
            try {
              log.error("[GIF] addFrame error", err instanceof Error ? err : new Error(String(err)));
            } catch (_) {
            }
          }
        }
        async encode() {
          const w = this.w, h = this.h;
          const sampleCount = Math.min(this._maxSamples, this._samplePixels.length);
          let totalLen = 0;
          for (let i = 0; i < sampleCount; i++)
            totalLen += this._samplePixels[i].length;
          const combined = new Uint8ClampedArray(totalLen);
          let off = 0;
          for (let i = 0; i < sampleCount; i++) {
            combined.set(this._samplePixels[i], off);
            off += this._samplePixels[i].length;
          }
          this._samplePixels = [];
          const nq = new NeuQuant(combined, this.quantizerQuality);
          nq.learn();
          nq.buildIndex();
          this._nq = nq;
          this._palette = nq.getPalette();
          for (let i = 0; i < this._indices.length; i++) {
            if (this._indices[i].length === 0 && i < this._samplePixels.length)
              break;
          }
          const palette = this._palette;
          const chunks = [];
          const hdr = [];
          const w16 = (v) => {
            hdr.push(v & 255, v >> 8 & 255);
          };
          const wstr = (s) => {
            for (const c of s)
              hdr.push(c.charCodeAt(0));
          };
          wstr("GIF89a");
          w16(w);
          w16(h);
          hdr.push(247, 0, 0);
          for (let i = 0; i < 256; i++) {
            hdr.push(palette[i * 3] ?? 0, palette[i * 3 + 1] ?? 0, palette[i * 3 + 2] ?? 0);
          }
          hdr.push(33, 255, 11);
          wstr("NETSCAPE2.0");
          hdr.push(3, 1);
          w16(0);
          hdr.push(0);
          chunks.push(new Uint8Array(hdr));
          for (let fi = 0; fi < this._indices.length; fi++) {
            let indices = this._indices[fi];
            if (indices.length === 0 && fi < sampleCount) {
              const pxData = this.ctx.getImageData(0, 0, w, h).data;
              indices = new Uint8Array(w * h);
              for (let i = 0; i < w * h; i++) {
                indices[i] = nq.map(pxData[i * 4], pxData[i * 4 + 1], pxData[i * 4 + 2]);
              }
              this._indices[fi] = indices;
            }
            const frameBuf = [];
            frameBuf.push(33, 249, 4, 0);
            const delay = Math.round(this._delays[fi] / 10);
            frameBuf.push(delay & 255, delay >> 8 & 255);
            frameBuf.push(0, 0);
            frameBuf.push(44);
            frameBuf.push(0, 0, 0, 0);
            frameBuf.push(w & 255, w >> 8 & 255);
            frameBuf.push(h & 255, h >> 8 & 255);
            frameBuf.push(0, 8);
            this._lzwEncode(indices, frameBuf);
            frameBuf.push(0);
            chunks.push(new Uint8Array(frameBuf));
          }
          chunks.push(new Uint8Array([59]));
          return new Blob(chunks, { type: "image/gif" });
        }
        _lzwEncode(indices, out) {
          const clearCode = 256, endCode = 257;
          let nextCode = 258, codeSize = 9;
          let bitBuf = 0, bitCnt = 0, block = [];
          const writeBits = (val, size) => {
            bitBuf |= val << bitCnt;
            bitCnt += size;
            while (bitCnt >= 8) {
              block.push(bitBuf & 255);
              bitBuf >>= 8;
              bitCnt -= 8;
              if (block.length === 255) {
                out.push(255, ...block);
                block = [];
              }
            }
          };
          writeBits(clearCode, codeSize);
          const dict = /* @__PURE__ */ new Map();
          let prefix = indices[0];
          for (let i = 1; i < indices.length; i++) {
            const suffix = indices[i];
            const key = prefix * 4096 + suffix;
            if (dict.has(key)) {
              prefix = dict.get(key);
            } else {
              writeBits(prefix, codeSize);
              if (nextCode < 4096) {
                dict.set(key, nextCode++);
                if (nextCode === 1 << codeSize && codeSize < 12)
                  codeSize++;
              } else {
                writeBits(clearCode, codeSize);
                dict.clear();
                nextCode = 258;
                codeSize = 9;
              }
              prefix = suffix;
            }
          }
          writeBits(prefix, codeSize);
          writeBits(endCode, codeSize);
          if (bitCnt > 0)
            block.push(bitBuf & 255);
          if (block.length > 0) {
            out.push(block.length, ...block);
          }
        }
      };
      WebPEncoder = class {
        static async encode(source, quality = 0.9) {
          if ("convertToBlob" in source) {
            return source.convertToBlob({ type: "image/webp", quality });
          }
          if (source instanceof HTMLCanvasElement) {
            return new Promise(
              (res, rej) => source.toBlob((b) => b ? res(b) : rej(new Error("WebP failed")), "image/webp", quality)
            );
          }
          const oc = new OffscreenCanvas(
            source.width,
            source.height
          );
          const ctx = oc.getContext("2d");
          ctx.drawImage(source, 0, 0);
          return oc.convertToBlob({ type: "image/webp", quality });
        }
        static async encodeFromBitmap(frame, quality = 0.9) {
          const oc = new OffscreenCanvas(frame.width, frame.height);
          const ctx = oc.getContext("2d");
          ctx.drawImage(frame, 0, 0);
          return oc.convertToBlob({ type: "image/webp", quality });
        }
      };
      APNGEncoder = class _APNGEncoder {
        frames = [];
        w;
        h;
        constructor(width, height) {
          this.w = width;
          this.h = height;
        }
        async addFrame(source, delayMs) {
          let oc;
          if (source instanceof OffscreenCanvas) {
            oc = source;
          } else {
            oc = new OffscreenCanvas(this.w, this.h);
            oc.getContext("2d").drawImage(source, 0, 0);
          }
          const blob = await oc.convertToBlob({ type: "image/png" });
          const ab = await blob.arrayBuffer();
          this.frames.push({ data: new Uint8Array(ab), delay: delayMs });
        }
        async encode() {
          if (this.frames.length === 0)
            throw new Error("No frames");
          const out = [];
          const u32 = (v) => {
            const b = new Uint8Array(4);
            new DataView(b.buffer).setUint32(0, v);
            return b;
          };
          const crc32 = _APNGEncoder._crc32;
          const chunk = (type, data) => {
            const tBytes = new TextEncoder().encode(type);
            const payload = new Uint8Array(tBytes.length + data.length);
            payload.set(tBytes);
            payload.set(data, tBytes.length);
            const result2 = new Uint8Array(4 + 4 + data.length + 4);
            result2.set(u32(data.length));
            result2.set(tBytes, 4);
            result2.set(data, 8);
            new DataView(result2.buffer).setUint32(8 + data.length, crc32(payload));
            return result2;
          };
          const base = this.frames[0].data;
          const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
          out.push(PNG_SIG);
          const readChunk = (src, at) => {
            const dv = new DataView(src.buffer, src.byteOffset + at);
            const length = dv.getUint32(0);
            const type = String.fromCharCode(...src.slice(at + 4, at + 8));
            const data = src.slice(at + 8, at + 8 + length);
            return { type, data, next: at + 12 + length };
          };
          const ihdr = readChunk(base, 8);
          out.push(chunk("IHDR", ihdr.data));
          const actl = new Uint8Array(8);
          const actlDV = new DataView(actl.buffer);
          actlDV.setUint32(0, this.frames.length);
          actlDV.setUint32(4, 0);
          out.push(chunk("acTL", actl));
          let seqNum = 0;
          for (let fi = 0; fi < this.frames.length; fi++) {
            const f = this.frames[fi];
            const fctl = new Uint8Array(26);
            const fctlDV = new DataView(fctl.buffer);
            fctlDV.setUint32(0, seqNum++);
            fctlDV.setUint32(4, this.w);
            fctlDV.setUint32(8, this.h);
            fctlDV.setUint32(12, 0);
            fctlDV.setUint32(16, 0);
            fctlDV.setUint16(20, f.delay);
            fctlDV.setUint16(22, 1e3);
            fctl[24] = 1;
            fctl[25] = 0;
            out.push(chunk("fcTL", fctl));
            const framePng = f.data;
            let fpos = 8;
            while (fpos < framePng.length - 12) {
              const { type, data, next } = readChunk(framePng, fpos);
              fpos = next;
              if (type === "IDAT") {
                if (fi === 0) {
                  out.push(chunk("IDAT", data));
                } else {
                  const fdat = new Uint8Array(4 + data.length);
                  new DataView(fdat.buffer).setUint32(0, seqNum++);
                  fdat.set(data, 4);
                  out.push(chunk("fdAT", fdat));
                }
              }
              if (type === "IEND")
                break;
            }
          }
          out.push(chunk("IEND", new Uint8Array(0)));
          const total = out.reduce((s, b) => s + b.length, 0);
          const result = new Uint8Array(total);
          let offset = 0;
          for (const b of out) {
            result.set(b, offset);
            offset += b.length;
          }
          return new Blob([result], { type: "image/apng" });
        }
        static _crc32Table = null;
        static _initCrcTable() {
          if (_APNGEncoder._crc32Table)
            return _APNGEncoder._crc32Table;
          const t = new Uint32Array(256);
          for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++)
              c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
            t[n] = c;
          }
          _APNGEncoder._crc32Table = t;
          return t;
        }
        static _crc32(data) {
          const t = _APNGEncoder._initCrcTable();
          let crc = 4294967295;
          for (let i = 0; i < data.length; i++)
            crc = t[(crc ^ data[i]) & 255] ^ crc >>> 8;
          return (crc ^ 4294967295) >>> 0;
        }
      };
    }
  });

  // src/index.ts
  var src_exports = {};
  __export(src_exports, {
    ACESToneMappingEngine: () => ACESToneMappingEngine,
    AISegmentEngine: () => AISegmentEngine,
    APNGEncoder: () => APNGEncoder,
    AUDIO_WORKLET_CODE: () => AUDIO_WORKLET_CODE,
    AVIDemuxer: () => AVIDemuxer,
    AegisAudioWorklet: () => AegisAudioWorklet,
    AegisCore: () => AegisCore,
    AegisError: () => AegisError,
    AegisMuxer: () => AegisMuxer,
    AegisSwarm: () => AegisSwarm,
    AegisWebNN: () => AegisWebNN,
    AnimatedGifEncoder: () => AnimatedGifEncoder,
    AsciiEngine: () => AsciiEngine,
    Aud: () => Aud,
    AudStream: () => AudStream,
    AutoSync: () => AutoSync,
    BezierKeyframeEngine: () => BezierKeyframeEngine,
    BlendEngine: () => BlendEngine,
    BloomEngine: () => BloomEngine,
    BoomerangEngine: () => BoomerangEngine,
    CPUEffects: () => CPUEffects,
    CRTEngine: () => CRTEngine,
    CSChromaFormat: () => CSChromaFormat,
    CSColorSpace: () => CSColorSpace,
    CatmullRomPath: () => CatmullRomPath,
    ColorGradeEngine: () => ColorGradeEngine,
    ColorSpace: () => ColorSpace,
    ColorSpaceConverter: () => ColorSpaceConverter,
    CompositeGL: () => CompositeGL,
    DOMRenderer: () => DOMRenderer,
    DirectTranscoder: () => DirectTranscoder,
    DistortEngine: () => DistortEngine,
    FBOChain: () => FBOChain,
    FFT: () => FFT,
    FLVDemuxer: () => FLVDemuxer,
    FallbackRouter: () => FallbackRouter,
    FastRenderPipeline: () => FastRenderPipeline,
    FractalEngine: () => FractalEngine,
    FrameCache: () => FrameCache,
    GL: () => GL,
    GPUTier: () => GPUTier,
    GaussianBlurEngine: () => GaussianBlurEngine,
    HistoryManager: () => HistoryManager,
    IMDCT: () => IMDCT,
    Img: () => Img,
    InteractiveCanvas: () => InteractiveCanvas,
    IntervalTree: () => IntervalTree,
    KeyframeEngine: () => KeyframeEngine,
    LUT3DEngine: () => LUT3DEngine,
    Logger: () => Logger,
    LottieDecoder: () => LottieDecoder,
    LumaKeyEngine: () => LumaKeyEngine,
    MAX_LAYERS: () => MAX_LAYERS,
    MKVDemuxer: () => MKVDemuxer,
    MP4Demuxer: () => MP4Demuxer,
    MagneticTimeline: () => MagneticTimeline,
    MediaStreamRecorder: () => MediaStreamRecorder,
    MotionTrackerEngine: () => MotionTrackerEngine,
    MultiLayerCompositor: () => MultiLayerCompositor,
    MulticamEditor: () => MulticamEditor,
    NativeEncoders: () => NativeEncoders,
    OggDemuxer: () => OggDemuxer,
    OpticalFlowEngine: () => OpticalFlowEngine,
    ParticleSystem: () => ParticleSystem,
    ProjectManager: () => ProjectManager,
    RationalTimecode: () => RationalTimecode,
    ResourceManager: () => ResourceManager,
    SDFTextRenderer: () => SDFTextRenderer,
    SegmentEngine: () => SegmentEngine,
    Shaders: () => Shaders,
    SincResampler: () => SincResampler,
    SlabAllocator: () => SlabAllocator,
    StreamingAVIDemuxer: () => StreamingAVIDemuxer,
    StreamingFLVDemuxer: () => StreamingFLVDemuxer,
    TimestampSync: () => TimestampSync,
    Vid: () => Vid,
    VideoStabilizer: () => VideoStabilizer,
    WebGPUEngine: () => WebGPUEngine,
    WebGPUSegmentEngine: () => WebGPUSegmentEngine,
    WebMDemuxer: () => WebMDemuxer,
    WebPEncoder: () => WebPEncoder,
    WorkerPool: () => WorkerPool,
    YUVConverter: () => YUVConverter,
    autoBeatSync: () => autoBeatSync,
    beatsyncPlugin: () => beatsyncPlugin,
    binauralBeats: () => binauralBeats,
    bindVideoFrameTexture: () => bindVideoFrameTexture,
    blackmanHarrisWindow: () => blackmanHarrisWindow,
    bloomPlugin: () => bloomPlugin,
    boomerang: () => boomerang,
    chiptune: () => chiptune,
    detectOnsets: () => detectOnsets,
    estimateBPM: () => estimateBPM,
    getVJParam: () => getVJParam,
    hammingWindow: () => hammingWindow,
    hannWindow: () => hannWindow,
    log: () => log,
    magnitude: () => magnitude,
    parseSRT: () => parseSRT,
    parseVTT: () => parseVTT,
    rgbGlitch: () => rgbGlitch,
    roomTone: () => roomTone,
    scheduleGainAutomation: () => scheduleGainAutomation,
    segmentPlugin: () => segmentPlugin,
    spectrogramStego: () => spectrogramStego,
    stabilizePlugin: () => stabilizePlugin,
    subtitlePlugin: () => subtitlePlugin,
    vjMidiMap: () => vjMidiMap,
    windowAIModel: () => windowAIModel
  });
  init_core();

  // src/media.ts
  init_core();

  // src/audio/resample.ts
  var SincResampler = class {
    srcRate;
    dstRate;
    kernelWidth;
    kaiserBeta;
    ratio;
    filterTable;
    filterSize;
    tableRes;
    constructor(srcRate, dstRate, kernelWidth = 16, kaiserBeta = 6) {
      this.srcRate = srcRate;
      this.dstRate = dstRate;
      this.kernelWidth = kernelWidth;
      this.kaiserBeta = kaiserBeta;
      this.ratio = dstRate / srcRate;
      this.tableRes = 512;
      this.filterSize = kernelWidth * 2 + 1;
      this.filterTable = new Float64Array(this.tableRes * this.filterSize);
      this._buildFilterTable();
    }
    _buildFilterTable() {
      const cutoff = Math.min(1, this.ratio < 1 ? this.ratio : 1 / this.ratio) * 0.95;
      for (let phase = 0; phase < this.tableRes; phase++) {
        const frac = phase / this.tableRes;
        let sum = 0;
        for (let i = 0; i < this.filterSize; i++) {
          const x = i - this.kernelWidth - frac;
          const sinc = Math.abs(x) < 1e-12 ? cutoff : Math.sin(Math.PI * cutoff * x) / (Math.PI * x);
          const kaiser = this._kaiser(x / (this.kernelWidth + 1));
          const val = sinc * kaiser;
          this.filterTable[phase * this.filterSize + i] = val;
          sum += val;
        }
        if (Math.abs(sum) > 1e-12) {
          const inv = 1 / sum;
          for (let i = 0; i < this.filterSize; i++) {
            this.filterTable[phase * this.filterSize + i] *= inv;
          }
        }
      }
    }
    _kaiser(x) {
      if (Math.abs(x) > 1)
        return 0;
      return this._bessel0(this.kaiserBeta * Math.sqrt(1 - x * x)) / this._bessel0(this.kaiserBeta);
    }
    _bessel0(x) {
      let sum = 1, term = 1;
      const x2 = x * x * 0.25;
      for (let k = 1; k < 20; k++) {
        term *= x2 / (k * k);
        sum += term;
        if (term < 1e-15)
          break;
      }
      return sum;
    }
    process(input) {
      const outLen = Math.ceil(input.length * this.ratio);
      const output = new Float32Array(outLen);
      const invRatio = this.srcRate / this.dstRate;
      for (let i = 0; i < outLen; i++) {
        const srcPos = i * invRatio;
        const srcInt = Math.floor(srcPos);
        const srcFrac = srcPos - srcInt;
        const phaseIdx = Math.min(Math.floor(srcFrac * this.tableRes), this.tableRes - 1);
        const filterOffset = phaseIdx * this.filterSize;
        let sum = 0;
        for (let j = 0; j < this.filterSize; j++) {
          const idx = srcInt + j - this.kernelWidth;
          if (idx >= 0 && idx < input.length) {
            sum += input[idx] * this.filterTable[filterOffset + j];
          }
        }
        output[i] = sum;
      }
      return output;
    }
    processMultiChannel(input, channels) {
      const frames = Math.floor(input.length / channels);
      const outFrames = Math.ceil(frames * this.ratio);
      const output = new Float32Array(outFrames * channels);
      for (let ch = 0; ch < channels; ch++) {
        const mono = new Float32Array(frames);
        for (let i = 0; i < frames; i++)
          mono[i] = input[i * channels + ch];
        const resampled = this.process(mono);
        for (let i = 0; i < outFrames && i < resampled.length; i++) {
          output[i * channels + ch] = resampled[i];
        }
      }
      return output;
    }
    static gcdRates(a, b) {
      while (b) {
        [a, b] = [b, a % b];
      }
      return a;
    }
  };

  // src/media.ts
  var Img = class _Img {
    w;
    h;
    c;
    x;
    constructor(s) {
      log.assert(s != null, "src!null");
      try {
        this.w = ("width" in s ? s.width : 0) || s.displayWidth || ("videoWidth" in s ? s.videoWidth : 0) || 100;
        this.h = ("height" in s ? s.height : 0) || s.displayHeight || ("videoHeight" in s ? s.videoHeight : 0) || 100;
        const { c, x } = _Img._c(this.w, this.h);
        this.c = c;
        this.x = x;
        this.x.drawImage(s, 0, 0, this.w, this.h);
      } catch (e) {
        throw new AegisError("ImgInitFail", e);
      } finally {
        if (s && typeof s.close === "function")
          s.close();
      }
    }
    static _c(w, h) {
      if (typeof OffscreenCanvas !== "undefined") {
        const c2 = new OffscreenCanvas(w, h);
        const x2 = c2.getContext("2d", { willReadFrequently: true });
        return { c: c2, x: x2 };
      }
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const x = c.getContext("2d", { willReadFrequently: true });
      return { c, x };
    }
    static async load(s) {
      log.assert(s != null, "null src");
      if (s instanceof Blob || s instanceof File) {
        return new _Img(await createImageBitmap(s));
      }
      if (typeof s === "string") {
        const r = await fetch(s);
        log.assert(r.ok, "HTTP " + r.status);
        return new _Img(await createImageBitmap(await r.blob()));
      }
      return new _Img(await createImageBitmap(s));
    }
    resize(w, h, f = "contain") {
      w = Math.max(1, w | 0);
      h = Math.max(1, h | 0);
      const { c, x } = _Img._c(w, h);
      let dx = 0, dy = 0, dw = w, dh = h;
      if (f !== "stretch") {
        const rs = this.w / this.h, rt = w / h;
        if (f === "contain" && rs > rt || f === "cover" && rs < rt) {
          dh = w / rs;
          dy = (h - dh) / 2;
        } else {
          dw = h * rs;
          dx = (w - dw) / 2;
        }
      }
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = "high";
      x.drawImage(this.c, 0, 0, this.w, this.h, dx, dy, dw, dh);
      this.close();
      this.c = c;
      this.x = x;
      this.w = w;
      this.h = h;
      return this;
    }
    color(o = {}) {
      const f = [];
      if (o.brightness !== void 0)
        f.push(`brightness(${o.brightness})`);
      if (o.contrast !== void 0)
        f.push(`contrast(${o.contrast})`);
      if (o.blur !== void 0)
        f.push(`blur(${o.blur}px)`);
      if (o.grayscale !== void 0)
        f.push(`grayscale(${o.grayscale})`);
      if (o.invert !== void 0)
        f.push(`invert(${o.invert})`);
      if (f.length && this.x) {
        const { c, x } = _Img._c(this.w, this.h);
        x.filter = f.join(" ");
        x.drawImage(this.c, 0, 0);
        x.filter = "none";
        this.close();
        this.c = c;
        this.x = x;
      }
      return this;
    }
    chromaKey(tc = [0, 255, 0], tol = 50) {
      if (!this.x)
        return this;
      const id = this.x.getImageData(0, 0, this.w, this.h);
      const d = id.data;
      const u32 = new Uint32Array(d.buffer);
      const [tr, tg, tb] = tc;
      const tolSq = tol * tol;
      for (let i = 0, len = u32.length; i < len; i++) {
        const px = u32[i];
        const dr = (px & 255) - tr;
        const dg = (px >> 8 & 255) - tg;
        const db = (px >> 16 & 255) - tb;
        if (dr * dr + dg * dg + db * db < tolSq)
          u32[i] = px & 16777215;
      }
      this.x.putImageData(id, 0, 0);
      return this;
    }
    overlay(i, x = 0, y = 0, a = 1) {
      if (!this.x || !i.c)
        return this;
      const p = this.x.globalAlpha;
      this.x.globalAlpha = a;
      this.x.drawImage(i.c, x, y);
      this.x.globalAlpha = p;
      return this;
    }
    text(t, x, y, o = {}) {
      if (!this.x)
        return this;
      this.x.font = `${o.weight || "bold"} ${o.size || 24}px ${o.font || "sans-serif"}`;
      this.x.fillStyle = o.color || "white";
      this.x.textAlign = o.align || "left";
      this.x.textBaseline = o.baseline || "top";
      if (o.outline) {
        this.x.strokeStyle = o.outline || "black";
        this.x.lineWidth = o.outlineWidth || 4;
        this.x.strokeText(t, x, y);
      }
      this.x.fillText(t, x, y);
      return this;
    }
    createFrame(ts, d = 0) {
      return new VideoFrame(this.c, { timestamp: ts, duration: d, alpha: "discard" });
    }
    close() {
      if (this.c) {
        this.c.width = this.c.height = 0;
        this.c = null;
      }
      this.x = null;
    }
  };
  var Aud = class _Aud {
    b;
    static _ctx = null;
    static get ctx() {
      if (!_Aud._ctx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass)
          throw new AegisError("AudioContext not available");
        _Aud._ctx = new AudioContextClass();
      }
      return _Aud._ctx;
    }
    constructor(b) {
      this.b = b;
    }
    static async load(s) {
      let x = _Aud.ctx;
      if (x.state === "suspended") {
        try {
          await x.resume();
        } catch (e) {
          log.warn("AudioContext resume failed", e);
        }
      }
      try {
        let b;
        if (s instanceof Blob || s instanceof File) {
          b = await x.decodeAudioData(await s.arrayBuffer());
        } else if (s instanceof ArrayBuffer) {
          b = await x.decodeAudioData(s.slice(0));
        } else if (typeof s === "string") {
          const r = await fetch(s);
          b = await x.decodeAudioData(await r.arrayBuffer());
        } else {
          throw new Error("Unknown Audio Source");
        }
        return new _Aud(b);
      } catch (e) {
        throw new AegisError("AudLoadFail", e);
      }
    }
    static async stream(mediaStream) {
      const actx = _Aud.ctx;
      const src = actx.createMediaStreamSource(mediaStream);
      const dest = actx.createMediaStreamDestination();
      src.connect(dest);
      return new AudStream(dest.stream);
    }
    async mix(o, st = 0, v = 1) {
      const x = new OfflineAudioContext(
        Math.max(this.b.numberOfChannels, o.b.numberOfChannels),
        Math.max(this.b.length, st * this.b.sampleRate + o.b.length),
        this.b.sampleRate
      );
      const s1 = x.createBufferSource();
      s1.buffer = this.b;
      s1.connect(x.destination);
      s1.start(0);
      const s2 = x.createBufferSource();
      s2.buffer = o.b;
      const g = x.createGain();
      g.gain.value = v;
      s2.connect(g);
      g.connect(x.destination);
      s2.start(st);
      const ab = await x.startRendering();
      this.b = ab;
      return this;
    }
    _offCtx(len) {
      const Ctx = globalThis.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Ctx)
        throw new AegisError("OfflineAudioContext not available");
      return new Ctx(this.b.numberOfChannels, len, this.b.sampleRate);
    }
    async pan(value) {
      const x = this._offCtx(this.b.length);
      const s = x.createBufferSource();
      s.buffer = this.b;
      if (x.createStereoPanner) {
        const p = x.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, value));
        s.connect(p);
        p.connect(x.destination);
      } else {
        const p = x.createPanner();
        p.panningModel = "equalpower";
        p.setPosition(value, 0, 1 - Math.abs(value));
        s.connect(p);
        p.connect(x.destination);
      }
      s.start(0);
      this.b = await x.startRendering();
      return this;
    }
    async normalize(threshold = -24, ratio = 12) {
      const x = this._offCtx(this.b.length);
      const s = x.createBufferSource();
      s.buffer = this.b;
      const c = x.createDynamicsCompressor();
      c.threshold.value = threshold;
      c.ratio.value = ratio;
      c.knee.value = 30;
      c.attack.value = 3e-3;
      c.release.value = 0.25;
      s.connect(c);
      c.connect(x.destination);
      s.start(0);
      this.b = await x.startRendering();
      return this;
    }
    async reverb(duration = 2, decay = 2) {
      const ch = Math.max(2, this.b.numberOfChannels);
      const Ctx = globalThis.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Ctx)
        throw new AegisError("OfflineAudioContext not available");
      const x = new Ctx(ch, this.b.length, this.b.sampleRate);
      const s = x.createBufferSource();
      s.buffer = this.b;
      const len = x.sampleRate * duration;
      const imp = x.createBuffer(2, len, x.sampleRate);
      for (let i = 0; i < 2; i++) {
        const c = imp.getChannelData(i);
        for (let j = 0; j < len; j++)
          c[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / len, decay);
      }
      const conv = x.createConvolver();
      conv.buffer = imp;
      s.connect(conv);
      conv.connect(x.destination);
      s.start(0);
      this.b = await x.startRendering();
      return this;
    }
    async echo(delayTime = 0.5, feedback = 0.5) {
      const x = this._offCtx(this.b.length + delayTime * 5 * this.b.sampleRate);
      const s = x.createBufferSource();
      s.buffer = this.b;
      const d = x.createDelay(delayTime * 2);
      d.delayTime.value = delayTime;
      const fb = x.createGain();
      fb.gain.value = feedback;
      const wet = x.createGain();
      wet.gain.value = 0.5;
      s.connect(x.destination);
      s.connect(d);
      d.connect(fb);
      fb.connect(d);
      d.connect(wet);
      wet.connect(x.destination);
      s.start(0);
      this.b = await x.startRendering();
      return this;
    }
    async pitchScale(rate) {
      const newLen = Math.floor(this.b.length / rate);
      const x = this._offCtx(newLen);
      const s = x.createBufferSource();
      s.buffer = this.b;
      s.playbackRate.value = rate;
      s.connect(x.destination);
      s.start(0);
      this.b = await x.startRendering();
      return this;
    }
    async karaoke() {
      if (this.b.numberOfChannels < 2)
        return this;
      const x = this._offCtx(this.b.length);
      const s = x.createBufferSource();
      s.buffer = this.b;
      const spl = x.createChannelSplitter(2);
      const gL = x.createGain();
      gL.gain.value = 1;
      const gR = x.createGain();
      gR.gain.value = -1;
      s.connect(spl);
      spl.connect(gL, 0);
      spl.connect(gR, 1);
      gL.connect(x.destination);
      gR.connect(x.destination);
      s.start(0);
      this.b = await x.startRendering();
      return this;
    }
    async bleep(startSec, endSec, freq = 1e3) {
      const x = this._offCtx(this.b.length);
      const s = x.createBufferSource();
      s.buffer = this.b;
      const dry = x.createGain();
      dry.gain.setValueAtTime(1, 0);
      dry.gain.setValueAtTime(1, Math.max(0, startSec - 0.01));
      dry.gain.setValueAtTime(0, startSec);
      dry.gain.setValueAtTime(0, endSec);
      dry.gain.setValueAtTime(1, endSec + 0.01);
      s.connect(dry);
      dry.connect(x.destination);
      s.start(0);
      const osc = x.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const oGain = x.createGain();
      oGain.gain.setValueAtTime(0, 0);
      oGain.gain.setValueAtTime(0, Math.max(0, startSec - 0.01));
      oGain.gain.setValueAtTime(1, startSec);
      oGain.gain.setValueAtTime(1, endSec);
      oGain.gain.setValueAtTime(0, endSec + 0.01);
      osc.connect(oGain);
      oGain.connect(x.destination);
      osc.start(0);
      osc.stop(endSec + 0.1);
      this.b = await x.startRendering();
      return this;
    }
    removeSilence(thresholdDb = -50, minDurationSec = 0.5) {
      const th = Math.pow(10, thresholdDb / 20);
      const minLen = Math.floor(minDurationSec * this.b.sampleRate);
      const numCh = this.b.numberOfChannels;
      const len = this.b.length;
      const channels = [];
      for (let c = 0; c < numCh; c++)
        channels.push(this.b.getChannelData(c));
      let runs = [], cur = -1;
      for (let i = 0; i < len; i++) {
        let maxAbs = 0;
        for (let c = 0; c < numCh; c++)
          maxAbs = Math.max(maxAbs, Math.abs(channels[c][i]));
        if (maxAbs < th) {
          if (cur === -1)
            cur = i;
        } else if (cur !== -1) {
          if (i - cur >= minLen)
            runs.push({ s: cur, e: i });
          cur = -1;
        }
      }
      if (cur !== -1 && len - cur >= minLen)
        runs.push({ s: cur, e: len });
      if (!runs.length)
        return this;
      let removed = 0;
      for (let r of runs)
        removed += r.e - r.s;
      const newLen = this.b.length - removed;
      const x = this._offCtx(newLen);
      const nb = x.createBuffer(this.b.numberOfChannels, newLen, this.b.sampleRate);
      for (let c = 0; c < this.b.numberOfChannels; c++) {
        const oldD = this.b.getChannelData(c), newD = nb.getChannelData(c);
        let ptr = 0, ridx = 0;
        for (let i = 0; i < oldD.length; i++) {
          if (ridx < runs.length && i >= runs[ridx].s && i < runs[ridx].e) {
            if (i === runs[ridx].e - 1)
              ridx++;
            continue;
          }
          newD[ptr++] = oldD[i];
        }
      }
      this.b = nb;
      return this;
    }
    getWaveform(bins = 100) {
      const d = this.b.getChannelData(0), step = Math.floor(d.length / bins), res = [];
      for (let i = 0; i < bins; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++)
          sum += Math.abs(d[i * step + j]);
        res.push(sum / step);
      }
      return res;
    }
    *generate(f = 1024, sp = 0) {
      if (!("AudioData" in globalThis))
        throw new Error("[Aud] AudioData API not available \u2014 requires Chromium-based browser");
      const AudioDataCtor = globalThis.AudioData;
      const r = this.b.sampleRate;
      const c = this.b.numberOfChannels;
      const l = this.b.length;
      let p = sp;
      for (let i = 0; i < l; i += f) {
        const s = Math.min(f, l - i);
        const d = new Float32Array(s * c);
        let o = 0;
        for (let j = 0; j < c; j++) {
          d.set(this.b.getChannelData(j).subarray(i, i + s), o);
          o += s;
        }
        yield {
          audioData: new AudioDataCtor({
            format: "f32-planar",
            sampleRate: r,
            numberOfFrames: s,
            numberOfChannels: c,
            timestamp: p,
            data: d
          }),
          framesCount: s
        };
        p += Math.floor(s / r * 1e6);
      }
    }
    static async *mixWebStreams(inputs, targetSr, targetCh, chunkSize = 8192) {
      if (!inputs.length)
        return;
      const tracks = inputs.map((i) => ({
        aud: i.aud,
        startSamples: Math.floor(i.start / 1e3 * targetSr),
        length: 0,
        volume: i.volume ?? 1,
        needsResample: i.aud.b.sampleRate !== targetSr
      }));
      const resamplers = /* @__PURE__ */ new Map();
      for (let ti = 0; ti < tracks.length; ti++) {
        if (tracks[ti].needsResample) {
          const chMap = /* @__PURE__ */ new Map();
          for (let ch = 0; ch < targetCh && ch < tracks[ti].aud.b.numberOfChannels; ch++) {
            chMap.set(ch, new SincResampler(tracks[ti].aud.b.sampleRate, targetSr));
          }
          resamplers.set(ti, chMap);
        }
      }
      let maxLen = 0;
      for (const t of tracks) {
        const durInSeconds = t.aud.b.length / t.aud.b.sampleRate;
        t.length = t.startSamples + Math.floor(durInSeconds * targetSr);
        if (t.length > maxLen)
          maxLen = t.length;
      }
      let p = 0;
      for (let i = 0; i < maxLen; i += chunkSize) {
        const s = Math.min(chunkSize, maxLen - i);
        const d = new Float32Array(s * targetCh);
        let o = 0;
        for (let j = 0; j < targetCh; j++) {
          const channelData = new Float32Array(s);
          for (const t of tracks) {
            const trackStartInChunk = Math.max(0, t.startSamples - i);
            const trackEndInChunk = Math.min(s, t.length - i);
            if (trackStartInChunk < trackEndInChunk && j < t.aud.b.numberOfChannels) {
              const srcChannel = t.aud.b.getChannelData(j);
              const writeLen = trackEndInChunk - trackStartInChunk;
              const vol = t.volume;
              if (t.needsResample) {
                const ti = tracks.indexOf(t);
                const resampler = resamplers.get(ti).get(j);
                const srcStart = Math.floor((i + trackStartInChunk - t.startSamples) * (t.aud.b.sampleRate / targetSr));
                const srcEnd = Math.min(srcChannel.length, srcStart + Math.ceil(writeLen * (t.aud.b.sampleRate / targetSr)));
                const seg = srcChannel.subarray(Math.max(0, srcStart), srcEnd);
                const resampled = resampler.process(seg);
                for (let k = 0; k < writeLen && k < resampled.length; k++) {
                  channelData[trackStartInChunk + k] += resampled[k] * vol;
                }
              } else {
                const srcOffset = i + trackStartInChunk - t.startSamples;
                for (let k = 0; k < writeLen; k++) {
                  const srcIdx = srcOffset + k;
                  if (srcIdx >= 0 && srcIdx < srcChannel.length) {
                    channelData[trackStartInChunk + k] += srcChannel[srcIdx] * vol;
                  }
                }
              }
            }
          }
          d.set(channelData, o);
          o += s;
        }
        const timeMs = i / targetSr * 1e3;
        const audioData = new globalThis.AudioData({
          format: "f32-planar",
          sampleRate: targetSr,
          numberOfFrames: s,
          numberOfChannels: targetCh,
          timestamp: Math.floor(timeMs * 1e3),
          data: d
        });
        yield { audioData, framesCount: s, timeMs };
        p += s;
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  };
  var AudStream = class {
    stream;
    _processor;
    _reader;
    constructor(s) {
      this.stream = s;
      if (!("MediaStreamTrackProcessor" in globalThis))
        throw new Error("[AudStream] MediaStreamTrackProcessor not available \u2014 requires Chromium-based browser");
      this._processor = new globalThis.MediaStreamTrackProcessor({ track: s.getAudioTracks()[0] });
      this._reader = this._processor.readable.getReader();
    }
    async read() {
      const { done, value } = await this._reader.read();
      return done ? null : value;
    }
    close() {
      this._processor.track.stop();
    }
  };

  // src/codec.ts
  init_core();

  // src/worker.ts
  var WORKER_SCRIPT = `"use strict";(()=>{var B=Object.defineProperty;var z=(p,b,d)=>b in p?B(p,b,{enumerable:!0,configurable:!0,writable:!0,value:d}):p[b]=d;var n=(p,b,d)=>(z(p,typeof b!="symbol"?b+"":b,d),d);var _=(()=>{let l={bt709:1,bt470bg:5,smpte170m:6,bt2020:9,smpte432:12},y={bt709:1,smpte170m:6,"iec61966-2-1":13,smpte2084:16,pq:16,hlg:18},w={rgb:0,bt709:1,bt470bg:5,smpte170m:6,bt2020:9,smpte2084:9},M=(u,s,t)=>{if(!u){let i=new Error(\`[AegisMuxer] \${s}\`);if(t)t(i);else throw i;return!1}return!0};class T{constructor(){n(this,"chunks");n(this,"len");this.chunks=[],this.len=0}write(s){s&&s.byteLength&&(this.chunks.push(s),this.len+=s.byteLength)}get buffer(){if(this.chunks.length===0)return new ArrayBuffer(0);if(this.chunks.length===1){let i=this.chunks[0];return i.buffer?i.buffer.slice(i.byteOffset,i.byteOffset+i.byteLength):i.buffer}let s=new Uint8Array(this.len),t=0;for(let i of this.chunks)s.set(i,t),t+=i.byteLength;return s.buffer}}class E{constructor(s){n(this,"cb");n(this,"pos");this.cb=s,this.pos=0}write(s){s&&s.byteLength&&(this.cb(s,this.pos),this.pos+=s.byteLength)}}class C{constructor(s,t){n(this,"handle");n(this,"pos");n(this,"errCb");this.handle=s,this.pos=0,this.errCb=t}write(s){if(!(!s||!s.byteLength))try{this.handle.write(s,{at:this.pos}),this.pos+=s.byteLength}catch(t){this.errCb&&this.errCb(new Error("FileSink IO Error: "+(t instanceof Error?t.message:String(t))))}}close(){try{this.handle.flush(),this.handle.close()}catch(s){console.warn("[AegisMuxer] FileSink close error:",s)}}}class P{constructor(s,t){n(this,"writer");n(this,"errCb");this.writer=s.getWriter(),this.errCb=t}async write(s){if(!(!s||!s.byteLength))try{await this.writer.write(s)}catch(t){this.errCb&&this.errCb(new Error("WebStreamSink IO Error: "+(t instanceof Error?t.message:String(t))))}}close(){try{this.writer.close()}catch(s){console.warn("[AegisMuxer] WebStreamSink close error:",s)}}}let S=class S{constructor(s,t=4194304){n(this,"err");n(this,"cap");n(this,"buf");n(this,"view");n(this,"p");n(this,"stack");n(this,"_te");this.err=s,this.cap=t,this.buf=new Uint8Array(this.cap),this.view=new DataView(this.buf.buffer),this.p=0,this.stack=[],this._te=new TextEncoder}ensure(s){if(this.p+s>this.cap){let t=this.cap;for(;this.p+s>t;)t=Math.floor(t*1.5);try{let i=new Uint8Array(t);i.set(this.buf.subarray(0,this.p)),this.buf=i,this.view=new DataView(this.buf.buffer),this.cap=t}catch{throw new Error(\`[AegisMuxer] OOM: failed to allocate \${(t/1048576).toFixed(1)}MB buffer. Current usage: \${(this.p/1048576).toFixed(1)}MB. Reduce output resolution or use streaming mode.\`)}}}u8(s){this.ensure(1),this.buf[this.p++]=s}u16(s){this.ensure(2),this.view.setUint16(this.p,s),this.p+=2}u24(s){this.ensure(3),this.view.setUint16(this.p,s>>8),this.buf[this.p+2]=s&255,this.p+=3}u32(s){this.ensure(4),this.view.setUint32(this.p,s),this.p+=4}i16(s){this.ensure(2),this.view.setInt16(this.p,s),this.p+=2}i32(s){this.ensure(4),this.view.setInt32(this.p,s),this.p+=4}u64(s){this.ensure(8),this.view.setUint32(this.p,Math.floor(s/4294967296)),this.view.setUint32(this.p+4,s>>>0),this.p+=8}f32(s){this.ensure(4),this.view.setFloat32(this.p,s),this.p+=4}str(s){let t=this._te.encode(s);this.ensure(t.length),this.buf.set(t,this.p),this.p+=t.length}bytes(s){this.ensure(s.byteLength),this.buf.set(new Uint8Array(s.buffer||s,s.byteOffset||0,s.byteLength),this.p),this.p+=s.byteLength}chunk(s){this.ensure(s.byteLength),s.copyTo?s.copyTo(this.buf.subarray(this.p,this.p+s.byteLength)):this.buf.set(new Uint8Array(s.buffer||s,s.byteOffset||0,s.byteLength),this.p),this.p+=s.byteLength}zero(s){s<=0||(this.ensure(s),this.buf.fill(0,this.p,this.p+s),this.p+=s)}static _hex(s){let t=S._hexCache.get(s);if(!t){t=new Uint8Array(s.length>>1);for(let i=0;i<t.length;i++)t[i]=parseInt(s.substring(i*2,i*2+2),16);S._hexCache.set(s,t)}return t}ebv(s){let t=1;for(;s>=Math.pow(2,7*t)-1;)t++;this.ensure(t);for(let i=t-1;i>=0;i--){let r=Math.floor(s/Math.pow(2,8*i))&255;i===t-1&&(r|=1<<8-t),this.buf[this.p++]=r}}ebm(s){let t=S._hex(s);this.ensure(t.length+8),this.buf.set(t,this.p),this.p+=t.length;let i=this.p;this.p+=8,this.stack.push({s:i,m:"e"})}ebu(s){let t=S._hex(s);this.ensure(t.length+8),this.buf.set(t,this.p),this.p+=t.length,this.buf[this.p++]=1;for(let i=0;i<7;i++)this.buf[this.p++]=255}box(s){this.ensure(8);let t=this.p;this.p+=4,this.str(s),this.stack.push({s:t,m:"m"})}box64(s){this.ensure(16);let t=this.p;this.u32(1),this.str(s),this.p+=8,this.stack.push({s:t,m:"m64"})}rif(s){this.ensure(8);let t=this.p;this.str(s),this.p+=4,this.stack.push({s:t,m:"r"})}end(){if(!M(this.stack.length>0,"Stack underflow",this.err))return;let s=this.stack.pop(),t=this.p-s.s;if(s.m==="m"){if(!M(t<=4294967295,"Box exceeds 4GB, use box64",this.err))return;this.view.setUint32(s.s,t)}else if(s.m==="m64")this.view.setUint32(s.s+8,Math.floor(t/4294967296)),this.view.setUint32(s.s+12,t>>>0);else if(s.m==="r")this.view.setUint32(s.s+4,t-8,!0),(t-8)%2&&this.u8(0);else if(s.m==="e"){let i=t-8;for(let r=7;r>=0;r--){let h=Math.floor(i/Math.pow(2,8*r))&255;r===7&&(h|=1),this.buf[s.s+(7-r)]=h}}}get data(){return this.buf.subarray(0,this.p)}reset(){this.p=0,this.stack.length=0}u32le(s){this.ensure(4),this.view.setUint32(this.p,s,!0),this.p+=4}u16le(s){this.ensure(2),this.view.setUint16(this.p,s,!0),this.p+=2}};n(S,"_hexCache",new Map);let U=S;class D{constructor(s,t,i){n(this,"id");n(this,"isV");n(this,"codec");n(this,"scale");n(this,"fps");n(this,"w");n(this,"h");n(this,"sr");n(this,"ch");n(this,"rot");n(this,"cs");n(this,"cfgData");n(this,"queue");n(this,"stts");n(this,"ctts");n(this,"stss");n(this,"stsc");n(this,"stsz");n(this,"stco");n(this,"lastDts");n(this,"lastPts");n(this,"minPts");n(this,"audioCount");n(this,"hasNegCto");if(this.id=s,this.isV=t,this.codec=String(i.codec||"").toLowerCase(),this.scale=t?9e4:i.sampleRate||48e3,this.w=i.width|0,this.h=i.height|0,this.fps=i.framerate||30,this.sr=i.sampleRate|0,this.ch=i.numberOfChannels|0,this.rot=i.rotation|0,this.cs=i.colorSpace||null,i.description){let r=i.description;r instanceof Uint8Array?this.cfgData=new Uint8Array(r):r instanceof ArrayBuffer?this.cfgData=new Uint8Array(r):this.cfgData=new Uint8Array(r)}else this.cfgData=null;this.queue=[],this.stts=[],this.ctts=[],this.stss=[],this.stsc=[],this.stsz=[],this.stco=[],this.lastDts=-1,this.lastPts=-1,this.minPts=1/0,this.audioCount=0,this.hasNegCto=!1}}class A{constructor(s){n(this,"opt");n(this,"err");n(this,"fmt");n(this,"sink");n(this,"sc");n(this,"vt");n(this,"at");n(this,"sealed");n(this,"cTime");n(this,"dataOff");n(this,"seq");n(this,"tBase");n(this,"wClus");n(this,"_aviIdx");n(this,"_aviChunks");n(this,"_oggSerial");n(this,"_oggPageSeq");n(this,"_oggGranule");if(this.opt={format:"mp4",mode:"fragmented",autoSync:!0,maxFragDur:2,...s},this.err=this.opt.onError||(i=>console.error(i)),!M(!!this.opt.sink,"Sink output required",this.err))return;this.fmt=String(this.opt.format).toLowerCase();let t=["mp4","mov","webm","mkv","avi","ogg","mp3"];if(M(t.includes(this.fmt),\`Unsupported format '\${this.fmt}'. Supported: \${t.join(", ")}\`,this.err)){if(this.sink=this.opt.sink,this.sc=new U(this.err,this.opt.mode==="fragmented"?65536:1048576),this.vt=null,this.at=null,this.sealed=!1,this.cTime=Math.floor(Date.now()/1e3)+2082844800,this.dataOff=0,this.seq=1,this.tBase=-1,this.wClus=-1,this._aviIdx=[],this._aviChunks=[],this._oggSerial=Math.random()*2147483647>>>0,this._oggPageSeq=0,this._oggGranule=0,this.opt.video&&(this.vt=new D(1,!0,this.opt.video)),this.opt.audio&&(this.at=new D(this.vt?2:1,!1,this.opt.audio),this.at.codec.includes("aac")||this.at.codec.includes("mp4a"))){let r=[96e3,88200,64e3,48e3,44100,32e3,24e3,22050,16e3,12e3,11025,8e3,7350].indexOf(this.at.sr);r<0&&(r=4),this.at.cfgData=new Uint8Array([16|r>>1,(r&1)<<7|this.at.ch<<3])}M(!!(this.vt||this.at),"No valid tracks configured",this.err)&&this._initHdr()}}_initHdr(){try{if(this.fmt==="mp4"||this.fmt==="mov")this.sc.box("ftyp"),this.fmt==="mov"?(this.sc.str("qt  "),this.sc.u32(512),this.sc.str("qt  ")):(this.sc.str(this.opt.mode==="fragmented"?"iso5":"isom"),this.sc.u32(512),this.sc.str(this.opt.mode==="fragmented"?"iso5iso6mp41":"isomiso2avc1mp41")),this.sc.end();else if(this.fmt==="webm"||this.fmt==="mkv"){if(this.sc.ebm("1A45DFA3"),this.sc.ebm("4286"),this.sc.u8(1),this.sc.end(),this.sc.ebm("42F7"),this.sc.u8(1),this.sc.end(),this.sc.ebm("42F2"),this.sc.u8(4),this.sc.end(),this.sc.ebm("42F3"),this.sc.u8(8),this.sc.end(),this.sc.ebm("4282"),this.sc.str(this.fmt==="mkv"?"matroska":"webm"),this.sc.end(),this.sc.ebm("4287"),this.sc.u8(4),this.sc.end(),this.sc.ebm("4285"),this.sc.u8(2),this.sc.end(),this.sc.end(),this.sc.ebu("18538067"),this.sc.ebm("1549A966"),this.sc.ebm("2AD7B1"),this.sc.u32(1e6),this.sc.end(),this.sc.ebm("4D80"),this.sc.str("AegisMuxer"),this.sc.end(),this.sc.end(),this.sc.ebm("1654AE6B"),this.vt){this.sc.ebm("AE"),this.sc.ebm("D7"),this.sc.u8(this.vt.id),this.sc.end(),this.sc.ebm("83"),this.sc.u8(1),this.sc.end();let s=this.vt.codec.includes("vp9")?"V_VP9":this.vt.codec.includes("vp8")?"V_VP8":this.vt.codec.includes("av1")?"V_AV1":this.vt.codec.includes("hevc")||this.vt.codec.includes("hvc1")?"V_MPEGH/ISO/HEVC":"V_MPEG4/ISO/AVC";this.sc.ebm("86"),this.sc.str(s),this.sc.end(),this.vt.cfgData&&(this.sc.ebm("63A2"),this.sc.bytes(this.vt.cfgData),this.sc.end()),this.sc.ebm("E0"),this.sc.ebm("B0"),this.sc.u16(this.vt.w),this.sc.end(),this.sc.ebm("BA"),this.sc.u16(this.vt.h),this.sc.end(),this.sc.end(),this.sc.end()}if(this.at){if(this.sc.ebm("AE"),this.sc.ebm("D7"),this.sc.u8(this.at.id),this.sc.end(),this.sc.ebm("83"),this.sc.u8(2),this.sc.end(),this.sc.ebm("86"),this.sc.str(this.at.codec.includes("opus")?"A_OPUS":this.at.codec.includes("vorbis")?"A_VORBIS":"A_AAC"),this.sc.end(),this.at.codec.includes("opus")){this.sc.ebm("63A2"),this.sc.str("OpusHead"),this.sc.u8(1),this.sc.u8(this.at.ch),this.sc.u8(0),this.sc.u8(15);let s=this.at.sr;this.sc.u8(s&255),this.sc.u8(s>>8&255),this.sc.u8(s>>16&255),this.sc.u8(s>>24&255),this.sc.u8(0),this.sc.u8(0),this.sc.u8(0),this.sc.end()}(this.at.codec.includes("aac")||this.at.codec.includes("mp4a"))&&this.at.cfgData&&(this.sc.ebm("63A2"),this.sc.bytes(this.at.cfgData),this.sc.end()),this.sc.ebm("E1"),this.sc.ebm("B5"),this.sc.f32(this.at.sr),this.sc.end(),this.sc.ebm("9F"),this.sc.u8(this.at.ch),this.sc.end(),this.sc.end(),this.sc.end()}this.sc.end()}else this.fmt==="avi"?this._initAVI():this.fmt==="ogg"?this._initOGG():this.fmt;this._flushSc()}catch(s){this.err(s instanceof Error?s:new Error(String(s)))}}_flushSc(){if(this.sc.p>0){let s=new Uint8Array(this.sc.buf.buffer.slice(0,this.sc.p));try{this.sink.write(s)}catch(t){this.err(t instanceof Error?t:new Error(String(t)))}(this.opt.mode!=="fragmented"||this.fmt==="avi")&&(this.dataOff+=s.byteLength),this.sc.reset()}}addVideo(s,t){if(!(this.sealed||!this.vt||!s))try{let i=(s.timestamp||0)/1e6,r=(s.duration||0)/1e6,h=(t?.compositionTimeOffset||0)/1e6;if(r<=0&&(r=1/this.vt.fps),isNaN(i)||isNaN(r)||i<0)return;t?.decoderConfig&&(t.decoderConfig.description&&!this.vt.cfgData&&(this.vt.cfgData=new Uint8Array(t.decoderConfig.description)),t.decoderConfig.colorSpace&&!this.vt.cs&&(this.vt.cs=t.decoderConfig.colorSpace));let c=new Uint8Array(s.byteLength);s.copyTo?s.copyTo(c):c.set(new Uint8Array(s)),this._push(this.vt,c,s.type==="key",i,i-h,r,h)}catch(i){console.warn("[AegisMuxer] Recovered from corrupted video chunk: ",i)}finally{try{s&&typeof s.close=="function"&&s.close()}catch(i){console.warn("[AegisMuxer] chunk.close() error:",i)}}}addAudio(s,t){if(!(this.sealed||!this.at||!s))try{let i=(s.timestamp||0)/1e6,r=(s.duration||0)/1e6;if(isNaN(i)||isNaN(r)||i<0)return;if(this.opt.autoSync){let c=this.at.codec.includes("aac")||this.at.codec.includes("mp4a")?1024/this.at.sr:r||(this.at.codec.includes("opus")?960/this.at.sr:.02);i=this.at.audioCount*c,r=c,this.at.audioCount++}let h=new Uint8Array(s.byteLength);s.copyTo?s.copyTo(h):h.set(new Uint8Array(s)),t?.decoderConfig?.description&&!this.at.cfgData&&(this.at.cfgData=new Uint8Array(t.decoderConfig.description)),this._push(this.at,h,!0,i,i,r,0)}catch(i){console.warn("[AegisMuxer] Recovered from corrupted audio chunk: ",i)}finally{try{s&&typeof s.close=="function"&&s.close()}catch(i){console.warn("[AegisMuxer] chunk.close() error:",i)}}}_push(s,t,i,r,h,c,o){this.tBase===-1&&(this.tBase=0),r-=this.tBase,h-=this.tBase,h<s.lastDts&&(h=s.lastDts+1e-6),r<s.lastPts&&!s.isV&&(r=s.lastPts+1e-6),s.lastDts=h,s.lastPts=r,r<s.minPts&&(s.minPts=r);let f=Math.max(1,Math.round(c*s.scale)),a=Math.round((r-h)*s.scale);if(a<0&&(s.hasNegCto=!0),this.opt.mode!=="fragmented"){let e=s.stts[s.stts.length-1];if(e&&e.d===f?e.c++:s.stts.push({c:1,d:f}),s.isV){let k=s.ctts[s.ctts.length-1];k&&k.o===a?k.c++:s.ctts.push({c:1,o:a}),i&&s.stss.push(s.stsz.length+1)}s.stsz.push(t.byteLength)}s.queue.push({d:t,k:i,p:r,dt:h,du:f,c:a}),this.opt.mode==="fragmented"?this._checkFrag():this.fmt==="webm"||this.fmt==="mkv"||this.fmt==="avi"?this._flushInterleaved():this.fmt==="ogg"?this._flushOGG():this.fmt==="mp3"&&this._flushMP3()}_flushInterleaved(){for(let s of[this.vt,this.at].filter(Boolean))if(s.queue.length!==0){if(this.fmt==="webm"||this.fmt==="mkv"){let t=!1;if(this.wClus===-1?(this.wClus=s.queue[0].p,t=!0):s.queue[s.queue.length-1].p-this.wClus>=this.opt.maxFragDur&&(t=!0),t){let i=Math.round(s.queue[0].p*1e3);this.sc.ebu("1F43B675"),this.sc.ebm("E7"),this.sc.u32(i),this.sc.end(),this.wClus=s.queue[0].p}for(;s.queue.length;){let i=s.queue.shift(),r=Math.round(i.p*1e3)-Math.round(this.wClus*1e3);r<-32768?r=-32768:r>32767&&(r=32767),this.sc.ebm("A3"),this.sc.ebv(s.id),this.sc.i16(r),this.sc.u8(i.k?128:0),this.sc.chunk(i.d),this.sc.end(),i.d=null}}else if(this.fmt==="avi")for(;s.queue.length;){let t=s.queue.shift(),i=s.id===1?"00dc":"01wb";this._aviIdx.push({tag:i,flags:t.k?16:0,offset:0,size:t.d.byteLength});let r=t.d.byteLength,h=r%2?r+1:r,c=new Uint8Array(8+h),o=new DataView(c.buffer),f=new TextEncoder;c.set(f.encode(i),0),o.setUint32(4,r,!0),c.set(t.d,8),this._aviChunks.push(c),t.d=null}}this.fmt!=="avi"&&this._flushSc()}_checkFrag(){if(this.fmt!=="mp4"&&this.fmt!=="mov"){this._flushInterleaved();return}let s=this.vt&&this.vt.queue.length?this.vt:this.at&&this.at.queue.length?this.at:null;s&&s.queue[s.queue.length-1].p-s.queue[0].p>=this.opt.maxFragDur&&(!this.vt||this.vt.queue[this.vt.queue.length-1].k)&&this._writeFrag()}_writeFrag(){this.seq===1&&(this._writeMoov(!0),this._flushSc());let s=[this.vt,this.at].filter(c=>c&&c.queue.length);if(!s.length)return;this.sc.box("moof"),this.sc.box("mfhd"),this.sc.u32(0),this.sc.u32(this.seq++),this.sc.end();let t=[];for(let c of s){this.sc.box("traf"),this.sc.box("tfhd"),this.sc.u32(131072),this.sc.u32(c.id),this.sc.end(),this.sc.box("tfdt"),this.sc.u32(16777216),this.sc.u64(Math.round(c.queue[0].dt*c.scale)),this.sc.end();let o=c.isV&&c.queue.some(e=>e.c!==0),f=c.isV?1793:769;o&&(f|=2048),this.sc.box("trun"),this.sc.u8(c.hasNegCto?1:0),this.sc.u24(f),this.sc.u32(c.queue.length);let a=this.sc.p;this.sc.u32(0);for(let e of c.queue)this.sc.u32(e.du),this.sc.u32(e.d.byteLength),c.isV&&this.sc.u32(e.k?33554432:16842752),o&&(c.hasNegCto?this.sc.i32(e.c):this.sc.u32(e.c));this.sc.end(),this.sc.end(),t.push({p:a,t:c})}this.sc.end();let i=this.sc.p,r=0;for(let c of t)for(let o of c.t.queue)r+=o.d.byteLength;let h=i+8;for(let c of t){this.sc.view.setUint32(c.p,h);for(let o of c.t.queue)h+=o.d.byteLength}this._flushSc(),this.sc.u32(r+8),this.sc.str("mdat"),this._flushSc();for(let c of s){for(let o of c.queue)this.sc.chunk(o.d),this._flushSc(),o.d=null;c.queue.length=0}}finalize(){if(!this.sealed){this.sealed=!0;try{if(this.fmt==="avi")this._finalizeAVI();else if(this.fmt==="ogg")this._flushOGG(),this._writeOGGPage(new Uint8Array(0),!0);else if(this.fmt==="mp3")this._flushMP3();else if(this.opt.mode==="fragmented")if(this.fmt==="mp4"||this.fmt==="mov"){this._writeFrag();let s=[this.vt,this.at].filter(Boolean);this.sc.box("mfra");for(let t of s)this.sc.box("tfra"),this.sc.u32(16777216),this.sc.u32(t.id),this.sc.u32(63),this.sc.u32(0),this.sc.end();this.sc.box("mfro"),this.sc.u32(0),this.sc.u32(16+s.length*32),this.sc.end(),this.sc.end(),this._flushSc()}else this._flushInterleaved();else if(this.fmt==="mp4"||this.fmt==="mov"){let s=[this.vt,this.at].filter(Boolean),t=this.dataOff;for(let f of s){f.stsc=[{f:1,n:1,i:1}];for(let e=0;e<f.queue.length;e++)f.stco.push(t),t+=f.queue[e].d.byteLength,e>0&&f.stsc.push({f:e+1,n:1,i:1});let a=[];for(let e of f.stsc)(!a.length||a[a.length-1].n!==e.n)&&a.push(e);f.stsc=a}let i=this.sc.p;this._writeMoov(!1);let r=this.sc.p-i;this.sc.reset();let h=r+8,c=t-this.dataOff,o=c+16>4294967295;o&&(h+=8);for(let f of s)for(let a=0;a<f.stco.length;a++)f.stco[a]+=h;this._writeMoov(!1),this._flushSc(),o?(this.sc.u32(1),this.sc.str("mdat"),this.sc.u64(c+16)):(this.sc.u32(c+8),this.sc.str("mdat")),this._flushSc();for(let f of s){for(let a of f.queue)this.sc.chunk(a.d),this._flushSc(),a.d=null;f.queue.length=0}}}catch(s){this.err(s instanceof Error?s:new Error(String(s)))}}}_writeMoov(s){this.sc.box("moov"),this.sc.box("mvhd"),this.sc.u32(0),this.sc.u32(this.cTime),this.sc.u32(this.cTime),this.sc.u32(9e4);let t=0;if(!s)for(let r of[this.vt,this.at].filter(Boolean)){let h=0;for(let o of r.stts)h+=o.c*o.d;let c=h/r.scale*9e4;c>t&&(t=c)}this.sc.u32(Math.round(t)),this.sc.u32(65536),this.sc.u16(256),this.sc.zero(10);let i=[65536,0,0,0,65536,0,0,0,1073741824];for(let r of i)this.sc.u32(r);if(this.sc.zero(24),this.sc.u32(this.vt&&this.at?3:2),this.sc.end(),this.vt&&this._writeTrak(this.vt,s),this.at&&this._writeTrak(this.at,s),s){this.sc.box("mvex");for(let r of[this.vt,this.at].filter(Boolean))this.sc.box("trex"),this.sc.u32(0),this.sc.u32(r.id),this.sc.u32(1),this.sc.zero(12),this.sc.end();this.sc.end()}this.sc.end()}_writeTrak(s,t){this.sc.box("trak"),this.sc.box("tkhd"),this.sc.u32(s.isV?3:7),this.sc.u32(this.cTime),this.sc.u32(this.cTime),this.sc.u32(s.id),this.sc.u32(0);let i=0;if(!t)for(let h of s.stts)i+=h.c*h.d;this.sc.u32(Math.round(i/s.scale*9e4)),this.sc.zero(8),this.sc.u16(0),this.sc.u16(0),this.sc.u16(s.isV?0:256),this.sc.u16(0);let r=[65536,0,0,0,65536,0,0,0,1073741824];if(s.isV&&s.rot){let h=s.rot*Math.PI/180;r[0]=Math.round(Math.cos(h)*65536)>>>0,r[1]=Math.round(Math.sin(h)*65536)>>>0,r[3]=Math.round(-Math.sin(h)*65536)>>>0,r[4]=Math.round(Math.cos(h)*65536)>>>0}for(let h of r)this.sc.u32(h);if(this.sc.u32(s.isV?s.w<<16:0),this.sc.u32(s.isV?s.h<<16:0),this.sc.end(),!t&&s.isV&&s.minPts!==1/0&&s.minPts>0&&(this.sc.box("edts"),this.sc.box("elst"),this.sc.u32(0),this.sc.u32(1),this.sc.u32(Math.round(i/s.scale*9e4)),this.sc.u32(Math.round(s.minPts*s.scale)),this.sc.u32(65536),this.sc.end(),this.sc.end()),this.sc.box("mdia"),this.sc.box("mdhd"),this.sc.u32(0),this.sc.u32(this.cTime),this.sc.u32(this.cTime),this.sc.u32(s.scale),this.sc.u32(i),this.sc.u16(21956),this.sc.u16(0),this.sc.end(),this.sc.box("hdlr"),this.sc.u32(0),this.sc.str("mhlr"),this.sc.str(s.isV?"vide":"soun"),this.sc.zero(12),this.sc.str("Aegis\\0"),this.sc.end(),this.sc.box("minf"),s.isV?(this.sc.box("vmhd"),this.sc.u32(1),this.sc.zero(8),this.sc.end()):(this.sc.box("smhd"),this.sc.u32(0),this.sc.zero(4),this.sc.end()),this.sc.box("dinf"),this.sc.box("dref"),this.sc.u32(0),this.sc.u32(1),this.sc.box("url "),this.sc.u32(1),this.sc.end(),this.sc.end(),this.sc.end(),this.sc.box("stbl"),this._wStsd(s),t)["stts","stsc","stsz","stco"].forEach(h=>{this.sc.box(h),this.sc.u32(0),this.sc.u32(0),h==="stsz"&&this.sc.u32(0),this.sc.end()});else{this.sc.box("stts"),this.sc.u32(0),this.sc.u32(s.stts.length);for(let o of s.stts)this.sc.u32(o.c),this.sc.u32(o.d);if(this.sc.end(),s.isV&&s.stss.length){this.sc.box("stss"),this.sc.u32(0),this.sc.u32(s.stss.length);for(let o of s.stss)this.sc.u32(o);this.sc.end()}if(s.isV&&s.ctts.some(o=>o.o!==0)){this.sc.box("ctts"),this.sc.u8(s.hasNegCto?1:0),this.sc.u24(0),this.sc.u32(s.ctts.length);for(let o of s.ctts)this.sc.u32(o.c),s.hasNegCto?this.sc.i32(o.o):this.sc.u32(o.o);this.sc.end()}this.sc.box("stsc"),this.sc.u32(0),this.sc.u32(s.stsc.length);for(let o of s.stsc)this.sc.u32(o.f),this.sc.u32(o.n),this.sc.u32(o.i);this.sc.end();let h=s.stsz;if(h.length){this.sc.box("stsz"),this.sc.u32(0),this.sc.u32(0),this.sc.u32(h.length);for(let o=0;o<h.length;o++)this.sc.u32(h[o]);this.sc.end()}let c=s.stco.some(o=>o>4294967295);this.sc.box(c?"co64":"stco"),this.sc.u32(0),this.sc.u32(s.stco.length);for(let o of s.stco)c?this.sc.u64(o):this.sc.u32(o);this.sc.end()}this.sc.end(),this.sc.end(),this.sc.end(),this.sc.end()}_wStsd(s){if(this.sc.box("stsd"),this.sc.u32(0),this.sc.u32(1),s.isV){let t=s.codec.split(".")[0],i="avc1";t.startsWith("avc")?i="avc1":t.startsWith("hvc")||t.startsWith("hev")?i="hvc1":t.startsWith("av01")?i="av01":t.startsWith("vp09")&&(i="vp09"),this.sc.box(i),this.sc.zero(6),this.sc.u16(1),this.sc.zero(16),this.sc.u16(s.w),this.sc.u16(s.h),this.sc.u32(4718592),this.sc.u32(4718592),this.sc.u32(0),this.sc.u16(1),this.sc.zero(32),this.sc.u16(24),this.sc.u16(65535),s.cfgData&&(t.startsWith("avc")?(this.sc.box("avcC"),this.sc.bytes(s.cfgData),this.sc.end()):t.startsWith("hvc")||t.startsWith("hev")?(this.sc.box("hvcC"),this.sc.bytes(s.cfgData),this.sc.end()):t.startsWith("av01")?(this.sc.box("av1C"),this.sc.bytes(s.cfgData),this.sc.end()):t.startsWith("vp09")&&(this.sc.box("vpcC"),this.sc.u32(16777216),this.sc.u8(s.cfgData[0]||0),this.sc.u8(s.cfgData[1]||10),this.sc.u8(8),this.sc.u8(1),this.sc.u8(1),this.sc.u8(1),this.sc.u16(0),this.sc.end())),s.cs&&(this.sc.box("colr"),this.sc.str("nclx"),this.sc.u16(l[s.cs.primaries]||2),this.sc.u16(y[s.cs.transfer]||2),this.sc.u16(w[s.cs.matrix]||2),this.sc.u8(s.cs.fullRange?128:0),this.sc.end()),this.sc.end()}else{let t=s.codec.includes("opus")?"Opus":"mp4a";if(this.sc.box(t),this.sc.zero(6),this.sc.u16(1),this.sc.zero(8),this.sc.u16(s.ch),this.sc.u16(16),this.sc.zero(4),this.sc.u32(s.sr<<16),s.codec.includes("aac")||s.codec.includes("mp4a")){this.sc.box("esds"),this.sc.u32(0);let i=s.cfgData||new Uint8Array([17,144]);this.sc.u8(3),this.sc.u8(23+i.byteLength),this.sc.u16(1),this.sc.u8(0),this.sc.u8(4),this.sc.u8(15+i.byteLength),this.sc.u8(64),this.sc.u8(21),this.sc.u24(0),this.sc.u32(128e3),this.sc.u32(128e3),this.sc.u8(5),this.sc.u8(i.byteLength),this.sc.bytes(i),this.sc.u8(6),this.sc.u8(1),this.sc.u8(2),this.sc.end()}else s.codec.includes("opus")&&(this.sc.box("dOps"),this.sc.u8(0),this.sc.u8(s.ch),this.sc.u16(3840),this.sc.u32(s.sr),this.sc.u16(0),this.sc.u8(0),this.sc.end());this.sc.end()}this.sc.end()}}A.prototype._initAVI=function(){},A.prototype._finalizeAVI=function(){this._flushInterleaved();let u=[this.vt,this.at].filter(m=>m),s=this.vt?this.vt.fps:25,t=Math.round(1e6/s),i=this.vt?this.vt.stsz.length:0,r=this.at?this.at.stsz.length:0,h=this.vt?this.vt.w:0,c=this.vt?this.vt.h:0,o=0;for(let m of this._aviChunks)o+=m.byteLength;let f=new Uint8Array(o),a=0;for(let m of this._aviChunks)f.set(m,a),a+=m.byteLength;this._aviChunks=[];let e=this.sc;if(e.reset(),e.rif("RIFF"),e.str("AVI "),e.rif("LIST"),e.str("hdrl"),e.rif("avih"),e.u32le(t),e.u32le(0),e.u32le(0),e.u32le(48),e.u32le(Math.max(i,r)),e.u32le(0),e.u32le(u.length),e.u32le(1048576),e.u32le(h),e.u32le(c),e.u32le(0),e.u32le(0),e.u32le(0),e.u32le(0),e.end(),this.vt){e.rif("LIST"),e.str("strl"),e.rif("strh"),e.str("vids");let m=this.vt.codec,O=m.includes("h264")||m.includes("avc")?"H264":m.includes("vp8")?"VP80":"MJPG";e.str(O),e.u32le(0),e.u16le(0),e.u16le(0),e.u32le(0),e.u32le(1),e.u32le(Math.round(s)),e.u32le(0),e.u32le(i),e.u32le(1048576),e.u32le(4294967295),e.u32le(0),e.u16le(0),e.u16le(0),e.u16le(h),e.u16le(c),e.end(),e.rif("strf"),e.u32le(40),e.u32le(h),e.u32le(c),e.u16le(1),e.u16le(24),e.str(O),e.u32le(h*c*3),e.u32le(0),e.u32le(0),e.u32le(0),e.u32le(0),e.end(),e.end()}if(this.at){e.rif("LIST"),e.str("strl");let m=this.at.codec.includes("aac")||this.at.codec.includes("mp4a");e.rif("strh"),e.str("auds"),e.u32le(m?255:85),e.u32le(0),e.u16le(0),e.u16le(0),e.u32le(0),e.u32le(1),e.u32le(this.at.sr),e.u32le(0),e.u32le(r),e.u32le(12288),e.u32le(4294967295),e.u32le(0),e.u16le(0),e.u16le(0),e.u16le(0),e.u16le(0),e.end(),e.rif("strf"),e.u16le(m?255:85),e.u16le(this.at.ch),e.u32le(this.at.sr),e.u32le(m?this.at.sr*this.at.ch*2:16e3),e.u16le(m?1:this.at.ch*2),e.u16le(m?16:0),m&&this.at.cfgData?(e.u16le(this.at.cfgData.byteLength),e.bytes(this.at.cfgData)):e.u16le(0),e.end(),e.end()}e.end(),e.rif("LIST"),e.str("movi"),e.chunk(f),e.end(),e.rif("idx1");let k=4;for(let m of this._aviIdx)e.str(m.tag),e.u32le(m.flags),e.u32le(k),e.u32le(m.size),k+=m.size+8;e.end(),e.end(),this._flushSc()};let q=new Uint32Array(256);for(let u=0;u<256;u++){let s=u<<24;for(let t=0;t<8;t++)s=s<<1^(s&2147483648?79764919:0);q[u]=s>>>0}return A.prototype._initOGG=function(){let u=this.at;if(!u){this.err(new Error("[AegisMuxer] OGG requires an audio track"));return}let s=new Uint8Array(19);s.set([79,112,117,115,72,101,97,100]),s[8]=1,s[9]=u.ch,s[10]=0,s[11]=15,s[12]=u.sr&255,s[13]=u.sr>>8&255,s[14]=u.sr>>16&255,s[15]=u.sr>>24&255,s[16]=0,s[17]=0,s[18]=0,this._writeOGGPage(s,!1,!0);let t=new Uint8Array(20);t.set([79,112,117,115,84,97,103,115]),t[8]=5,t.set([65,101,103,105,115],12),this._writeOGGPage(t,!1,!1)},A.prototype._writeOGGPage=function(u,s,t){let i=Math.max(1,Math.ceil(u.length/255)),r=27+i,h=new Uint8Array(r+u.length),c=new DataView(h.buffer);h.set([79,103,103,83]),h[4]=0,h[5]=(t?2:0)|(s?4:0),c.setUint32(6,this._oggGranule>>>0,!0),c.setUint32(10,0,!0),c.setUint32(14,this._oggSerial,!0),c.setUint32(18,this._oggPageSeq++,!0),c.setUint32(22,0,!0),h[26]=i;let o=u.length;for(let a=0;a<i;a++)h[27+a]=Math.min(o,255),o-=Math.min(o,255);h.set(u,r);let f=0;for(let a=0;a<h.length;a++)f=(f<<8^q[f>>>24&255^h[a]])>>>0;c.setUint32(22,f,!0);try{this.sink.write(h)}catch(a){this.err(a instanceof Error?a:new Error(String(a)))}},A.prototype._flushOGG=function(){let u=this.at;if(u)for(;u.queue.length;){let s=u.queue.shift();this._oggGranule+=960,this._writeOGGPage(s.d,!1),s.d=null}},A.prototype._flushMP3=function(){let u=this.at;if(u)for(;u.queue.length;){let s=u.queue.shift();if(s.d&&s.d.byteLength>0)try{this.sink.write(s.d)}catch(t){this.err(t instanceof Error?t:new Error(String(t)))}s.d=null}},{MemSink:T,StreamSink:E,FileSink:C,WebStreamSink:P,Engine:A}})();var g=null,x=null,F=null,v=null,V=null,L=null;function I(){if(g)try{g.close()}catch{}g=new VideoEncoder({output:(p,b)=>{F.addVideo(p,b)},error:p=>{self.postMessage({type:"error",error:\`VideoEncoder fatal: \${p.message}\`})}}),g.configure(V)}function G(){if(x)try{x.close()}catch{}x=new AudioEncoder({output:(p,b)=>{F.addAudio(p,b)},error:p=>{self.postMessage({type:"error",error:\`AudioEncoder fatal: \${p.message}\`})}}),x.configure(L)}self.onmessage=async p=>{let{type:b,payload:d}=p.data;try{if(b==="init"){let l=d.directToDisk||!1,y=d.mp4Container?"mp4":"webm";if(d.stream)v=new _.WebStreamSink(d.stream,w=>self.postMessage({type:"error",error:w.message}));else if(l){let w="."+y,E=await(await(await navigator.storage.getDirectory()).getFileHandle("af_"+Date.now()+w,{create:!0})).createSyncAccessHandle();v=new _.FileSink(E,C=>self.postMessage({type:"error",error:C.message}))}else v=new _.MemSink;F=new _.Engine({format:y,mode:y==="mp4"?"fragmented":"interleaved",autoSync:!1,sink:v,video:d.video,audio:d.audio?{...d.audio,codec:y==="mp4"?"mp4a.40.2":"opus"}:void 0,onError:w=>self.postMessage({type:"error",error:w.message})}),d.video&&(V=d.video,I()),d.audio&&(L={...d.audio,codec:y==="mp4"?"mp4a.40.2":"opus"},G())}else if(b==="encode-video"){if(!g||g.state!=="configured"){self.postMessage({type:"error",error:"VideoEncoder not configured \\u2014 cannot encode frame"});try{d.frame.close()}catch{}return}g.encode(d.frame,{keyFrame:d.keyFrame});try{d.frame.close()}catch{}self.postMessage({type:"queue-capacity",active:g.encodeQueueSize<10})}else if(b==="encode-audio"){if(!x||x.state!=="configured"){self.postMessage({type:"error",error:"AudioEncoder not configured \\u2014 cannot encode audio"});try{d.audioData.close()}catch{}return}x.encode(d.audioData);try{d.audioData.close()}catch{}}else if(b==="flush"){try{let l=[];g&&g.state==="configured"&&l.push(g.flush()),x&&x.state==="configured"&&l.push(x.flush()),await Promise.all(l)}finally{try{g&&g.close()}catch{}try{x&&x.close()}catch{}try{F&&F.finalize()}catch{}}if(v instanceof _.FileSink||v instanceof _.WebStreamSink){try{v.close()}catch{}let l=new ArrayBuffer(0);self.postMessage({type:"done",buffer:l},{transfer:[l]})}else{let l=v.buffer;self.postMessage({type:"done",buffer:l},{transfer:Array.isArray(l)?l:[l]})}}}catch(l){self.postMessage({type:"error",error:l instanceof Error?l.message:String(l)})}};})();
`;

  // src/codec.ts
  var Vid = class {
    _flushed;
    _capacityReady;
    _waitQueue;
    _config;
    _workerUrl;
    _worker;
    _onComplete;
    _onError;
    _isGif;
    _gifEncoder;
    _hasVideo;
    _cleaned = false;
    constructor(config) {
      this._flushed = false;
      this._capacityReady = true;
      this._waitQueue = [];
      this._config = config;
      this._isGif = !!config.isGif;
      this._workerUrl = "";
      this._hasVideo = !!config.video;
      if (!this._isGif) {
        const b = new Blob([WORKER_SCRIPT], { type: "application/javascript" });
        this._workerUrl = URL.createObjectURL(b);
        this._worker = new Worker(this._workerUrl);
      } else {
        this._worker = {};
      }
    }
    async init() {
      const cfg = this._config;
      if (this._isGif) {
        const { AnimatedGifEncoder: AnimatedGifEncoder2 } = await Promise.resolve().then(() => (init_encoders(), encoders_exports));
        this._gifEncoder = new AnimatedGifEncoder2(cfg.video.width, cfg.video.height, cfg.video?.framerate || 30);
        this._capacityReady = true;
        return;
      }
      if (cfg.video) {
        let vc = cfg.video.codec;
        const VideoEncoderClass = globalThis.VideoEncoder;
        if (!VideoEncoderClass)
          throw new AegisError("VideoEncoder API not available in this browser");
        const sup = await VideoEncoderClass.isConfigSupported(cfg.video);
        if (!sup.supported) {
          log.warn(`Codec ${vc} strict hardware reject. Falling back to software vp8.`);
          vc = "vp8";
          cfg.video.codec = vc;
        }
      }
      this._worker.onmessage = (e) => {
        const { type } = e.data;
        if (type === "done") {
          if (this._onComplete)
            this._onComplete(e.data.buffer);
          this._clean();
        } else if (type === "error") {
          const err = new AegisError(`MuxFail:${e.data.error}`);
          log.error("WorkerErr", err);
          if (this._onError)
            this._onError(err);
          this._clean();
        } else if (type === "queue-capacity") {
          this._capacityReady = e.data.active;
          if (this._capacityReady && this._waitQueue.length > 0) {
            const r = this._waitQueue.shift();
            if (r)
              r();
          }
        }
      };
      this._worker.onerror = (e) => {
        const err = new AegisError("FatalWorkerErr", e);
        if (this._onError)
          this._onError(err);
        this._clean();
      };
      const payload = {
        video: cfg.video,
        audio: cfg.audio ? {
          codec: "opus",
          numberOfChannels: cfg.audio.numberOfChannels || 2,
          sampleRate: cfg.audio.sampleRate || 48e3
        } : void 0,
        directToDisk: !!cfg.directToDisk,
        mp4Container: !!cfg.mp4Container
      };
      const transfers = [];
      if (cfg.stream) {
        payload.stream = cfg.stream;
        transfers.push(cfg.stream);
      }
      this._worker.postMessage({ type: "init", payload }, transfers);
    }
    async _waitCapacity() {
      if (this._capacityReady)
        return;
      return new Promise((r) => this._waitQueue.push(r));
    }
    async pushVid(f, k = false) {
      await this._waitCapacity();
      try {
        log.assert(f instanceof VideoFrame, "NotVideoFrame");
        if (this._flushed) {
          throw new AegisError("VidFlushed");
        }
        if (this._isGif) {
          await this._gifEncoder?.addFrame(f, Math.round(1e3 / (this._config.video?.framerate || 30)));
          f.close();
          return;
        }
        if (!this._worker || !this._hasVideo)
          return;
        this._worker.postMessage({ type: "encode-video", payload: { frame: f, keyFrame: k } }, [f]);
      } catch (err) {
        try {
          f.close();
        } catch (e) {
        }
        throw err;
      }
    }
    async pushAud(a) {
      await this._waitCapacity();
      try {
        log.assert(typeof a === "object" && a !== null && "timestamp" in a, "NotAudioData");
        if (this._flushed) {
          throw new AegisError("VidFlushed");
        }
        if (this._isGif) {
          return;
        }
        this._worker.postMessage({
          type: "encode-audio",
          payload: { audioData: a }
        }, [a]);
      } catch (err) {
        try {
          a.close();
        } catch (e) {
        }
        throw err;
      }
    }
    async flush() {
      log.assert(!this._flushed, "DupFlush");
      this._flushed = true;
      return new Promise((resolve, reject) => {
        this._onComplete = resolve;
        this._onError = reject;
        if (this._isGif) {
          this._gifEncoder.encode().then((blob) => blob.arrayBuffer()).then(resolve).catch(reject);
          return;
        }
        this._worker.postMessage({ type: "flush" });
      });
    }
    close() {
      this._clean();
    }
    _clean() {
      if (this._cleaned)
        return;
      this._cleaned = true;
      if (!this._isGif) {
        this._worker.terminate();
        URL.revokeObjectURL(this._workerUrl);
      }
    }
  };

  // src/AegisMuxer.ts
  var AegisMuxer = (() => {
    const TS_FREQ = 9e4;
    const EPOCH_OFFSET = 2082844800;
    const MAX_U32 = 4294967295;
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
      constructor() {
        this.chunks = [];
        this.len = 0;
      }
      write(d) {
        if (d && d.byteLength) {
          this.chunks.push(d);
          this.len += d.byteLength;
        }
      }
      get buffer() {
        if (this.chunks.length === 0)
          return new ArrayBuffer(0);
        if (this.chunks.length === 1) {
          const c = this.chunks[0];
          return c.buffer ? c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) : c.buffer;
        }
        const out = new Uint8Array(this.len);
        let off = 0;
        for (const c of this.chunks) {
          out.set(c, off);
          off += c.byteLength;
        }
        return out.buffer;
      }
    }
    class StreamSink {
      cb;
      pos;
      constructor(cb) {
        this.cb = cb;
        this.pos = 0;
      }
      write(d) {
        if (d && d.byteLength) {
          this.cb(d, this.pos);
          this.pos += d.byteLength;
        }
      }
    }
    class FileSink {
      handle;
      pos;
      errCb;
      constructor(handle, errCb) {
        this.handle = handle;
        this.pos = 0;
        this.errCb = errCb;
      }
      write(d) {
        if (!d || !d.byteLength)
          return;
        try {
          this.handle.write(d, { at: this.pos });
          this.pos += d.byteLength;
        } catch (e) {
          if (this.errCb)
            this.errCb(new Error("FileSink IO Error: " + (e instanceof Error ? e.message : String(e))));
        }
      }
      close() {
        try {
          this.handle.flush();
          this.handle.close();
        } catch (e) {
          console.warn("[AegisMuxer] FileSink close error:", e);
        }
      }
    }
    class WebStreamSink {
      writer;
      errCb;
      constructor(stream, errCb) {
        this.writer = stream.getWriter();
        this.errCb = errCb;
      }
      async write(d) {
        if (!d || !d.byteLength)
          return;
        try {
          await this.writer.write(d);
        } catch (e) {
          if (this.errCb)
            this.errCb(new Error("WebStreamSink IO Error: " + (e instanceof Error ? e.message : String(e))));
        }
      }
      close() {
        try {
          this.writer.close();
        } catch (e) {
          console.warn("[AegisMuxer] WebStreamSink close error:", e);
        }
      }
    }
    class Scribe {
      err;
      cap;
      buf;
      view;
      p;
      stack;
      _te;
      constructor(errCb, initialCap = 4 * 1024 * 1024) {
        this.err = errCb;
        this.cap = initialCap;
        this.buf = new Uint8Array(this.cap);
        this.view = new DataView(this.buf.buffer);
        this.p = 0;
        this.stack = [];
        this._te = new TextEncoder();
      }
      ensure(n) {
        if (this.p + n > this.cap) {
          let nCap = this.cap;
          while (this.p + n > nCap)
            nCap = Math.floor(nCap * 1.5);
          try {
            const nBuf = new Uint8Array(nCap);
            nBuf.set(this.buf.subarray(0, this.p));
            this.buf = nBuf;
            this.view = new DataView(this.buf.buffer);
            this.cap = nCap;
          } catch (e) {
            throw new Error(`[AegisMuxer] OOM: failed to allocate ${(nCap / (1024 * 1024)).toFixed(1)}MB buffer. Current usage: ${(this.p / (1024 * 1024)).toFixed(1)}MB. Reduce output resolution or use streaming mode.`);
          }
        }
      }
      u8(x) {
        this.ensure(1);
        this.buf[this.p++] = x;
      }
      u16(x) {
        this.ensure(2);
        this.view.setUint16(this.p, x);
        this.p += 2;
      }
      u24(x) {
        this.ensure(3);
        this.view.setUint16(this.p, x >> 8);
        this.buf[this.p + 2] = x & 255;
        this.p += 3;
      }
      u32(x) {
        this.ensure(4);
        this.view.setUint32(this.p, x);
        this.p += 4;
      }
      i16(x) {
        this.ensure(2);
        this.view.setInt16(this.p, x);
        this.p += 2;
      }
      i32(x) {
        this.ensure(4);
        this.view.setInt32(this.p, x);
        this.p += 4;
      }
      u64(x) {
        this.ensure(8);
        this.view.setUint32(this.p, Math.floor(x / 4294967296));
        this.view.setUint32(this.p + 4, x >>> 0);
        this.p += 8;
      }
      f32(x) {
        this.ensure(4);
        this.view.setFloat32(this.p, x);
        this.p += 4;
      }
      str(s) {
        const encoded = this._te.encode(s);
        this.ensure(encoded.length);
        this.buf.set(encoded, this.p);
        this.p += encoded.length;
      }
      bytes(d) {
        this.ensure(d.byteLength);
        this.buf.set(new Uint8Array(d.buffer || d, d.byteOffset || 0, d.byteLength), this.p);
        this.p += d.byteLength;
      }
      chunk(c) {
        this.ensure(c.byteLength);
        if (c.copyTo)
          c.copyTo(this.buf.subarray(this.p, this.p + c.byteLength));
        else
          this.buf.set(new Uint8Array(c.buffer || c, c.byteOffset || 0, c.byteLength), this.p);
        this.p += c.byteLength;
      }
      zero(n) {
        if (n <= 0)
          return;
        this.ensure(n);
        this.buf.fill(0, this.p, this.p + n);
        this.p += n;
      }
      static _hexCache = /* @__PURE__ */ new Map();
      static _hex(hex) {
        let r = Scribe._hexCache.get(hex);
        if (!r) {
          r = new Uint8Array(hex.length >> 1);
          for (let i = 0; i < r.length; i++)
            r[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
          Scribe._hexCache.set(hex, r);
        }
        return r;
      }
      ebv(x) {
        let l = 1;
        while (x >= Math.pow(2, 7 * l) - 1)
          l++;
        this.ensure(l);
        for (let i = l - 1; i >= 0; i--) {
          let b = Math.floor(x / Math.pow(2, 8 * i)) & 255;
          if (i === l - 1)
            b |= 1 << 8 - l;
          this.buf[this.p++] = b;
        }
      }
      ebm(hex) {
        const h = Scribe._hex(hex);
        this.ensure(h.length + 8);
        this.buf.set(h, this.p);
        this.p += h.length;
        const s = this.p;
        this.p += 8;
        this.stack.push({ s, m: "e" });
      }
      ebu(hex) {
        const h = Scribe._hex(hex);
        this.ensure(h.length + 8);
        this.buf.set(h, this.p);
        this.p += h.length;
        this.buf[this.p++] = 1;
        for (let i = 0; i < 7; i++)
          this.buf[this.p++] = 255;
      }
      box(t) {
        this.ensure(8);
        const s = this.p;
        this.p += 4;
        this.str(t);
        this.stack.push({ s, m: "m" });
      }
      box64(t) {
        this.ensure(16);
        const s = this.p;
        this.u32(1);
        this.str(t);
        this.p += 8;
        this.stack.push({ s, m: "m64" });
      }
      rif(t) {
        this.ensure(8);
        const s = this.p;
        this.str(t);
        this.p += 4;
        this.stack.push({ s, m: "r" });
      }
      end() {
        if (!guard(this.stack.length > 0, "Stack underflow", this.err))
          return;
        const n = this.stack.pop();
        const sz = this.p - n.s;
        if (n.m === "m") {
          if (!guard(sz <= MAX_U32, "Box exceeds 4GB, use box64", this.err))
            return;
          this.view.setUint32(n.s, sz);
        } else if (n.m === "m64") {
          this.view.setUint32(n.s + 8, Math.floor(sz / 4294967296));
          this.view.setUint32(n.s + 12, sz >>> 0);
        } else if (n.m === "r") {
          this.view.setUint32(n.s + 4, sz - 8, true);
          if ((sz - 8) % 2)
            this.u8(0);
        } else if (n.m === "e") {
          const d = sz - 8;
          for (let i = 7; i >= 0; i--) {
            let b = Math.floor(d / Math.pow(2, 8 * i)) & 255;
            if (i === 7)
              b |= 1;
            this.buf[n.s + (7 - i)] = b;
          }
        }
      }
      get data() {
        return this.buf.subarray(0, this.p);
      }
      reset() {
        this.p = 0;
        this.stack.length = 0;
      }
      u32le(v) {
        this.ensure(4);
        this.view.setUint32(this.p, v, true);
        this.p += 4;
      }
      u16le(v) {
        this.ensure(2);
        this.view.setUint16(this.p, v, true);
        this.p += 2;
      }
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
        this.scale = isVideo ? TS_FREQ : config.sampleRate || 48e3;
        this.w = config.width | 0;
        this.h = config.height | 0;
        this.fps = config.framerate || 30;
        this.sr = config.sampleRate | 0;
        this.ch = config.numberOfChannels | 0;
        this.rot = config.rotation | 0;
        this.cs = config.colorSpace || null;
        if (config.description) {
          const d = config.description;
          if (d instanceof Uint8Array)
            this.cfgData = new Uint8Array(d);
          else if (d instanceof ArrayBuffer)
            this.cfgData = new Uint8Array(d);
          else
            this.cfgData = new Uint8Array(d);
        } else
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
      _aviIdx;
      _aviChunks;
      _oggSerial;
      _oggPageSeq;
      _oggGranule;
      constructor(options) {
        this.opt = { format: "mp4", mode: "fragmented", autoSync: true, maxFragDur: 2, ...options };
        this.err = this.opt.onError || ((e) => console.error(e));
        if (!guard(!!this.opt.sink, "Sink output required", this.err))
          return;
        this.fmt = String(this.opt.format).toLowerCase();
        const SUPPORTED_FMTS = ["mp4", "mov", "webm", "mkv", "avi", "ogg", "mp3"];
        if (!guard(SUPPORTED_FMTS.includes(this.fmt), `Unsupported format '${this.fmt}'. Supported: ${SUPPORTED_FMTS.join(", ")}`, this.err))
          return;
        this.sink = this.opt.sink;
        this.sc = new Scribe(this.err, this.opt.mode === "fragmented" ? 64 * 1024 : 1024 * 1024);
        this.vt = null;
        this.at = null;
        this.sealed = false;
        this.cTime = Math.floor(Date.now() / 1e3) + EPOCH_OFFSET;
        this.dataOff = 0;
        this.seq = 1;
        this.tBase = -1;
        this.wClus = -1;
        this._aviIdx = [];
        this._aviChunks = [];
        this._oggSerial = Math.random() * 2147483647 >>> 0;
        this._oggPageSeq = 0;
        this._oggGranule = 0;
        if (this.opt.video) {
          this.vt = new Track(1, true, this.opt.video);
        }
        if (this.opt.audio) {
          this.at = new Track(this.vt ? 2 : 1, false, this.opt.audio);
          if (this.at.codec.includes("aac") || this.at.codec.includes("mp4a")) {
            const freqs = [96e3, 88200, 64e3, 48e3, 44100, 32e3, 24e3, 22050, 16e3, 12e3, 11025, 8e3, 7350];
            let idx = freqs.indexOf(this.at.sr);
            if (idx < 0)
              idx = 4;
            this.at.cfgData = new Uint8Array([2 << 3 | idx >> 1, (idx & 1) << 7 | this.at.ch << 3]);
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
            } else {
              this.sc.str(this.opt.mode === "fragmented" ? "iso5" : "isom");
              this.sc.u32(512);
              this.sc.str(this.opt.mode === "fragmented" ? "iso5iso6mp41" : "isomiso2avc1mp41");
            }
            this.sc.end();
          } else if (this.fmt === "webm" || this.fmt === "mkv") {
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
            this.sc.ebu("18538067");
            this.sc.ebm("1549A966");
            this.sc.ebm("2AD7B1");
            this.sc.u32(1e6);
            this.sc.end();
            this.sc.ebm("4D80");
            this.sc.str("AegisMuxer");
            this.sc.end();
            this.sc.end();
            this.sc.ebm("1654AE6B");
            if (this.vt) {
              this.sc.ebm("AE");
              this.sc.ebm("D7");
              this.sc.u8(this.vt.id);
              this.sc.end();
              this.sc.ebm("83");
              this.sc.u8(1);
              this.sc.end();
              const cName = this.vt.codec.includes("vp9") ? "V_VP9" : this.vt.codec.includes("vp8") ? "V_VP8" : this.vt.codec.includes("av1") ? "V_AV1" : this.vt.codec.includes("hevc") || this.vt.codec.includes("hvc1") ? "V_MPEGH/ISO/HEVC" : "V_MPEG4/ISO/AVC";
              this.sc.ebm("86");
              this.sc.str(cName);
              this.sc.end();
              if (this.vt.cfgData) {
                this.sc.ebm("63A2");
                this.sc.bytes(this.vt.cfgData);
                this.sc.end();
              }
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
              this.sc.str(this.at.codec.includes("opus") ? "A_OPUS" : this.at.codec.includes("vorbis") ? "A_VORBIS" : "A_AAC");
              this.sc.end();
              if (this.at.codec.includes("opus")) {
                this.sc.ebm("63A2");
                this.sc.str("OpusHead");
                this.sc.u8(1);
                this.sc.u8(this.at.ch);
                this.sc.u8(0);
                this.sc.u8(15);
                const sr = this.at.sr;
                this.sc.u8(sr & 255);
                this.sc.u8(sr >> 8 & 255);
                this.sc.u8(sr >> 16 & 255);
                this.sc.u8(sr >> 24 & 255);
                this.sc.u8(0);
                this.sc.u8(0);
                this.sc.u8(0);
                this.sc.end();
              }
              if (this.at.codec.includes("aac") || this.at.codec.includes("mp4a")) {
                if (this.at.cfgData) {
                  this.sc.ebm("63A2");
                  this.sc.bytes(this.at.cfgData);
                  this.sc.end();
                }
              }
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
            this.sc.end();
          } else if (this.fmt === "avi") {
            this._initAVI();
          } else if (this.fmt === "ogg") {
            this._initOGG();
          } else if (this.fmt === "mp3") {
          }
          this._flushSc();
        } catch (e) {
          this.err(e instanceof Error ? e : new Error(String(e)));
        }
      }
      _flushSc() {
        if (this.sc.p > 0) {
          const d = new Uint8Array(this.sc.buf.buffer.slice(0, this.sc.p));
          try {
            this.sink.write(d);
          } catch (e) {
            this.err(e instanceof Error ? e : new Error(String(e)));
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
          if (dur <= 0)
            dur = 1 / this.vt.fps;
          if (isNaN(ts) || isNaN(dur) || ts < 0)
            return;
          if (meta?.decoderConfig) {
            if (meta.decoderConfig.description && !this.vt.cfgData)
              this.vt.cfgData = new Uint8Array(meta.decoderConfig.description);
            if (meta.decoderConfig.colorSpace && !this.vt.cs)
              this.vt.cs = meta.decoderConfig.colorSpace;
          }
          let raw = new Uint8Array(chunk.byteLength);
          if (chunk.copyTo)
            chunk.copyTo(raw);
          else
            raw.set(new Uint8Array(chunk));
          this._push(this.vt, raw, chunk.type === "key", ts, ts - cto, dur, cto);
        } catch (e) {
          console.warn("[AegisMuxer] Recovered from corrupted video chunk: ", e);
        } finally {
          try {
            if (chunk && typeof chunk.close === "function")
              chunk.close();
          } catch (e) {
            console.warn("[AegisMuxer] chunk.close() error:", e);
          }
        }
      }
      addAudio(chunk, meta) {
        if (this.sealed || !this.at || !chunk)
          return;
        try {
          let ts = (chunk.timestamp || 0) / 1e6, dur = (chunk.duration || 0) / 1e6;
          if (isNaN(ts) || isNaN(dur) || ts < 0)
            return;
          if (this.opt.autoSync) {
            let exactDur = this.at.codec.includes("aac") || this.at.codec.includes("mp4a") ? 1024 / this.at.sr : dur || (this.at.codec.includes("opus") ? 960 / this.at.sr : 0.02);
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
        } catch (e) {
          console.warn("[AegisMuxer] Recovered from corrupted audio chunk: ", e);
        } finally {
          try {
            if (chunk && typeof chunk.close === "function")
              chunk.close();
          } catch (e) {
            console.warn("[AegisMuxer] chunk.close() error:", e);
          }
        }
      }
      _push(trk, data, isKey, pts, dts, dur, cto) {
        if (this.tBase === -1)
          this.tBase = 0;
        pts -= this.tBase;
        dts -= this.tBase;
        if (dts < trk.lastDts)
          dts = trk.lastDts + 1e-6;
        if (pts < trk.lastPts && !trk.isV)
          pts = trk.lastPts + 1e-6;
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
        } else if (this.fmt === "webm" || this.fmt === "mkv" || this.fmt === "avi") {
          this._flushInterleaved();
        } else if (this.fmt === "ogg") {
          this._flushOGG();
        } else if (this.fmt === "mp3") {
          this._flushMP3();
        } else {
        }
      }
      _flushInterleaved() {
        for (let t of [this.vt, this.at].filter(Boolean)) {
          if (t.queue.length === 0)
            continue;
          if (this.fmt === "webm" || this.fmt === "mkv") {
            let shouldCluster = false;
            if (this.wClus === -1) {
              this.wClus = t.queue[0].p;
              shouldCluster = true;
            } else if (t.queue[t.queue.length - 1].p - this.wClus >= this.opt.maxFragDur) {
              shouldCluster = true;
            }
            if (shouldCluster) {
              let tc = Math.round(t.queue[0].p * 1e3);
              this.sc.ebu("1F43B675");
              this.sc.ebm("E7");
              this.sc.u32(tc);
              this.sc.end();
              this.wClus = t.queue[0].p;
            }
            while (t.queue.length) {
              const f = t.queue.shift();
              let relTs = Math.round(f.p * 1e3) - Math.round(this.wClus * 1e3);
              if (relTs < -32768)
                relTs = -32768;
              else if (relTs > 32767)
                relTs = 32767;
              this.sc.ebm("A3");
              this.sc.ebv(t.id);
              this.sc.i16(relTs);
              this.sc.u8(f.k ? 128 : 0);
              this.sc.chunk(f.d);
              this.sc.end();
              f.d = null;
            }
          } else if (this.fmt === "avi") {
            while (t.queue.length) {
              const f = t.queue.shift();
              const tag = t.id === 1 ? "00dc" : "01wb";
              this._aviIdx.push({ tag, flags: f.k ? 16 : 0, offset: 0, size: f.d.byteLength });
              const chunkSz = f.d.byteLength;
              const padded = chunkSz % 2 ? chunkSz + 1 : chunkSz;
              const chunk = new Uint8Array(8 + padded);
              const dv = new DataView(chunk.buffer);
              const _te = new TextEncoder();
              chunk.set(_te.encode(tag), 0);
              dv.setUint32(4, chunkSz, true);
              chunk.set(f.d, 8);
              this._aviChunks.push(chunk);
              f.d = null;
            }
          }
        }
        if (this.fmt !== "avi")
          this._flushSc();
      }
      _checkFrag() {
        if (this.fmt !== "mp4" && this.fmt !== "mov") {
          this._flushInterleaved();
          return;
        }
        let primary = this.vt && this.vt.queue.length ? this.vt : this.at && this.at.queue.length ? this.at : null;
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
        let tks = [this.vt, this.at].filter((t) => t && t.queue.length);
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
          this.sc.u32(131072);
          this.sc.u32(t.id);
          this.sc.end();
          this.sc.box("tfdt");
          this.sc.u32(16777216);
          this.sc.u64(Math.round(t.queue[0].dt * t.scale));
          this.sc.end();
          let hasCto = t.isV && t.queue.some((x) => x.c !== 0);
          let flags = t.isV ? 1793 : 769;
          if (hasCto)
            flags |= 2048;
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
              this.sc.u32(f.k ? 33554432 : 16842752 | 65536);
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
        let moofSize = this.sc.p;
        let totalMdatPayload = 0;
        for (let x of trunOffs)
          for (let f of x.t.queue)
            totalMdatPayload += f.d.byteLength;
        let trackDataStart = moofSize + 8;
        for (let x of trunOffs) {
          this.sc.view.setUint32(x.p, trackDataStart);
          for (let f of x.t.queue)
            trackDataStart += f.d.byteLength;
        }
        this._flushSc();
        this.sc.u32(totalMdatPayload + 8);
        this.sc.str("mdat");
        this._flushSc();
        for (let t of tks) {
          for (let f of t.queue) {
            this.sc.chunk(f.d);
            this._flushSc();
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
          if (this.fmt === "avi") {
            this._finalizeAVI();
          } else if (this.fmt === "ogg") {
            this._flushOGG();
            this._writeOGGPage(new Uint8Array(0), true);
          } else if (this.fmt === "mp3") {
            this._flushMP3();
          } else if (this.opt.mode === "fragmented") {
            if (this.fmt === "mp4" || this.fmt === "mov") {
              this._writeFrag();
              let tks = [this.vt, this.at].filter(Boolean);
              this.sc.box("mfra");
              for (let t of tks) {
                this.sc.box("tfra");
                this.sc.u32(16777216);
                this.sc.u32(t.id);
                this.sc.u32(63);
                this.sc.u32(0);
                this.sc.end();
              }
              this.sc.box("mfro");
              this.sc.u32(0);
              this.sc.u32(16 + tks.length * 32);
              this.sc.end();
              this.sc.end();
              this._flushSc();
            } else
              this._flushInterleaved();
          } else if (this.fmt === "mp4" || this.fmt === "mov") {
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
            } else {
              this.sc.u32(dataSize + 8);
              this.sc.str("mdat");
            }
            this._flushSc();
            for (let t of tks) {
              for (let f of t.queue) {
                this.sc.chunk(f.d);
                this._flushSc();
                f.d = null;
              }
              t.queue.length = 0;
            }
          }
        } catch (e) {
          this.err(e instanceof Error ? e : new Error(String(e)));
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
              d += s.c * s.d;
            let r = d / t.scale * TS_FREQ;
            if (r > maxDur)
              maxDur = r;
          }
        }
        this.sc.u32(Math.round(maxDur));
        this.sc.u32(65536);
        this.sc.u16(256);
        this.sc.zero(10);
        let mat = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
        for (let x of mat)
          this.sc.u32(x);
        this.sc.zero(24);
        this.sc.u32(this.vt && this.at ? 3 : 2);
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
        this.sc.u32(t.isV ? 3 : 7);
        this.sc.u32(this.cTime);
        this.sc.u32(this.cTime);
        this.sc.u32(t.id);
        this.sc.u32(0);
        let d = 0;
        if (!isFrag)
          for (let s of t.stts)
            d += s.c * s.d;
        this.sc.u32(Math.round(d / t.scale * TS_FREQ));
        this.sc.zero(8);
        this.sc.u16(0);
        this.sc.u16(0);
        this.sc.u16(t.isV ? 0 : 256);
        this.sc.u16(0);
        let rm = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
        if (t.isV && t.rot) {
          let r = t.rot * Math.PI / 180;
          rm[0] = Math.round(Math.cos(r) * 65536) >>> 0;
          rm[1] = Math.round(Math.sin(r) * 65536) >>> 0;
          rm[3] = Math.round(-Math.sin(r) * 65536) >>> 0;
          rm[4] = Math.round(Math.cos(r) * 65536) >>> 0;
        }
        for (let x of rm)
          this.sc.u32(x);
        this.sc.u32(t.isV ? t.w << 16 : 0);
        this.sc.u32(t.isV ? t.h << 16 : 0);
        this.sc.end();
        if (!isFrag && t.isV && t.minPts !== Infinity && t.minPts > 0) {
          this.sc.box("edts");
          this.sc.box("elst");
          this.sc.u32(0);
          this.sc.u32(1);
          this.sc.u32(Math.round(d / t.scale * TS_FREQ));
          this.sc.u32(Math.round(t.minPts * t.scale));
          this.sc.u32(65536);
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
        this.sc.u16(21956);
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
          this.sc.u32(1);
          this.sc.zero(8);
          this.sc.end();
        } else {
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
        this.sc.u32(1);
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
          let stsz = t.stsz;
          if (stsz.length) {
            this.sc.box("stsz");
            this.sc.u32(0);
            this.sc.u32(0);
            this.sc.u32(stsz.length);
            for (let i = 0; i < stsz.length; i++)
              this.sc.u32(stsz[i]);
            this.sc.end();
          }
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
        } else {
          ["stts", "stsc", "stsz", "stco"].forEach((x) => {
            this.sc.box(x);
            this.sc.u32(0);
            this.sc.u32(0);
            if (x === "stsz")
              this.sc.u32(0);
            this.sc.end();
          });
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
          let nP = t.codec.split(".")[0];
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
          this.sc.u32(4718592);
          this.sc.u32(4718592);
          this.sc.u32(0);
          this.sc.u16(1);
          this.sc.zero(32);
          this.sc.u16(24);
          this.sc.u16(65535);
          if (t.cfgData) {
            if (nP.startsWith("avc")) {
              this.sc.box("avcC");
              this.sc.bytes(t.cfgData);
              this.sc.end();
            } else if (nP.startsWith("hvc") || nP.startsWith("hev")) {
              this.sc.box("hvcC");
              this.sc.bytes(t.cfgData);
              this.sc.end();
            } else if (nP.startsWith("av01")) {
              this.sc.box("av1C");
              this.sc.bytes(t.cfgData);
              this.sc.end();
            } else if (nP.startsWith("vp09")) {
              this.sc.box("vpcC");
              this.sc.u32(16777216);
              this.sc.u8(t.cfgData[0] || 0);
              this.sc.u8(t.cfgData[1] || 10);
              this.sc.u8(8);
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
            this.sc.u8(t.cs.fullRange ? 128 : 0);
            this.sc.end();
          }
          this.sc.end();
        } else {
          let bName = t.codec.includes("opus") ? "Opus" : "mp4a";
          this.sc.box(bName);
          this.sc.zero(6);
          this.sc.u16(1);
          this.sc.zero(8);
          this.sc.u16(t.ch);
          this.sc.u16(16);
          this.sc.zero(4);
          this.sc.u32(t.sr << 16);
          if (t.codec.includes("aac") || t.codec.includes("mp4a")) {
            this.sc.box("esds");
            this.sc.u32(0);
            let c = t.cfgData || new Uint8Array([17, 144]);
            this.sc.u8(3);
            this.sc.u8(23 + c.byteLength);
            this.sc.u16(1);
            this.sc.u8(0);
            this.sc.u8(4);
            this.sc.u8(15 + c.byteLength);
            this.sc.u8(64);
            this.sc.u8(21);
            this.sc.u24(0);
            this.sc.u32(128e3);
            this.sc.u32(128e3);
            this.sc.u8(5);
            this.sc.u8(c.byteLength);
            this.sc.bytes(c);
            this.sc.u8(6);
            this.sc.u8(1);
            this.sc.u8(2);
            this.sc.end();
          } else if (t.codec.includes("opus")) {
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
    Engine.prototype._initAVI = function() {
    };
    Engine.prototype._finalizeAVI = function() {
      this._flushInterleaved();
      const tks = [this.vt, this.at].filter((t) => t);
      const fps = this.vt ? this.vt.fps : 25;
      const usPerFrame = Math.round(1e6 / fps);
      const vFrames = this.vt ? this.vt.stsz.length : 0;
      const aFrames = this.at ? this.at.stsz.length : 0;
      const w = this.vt ? this.vt.w : 0, h = this.vt ? this.vt.h : 0;
      let totalChunkSize = 0;
      for (const c of this._aviChunks)
        totalChunkSize += c.byteLength;
      const moviData = new Uint8Array(totalChunkSize);
      let wPos = 0;
      for (const c of this._aviChunks) {
        moviData.set(c, wPos);
        wPos += c.byteLength;
      }
      this._aviChunks = [];
      const sc = this.sc;
      sc.reset();
      sc.rif("RIFF");
      sc.str("AVI ");
      sc.rif("LIST");
      sc.str("hdrl");
      sc.rif("avih");
      sc.u32le(usPerFrame);
      sc.u32le(0);
      sc.u32le(0);
      sc.u32le(16 | 32);
      sc.u32le(Math.max(vFrames, aFrames));
      sc.u32le(0);
      sc.u32le(tks.length);
      sc.u32le(1024 * 1024);
      sc.u32le(w);
      sc.u32le(h);
      sc.u32le(0);
      sc.u32le(0);
      sc.u32le(0);
      sc.u32le(0);
      sc.end();
      if (this.vt) {
        sc.rif("LIST");
        sc.str("strl");
        sc.rif("strh");
        sc.str("vids");
        const vc = this.vt.codec;
        const fourcc = vc.includes("h264") || vc.includes("avc") ? "H264" : vc.includes("vp8") ? "VP80" : "MJPG";
        sc.str(fourcc);
        sc.u32le(0);
        sc.u16le(0);
        sc.u16le(0);
        sc.u32le(0);
        sc.u32le(1);
        sc.u32le(Math.round(fps));
        sc.u32le(0);
        sc.u32le(vFrames);
        sc.u32le(1024 * 1024);
        sc.u32le(4294967295);
        sc.u32le(0);
        sc.u16le(0);
        sc.u16le(0);
        sc.u16le(w);
        sc.u16le(h);
        sc.end();
        sc.rif("strf");
        sc.u32le(40);
        sc.u32le(w);
        sc.u32le(h);
        sc.u16le(1);
        sc.u16le(24);
        sc.str(fourcc);
        sc.u32le(w * h * 3);
        sc.u32le(0);
        sc.u32le(0);
        sc.u32le(0);
        sc.u32le(0);
        sc.end();
        sc.end();
      }
      if (this.at) {
        sc.rif("LIST");
        sc.str("strl");
        const isAAC = this.at.codec.includes("aac") || this.at.codec.includes("mp4a");
        sc.rif("strh");
        sc.str("auds");
        sc.u32le(isAAC ? 255 : 85);
        sc.u32le(0);
        sc.u16le(0);
        sc.u16le(0);
        sc.u32le(0);
        sc.u32le(1);
        sc.u32le(this.at.sr);
        sc.u32le(0);
        sc.u32le(aFrames);
        sc.u32le(12288);
        sc.u32le(4294967295);
        sc.u32le(0);
        sc.u16le(0);
        sc.u16le(0);
        sc.u16le(0);
        sc.u16le(0);
        sc.end();
        sc.rif("strf");
        sc.u16le(isAAC ? 255 : 85);
        sc.u16le(this.at.ch);
        sc.u32le(this.at.sr);
        sc.u32le(isAAC ? this.at.sr * this.at.ch * 2 : 16e3);
        sc.u16le(isAAC ? 1 : this.at.ch * 2);
        sc.u16le(isAAC ? 16 : 0);
        if (isAAC && this.at.cfgData) {
          sc.u16le(this.at.cfgData.byteLength);
          sc.bytes(this.at.cfgData);
        } else
          sc.u16le(0);
        sc.end();
        sc.end();
      }
      sc.end();
      sc.rif("LIST");
      sc.str("movi");
      sc.chunk(moviData);
      sc.end();
      sc.rif("idx1");
      let off = 4;
      for (const e of this._aviIdx) {
        sc.str(e.tag);
        sc.u32le(e.flags);
        sc.u32le(off);
        sc.u32le(e.size);
        off += e.size + 8;
      }
      sc.end();
      sc.end();
      this._flushSc();
    };
    const OGG_CRC = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i << 24;
      for (let j = 0; j < 8; j++)
        c = c << 1 ^ (c & 2147483648 ? 79764919 : 0);
      OGG_CRC[i] = c >>> 0;
    }
    Engine.prototype._initOGG = function() {
      const at = this.at;
      if (!at) {
        this.err(new Error("[AegisMuxer] OGG requires an audio track"));
        return;
      }
      const oh = new Uint8Array(19);
      oh.set([79, 112, 117, 115, 72, 101, 97, 100]);
      oh[8] = 1;
      oh[9] = at.ch;
      oh[10] = 0;
      oh[11] = 15;
      oh[12] = at.sr & 255;
      oh[13] = at.sr >> 8 & 255;
      oh[14] = at.sr >> 16 & 255;
      oh[15] = at.sr >> 24 & 255;
      oh[16] = 0;
      oh[17] = 0;
      oh[18] = 0;
      this._writeOGGPage(oh, false, true);
      const tag = new Uint8Array(20);
      tag.set([79, 112, 117, 115, 84, 97, 103, 115]);
      tag[8] = 5;
      tag.set([65, 101, 103, 105, 115], 12);
      this._writeOGGPage(tag, false, false);
    };
    Engine.prototype._writeOGGPage = function(data, isEOS, isBOS) {
      const segCount = Math.max(1, Math.ceil(data.length / 255));
      const headSz = 27 + segCount;
      const page = new Uint8Array(headSz + data.length);
      const v = new DataView(page.buffer);
      page.set([79, 103, 103, 83]);
      page[4] = 0;
      page[5] = (isBOS ? 2 : 0) | (isEOS ? 4 : 0);
      v.setUint32(6, this._oggGranule >>> 0, true);
      v.setUint32(10, 0, true);
      v.setUint32(14, this._oggSerial, true);
      v.setUint32(18, this._oggPageSeq++, true);
      v.setUint32(22, 0, true);
      page[26] = segCount;
      let rem = data.length;
      for (let i = 0; i < segCount; i++) {
        page[27 + i] = Math.min(rem, 255);
        rem -= Math.min(rem, 255);
      }
      page.set(data, headSz);
      let crc = 0;
      for (let i = 0; i < page.length; i++)
        crc = (crc << 8 ^ OGG_CRC[crc >>> 24 & 255 ^ page[i]]) >>> 0;
      v.setUint32(22, crc, true);
      try {
        this.sink.write(page);
      } catch (e) {
        this.err(e instanceof Error ? e : new Error(String(e)));
      }
    };
    Engine.prototype._flushOGG = function() {
      const at = this.at;
      if (!at)
        return;
      while (at.queue.length) {
        const f = at.queue.shift();
        this._oggGranule += 960;
        this._writeOGGPage(f.d, false);
        f.d = null;
      }
    };
    Engine.prototype._flushMP3 = function() {
      const at = this.at;
      if (!at)
        return;
      while (at.queue.length) {
        const f = at.queue.shift();
        if (f.d && f.d.byteLength > 0) {
          try {
            this.sink.write(f.d);
          } catch (e) {
            this.err(e instanceof Error ? e : new Error(String(e)));
          }
        }
        f.d = null;
      }
    };
    return { MemSink, StreamSink, FileSink, WebStreamSink, Engine };
  })();

  // src/gl.ts
  init_core();
  var GL = class {
    canvas;
    gl;
    program = null;
    uniformLocs = /* @__PURE__ */ new Map();
    textures = /* @__PURE__ */ new Map();
    quadVAO = null;
    constructor(width, height, opts) {
      this.canvas = new OffscreenCanvas(width, height);
      const glOpts = {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance"
      };
      const ctx = this.canvas.getContext("webgl2", glOpts);
      if (!ctx)
        throw new AegisError("WebGL2 not available. AegisForge requires WebGL2.");
      this.gl = ctx;
      if (opts?.hdr) {
        if (!ctx.getExtension("EXT_color_buffer_float")) {
          log.warn("[GL] EXT_color_buffer_float not available \u2014 HDR degraded to RGBA8");
        }
      }
      this._initQuad();
    }
    _initQuad() {
      const gl = this.gl;
      this.quadVAO = gl.createVertexArray();
      gl.bindVertexArray(this.quadVAO);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1,
        -1,
        1,
        -1,
        -1,
        1,
        -1,
        1,
        1,
        -1,
        1,
        1
      ]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    _compileShader(src, type) {
      const s = this.gl.createShader(type);
      this.gl.shaderSource(s, src);
      this.gl.compileShader(s);
      if (!this.gl.getShaderParameter(s, this.gl.COMPILE_STATUS))
        throw new AegisError(`Shader compile error:
${this.gl.getShaderInfoLog(s)}`);
      return s;
    }
    loadShaders(vert, frag) {
      const gl = this.gl;
      const vs = this._compileShader(vert, gl.VERTEX_SHADER);
      const fs = this._compileShader(frag, gl.FRAGMENT_SHADER);
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, "a_pos");
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
        throw new AegisError(`Program link error:
${gl.getProgramInfoLog(prog)}`);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      this.program = prog;
      this.uniformLocs.clear();
      gl.useProgram(prog);
      return this;
    }
    loadFragmentShader(frag) {
      return this.loadShaders(VERT_FULLSCREEN, frag);
    }
    setUniform1f(name, v) {
      const l = this._loc(name);
      if (l)
        this.gl.uniform1f(l, v);
      return this;
    }
    setUniform2f(name, x, y) {
      const l = this._loc(name);
      if (l)
        this.gl.uniform2f(l, x, y);
      return this;
    }
    setUniform3f(name, x, y, z) {
      const l = this._loc(name);
      if (l)
        this.gl.uniform3f(l, x, y, z);
      return this;
    }
    setUniform4f(name, x, y, z, w) {
      const l = this._loc(name);
      if (l)
        this.gl.uniform4f(l, x, y, z, w);
      return this;
    }
    setUniform1i(name, v) {
      const l = this._loc(name);
      if (l)
        this.gl.uniform1i(l, v);
      return this;
    }
    setUniform1fv(name, v) {
      const l = this._loc(name);
      if (l)
        this.gl.uniform1fv(l, v);
      return this;
    }
    setUniformMatrix3fv(name, v) {
      const l = this._loc(name);
      if (l)
        this.gl.uniformMatrix3fv(l, false, v);
      return this;
    }
    setUniformMatrix4fv(name, v) {
      const l = this._loc(name);
      if (l)
        this.gl.uniformMatrix4fv(l, false, v);
      return this;
    }
    _loc(name) {
      if (!this.program)
        return null;
      if (!this.uniformLocs.has(name)) {
        const l = this.gl.getUniformLocation(this.program, name);
        if (l)
          this.uniformLocs.set(name, l);
        else
          return null;
      }
      return this.uniformLocs.get(name) ?? null;
    }
    bindTexture(name, source, unit = 0, hdr = false) {
      const gl = this.gl;
      if (!this.program || source === null)
        return this;
      let tex = this.textures.get(name);
      const isNew = !tex;
      if (!tex) {
        tex = gl.createTexture();
        this.textures.set(name, tex);
      }
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (isNew) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      }
      const internalFmt = hdr ? gl.RGBA16F : gl.RGBA8;
      const fmt = gl.RGBA, type = hdr ? gl.FLOAT : gl.UNSIGNED_BYTE;
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFmt, fmt, type, source);
      const loc = this._loc(name);
      if (loc)
        gl.uniform1i(loc, unit);
      return this;
    }
    render(target = null) {
      const gl = this.gl;
      if (!this.program)
        throw new AegisError("No shader loaded");
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindVertexArray(this.quadVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
      return this;
    }
    async extract() {
      return createImageBitmap(this.canvas);
    }
  };
  var FBOChain = class {
    fbos;
    textures;
    idx = 0;
    gl;
    w;
    h;
    constructor(gl, width, height, hdr = false) {
      this.gl = gl;
      this.w = width;
      this.h = height;
      const mk = () => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        const internalFmt = hdr ? gl.RGBA16F : gl.RGBA8;
        const type = hdr ? gl.FLOAT : gl.UNSIGNED_BYTE;
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFmt, width, height, 0, gl.RGBA, type, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
          log.warn(`[FBOChain] Framebuffer incomplete: 0x${status.toString(16)}`);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return [fbo, tex];
      };
      const a = mk(), b = mk();
      this.fbos = [a[0], b[0]];
      this.textures = [a[1], b[1]];
    }
    get writeFBO() {
      return this.fbos[this.idx];
    }
    get readTex() {
      return this.textures[1 - this.idx];
    }
    swap() {
      this.idx = 1 - this.idx;
    }
    dispose() {
      this.fbos.forEach((f) => this.gl.deleteFramebuffer(f));
      this.textures.forEach((t) => this.gl.deleteTexture(t));
    }
  };
  var MAX_LAYERS = 8;
  var BLEND_ID = {
    normal: 0,
    add: 1,
    multiply: 2,
    screen: 3,
    overlay: 4,
    hardlight: 5,
    dodge: 6,
    burn: 7
  };
  var MultiLayerCompositor = class extends GL {
    constructor(width, height) {
      super(width, height, { hdr: true });
      this.loadShaders(VERT_FULLSCREEN, buildCompositorFrag(MAX_LAYERS));
      this.gl.useProgram(this.program);
    }
    composite(layers) {
      const gl = this.gl;
      gl.useProgram(this.program);
      const count = Math.min(layers.length, MAX_LAYERS);
      this.setUniform1i("u_layerCount", count);
      for (let i = 0; i < count; i++) {
        const L = layers[i];
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, L.texture);
        this.setUniform1i(`u_layer[${i}].tex`, i);
        this.setUniform1f(`u_layer[${i}].opacity`, L.opacity);
        this.setUniform1i(`u_layer[${i}].blend`, BLEND_ID[L.blend] ?? 0);
        this.setUniform4f(`u_layer[${i}].rect`, ...L.rect);
      }
      return this.render();
    }
  };
  function bindVideoFrameTexture(gl, tex, frame, unit = 0) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, frame);
  }
  var VERT_FULLSCREEN = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main(){
    v_uv = a_pos * 0.5 + 0.5;
    v_uv.y = 1.0 - v_uv.y;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
  function buildCompositorFrag(nLayers) {
    return `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

struct Layer {
    int tex;
    float opacity;
    int blend;
    vec4 rect; 
};
uniform int u_layerCount;
uniform Layer u_layer[${nLayers}];
uniform sampler2D u_tex0,u_tex1,u_tex2,u_tex3,u_tex4,u_tex5,u_tex6,u_tex7;

vec4 sampleLayer(int i, vec2 uv){
    if(i==0) return texture(u_tex0,uv);
    if(i==1) return texture(u_tex1,uv);
    if(i==2) return texture(u_tex2,uv);
    if(i==3) return texture(u_tex3,uv);
    if(i==4) return texture(u_tex4,uv);
    if(i==5) return texture(u_tex5,uv);
    if(i==6) return texture(u_tex6,uv);
    return texture(u_tex7,uv);
}

vec3 blendMode(vec3 base, vec3 src, int mode){
    if(mode==1) return base+src;               
    if(mode==2) return base*src;               
    if(mode==3) return 1.0-(1.0-base)*(1.0-src); 
    if(mode==4) return mix(                    
        2.0*base*src,
        1.0-2.0*(1.0-base)*(1.0-src),
        step(0.5, base));
    if(mode==5) return mix(                    
        2.0*base*src,
        1.0-2.0*(1.0-base)*(1.0-src),
        step(0.5, src));
    if(mode==6) return base/(1.0-src+1e-4);   
    if(mode==7) return 1.0-(1.0-base)/(src+1e-4); 
    
    return src;
}

void main(){
    vec4 result = vec4(0.0, 0.0, 0.0, 1.0);
    for(int i=0; i<${nLayers}; i++){
        if(i >= u_layerCount) break;
        Layer L = u_layer[i];
        vec4 r = L.rect;
        vec2 lu = (v_uv - r.xy) / r.zw;
        if(lu.x < 0.0 || lu.x > 1.0 || lu.y < 0.0 || lu.y > 1.0) continue;
        vec4 sc = sampleLayer(L.tex, lu);
        float a = sc.a * L.opacity;
        vec3 blended = blendMode(result.rgb, sc.rgb, L.blend);
        result.rgb = mix(result.rgb, blended, a);
    }
    outColor = result;
}`;
  }
  var Shaders = {
    Passthrough: `#version 300 es
precision mediump float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_image;
void main(){ o = texture(u_image, v_uv); }`,
    ChromaKey: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_image;
uniform vec3 u_keyColor;
uniform float u_similarity;
uniform float u_smoothness;
void main(){
    vec4 c = texture(u_image, v_uv);
    
    vec3 yuv = mat3(0.299,-0.1687,0.5,0.587,-0.3313,-0.4187,0.114,0.5,-0.0813) * c.rgb;
    vec3 kYuv = mat3(0.299,-0.1687,0.5,0.587,-0.3313,-0.4187,0.114,0.5,-0.0813) * u_keyColor;
    float dist = distance(yuv.yz, kYuv.yz);
    float alpha = smoothstep(u_similarity, u_similarity + u_smoothness, dist);
    o = vec4(c.rgb, c.a * alpha);
}`,
    FractalNoise: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_image;
uniform float u_time;
uniform float u_scale;
uniform float u_octaves; 
uniform float u_lacunarity; 
uniform float u_gain;       

float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
float noise(vec2 p){
    vec2 i=floor(p), f=fract(p);
    vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),
               mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
}
float fbm(vec2 p, float octs, float lac, float g){
    float val=0.0, amp=0.5, freq=1.0;
    for(int i=0;i<8;i++){
        if(float(i)>=octs) break;
        val+=amp*noise(p*freq);
        freq*=lac; amp*=g;
    }
    return val;
}
void main(){
    vec4 base = texture(u_image, v_uv);
    float n = fbm(v_uv * u_scale + u_time * 0.05, u_octaves, u_lacunarity, u_gain);
    o = vec4(base.rgb * (0.8 + 0.4*n), base.a);
}`,
    ACESToneMap: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_image;
uniform float u_exposure;

float srgb(float c){ return c<=0.04045?c/12.92:pow((c+0.055)/1.055,2.4); }
vec3 toLinear(vec3 c){ return vec3(srgb(c.r),srgb(c.g),srgb(c.b)); }

const mat3 AP0_to_AP1 = mat3(
    1.4514393161,-0.0765537734,0.0083161484,
   -0.2365107469,1.1762296998,-0.0060324498,
   -0.2149285693,-0.0996759264,0.9977163014);

vec3 RRTandODT(vec3 v){
    vec3 a=v*(v+0.0245786)-0.000090537;
    vec3 b=v*(0.983729*v+0.4329510)+0.238081;
    return a/b;
}

const mat3 AP1_to_sRGB = mat3(
    1.7050514990,-0.1302564590,-0.0240558247,
   -0.6217909379,1.1409052645,-0.1289772641,
   -0.0832567039,-0.0106487802,1.1530268940);

vec3 linearToSRGB(vec3 c){ return mix(12.92*c, 1.055*pow(c,vec3(1.0/2.4))-0.055, step(0.0031308, c)); }

void main(){
    vec4 hdr = texture(u_image, v_uv);
    vec3 c = toLinear(hdr.rgb) * u_exposure;
    c = AP0_to_AP1 * c;
    c = RRTandODT(c);
    c = AP1_to_sRGB * c;
    c = clamp(c, 0.0, 1.0);
    o = vec4(linearToSRGB(c), hdr.a);
}`,
    BloomThreshold: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_image;
uniform float u_threshold;
void main(){
    vec4 c=texture(u_image,v_uv);
    float lum=dot(c.rgb,vec3(0.2126,0.7152,0.0722));
    o = lum>u_threshold ? c : vec4(0.0,0.0,0.0,0.0);
}`,
    KawaseDown: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform float u_iteration;
void main(){
    float d=u_iteration+0.5;
    o=(texture(u_image,v_uv+vec2(-d,-d)*u_texelSize)+
       texture(u_image,v_uv+vec2( d,-d)*u_texelSize)+
       texture(u_image,v_uv+vec2(-d, d)*u_texelSize)+
       texture(u_image,v_uv+vec2( d, d)*u_texelSize))*0.25;
}`,
    KawaseUp: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform float u_iteration;
void main(){
    float d=u_iteration+0.5;
    o=(texture(u_image,v_uv+vec2(-d*2.0,0)*u_texelSize)+
       texture(u_image,v_uv+vec2(-d,-d)*u_texelSize)+
       texture(u_image,v_uv+vec2(0,-d*2.0)*u_texelSize)+
       texture(u_image,v_uv+vec2(d,-d)*u_texelSize)+
       texture(u_image,v_uv+vec2(d*2.0,0)*u_texelSize)+
       texture(u_image,v_uv+vec2(d,d)*u_texelSize)+
       texture(u_image,v_uv+vec2(0,d*2.0)*u_texelSize)+
       texture(u_image,v_uv+vec2(-d,d)*u_texelSize))/8.0;
}`,
    BloomComposite: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_image;
uniform sampler2D u_bloom;
uniform float u_intensity;
void main(){
    vec4 base=texture(u_image,v_uv);
    vec4 bloom=texture(u_bloom,v_uv);
    o=vec4(base.rgb+bloom.rgb*u_intensity, base.a);
}`,
    GaussianBlur: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform vec2 u_dir; 
uniform float u_radius; 
void main(){
    float sigma=u_radius/2.0;
    float s2=2.0*sigma*sigma;
    vec4 acc=vec4(0.0); float wt=0.0;
    int r=int(u_radius);
    for(int i=-r;i<=r;i++){
        float w=exp(-float(i*i)/s2);
        acc+=texture(u_image, v_uv+float(i)*u_dir*u_texelSize)*w;
        wt+=w;
    }
    o=acc/wt;
}`,
    Displacement: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_image;
uniform sampler2D u_dispMap;
uniform float u_strength;
uniform float u_time;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
void main(){
    vec2 disp=texture(u_dispMap,v_uv+u_time*0.01).rg*2.0-1.0;
    
    if(length(disp)<0.01) disp=vec2(noise(v_uv*8.0+u_time),noise(v_uv*8.0+u_time+vec2(5.2,1.3)))*2.0-1.0;
    vec2 uv=v_uv+disp*u_strength;
    o=texture(u_image,clamp(uv,0.0,1.0));
}`,
    CRT: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_image;
uniform float u_scanlineStrength; 
uniform float u_barrel;           
uniform float u_time;
void main(){
    vec2 uv=v_uv*2.0-1.0;
    float r2=dot(uv,uv);
    uv*=1.0+u_barrel*r2;
    uv=uv*0.5+0.5;
    if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){o=vec4(0,0,0,1);return;}
    vec4 c=texture(u_image,uv);
    float scan=sin(uv.y*800.0+u_time*0.1)*0.5+0.5;
    c.rgb*=1.0-u_scanlineStrength*(1.0-scan);
    o=c;
}`,
    ColorGrade: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_image;
uniform vec3 u_lift;   
uniform vec3 u_gamma;  
uniform vec3 u_gain;   
uniform float u_saturation;
uniform float u_hue;
void main(){
    vec4 c=texture(u_image,v_uv);
    
    vec3 col=pow(max(c.rgb*(1.0+u_gain-u_lift)+u_lift,0.0), 1.0/(u_gamma+1e-4));
    
    float lum=dot(col,vec3(0.2126,0.7152,0.0722));
    vec3 grey=vec3(lum);
    col=grey+u_saturation*(col-grey);
    o=vec4(col,c.a);
}`,
    LUT3D: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_image;
uniform sampler2D u_lut;   
uniform float u_intensity;
void main(){
    vec4 c=texture(u_image,v_uv);
    float b=c.b*63.0;
    float bFloor=floor(b);
    float bCeil=ceil(b);
    vec2 q1=vec2((bFloor/8.0+c.r*63.0/8.0)/64.0, (floor(bFloor/8.0)+c.g*63.0/8.0)/64.0);
    vec2 q2=vec2((bCeil /8.0+c.r*63.0/8.0)/64.0, (floor(bCeil /8.0)+c.g*63.0/8.0)/64.0);
    vec4 lc=mix(texture(u_lut,q1),texture(u_lut,q2),fract(b));
    o=mix(c,lc,u_intensity);
}`,
    NoiseParticles: `#version 300 es
precision mediump float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_image;
uniform float u_time;
float rand(vec2 co){return fract(sin(dot(co.xy,vec2(12.9898,78.233)))*43758.5453);}
void main(){
    vec4 base=texture(u_image,v_uv);
    vec2 p=v_uv*100.0; p.y-=u_time*50.0;
    float n=rand(floor(p));
    float particle=step(0.98,n)*step(0.5,fract(p.y));
    o=base+vec4(vec3(particle),0.0);
}`
  };
  var CompositeGL = class extends GL {
    constructor(width, height) {
      super(width, height);
      this.loadFragmentShader(`#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_base;
uniform sampler2D u_overlay;
uniform float u_overlay_alpha;
uniform vec4 u_pip_rect;
void main(){
    vec4 base=texture(u_base,v_uv);
    if(v_uv.x>=u_pip_rect.x&&v_uv.x<=u_pip_rect.x+u_pip_rect.z&&
       v_uv.y>=u_pip_rect.y&&v_uv.y<=u_pip_rect.y+u_pip_rect.w){
        vec2 pu=vec2((v_uv.x-u_pip_rect.x)/u_pip_rect.z,(v_uv.y-u_pip_rect.y)/u_pip_rect.w);
        vec4 over=texture(u_overlay,pu);
        o=mix(base,over,u_overlay_alpha*over.a);
    } else { o=base; }
}`);
    }
    drawPIP(base, overlay, alpha, rect) {
      this.bindTexture("u_base", base, 0);
      this.bindTexture("u_overlay", overlay, 1);
      this.setUniform1f("u_overlay_alpha", alpha);
      this.setUniform4f("u_pip_rect", rect[0], rect[1], rect[2], rect[3]);
      return this.render();
    }
  };
  var WebGPUEngine = class {
    device = null;
    pipeline = null;
    async init(wgsl) {
      const gpu = navigator.gpu;
      if (!gpu)
        throw new AegisError("WebGPU not supported");
      const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter)
        throw new AegisError("No WebGPU adapter");
      this.device = await adapter.requestDevice();
      const module = this.device.createShaderModule({ code: wgsl });
      this.pipeline = this.device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "main" }
      });
    }
    async computeOnTexture(src, dst, width, height, extras) {
      if (!this.device || !this.pipeline)
        throw new AegisError("WebGPU not initialized");
      const entries = [
        { binding: 0, resource: src.createView() },
        { binding: 1, resource: dst.createView() },
        ...extras ?? []
      ];
      const bg = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries });
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
      pass.end();
      this.device.queue.submit([enc.finish()]);
      await this.device.queue.onSubmittedWorkDone();
    }
    async compute(width, height) {
      throw new AegisError("WebGPUEngine.compute(): Use computeOnTexture() with valid src/dst GPUTexture arguments");
    }
  };

  // src/index.ts
  init_encoders();

  // src/core/AegisCore.ts
  init_core();

  // src/core/interval_tree.ts
  var IntervalTree = class {
    root = null;
    _size = 0;
    get size() {
      return this._size;
    }
    insert(interval) {
      this.root = this._insert(this.root, interval);
      this._size++;
    }
    remove(id) {
      const [newRoot, removed] = this._remove(this.root, id);
      this.root = newRoot;
      if (removed)
        this._size--;
      return removed;
    }
    queryPoint(point) {
      const result = [];
      this._queryPoint(this.root, point, result);
      return result;
    }
    queryRange(lo, hi) {
      const result = [];
      this._queryRange(this.root, lo, hi, result);
      return result;
    }
    clear() {
      this.root = null;
      this._size = 0;
    }
    buildFromClips(clips) {
      this.clear();
      const sorted = clips.slice().sort((a, b) => a.inPoint - b.inPoint);
      this.root = this._buildBalanced(sorted, 0, sorted.length - 1);
      this._size = sorted.length;
    }
    _buildBalanced(clips, lo, hi) {
      if (lo > hi)
        return null;
      const mid = lo + hi >> 1;
      const c = clips[mid];
      const node = {
        interval: { lo: c.inPoint, hi: c.outPoint, id: c.id, data: c },
        maxHi: c.outPoint,
        left: null,
        right: null,
        height: 1
      };
      node.left = this._buildBalanced(clips, lo, mid - 1);
      node.right = this._buildBalanced(clips, mid + 1, hi);
      this._updateNode(node);
      return node;
    }
    _insert(node, interval) {
      if (!node)
        return { interval, maxHi: interval.hi, left: null, right: null, height: 1 };
      if (interval.lo < node.interval.lo) {
        node.left = this._insert(node.left, interval);
      } else {
        node.right = this._insert(node.right, interval);
      }
      this._updateNode(node);
      return this._balance(node);
    }
    _remove(node, id) {
      if (!node)
        return [null, false];
      if (node.interval.id === id) {
        if (!node.left)
          return [node.right, true];
        if (!node.right)
          return [node.left, true];
        let successor = node.right;
        while (successor.left)
          successor = successor.left;
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
    _queryPoint(node, point, result) {
      if (!node)
        return;
      if (point > node.maxHi)
        return;
      this._queryPoint(node.left, point, result);
      if (point >= node.interval.lo && point < node.interval.hi) {
        result.push(node.interval);
      }
      if (point >= node.interval.lo) {
        this._queryPoint(node.right, point, result);
      }
    }
    _queryRange(node, lo, hi, result) {
      if (!node)
        return;
      if (lo > node.maxHi)
        return;
      this._queryRange(node.left, lo, hi, result);
      if (node.interval.lo < hi && node.interval.hi > lo) {
        result.push(node.interval);
      }
      if (hi > node.interval.lo) {
        this._queryRange(node.right, lo, hi, result);
      }
    }
    _height(node) {
      return node ? node.height : 0;
    }
    _updateNode(node) {
      node.height = 1 + Math.max(this._height(node.left), this._height(node.right));
      node.maxHi = node.interval.hi;
      if (node.left && node.left.maxHi > node.maxHi)
        node.maxHi = node.left.maxHi;
      if (node.right && node.right.maxHi > node.maxHi)
        node.maxHi = node.right.maxHi;
    }
    _balance(node) {
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
    _rotateRight(node) {
      const x = node.left;
      node.left = x.right;
      x.right = node;
      this._updateNode(node);
      this._updateNode(x);
      return x;
    }
    _rotateLeft(node) {
      const x = node.right;
      node.right = x.left;
      x.left = node;
      this._updateNode(node);
      this._updateNode(x);
      return x;
    }
  };

  // src/core/AegisCore.ts
  var AegisCore = class {
    config = {
      width: 1280,
      height: 720,
      fps: 30,
      bitrate: 2e6,
      vCodec: "vp8",
      audio: null,
      preset: "balanced",
      trim: null,
      crop: null,
      useProxy: false,
      hdr: false,
      gopSize: 0
    };
    timeline = { duration: 0, clips: [] };
    plugins = /* @__PURE__ */ new Set();
    onProgress = null;
    logPrefix = "[AegisCore V5]";
    currentMs = 0;
    ctx = null;
    _compositor = null;
    _acesGL = null;
    _fboChain = null;
    _texCache = /* @__PURE__ */ new Map();
    _proxyCache = /* @__PURE__ */ new Map();
    _emptyBitmap = null;
    constructor() {
    }
    use(plugin) {
      this.plugins.add(plugin);
      if (typeof plugin === "function")
        plugin(this);
      else if (plugin.init)
        plugin.init(this);
      return this;
    }
    input(source, opts) {
      if (Array.isArray(source)) {
        let cur = opts?.start || 0;
        for (const s of source) {
          this.input(s, { ...opts, start: cur });
          cur += opts?.duration || 1e3;
        }
        return this;
      }
      const type = source instanceof Aud ? "audio" : source && typeof source === "object" && "_isComp" in source ? "comp" : source instanceof HTMLVideoElement || source && typeof source === "object" && "_isVid" in source ? "video" : "image";
      const start = opts?.start || 0;
      const end = opts?.end || (opts?.duration ? start + opts.duration : start + 1e3);
      const clip = {
        id: Math.random().toString(36).slice(2, 9),
        type,
        source: source instanceof Img || source instanceof Aud || source instanceof HTMLVideoElement || source instanceof ImageBitmap || source instanceof HTMLImageElement ? source : null,
        start,
        end,
        layer: opts?.layer ?? 0,
        x: opts?.x ?? 0,
        y: opts?.y ?? 0,
        w: opts?.w ?? this.config.width,
        h: opts?.h ?? this.config.height,
        scaleX: opts?.scaleX ?? 1,
        scaleY: opts?.scaleY ?? 1,
        opacity: opts?.opacity ?? 1,
        blend: opts?.blend ?? "normal",
        audioVolume: opts?.audioVolume ?? 1,
        path: opts?.path,
        timeRemap: opts?.timeRemap,
        proxyUrl: opts?.proxyUrl
      };
      this.timeline.clips.push(clip);
      this.timeline.clips.sort((a, b) => a.layer - b.layer);
      if (end > this.timeline.duration)
        this.timeline.duration = end;
      return this;
    }
    precompose(subClips, opts) {
      const subTimeline = {
        duration: subClips.reduce((m, c) => Math.max(m, c.end), 0),
        clips: subClips
      };
      const start = opts?.start || 0;
      const end = opts?.end || (opts?.duration ? start + opts.duration : start + subTimeline.duration);
      const clip = {
        id: Math.random().toString(36).slice(2, 9),
        type: "comp",
        source: null,
        subTimeline,
        start,
        end,
        layer: opts?.layer ?? 0,
        x: opts?.x ?? 0,
        y: opts?.y ?? 0,
        w: opts?.w ?? this.config.width,
        h: opts?.h ?? this.config.height,
        scaleX: opts?.scaleX ?? 1,
        scaleY: opts?.scaleY ?? 1,
        opacity: opts?.opacity ?? 1,
        blend: opts?.blend ?? "normal",
        audioVolume: 1
      };
      this.timeline.clips.push(clip);
      this.timeline.clips.sort((a, b) => a.layer - b.layer);
      if (end > this.timeline.duration)
        this.timeline.duration = end;
      return this;
    }
    _val(v, timeMs) {
      if (typeof v === "number")
        return v;
      if (typeof v === "object" && v !== null && "get" in v)
        return v.get(timeMs / 1e3);
      return 0;
    }
    _clipRect(clip, timeMs) {
      let x = this._val(clip.x, timeMs);
      let y = this._val(clip.y, timeMs);
      const w = this._val(clip.w, timeMs) || this.config.width;
      const h = this._val(clip.h, timeMs) || this.config.height;
      if (clip.path) {
        const t = (timeMs - clip.start) / Math.max(1, clip.end - clip.start);
        const pt = clip.path.getPoint(Math.max(0, Math.min(1, t)));
        x = pt.x;
        y = pt.y;
      }
      return { x, y, w, h };
    }
    _remapTime(clip, absoluteMs) {
      const relT = (absoluteMs - clip.start) / Math.max(1, clip.end - clip.start);
      if (!clip.timeRemap)
        return absoluteMs - clip.start;
      const remapped = clip.timeRemap.get(relT);
      return remapped * Math.max(1, clip.end - clip.start);
    }
    _initGL() {
      if (this._compositor)
        return;
      this._compositor = new MultiLayerCompositor(this.config.width, this.config.height);
      if (this.config.hdr) {
        this._acesGL = new GL(this.config.width, this.config.height, { hdr: true });
        this._acesGL.loadFragmentShader(Shaders.ACESToneMap);
        this._fboChain = new FBOChain(
          this._compositor.gl,
          this.config.width,
          this.config.height,
          true
        );
      }
    }
    _getTex(clipId) {
      if (!this._texCache.has(clipId)) {
        const gl = this._compositor.gl;
        const tex = gl.createTexture();
        if (!tex)
          throw new AegisError("Failed to create texture for clip " + clipId);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, null);
        this._texCache.set(clipId, tex);
      }
      return this._texCache.get(clipId);
    }
    async _renderFrame(activeClips, timeMs) {
      const gl = this._compositor.gl;
      const layers = [];
      const W = this.config.width, H = this.config.height;
      for (const clip of activeClips) {
        if (clip.type === "audio")
          continue;
        const { x, y, w, h } = this._clipRect(clip, timeMs);
        const opacity = this._val(clip.opacity, timeMs);
        const tex = this._getTex(clip.id);
        if (clip.type === "video" || clip.type === "image") {
          const sourceTimeMs = this._remapTime(clip, timeMs);
          let imgSource = null;
          if (clip.proxyUrl && this.config.useProxy) {
            if (this._proxyCache.has(clip.proxyUrl)) {
              const cached = this._proxyCache.get(clip.proxyUrl);
              if (cached)
                imgSource = cached;
            } else {
              try {
                const bmp = await createImageBitmap(await (await fetch(clip.proxyUrl)).blob());
                this._proxyCache.set(clip.proxyUrl, bmp);
                imgSource = bmp;
              } catch {
                this._proxyCache.set(clip.proxyUrl, null);
              }
            }
          } else if (clip.source instanceof HTMLVideoElement) {
            const targetSec = sourceTimeMs / 1e3;
            if (clip.source.readyState >= 2 && Math.abs(clip.source.currentTime - targetSec) > 0.04) {
              const el = clip.source;
              clip.source.currentTime = targetSec;
              await new Promise((resolve) => {
                try {
                  el.requestVideoFrameCallback(() => resolve());
                } catch {
                  const onSeeked = () => {
                    el.removeEventListener("seeked", onSeeked);
                    resolve();
                  };
                  el.addEventListener("seeked", onSeeked);
                  setTimeout(resolve, 100);
                }
              });
            }
            imgSource = clip.source;
          } else if (clip.source instanceof Img && clip.source.c) {
            imgSource = clip.source.c;
          } else if (clip.source instanceof ImageBitmap || clip.source instanceof HTMLImageElement) {
            imgSource = clip.source;
          } else if (clip.type === "comp") {
            imgSource = await this._renderComp(clip, timeMs);
          }
          if (imgSource) {
            bindVideoFrameTexture(gl, tex, imgSource, 0);
            layers.push({
              texture: tex,
              opacity,
              blend: clip.blend || "normal",
              rect: [x / W, y / H, w / W, h / H]
            });
          }
        } else if (clip.type === "text" || clip.type === "custom") {
          if (clip.meta?.gpuTexture) {
            layers.push({
              texture: clip.meta.gpuTexture,
              opacity,
              blend: clip.blend || "normal",
              rect: [x / W, y / H, w / W, h / H]
            });
          }
        }
      }
      if (layers.length === 0) {
        if (!this._emptyBitmap) {
          const tmp = new OffscreenCanvas(Math.max(1, W), Math.max(1, H));
          this._emptyBitmap = await createImageBitmap(tmp);
          tmp.width = tmp.height = 0;
        }
        return this._emptyBitmap;
      }
      this._compositor.composite(layers);
      return this._compositor.canvas.transferToImageBitmap();
    }
    async _renderComp(comp, masterMs) {
      const localMs = masterMs - comp.start;
      const active = comp.subTimeline.clips.filter((c) => localMs >= c.start && localMs < c.end);
      return this._renderFrame(active, localMs);
    }
    async save(filename = "output.webm") {
      const isStream = typeof filename === "object" && filename !== null && "getWriter" in filename;
      const finalFilename = isStream ? "stream.webm" : String(filename);
      const res = new ResourceManager();
      this._initGL();
      let vid = null;
      try {
        const vidConfig = {
          video: {
            width: this.config.width,
            height: this.config.height,
            framerate: this.config.fps,
            bitrate: this.config.bitrate,
            codec: this.config.vCodec,
            preset: this.config.preset
          },
          audio: this.config.audio,
          stream: isStream ? filename : void 0,
          mp4Container: finalFilename.toLowerCase().endsWith(".mp4") || finalFilename.toLowerCase().endsWith(".m4v"),
          directToDisk: false
        };
        vid = new Vid(vidConfig);
        await vid.init();
        res.track(vid);
        const ts = new TimestampSync(this.config.fps, this.config.audio?.sampleRate || 48e3);
        const rtc = new RationalTimecode(this.config.fps);
        const trimStartMs = this.config.trim ? this.config.trim.start : 0;
        const trimEndMs = this.config.trim ? this.config.trim.end : this.timeline.duration || 1e3;
        const frameDuration = 1e3 / this.config.fps;
        const totalFrames = Math.ceil((trimEndMs - trimStartMs) / frameDuration);
        const frameDurUs = Math.max(1, Math.round(1e6 / this.config.fps));
        let audioIterator = null;
        let audioDone = true;
        const audioClips = this.timeline.clips.filter((c) => c.type === "audio");
        if (audioClips.length > 0 && this.config.audio) {
          const sr = this.config.audio.sampleRate || 48e3;
          const ch = this.config.audio.numberOfChannels || 2;
          const audInputs = audioClips.map((c) => ({ aud: c.source instanceof Aud ? c.source : null, start: c.start, volume: typeof c.audioVolume === "number" ? c.audioVolume : 1 })).filter((x) => x.aud);
          if (audInputs.length > 0) {
            audioIterator = Aud.mixWebStreams(audInputs, sr, ch, 8192);
            audioDone = false;
          }
        }
        const clipTree = new IntervalTree();
        clipTree.buildFromClips(this.timeline.clips.map((c) => ({
          id: c.id,
          inPoint: c.start,
          outPoint: c.end,
          data: c
        })));
        const gopSize = this.config.gopSize > 0 ? this.config.gopSize : Math.round(this.config.fps * 2);
        for (let fIdx = 0; fIdx < totalFrames; fIdx++) {
          this.currentMs = trimStartMs + fIdx * frameDuration;
          const intervals = clipTree.queryPoint(this.currentMs);
          const activeClips = intervals.map((iv) => iv.data);
          for (const p of this.plugins) {
            if (typeof p !== "function" && p.onBeforeFrame)
              p.onBeforeFrame(this, activeClips, this.currentMs);
          }
          const bitmap = await this._renderFrame(activeClips, this.currentMs);
          const tRelUs = Math.max(0, Math.round((this.currentMs - trimStartMs) * 1e3));
          const vf = new VideoFrame(bitmap, { timestamp: tRelUs, duration: frameDurUs, alpha: "discard" });
          if (bitmap !== this._emptyBitmap)
            bitmap.close();
          try {
            await vid.pushVid(vf, fIdx % gopSize === 0);
          } catch (pushErr) {
            try {
              vf.close();
            } catch (_) {
            }
            throw pushErr;
          }
          for (const p of this.plugins) {
            if (typeof p !== "function" && p.onAfterFrame)
              p.onAfterFrame(this, fIdx);
          }
          if (fIdx % 60 === 0)
            await new Promise((r) => setTimeout(r, 0));
          if (this.onProgress) {
            try {
              this.onProgress(Math.min(100, Math.floor((this.currentMs - trimStartMs) / (trimEndMs - trimStartMs) * 100)));
            } catch (_) {
            }
          }
          if (audioIterator && !audioDone) {
            while (!audioDone && ts.peekAudioPts() / 1e3 <= this.currentMs) {
              let audioData = null;
              try {
                const result = await audioIterator.next();
                if (result.done) {
                  audioDone = true;
                  break;
                }
                audioData = result.value.audioData;
                const aPts = audioData.timestamp / 1e3;
                if (aPts >= trimStartMs && aPts <= trimEndMs) {
                  await vid.pushAud(audioData);
                } else {
                  audioData.close();
                }
                audioData = null;
              } catch (audioErr) {
                if (audioData) {
                  try {
                    audioData.close();
                  } catch (_) {
                  }
                }
                log.warn("[AegisCore] Audio push error", audioErr);
              }
            }
          }
        }
        if (this.onProgress)
          this.onProgress(100);
        if (audioIterator && !audioDone) {
          while (true) {
            let audioData = null;
            try {
              const r = await audioIterator.next();
              if (r.done)
                break;
              audioData = r.value.audioData;
              if (audioData.timestamp / 1e3 <= trimEndMs) {
                await vid.pushAud(audioData);
              } else {
                audioData.close();
                break;
              }
              audioData = null;
            } catch (audioErr) {
              if (audioData) {
                try {
                  audioData.close();
                } catch (_) {
                }
              }
              log.warn("[AegisCore] Audio drain error", audioErr);
            }
          }
        }
        log.info(this.logPrefix, "Flushing to muxer...");
        const buffer = await vid.flush();
        if (isStream)
          return;
        const mimeType = finalFilename.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4";
        const fileBlocks = Array.isArray(buffer) ? buffer : [buffer];
        const fileObj = new File(fileBlocks, finalFilename, { type: mimeType });
        const url = URL.createObjectURL(fileObj);
        const a = document.createElement("a");
        a.href = url;
        a.download = finalFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1e3);
        return fileObj;
      } catch (err) {
        log.error(this.logPrefix, err);
        throw err;
      } finally {
        if (vid)
          try {
            vid.close();
          } catch (_) {
          }
        res.closeAll();
      }
    }
    dispose() {
      for (const p of this.plugins) {
        if (typeof p !== "function" && p.dispose) {
          try {
            p.dispose();
          } catch (_) {
          }
        }
      }
      this._texCache.forEach((t) => this._compositor?.gl.deleteTexture(t));
      this._texCache.clear();
      for (const bmp of this._proxyCache.values()) {
        try {
          bmp.close();
        } catch (_) {
        }
      }
      this._proxyCache.clear();
      this._fboChain?.dispose();
      if (this._compositor) {
        const gl = this._compositor.gl;
        const ext = gl.getExtension("WEBGL_lose_context");
        if (ext)
          ext.loseContext();
      }
      if (this._acesGL) {
        const gl2 = this._acesGL.gl;
        const ext2 = gl2.getExtension("WEBGL_lose_context");
        if (ext2)
          ext2.loseContext();
      }
      this._compositor = null;
      this._acesGL = null;
      this._fboChain = null;
    }
  };

  // src/core/swarm.ts
  init_core();
  var AegisSwarm = class {
    core;
    peers = /* @__PURE__ */ new Map();
    _chunks = /* @__PURE__ */ new Map();
    _pendingPeers = /* @__PURE__ */ new Set();
    _resolveAll = null;
    _timeoutMs = 6e4;
    constructor(core) {
      this.core = core;
    }
    async invitePeer(signalingOfferStr) {
      const peer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      const dataChannel = peer.createDataChannel("aegis-swarm-tx", {
        ordered: true,
        maxRetransmits: 3
      });
      const peerId = Math.random().toString(36).substring(2, 9);
      this.peers.set(peerId, { id: peerId, conn: peer, channel: dataChannel, fpsCap: 30 });
      peer.ondatachannel = (event) => {
        const rxChannel = event.channel;
        rxChannel.binaryType = "arraybuffer";
        rxChannel.onmessage = (msg) => this._handleSwarmPayload(peerId, msg);
      };
      peer.oniceconnectionstatechange = () => {
        if (peer.iceConnectionState === "disconnected" || peer.iceConnectionState === "failed") {
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
    async executeSwarmRender(filename = "swarm_output.mp4") {
      if (this.peers.size === 0) {
        log.warn("AegisSwarm: No connected peers. Falling back to local compute.");
        await this.core.save(filename);
        return new ArrayBuffer(0);
      }
      const totalDurationMs = this.core.timeline.duration || 1e3;
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
          action: "RENDER_CHUNK",
          projectId: "aegis-v4",
          startMs: startCmdMs,
          endMs: endCmdMs,
          config: this.core.config
        };
        if (peer.channel.readyState === "open") {
          try {
            peer.channel.send(JSON.stringify(payload));
          } catch (serErr) {
            log.warn(`AegisSwarm: Failed to serialize payload for peer ${id}:`, serErr);
            continue;
          }
          this._pendingPeers.add(id);
          log.info(`AegisSwarm: TX \u2192 Node [${id}] Range: ${startCmdMs.toFixed(0)}-${endCmdMs.toFixed(0)}ms`);
        } else {
          log.warn(`AegisSwarm: Peer ${id} not ready, redistributing`);
        }
        i++;
      }
      const savedConfig = { ...this.core.config };
      const savedTrim = this.core.config.trim ? { ...this.core.config.trim } : void 0;
      this.core.config.trim = { start: i * chunkDuration, end: totalDurationMs };
      log.info(`AegisSwarm: Local node rendering ${this.core.config.trim.start.toFixed(0)}-${this.core.config.trim.end.toFixed(0)}ms`);
      const [localResult] = await Promise.all([
        this.core.save(`local_${filename}`),
        this._waitForAllPeers()
      ]);
      this.core.config.trim = savedTrim;
      return this._assembleChunks(chunkDuration, totalNodes);
    }
    _waitForAllPeers() {
      if (this._pendingPeers.size === 0)
        return Promise.resolve();
      return new Promise((resolve, reject) => {
        this._resolveAll = resolve;
        setTimeout(() => {
          if (this._pendingPeers.size > 0) {
            log.warn(`AegisSwarm: Timeout \u2014 ${this._pendingPeers.size} peers did not respond. Proceeding with available data.`);
            this._pendingPeers.clear();
            resolve();
          }
        }, this._timeoutMs);
      });
    }
    _handleSwarmPayload(peerId, event) {
      if (event.data instanceof ArrayBuffer) {
        const data = event.data;
        log.info(`AegisSwarm: Received ${data.byteLength} bytes from [${peerId}]`);
        const chunkIdx = this._chunks.size;
        const totalDur = this.core.timeline.duration || 1e3;
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
      } else if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "progress") {
            log.info(`AegisSwarm: [${peerId}] progress: ${msg.percent}%`);
          } else if (msg.type === "error") {
            log.warn(`AegisSwarm: [${peerId}] error: ${msg.message}`);
            this._pendingPeers.delete(peerId);
            if (this._pendingPeers.size === 0 && this._resolveAll) {
              this._resolveAll();
              this._resolveAll = null;
            }
          } else if (msg.type === "ice-candidate" && msg.candidate) {
            const peer = this.peers.get(peerId);
            if (peer) {
              peer.conn.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch((e) => log.warn(`AegisSwarm: ICE candidate error for [${peerId}]:`, e));
            }
          }
        } catch (_) {
          log.warn(`AegisSwarm: Failed to parse message from [${peerId}]`);
        }
      }
    }
    _handlePeerDisconnect(peerId) {
      this._pendingPeers.delete(peerId);
      this.peers.delete(peerId);
      if (this._pendingPeers.size === 0 && this._resolveAll) {
        this._resolveAll();
        this._resolveAll = null;
      }
    }
    _assembleChunks(chunkDuration, totalNodes) {
      const entries = Array.from(this._chunks.values()).sort((a, b) => a.startMs - b.startMs);
      if (entries.length === 0) {
        log.warn("AegisSwarm: No remote chunks received");
        return new ArrayBuffer(0);
      }
      if (entries.length < this.peers.size) {
        log.warn(`AegisSwarm: Incomplete \u2014 received ${entries.length}/${this.peers.size} chunks`);
      }
      log.warn("AegisSwarm: Multi-peer assembly not yet implemented \u2014 returning first peer chunk only. Each peer must produce fMP4 fragments for correct assembly.");
      return entries[0].data;
    }
    get connectedPeers() {
      return this.peers.size;
    }
    disconnect() {
      for (const [id, peer] of this.peers) {
        try {
          peer.channel.close();
        } catch (_) {
        }
        try {
          peer.conn.close();
        } catch (_) {
        }
      }
      this.peers.clear();
      this._pendingPeers.clear();
      this._chunks.clear();
    }
  };

  // src/effects/bloom.ts
  var BloomEngine = class {
    _threshold;
    _down;
    _up;
    _composite;
    _chains;
    w;
    h;
    constructor(width, height) {
      this.w = width;
      this.h = height;
      this._threshold = new GL(width, height, { hdr: true });
      this._threshold.loadFragmentShader(Shaders.BloomThreshold);
      this._down = new GL(width, height, { hdr: true });
      this._down.loadFragmentShader(Shaders.KawaseDown);
      this._up = new GL(width, height, { hdr: true });
      this._up.loadFragmentShader(Shaders.KawaseUp);
      this._composite = new GL(width, height, { hdr: true });
      this._composite.loadFragmentShader(Shaders.BloomComposite);
      this._chains = Array.from(
        { length: 5 },
        () => new FBOChain(this._down.gl, width, height, true)
      );
    }
    async apply(source, opts = {}) {
      const { threshold = 0.8, intensity = 1, passes = 4 } = opts;
      const n = Math.min(Math.max(1, Math.floor(passes)), 5);
      const tw = 1 / this.w, th = 1 / this.h;
      this._threshold.bindTexture("u_image", source, 0).setUniform1f("u_threshold", threshold).render(this._chains[0].writeFBO);
      this._chains[0].swap();
      for (let i = 0; i < n; i++) {
        const src = this._chains[i];
        const dst = this._chains[Math.min(i + 1, n - 1)];
        const gl = this._down.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src.readTex);
        this._down.setUniform1i("u_image", 0);
        this._down.setUniform1f("u_iteration", i).setUniform2f("u_texelSize", tw * (i + 1), th * (i + 1)).render(dst.writeFBO);
        dst.swap();
      }
      for (let i = n - 1; i >= 0; i--) {
        const src = this._chains[Math.min(i + 1, n - 1)];
        const dst = this._chains[i];
        const gl2 = this._up.gl;
        gl2.activeTexture(gl2.TEXTURE0);
        gl2.bindTexture(gl2.TEXTURE_2D, src.readTex);
        this._up.setUniform1i("u_image", 0);
        this._up.setUniform1f("u_iteration", i).setUniform2f("u_texelSize", tw, th).render(dst.writeFBO);
        dst.swap();
      }
      const gl3 = this._composite.gl;
      this._composite.bindTexture("u_image", source, 0);
      gl3.activeTexture(gl3.TEXTURE1);
      gl3.bindTexture(gl3.TEXTURE_2D, this._chains[0].readTex);
      this._composite.setUniform1i("u_bloom", 1);
      this._composite.setUniform1f("u_intensity", intensity).render();
      return this._composite.extract();
    }
    dispose() {
      this._chains.forEach((c) => c.dispose());
      for (const g of [this._threshold, this._down, this._up, this._composite]) {
        try {
          const ext = g.gl.getExtension("WEBGL_lose_context");
          if (ext)
            ext.loseContext();
        } catch (_) {
        }
      }
    }
  };
  function bloomPlugin(opts = {}) {
    let engine = null;
    const applyBloom = async (frame) => {
      if (!engine)
        throw new Error("[BloomPlugin] Not initialized \u2014 call init() first");
      return engine.apply(frame, opts);
    };
    return {
      init(core) {
        engine = new BloomEngine(core.config.width, core.config.height);
      },
      applyBloom,
      dispose() {
        if (engine) {
          engine.dispose();
          engine = null;
        }
      }
    };
  }

  // src/effects/blur.ts
  var GaussianBlurEngine = class {
    _hPass;
    _vPass;
    _fbo;
    w;
    h;
    constructor(width, height) {
      this.w = width;
      this.h = height;
      this._hPass = new GL(width, height);
      this._hPass.loadFragmentShader(Shaders.GaussianBlur);
      this._vPass = new GL(width, height);
      this._vPass.loadFragmentShader(Shaders.GaussianBlur);
      this._fbo = new FBOChain(this._hPass.gl, width, height);
    }
    async apply(source, opts = {}) {
      const { radius = 8, passes = 1 } = opts;
      const tw = 1 / this.w, th = 1 / this.h;
      this._hPass.bindTexture("u_image", source, 0);
      this._hPass.setUniform2f("u_texelSize", tw, th).setUniform2f("u_dir", 1, 0).setUniform1f("u_radius", radius).render(this._fbo.writeFBO);
      this._fbo.swap();
      for (let p = 0; p < passes; p++) {
        const gl = this._vPass.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._fbo.readTex);
        this._vPass.setUniform1i("u_image", 0);
        this._vPass.setUniform2f("u_texelSize", tw, th).setUniform2f("u_dir", 0, 1).setUniform1f("u_radius", radius).render(this._fbo.writeFBO);
        this._fbo.swap();
        if (p < passes - 1) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this._fbo.readTex);
          this._hPass.setUniform1i("u_image", 0);
          this._hPass.setUniform2f("u_texelSize", tw, th).setUniform2f("u_dir", 1, 0).setUniform1f("u_radius", radius).render(this._fbo.writeFBO);
          this._fbo.swap();
        }
      }
      return this._vPass.extract();
    }
    dispose() {
      this._fbo.dispose();
      for (const g of [this._hPass, this._vPass]) {
        try {
          const ext = g.gl.getExtension("WEBGL_lose_context");
          if (ext)
            ext.loseContext();
        } catch (_) {
        }
      }
    }
  };

  // src/effects/color.ts
  var ColorGradeEngine = class {
    _gl;
    constructor(width, height) {
      this._gl = new GL(width, height, { hdr: true });
      this._gl.loadFragmentShader(Shaders.ColorGrade);
    }
    async apply(source, opts = {}) {
      const lift = opts.lift ?? [0, 0, 0];
      const gamma = opts.gamma ?? [1, 1, 1];
      const gain = opts.gain ?? [1, 1, 1];
      this._gl.bindTexture("u_image", source, 0).setUniform3f("u_lift", lift[0], lift[1], lift[2]).setUniform3f("u_gamma", gamma[0] - 1, gamma[1] - 1, gamma[2] - 1).setUniform3f("u_gain", gain[0] - 1, gain[1] - 1, gain[2] - 1).setUniform1f("u_saturation", opts.saturation ?? 1).setUniform1f("u_hue", opts.hue ?? 0).render();
      return this._gl.extract();
    }
    dispose() {
      try {
        const ext = this._gl.gl.getExtension("WEBGL_lose_context");
        if (ext)
          ext.loseContext();
      } catch (_) {
      }
    }
  };
  var ACESToneMappingEngine = class {
    _gl;
    constructor(width, height) {
      this._gl = new GL(width, height, { hdr: true });
      this._gl.loadFragmentShader(Shaders.ACESToneMap);
    }
    async apply(source, opts = {}) {
      this._gl.bindTexture("u_image", source, 0).setUniform1f("u_exposure", opts.exposure ?? 1).render();
      return this._gl.extract();
    }
    dispose() {
      try {
        const ext = this._gl.gl.getExtension("WEBGL_lose_context");
        if (ext)
          ext.loseContext();
      } catch (_) {
      }
    }
  };
  var LUT3DEngine = class {
    _gl;
    constructor(width, height) {
      this._gl = new GL(width, height);
      this._gl.loadFragmentShader(Shaders.LUT3D);
    }
    async apply(source, lut, intensity = 1) {
      this._gl.bindTexture("u_image", source, 0).bindTexture("u_lut", lut, 1).setUniform1f("u_intensity", intensity).render();
      return this._gl.extract();
    }
    dispose() {
      try {
        const ext = this._gl.gl.getExtension("WEBGL_lose_context");
        if (ext)
          ext.loseContext();
      } catch (_) {
      }
    }
  };

  // src/effects/distort.ts
  var DistortEngine = class {
    _gl;
    constructor(width, height) {
      this._gl = new GL(width, height);
      this._gl.loadFragmentShader(Shaders.Displacement);
    }
    async apply(source, opts = {}) {
      const gl = this._gl;
      gl.bindTexture("u_image", source, 0);
      if (opts.dispMap) {
        gl.bindTexture("u_dispMap", opts.dispMap, 1);
      }
      gl.setUniform1f("u_strength", opts.strength ?? 0.02);
      gl.setUniform1f("u_time", (opts.time ?? 0) / 1e3);
      gl.render();
      return gl.extract();
    }
    dispose() {
      try {
        const ext = this._gl.gl.getExtension("WEBGL_lose_context");
        if (ext)
          ext.loseContext();
      } catch (_) {
      }
    }
  };
  var CRTEngine = class {
    _gl;
    constructor(width, height) {
      this._gl = new GL(width, height);
      this._gl.loadFragmentShader(Shaders.CRT);
    }
    async apply(source, opts = {}) {
      this._gl.bindTexture("u_image", source, 0).setUniform1f("u_scanlineStrength", opts.scanlineStrength ?? 0.3).setUniform1f("u_barrel", opts.barrel ?? 0.1).setUniform1f("u_time", (opts.time ?? 0) / 1e3).render();
      return this._gl.extract();
    }
    dispose() {
      try {
        const ext = this._gl.gl.getExtension("WEBGL_lose_context");
        if (ext)
          ext.loseContext();
      } catch (_) {
      }
    }
  };

  // src/effects/blend.ts
  var BLEND_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_base;
uniform sampler2D u_blend;
uniform int u_mode;
uniform float u_opacity;

vec3 multiply(vec3 a, vec3 b) { return a * b; }
vec3 screen(vec3 a, vec3 b) { return 1.0 - (1.0 - a) * (1.0 - b); }
vec3 overlay(vec3 a, vec3 b) {
    return mix(
        2.0 * a * b,
        1.0 - 2.0 * (1.0 - a) * (1.0 - b),
        step(0.5, a)
    );
}
vec3 hardlight(vec3 a, vec3 b) { return overlay(b, a); }
vec3 softlight(vec3 a, vec3 b) {
    return mix(
        2.0*a*b + a*a*(1.0-2.0*b),
        sqrt(a)*(2.0*b-1.0) + 2.0*a*(1.0-b),
        step(0.5, b)
    );
}
vec3 colordodge(vec3 a, vec3 b) { return a / max(1.0 - b, 0.001); }
vec3 colorburn(vec3 a, vec3 b) { return 1.0 - (1.0 - a) / max(b, 0.001); }

void main(){
    vec4 base = texture(u_base, v_uv);
    vec4 blend = texture(u_blend, v_uv);
    vec3 a = base.rgb, b = blend.rgb;
    vec3 result;

    if      (u_mode == 0)  result = b * a;                         // multiply
    else if (u_mode == 1)  result = screen(a, b);                  // screen
    else if (u_mode == 2)  result = overlay(a, b);                 // overlay
    else if (u_mode == 3)  result = min(a, b);                     // darken
    else if (u_mode == 4)  result = max(a, b);                     // lighten
    else if (u_mode == 5)  result = clamp(colordodge(a, b),0.0,1.0); // color-dodge
    else if (u_mode == 6)  result = clamp(colorburn(a, b),0.0,1.0);  // color-burn
    else if (u_mode == 7)  result = hardlight(a, b);               // hard-light
    else if (u_mode == 8)  result = softlight(a, b);               // soft-light
    else if (u_mode == 9)  result = abs(a - b);                    // difference
    else if (u_mode == 10) result = a + b - 2.0*a*b;               // exclusion
    else if (u_mode == 11) result = clamp(a + b, 0.0, 1.0);       // add
    else                   result = b;                              // normal

    o = vec4(mix(a, result, u_opacity * blend.a), base.a);
}`;
  var MODE_MAP = {
    "multiply": 0,
    "screen": 1,
    "overlay": 2,
    "darken": 3,
    "lighten": 4,
    "color-dodge": 5,
    "color-burn": 6,
    "hard-light": 7,
    "soft-light": 8,
    "difference": 9,
    "exclusion": 10,
    "add": 11
  };
  var BlendEngine = class {
    _gl;
    constructor(width, height) {
      this._gl = new GL(width, height);
      this._gl.loadFragmentShader(BLEND_FRAG);
    }
    async apply(base, blend, opts = {}) {
      const mode = opts.mode || "screen";
      const opacity = opts.opacity ?? 1;
      const modeInt = MODE_MAP[mode] ?? 1;
      this._gl.bindTexture("u_base", base, 0).bindTexture("u_blend", blend, 1).setUniform1i("u_mode", modeInt).setUniform1f("u_opacity", opacity).render();
      return this._gl.extract();
    }
    dispose() {
      try {
        const ext = this._gl.gl.getExtension("WEBGL_lose_context");
        if (ext)
          ext.loseContext();
      } catch (_) {
      }
    }
  };

  // src/effects/fractal.ts
  var MANDELBROT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform float u_time;
uniform float u_zoom;
uniform vec2 u_center;
uniform float u_maxIter;
void main(){
    vec2 c = (v_uv - 0.5) * 4.0 / u_zoom + u_center;
    vec2 z = c;
    float iter = 0.0;
    for(float i=0.0; i<500.0; i++){
        if(i >= u_maxIter) break;
        if(dot(z,z) > 4.0) break;
        z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
        iter++;
    }
    if(iter >= u_maxIter){
        o = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
        float si = iter + 1.0 - log(log(length(z))) / log(2.0);
        float hue = si / u_maxIter;
        vec3 col = 0.5 + 0.5*cos(3.0 + hue*6.2831 + vec3(0.0,0.6,1.0));
        o = vec4(col, 1.0);
    }
}`;
  var JULIA_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform float u_time;
uniform float u_zoom;
uniform vec2 u_center;
uniform vec2 u_juliaC;
uniform float u_maxIter;
void main(){
    vec2 z = (v_uv - 0.5) * 4.0 / u_zoom + u_center;
    vec2 c = u_juliaC;
    float iter = 0.0;
    for(float i=0.0; i<500.0; i++){
        if(i >= u_maxIter) break;
        if(dot(z,z) > 4.0) break;
        z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
        iter++;
    }
    if(iter >= u_maxIter){
        o = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
        float si = iter + 1.0 - log(log(length(z))) / log(2.0);
        float hue = si / u_maxIter;
        vec3 col = 0.5 + 0.5*cos(3.0 + hue*6.2831 + vec3(0.0,0.6,1.0));
        o = vec4(col, 1.0);
    }
}`;
  var FractalEngine = class {
    _mandelbrotGL;
    _juliaGL;
    cfg;
    constructor(width, height, opts = {}) {
      this.cfg = {
        type: opts.type || "mandelbrot",
        centerX: opts.centerX ?? -0.743643887037151,
        centerY: opts.centerY ?? 0.13182590420533,
        zoomSpeed: opts.zoomSpeed ?? 0.5,
        maxIter: opts.maxIter ?? 200,
        juliaC: opts.juliaC || [-0.7, 0.27015]
      };
      this._mandelbrotGL = new GL(width, height);
      this._mandelbrotGL.loadFragmentShader(MANDELBROT_FRAG);
      this._juliaGL = new GL(width, height);
      this._juliaGL.loadFragmentShader(JULIA_FRAG);
    }
    async apply(timeMs) {
      const zoom = 1 + timeMs / 1e3 * this.cfg.zoomSpeed;
      if (this.cfg.type === "julia") {
        this._juliaGL.setUniform1f("u_time", timeMs / 1e3).setUniform1f("u_zoom", zoom).setUniform2f("u_center", this.cfg.centerX, this.cfg.centerY).setUniform2f("u_juliaC", this.cfg.juliaC[0], this.cfg.juliaC[1]).setUniform1f("u_maxIter", this.cfg.maxIter).render();
        return this._juliaGL.extract();
      }
      this._mandelbrotGL.setUniform1f("u_time", timeMs / 1e3).setUniform1f("u_zoom", zoom).setUniform2f("u_center", this.cfg.centerX, this.cfg.centerY).setUniform1f("u_maxIter", this.cfg.maxIter).render();
      return this._mandelbrotGL.extract();
    }
    async overlay(source, timeMs, blend = 0.3) {
      const fractal = await this.apply(timeMs);
      const c = new OffscreenCanvas(source.width, source.height);
      const ctx = c.getContext("2d");
      ctx.drawImage(source, 0, 0);
      ctx.globalAlpha = blend;
      ctx.globalCompositeOperation = "screen";
      ctx.drawImage(fractal, 0, 0, source.width, source.height);
      fractal.close();
      return createImageBitmap(c);
    }
    dispose() {
      for (const g of [this._mandelbrotGL, this._juliaGL]) {
        try {
          const ext = g.gl.getExtension("WEBGL_lose_context");
          if (ext)
            ext.loseContext();
        } catch (_) {
        }
      }
    }
  };

  // src/effects/glitch.ts
  init_core();
  var GLITCH_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform float u_amount;
uniform float u_active;
uniform float u_seed;

float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233)) + u_seed) * 43758.5453);
}

void main() {
    vec2 uv = v_uv;
    if (u_active > 0.5) {
        float shift = u_amount / 100.0;
        float scanLine = rand(vec2(0.0, floor(uv.y * 50.0))) * shift;
        float r = texture(u_image, vec2(uv.x - shift + scanLine, uv.y)).r;
        float g = texture(u_image, uv).g;
        float b = texture(u_image, vec2(uv.x + shift - scanLine, uv.y)).b;
        float a = texture(u_image, uv).a;
        o = vec4(r, g, b, a);
    } else {
        o = texture(u_image, uv);
    }
}`;
  function rgbGlitch(opts = {}) {
    const amt = opts.amount ?? 5;
    const interval = opts.intervalMs ?? 500;
    const seed = opts.seed ?? Math.random() * 100;
    let glitchGL = null;
    let glitchActive = 0;
    let glitchSeed = 0;
    return {
      init(core) {
        glitchGL = new GL(core.config.width, core.config.height);
        glitchGL.loadFragmentShader(GLITCH_FRAG);
      },
      onBeforeFrame(_core, _clips, timeMs) {
        const shouldGlitch = Math.floor(timeMs / interval) % 2 === 0;
        glitchActive = shouldGlitch ? 1 : 0;
        glitchSeed = seed + timeMs * 0.01;
      },
      onAfterFrame: async (_core, _fIdx) => {
        if (!glitchGL || glitchActive < 0.5)
          return;
        const compositor = _core._compositor;
        if (!compositor)
          return;
        try {
          const bitmap = await createImageBitmap(compositor.canvas);
          glitchGL.bindTexture("u_image", bitmap, 0).setUniform1f("u_amount", amt).setUniform1f("u_active", glitchActive).setUniform1f("u_seed", glitchSeed).render();
          const result = await glitchGL.extract();
          const gl = compositor.gl;
          gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, result);
          bitmap.close();
          result.close();
        } catch (e) {
          log.warn("[Glitch] Post-process failed", e);
        }
      },
      dispose() {
        if (glitchGL) {
          try {
            const ext = glitchGL.gl.getExtension("WEBGL_lose_context");
            if (ext)
              ext.loseContext();
          } catch (_) {
          }
          glitchGL = null;
        }
      }
    };
  }

  // src/effects/luma.ts
  var LUMA_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform float u_threshold;
uniform float u_smoothness;
void main(){
    vec4 color = texture(u_image, v_uv);
    float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    float alpha = smoothstep(u_threshold, u_threshold + u_smoothness, luma);
    o = vec4(color.rgb, color.a * alpha);
}`;
  var LumaKeyEngine = class {
    _gl;
    constructor(width, height) {
      this._gl = new GL(width, height);
      this._gl.loadFragmentShader(LUMA_FRAG);
    }
    async apply(source, opts = {}) {
      const threshold = opts.threshold ?? 0.1;
      const smoothness = opts.smoothness ?? 0.05;
      this._gl.bindTexture("u_image", source, 0).setUniform1f("u_threshold", threshold).setUniform1f("u_smoothness", smoothness).render();
      return this._gl.extract();
    }
    dispose() {
      try {
        const ext = this._gl.gl.getExtension("WEBGL_lose_context");
        if (ext)
          ext.loseContext();
      } catch (_) {
      }
    }
  };

  // src/effects/tracker.ts
  var DIFF_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_current;
uniform sampler2D u_previous;
uniform float u_threshold;
uniform vec3 u_highlight;
uniform vec2 u_texelSize;

void main(){
    vec3 curr = texture(u_current, v_uv).rgb;
    vec3 prev = texture(u_previous, v_uv).rgb;
    float diff = length(curr - prev);

    float motion = 0.0;
    int r = 2;
    for(int dy=-r; dy<=r; dy++){
        for(int dx=-r; dx<=r; dx++){
            vec2 off = vec2(float(dx), float(dy)) * u_texelSize;
            vec3 c = texture(u_current, v_uv + off).rgb;
            vec3 p = texture(u_previous, v_uv + off).rgb;
            motion += length(c - p);
        }
    }
    motion /= float((2*r+1)*(2*r+1));

    float mask = smoothstep(u_threshold * 0.5, u_threshold, motion);
    vec3 highlight = curr + u_highlight * mask * 0.6;
    o = vec4(clamp(highlight, 0.0, 1.0), 1.0);
}`;
  var MotionTrackerEngine = class {
    _gl;
    _hasPrev = false;
    w;
    h;
    constructor(width, height) {
      this.w = width;
      this.h = height;
      this._gl = new GL(width, height);
      this._gl.loadFragmentShader(DIFF_FRAG);
    }
    async apply(source, opts = {}) {
      const threshold = opts.threshold ?? 0.08;
      const highlight = opts.highlightColor ?? [1, 0.2, 0.2];
      if (!this._hasPrev) {
        this._gl.bindTexture("u_current", source, 0);
        this._gl.bindTexture("u_previous", source, 1);
        this._hasPrev = true;
      } else {
        this._gl.bindTexture("u_current", source, 0);
      }
      this._gl.setUniform1f("u_threshold", threshold).setUniform3f("u_highlight", highlight[0], highlight[1], highlight[2]).setUniform2f("u_texelSize", 1 / this.w, 1 / this.h).render();
      this._gl.bindTexture("u_previous", source, 1);
      return this._gl.extract();
    }
    reset() {
      this._hasPrev = false;
    }
    dispose() {
      try {
        const ext = this._gl.gl.getExtension("WEBGL_lose_context");
        if (ext)
          ext.loseContext();
      } catch (_) {
      }
    }
  };

  // src/effects/ascii.ts
  var AsciiEngine = class {
    w;
    h;
    cfg;
    constructor(width, height, opts = {}) {
      this.w = width;
      this.h = height;
      this.cfg = {
        fontSize: opts.fontSize || 8,
        color: opts.color || [1, 1, 1],
        charset: opts.charset || " .:-=+*#%@",
        invert: opts.invert ?? false
      };
    }
    async apply(source) {
      const { fontSize, color, charset, invert } = this.cfg;
      const W = this.w, H = this.h;
      const scratch = new OffscreenCanvas(W, H);
      const sCtx = scratch.getContext("2d", { willReadFrequently: true });
      sCtx.drawImage(source, 0, 0, W, H);
      const imgData = sCtx.getImageData(0, 0, W, H);
      const data = imgData.data;
      const out = new OffscreenCanvas(W, H);
      const ctx = out.getContext("2d");
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, W, H);
      const r = Math.round(color[0] * 255);
      const g = Math.round(color[1] * 255);
      const b = Math.round(color[2] * 255);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.font = `${fontSize}px monospace`;
      ctx.textBaseline = "top";
      const cols = Math.floor(W / fontSize);
      const rows = Math.floor(H / fontSize);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const px = col * fontSize + (fontSize >> 1);
          const py = row * fontSize + (fontSize >> 1);
          const idx = (Math.min(py, H - 1) * W + Math.min(px, W - 1)) * 4;
          const brightness = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) / 255;
          const val = invert ? 1 - brightness : brightness;
          const charIdx = Math.min(Math.floor(val * charset.length), charset.length - 1);
          ctx.fillText(charset[charIdx], col * fontSize, row * fontSize);
        }
      }
      return createImageBitmap(out);
    }
  };

  // src/effects/boomerang.ts
  init_core();
  function boomerang(opts = {}) {
    return (core) => {
      const loops = opts.loopCount || 1;
      const targets = opts.targetClipIds || [];
      core.timeline.clips.forEach((clip) => {
        if (clip.type !== "video")
          return;
        if (targets.length > 0 && !targets.includes(clip.id))
          return;
        const originalDuration = clip.end - clip.start;
        const cycleDurationSec = originalDuration / 1e3;
        const totalDuration = originalDuration * loops * 2;
        clip.end = clip.start + totalDuration;
        const keys = [];
        for (let i = 0; i < loops; i++) {
          const cycleStartSec = i * cycleDurationSec * 2;
          keys.push({
            t: cycleStartSec,
            v: 0,
            cp: [0.33, 0.33, 0.66, 0.66]
          });
          keys.push({
            t: cycleStartSec + cycleDurationSec,
            v: cycleDurationSec,
            cp: [0.33, 0.66, 0.66, 0.33]
          });
          if (i === loops - 1) {
            keys.push({
              t: cycleStartSec + cycleDurationSec * 2,
              v: 0
            });
          }
        }
        clip.timeRemap = new BezierKeyframeEngine(keys);
      });
    };
  }
  var BoomerangEngine = class {
    static computeTime(currentMs, clipStartMs, originalDurationMs, loopCount = 1) {
      const elapsed = currentMs - clipStartMs;
      const cycleDuration = originalDurationMs;
      const fullCycle = cycleDuration * 2;
      const phase = elapsed % fullCycle;
      if (phase < cycleDuration) {
        return phase;
      }
      return fullCycle - phase;
    }
  };

  // src/effects/dom.ts
  init_core();
  var DOMRenderer = class {
    w;
    h;
    constructor(width, height) {
      this.w = width;
      this.h = height;
    }
    async render(opts) {
      const { html, width, height, css } = opts;
      const safeCss = css ? css.replace(/<\/?style[^>]*>/gi, "").replace(/<\/foreignObject/gi, "") : "";
      const styleBlock = safeCss ? `<style>${safeCss}</style>` : "";
      const safeHtml = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/on\w+\s*=\s*["'][^"']*["']/gi, "").replace(/<\/foreignObject/gi, "");
      const svgString = `
            <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
                <foreignObject width="100%" height="100%">
                    <div xmlns="http://www.w3.org/1999/xhtml"
                         style="width:${width}px;height:${height}px;overflow:hidden;">
                        ${styleBlock}
                        ${safeHtml}
                    </div>
                </foreignObject>
            </svg>
        `.trim();
      const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      try {
        const response = await fetch(url);
        const svgBlob = await response.blob();
        const bitmap = await createImageBitmap(svgBlob, {
          resizeWidth: this.w,
          resizeHeight: this.h
        });
        return bitmap;
      } catch (e) {
        log.warn("[DOMRenderer] SVG foreignObject render failed, using fallback", e);
        return this._fallback(html, width, height);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    async _fallback(html, width, height) {
      const canvas = new OffscreenCanvas(this.w, this.h);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.fillStyle = "white";
      ctx.font = "16px sans-serif";
      ctx.textBaseline = "top";
      const text = html.replace(/<[^>]*>/g, "").trim();
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i].trim(), 10, 10 + i * 20);
      }
      return createImageBitmap(canvas);
    }
    async overlay(source, domOpts, x = 0, y = 0, opacity = 1) {
      const domBitmap = await this.render(domOpts);
      const canvas = new OffscreenCanvas(source.width, source.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(source, 0, 0);
      ctx.globalAlpha = opacity;
      ctx.drawImage(domBitmap, x, y, domOpts.width, domOpts.height);
      domBitmap.close();
      return createImageBitmap(canvas);
    }
  };

  // src/generators/particle.ts
  init_core();
  var UPDATE_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_vel;
layout(location=2) in float a_age;
layout(location=3) in float a_life;

out vec2 v_pos;
out vec2 v_vel;
out float v_age;
out float v_life;

uniform float u_dt;
uniform vec2  u_gravity;
uniform float u_turbulence;

float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
vec2 noise2(vec2 p){
    return vec2(hash(p),hash(p+vec2(3.1,1.7)))*2.0-1.0;
}

void main(){
    float age = a_age + u_dt;
    
    if(age >= a_life){
        v_pos  = a_pos; 
        v_vel  = a_vel;
        v_age  = age;
        v_life = a_life;
    } else {
        vec2 turb = noise2(a_pos * 50.0 + age) * u_turbulence;
        v_vel = a_vel + u_gravity * u_dt + turb;
        v_pos = a_pos + v_vel;
        v_age = age;
        v_life = a_life;
    }
}`;
  var DRAW_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
layout(location=2) in float a_age;
layout(location=3) in float a_life;
uniform float u_size;
uniform vec2  u_resolution;
void main(){
    float alive = step(0.0, a_life - a_age);
    float t = clamp(a_age / a_life, 0.0, 1.0);
    gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = u_size * (1.0 - t) * alive;
}`;
  var DRAW_FRAG = `#version 300 es
precision mediump float;
uniform vec3 u_color;
uniform sampler2D u_bg;
in vec2 v_uv;
out vec4 o;
void main(){
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d,d);
    if(r > 0.25) discard;
    float alpha = 1.0 - smoothstep(0.1, 0.25, r);
    o = vec4(u_color, alpha);
}`;
  var ParticleSystem = class {
    gl;
    canvas;
    updateProg;
    drawProg;
    tf;
    vaos;
    vbos;
    readIdx = 0;
    count;
    cfg;
    constructor(width, height, cfg = {}) {
      this.cfg = {
        count: 1e4,
        origin: [0.5, 0],
        gravity: [0, -5e-4],
        speed: 5e-3,
        lifetime: 3,
        size: 4,
        color: [1, 1, 0.5],
        turbulence: 2e-4,
        ...cfg
      };
      this.count = this.cfg.count;
      this.canvas = new OffscreenCanvas(width, height);
      const ctx = this.canvas.getContext("webgl2", {
        alpha: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: true
      });
      if (!ctx)
        throw new AegisError("WebGL2 required for ParticleSystem");
      this.gl = ctx;
      this.updateProg = this._prog(UPDATE_VERT, null, ["v_pos", "v_vel", "v_age", "v_life"]);
      this.drawProg = this._prog(DRAW_VERT, DRAW_FRAG);
      const stride = 6;
      const data = new Float32Array(this.count * stride);
      const [ox, oy] = this.cfg.origin;
      for (let i = 0; i < this.count; i++) {
        const b = i * stride;
        data[b + 0] = ox + (Math.random() - 0.5) * 0.05;
        data[b + 1] = oy + (Math.random() - 0.5) * 0.05;
        const angle = Math.random() * Math.PI * 2;
        const spd = this.cfg.speed * (0.5 + Math.random());
        data[b + 2] = Math.cos(angle) * spd;
        data[b + 3] = Math.sin(angle) * spd;
        data[b + 4] = Math.random() * this.cfg.lifetime;
        data[b + 5] = this.cfg.lifetime * (0.5 + Math.random() * 0.5);
      }
      this.vaos = [this.gl.createVertexArray(), this.gl.createVertexArray()];
      this.vbos = [this.gl.createBuffer(), this.gl.createBuffer()];
      this.tf = [this.gl.createTransformFeedback(), this.gl.createTransformFeedback()];
      for (let i = 0; i < 2; i++) {
        this.gl.bindVertexArray(this.vaos[i]);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbos[i]);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.DYNAMIC_COPY);
        const fsize = Float32Array.BYTES_PER_ELEMENT;
        this.gl.vertexAttribPointer(0, 2, this.gl.FLOAT, false, stride * fsize, 0);
        this.gl.enableVertexAttribArray(0);
        this.gl.vertexAttribPointer(1, 2, this.gl.FLOAT, false, stride * fsize, 2 * fsize);
        this.gl.enableVertexAttribArray(1);
        this.gl.vertexAttribPointer(2, 1, this.gl.FLOAT, false, stride * fsize, 4 * fsize);
        this.gl.enableVertexAttribArray(2);
        this.gl.vertexAttribPointer(3, 1, this.gl.FLOAT, false, stride * fsize, 5 * fsize);
        this.gl.enableVertexAttribArray(3);
        this.gl.bindVertexArray(null);
        this.gl.bindTransformFeedback(this.gl.TRANSFORM_FEEDBACK, this.tf[i]);
        this.gl.bindBufferBase(this.gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.vbos[i]);
        this.gl.bindTransformFeedback(this.gl.TRANSFORM_FEEDBACK, null);
      }
    }
    async tick(dt) {
      const gl = this.gl;
      const read = this.readIdx;
      const write = 1 - read;
      gl.useProgram(this.updateProg);
      gl.uniform1f(gl.getUniformLocation(this.updateProg, "u_dt"), dt);
      gl.uniform2f(gl.getUniformLocation(this.updateProg, "u_gravity"), this.cfg.gravity[0], this.cfg.gravity[1]);
      gl.uniform1f(gl.getUniformLocation(this.updateProg, "u_turbulence"), this.cfg.turbulence);
      gl.bindVertexArray(this.vaos[read]);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf[write]);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, this.count);
      gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(this.drawProg);
      gl.uniform1f(gl.getUniformLocation(this.drawProg, "u_size"), this.cfg.size);
      gl.uniform3f(gl.getUniformLocation(this.drawProg, "u_color"), ...this.cfg.color);
      gl.bindVertexArray(this.vaos[write]);
      gl.drawArrays(gl.POINTS, 0, this.count);
      gl.disable(gl.BLEND);
      this.readIdx = write;
      return createImageBitmap(this.canvas);
    }
    _prog(vert, frag, tfVaryings) {
      const gl = this.gl;
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, vert);
      gl.compileShader(vs);
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS))
        throw new AegisError("Particle VS: " + gl.getShaderInfoLog(vs));
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      if (frag) {
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, frag);
        gl.compileShader(fs);
        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS))
          throw new AegisError("Particle FS: " + gl.getShaderInfoLog(fs));
        gl.attachShader(prog, fs);
      }
      if (tfVaryings) {
        gl.transformFeedbackVaryings(prog, tfVaryings, gl.INTERLEAVED_ATTRIBS);
      }
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
        throw new AegisError("Particle prog: " + gl.getProgramInfoLog(prog));
      return prog;
    }
    dispose() {
      const gl = this.gl;
      for (let i = 0; i < 2; i++) {
        gl.deleteBuffer(this.vbos[i]);
        gl.deleteVertexArray(this.vaos[i]);
        gl.deleteTransformFeedback(this.tf[i]);
      }
      gl.deleteProgram(this.updateProg);
      gl.deleteProgram(this.drawProg);
    }
  };

  // src/audio/worklet.ts
  var AUDIO_WORKLET_CODE = `
class AegisGainProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [{ name: 'gain', defaultValue: 1, minValue: 0, maxValue: 10, automationRate: 'a-rate' }];
    }
    constructor(opts) {
        super();
        this._sab = null;
        this._sabView = null;
        this._readPos = 0;
        this.port.onmessage = (e) => {
            if (e.data.type === 'sab') {
                this._sab = e.data.buffer;
                this._sabView = new Float32Array(this._sab);
            }
        };
    }
    process(inputs, outputs, parameters) {
        const gain = parameters.gain;
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !input[0]) return true;
        for (let ch = 0; ch < output.length; ch++) {
            const inCh = input[ch] || input[0];
            const outCh = output[ch];
            for (let i = 0; i < outCh.length; i++) {
                const g = gain.length > 1 ? gain[i] : gain[0];
                outCh[i] = inCh[i] * g;
            }
        }
        return true;
    }
}

class AegisDuckProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._rms = 0;
        this._attack = 0.003;
        this._release = 0.25;
        this._threshold = 0.1;
        this._ratio = 4;
        this._gain = 1;
        this.port.onmessage = (e) => {
            if (e.data.attack !== undefined) this._attack = e.data.attack;
            if (e.data.release !== undefined) this._release = e.data.release;
            if (e.data.threshold !== undefined) this._threshold = e.data.threshold;
            if (e.data.ratio !== undefined) this._ratio = e.data.ratio;
        };
    }
    static get parameterDescriptors() {
        return [{ name: 'sidechain', defaultValue: 0, automationRate: 'a-rate' }];
    }
    process(inputs, outputs) {
        const sidechain = inputs[1] || inputs[0];
        const main = inputs[0];
        const output = outputs[0];
        if (!main || !main[0]) return true;
        
        let sum = 0;
        const scCh = sidechain?.[0] || main[0];
        for (const s of scCh) sum += s * s;
        const rms = Math.sqrt(sum / scCh.length);
        const dt = 128 / sampleRate;
        const coeff = rms > this._rms ? Math.exp(-dt / this._attack) : Math.exp(-dt / this._release);
        this._rms = this._rms * coeff + rms * (1 - coeff);
        const targetGain = this._rms > this._threshold
            ? 1 - (this._rms - this._threshold) / this._ratio
            : 1;
        const gCoeff = targetGain < this._gain ? Math.exp(-dt / this._attack) : Math.exp(-dt / this._release);
        this._gain = this._gain * gCoeff + targetGain * (1 - gCoeff);
        for (let ch = 0; ch < output.length; ch++) {
            const inCh = main[ch] || main[0];
            const outCh = output[ch];
            for (let i = 0; i < outCh.length; i++) outCh[i] = inCh[i] * Math.max(0, this._gain);
        }
        return true;
    }
}

registerProcessor('aegis-gain', AegisGainProcessor);
registerProcessor('aegis-duck', AegisDuckProcessor);
`;
  var AegisAudioWorklet = class {
    ctx;
    _blobUrl = null;
    _loaded = false;
    constructor(ctx) {
      this.ctx = ctx;
    }
    async load() {
      if (this._loaded)
        return;
      const blob = new Blob([AUDIO_WORKLET_CODE], { type: "application/javascript" });
      this._blobUrl = URL.createObjectURL(blob);
      await this.ctx.audioWorklet.addModule(this._blobUrl);
      this._loaded = true;
    }
    createGainNode() {
      const node = new AudioWorkletNode(this.ctx, "aegis-gain");
      const sab = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 128);
      const view = new Float32Array(sab);
      view.fill(1);
      node.port.postMessage({ type: "sab", buffer: sab });
      return node;
    }
    createDuckNode(opts = {}) {
      const node = new AudioWorkletNode(this.ctx, "aegis-duck", {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        channelCount: 2
      });
      node.port.postMessage({ ...opts });
      return node;
    }
    dispose() {
      if (this._blobUrl) {
        URL.revokeObjectURL(this._blobUrl);
        this._blobUrl = null;
      }
    }
  };
  function scheduleGainAutomation(param, keyframes, startTime = 0) {
    if (keyframes.length === 0)
      return;
    param.setValueAtTime(keyframes[0].v, startTime + keyframes[0].t);
    for (let i = 1; i < keyframes.length; i++) {
      param.linearRampToValueAtTime(keyframes[i].v, startTime + keyframes[i].t);
    }
  }

  // src/audio/binaural.ts
  function binauralBeats(opts = {}) {
    return async (core) => {
      const baseFreq = opts.baseFreq || 400;
      const beatFreq = opts.beatFreq || 10;
      const durationMs = opts.durationMs || 1e4;
      const startMs = opts.startMs || 0;
      const volume = opts.volume ?? 0.5;
      const sampleRate = core.config.audio?.sampleRate || 48e3;
      const offlineCtx = new OfflineAudioContext(2, sampleRate * (durationMs / 1e3), sampleRate);
      const oscL = offlineCtx.createOscillator();
      const pannerL = offlineCtx.createStereoPanner();
      oscL.frequency.value = baseFreq;
      pannerL.pan.value = -1;
      const oscR = offlineCtx.createOscillator();
      const pannerR = offlineCtx.createStereoPanner();
      oscR.frequency.value = baseFreq + beatFreq;
      pannerR.pan.value = 1;
      const masterGain = offlineCtx.createGain();
      masterGain.gain.value = volume;
      oscL.connect(pannerL);
      pannerL.connect(masterGain);
      oscR.connect(pannerR);
      pannerR.connect(masterGain);
      masterGain.connect(offlineCtx.destination);
      oscL.start();
      oscR.start();
      oscL.stop(durationMs / 1e3);
      oscR.stop(durationMs / 1e3);
      const renderedBuffer = await offlineCtx.startRendering();
      core.input(new Aud(renderedBuffer), { start: startMs, duration: durationMs, layer: -1 });
    };
  }

  // src/audio/chiptune.ts
  init_core();
  function chiptune(opts) {
    return (core) => {
      const bpm = opts.bpm || 120;
      const noteDurationMs = 60 / bpm * 1e3;
      const startMs = opts.startMs || 0;
      const noteFreqs = {
        "C4": 261.63,
        "C#4": 277.18,
        "D4": 293.66,
        "D#4": 311.13,
        "E4": 329.63,
        "F4": 349.23,
        "F#4": 369.99,
        "G4": 392,
        "G#4": 415.3,
        "A4": 440,
        "A#4": 466.16,
        "B4": 493.88,
        "C5": 523.25,
        "E5": 659.25,
        "G5": 783.99,
        "REST": 0
      };
      const notes = opts.notes.split(/\s+/).map((n) => n.toUpperCase());
      const totalDurationMs = notes.length * noteDurationMs;
      const sampleRate = core.config.audio?.sampleRate || 48e3;
      const offlineCtx = new OfflineAudioContext(2, sampleRate * (totalDurationMs / 1e3), sampleRate);
      notes.forEach((note, index) => {
        const freq = noteFreqs[note] || noteFreqs["REST"];
        if (freq > 0) {
          const osc = offlineCtx.createOscillator();
          const gain = offlineCtx.createGain();
          osc.type = opts.wave || "square";
          osc.frequency.setValueAtTime(freq, offlineCtx.currentTime);
          const startTime = index * (noteDurationMs / 1e3);
          const stopTime = startTime + noteDurationMs / 1e3;
          gain.gain.setValueAtTime(0, startTime);
          gain.gain.linearRampToValueAtTime(0.5, startTime + 0.05);
          gain.gain.setValueAtTime(0.5, stopTime - 0.05);
          gain.gain.linearRampToValueAtTime(0, stopTime);
          osc.connect(gain);
          gain.connect(offlineCtx.destination);
          osc.start(startTime);
          osc.stop(stopTime);
        }
      });
      offlineCtx.startRendering().then((renderedBuffer) => {
        const audSource = new Aud(renderedBuffer);
        core.input(audSource, { start: startMs, duration: totalDurationMs, layer: -1 });
      }).catch((err) => {
        log.error("Chiptune render failed", err);
      });
    };
  }

  // src/audio/roomtone.ts
  init_core();
  function roomTone(opts = {}) {
    return async (core) => {
      const startMs = opts.startMs || 0;
      const durationMs = opts.durationMs || (core.timeline.duration ? core.timeline.duration : 1e4);
      const volume = opts.volume ?? 0.1;
      const noiseType = opts.type || "white";
      const sampleRate = core.config.audio?.sampleRate || 48e3;
      const offlineCtx = new OfflineAudioContext(2, sampleRate * (durationMs / 1e3), sampleRate);
      const bufferSize = sampleRate * (durationMs / 1e3);
      const noiseBuffer = offlineCtx.createBuffer(2, bufferSize, sampleRate);
      const outputL = noiseBuffer.getChannelData(0);
      const outputR = noiseBuffer.getChannelData(1);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        let white = Math.random() * 2 - 1;
        if (noiseType === "pink") {
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.969 * b2 + white * 0.153852;
          b3 = 0.8665 * b3 + white * 0.3104856;
          b4 = 0.55 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.016898;
          let pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
          pink *= 0.11;
          b6 = white * 0.115926;
          white = pink;
        } else if (noiseType === "brown") {
          white = (b0 + 0.02 * white) / 1.02;
          b0 = white;
          white *= 3.5;
        }
        outputL[i] = white;
        outputR[i] = white;
      }
      const noiseSource = offlineCtx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      const gainNode = offlineCtx.createGain();
      gainNode.gain.value = volume;
      const filter = offlineCtx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1e3;
      noiseSource.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(offlineCtx.destination);
      noiseSource.start();
      try {
        const renderedBuffer = await offlineCtx.startRendering();
        const audSource = new Aud(renderedBuffer);
        core.input(audSource, { start: startMs, duration: durationMs, layer: -1 });
      } catch (err) {
        log.error("Room tone render failed", err);
      }
    };
  }

  // src/audio/spectrogram.ts
  function spectrogramStego(opts) {
    return async (core) => {
      const startMs = opts.startMs || 0;
      const durationMs = opts.durationMs || 5e3;
      const minFreq = opts.minFreq || 200;
      const maxFreq = opts.maxFreq || 15e3;
      const sampleRate = core.config.audio?.sampleRate || 48e3;
      const offlineCtx = new OfflineAudioContext(1, sampleRate * (durationMs / 1e3), sampleRate);
      const imgWrap = await Img.load(opts.imageSrc);
      if (!imgWrap.c) {
        imgWrap.close();
        return;
      }
      const width = 100;
      const height = 64;
      const scratchCanvas = new OffscreenCanvas(width, height);
      const scratchCtx = scratchCanvas.getContext("2d");
      scratchCtx.drawImage(imgWrap.c, 0, 0, width, height);
      const imgData = scratchCtx.getImageData(0, 0, width, height);
      const data = imgData.data;
      const timeStep = durationMs / 1e3 / width;
      const freqStep = (maxFreq - minFreq) / height;
      for (let y = 0; y < height; y++) {
        const freq = maxFreq - y * freqStep;
        const osc = offlineCtx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;
        const gainNode = offlineCtx.createGain();
        gainNode.gain.setValueAtTime(0, 0);
        let activePoints = 0;
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          const timePos = x * timeStep;
          if (brightness > 0.05) {
            gainNode.gain.linearRampToValueAtTime(brightness * 0.01, timePos);
            activePoints++;
          } else if (activePoints > 0) {
            gainNode.gain.linearRampToValueAtTime(0, timePos);
          }
        }
        if (activePoints > 0) {
          osc.connect(gainNode);
          gainNode.connect(offlineCtx.destination);
          osc.start(0);
          osc.stop(durationMs / 1e3);
        }
      }
      imgWrap.close();
      const renderedBuffer = await offlineCtx.startRendering();
      core.input(new Aud(renderedBuffer), { start: startMs, duration: durationMs, layer: -1 });
    };
  }

  // src/audio/fft.ts
  var FFT = class {
    n;
    levels;
    cosTable;
    sinTable;
    revBits;
    constructor(size) {
      this.n = size;
      this.levels = Math.round(Math.log2(size));
      this.cosTable = new Float64Array(size >> 1);
      this.sinTable = new Float64Array(size >> 1);
      for (let i = 0; i < size >> 1; i++) {
        const angle = 2 * Math.PI * i / size;
        this.cosTable[i] = Math.cos(angle);
        this.sinTable[i] = Math.sin(angle);
      }
      this.revBits = new Uint32Array(size);
      for (let i = 0; i < size; i++) {
        let rev = 0, val = i;
        for (let j = 0; j < this.levels; j++) {
          rev = rev << 1 | val & 1;
          val >>= 1;
        }
        this.revBits[i] = rev;
      }
    }
    forward(real, imag) {
      this._bitReverse(real, imag);
      this._butterfly(real, imag, false);
    }
    inverse(real, imag) {
      this._bitReverse(real, imag);
      this._butterfly(real, imag, true);
      const s = 1 / this.n;
      for (let i = 0; i < this.n; i++) {
        real[i] *= s;
        imag[i] *= s;
      }
    }
    _bitReverse(real, imag) {
      for (let i = 0; i < this.n; i++) {
        const j = this.revBits[i];
        if (j > i) {
          let tmp = real[i];
          real[i] = real[j];
          real[j] = tmp;
          tmp = imag[i];
          imag[i] = imag[j];
          imag[j] = tmp;
        }
      }
    }
    _butterfly(real, imag, inv) {
      const n = this.n, half = n >> 1;
      for (let size = 2; size <= n; size <<= 1) {
        const halfSize = size >> 1;
        const step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = 0; j < halfSize; j++) {
            const idx = j * step % half;
            const wr = this.cosTable[idx];
            const wi = inv ? this.sinTable[idx] : -this.sinTable[idx];
            const k = i + j;
            const l = k + halfSize;
            const tr = wr * real[l] - wi * imag[l];
            const ti = wr * imag[l] + wi * real[l];
            real[l] = real[k] - tr;
            imag[l] = imag[k] - ti;
            real[k] += tr;
            imag[k] += ti;
          }
        }
      }
    }
    static powerOfTwo(n) {
      let p = 1;
      while (p < n)
        p <<= 1;
      return p;
    }
  };
  function hannWindow(size) {
    const w = new Float64Array(size);
    for (let i = 0; i < size; i++)
      w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
    return w;
  }
  function hammingWindow(size) {
    const w = new Float64Array(size);
    for (let i = 0; i < size; i++)
      w[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (size - 1));
    return w;
  }
  function blackmanHarrisWindow(size) {
    const w = new Float64Array(size);
    const a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
    for (let i = 0; i < size; i++) {
      const x = 2 * Math.PI * i / (size - 1);
      w[i] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x) - a3 * Math.cos(3 * x);
    }
    return w;
  }
  function magnitude(real, imag) {
    const m = new Float64Array(real.length);
    for (let i = 0; i < real.length; i++)
      m[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    return m;
  }

  // src/audio/imdct.ts
  var IMDCT = class {
    n;
    halfN;
    fft;
    preTwiddle;
    postTwiddle;
    window;
    constructor(n) {
      this.n = n;
      this.halfN = n >> 1;
      const quarter = n >> 2;
      this.fft = new FFT(quarter);
      this.preTwiddle = { cos: new Float64Array(quarter), sin: new Float64Array(quarter) };
      this.postTwiddle = { cos: new Float64Array(quarter), sin: new Float64Array(quarter) };
      for (let k = 0; k < quarter; k++) {
        const preAngle = Math.PI / n * (2 * k + 1 + n / 2);
        this.preTwiddle.cos[k] = Math.cos(preAngle);
        this.preTwiddle.sin[k] = Math.sin(preAngle);
        const postAngle = Math.PI / n * (2 * k + 1 + n / 4);
        this.postTwiddle.cos[k] = Math.cos(postAngle);
        this.postTwiddle.sin[k] = Math.sin(postAngle);
      }
      this.window = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        this.window[i] = Math.sin(Math.PI / n * (i + 0.5));
      }
    }
    process(coefficients, output) {
      const quarter = this.halfN >> 1;
      const real = new Float64Array(quarter);
      const imag = new Float64Array(quarter);
      for (let k = 0; k < quarter; k++) {
        const xr = coefficients[2 * k];
        const xi = coefficients[this.halfN - 1 - 2 * k];
        real[k] = xr * this.preTwiddle.cos[k] + xi * this.preTwiddle.sin[k];
        imag[k] = xi * this.preTwiddle.cos[k] - xr * this.preTwiddle.sin[k];
      }
      this.fft.forward(real, imag);
      for (let k = 0; k < quarter; k++) {
        const yr = real[k] * this.postTwiddle.cos[k] - imag[k] * this.postTwiddle.sin[k];
        const yi = real[k] * this.postTwiddle.sin[k] + imag[k] * this.postTwiddle.cos[k];
        real[k] = yr;
        imag[k] = yi;
      }
      for (let k = 0; k < quarter; k++) {
        output[2 * k] = real[k];
        output[2 * k + 1] = imag[k];
        output[this.halfN + 2 * k] = -imag[quarter - 1 - k];
        output[this.halfN + 2 * k + 1] = -real[quarter - 1 - k];
      }
      for (let i = 0; i < this.n; i++)
        output[i] *= this.window[i];
    }
    overlapAdd(prevBlock, currCoeffs, outputSamples, offset) {
      const temp = new Float64Array(this.n);
      this.process(currCoeffs, temp);
      for (let i = 0; i < this.halfN; i++) {
        outputSamples[offset + i] = prevBlock[this.halfN + i] + temp[i];
      }
      return temp;
    }
  };

  // src/audio/autosync.ts
  var AutoSync = class {
    static correlate(refSignal, targetSignal, sampleRate) {
      const maxLen = Math.max(refSignal.length, targetSignal.length);
      const fftSize = FFT.powerOfTwo(maxLen * 2);
      const fft = new FFT(fftSize);
      const refReal = new Float64Array(fftSize);
      const refImag = new Float64Array(fftSize);
      const tgtReal = new Float64Array(fftSize);
      const tgtImag = new Float64Array(fftSize);
      for (let i = 0; i < refSignal.length; i++)
        refReal[i] = refSignal[i];
      for (let i = 0; i < targetSignal.length; i++)
        tgtReal[i] = targetSignal[i];
      fft.forward(refReal, refImag);
      fft.forward(tgtReal, tgtImag);
      const corrReal = new Float64Array(fftSize);
      const corrImag = new Float64Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        corrReal[i] = refReal[i] * tgtReal[i] + refImag[i] * tgtImag[i];
        corrImag[i] = refReal[i] * tgtImag[i] - refImag[i] * tgtReal[i];
      }
      fft.inverse(corrReal, corrImag);
      let peakVal = -Infinity, peakIdx = 0;
      for (let i = 0; i < fftSize; i++) {
        if (corrReal[i] > peakVal) {
          peakVal = corrReal[i];
          peakIdx = i;
        }
      }
      let offset = peakIdx;
      if (offset > fftSize / 2)
        offset -= fftSize;
      let subSampleOffset = offset;
      if (peakIdx > 0 && peakIdx < fftSize - 1) {
        const alpha = corrReal[(peakIdx - 1 + fftSize) % fftSize];
        const beta = corrReal[peakIdx];
        const gamma = corrReal[(peakIdx + 1) % fftSize];
        const denom = alpha - 2 * beta + gamma;
        if (Math.abs(denom) > 1e-12) {
          subSampleOffset = offset + (alpha - gamma) / (2 * denom);
        }
      }
      let refEnergy = 0, tgtEnergy = 0;
      for (let i = 0; i < refSignal.length; i++)
        refEnergy += refSignal[i] * refSignal[i];
      for (let i = 0; i < targetSignal.length; i++)
        tgtEnergy += targetSignal[i] * targetSignal[i];
      const normFactor = Math.sqrt(refEnergy * tgtEnergy);
      const confidence = normFactor > 1e-12 ? peakVal / normFactor : 0;
      return {
        offsetSamples: Math.round(subSampleOffset),
        offsetSeconds: subSampleOffset / sampleRate,
        confidence: Math.min(1, Math.max(0, confidence))
      };
    }
    static downmixToMono(buffer, channels) {
      if (channels === 1)
        return buffer;
      const frames = Math.floor(buffer.length / channels);
      const mono = new Float32Array(frames);
      const inv = 1 / channels;
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++)
          sum += buffer[i * channels + c];
        mono[i] = sum * inv;
      }
      return mono;
    }
    static downsample(signal, factor) {
      if (factor <= 1)
        return signal;
      const outLen = Math.floor(signal.length / factor);
      const out = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const srcIdx = i * factor;
        const lo = Math.floor(srcIdx);
        const frac = srcIdx - lo;
        out[i] = lo + 1 < signal.length ? signal[lo] * (1 - frac) + signal[lo + 1] * frac : signal[lo];
      }
      return out;
    }
  };

  // src/text/subtitle.ts
  function parseSRT(text) {
    if (text.charCodeAt(0) === 65279)
      text = text.slice(1);
    const cues = [];
    const blocks = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/\n\s*\n/);
    for (const block of blocks) {
      const lines = block.trim().split("\n");
      if (lines.length < 2)
        continue;
      let i = 0;
      if (/^\d+$/.test(lines[i].trim()))
        i++;
      const tsLine = lines[i++];
      const tsMatch = tsLine.match(
        /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/
      );
      if (!tsMatch)
        continue;
      const start = _srtTs(tsMatch, 1);
      const end = _srtTs(tsMatch, 5);
      const rawText = lines.slice(i).join("\n");
      cues.push({ start, end, text: _stripTags(rawText) });
    }
    return cues;
  }
  function _srtTs(m, offset) {
    return parseInt(m[offset + 0]) * 36e5 + parseInt(m[offset + 1]) * 6e4 + parseInt(m[offset + 2]) * 1e3 + parseInt(m[offset + 3].padEnd(3, "0"));
  }
  function parseVTT(text) {
    if (text.charCodeAt(0) === 65279)
      text = text.slice(1);
    const cues = [];
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    let i = 0;
    while (i < lines.length && !lines[i].includes("-->"))
      i++;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (line.startsWith("NOTE") || line.startsWith("STYLE")) {
        while (i < lines.length && lines[i].trim() !== "")
          i++;
        continue;
      }
      const tsMatch = line.match(
        /(\d{1,2}):(\d{2}):(\d{2}\.\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2}\.\d{1,3})(.*)/
      );
      if (tsMatch) {
        const start = _vttTs(tsMatch[1], tsMatch[2], tsMatch[3]);
        const end = _vttTs(tsMatch[4], tsMatch[5], tsMatch[6]);
        const settings = tsMatch[7] || "";
        const position = _vttSetting(settings, "position");
        const alignStr = _vttSetting(settings, "align");
        const align = alignStr === "left" || alignStr === "right" ? alignStr : "center";
        i++;
        const textLines = [];
        while (i < lines.length && lines[i].trim() !== "") {
          textLines.push(lines[i]);
          i++;
        }
        cues.push({
          start,
          end,
          text: _stripTags(textLines.join("\n")),
          position: position ? parseFloat(position) : void 0,
          align
        });
      } else {
        i++;
      }
    }
    return cues;
  }
  function _vttTs(h, m, s) {
    return parseInt(h) * 36e5 + parseInt(m) * 6e4 + Math.round(parseFloat(s) * 1e3);
  }
  function _vttSetting(settings, key) {
    const m = settings.match(new RegExp(`${key}:(\\S+)`));
    return m ? m[1] : null;
  }
  function _stripTags(s) {
    return s.replace(/<[^>]+>/g, "").trim();
  }
  function subtitlePlugin(cues, opts = {}) {
    return (core) => {
      for (const cue of cues) {
        core.timeline.clips.push({
          id: Math.random().toString(36).slice(2, 9),
          type: "text",
          source: { text: cue.text, isSubtitle: true },
          start: cue.start,
          end: cue.end,
          layer: opts.layer ?? 99,
          opacity: 1,
          x: opts.x ?? core.config.width * 0.1,
          y: opts.y ?? core.config.height * 0.82,
          w: core.config.width * 0.8,
          h: opts.fontSize ? opts.fontSize * 2 : 60,
          scaleX: 1,
          scaleY: 1,
          blend: "normal",
          audioVolume: 1,
          _sdfText: cue.text,
          _sdfFontSize: opts.fontSize ?? 36,
          _sdfColor: opts.color ?? [1, 1, 1, 1],
          _sdfAlign: cue.align ?? "center"
        });
      }
      core.timeline.clips.sort((a, b) => a.layer - b.layer);
    };
  }

  // src/text/sdf.ts
  init_core();
  var SDF_INIT_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_glyph; 
void main(){
    float covered = texture(u_glyph, v_uv).r;
    
    if(covered > 0.5) {
        o = vec4(v_uv, 1.0, 1.0);
    } else {
        o = vec4(2.0, 2.0, 0.0, 0.0); 
    }
}`;
  var SDF_JFA_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_prev;
uniform vec2 u_texelSize;
uniform float u_step;
void main(){
    vec4 best = texture(u_prev, v_uv);
    float bestDist = length(v_uv - best.rg);
    for(int dy=-1;dy<=1;dy++){
        for(int dx=-1;dx<=1;dx++){
            if(dx==0&&dy==0) continue;
            vec2 nb = v_uv + vec2(float(dx),float(dy))*u_step*u_texelSize;
            vec4 s = texture(u_prev, nb);
            if(s.b > 0.5){
                float d = length(v_uv - s.rg);
                if(d < bestDist){ bestDist = d; best = s; }
            }
        }
    }
    o = best;
}`;
  var SDF_FINAL_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_seed;  
uniform sampler2D u_glyph; 
uniform float u_spread;    
void main(){
    vec4 jfa = texture(u_seed, v_uv);
    float inside = step(0.5, texture(u_glyph, v_uv).r);
    float dist = length(v_uv - jfa.rg);
    
    float sdf = inside > 0.5 ? -dist : dist;
    float normalized = sdf / u_spread + 0.5;
    o = vec4(normalized, normalized, normalized, 1.0);
}`;
  var TEXT_RENDER_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_sdfAtlas;
uniform vec4 u_color;       
uniform float u_thickness;  
uniform float u_softness;   

uniform vec4 u_glyphUV;
void main(){
    vec2 atlasUV = mix(u_glyphUV.xy, u_glyphUV.zw, v_uv);
    float sdf = texture(u_sdfAtlas, atlasUV).r;
    float alpha = smoothstep(u_thickness - u_softness, u_thickness + u_softness, sdf);
    o = vec4(u_color.rgb, u_color.a * alpha);
}`;
  var ATLAS_SIZE = 1024;
  var CELL_SIZE = 64;
  var COLS = Math.floor(ATLAS_SIZE / CELL_SIZE);
  var SDFTextRenderer = class {
    _initGL;
    _jfaGL;
    _finalGL;
    _renderGL;
    _atlasCanvas;
    _atlasCtx;
    _atlasTexture = null;
    _glyphMap = /* @__PURE__ */ new Map();
    _nextSlot = 0;
    _atlasDirty = false;
    _spread = 0.1;
    _gl;
    constructor() {
      this._atlasCanvas = new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE);
      const ctx = this._atlasCanvas.getContext("2d");
      if (!ctx)
        throw new AegisError("OffscreenCanvas 2D not available for glyph seeding");
      this._atlasCtx = ctx;
      this._initGL = new GL(ATLAS_SIZE, ATLAS_SIZE);
      this._initGL.loadFragmentShader(SDF_INIT_FRAG);
      this._jfaGL = new GL(ATLAS_SIZE, ATLAS_SIZE);
      this._jfaGL.loadFragmentShader(SDF_JFA_FRAG);
      this._finalGL = new GL(ATLAS_SIZE, ATLAS_SIZE);
      this._finalGL.loadFragmentShader(SDF_FINAL_FRAG);
      this._renderGL = new GL(ATLAS_SIZE, ATLAS_SIZE);
      this._renderGL.loadFragmentShader(TEXT_RENDER_FRAG);
      this._gl = this._renderGL.gl;
    }
    async _ensureGlyph(char, fontSize) {
      const key = `${char}@${fontSize}`;
      if (this._glyphMap.has(key))
        return this._glyphMap.get(key);
      const slot = this._nextSlot++;
      const col = slot % COLS;
      const row = Math.floor(slot / COLS);
      const px = col * CELL_SIZE, py = row * CELL_SIZE;
      const ctx = this._atlasCtx;
      ctx.clearRect(px, py, CELL_SIZE, CELL_SIZE);
      ctx.font = `${Math.min(fontSize, CELL_SIZE - 8)}px sans-serif`;
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(char, px + CELL_SIZE / 2, py + CELL_SIZE / 2);
      const info = {
        col,
        row,
        advance: ctx.measureText(char).width / CELL_SIZE
      };
      this._glyphMap.set(key, info);
      this._atlasDirty = true;
      return info;
    }
    async _rebuildAtlas() {
      if (!this._atlasDirty)
        return;
      const gl = this._gl;
      if (!this._atlasTexture) {
        this._atlasTexture = gl.createTexture();
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._atlasTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this._atlasCanvas);
      this._atlasDirty = false;
    }
    async render(opts) {
      const {
        text,
        fontSize,
        width,
        height,
        color = [1, 1, 1, 1],
        align = "center",
        x = 0,
        y = 0,
        thickness = 0.5,
        softness = 0.04
      } = opts;
      const glyphs = [];
      for (const ch of text) {
        glyphs.push(await this._ensureGlyph(ch, fontSize));
      }
      await this._rebuildAtlas();
      const out = new OffscreenCanvas(width, height);
      const outCtx = out.getContext("2d");
      const scale = fontSize / CELL_SIZE;
      let totalW = glyphs.reduce((s, g) => s + g.advance * CELL_SIZE * scale, 0);
      let startX = x;
      if (align === "center")
        startX = x + (width - totalW) / 2;
      else if (align === "right")
        startX = x + width - totalW;
      let cx = startX;
      for (let i = 0; i < glyphs.length; i++) {
        const g = glyphs[i];
        const atlasX0 = g.col * CELL_SIZE / ATLAS_SIZE;
        const atlasY0 = g.row * CELL_SIZE / ATLAS_SIZE;
        const atlasX1 = atlasX0 + CELL_SIZE / ATLAS_SIZE;
        const atlasY1 = atlasY0 + CELL_SIZE / ATLAS_SIZE;
        const glW = Math.round(g.advance * CELL_SIZE * scale) || Math.round(fontSize * 0.6);
        const glH = Math.round(CELL_SIZE * scale);
        const glGL = new GL(glW, glH);
        glGL.loadFragmentShader(TEXT_RENDER_FRAG);
        const glCtx = glGL.gl;
        glCtx.activeTexture(glCtx.TEXTURE0);
        if (this._atlasTexture) {
          glCtx.bindTexture(glCtx.TEXTURE_2D, this._atlasTexture);
        }
        glGL.setUniform1i("u_sdfAtlas", 0).setUniform4f("u_color", color[0], color[1], color[2], color[3]).setUniform1f("u_thickness", thickness).setUniform1f("u_softness", softness).setUniform4f("u_glyphUV", atlasX0, atlasY0, atlasX1, atlasY1).render();
        const glBitmap = await glGL.extract();
        outCtx.drawImage(glBitmap, cx, y - glH / 2, glW, glH);
        glBitmap.close();
        cx += glW;
      }
      return createImageBitmap(out);
    }
  };

  // src/text/lottie.ts
  function evalValue(val, frame) {
    if (!val)
      return 0;
    if (!val.a)
      return val.k;
    const keys = val.k;
    if (!Array.isArray(keys) || keys.length === 0)
      return 0;
    if (frame <= keys[0].t)
      return keys[0].s ?? keys[0];
    if (frame >= keys[keys.length - 1].t) {
      const last = keys[keys.length - 1];
      return last.e ?? last.s ?? last;
    }
    for (let i = 0; i < keys.length - 1; i++) {
      const k1 = keys[i], k2 = keys[i + 1];
      if (frame >= k1.t && frame < k2.t) {
        const t = (frame - k1.t) / (k2.t - k1.t);
        const s = k1.s ?? k1, e = k1.e ?? (k2.s ?? k2);
        if (Array.isArray(s))
          return s.map((v, j) => v + (e[j] - v) * t);
        return s + (e - s) * t;
      }
    }
    return 0;
  }
  function evalColor(val, frame) {
    const c = evalValue(val, frame);
    if (Array.isArray(c))
      return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 1];
    return [0, 0, 0, 1];
  }
  function toRGB(arr) {
    return `rgba(${Math.round(arr[0] * 255)},${Math.round(arr[1] * 255)},${Math.round(arr[2] * 255)},${arr[3] ?? 1})`;
  }
  function applyTransform(ctx, ks, frame, w, h) {
    if (!ks)
      return;
    const pos = evalValue(ks.p, frame) ?? [0, 0];
    const anc = evalValue(ks.a, frame) ?? [0, 0];
    const scl = evalValue(ks.s, frame) ?? [100, 100];
    const rot = evalValue(ks.r, frame) ?? 0;
    ctx.translate(pos[0] ?? 0, pos[1] ?? 0);
    ctx.rotate(rot * Math.PI / 180);
    ctx.scale((scl[0] ?? 100) / 100, (scl[1] ?? 100) / 100);
    ctx.translate(-(anc[0] ?? 0), -(anc[1] ?? 0));
  }
  function drawShape(ctx, shape, frame, fills, strokes) {
    if (shape.ty === "gr") {
      const grp = shape;
      const gFills = grp.it.filter((s) => s.ty === "fl");
      const gStrokes = grp.it.filter((s) => s.ty === "st");
      ctx.save();
      applyTransform(ctx, grp.ks, frame, 0, 0);
      for (const item of grp.it) {
        if (item.ty !== "fl" && item.ty !== "st") {
          drawShape(ctx, item, frame, gFills, gStrokes);
        }
      }
      ctx.restore();
    } else if (shape.ty === "rc") {
      const rc = shape;
      const pos = evalValue(rc.p, frame) ?? [0, 0];
      const sz = evalValue(rc.s, frame) ?? [50, 50];
      const r = evalValue(rc.r, frame) ?? 0;
      ctx.beginPath();
      ctx.roundRect(pos[0] - sz[0] / 2, pos[1] - sz[1] / 2, sz[0], sz[1], r);
      _applyFillStroke(ctx, frame, fills, strokes);
    } else if (shape.ty === "el") {
      const el = shape;
      const pos = evalValue(el.p, frame) ?? [0, 0];
      const sz = evalValue(el.s, frame) ?? [50, 50];
      ctx.beginPath();
      ctx.ellipse(pos[0], pos[1], sz[0] / 2, sz[1] / 2, 0, 0, Math.PI * 2);
      _applyFillStroke(ctx, frame, fills, strokes);
    } else if (shape.ty === "sh") {
      const sh = shape;
      const ks = evalValue(sh.ks, frame);
      if (ks && ks.v) {
        const p2d = new Path2D();
        const verts = ks.v, tin = ks.i, tout = ks.o;
        if (verts.length > 0) {
          p2d.moveTo(verts[0][0], verts[0][1]);
          for (let i = 0; i < verts.length; i++) {
            const ni = (i + 1) % verts.length;
            const cp1 = [verts[i][0] + tout[i][0], verts[i][1] + tout[i][1]];
            const cp2 = [verts[ni][0] + tin[ni][0], verts[ni][1] + tin[ni][1]];
            p2d.bezierCurveTo(cp1[0], cp1[1], cp2[0], cp2[1], verts[ni][0], verts[ni][1]);
          }
          if (ks.c)
            p2d.closePath();
        }
        ctx.stroke(p2d);
        _applyFillStroke(ctx, frame, fills, strokes, p2d);
      }
    }
  }
  function _applyFillStroke(ctx, frame, fills, strokes, path) {
    for (const fill of fills) {
      const c = evalColor(fill.c, frame);
      const op = (evalValue(fill.o, frame) ?? 100) / 100;
      ctx.globalAlpha = op;
      ctx.fillStyle = toRGB(c);
      path ? ctx.fill(path) : ctx.fill();
    }
    for (const stroke of strokes) {
      const c = evalColor(stroke.c, frame);
      const op = (evalValue(stroke.o, frame) ?? 100) / 100;
      const w = evalValue(stroke.w, frame) ?? 1;
      ctx.globalAlpha = op;
      ctx.strokeStyle = toRGB(c);
      ctx.lineWidth = w;
      path ? ctx.stroke(path) : ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  var LottieDecoder = class {
    anim;
    constructor(json) {
      this.anim = typeof json === "string" ? JSON.parse(json) : json;
    }
    get duration() {
      return (this.anim.op - this.anim.ip) / this.anim.fr * 1e3;
    }
    get framerate() {
      return this.anim.fr;
    }
    async renderAt(timeMs) {
      const frame = this.anim.ip + timeMs / 1e3 * this.anim.fr;
      return this.renderFrame(frame);
    }
    async renderFrame(frame) {
      const { w, h, layers } = this.anim;
      const cv = new OffscreenCanvas(w, h);
      const ctx = cv.getContext("2d");
      const sorted = [...layers].reverse();
      for (const layer of sorted) {
        const ip = layer.ip ?? 0, op = layer.op ?? this.anim.op;
        if (frame < ip || frame >= op)
          continue;
        ctx.save();
        applyTransform(ctx, layer.ks, frame, w, h);
        const opacity = evalValue(layer.ks?.o ?? { a: 0, k: 100 }, frame) / 100;
        ctx.globalAlpha = opacity;
        if (layer.ty === 1) {
          ctx.fillStyle = layer.sc ?? "#000000";
          ctx.fillRect(0, 0, layer.sw ?? w, layer.sh ?? h);
        } else if (layer.ty === 4 && layer.shapes) {
          const fills = layer.shapes.filter((s) => s.ty === "fl");
          const strokes = layer.shapes.filter((s) => s.ty === "st");
          for (const shape of layer.shapes) {
            if (shape.ty === "fl" || shape.ty === "st")
              continue;
            drawShape(ctx, shape, frame, fills, strokes);
          }
        }
        ctx.restore();
      }
      return createImageBitmap(cv);
    }
  };

  // src/ml/webnn.ts
  init_core();
  var BILATERAL_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform float u_sigmaS;
uniform float u_sigmaR;
void main(){
    vec3 center = texture(u_image, v_uv).rgb;
    vec3 acc = vec3(0.0);
    float wt = 0.0;
    int r = int(u_sigmaS * 2.0);
    float s2 = u_sigmaS * u_sigmaS * 2.0;
    float r2 = u_sigmaR * u_sigmaR * 2.0;
    for(int dy=-r; dy<=r; dy++){
        for(int dx=-r; dx<=r; dx++){
            vec2 uv = v_uv + vec2(float(dx),float(dy)) * u_texelSize;
            vec3 nb = texture(u_image, uv).rgb;
            float spatialW = exp(-float(dx*dx+dy*dy)/s2);
            float rangeW   = exp(-dot(nb-center,nb-center)/r2);
            float w = spatialW * rangeW;
            acc += nb * w; wt += w;
        }
    }
    o = vec4(acc / wt, 1.0);
}`;
  var SHARPEN_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform vec2 u_texelSize;
uniform float u_strength;
void main(){
    vec3 c  = texture(u_image, v_uv).rgb;
    vec3 t  = texture(u_image, v_uv + vec2( 0, u_texelSize.y)).rgb;
    vec3 b  = texture(u_image, v_uv + vec2( 0,-u_texelSize.y)).rgb;
    vec3 l  = texture(u_image, v_uv + vec2(-u_texelSize.x, 0)).rgb;
    vec3 r  = texture(u_image, v_uv + vec2( u_texelSize.x, 0)).rgb;
    vec3 laplacian = c - (t+b+l+r)*0.25;
    o = vec4(clamp(c + u_strength * laplacian, 0.0, 1.0), 1.0);
}`;
  async function buildSuperResGraph(ml, width, height, weights) {
    if (!ml) {
      log.warn("[WebNN] navigator.ml not available");
      return null;
    }
    let ctx;
    try {
      ctx = await ml.createContext({ deviceType: "gpu" });
    } catch (e) {
      log.warn("[WebNN] Failed to create MLContext \u2014 GPU may not support WebNN", e);
      return null;
    }
    try {
      const builder = new MLGraphBuilder(ctx);
      const input = builder.input("input", { type: "float32", dimensions: [1, 3, height, width] });
      const w1 = builder.constant({ type: "float32", dimensions: [64, 3, 5, 5] }, weights.w1);
      const b1 = builder.constant({ type: "float32", dimensions: [64] }, weights.b1);
      const conv1 = builder.relu(builder.add(
        builder.conv2d(input, w1, { padding: [2, 2, 2, 2], strides: [1, 1] }),
        builder.reshape(b1, [1, 64, 1, 1])
      ));
      const w2 = builder.constant({ type: "float32", dimensions: [32, 64, 3, 3] }, weights.w2);
      const b2 = builder.constant({ type: "float32", dimensions: [32] }, weights.b2);
      const conv2 = builder.relu(builder.add(
        builder.conv2d(conv1, w2, { padding: [1, 1, 1, 1], strides: [1, 1] }),
        builder.reshape(b2, [1, 32, 1, 1])
      ));
      const scale = 2;
      const outChannels = 3 * scale * scale;
      const w3 = builder.constant({ type: "float32", dimensions: [outChannels, 32, 3, 3] }, weights.w3);
      const b3 = builder.constant({ type: "float32", dimensions: [outChannels] }, weights.b3);
      const conv3 = builder.add(
        builder.conv2d(conv2, w3, { padding: [1, 1, 1, 1] }),
        builder.reshape(b3, [1, outChannels, 1, 1])
      );
      const graph = await builder.build({ output: conv3 });
      return { graph, ctx };
    } catch (e) {
      log.warn("[WebNN] Graph build failed \u2014 model architecture incompatible with WebNN backend", e);
      return null;
    }
  }
  var AegisWebNN = class {
    _bilateralGL;
    _sharpenGL;
    _nnGraph = null;
    _nnCtx = null;
    _nnAvailable = false;
    _weights = null;
    w;
    h;
    constructor(width, height) {
      this.w = width;
      this.h = height;
      this._bilateralGL = new GL(width, height);
      this._bilateralGL.loadFragmentShader(BILATERAL_FRAG);
      this._sharpenGL = new GL(width, height);
      this._sharpenGL.loadFragmentShader(SHARPEN_FRAG);
    }
    async loadWeights(data) {
      const f32 = new Float32Array(data);
      let offset = 0;
      const read = (n) => {
        const s = f32.subarray(offset, offset + n);
        offset += n;
        return s;
      };
      this._weights = {
        w1: read(64 * 3 * 5 * 5),
        b1: read(64),
        w2: read(32 * 64 * 3 * 3),
        b2: read(32),
        w3: read(12 * 32 * 3 * 3),
        b3: read(12)
      };
      log.info(`[WebNN] Loaded ${f32.length} weight parameters`);
    }
    async init() {
      const ml = navigator.ml;
      if (!ml) {
        log.warn("[WebNN] navigator.ml not available \u2014 using multi-pass enhance fallback");
        return;
      }
      if (!this._weights) {
        log.warn("[WebNN] No model weights loaded \u2014 call loadWeights() first or provide weightsUrl. Super-resolution disabled.");
        return;
      }
      const result = await buildSuperResGraph(ml, this.w, this.h, this._weights);
      if (result) {
        this._nnGraph = result.graph;
        this._nnCtx = result.ctx;
        this._nnAvailable = true;
        log.info("[WebNN] ESPCN super-resolution graph compiled with loaded weights");
      }
    }
    async denoise(source, sigmaS = 3, sigmaR = 0.15) {
      this._bilateralGL.bindTexture("u_image", source, 0).setUniform2f("u_texelSize", 1 / this.w, 1 / this.h).setUniform1f("u_sigmaS", sigmaS).setUniform1f("u_sigmaR", sigmaR).render();
      return this._bilateralGL.extract();
    }
    async sharpen(source, strength = 0.5) {
      this._sharpenGL.bindTexture("u_image", source, 0).setUniform2f("u_texelSize", 1 / this.w, 1 / this.h).setUniform1f("u_strength", strength).render();
      return this._sharpenGL.extract();
    }
    async enhance(source) {
      const d = await this.denoise(source, 2, 0.12);
      const s = await this.sharpen(d, 0.6);
      d.close();
      return s;
    }
    async superRes(source) {
      if (this._nnAvailable && this._nnGraph && this._nnCtx) {
        try {
          const canvas = new OffscreenCanvas(this.w, this.h);
          const ctx2d = canvas.getContext("2d");
          ctx2d.drawImage(source, 0, 0, this.w, this.h);
          const imgData = ctx2d.getImageData(0, 0, this.w, this.h);
          const inputSize = 1 * 3 * this.h * this.w;
          const inputBuf = new Float32Array(inputSize);
          for (let y = 0; y < this.h; y++) {
            for (let x = 0; x < this.w; x++) {
              const pi = (y * this.w + x) * 4;
              inputBuf[0 * this.h * this.w + y * this.w + x] = imgData.data[pi] / 255;
              inputBuf[1 * this.h * this.w + y * this.w + x] = imgData.data[pi + 1] / 255;
              inputBuf[2 * this.h * this.w + y * this.w + x] = imgData.data[pi + 2] / 255;
            }
          }
          const scale = 2;
          const outChannels = 3 * scale * scale;
          const outputBuf = new Float32Array(1 * outChannels * this.h * this.w);
          const inputs = { input: inputBuf };
          const outputs = { output: outputBuf };
          await this._nnGraph.compute(inputs, outputs);
          const outW = this.w * scale, outH = this.h * scale;
          const outCanvas = new OffscreenCanvas(outW, outH);
          const outCtx = outCanvas.getContext("2d");
          const outImg = outCtx.createImageData(outW, outH);
          for (let c = 0; c < 3; c++) {
            for (let y = 0; y < this.h; y++) {
              for (let x = 0; x < this.w; x++) {
                for (let sy = 0; sy < scale; sy++) {
                  for (let sx = 0; sx < scale; sx++) {
                    const subCh = c * scale * scale + sy * scale + sx;
                    const val = outputBuf[subCh * this.h * this.w + y * this.w + x];
                    const outX = x * scale + sx;
                    const outY = y * scale + sy;
                    const outPi = (outY * outW + outX) * 4;
                    outImg.data[outPi + c] = Math.max(0, Math.min(255, Math.round(val * 255)));
                    if (c === 0)
                      outImg.data[outPi + 3] = 255;
                  }
                }
              }
            }
          }
          outCtx.putImageData(outImg, 0, 0);
          return createImageBitmap(outCanvas);
        } catch (e) {
          log.warn("[WebNN] Inference failed, falling back to enhance", e);
        }
      }
      return this.enhance(source);
    }
  };
  function windowAIModel(opts = {}) {
    return async (core) => {
      const webnn = new AegisWebNN(core.config.width, core.config.height);
      if (opts.weightsUrl) {
        try {
          const resp = await fetch(opts.weightsUrl);
          const buf = await resp.arrayBuffer();
          await webnn.loadWeights(buf);
        } catch (e) {
          log.warn("[WebNN] Failed to load weights from", opts.weightsUrl, e);
        }
      }
      await webnn.init();
      log.info("[WebNN] Plugin initialized");
    };
  }

  // src/ml/optflow.ts
  init_core();
  var WGSL_OPTICAL_FLOW = `
@group(0) @binding(0) var frame0 : texture_2d<f32>;
@group(0) @binding(1) var frame1 : texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> flow : array<vec2<f32>>;
@group(0) @binding(3) var<uniform> params : Params;

struct Params {
    width  : u32,
    height : u32,
    winSize: u32,
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    let W = i32(params.width);
    let H = i32(params.height);
    if (x >= W || y >= H) { return; }

    let win = i32(params.winSize);
    var sxx = 0.0; var sxy = 0.0; var syy = 0.0;
    var sxt = 0.0; var syt = 0.0;

    for (var dy = -win; dy <= win; dy++) {
        for (var dx = -win; dx <= win; dx++) {
            let nx = clamp(x + dx, 0, W - 1);
            let ny = clamp(y + dy, 0, H - 1);
            let nx1 = clamp(nx + 1, 0, W - 1);
            let ny1 = clamp(ny + 1, 0, H - 1);

            let p  = textureLoad(frame0, vec2<i32>(nx,  ny),  0).r;
            let pr = textureLoad(frame0, vec2<i32>(nx1, ny),  0).r;
            let pd = textureLoad(frame0, vec2<i32>(nx,  ny1), 0).r;
            let q  = textureLoad(frame1, vec2<i32>(nx,  ny),  0).r;

            let Ix = pr - p;
            let Iy = pd - p;
            let It = q  - p;

            sxx += Ix * Ix; sxy += Ix * Iy;
            syy += Iy * Iy; sxt += Ix * It;
            syt += Iy * It;
        }
    }

    let det = sxx * syy - sxy * sxy;
    var u = 0.0; var v = 0.0;
    if (abs(det) > 1e-6) {
        u = (-syy * sxt + sxy * syt) / det;
        v = ( sxy * sxt - sxx * syt) / det;
    }

    flow[u32(y * W + x)] = vec2<f32>(u, v);
}
`;
  var WGSL_WARP = `
@group(0) @binding(0) var src   : texture_2d<f32>;
@group(0) @binding(1) var<storage, read> flow : array<vec2<f32>>;
@group(0) @binding(2) var dst   : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> params : WarpParams;
struct WarpParams { width : u32, height : u32, scale : f32, _pad : f32 }

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let x = i32(gid.x);
    let y = i32(gid.y);
    let W = i32(params.width);
    let H = i32(params.height);
    if (x >= W || y >= H) { return; }

    let mv  = flow[u32(y * W + x)] * params.scale;
    let srcX = f32(x) + mv.x;
    let srcY = f32(y) + mv.y;

    let x0 = clamp(i32(floor(srcX)), 0, W-1);
    let y0 = clamp(i32(floor(srcY)), 0, H-1);
    let x1 = clamp(x0 + 1, 0, W-1);
    let y1 = clamp(y0 + 1, 0, H-1);
    let fx = srcX - floor(srcX);
    let fy = srcY - floor(srcY);

    let c00 = textureLoad(src, vec2<i32>(x0, y0), 0);
    let c10 = textureLoad(src, vec2<i32>(x1, y0), 0);
    let c01 = textureLoad(src, vec2<i32>(x0, y1), 0);
    let c11 = textureLoad(src, vec2<i32>(x1, y1), 0);
    let col = mix(mix(c00, c10, fx), mix(c01, c11, fx), fy);

    textureStore(dst, vec2<i32>(x, y), col);
}
`;
  var OpticalFlowEngine = class {
    device = null;
    flowPipeline = null;
    warpPipeline = null;
    w = 0;
    h = 0;
    flowBuf = null;
    paramBuf = null;
    get available() {
      return !!navigator.gpu;
    }
    async init(width, height) {
      const gpu = navigator.gpu;
      if (!gpu) {
        log.warn("[OptFlow] WebGPU unavailable");
        return false;
      }
      const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) {
        log.warn("[OptFlow] No adapter");
        return false;
      }
      this.device = await adapter.requestDevice();
      this.w = width;
      this.h = height;
      this.flowBuf = this.device.createBuffer({
        size: width * height * 8,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      });
      this.paramBuf = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      const flowMod = this.device.createShaderModule({ code: WGSL_OPTICAL_FLOW, label: "OptFlow" });
      const warpMod = this.device.createShaderModule({ code: WGSL_WARP, label: "Warp" });
      this.flowPipeline = this.device.createComputePipeline({
        layout: "auto",
        compute: { module: flowMod, entryPoint: "main" }
      });
      this.warpPipeline = this.device.createComputePipeline({
        layout: "auto",
        compute: { module: warpMod, entryPoint: "main" }
      });
      return true;
    }
    async computeFlow(frame0, frame1, winSize = 4) {
      if (!this.device || !this.flowPipeline)
        throw new AegisError("OptFlow not initialized");
      const dev = this.device;
      const W = this.w, H = this.h;
      const mkTex = (img) => {
        const tex = dev.createTexture({
          size: [W, H],
          format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
        });
        dev.queue.copyExternalImageToTexture({ source: img }, { texture: tex }, [W, H]);
        return tex;
      };
      const tex0 = mkTex(frame0), tex1 = mkTex(frame1);
      dev.queue.writeBuffer(this.paramBuf, 0, new Uint32Array([W, H, winSize, 0]));
      const bg = dev.createBindGroup({
        layout: this.flowPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: tex0.createView() },
          { binding: 1, resource: tex1.createView() },
          { binding: 2, resource: { buffer: this.flowBuf } },
          { binding: 3, resource: { buffer: this.paramBuf } }
        ]
      });
      const enc = dev.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(this.flowPipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
      pass.end();
      const readBuf = dev.createBuffer({
        size: W * H * 8,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      });
      enc.copyBufferToBuffer(this.flowBuf, 0, readBuf, 0, W * H * 8);
      dev.queue.submit([enc.finish()]);
      await dev.queue.onSubmittedWorkDone();
      await readBuf.mapAsync(GPUMapMode.READ);
      const result = new Float32Array(readBuf.getMappedRange().slice(0));
      readBuf.unmap();
      readBuf.destroy();
      tex0.destroy();
      tex1.destroy();
      return result;
    }
    async interpolate(frame0, frame1, t = 0.5) {
      if (!this.device || !this.warpPipeline || !this.flowPipeline) {
        return this._cpuBlend(frame0, frame1, t);
      }
      const dev = this.device;
      const W = this.w, H = this.h;
      const flow01 = await this.computeFlow(frame0, frame1);
      const flow10 = await this.computeFlow(frame1, frame0);
      const warpFrame = async (src, flow, scale) => {
        const srcTex = dev.createTexture({
          size: [W, H],
          format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
        });
        dev.queue.copyExternalImageToTexture({ source: src }, { texture: srcTex }, [W, H]);
        const flowBuf = dev.createBuffer({
          size: flow.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        dev.queue.writeBuffer(flowBuf, 0, flow.buffer);
        const dstTex = dev.createTexture({
          size: [W, H],
          format: "rgba8unorm",
          usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC
        });
        const warpParams = dev.createBuffer({
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        const paramData = new ArrayBuffer(16);
        new Uint32Array(paramData, 0, 2).set([W, H]);
        new Float32Array(paramData, 8, 2).set([scale, 0]);
        dev.queue.writeBuffer(warpParams, 0, new Uint8Array(paramData));
        const bg = dev.createBindGroup({
          layout: this.warpPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: srcTex.createView() },
            { binding: 1, resource: { buffer: flowBuf } },
            { binding: 2, resource: dstTex.createView() },
            { binding: 3, resource: { buffer: warpParams } }
          ]
        });
        const enc = dev.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(this.warpPipeline);
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
        pass.end();
        const readBuf = dev.createBuffer({
          size: W * H * 4,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        enc.copyTextureToBuffer(
          { texture: dstTex },
          { buffer: readBuf, bytesPerRow: W * 4 },
          [W, H]
        );
        dev.queue.submit([enc.finish()]);
        await dev.queue.onSubmittedWorkDone();
        await readBuf.mapAsync(GPUMapMode.READ);
        const pixels = new Uint8ClampedArray(readBuf.getMappedRange().slice(0));
        readBuf.unmap();
        const outCanvas2 = new OffscreenCanvas(W, H);
        const ctx2 = outCanvas2.getContext("2d");
        ctx2.putImageData(new ImageData(pixels, W, H), 0, 0);
        srcTex.destroy();
        dstTex.destroy();
        flowBuf.destroy();
        warpParams.destroy();
        readBuf.destroy();
        return createImageBitmap(outCanvas2);
      };
      const warped0 = await warpFrame(frame0, flow01, t);
      const warped1 = await warpFrame(frame1, flow10, 1 - t);
      const outCanvas = new OffscreenCanvas(W, H);
      const ctx = outCanvas.getContext("2d");
      ctx.globalAlpha = 1 - t;
      ctx.drawImage(warped0, 0, 0);
      ctx.globalAlpha = t;
      ctx.drawImage(warped1, 0, 0);
      warped0.close();
      warped1.close();
      return createImageBitmap(outCanvas);
    }
    async _cpuBlend(f0, f1, t) {
      const c = new OffscreenCanvas(this.w || f0.width, this.h || f0.height);
      const ctx = c.getContext("2d");
      ctx.globalAlpha = 1 - t;
      ctx.drawImage(f0, 0, 0);
      ctx.globalAlpha = t;
      ctx.drawImage(f1, 0, 0);
      return createImageBitmap(c);
    }
  };

  // src/ml/stabilize.ts
  init_core();
  var Kalman1D = class {
    Q;
    R;
    P = 1;
    K = 0;
    x = 0;
    constructor(Q = 1e-5, R = 0.01) {
      this.Q = Q;
      this.R = R;
    }
    correct(measurement) {
      this.P += this.Q;
      this.K = this.P / (this.P + this.R);
      this.x += this.K * (measurement - this.x);
      this.P = (1 - this.K) * this.P;
      return this.x;
    }
  };
  var STABILIZE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform vec2 u_offset;
uniform float u_scale;
void main(){
    vec2 uv = (v_uv - 0.5) * u_scale + 0.5 + u_offset;
    if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){ o=vec4(0,0,0,1); return; }
    o = texture(u_image, uv);
}`;
  function cpuLucasKanade(prev, curr, W, H, winSize = 4) {
    const gray = (d, i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const x0 = Math.floor(W * 0.3), x1 = Math.ceil(W * 0.7);
    const y0 = Math.floor(H * 0.3), y1 = Math.ceil(H * 0.7);
    const step = 2;
    let sumU = 0, sumV = 0, cnt = 0;
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        let sxx = 0, sxy = 0, syy = 0, sxt = 0, syt = 0;
        for (let dy = -winSize; dy <= winSize; dy++) {
          for (let dx = -winSize; dx <= winSize; dx++) {
            const nx = Math.min(Math.max(x + dx, 0), W - 1);
            const ny = Math.min(Math.max(y + dy, 0), H - 1);
            const nx1 = Math.min(nx + 1, W - 1);
            const ny1 = Math.min(ny + 1, H - 1);
            const pi = (ny * W + nx) * 4;
            const pri = (ny * W + nx1) * 4;
            const pdi = (ny1 * W + nx) * 4;
            const qi = (ny * W + nx) * 4;
            const p = gray(prev, pi);
            const Ix = gray(prev, pri) - p;
            const Iy = gray(prev, pdi) - p;
            const It = gray(curr, qi) - p;
            sxx += Ix * Ix;
            sxy += Ix * Iy;
            syy += Iy * Iy;
            sxt += Ix * It;
            syt += Iy * It;
          }
        }
        const det = sxx * syy - sxy * sxy;
        if (Math.abs(det) > 1e-4) {
          const u = (-syy * sxt + sxy * syt) / det;
          const v = (sxy * sxt - sxx * syt) / det;
          if (Math.abs(u) < 50 && Math.abs(v) < 50) {
            sumU += u;
            sumV += v;
            cnt++;
          }
        }
      }
    }
    return cnt > 0 ? { dx: sumU / cnt, dy: sumV / cnt } : { dx: 0, dy: 0 };
  }
  var VideoStabilizer = class {
    optFlow;
    gl;
    kalmanX = new Kalman1D();
    kalmanY = new Kalman1D();
    w;
    h;
    ready = false;
    gpuReady = false;
    constructor(width, height) {
      this.w = width;
      this.h = height;
      this.optFlow = new OpticalFlowEngine();
      this.gl = new GL(width, height);
      this.gl.loadFragmentShader(STABILIZE_FRAG);
      this.ready = true;
    }
    async init() {
      this.gpuReady = await this.optFlow.init(this.w, this.h);
      if (!this.gpuReady)
        log.warn("[Stabilizer] WebGPU unavailable \u2014 using CPU Lucas-Kanade fallback");
      else
        log.info("[Stabilizer] GPU optical flow active");
    }
    _getPixels(frame) {
      const c = new OffscreenCanvas(this.w, this.h);
      const ctx = c.getContext("2d");
      ctx.drawImage(frame, 0, 0, this.w, this.h);
      return ctx.getImageData(0, 0, this.w, this.h).data;
    }
    async analyzeFrames(frames, opts = {}) {
      if (!this.ready || frames.length < 2) {
        return frames.map(() => ({ dx: 0, dy: 0 }));
      }
      const W = this.w, H = this.h;
      const rawX = [0], rawY = [0];
      if (this.gpuReady) {
        for (let i = 1; i < frames.length; i++) {
          const flow = await this.optFlow.computeFlow(frames[i - 1], frames[i]);
          let sumX = 0, sumY = 0, cnt = 0;
          const x0 = Math.floor(W * 0.375), x1 = Math.ceil(W * 0.625);
          const y0 = Math.floor(H * 0.375), y1 = Math.ceil(H * 0.625);
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const idx = (y * W + x) * 2;
              sumX += flow[idx];
              sumY += flow[idx + 1];
              cnt++;
            }
          }
          rawX.push(rawX[i - 1] + sumX / cnt);
          rawY.push(rawY[i - 1] + sumY / cnt);
        }
      } else {
        let prevPixels = this._getPixels(frames[0]);
        for (let i = 1; i < frames.length; i++) {
          const currPixels = this._getPixels(frames[i]);
          const motion = cpuLucasKanade(prevPixels, currPixels, W, H);
          rawX.push(rawX[i - 1] + motion.dx);
          rawY.push(rawY[i - 1] + motion.dy);
          prevPixels = currPixels;
        }
      }
      const kx = new Kalman1D(opts.smoothing ? 1e-5 / opts.smoothing : 1e-5, 0.01);
      const ky = new Kalman1D(opts.smoothing ? 1e-5 / opts.smoothing : 1e-5, 0.01);
      const smoothX = rawX.map((v) => kx.correct(v));
      const smoothY = rawY.map((v) => ky.correct(v));
      return rawX.map((_, i) => ({
        dx: (smoothX[i] - rawX[i]) / W,
        dy: (smoothY[i] - rawY[i]) / H
      }));
    }
    async apply(frame, correction, cropRatio = 1.05) {
      this.gl.bindTexture("u_image", frame, 0).setUniform2f("u_offset", correction.dx, correction.dy).setUniform1f("u_scale", cropRatio).render();
      return this.gl.extract();
    }
  };

  // src/ml/segment.ts
  init_core();
  var SEGMENT_FRAG_GL = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform sampler2D u_bg;
uniform vec3 u_bgColor;
uniform float u_threshold;
uniform float u_edgeSoft;
uniform vec2 u_texelSize;

float lum(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }

float edge(sampler2D tex, vec2 uv, vec2 ts){
    float tl=lum(texture(tex,uv+vec2(-ts.x, ts.y)).rgb);
    float tm=lum(texture(tex,uv+vec2( 0.0,  ts.y)).rgb);
    float tr=lum(texture(tex,uv+vec2( ts.x, ts.y)).rgb);
    float ml=lum(texture(tex,uv+vec2(-ts.x, 0.0 )).rgb);
    float mr=lum(texture(tex,uv+vec2( ts.x, 0.0 )).rgb);
    float bl=lum(texture(tex,uv+vec2(-ts.x,-ts.y)).rgb);
    float bm=lum(texture(tex,uv+vec2( 0.0, -ts.y)).rgb);
    float br=lum(texture(tex,uv+vec2( ts.x,-ts.y)).rgb);
    float gx=(-tl-2.0*ml-bl)+(tr+2.0*mr+br);
    float gy=(-tl-2.0*tm-tr)+(bl+2.0*bm+br);
    return sqrt(gx*gx+gy*gy);
}

void main(){
    vec4 col = texture(u_image, v_uv);
    float dist = distance(col.rgb, u_bgColor);
    float edgeMag = edge(u_image, v_uv, u_texelSize);
    float mask = smoothstep(u_threshold - u_edgeSoft, u_threshold + u_edgeSoft, dist + edgeMag*0.5);
    vec4 bg = texture(u_bg, v_uv);
    o = mix(bg, col, mask);
}`;
  var GUIDED_FILTER_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform sampler2D u_mask;
uniform vec2 u_texelSize;
uniform float u_eps;
uniform int u_radius;

void main(){
    float sumI = 0.0, sumP = 0.0, sumIP = 0.0, sumII = 0.0;
    float count = 0.0;
    int r = u_radius;
    for(int dy=-r; dy<=r; dy++){
        for(int dx=-r; dx<=r; dx++){
            vec2 off = vec2(float(dx), float(dy)) * u_texelSize;
            float I = dot(texture(u_image, v_uv + off).rgb, vec3(0.2126,0.7152,0.0722));
            float P = texture(u_mask, v_uv + off).r;
            sumI += I; sumP += P;
            sumIP += I * P; sumII += I * I;
            count += 1.0;
        }
    }
    float meanI = sumI / count;
    float meanP = sumP / count;
    float corrIP = sumIP / count;
    float varI = sumII / count - meanI * meanI;
    float a = (corrIP - meanI * meanP) / (varI + u_eps);
    float b = meanP - a * meanI;
    float I = dot(texture(u_image, v_uv).rgb, vec3(0.2126,0.7152,0.0722));
    float result = clamp(a * I + b, 0.0, 1.0);
    o = vec4(result, result, result, 1.0);
}`;
  var RAW_MASK_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform vec3 u_bgColor;
uniform float u_threshold;
uniform float u_edgeSoft;
uniform vec2 u_texelSize;

float lum(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
float edge(sampler2D tex, vec2 uv, vec2 ts){
    float tl=lum(texture(tex,uv+vec2(-ts.x, ts.y)).rgb);
    float tm=lum(texture(tex,uv+vec2( 0.0,  ts.y)).rgb);
    float tr=lum(texture(tex,uv+vec2( ts.x, ts.y)).rgb);
    float ml=lum(texture(tex,uv+vec2(-ts.x, 0.0 )).rgb);
    float mr=lum(texture(tex,uv+vec2( ts.x, 0.0 )).rgb);
    float bl=lum(texture(tex,uv+vec2(-ts.x,-ts.y)).rgb);
    float bm=lum(texture(tex,uv+vec2( 0.0, -ts.y)).rgb);
    float br=lum(texture(tex,uv+vec2( ts.x,-ts.y)).rgb);
    float gx=(-tl-2.0*ml-bl)+(tr+2.0*mr+br);
    float gy=(-tl-2.0*tm-tr)+(bl+2.0*bm+br);
    return sqrt(gx*gx+gy*gy);
}
void main(){
    vec4 col = texture(u_image, v_uv);
    float dist = distance(col.rgb, u_bgColor);
    float edgeMag = edge(u_image, v_uv, u_texelSize);
    float mask = smoothstep(u_threshold - u_edgeSoft, u_threshold + u_edgeSoft, dist + edgeMag*0.5);
    o = vec4(mask, mask, mask, 1.0);
}`;
  var COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform sampler2D u_bg;
uniform sampler2D u_mask;
void main(){
    vec4 fg = texture(u_image, v_uv);
    vec4 bg = texture(u_bg, v_uv);
    float alpha = texture(u_mask, v_uv).r;
    o = mix(bg, fg, alpha);
}`;
  var MASK_COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_image;
uniform sampler2D u_bg;
uniform sampler2D u_aiMask;
void main(){
    vec4 fg = texture(u_image, v_uv);
    vec4 bg = texture(u_bg, v_uv);
    float alpha = texture(u_aiMask, v_uv).r;
    o = mix(bg, fg, alpha);
}`;
  var SegmentEngine = class {
    _gl;
    _rawMaskGL;
    _guidedGL;
    _compositeGL;
    w;
    h;
    _bgTex = null;
    constructor(width, height) {
      this.w = width;
      this.h = height;
      this._gl = new GL(width, height);
      this._gl.loadFragmentShader(SEGMENT_FRAG_GL);
      this._rawMaskGL = new GL(width, height);
      this._rawMaskGL.loadFragmentShader(RAW_MASK_FRAG);
      this._guidedGL = new GL(width, height);
      this._guidedGL.loadFragmentShader(GUIDED_FILTER_FRAG);
      this._compositeGL = new GL(width, height);
      this._compositeGL.loadFragmentShader(COMPOSITE_FRAG);
    }
    async apply(source, opts = {}) {
      const {
        bgColor = [0.05, 0.35, 0.05],
        threshold = 0.25,
        edgeSoft = 0.05,
        background,
        guidedFilterRadius = 4,
        guidedFilterEps = 0.01
      } = opts;
      this._rawMaskGL.bindTexture("u_image", source, 0).setUniform3f("u_bgColor", bgColor[0], bgColor[1], bgColor[2]).setUniform1f("u_threshold", threshold).setUniform1f("u_edgeSoft", edgeSoft).setUniform2f("u_texelSize", 1 / this.w, 1 / this.h).render();
      const rawMask = await this._rawMaskGL.extract();
      this._guidedGL.bindTexture("u_image", source, 0).bindTexture("u_mask", rawMask, 1).setUniform2f("u_texelSize", 1 / this.w, 1 / this.h).setUniform1f("u_eps", guidedFilterEps).setUniform1i("u_radius", guidedFilterRadius).render();
      const refinedMask = await this._guidedGL.extract();
      rawMask.close();
      if (background) {
        this._compositeGL.bindTexture("u_image", source, 0).bindTexture("u_bg", background, 1).bindTexture("u_mask", refinedMask, 2).render();
        refinedMask.close();
        return this._compositeGL.extract();
      }
      this._gl.bindTexture("u_image", source, 0);
      if (!this._bgTex) {
        const gl = this._gl.gl;
        this._bgTex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this._bgTex);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array([0, 0, 0, 0])
        );
      }
      this._gl.setUniform3f("u_bgColor", bgColor[0], bgColor[1], bgColor[2]).setUniform1f("u_threshold", threshold).setUniform1f("u_edgeSoft", edgeSoft).setUniform2f("u_texelSize", 1 / this.w, 1 / this.h).render();
      refinedMask.close();
      return this._gl.extract();
    }
  };
  var MODEL_INPUT_SIZE = 256;
  var AISegmentEngine = class {
    _chromaKey;
    _compositeGL;
    _guidedGL;
    _nnGraph = null;
    _nnCtx = null;
    _ready = false;
    _weights = null;
    w;
    h;
    constructor(width, height) {
      this.w = width;
      this.h = height;
      this._chromaKey = new SegmentEngine(width, height);
      this._compositeGL = new GL(width, height);
      this._compositeGL.loadFragmentShader(MASK_COMPOSITE_FRAG);
      this._guidedGL = new GL(width, height);
      this._guidedGL.loadFragmentShader(GUIDED_FILTER_FRAG);
    }
    async loadWeights(data) {
      const f32 = new Float32Array(data);
      let offset = 0;
      const read = (n) => {
        const slice = new Float32Array(f32.buffer, offset * 4, n);
        offset += n;
        return slice;
      };
      const readConv = (wSize, bSize) => ({
        w: read(wSize),
        b: read(bSize)
      });
      this._weights = {
        enc1: readConv(16 * 3 * 3 * 3, 16),
        enc2: readConv(32 * 16 * 3 * 3, 32),
        enc3: readConv(64 * 32 * 3 * 3, 64),
        enc4: readConv(128 * 64 * 3 * 3, 128),
        dec4: readConv(64 * 128 * 3 * 3, 64),
        dec3: readConv(32 * 64 * 3 * 3, 32),
        dec2: readConv(16 * 32 * 3 * 3, 16),
        dec1: readConv(16 * 16 * 3 * 3, 16),
        head: readConv(1 * 16 * 1 * 1, 1)
      };
      log.info(`[AISegment] Loaded ${offset} weight parameters (~${(offset * 4 / 1024).toFixed(0)}KB)`);
    }
    async init() {
      const ml = navigator.ml;
      if (!ml) {
        log.warn("[AISegment] navigator.ml not available \u2014 using chroma-key fallback");
        return;
      }
      if (!this._weights) {
        log.warn("[AISegment] No weights loaded \u2014 call loadWeights() first, using chroma-key fallback");
        return;
      }
      try {
        const ctx = await ml.createContext({ deviceType: "gpu" });
        const builder = new MLGraphBuilder(ctx);
        const S = MODEL_INPUT_SIZE;
        const input = builder.input("input", { dataType: "float32", dimensions: [1, 3, S, S] });
        const convBlock = (x, wData, bData, outCh, inCh, kH, kW, pad, stride) => {
          const w = builder.constant(
            { dataType: "float32", dimensions: [outCh, inCh, kH, kW] },
            wData
          );
          const b = builder.constant(
            { dataType: "float32", dimensions: [outCh] },
            bData
          );
          const conv = builder.conv2d(x, w, {
            padding: [pad, pad, pad, pad],
            strides: [stride, stride]
          });
          return builder.relu(builder.add(conv, builder.reshape(b, [1, outCh, 1, 1])));
        };
        const wt = this._weights;
        const e1 = convBlock(input, wt.enc1.w, wt.enc1.b, 16, 3, 3, 3, 1, 2);
        const e2 = convBlock(e1, wt.enc2.w, wt.enc2.b, 32, 16, 3, 3, 1, 2);
        const e3 = convBlock(e2, wt.enc3.w, wt.enc3.b, 64, 32, 3, 3, 1, 2);
        const e4 = convBlock(e3, wt.enc4.w, wt.enc4.b, 128, 64, 3, 3, 1, 2);
        const d4 = convBlock(e4, wt.dec4.w, wt.dec4.b, 64, 128, 3, 3, 1, 1);
        const d4up = builder.resample2d(d4, {
          mode: "nearest",
          sizes: [S / 4, S / 4]
        });
        const d3 = convBlock(d4up, wt.dec3.w, wt.dec3.b, 32, 64, 3, 3, 1, 1);
        const d3up = builder.resample2d(d3, {
          mode: "nearest",
          sizes: [S / 2, S / 2]
        });
        const d2 = convBlock(d3up, wt.dec2.w, wt.dec2.b, 16, 32, 3, 3, 1, 1);
        const d2up = builder.resample2d(d2, {
          mode: "nearest",
          sizes: [S, S]
        });
        const d1 = convBlock(d2up, wt.dec1.w, wt.dec1.b, 16, 16, 3, 3, 1, 1);
        const headW = builder.constant(
          { dataType: "float32", dimensions: [1, 16, 1, 1] },
          wt.head.w
        );
        const headB = builder.constant(
          { dataType: "float32", dimensions: [1] },
          wt.head.b
        );
        const headConv = builder.conv2d(d1, headW, { padding: [0, 0, 0, 0] });
        const output = builder.sigmoid(builder.add(
          headConv,
          builder.reshape(headB, [1, 1, 1, 1])
        ));
        this._nnGraph = await builder.build({ output });
        this._nnCtx = ctx;
        this._ready = true;
        log.info("[AISegment] WebNN segmentation graph compiled successfully");
      } catch (e) {
        log.warn("[AISegment] WebNN graph build failed, using chroma-key fallback", e);
      }
    }
    async apply(source, opts = {}) {
      if (!this._ready || !this._nnGraph) {
        return this._chromaKey.apply(source, opts);
      }
      try {
        const mask = await this._infer(source);
        if (opts.guidedFilterRadius && opts.guidedFilterRadius > 0) {
          this._guidedGL.bindTexture("u_image", source, 0).bindTexture("u_mask", mask, 1).setUniform2f("u_texelSize", 1 / this.w, 1 / this.h).setUniform1f("u_eps", opts.guidedFilterEps ?? 0.01).setUniform1i("u_radius", opts.guidedFilterRadius).render();
          const refined = await this._guidedGL.extract();
          mask.close();
          if (opts.background) {
            return this._composite(source, opts.background, refined);
          }
          return refined;
        }
        if (opts.background) {
          return this._composite(source, opts.background, mask);
        }
        return mask;
      } catch (e) {
        log.warn("[AISegment] Inference failed, falling back to chroma-key", e);
        return this._chromaKey.apply(source, opts);
      }
    }
    get isAIReady() {
      return this._ready;
    }
    async _infer(source) {
      const S = MODEL_INPUT_SIZE;
      const canvas = new OffscreenCanvas(S, S);
      const ctx2d = canvas.getContext("2d");
      ctx2d.drawImage(source, 0, 0, S, S);
      const imgData = ctx2d.getImageData(0, 0, S, S);
      const inputBuf = new Float32Array(1 * 3 * S * S);
      const px = imgData.data;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const pi = (y * S + x) * 4;
          const idx = y * S + x;
          inputBuf[0 * S * S + idx] = px[pi] / 255;
          inputBuf[1 * S * S + idx] = px[pi + 1] / 255;
          inputBuf[2 * S * S + idx] = px[pi + 2] / 255;
        }
      }
      const outputBuf = new Float32Array(1 * 1 * S * S);
      await this._nnGraph.compute(
        { input: inputBuf },
        { output: outputBuf }
      );
      const outW = ("width" in source ? source.width : 0) || this.w;
      const outH = ("height" in source ? source.height : 0) || this.h;
      const outCanvas = new OffscreenCanvas(outW, outH);
      const outCtx = outCanvas.getContext("2d");
      const outImg = outCtx.createImageData(outW, outH);
      const scaleX = S / outW;
      const scaleY = S / outH;
      for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
          const srcX = Math.min(S - 1, Math.floor(x * scaleX));
          const srcY = Math.min(S - 1, Math.floor(y * scaleY));
          const alpha = outputBuf[srcY * S + srcX];
          const val = Math.max(0, Math.min(255, Math.round(alpha * 255)));
          const pi = (y * outW + x) * 4;
          outImg.data[pi] = val;
          outImg.data[pi + 1] = val;
          outImg.data[pi + 2] = val;
          outImg.data[pi + 3] = 255;
        }
      }
      outCtx.putImageData(outImg, 0, 0);
      return createImageBitmap(outCanvas);
    }
    async _composite(fg, bg, mask) {
      this._compositeGL.bindTexture("u_image", fg, 0).bindTexture("u_bg", bg, 1).bindTexture("u_aiMask", mask, 2).render();
      mask.close();
      return this._compositeGL.extract();
    }
  };
  var WebGPUSegmentEngine = class {
    _aiEngine;
    w;
    h;
    constructor(width, height) {
      this.w = width;
      this.h = height;
      this._aiEngine = new AISegmentEngine(width, height);
    }
    async loadWeights(data) {
      return this._aiEngine.loadWeights(data);
    }
    async init() {
      return this._aiEngine.init();
    }
    get isAIReady() {
      return this._aiEngine.isAIReady;
    }
    async apply(source, opts = {}) {
      return this._aiEngine.apply(source, opts);
    }
  };

  // src/ml/beatsync.ts
  init_core();
  function detectOnsets(channelData, sampleRate, thresholdMul = 1.4) {
    const fftSize = 1024;
    const hopSize = fftSize >> 1;
    const window2 = hannWindow(fftSize);
    const fft = new FFT(fftSize);
    const numFrames = Math.floor((channelData.length - fftSize) / hopSize) + 1;
    const spectralFlux = [];
    let prevMag = new Float64Array(fftSize >> 1);
    for (let f = 0; f < numFrames; f++) {
      const offset = f * hopSize;
      const real = new Float64Array(fftSize);
      const imag = new Float64Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        real[i] = (channelData[offset + i] || 0) * window2[i];
      }
      fft.forward(real, imag);
      const mag = magnitude(real, imag);
      let flux = 0;
      const halfN = fftSize >> 1;
      for (let k = 0; k < halfN; k++) {
        const diff = mag[k] - prevMag[k];
        if (diff > 0)
          flux += diff;
      }
      spectralFlux.push(flux);
      prevMag = Float64Array.from(mag.subarray(0, halfN));
    }
    const medianWin = 16;
    const peaks = [];
    for (let i = medianWin; i < spectralFlux.length - medianWin; i++) {
      const window22 = [];
      for (let j = i - medianWin; j <= i + medianWin; j++) {
        window22.push(spectralFlux[j]);
      }
      window22.sort((a, b) => a - b);
      const median = window22[window22.length >> 1];
      const adaptiveThreshold = median * thresholdMul + 0.01;
      if (spectralFlux[i] > adaptiveThreshold && spectralFlux[i] >= spectralFlux[i - 1] && spectralFlux[i] >= spectralFlux[i + 1]) {
        const timeMs = i * hopSize / sampleRate * 1e3;
        if (peaks.length === 0 || timeMs - peaks[peaks.length - 1] > 100) {
          peaks.push(timeMs);
        }
      }
    }
    const bpm = estimateBPM(peaks, 60, 200);
    return { peaks, bpm };
  }
  function estimateBPM(peaks, minBPM, maxBPM) {
    if (peaks.length < 4)
      return 120;
    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
      const d = peaks[i] - peaks[i - 1];
      if (d > 0)
        intervals.push(d);
    }
    if (intervals.length < 2)
      return 120;
    const minInterval = 6e4 / maxBPM;
    const maxInterval = 6e4 / minBPM;
    const histogram = /* @__PURE__ */ new Map();
    for (const iv of intervals) {
      if (iv < minInterval || iv > maxInterval)
        continue;
      const bucket = Math.round(iv / 10) * 10;
      histogram.set(bucket, (histogram.get(bucket) || 0) + 1);
    }
    let bestBucket = 500, bestCount = 0;
    for (const [bucket, count] of histogram) {
      if (count > bestCount) {
        bestCount = count;
        bestBucket = bucket;
      }
    }
    return Math.round(6e4 / bestBucket);
  }
  function autoBeatSync(opts) {
    return (core) => {
      const threshold = opts.threshold || 1.4;
      const audioClip = core.timeline.clips.find((c) => c.id === opts.audioTargetId);
      if (!audioClip || !(audioClip.source instanceof Aud)) {
        log.warn("AutoBeatSync: Audio target not found or invalid.");
        return;
      }
      const aud = audioClip.source;
      const buffer = aud.b;
      if (!buffer) {
        log.warn("AutoBeatSync: Unresolved Aud buffer.");
        return;
      }
      const channelData = buffer.getChannelData(0);
      const sampleRate = buffer.sampleRate;
      const { peaks, bpm } = detectOnsets(channelData, sampleRate, threshold);
      log.info(`AutoBeatSync: Detected ${peaks.length} beats, estimated BPM: ${bpm}`);
      const videoClips = core.timeline.clips.filter((c) => opts.videoTargetIds.includes(c.id));
      if (videoClips.length > 0 && peaks.length > 0) {
        for (let i = 0; i < videoClips.length; i++) {
          if (i < peaks.length) {
            videoClips[i].start = peaks[i];
            videoClips[i].end = i + 1 < peaks.length ? peaks[i + 1] : peaks[i] + 2e3;
          }
        }
      }
    };
  }

  // src/ml/vj.ts
  init_core();
  var _vjParams = /* @__PURE__ */ new WeakMap();
  function vjMidiMap(opts = {}) {
    return (core) => {
      const mapping = opts.ccMapping || { 1: "alpha", 7: "brightness", 10: "hue" };
      _vjParams.set(core, /* @__PURE__ */ new Map());
      if (typeof navigator !== "undefined" && navigator.requestMIDIAccess) {
        navigator.requestMIDIAccess().then((access) => {
          access.inputs.forEach((input) => {
            input.onmidimessage = (message) => {
              if (!message.data)
                return;
              const status = message.data[0];
              const channel = status & 15;
              const type = status & 240;
              if (opts.midiChannel !== void 0 && channel !== opts.midiChannel)
                return;
              if (type === 176) {
                const cc = message.data[1];
                const value = message.data[2] / 127;
                const paramName = mapping[cc];
                if (paramName) {
                  _vjParams.get(core).set(paramName, value);
                }
              }
            };
          });
          access.onstatechange = (event) => {
            const port = event.port;
            if (port && port.state === "connected" && port.type === "input") {
              log.info(`[VJ] MIDI input connected: ${port.name}`);
            }
          };
          log.info(`[VJ] MIDI access granted \u2014 listening on ${access.inputs.size} input(s)`);
        }).catch((err) => {
          log.warn("[VJ] MIDI access denied or unsupported", err);
        });
      } else {
        log.warn("[VJ] Web MIDI API not available");
      }
    };
  }
  function getVJParam(core, name, fallback = 0) {
    const params = _vjParams.get(core);
    if (!params)
      return fallback;
    return params.get(name) ?? fallback;
  }

  // src/ml/plugins.ts
  init_core();
  function stabilizePlugin(opts = {}) {
    let stabilizer = null;
    const corrections = /* @__PURE__ */ new Map();
    return {
      init(core) {
        stabilizer = new VideoStabilizer(core.config.width, core.config.height);
        stabilizer.init().catch((e) => log.warn("[StabilizePlugin] init failed", e));
      },
      onBeforeFrame(core, clips, ms) {
        if (!stabilizer)
          return;
        for (const clip of clips) {
          if (clip.type !== "video" || !clip.source)
            continue;
          const corrs = corrections.get(clip.id);
          if (!corrs)
            continue;
          const frameIdx = Math.round(ms / (1e3 / core.config.fps));
          if (frameIdx >= 0 && frameIdx < corrs.length) {
            clip.x = (typeof clip.x === "number" ? clip.x : 0) + corrs[frameIdx].dx * core.config.width;
            clip.y = (typeof clip.y === "number" ? clip.y : 0) + corrs[frameIdx].dy * core.config.height;
          }
        }
      }
    };
  }
  function segmentPlugin(opts = {}) {
    let engine = null;
    let ready = false;
    return {
      async init(_core) {
        const S = opts.modelSize || 256;
        engine = new AISegmentEngine(S, S);
        try {
          await engine.init();
          ready = true;
          log.info("[SegmentPlugin] initialized");
        } catch (e) {
          log.warn("[SegmentPlugin] init failed \u2014 segmentation disabled", e);
        }
      },
      onBeforeFrame(_core, clips, _ms) {
        if (!ready || !engine)
          return;
        for (const clip of clips) {
          if (clip.type !== "video" && clip.type !== "image")
            continue;
          if (!clip.meta?.["segmentEnabled"])
            continue;
          clip.meta["_segEngine"] = engine;
          clip.meta["_segMode"] = opts.background || "blur";
        }
      }
    };
  }
  function beatsyncPlugin(opts = {}) {
    const beatTimestamps = [];
    let analyzed = false;
    return {
      init(core) {
        const audioClips = core.timeline.clips.filter((c) => c.type === "audio");
        if (audioClips.length === 0)
          return;
        for (const clip of audioClips) {
          if (!(clip.source instanceof Aud))
            continue;
          const buffer = clip.source.b;
          if (!buffer)
            continue;
          try {
            const channelData = buffer.getChannelData(0);
            const { peaks } = detectOnsets(channelData, buffer.sampleRate, opts.threshold || 1.4);
            for (const p of peaks) {
              beatTimestamps.push(clip.start + p);
            }
            log.info(`[BeatsyncPlugin] detected ${peaks.length} beats`);
          } catch (e) {
            log.warn("[BeatsyncPlugin] beat detection failed", e);
          }
        }
        beatTimestamps.sort((a, b) => a - b);
        analyzed = true;
      },
      onBeforeFrame(core, clips, ms) {
        if (!analyzed || beatTimestamps.length === 0)
          return;
        const halfFrame = 1e3 / core.config.fps / 2;
        const nearestBeat = beatTimestamps.find((b) => Math.abs(b - ms) < halfFrame);
        if (nearestBeat !== void 0) {
          for (const clip of clips) {
            if (clip.meta?.["beatsyncEnabled"]) {
              clip.meta["_onBeat"] = true;
              clip.meta["_beatMs"] = nearestBeat;
            }
          }
        }
      }
    };
  }

  // src/demux/mp4.ts
  init_core();
  var MP4Demuxer = class _MP4Demuxer {
    buf;
    raw;
    tracks = [];
    _mvhdTimescale = 1;
    constructor(buffer) {
      this.raw = new Uint8Array(buffer);
      this.buf = new DataView(buffer);
    }
    parse() {
      try {
        this._parseBoxes(0, this.buf.byteLength, null);
      } catch (e) {
        log.warn("[MP4Demuxer] Parse error (possibly truncated file):", e);
      }
    }
    _parseBoxes(start, end, parent) {
      let pos = start;
      while (pos < end - 8) {
        let size = this.buf.getUint32(pos);
        const type = this._fourcc(pos + 4);
        let dataStart = pos + 8;
        if (size === 1) {
          if (pos + 16 > end)
            break;
          size = Number(this.buf.getBigUint64(pos + 8));
          dataStart = pos + 16;
        } else if (size === 0) {
          size = end - pos;
        }
        if (size < 8 || pos + size > end)
          break;
        const boxEnd = pos + size;
        if (["moov", "trak", "mdia", "minf", "stbl", "udta", "edts"].includes(type)) {
          this._parseBoxes(dataStart, boxEnd, type);
        } else {
          this._handleBox(type, dataStart, boxEnd, parent);
        }
        pos = boxEnd;
      }
    }
    _ctx = {};
    _handleBox(type, start, end, parent) {
      switch (type) {
        case "mvhd":
          this._mvhdTimescale = this.buf.getUint32(start + 4 + (this.buf.getUint8(start) === 1 ? 16 : 4));
          break;
        case "tkhd": {
          const v = this.buf.getUint8(start);
          const id = this.buf.getUint32(start + (v === 1 ? 16 : 8) + 4);
          if (!this._ctx.track || this._ctx.track.id !== id) {
            this._ctx.track = { id, samples: [], type: "other" };
            this._tmpStts = [];
            this._tmpCtts = [];
            this._tmpSizes = [];
            this._tmpChunkMap = [];
            this._tmpChunkOffsets = [];
            this._tmpKeyFrames.clear();
          }
          break;
        }
        case "mdhd": {
          const v = this.buf.getUint8(start);
          const ts = v === 1 ? Number(this.buf.getBigUint64(start + 20)) : this.buf.getUint32(start + 12);
          const dur = v === 1 ? Number(this.buf.getBigUint64(start + 28)) : this.buf.getUint32(start + 16);
          if (this._ctx.track) {
            this._ctx.track.timescale = ts;
            this._ctx.track.duration = dur;
          }
          break;
        }
        case "hdlr": {
          const hdlr = this._fourcc(start + 8);
          if (this._ctx.track)
            this._ctx.track.type = hdlr === "vide" ? "video" : hdlr === "soun" ? "audio" : "other";
          break;
        }
        case "avc1":
        case "hev1":
        case "hvc1":
        case "av01":
        case "vp09": {
          if (this._ctx.track) {
            this._ctx.track.codec = type;
            this._ctx.track.width = this.buf.getUint16(start + 24);
            this._ctx.track.height = this.buf.getUint16(start + 26);
            this._parseBoxes(start + 78, end, type);
          }
          break;
        }
        case "mp4a":
        case "opus":
        case "ac-3":
        case "ec-3":
        case "Opus": {
          if (this._ctx.track) {
            this._ctx.track.codec = type === "mp4a" ? "mp4a" : type;
            this._ctx.track.channelCount = this.buf.getUint16(start + 16);
            this._ctx.track.sampleRate = this.buf.getUint32(start + 24) >>> 16;
            this._parseBoxes(start + 28, end, type);
          }
          break;
        }
        case "avcC":
        case "hvcC":
        case "av1C":
        case "vpcC":
        case "dOps":
        case "esds": {
          if (this._ctx.track)
            this._ctx.track.extradata = this.raw.subarray(start, end);
          break;
        }
        case "stsd":
          this._parseBoxes(start + 8, end, "stsd");
          break;
        case "stts":
          this._parseStts(start);
          break;
        case "ctts":
          this._parseCtts(start);
          break;
        case "stsc":
          this._parseStsc(start);
          break;
        case "stsz":
          this._parseStsz(start);
          break;
        case "stco":
        case "co64":
          this._parseStco(start, type === "co64");
          break;
        case "stss":
          this._parseStss(start);
          break;
      }
      if (type === "stss") {
        if (this._ctx.track && this._ctx.track.samples && this._tmpKeyFrames.size > 0) {
          for (let i = 0; i < this._ctx.track.samples.length; i++) {
            this._ctx.track.samples[i].isKey = this._tmpKeyFrames.has(i + 1);
          }
          this._tmpKeyFrames.clear();
        }
      }
      if (type === "stco" || type === "co64") {
        this._finalizeSamples();
      }
    }
    _tmpStts = [];
    _tmpCtts = [];
    _tmpSizes = [];
    _tmpChunkMap = [];
    _tmpChunkOffsets = [];
    _tmpKeyFrames = /* @__PURE__ */ new Set();
    _parseStts(s) {
      const n = Math.min(this.buf.getUint32(s + 4), Math.floor((this.raw.byteLength - s - 8) / 8));
      this._tmpStts = [];
      for (let i = 0; i < n; i++)
        this._tmpStts.push({ count: this.buf.getUint32(s + 8 + i * 8), delta: this.buf.getUint32(s + 12 + i * 8) });
    }
    _parseCtts(s) {
      const ver = this.buf.getUint8(s);
      const n = Math.min(this.buf.getUint32(s + 4), Math.floor((this.raw.byteLength - s - 8) / 8));
      this._tmpCtts = [];
      for (let i = 0; i < n; i++)
        this._tmpCtts.push({ count: this.buf.getUint32(s + 8 + i * 8), offset: ver === 1 ? this.buf.getInt32(s + 12 + i * 8) : this.buf.getUint32(s + 12 + i * 8) });
    }
    _parseStsc(s) {
      const n = Math.min(this.buf.getUint32(s + 4), Math.floor((this.raw.byteLength - s - 8) / 12));
      this._tmpChunkMap = [];
      for (let i = 0; i < n; i++)
        this._tmpChunkMap.push({
          firstChunk: this.buf.getUint32(s + 8 + i * 12),
          samplesPerChunk: this.buf.getUint32(s + 12 + i * 12),
          sdIndex: this.buf.getUint32(s + 16 + i * 12)
        });
    }
    _parseStsz(s) {
      const defaultSize = this.buf.getUint32(s + 4);
      const n = Math.min(this.buf.getUint32(s + 8), Math.floor((this.raw.byteLength - s - 12) / 4));
      this._tmpSizes = [];
      if (defaultSize > 0) {
        for (let i = 0; i < n; i++)
          this._tmpSizes.push(defaultSize);
      } else {
        for (let i = 0; i < n; i++)
          this._tmpSizes.push(this.buf.getUint32(s + 12 + i * 4));
      }
    }
    _parseStco(s, co64) {
      const itemSize = co64 ? 8 : 4;
      const n = Math.min(this.buf.getUint32(s + 4), Math.floor((this.raw.byteLength - s - 8) / itemSize));
      this._tmpChunkOffsets = [];
      for (let i = 0; i < n; i++) {
        this._tmpChunkOffsets.push(co64 ? Number(this.buf.getBigUint64(s + 8 + i * 8)) : this.buf.getUint32(s + 8 + i * 4));
      }
    }
    _parseStss(s) {
      const n = Math.min(this.buf.getUint32(s + 4), Math.floor((this.raw.byteLength - s - 8) / 4));
      this._tmpKeyFrames.clear();
      for (let i = 0; i < n; i++)
        this._tmpKeyFrames.add(this.buf.getUint32(s + 8 + i * 4));
    }
    _sttsLookup(sampleIdx) {
      let dts = 0, idx = 0;
      for (const e of this._tmpStts) {
        if (sampleIdx < idx + e.count) {
          dts += (sampleIdx - idx) * e.delta;
          return { dts, delta: e.delta };
        }
        dts += e.count * e.delta;
        idx += e.count;
      }
      return { dts, delta: this._tmpStts.length > 0 ? this._tmpStts[this._tmpStts.length - 1].delta : 0 };
    }
    _cttsLookup(sampleIdx) {
      if (this._tmpCtts.length === 0)
        return 0;
      let idx = 0;
      for (const e of this._tmpCtts) {
        if (sampleIdx < idx + e.count)
          return e.offset;
        idx += e.count;
      }
      return 0;
    }
    _finalizeSamples() {
      if (!this._ctx.track || !this._tmpSizes.length || !this._tmpChunkOffsets.length)
        return;
      const samples = [];
      const ts = this._ctx.track.timescale ?? 9e4;
      let sampleIdx = 0;
      for (let ci = 0; ci < this._tmpChunkOffsets.length; ci++) {
        const chunkNum = ci + 1;
        let spc = this._tmpChunkMap[0]?.samplesPerChunk ?? 1;
        for (let mi = 0; mi < this._tmpChunkMap.length; mi++) {
          if (chunkNum >= this._tmpChunkMap[mi].firstChunk)
            spc = this._tmpChunkMap[mi].samplesPerChunk;
          else
            break;
        }
        let off = this._tmpChunkOffsets[ci];
        for (let si = 0; si < spc && sampleIdx < this._tmpSizes.length; si++) {
          const sz = this._tmpSizes[sampleIdx];
          const { dts: rawDts, delta } = this._sttsLookup(sampleIdx);
          const cts = this._cttsLookup(sampleIdx);
          samples.push({
            offset: off,
            size: sz,
            dts: rawDts,
            pts: rawDts + cts,
            duration: delta,
            isKey: !this._tmpKeyFrames.size || this._tmpKeyFrames.has(sampleIdx + 1)
          });
          off += sz;
          sampleIdx++;
        }
      }
      this._ctx.track.samples = samples;
      const existing = this.tracks.findIndex((t) => t.id === this._ctx.track.id);
      if (existing >= 0)
        this.tracks[existing] = this._ctx.track;
      else
        this.tracks.push(this._ctx.track);
      this._tmpStts = [];
      this._tmpCtts = [];
      this._tmpSizes = [];
      this._tmpChunkMap = [];
      this._tmpChunkOffsets = [];
    }
    async decode(track, raw) {
      const results = [];
      if (track.type !== "video")
        return results;
      const init = {
        codec: this._mapCodec(track),
        codedWidth: track.width ?? 0,
        codedHeight: track.height ?? 0,
        description: track.extradata
      };
      const dec = new VideoDecoder({
        output: (f) => results.push(f),
        error: (e) => log.error("[MP4Demuxer] Decode error", e)
      });
      try {
        dec.configure(init);
        const src = new Uint8Array(raw);
        for (const s of track.samples) {
          if (s.offset + s.size > src.length)
            continue;
          const chunk = new EncodedVideoChunk({
            type: s.isKey ? "key" : "delta",
            timestamp: Math.round(s.pts / track.timescale * 1e6),
            duration: Math.round(s.duration / track.timescale * 1e6),
            data: src.subarray(s.offset, s.offset + s.size)
          });
          dec.decode(chunk);
        }
        await dec.flush();
      } catch (e) {
        log.warn("[MP4Demuxer] Decode failed \u2014 closing partial results", e);
        for (const f of results) {
          try {
            f.close();
          } catch (_) {
          }
        }
        results.length = 0;
      } finally {
        try {
          dec.close();
        } catch (_) {
        }
      }
      return results;
    }
    _mapCodec(track) {
      const c = track.codec;
      const ed = track.extradata;
      if (c === "avc1" && ed && ed.length >= 4) {
        const profile = ed[1], compat = ed[2], level = ed[3];
        return `avc1.${profile.toString(16).padStart(2, "0")}${compat.toString(16).padStart(2, "0")}${level.toString(16).padStart(2, "0")}`;
      }
      if ((c === "hev1" || c === "hvc1") && ed && ed.length >= 4) {
        const generalProfileSpace = ed[1] >> 6 & 3;
        const generalTierFlag = ed[1] >> 5 & 1;
        const generalProfileIdc = ed[1] & 31;
        const generalLevelIdc = ed.length >= 13 ? ed[12] : 93;
        const spaceChar = ["", "A", "B", "C"][generalProfileSpace];
        return `${c}.${spaceChar}${generalProfileIdc}.${generalTierFlag ? "H" : "L"}${generalLevelIdc}`;
      }
      if (c === "av01" && ed && ed.length >= 4) {
        const seqProfile = ed[1] >> 5 & 7;
        const seqLevelIdx = ed[1] & 31;
        const highBitdepth = ed[2] >> 6 & 1;
        const bitDepth = seqProfile === 2 && highBitdepth ? ed[2] >> 5 & 1 ? 12 : 10 : highBitdepth ? 10 : 8;
        return `av01.${seqProfile}.${String(seqLevelIdx).padStart(2, "0")}M.${String(bitDepth).padStart(2, "0")}`;
      }
      if (c === "vp09" && ed && ed.length >= 4) {
        return `vp09.${String(ed[0]).padStart(2, "0")}.${String(ed[1]).padStart(2, "0")}.${String(ed[2]).padStart(2, "0")}`;
      }
      if (c === "avc1")
        return "avc1.42E01E";
      if (c === "hev1" || c === "hvc1")
        return "hev1.1.6.L93.B0";
      if (c === "av01")
        return "av01.0.08M.08";
      if (c === "vp09")
        return "vp09.00.10.08";
      return c;
    }
    _fourcc(pos) {
      return String.fromCharCode(
        this.buf.getUint8(pos),
        this.buf.getUint8(pos + 1),
        this.buf.getUint8(pos + 2),
        this.buf.getUint8(pos + 3)
      );
    }
    _source = null;
    static async fromBlob(blob) {
      const PROBE_SIZE = 64 * 1024;
      const headerBuf = await blob.slice(0, Math.min(PROBE_SIZE, blob.size)).arrayBuffer();
      const headerView = new DataView(headerBuf);
      let moovOffset = -1;
      let moovSize = 0;
      let pos = 0;
      while (pos < headerBuf.byteLength - 8) {
        let size = headerView.getUint32(pos);
        const type = String.fromCharCode(
          headerView.getUint8(pos + 4),
          headerView.getUint8(pos + 5),
          headerView.getUint8(pos + 6),
          headerView.getUint8(pos + 7)
        );
        if (size === 1 && pos + 16 <= headerBuf.byteLength) {
          size = Number(headerView.getBigUint64(pos + 8));
        } else if (size === 0) {
          size = blob.size - pos;
        }
        if (size < 8)
          break;
        if (type === "moov") {
          moovOffset = pos;
          moovSize = size;
          break;
        }
        pos += size;
        if (pos > headerBuf.byteLength)
          break;
      }
      if (moovOffset < 0 && blob.size > PROBE_SIZE) {
        const tailSize = Math.min(blob.size, 4 * 1024 * 1024);
        const tailStart = blob.size - tailSize;
        const tailBuf = await blob.slice(tailStart, blob.size).arrayBuffer();
        const tailView = new DataView(tailBuf);
        pos = 0;
        while (pos < tailBuf.byteLength - 8) {
          let size = tailView.getUint32(pos);
          const type = String.fromCharCode(
            tailView.getUint8(pos + 4),
            tailView.getUint8(pos + 5),
            tailView.getUint8(pos + 6),
            tailView.getUint8(pos + 7)
          );
          if (size === 1 && pos + 16 <= tailBuf.byteLength) {
            size = Number(tailView.getBigUint64(pos + 8));
          } else if (size === 0) {
            size = tailBuf.byteLength - pos;
          }
          if (size < 8)
            break;
          if (type === "moov") {
            moovOffset = tailStart + pos;
            moovSize = size;
            break;
          }
          pos += size;
        }
      }
      if (moovOffset < 0) {
        log.warn("[MP4Demuxer] moov box not found \u2014 falling back to full load");
        const full = await blob.arrayBuffer();
        const demuxer2 = new _MP4Demuxer(full);
        demuxer2._source = blob;
        demuxer2.parse();
        return demuxer2;
      }
      const moovBuf = await blob.slice(moovOffset, moovOffset + moovSize).arrayBuffer();
      const demuxer = new _MP4Demuxer(moovBuf);
      demuxer._source = blob;
      demuxer.parse();
      log.info(`[MP4Demuxer] Streaming: parsed ${(moovSize / 1024).toFixed(0)}KB moov from ${(blob.size / (1024 * 1024)).toFixed(1)}MB file`);
      return demuxer;
    }
    async readSample(sample) {
      if (!this._source)
        throw new Error("[MP4Demuxer] No source \u2014 use fromBlob() for streaming mode");
      const buf = await this._source.slice(sample.offset, sample.offset + sample.size).arrayBuffer();
      return new Uint8Array(buf);
    }
    async readSamples(samples) {
      if (!this._source)
        throw new Error("[MP4Demuxer] No source \u2014 use fromBlob() for streaming mode");
      const results = [];
      let batchStart = samples[0]?.offset ?? 0;
      let batchEnd = batchStart;
      for (const s of samples)
        batchEnd = Math.max(batchEnd, s.offset + s.size);
      const batchSize = batchEnd - batchStart;
      if (batchSize < 16 * 1024 * 1024) {
        const buf = await this._source.slice(batchStart, batchEnd).arrayBuffer();
        const view = new Uint8Array(buf);
        for (const s of samples) {
          results.push(view.slice(s.offset - batchStart, s.offset - batchStart + s.size));
        }
      } else {
        for (const s of samples) {
          results.push(await this.readSample(s));
        }
      }
      return results;
    }
  };

  // src/demux/mkv.ts
  init_core();
  var EBML_ID_EBML = 440786851;
  var EBML_ID_SEGMENT = 408125543;
  var EBML_ID_INFO = 357149030;
  var EBML_ID_TIMECODE_SCALE = 2807729;
  var EBML_ID_DURATION = 17545;
  var EBML_ID_TRACKS = 374648427;
  var EBML_ID_TRACK_ENTRY = 174;
  var EBML_ID_TRACK_NUMBER = 215;
  var EBML_ID_TRACK_UID = 29637;
  var EBML_ID_TRACK_TYPE = 131;
  var EBML_ID_CODEC_ID = 134;
  var EBML_ID_CODEC_PRIVATE = 25506;
  var EBML_ID_VIDEO = 224;
  var EBML_ID_PIXEL_WIDTH = 176;
  var EBML_ID_PIXEL_HEIGHT = 186;
  var EBML_ID_AUDIO = 225;
  var EBML_ID_SAMPLE_RATE = 181;
  var EBML_ID_CHANNELS = 159;
  var EBML_ID_BIT_DEPTH = 25188;
  var EBML_ID_DEFAULT_DURATION = 2352003;
  var EBML_ID_LANGUAGE = 2274716;
  var EBML_ID_CLUSTER = 524531317;
  var EBML_ID_CLUSTER_TIMECODE = 231;
  var EBML_ID_SIMPLE_BLOCK = 163;
  var EBML_ID_BLOCK_GROUP = 160;
  var EBML_ID_BLOCK = 161;
  var EBML_ID_BLOCK_DURATION = 155;
  var EBML_ID_CUES = 475249515;
  var EBML_ID_SEEK_HEAD = 290298740;
  var EBML_ID_CHAPTERS = 272869232;
  var EBML_ID_TAGS = 307544935;
  var EBML_ID_ATTACHMENTS = 423732329;
  var CONTAINER_IDS = /* @__PURE__ */ new Set([
    EBML_ID_EBML,
    EBML_ID_SEGMENT,
    EBML_ID_INFO,
    EBML_ID_TRACKS,
    EBML_ID_TRACK_ENTRY,
    EBML_ID_VIDEO,
    EBML_ID_AUDIO,
    EBML_ID_CLUSTER,
    EBML_ID_BLOCK_GROUP,
    EBML_ID_SEEK_HEAD,
    EBML_ID_CUES,
    EBML_ID_CHAPTERS,
    EBML_ID_TAGS,
    EBML_ID_ATTACHMENTS
  ]);
  var MKVDemuxer = class _MKVDemuxer {
    buf;
    pos = 0;
    tracks = /* @__PURE__ */ new Map();
    frames = [];
    timecodeScale = 1e6;
    duration = 0;
    clusterPts = 0;
    constructor(buffer) {
      this.buf = new Uint8Array(buffer);
    }
    parse() {
      this.pos = 0;
      try {
        while (this.pos < this.buf.length - 4) {
          this._parseTopLevel();
        }
      } catch (e) {
        log.warn("[MKVDemuxer] Parse error (possibly truncated file):", e);
      }
    }
    *iterateClusters() {
      this.pos = 0;
      try {
        while (this.pos < this.buf.length - 4) {
          const prevCount = this.frames.length;
          this._parseTopLevel();
          if (this.frames.length > prevCount) {
            yield this.frames.splice(prevCount);
          }
        }
      } catch (e) {
        log.warn("[MKVDemuxer] Parse error during iteration:", e);
      }
    }
    _parseTopLevel() {
      const startPos = this.pos;
      const [id, idLen] = this._readElementId();
      if (idLen <= 0) {
        this.pos = this.buf.length;
        return;
      }
      const [size, szLen, isUnknown] = this._readVint();
      if (szLen <= 0 || size < 0) {
        this.pos = this.buf.length;
        return;
      }
      const dataStart = this.pos;
      const dataEnd = isUnknown ? this.buf.length : Math.min(dataStart + size, this.buf.length);
      if (CONTAINER_IDS.has(id)) {
        this._parseContainer(id, dataStart, dataEnd);
      } else {
        this._handleLeaf(id, dataStart, dataEnd);
        this.pos = dataEnd;
      }
    }
    _parseContainer(id, start, end) {
      if (id === EBML_ID_CLUSTER) {
        this._parseCluster(start, end);
        return;
      }
      this.pos = start;
      while (this.pos < end - 2) {
        const [childId, childIdLen] = this._readElementId();
        if (childIdLen <= 0)
          break;
        const [childSize, childSzLen, childUnknown] = this._readVint();
        if (childSzLen <= 0 || childSize < 0)
          break;
        const childStart = this.pos;
        const childEnd = childUnknown ? end : Math.min(childStart + childSize, end);
        if (CONTAINER_IDS.has(childId)) {
          this._parseContainer(childId, childStart, childEnd);
        } else {
          this._handleLeaf(childId, childStart, childEnd);
        }
        this.pos = childEnd;
      }
      if (id === EBML_ID_TRACK_ENTRY)
        this.finalizeTrack();
      this.pos = end;
    }
    _currentTrack = {};
    _handleLeaf(id, start, end) {
      const size = end - start;
      switch (id) {
        case EBML_ID_TIMECODE_SCALE:
          this.timecodeScale = this._readUintData(start, size);
          break;
        case EBML_ID_DURATION:
          this.duration = size === 4 ? new DataView(this.buf.buffer, this.buf.byteOffset + start, 4).getFloat32(0) : size === 8 ? new DataView(this.buf.buffer, this.buf.byteOffset + start, 8).getFloat64(0) : this._readUintData(start, size);
          break;
        case EBML_ID_TRACK_NUMBER:
          this._currentTrack.number = this._readUintData(start, size);
          break;
        case EBML_ID_TRACK_UID:
          this._currentTrack.uid = this._readUintData(start, size);
          break;
        case EBML_ID_TRACK_TYPE: {
          const t = this._readUintData(start, size);
          this._currentTrack.type = t === 1 ? "video" : t === 2 ? "audio" : t === 17 ? "subtitle" : "other";
          break;
        }
        case EBML_ID_CODEC_ID:
          this._currentTrack.codecId = new TextDecoder().decode(this.buf.subarray(start, end));
          break;
        case EBML_ID_CODEC_PRIVATE:
          this._currentTrack.codecPrivate = this.buf.subarray(start, end);
          break;
        case EBML_ID_PIXEL_WIDTH:
          this._currentTrack.width = this._readUintData(start, size);
          break;
        case EBML_ID_PIXEL_HEIGHT:
          this._currentTrack.height = this._readUintData(start, size);
          break;
        case EBML_ID_SAMPLE_RATE:
          this._currentTrack.sampleRate = size === 4 ? new DataView(this.buf.buffer, this.buf.byteOffset + start, 4).getFloat32(0) : new DataView(this.buf.buffer, this.buf.byteOffset + start, 8).getFloat64(0);
          break;
        case EBML_ID_CHANNELS:
          this._currentTrack.channels = this._readUintData(start, size);
          break;
        case EBML_ID_BIT_DEPTH:
          this._currentTrack.bitDepth = this._readUintData(start, size);
          break;
        case EBML_ID_DEFAULT_DURATION:
          this._currentTrack.defaultDuration = this._readUintData(start, size);
          break;
        case EBML_ID_LANGUAGE:
          this._currentTrack.language = new TextDecoder().decode(this.buf.subarray(start, end));
          break;
      }
    }
    _parseCluster(start, end) {
      this.pos = start;
      while (this.pos < end - 2) {
        const [id, idLen] = this._readElementId();
        if (idLen <= 0)
          break;
        const [size, szLen, _unknown] = this._readVint();
        if (szLen <= 0 || size < 0)
          break;
        const dStart = this.pos;
        const dEnd = Math.min(dStart + size, end);
        switch (id) {
          case EBML_ID_CLUSTER_TIMECODE:
            this.clusterPts = this._readUintData(dStart, size);
            break;
          case EBML_ID_SIMPLE_BLOCK:
            this._parseBlock(dStart, dEnd, true);
            break;
          case EBML_ID_BLOCK_GROUP:
            this._parseBlockGroup(dStart, dEnd);
            break;
        }
        this.pos = dEnd;
      }
    }
    _parseBlockGroup(start, end) {
      this.pos = start;
      let blockStart = -1, blockEnd = -1, blockDuration = 0;
      while (this.pos < end - 2) {
        const [id, idLen] = this._readElementId();
        if (idLen <= 0)
          break;
        const [size, szLen, _unk2] = this._readVint();
        if (szLen <= 0)
          break;
        const dStart = this.pos;
        const dEnd = Math.min(dStart + size, end);
        if (id === EBML_ID_BLOCK) {
          blockStart = dStart;
          blockEnd = dEnd;
        } else if (id === EBML_ID_BLOCK_DURATION)
          blockDuration = this._readUintData(dStart, size);
        this.pos = dEnd;
      }
      if (blockStart >= 0)
        this._parseBlock(blockStart, blockEnd, false, blockDuration);
    }
    _parseBlock(start, end, isSimple, forceDuration = 0) {
      if (start >= end - 3)
        return;
      this.pos = start;
      const [trackNum, tLen] = this._readVintAt(start, false);
      if (tLen <= 0 || this.pos + 2 >= end)
        return;
      const relTs = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 2).getInt16(0);
      this.pos += 2;
      const flags = this.buf[this.pos++];
      const isKey = isSimple ? (flags & 128) !== 0 : false;
      const discardable = (flags & 1) !== 0;
      const lacing = flags >> 1 & 3;
      const dataStart = this.pos;
      if (dataStart >= end)
        return;
      const pts = (this.clusterPts + relTs) * this.timecodeScale / 1e9;
      const track = this.tracks.get(trackNum);
      const defaultDur = track?.defaultDuration ? track.defaultDuration / 1e6 : forceDuration > 0 ? forceDuration * this.timecodeScale / 1e6 : 0;
      if (lacing === 0) {
        this.frames.push({
          trackNumber: trackNum,
          pts,
          duration: defaultDur,
          isKey,
          data: this.buf.subarray(dataStart, end),
          discardable
        });
      } else {
        this._parseLacedFrames(dataStart, end, lacing, trackNum, pts, defaultDur, isKey, discardable);
      }
    }
    _parseLacedFrames(start, end, lacing, track, pts, dur, isKey, disc) {
      if (start >= end)
        return;
      const frameCount = this.buf[start] + 1;
      let pos = start + 1;
      const sizes = [];
      if (lacing === 1) {
        for (let i = 0; i < frameCount - 1 && pos < end; i++) {
          let sz = 0;
          while (pos < end && this.buf[pos] === 255) {
            sz += 255;
            pos++;
          }
          if (pos < end) {
            sz += this.buf[pos++];
          }
          sizes.push(sz);
        }
      } else if (lacing === 2) {
        const total = end - pos;
        const each = Math.floor(total / frameCount);
        for (let i = 0; i < frameCount - 1; i++)
          sizes.push(each);
      } else if (lacing === 3) {
        if (frameCount > 1) {
          const [first, fLen] = this._readVintAt(pos, false);
          pos += fLen;
          sizes.push(first);
          for (let i = 1; i < frameCount - 1; i++) {
            const [delta, dLen] = this._readSignedVintAt(pos);
            if (dLen <= 0)
              break;
            pos += dLen;
            sizes.push(sizes[i - 1] + delta);
          }
        }
      }
      let lastSize = end - pos;
      for (const s of sizes)
        lastSize -= s;
      sizes.push(Math.max(0, lastSize));
      const frameDur = dur > 0 ? dur / frameCount : 0;
      for (let i = 0; i < sizes.length && pos < end; i++) {
        const sz = Math.min(sizes[i], end - pos);
        if (sz > 0) {
          this.frames.push({
            trackNumber: track,
            pts: pts + i * frameDur,
            duration: frameDur,
            isKey: i === 0 && isKey,
            data: this.buf.subarray(pos, pos + sz),
            discardable: disc
          });
        }
        pos += sz;
      }
    }
    finalizeTrack() {
      if (this._currentTrack.number != null) {
        this.tracks.set(this._currentTrack.number, this._currentTrack);
      }
      this._currentTrack = {};
    }
    _readElementId() {
      if (this.pos >= this.buf.length)
        return [0, -1];
      const b = this.buf[this.pos];
      if (b === 0)
        return [0, -1];
      let len = 1;
      if (b & 128)
        len = 1;
      else if (b & 64)
        len = 2;
      else if (b & 32)
        len = 3;
      else if (b & 16)
        len = 4;
      else
        return [0, -1];
      if (this.pos + len > this.buf.length)
        return [0, -1];
      let val = 0;
      for (let i = 0; i < len; i++)
        val = val << 8 | this.buf[this.pos + i];
      this.pos += len;
      return [val, len];
    }
    _readVint() {
      return this._readVintAt(this.pos, true);
    }
    _readVintAt(pos, advance = false) {
      if (pos >= this.buf.length)
        return [0, -1, false];
      const b = this.buf[pos];
      if (b === 0)
        return [0, -1, false];
      let mask = 128, len = 1;
      while (len <= 8 && !(b & mask)) {
        mask >>= 1;
        len++;
      }
      if (len > 8 || pos + len > this.buf.length)
        return [0, -1, false];
      let val = b & mask - 1;
      for (let i = 1; i < len; i++)
        val = val * 256 + this.buf[pos + i];
      let isUnknown = true;
      const maxVal = (1 << 7 * len) - 1;
      if (val !== maxVal)
        isUnknown = false;
      if (advance)
        this.pos = pos + len;
      return [isUnknown ? -1 : val, len, isUnknown];
    }
    _readSignedVintAt(pos) {
      const [raw, len] = this._readVintAt(pos);
      if (len <= 0)
        return [0, len];
      const bias = Math.pow(2, 7 * len - 1) - 1;
      return [raw - bias, len];
    }
    _readUintData(pos, size) {
      let v = 0;
      for (let i = 0; i < size && pos + i < this.buf.length; i++)
        v = v * 256 + this.buf[pos + i];
      return v;
    }
    getVideoTracks() {
      return [...this.tracks.values()].filter((t) => t.type === "video");
    }
    getAudioTracks() {
      return [...this.tracks.values()].filter((t) => t.type === "audio");
    }
    getFramesForTrack(trackNumber) {
      return this.frames.filter((f) => f.trackNumber === trackNumber);
    }
    _clusterOffsets = [];
    _source = null;
    static async fromBlob(blob) {
      const HEADER_PROBE = 256 * 1024;
      const probeBuf = await blob.slice(0, Math.min(HEADER_PROBE, blob.size)).arrayBuffer();
      const demuxer = new _MKVDemuxer(probeBuf);
      demuxer._source = blob;
      demuxer.pos = 0;
      try {
        while (demuxer.pos < demuxer.buf.length - 4) {
          const elementStart = demuxer.pos;
          const [id, idLen] = demuxer._readElementId();
          if (idLen <= 0)
            break;
          const [size, szLen, isUnknown] = demuxer._readVint();
          if (szLen <= 0 || size < 0)
            break;
          const dataStart = demuxer.pos;
          if (id === EBML_ID_CLUSTER) {
            const clusterSize = isUnknown ? blob.size - elementStart : dataStart - elementStart + size;
            demuxer._clusterOffsets.push({ offset: elementStart, size: clusterSize });
            demuxer.pos = isUnknown ? demuxer.buf.length : Math.min(dataStart + size, demuxer.buf.length);
            while (demuxer.pos < demuxer.buf.length - 4) {
              const cStart = demuxer.pos;
              const [cId, cIdLen] = demuxer._readElementId();
              if (cIdLen <= 0)
                break;
              const [cSize, cSzLen, cUnk] = demuxer._readVint();
              if (cSzLen <= 0)
                break;
              if (cId === EBML_ID_CLUSTER) {
                const cFullSize = cUnk ? blob.size - cStart : demuxer.pos - cStart + cSize;
                demuxer._clusterOffsets.push({ offset: cStart, size: cFullSize });
              }
              demuxer.pos = cUnk ? demuxer.buf.length : Math.min(demuxer.pos + cSize, demuxer.buf.length);
            }
            break;
          } else if (CONTAINER_IDS.has(id) && id !== EBML_ID_CLUSTER) {
            demuxer._parseContainer(id, dataStart, isUnknown ? demuxer.buf.length : Math.min(dataStart + size, demuxer.buf.length));
          } else {
            demuxer.pos = isUnknown ? demuxer.buf.length : Math.min(dataStart + size, demuxer.buf.length);
          }
        }
      } catch (e) {
        log.warn("[MKVDemuxer] Header parse error:", e);
      }
      if (demuxer._clusterOffsets.length === 0 && blob.size > HEADER_PROBE) {
        log.warn("[MKVDemuxer] No clusters found in probe \u2014 need full scan");
        const fullBuf = await blob.arrayBuffer();
        const full = new _MKVDemuxer(fullBuf);
        full._source = blob;
        full.parse();
        return full;
      }
      log.info(`[MKVDemuxer] Streaming: ${demuxer.tracks.size} tracks, ${demuxer._clusterOffsets.length} clusters from ${(blob.size / (1024 * 1024)).toFixed(1)}MB file`);
      return demuxer;
    }
    async *iterateClustersFromBlob() {
      if (!this._source)
        throw new Error("[MKVDemuxer] No source \u2014 use fromBlob() for streaming mode");
      for (const entry of this._clusterOffsets) {
        const clusterBuf = await this._source.slice(entry.offset, entry.offset + entry.size).arrayBuffer();
        const clusterParser = new _MKVDemuxer(clusterBuf);
        clusterParser.tracks = this.tracks;
        clusterParser.timecodeScale = this.timecodeScale;
        clusterParser.pos = 0;
        try {
          clusterParser._parseTopLevel();
        } catch (e) {
          log.warn("[MKVDemuxer] Cluster parse error:", e);
        }
        if (clusterParser.frames.length > 0) {
          yield clusterParser.frames;
        }
      }
      if (this._source.size > 256 * 1024 && this._clusterOffsets.length > 0) {
        const lastCluster = this._clusterOffsets[this._clusterOffsets.length - 1];
        const scannedEnd = lastCluster.offset + lastCluster.size;
        if (scannedEnd < this._source.size - 1024) {
          const remainBuf = await this._source.slice(scannedEnd, this._source.size).arrayBuffer();
          const remain = new _MKVDemuxer(remainBuf);
          remain.tracks = this.tracks;
          remain.timecodeScale = this.timecodeScale;
          for (const frames of remain.iterateClusters()) {
            yield frames;
          }
        }
      }
    }
  };

  // src/demux/webm.ts
  var WebMDemuxer = class extends MKVDemuxer {
    constructor(buffer) {
      super(buffer);
    }
  };

  // src/demux/avi.ts
  init_core();
  var AVIDemuxer = class {
    buf;
    raw;
    tracks = [];
    _streams = [];
    _moviStart = -1;
    constructor(buffer) {
      this.raw = new Uint8Array(buffer);
      this.buf = new DataView(buffer);
    }
    parse() {
      try {
        const sig = this._fourcc(0);
        if (sig !== "RIFF")
          return;
        const fileSize = this.buf.getUint32(4, true);
        const fileType = this._fourcc(8);
        if (fileType !== "AVI ")
          return;
        this._parseList(12, Math.min(fileSize + 8, this.buf.byteLength));
      } catch (e) {
        log.warn("[AVIDemuxer] Parse error (possibly truncated file):", e);
      }
    }
    _parseList(start, end) {
      let pos = start;
      while (pos < end - 8) {
        const id = this._fourcc(pos);
        const size = this.buf.getUint32(pos + 4, true);
        if (size === 0 || pos + 8 + size > end)
          break;
        if (id === "LIST" || id === "RIFF") {
          const listType = this._fourcc(pos + 8);
          if (listType === "hdrl" || listType === "strl" || listType === "movi" || listType === "odml") {
            if (listType === "strl")
              this._streams.push({ samples: [], type: "video" });
            if (listType === "movi")
              this._moviStart = pos + 12;
            this._parseList(pos + 12, pos + 8 + size);
          }
        } else {
          this._handleChunk(id, pos + 8, size);
        }
        pos += 8 + size + (size & 1);
      }
    }
    _handleChunk(id, offset, size) {
      const cur = this._streams.length > 0 ? this._streams[this._streams.length - 1] : null;
      switch (id) {
        case "avih":
          break;
        case "strh": {
          if (!cur)
            break;
          const fccType = this._fourcc(offset);
          cur.type = fccType === "vids" ? "video" : "audio";
          cur.codec = this._fourcc(offset + 4);
          cur.scale = this.buf.getUint32(offset + 20, true);
          cur.rate = this.buf.getUint32(offset + 24, true);
          break;
        }
        case "strf": {
          if (!cur)
            break;
          if (cur.type === "video") {
            cur.width = this.buf.getUint32(offset + 4, true);
            cur.height = Math.abs(this.buf.getInt32(offset + 8, true));
            if (size > 40)
              cur.extradata = this.raw.subarray(offset + 40, offset + size);
          } else if (cur.type === "audio") {
            cur.channelCount = this.buf.getUint16(offset + 2, true);
            cur.sampleRate = this.buf.getUint32(offset + 4, true);
            cur.bitsPerSample = this.buf.getUint16(offset + 14, true);
            if (size > 18)
              cur.extradata = this.raw.subarray(offset + 18, offset + size);
          }
          break;
        }
        case "idx1": {
          this._parseIdx1(offset, size);
          break;
        }
        case "indx": {
          this._parseSuperIndex(offset, size);
          break;
        }
      }
    }
    _parseIdx1(offset, size) {
      const entryCount = size / 16;
      const streamSamples = /* @__PURE__ */ new Map();
      const moviOffset = this._moviStart >= 0 ? this._moviStart : 0;
      let useAbsolute = false;
      if (entryCount > 0 && moviOffset > 0) {
        const firstOffset = this.buf.getUint32(offset + 8, true);
        if (firstOffset >= moviOffset) {
          useAbsolute = true;
        }
      }
      for (let i = 0; i < entryCount; i++) {
        const pos = offset + i * 16;
        if (pos + 16 > this.buf.byteLength)
          break;
        const chunkId = this._fourcc(pos);
        const streamIdx = parseInt(chunkId.substring(0, 2), 10);
        if (isNaN(streamIdx))
          continue;
        const flags = this.buf.getUint32(pos + 4, true);
        const chunkOffset = this.buf.getUint32(pos + 8, true);
        const chunkSize = this.buf.getUint32(pos + 12, true);
        const isKey = (flags & 16) !== 0;
        if (!streamSamples.has(streamIdx))
          streamSamples.set(streamIdx, []);
        const list = streamSamples.get(streamIdx);
        const stream = this._streams[streamIdx];
        const rate = stream?.rate || 1;
        const scale = stream?.scale || 1;
        const pts = list.length * scale / rate;
        const sampleOffset = useAbsolute ? chunkOffset + 8 : moviOffset + chunkOffset + 8;
        list.push({
          offset: sampleOffset,
          size: chunkSize,
          isKey,
          pts,
          duration: scale / rate
        });
      }
      for (const [idx, samples] of streamSamples) {
        if (idx < this._streams.length) {
          const s = this._streams[idx];
          s.samples = samples;
          s.id = idx;
          this.tracks.push(s);
        }
      }
    }
    _parseSuperIndex(offset, size) {
      if (offset + 24 > this.buf.byteLength)
        return;
      const longsPerEntry = this.buf.getUint16(offset, true);
      const indexSubType = this.buf.getUint8(offset + 2);
      const indexType = this.buf.getUint8(offset + 3);
      const entriesInUse = this.buf.getUint32(offset + 4, true);
      const chunkId = this._fourcc(offset + 8);
      const streamIdx = parseInt(chunkId.substring(0, 2), 10);
      if (isNaN(streamIdx) || indexType !== 0)
        return;
      const allSamples = [];
      const stream = streamIdx < this._streams.length ? this._streams[streamIdx] : null;
      const rate = stream?.rate || 1;
      const scale = stream?.scale || 1;
      for (let i = 0; i < entriesInUse; i++) {
        const entryPos = offset + 24 + i * (longsPerEntry > 0 ? longsPerEntry * 4 : 16);
        if (entryPos + 16 > this.buf.byteLength)
          break;
        const qwOffset = Number(this.buf.getBigUint64(entryPos, true));
        const dwSize = this.buf.getUint32(entryPos + 8, true);
        const dwDuration = this.buf.getUint32(entryPos + 12, true);
        if (qwOffset === 0 || dwSize === 0)
          continue;
        if (qwOffset + 32 > this.buf.byteLength)
          continue;
        this._parseStandardIndex(qwOffset, dwSize, streamIdx, allSamples, rate, scale);
      }
      if (allSamples.length > 0 && stream) {
        stream.samples = allSamples;
        stream.id = streamIdx;
        const existing = this.tracks.findIndex((t) => t.id === streamIdx);
        if (existing >= 0)
          this.tracks[existing] = stream;
        else
          this.tracks.push(stream);
      }
    }
    _parseStandardIndex(offset, size, streamIdx, allSamples, rate, scale) {
      if (offset + 24 > this.buf.byteLength)
        return;
      const entriesInUse = this.buf.getUint32(offset + 4, true);
      const qwBaseOffset = Number(this.buf.getBigUint64(offset + 12, true));
      for (let i = 0; i < entriesInUse; i++) {
        const entryPos = offset + 24 + i * 8;
        if (entryPos + 8 > this.buf.byteLength)
          break;
        const dwOffset = this.buf.getUint32(entryPos, true);
        let dwSizeRaw = this.buf.getUint32(entryPos + 4, true);
        const isKey = (dwSizeRaw & 2147483648) === 0;
        dwSizeRaw = dwSizeRaw & 2147483647;
        const pts = allSamples.length * scale / rate;
        allSamples.push({
          offset: qwBaseOffset + dwOffset,
          size: dwSizeRaw,
          isKey,
          pts,
          duration: scale / rate
        });
      }
    }
    getSampleData(sample) {
      return this.raw.subarray(sample.offset, sample.offset + sample.size);
    }
    _fourcc(pos) {
      if (pos + 4 > this.buf.byteLength)
        return "\0\0\0\0";
      return String.fromCharCode(
        this.buf.getUint8(pos),
        this.buf.getUint8(pos + 1),
        this.buf.getUint8(pos + 2),
        this.buf.getUint8(pos + 3)
      );
    }
  };

  // src/demux/flv.ts
  init_core();
  var FLVDemuxer = class {
    buf;
    view;
    meta = {};
    videoTags = [];
    audioTags = [];
    videoExtradata = null;
    audioExtradata = null;
    constructor(buffer) {
      this.buf = new Uint8Array(buffer);
      this.view = new DataView(buffer);
    }
    parse() {
      try {
        if (this.buf[0] !== 70 || this.buf[1] !== 76 || this.buf[2] !== 86)
          return;
        const headerSize = this.view.getUint32(5);
        let pos = headerSize;
        while (pos < this.buf.length - 15) {
          pos += 4;
          if (pos >= this.buf.length - 11)
            break;
          const tagType = this.buf[pos];
          const dataSize = this.buf[pos + 1] << 16 | this.buf[pos + 2] << 8 | this.buf[pos + 3];
          const ts = (this.buf[pos + 7] << 24 | this.buf[pos + 4] << 16 | this.buf[pos + 5] << 8 | this.buf[pos + 6]) >>> 0;
          const dataStart = pos + 11;
          if (dataStart + dataSize > this.buf.length)
            break;
          const tagData = this.buf.subarray(dataStart, dataStart + dataSize);
          if (tagType === 8) {
            this._parseAudioTag(tagData, ts);
          } else if (tagType === 9) {
            this._parseVideoTag(tagData, ts);
          } else if (tagType === 18) {
            this._parseScriptTag(tagData);
          }
          pos = dataStart + dataSize;
        }
      } catch (e) {
        log.warn("[FLVDemuxer] Parse error (possibly truncated file):", e);
      }
    }
    _parseVideoTag(data, dts) {
      if (data.length < 2)
        return;
      const firstByte = data[0];
      const isExHeader = (firstByte & 128) !== 0;
      if (isExHeader) {
        const packetType = firstByte & 15;
        const frameType2 = firstByte >> 4 & 7;
        const isKey2 = frameType2 === 1;
        if (data.length < 5)
          return;
        const fourcc = String.fromCharCode(data[1], data[2], data[3], data[4]);
        let codecStr = "unknown";
        if (fourcc === "hvc1" || fourcc === "hev1")
          codecStr = "hevc";
        else if (fourcc === "av01")
          codecStr = "av1";
        else if (fourcc === "vp09")
          codecStr = "vp9";
        else if (fourcc === "avc1")
          codecStr = "avc";
        this.meta.videoCodecId = -1;
        if (packetType === 0) {
          this.videoExtradata = data.subarray(5);
          return;
        }
        if (packetType === 1) {
          let cts = 0;
          if (data.length >= 8) {
            cts = data[5] << 16 | data[6] << 8 | data[7];
            if (cts & 8388608)
              cts -= 16777216;
          }
          this.videoTags.push({
            type: "video",
            pts: dts + cts,
            dts,
            data: data.subarray(8),
            isKey: isKey2,
            codecId: -1
          });
        } else if (packetType === 3) {
          this.videoTags.push({
            type: "video",
            pts: dts,
            dts,
            data: data.subarray(5),
            isKey: isKey2,
            codecId: -1
          });
        }
        return;
      }
      const frameType = firstByte >> 4 & 15;
      const codecId = firstByte & 15;
      const isKey = frameType === 1;
      if (codecId === 7) {
        if (data.length < 5)
          return;
        const avcPacketType = data[1];
        const compositionOffset = data[2] << 16 | data[3] << 8 | data[4];
        const cts = compositionOffset & 8388608 ? compositionOffset - 16777216 : compositionOffset;
        if (avcPacketType === 0) {
          this.videoExtradata = data.subarray(5);
          return;
        }
        this.videoTags.push({
          type: "video",
          pts: dts + cts,
          dts,
          data: data.subarray(5),
          isKey,
          codecId
        });
      } else {
        this.videoTags.push({
          type: "video",
          pts: dts,
          dts,
          data: data.subarray(1),
          isKey,
          codecId
        });
      }
    }
    _parseAudioTag(data, dts) {
      if (data.length < 2)
        return;
      const codecId = data[0] >> 4 & 15;
      const sampleRateIdx = data[0] >> 2 & 3;
      const channels = (data[0] & 1) + 1;
      this.meta.audioCodecId = codecId;
      this.meta.audioChannels = channels;
      const rates = [5500, 11025, 22050, 44100];
      this.meta.audioSampleRate = rates[sampleRateIdx] || 44100;
      if (codecId === 10) {
        if (data[1] === 0) {
          this.audioExtradata = data.subarray(2);
          return;
        }
        this.audioTags.push({
          type: "audio",
          pts: dts,
          dts,
          data: data.subarray(2),
          isKey: true,
          codecId
        });
      } else {
        this.audioTags.push({
          type: "audio",
          pts: dts,
          dts,
          data: data.subarray(1),
          isKey: true,
          codecId
        });
      }
    }
    _parseScriptTag(data) {
      let pos = 0;
      if (data[pos] !== 2)
        return;
      pos++;
      if (pos + 2 > data.length)
        return;
      const nameLen = data[pos] << 8 | data[pos + 1];
      pos += 2;
      if (pos + nameLen > data.length)
        return;
      const name = new TextDecoder().decode(data.subarray(pos, pos + nameLen));
      pos += nameLen;
      if (name !== "onMetaData")
        return;
      if (data[pos] === 8) {
        pos++;
        const count = data[pos] << 24 | data[pos + 1] << 16 | data[pos + 2] << 8 | data[pos + 3];
        pos += 4;
        for (let i = 0; i < count && pos < data.length - 3; i++) {
          const keyLen = data[pos] << 8 | data[pos + 1];
          pos += 2;
          if (pos + keyLen > data.length)
            break;
          const key = new TextDecoder().decode(data.subarray(pos, pos + keyLen));
          pos += keyLen;
          const valType = data[pos++];
          if (valType === 0) {
            if (pos + 8 > data.length)
              break;
            const view = new DataView(data.buffer, data.byteOffset + pos, 8);
            const val = view.getFloat64(0);
            pos += 8;
            if (key === "duration")
              this.meta.duration = val;
            else if (key === "width")
              this.meta.width = val;
            else if (key === "height")
              this.meta.height = val;
            else if (key === "framerate")
              this.meta.framerate = val;
          } else if (valType === 1) {
            pos++;
          } else if (valType === 2) {
            const sLen = data[pos] << 8 | data[pos + 1];
            pos += 2 + sLen;
          } else {
            break;
          }
        }
      }
    }
  };

  // src/gpu/yuv.ts
  var YUV_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_y;
uniform sampler2D u_u;
uniform sampler2D u_v;
uniform vec2 u_chromaSize;
uniform float u_sigmaS;
uniform float u_sigmaR;
uniform int u_colorSpace;

vec3 bt601(float y, float cb, float cr) {
    return vec3(
        y + 1.402 * cr,
        y - 0.344136 * cb - 0.714136 * cr,
        y + 1.772 * cb
    );
}

vec3 bt709(float y, float cb, float cr) {
    return vec3(
        y + 1.5748 * cr,
        y - 0.1873 * cb - 0.4681 * cr,
        y + 1.8556 * cb
    );
}

float chromaBilateral(sampler2D tex, vec2 uv, vec2 texelSize, float refLuma, float sigS, float sigR) {
    float acc = 0.0;
    float wt = 0.0;
    float s2 = sigS * sigS * 2.0;
    float r2 = sigR * sigR * 2.0;
    int r = int(sigS * 2.0);
    for (int dy = -r; dy <= r; dy++) {
        for (int dx = -r; dx <= r; dx++) {
            vec2 off = vec2(float(dx), float(dy)) * texelSize;
            float sample_val = texture(tex, uv + off).r;
            float spatialW = exp(-float(dx * dx + dy * dy) / s2);
            float diff = sample_val - refLuma;
            float rangeW = exp(-(diff * diff) / r2);
            float w = spatialW * rangeW;
            acc += sample_val * w;
            wt += w;
        }
    }
    return acc / max(wt, 0.0001);
}

void main() {
    float y = texture(u_y, v_uv).r;
    float sigS = max(u_sigmaS, 0.5);
    float sigR = max(u_sigmaR, 0.01);
    vec2 chromaTexel = 1.0 / u_chromaSize;
    float cb = chromaBilateral(u_u, v_uv, chromaTexel, y, sigS, sigR) - 0.5;
    float cr = chromaBilateral(u_v, v_uv, chromaTexel, y, sigS, sigR) - 0.5;
    vec3 rgb;
    if (u_colorSpace == 1) {
        rgb = bt709(y, cb, cr);
    } else {
        rgb = bt601(y, cb, cr);
    }
    o = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;
  var ColorSpace = /* @__PURE__ */ ((ColorSpace2) => {
    ColorSpace2[ColorSpace2["BT601"] = 0] = "BT601";
    ColorSpace2[ColorSpace2["BT709"] = 1] = "BT709";
    return ColorSpace2;
  })(ColorSpace || {});
  var YUVConverter = class {
    _gl;
    _yTex = null;
    _uTex = null;
    _vTex = null;
    constructor(width, height) {
      this._gl = new GL(width, height);
      this._gl.loadFragmentShader(YUV_FRAG);
    }
    async convert(yPlane, uPlane, vPlane, width, height, chromaW, chromaH, colorSpace = 1 /* BT709 */, sigmaS = 1.5, sigmaR = 0.1) {
      const gl = this._gl.gl;
      this._yTex = this._uploadPlane(gl, this._yTex, yPlane, width, height, 0);
      this._uTex = this._uploadPlane(gl, this._uTex, uPlane, chromaW, chromaH, 1);
      this._vTex = this._uploadPlane(gl, this._vTex, vPlane, chromaW, chromaH, 2);
      this._gl.setUniform2f("u_chromaSize", chromaW, chromaH).setUniform1f("u_sigmaS", sigmaS).setUniform1f("u_sigmaR", sigmaR).setUniform1i("u_colorSpace", colorSpace).render();
      return this._gl.extract();
    }
    async extract() {
      return this._gl.extract();
    }
    _uploadPlane(gl, tex, data, w, h, unit) {
      if (!tex)
        tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const p = this._gl.program;
      if (p) {
        const names = ["u_y", "u_u", "u_v"];
        const loc = gl.getUniformLocation(p, names[unit]);
        if (loc)
          gl.uniform1i(loc, unit);
      }
      return tex;
    }
    dispose() {
      const gl = this._gl.gl;
      if (this._yTex)
        gl.deleteTexture(this._yTex);
      if (this._uTex)
        gl.deleteTexture(this._uTex);
      if (this._vTex)
        gl.deleteTexture(this._vTex);
    }
  };

  // src/timeline/magnetic.ts
  var MagneticTimeline = class {
    state;
    constructor(fps = 30, width = 1920, height = 1080) {
      this.state = {
        tracks: [],
        duration: 0,
        fps,
        width,
        height,
        sampleRate: 48e3,
        gridSnap: 1 / fps
      };
    }
    addTrack(type) {
      const id = "t_" + this.state.tracks.length + "_" + Date.now().toString(36);
      this.state.tracks.push({
        id,
        type,
        clips: [],
        locked: false,
        muted: false,
        solo: false,
        volume: 1,
        pan: 0
      });
      return id;
    }
    insertClip(trackIdx, clip, magnetic = true) {
      const track = this.state.tracks[trackIdx];
      if (!track || track.locked)
        return "";
      const id = "c_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
      const newClip = { ...clip, id };
      if (magnetic)
        this._rippleInsert(track, newClip);
      else
        track.clips.push(newClip);
      track.clips.sort((a, b) => a.inPoint - b.inPoint);
      this._updateDuration();
      return id;
    }
    removeClip(trackIdx, clipId, ripple = true) {
      const track = this.state.tracks[trackIdx];
      if (!track || track.locked)
        return;
      const idx = track.clips.findIndex((c) => c.id === clipId);
      if (idx < 0)
        return;
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
    moveClip(trackIdx, clipId, newInPoint, magnetic = true) {
      const track = this.state.tracks[trackIdx];
      if (!track || track.locked)
        return;
      const clip = track.clips.find((c) => c.id === clipId);
      if (!clip || clip.locked)
        return;
      const duration = clip.outPoint - clip.inPoint;
      const snapped = magnetic ? this._snapToGrid(newInPoint) : newInPoint;
      const delta = snapped - clip.inPoint;
      clip.inPoint = snapped;
      clip.outPoint = snapped + duration;
      this._moveConnected(clipId, delta);
      if (magnetic)
        this._resolveOverlaps(track);
      track.clips.sort((a, b) => a.inPoint - b.inPoint);
      this._updateDuration();
    }
    trimClip(trackIdx, clipId, edge, newTime, ripple = false) {
      const track = this.state.tracks[trackIdx];
      if (!track || track.locked)
        return;
      const clip = track.clips.find((c) => c.id === clipId);
      if (!clip || clip.locked)
        return;
      if (edge === "start") {
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
    splitClip(trackIdx, clipId, splitTime) {
      const track = this.state.tracks[trackIdx];
      if (!track)
        return ["", ""];
      const clip = track.clips.find((c) => c.id === clipId);
      if (!clip || splitTime <= clip.inPoint || splitTime >= clip.outPoint)
        return ["", ""];
      const splitSource = clip.sourceStart + (splitTime - clip.inPoint) * clip.speed;
      const rightId = "c_" + Date.now().toString(36) + "_r";
      const right = {
        ...clip,
        id: rightId,
        inPoint: splitTime,
        sourceStart: splitSource
      };
      clip.outPoint = splitTime;
      clip.sourceEnd = splitSource;
      track.clips.push(right);
      track.clips.sort((a, b) => a.inPoint - b.inPoint);
      return [clip.id, rightId];
    }
    connectClips(parentId, childId) {
      for (const track of this.state.tracks) {
        const child = track.clips.find((c) => c.id === childId);
        if (child) {
          child.connectedTo = parentId;
          return;
        }
      }
    }
    getClipsAtTime(time) {
      const result = [];
      for (const track of this.state.tracks) {
        if (track.muted)
          continue;
        for (const clip of track.clips) {
          if (clip.disabled)
            continue;
          if (time >= clip.inPoint && time < clip.outPoint)
            result.push(clip);
        }
      }
      return result;
    }
    _rippleInsert(track, clip) {
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
    _resolveOverlaps(track) {
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
    _moveConnected(parentId, delta) {
      for (const track of this.state.tracks) {
        for (const clip of track.clips) {
          if (clip.connectedTo === parentId) {
            clip.inPoint += delta;
            clip.outPoint += delta;
          }
        }
      }
    }
    _snapToGrid(time) {
      const grid = this.state.gridSnap;
      return Math.round(time / grid) * grid;
    }
    _updateDuration() {
      let max = 0;
      for (const track of this.state.tracks) {
        for (const clip of track.clips) {
          if (clip.outPoint > max)
            max = clip.outPoint;
        }
      }
      this.state.duration = max;
    }
    toJSON() {
      return structuredClone(this.state);
    }
    fromJSON(data) {
      this.state = data;
    }
  };

  // src/timeline/multicam.ts
  var MulticamEditor = class {
    angles = [];
    cutList = [];
    _activeAngle = 0;
    addAngle(sourceId, label) {
      const idx = this.angles.length;
      this.angles.push({
        id: "angle_" + idx + "_" + Date.now().toString(36),
        sourceId,
        label,
        audioOffset: 0,
        synced: false
      });
      return idx;
    }
    async syncAngles(getAudio) {
      if (this.angles.length < 2)
        return;
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
    switchAngle(angleIdx, atTime) {
      if (angleIdx < 0 || angleIdx >= this.angles.length)
        return;
      if (this.cutList.length > 0) {
        const last = this.cutList[this.cutList.length - 1];
        if (last.outPoint > atTime)
          last.outPoint = atTime;
        if (last.angleIdx === angleIdx && last.outPoint >= atTime)
          return;
      }
      this._activeAngle = angleIdx;
      this.cutList.push({
        angleIdx,
        inPoint: atTime,
        outPoint: Infinity
      });
    }
    finalize(endTime) {
      if (this.cutList.length > 0) {
        this.cutList[this.cutList.length - 1].outPoint = endTime;
      }
      this.cutList = this.cutList.filter((c) => c.inPoint < c.outPoint);
    }
    getAngleAtTime(time) {
      for (let i = this.cutList.length - 1; i >= 0; i--) {
        const c = this.cutList[i];
        if (time >= c.inPoint && time < c.outPoint)
          return c.angleIdx;
      }
      return 0;
    }
    getSourceTimeForAngle(angleIdx, timelineTime) {
      const angle = this.angles[angleIdx];
      if (!angle)
        return timelineTime;
      return timelineTime - angle.audioOffset;
    }
    toJSON() {
      return { angles: [...this.angles], cutList: [...this.cutList] };
    }
    fromJSON(data) {
      this.angles = data.angles;
      this.cutList = data.cutList;
    }
  };

  // src/timeline/history.ts
  var HistoryManager = class _HistoryManager {
    _stack = [];
    _cursor = -1;
    _maxDepth;
    _nextId = 0;
    _groupStack = [];
    _groupLabels = [];
    constructor(maxDepth = 200) {
      this._maxDepth = maxDepth;
    }
    push(label, patches) {
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
    beginGroup(label) {
      this._groupStack.push([]);
      this._groupLabels.push(label);
    }
    endGroup() {
      const patches = this._groupStack.pop();
      const label = this._groupLabels.pop() || "group";
      if (patches && patches.length > 0) {
        this.push(label, patches);
      }
    }
    undo(state) {
      if (this._cursor < 0)
        return state;
      const entry = this._stack[this._cursor];
      const newState = structuredClone(state);
      for (let i = entry.patches.length - 1; i >= 0; i--) {
        const p = entry.patches[i];
        if (p.op === "replace") {
          this._setPath(newState, p.path, p.oldValue);
        } else if (p.op === "add") {
          this._removePath(newState, p.path);
        } else if (p.op === "remove") {
          this._setPath(newState, p.path, p.oldValue);
        }
      }
      this._cursor--;
      return newState;
    }
    redo(state) {
      if (this._cursor >= this._stack.length - 1)
        return state;
      this._cursor++;
      const entry = this._stack[this._cursor];
      const newState = structuredClone(state);
      for (const p of entry.patches) {
        if (p.op === "replace") {
          this._setPath(newState, p.path, p.value);
        } else if (p.op === "add") {
          this._setPath(newState, p.path, p.value);
        } else if (p.op === "remove") {
          this._removePath(newState, p.path);
        }
      }
      return newState;
    }
    canUndo() {
      return this._cursor >= 0;
    }
    canRedo() {
      return this._cursor < this._stack.length - 1;
    }
    get undoLabel() {
      return this._cursor >= 0 ? this._stack[this._cursor].label : "";
    }
    get redoLabel() {
      return this._cursor < this._stack.length - 1 ? this._stack[this._cursor + 1].label : "";
    }
    get depth() {
      return this._stack.length;
    }
    clear() {
      this._stack = [];
      this._cursor = -1;
    }
    static diff(oldState, newState, basePath = "") {
      const patches = [];
      if (oldState === newState)
        return patches;
      if (typeof oldState !== typeof newState || oldState === null || newState === null || typeof oldState !== "object") {
        patches.push({ op: "replace", path: basePath || "/", value: newState, oldValue: oldState });
        return patches;
      }
      if (Array.isArray(oldState) && Array.isArray(newState)) {
        if (oldState.length !== newState.length || JSON.stringify(oldState) !== JSON.stringify(newState)) {
          patches.push({ op: "replace", path: basePath || "/", value: newState, oldValue: oldState });
        }
        return patches;
      }
      const allKeys = /* @__PURE__ */ new Set([...Object.keys(oldState), ...Object.keys(newState)]);
      for (const key of allKeys) {
        const p = basePath ? basePath + "/" + key : "/" + key;
        if (!(key in oldState)) {
          patches.push({ op: "add", path: p, value: newState[key] });
        } else if (!(key in newState)) {
          patches.push({ op: "remove", path: p, oldValue: oldState[key] });
        } else if (JSON.stringify(oldState[key]) !== JSON.stringify(newState[key])) {
          patches.push(..._HistoryManager.diff(oldState[key], newState[key], p));
        }
      }
      return patches;
    }
    _setPath(obj, path, value) {
      const parts = path.split("/").filter(Boolean);
      let cur = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] === void 0)
          cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      if (parts.length > 0)
        cur[parts[parts.length - 1]] = value;
    }
    _removePath(obj, path) {
      const parts = path.split("/").filter(Boolean);
      let cur = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]])
          return;
        cur = cur[parts[i]];
      }
      if (parts.length > 0)
        delete cur[parts[parts.length - 1]];
    }
  };

  // src/timeline/project.ts
  init_core();
  var DEFAULT_SETTINGS = {
    exportWidth: 1920,
    exportHeight: 1080,
    exportFPS: 30,
    exportCodec: "avc1.42E01E",
    exportBitrate: 8e6,
    audioSampleRate: 48e3,
    audioChannels: 2,
    proxyEnabled: false,
    proxyScale: 0.5,
    autoSaveInterval: 3e4
  };
  var ProjectManager = class {
    project;
    history;
    _autoSaveTimer = null;
    _opfsRoot = null;
    constructor(name = "Untitled") {
      this.project = {
        version: 2,
        name,
        created: Date.now(),
        modified: Date.now(),
        timeline: {
          tracks: [],
          duration: 0,
          fps: 30,
          width: 1920,
          height: 1080,
          sampleRate: 48e3,
          gridSnap: 1 / 30
        },
        assets: [],
        settings: { ...DEFAULT_SETTINGS }
      };
      this.history = new HistoryManager(200);
    }
    async initOPFS() {
      if (typeof navigator !== "undefined" && "storage" in navigator) {
        try {
          this._opfsRoot = await navigator.storage.getDirectory();
        } catch (e) {
          log.warn("[Project] OPFS unavailable:", e);
        }
      }
    }
    addAsset(asset) {
      const id = "a_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
      this.project.assets.push({ ...asset, id });
      this.project.modified = Date.now();
      return id;
    }
    removeAsset(assetId) {
      this.project.assets = this.project.assets.filter((a) => a.id !== assetId);
      this.project.modified = Date.now();
    }
    getAsset(assetId) {
      return this.project.assets.find((a) => a.id === assetId);
    }
    serialize() {
      this.project.modified = Date.now();
      const cleaned = structuredClone(this.project);
      for (const asset of cleaned.assets || []) {
        if ("blobUrl" in asset)
          delete asset.blobUrl;
      }
      return JSON.stringify(cleaned);
    }
    async deserialize(blob) {
      const text = await blob.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        throw new Error("[ProjectManager] Invalid JSON in project file: " + (e instanceof Error ? e.message : String(e)));
      }
      if (!parsed || typeof parsed !== "object") {
        throw new Error("[ProjectManager] Project data must be an object");
      }
      this.project = parsed;
      this.history.clear();
    }
    async exportFile() {
      const json = JSON.stringify(this.project, null, 0);
      const encoder = new TextEncoder();
      const data = encoder.encode(json);
      const header = new Uint8Array(16);
      const view = new DataView(header.buffer);
      view.setUint32(0, 1095059273);
      view.setUint32(4, this.project.version);
      view.setUint32(8, data.length);
      view.setUint32(12, 0);
      const result = new Uint8Array(header.length + data.length);
      result.set(header);
      result.set(data, header.length);
      return new Blob([result], { type: "application/x-aegis" });
    }
    importFile(text) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        throw new Error("[ProjectManager] Invalid JSON in project file");
      }
      if (!parsed || typeof parsed !== "object") {
        throw new Error("[ProjectManager] Project data must be an object");
      }
      if (parsed.magic && parsed.magic !== "AEGIS") {
        throw new Error(`[ProjectManager] Unknown project format: ${parsed.magic}`);
      }
      if (parsed.version && typeof parsed.version === "number" && parsed.version > 5) {
        throw new Error(`[ProjectManager] Unsupported project version ${parsed.version} (max: 5)`);
      }
      if (!parsed.assets || !Array.isArray(parsed.assets)) {
        parsed.assets = [];
      }
      if (!parsed.timeline || typeof parsed.timeline !== "object") {
        parsed.timeline = { duration: 0, tracks: [] };
      }
      this.project = parsed;
      this.history.clear();
    }
    async autoSave() {
      if (!this._opfsRoot)
        return;
      try {
        const name = "aegis_autosave_" + this.project.name.replace(/[^a-zA-Z0-9]/g, "_") + ".json";
        const handle = await this._opfsRoot.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        const data = JSON.stringify(this.project);
        await writable.write(data);
        await writable.close();
      } catch (e) {
        log.error("[Project] Auto-save failed", e);
      }
    }
    startAutoSave() {
      this.stopAutoSave();
      const interval = this.project.settings.autoSaveInterval;
      if (interval > 0) {
        this._autoSaveTimer = setInterval(() => this.autoSave(), interval);
      }
    }
    stopAutoSave() {
      if (this._autoSaveTimer !== null) {
        clearInterval(this._autoSaveTimer);
        this._autoSaveTimer = null;
      }
    }
    async loadAutoSave() {
      if (!this._opfsRoot)
        return false;
      try {
        const name = "aegis_autosave_" + this.project.name.replace(/[^a-zA-Z0-9]/g, "_") + ".json";
        const handle = await this._opfsRoot.getFileHandle(name);
        const file = await handle.getFile();
        const text = await file.text();
        this.project = JSON.parse(text);
        return true;
      } catch (_) {
        return false;
      }
    }
    snapshot() {
      return structuredClone(this.project.timeline);
    }
    commitChange(label, oldTimeline) {
      const patches = HistoryManager.diff(oldTimeline, this.project.timeline);
      if (patches.length > 0) {
        this.history.push(label, patches);
        this.project.modified = Date.now();
      }
    }
    undo() {
      this.project.timeline = this.history.undo(this.project.timeline);
    }
    redo() {
      this.project.timeline = this.history.redo(this.project.timeline);
    }
  };

  // src/gpu/fallback.ts
  var GPUTier = /* @__PURE__ */ ((GPUTier2) => {
    GPUTier2[GPUTier2["WEBGPU"] = 3] = "WEBGPU";
    GPUTier2[GPUTier2["WEBGL2"] = 2] = "WEBGL2";
    GPUTier2[GPUTier2["WEBGL1"] = 1] = "WEBGL1";
    GPUTier2[GPUTier2["CPU"] = 0] = "CPU";
    return GPUTier2;
  })(GPUTier || {});
  var FallbackRouter = class {
    _caps = null;
    _probeCanvas = null;
    async detect() {
      if (this._caps)
        return this._caps;
      if (typeof navigator !== "undefined" && "gpu" in navigator) {
        try {
          const gpu = navigator.gpu;
          const adapter = await gpu.requestAdapter();
          if (adapter) {
            const device = await adapter.requestDevice();
            if (device) {
              device.destroy();
              this._caps = this._buildWebGPUCaps();
              return this._caps;
            }
          }
        } catch (e) {
        }
      }
      this._probeCanvas = new OffscreenCanvas(1, 1);
      const gl2 = this._probeCanvas.getContext("webgl2");
      if (gl2) {
        this._caps = this._probeWebGL2(gl2);
        return this._caps;
      }
      const gl1 = this._probeCanvas.getContext("webgl");
      if (gl1) {
        this._caps = this._probeWebGL1(gl1);
        return this._caps;
      }
      this._caps = this._cpuOnly();
      return this._caps;
    }
    get caps() {
      if (!this._caps)
        return this._cpuOnly();
      return this._caps;
    }
    get tier() {
      return this._caps?.tier ?? 0 /* CPU */;
    }
    canUseEffect(effect) {
      const c = this._caps || this._cpuOnly();
      const heavy = ["bloom", "blur", "colorGrade", "displacement", "crt", "lut3d"];
      const needsFloat = ["bloom", "colorGrade", "lut3d"];
      if (heavy.includes(effect)) {
        if (c.tier >= 2 /* WEBGL2 */ && (c.floatTextures || !needsFloat.includes(effect))) {
          return 2 /* WEBGL2 */;
        }
        if (c.tier >= 1 /* WEBGL1 */ && !needsFloat.includes(effect)) {
          return 1 /* WEBGL1 */;
        }
        return 0 /* CPU */;
      }
      return c.tier;
    }
    selectBlurPath() {
      const c = this._caps || this._cpuOnly();
      if (c.tier >= 2 /* WEBGL2 */)
        return "gpu_separable";
      if (c.tier >= 1 /* WEBGL1 */)
        return "gpu_box";
      return "cpu_box";
    }
    selectColorPath() {
      const c = this._caps || this._cpuOnly();
      if (c.tier >= 2 /* WEBGL2 */ && c.colorBufferFloat)
        return "gpu_hdr";
      if (c.tier >= 1 /* WEBGL1 */)
        return "gpu_ldr";
      return "cpu_ldr";
    }
    selectCompositorPath() {
      const c = this._caps || this._cpuOnly();
      if (c.tier >= 2 /* WEBGL2 */ && c.drawBuffers)
        return "multi_layer";
      if (c.tier >= 1 /* WEBGL1 */)
        return "single_pass";
      return "cpu_blend";
    }
    _buildWebGPUCaps() {
      return {
        tier: 3 /* WEBGPU */,
        floatTextures: true,
        halfFloatTextures: true,
        instancedArrays: true,
        drawBuffers: true,
        depthTexture: true,
        colorBufferFloat: true,
        maxTextureSize: 16384,
        maxRenderbufferSize: 16384,
        maxVertexAttribs: 32,
        renderer: "WebGPU",
        vendor: "GPU",
        timerQuery: true,
        parallelCompile: true
      };
    }
    _probeWebGL2(gl) {
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        tier: 2 /* WEBGL2 */,
        floatTextures: !!gl.getExtension("EXT_color_buffer_float"),
        halfFloatTextures: !!gl.getExtension("EXT_color_buffer_half_float"),
        instancedArrays: true,
        drawBuffers: true,
        depthTexture: true,
        colorBufferFloat: !!gl.getExtension("EXT_color_buffer_float"),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
        maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "WebGL2",
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : "Unknown",
        timerQuery: !!gl.getExtension("EXT_disjoint_timer_query_webgl2"),
        parallelCompile: !!gl.getExtension("KHR_parallel_shader_compile")
      };
    }
    _probeWebGL1(gl) {
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        tier: 1 /* WEBGL1 */,
        floatTextures: !!gl.getExtension("OES_texture_float"),
        halfFloatTextures: !!gl.getExtension("OES_texture_half_float"),
        instancedArrays: !!gl.getExtension("ANGLE_instanced_arrays"),
        drawBuffers: !!gl.getExtension("WEBGL_draw_buffers"),
        depthTexture: !!gl.getExtension("WEBGL_depth_texture"),
        colorBufferFloat: false,
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
        maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "WebGL1",
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : "Unknown",
        timerQuery: !!gl.getExtension("EXT_disjoint_timer_query"),
        parallelCompile: false
      };
    }
    _cpuOnly() {
      return {
        tier: 0 /* CPU */,
        floatTextures: false,
        halfFloatTextures: false,
        instancedArrays: false,
        drawBuffers: false,
        depthTexture: false,
        colorBufferFloat: false,
        maxTextureSize: 0,
        maxRenderbufferSize: 0,
        maxVertexAttribs: 0,
        renderer: "CPU",
        vendor: "Software",
        timerQuery: false,
        parallelCompile: false
      };
    }
    dispose() {
      this._probeCanvas = null;
    }
  };
  var CPUEffects = class {
    static boxBlur(pixels, w, h, radius) {
      const r = Math.max(1, Math.min(radius, 50));
      const d = 2 * r + 1;
      const inv = 1 / d;
      const tmp = new Uint8ClampedArray(pixels.length);
      const out = new Uint8ClampedArray(pixels.length);
      for (let y = 0; y < h; y++) {
        let rr = 0, gg = 0, bb = 0, aa = 0;
        for (let dx = -r; dx <= r; dx++) {
          const sx = Math.max(0, Math.min(w - 1, dx));
          const i = (y * w + sx) * 4;
          rr += pixels[i];
          gg += pixels[i + 1];
          bb += pixels[i + 2];
          aa += pixels[i + 3];
        }
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          tmp[o] = rr * inv;
          tmp[o + 1] = gg * inv;
          tmp[o + 2] = bb * inv;
          tmp[o + 3] = aa * inv;
          const addX = Math.min(w - 1, x + r + 1);
          const remX = Math.max(0, x - r);
          const ai = (y * w + addX) * 4, ri = (y * w + remX) * 4;
          rr += pixels[ai] - pixels[ri];
          gg += pixels[ai + 1] - pixels[ri + 1];
          bb += pixels[ai + 2] - pixels[ri + 2];
          aa += pixels[ai + 3] - pixels[ri + 3];
        }
      }
      for (let x = 0; x < w; x++) {
        let rr = 0, gg = 0, bb = 0, aa = 0;
        for (let dy = -r; dy <= r; dy++) {
          const sy = Math.max(0, Math.min(h - 1, dy));
          const i = (sy * w + x) * 4;
          rr += tmp[i];
          gg += tmp[i + 1];
          bb += tmp[i + 2];
          aa += tmp[i + 3];
        }
        for (let y = 0; y < h; y++) {
          const o = (y * w + x) * 4;
          out[o] = rr * inv;
          out[o + 1] = gg * inv;
          out[o + 2] = bb * inv;
          out[o + 3] = aa * inv;
          const addY = Math.min(h - 1, y + r + 1);
          const remY = Math.max(0, y - r);
          const ai = (addY * w + x) * 4, ri = (remY * w + x) * 4;
          rr += tmp[ai] - tmp[ri];
          gg += tmp[ai + 1] - tmp[ri + 1];
          bb += tmp[ai + 2] - tmp[ri + 2];
          aa += tmp[ai + 3] - tmp[ri + 3];
        }
      }
      return out;
    }
    static brightness(pixels, factor) {
      const out = new Uint8ClampedArray(pixels.length);
      for (let i = 0; i < pixels.length; i += 4) {
        out[i] = Math.max(0, Math.min(255, pixels[i] * factor));
        out[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] * factor));
        out[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] * factor));
        out[i + 3] = pixels[i + 3];
      }
      return out;
    }
    static grayscale(pixels) {
      const out = new Uint8ClampedArray(pixels.length);
      for (let i = 0; i < pixels.length; i += 4) {
        const v = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
        out[i] = out[i + 1] = out[i + 2] = v;
        out[i + 3] = pixels[i + 3];
      }
      return out;
    }
  };

  // src/demux/ogg.ts
  init_core();
  var OGG_CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let j = 0; j < 8; j++)
        r = r << 1 ^ (r & 2147483648 ? 79764919 : 0);
      t[i] = r >>> 0;
    }
    return t;
  })();
  var OggDemuxer = class {
    buf;
    view;
    streams = /* @__PURE__ */ new Map();
    constructor(buffer) {
      this.buf = new Uint8Array(buffer);
      this.view = new DataView(buffer);
    }
    parse() {
      try {
        let pos = 0;
        const pendingPackets = /* @__PURE__ */ new Map();
        while (pos < this.buf.length - 27) {
          const page = this._readPage(pos);
          if (!page) {
            pos = this._findNextPage(pos + 1);
            if (pos < 0)
              break;
            continue;
          }
          pos = page.nextPos;
          const serial = page.page.serialNumber;
          if (!this.streams.has(serial)) {
            this.streams.set(serial, {
              serialNumber: serial,
              codec: "unknown",
              packets: [],
              headers: []
            });
          }
          const stream = this.streams.get(serial);
          if (!pendingPackets.has(serial))
            pendingPackets.set(serial, []);
          const pending = pendingPackets.get(serial);
          for (let i = 0; i < page.page.segments.length; i++) {
            const seg = page.page.segments[i];
            pending.push(seg);
            const isComplete = i < page.segmentSizes.length && page.segmentSizes[i] < 255;
            if (isComplete || i === page.page.segments.length - 1 && !page.page.isContinued) {
              const fullPacket = this._concatSegments(pending.splice(0));
              if (page.page.isBOS && stream.packets.length === 0) {
                this._identifyCodec(stream, fullPacket);
                stream.headers.push(fullPacket);
              } else if (stream.headers.length < 3 && this._isHeader(stream.codec, fullPacket)) {
                stream.headers.push(fullPacket);
              } else {
                stream.packets.push(fullPacket);
              }
            }
          }
        }
      } catch (e) {
        log.warn("[OggDemuxer] Parse error (possibly truncated file):", e);
      }
    }
    _readPage(pos) {
      if (pos + 27 > this.buf.length)
        return null;
      if (this.buf[pos] !== 79 || this.buf[pos + 1] !== 103 || this.buf[pos + 2] !== 103 || this.buf[pos + 3] !== 83)
        return null;
      const version = this.buf[pos + 4];
      const headerType = this.buf[pos + 5];
      const granule = this.view.getBigInt64(pos + 6, true);
      const serial = this.view.getUint32(pos + 14, true);
      const seqNum = this.view.getUint32(pos + 18, true);
      const storedCrc = this.view.getUint32(pos + 22, true);
      const numSegments = this.buf[pos + 26];
      if (pos + 27 + numSegments > this.buf.length)
        return null;
      const segmentSizes = [];
      let totalSegmentBytes = 0;
      for (let i = 0; i < numSegments; i++) {
        const sz = this.buf[pos + 27 + i];
        segmentSizes.push(sz);
        totalSegmentBytes += sz;
      }
      const pageEnd = pos + 27 + numSegments + totalSegmentBytes;
      if (pageEnd > this.buf.length)
        return null;
      const computedCrc = this._oggCrc32(pos, pageEnd - pos, pos + 22);
      if (computedCrc !== storedCrc) {
        log.warn(`[OggDemuxer] CRC32 mismatch at page offset ${pos}: stored=0x${storedCrc.toString(16)}, computed=0x${computedCrc.toString(16)}`);
        return null;
      }
      let dataPos = pos + 27 + numSegments;
      const segments = [];
      for (const sz of segmentSizes) {
        if (dataPos + sz > this.buf.length)
          break;
        segments.push(this.buf.subarray(dataPos, dataPos + sz));
        dataPos += sz;
      }
      return {
        page: {
          version,
          headerType,
          granulePosition: granule,
          serialNumber: serial,
          sequenceNumber: seqNum,
          segments,
          isBOS: (headerType & 2) !== 0,
          isEOS: (headerType & 4) !== 0,
          isContinued: (headerType & 1) !== 0
        },
        nextPos: dataPos,
        segmentSizes
      };
    }
    _oggCrc32(start, length, checksumOffset) {
      let crc = 0;
      for (let i = 0; i < length; i++) {
        const bytePos = start + i;
        const b = bytePos >= checksumOffset && bytePos < checksumOffset + 4 ? 0 : this.buf[bytePos];
        crc = (crc << 8 ^ OGG_CRC_TABLE[(crc >>> 24 ^ b) & 255]) >>> 0;
      }
      return crc;
    }
    _findNextPage(start) {
      for (let i = start; i < this.buf.length - 4; i++) {
        if (this.buf[i] === 79 && this.buf[i + 1] === 103 && this.buf[i + 2] === 103 && this.buf[i + 3] === 83)
          return i;
      }
      return -1;
    }
    _concatSegments(parts) {
      if (parts.length === 1)
        return parts[0];
      let total = 0;
      for (const p of parts)
        total += p.length;
      const result = new Uint8Array(total);
      let offset = 0;
      for (const p of parts) {
        result.set(p, offset);
        offset += p.length;
      }
      return result;
    }
    _identifyCodec(stream, firstPacket) {
      if (firstPacket.length >= 7 && firstPacket[0] === 1 && firstPacket[1] === 118 && firstPacket[2] === 111 && firstPacket[3] === 114 && firstPacket[4] === 98 && firstPacket[5] === 105 && firstPacket[6] === 115) {
        stream.codec = "vorbis";
        if (firstPacket.length >= 16) {
          const dv = new DataView(firstPacket.buffer, firstPacket.byteOffset);
          stream.channels = firstPacket[11];
          stream.sampleRate = dv.getUint32(12, true);
        }
      } else if (firstPacket.length >= 8 && firstPacket[0] === 79 && firstPacket[1] === 112 && firstPacket[2] === 117 && firstPacket[3] === 115 && firstPacket[4] === 72 && firstPacket[5] === 101 && firstPacket[6] === 97 && firstPacket[7] === 100) {
        stream.codec = "opus";
        if (firstPacket.length >= 12) {
          stream.channels = firstPacket[9];
          const dv = new DataView(firstPacket.buffer, firstPacket.byteOffset);
          stream.sampleRate = dv.getUint32(12, true);
        }
      } else if (firstPacket.length >= 7 && firstPacket[0] === 128 && firstPacket[1] === 116 && firstPacket[2] === 104 && firstPacket[3] === 101 && firstPacket[4] === 111 && firstPacket[5] === 114 && firstPacket[6] === 97) {
        stream.codec = "theora";
      }
    }
    _isHeader(codec, packet) {
      if (codec === "vorbis" && packet.length > 0 && (packet[0] === 3 || packet[0] === 5))
        return true;
      if (codec === "opus" && packet.length >= 8 && packet[0] === 79 && packet[1] === 112 && packet[2] === 117 && packet[3] === 115)
        return true;
      return false;
    }
    getVorbisStreams() {
      return [...this.streams.values()].filter((s) => s.codec === "vorbis");
    }
    getOpusStreams() {
      return [...this.streams.values()].filter((s) => s.codec === "opus");
    }
  };

  // src/demux/avi_flv.ts
  var StreamingAVIDemuxer = class {
    result;
    moviBase = 0;
    streamInfo = [];
    constructor() {
      this.result = this._empty();
    }
    parse(buffer) {
      const buf = new Uint8Array(buffer);
      const view = new DataView(buffer);
      this.result = this._empty();
      let pos = 0;
      if (buf.length < 12)
        return this.result;
      const magic = this._str4(buf, 0);
      if (magic !== "RIFF")
        return this.result;
      const fileType = this._str4(buf, 8);
      if (fileType !== "AVI ")
        return this.result;
      try {
        pos = 12;
        pos = this._parseAVIList(buf, view, pos, Math.min(view.getUint32(4, true) + 8, buf.length));
      } catch (_) {
        this.result.errors++;
      }
      return this.result;
    }
    _parseAVIList(buf, view, start, end) {
      let pos = start;
      while (pos < end - 8) {
        const id = this._str4(buf, pos);
        if (pos + 4 >= end)
          break;
        const size = view.getUint32(pos + 4, true);
        if (size === 0) {
          pos += 8;
          continue;
        }
        if (pos + 8 + size > end + 256)
          break;
        const chunkEnd = Math.min(pos + 8 + size, end);
        if (id === "LIST") {
          const listType = this._str4(buf, pos + 8);
          if (listType === "hdrl" || listType === "strl") {
            this._parseAVIList(buf, view, pos + 12, chunkEnd);
          } else if (listType === "movi") {
            this.moviBase = pos + 12;
            this._extractMoviFrames(buf, view, pos + 12, chunkEnd);
          }
        } else {
          this._handleAVIChunk(buf, view, id, pos + 8, size);
        }
        pos = chunkEnd + (size & 1);
      }
      return pos;
    }
    _currentStreamIdx = -1;
    _handleAVIChunk(buf, view, id, offset, size) {
      if (id === "strh" && offset + 28 <= buf.length) {
        const fccType = this._str4(buf, offset);
        const codec = this._str4(buf, offset + 4);
        const scale = view.getUint32(offset + 20, true);
        const rate = view.getUint32(offset + 24, true);
        const type = fccType === "vids" ? "video" : "audio";
        this.streamInfo.push({ type, codec, scale, rate });
        this._currentStreamIdx = this.streamInfo.length - 1;
        if (type === "video") {
          this.result.videoCodec = codec;
          this.result.fps = scale > 0 ? rate / scale : 30;
        } else {
          this.result.audioCodec = codec;
        }
      } else if (id === "strf") {
        const si = this.streamInfo[this._currentStreamIdx];
        if (si?.type === "video" && offset + 12 <= buf.length) {
          this.result.width = view.getUint32(offset + 4, true);
          this.result.height = Math.abs(view.getInt32(offset + 8, true));
        } else if (si?.type === "audio" && offset + 14 <= buf.length) {
          this.result.channels = view.getUint16(offset + 2, true);
          this.result.sampleRate = view.getUint32(offset + 4, true);
        }
      }
    }
    _extractMoviFrames(buf, view, start, end) {
      let pos = start;
      const videoFrameCounts = /* @__PURE__ */ new Map();
      while (pos < end - 8) {
        const id = this._str4(buf, pos);
        const size = view.getUint32(pos + 4, true);
        if (size === 0 || pos + 8 + size > end + 4) {
          pos += 8;
          this.result.errors++;
          continue;
        }
        if (id === "LIST") {
          pos += 12;
          continue;
        }
        const streamIdx = parseInt(id.substring(0, 2), 10);
        const chunkType = id.substring(2, 4);
        if (!isNaN(streamIdx) && streamIdx < this.streamInfo.length) {
          const si = this.streamInfo[streamIdx];
          const isVideo = chunkType === "dc" || chunkType === "db";
          const isAudio = chunkType === "wb";
          if ((isVideo || isAudio) && pos + 8 + size <= buf.length) {
            const trackFrameCount = videoFrameCounts.get(streamIdx) || 0;
            const pts = si.scale > 0 ? trackFrameCount * si.scale / si.rate : trackFrameCount / 30;
            const isKey = chunkType === "db" || isVideo && trackFrameCount === 0;
            this.result.frames.push({
              type: si.type,
              pts,
              dts: pts,
              isKey,
              data: buf.subarray(pos + 8, pos + 8 + size),
              codec: si.codec
            });
            if (isVideo)
              videoFrameCounts.set(streamIdx, trackFrameCount + 1);
          }
        }
        pos += 8 + size + (size & 1);
      }
    }
    _str4(buf, pos) {
      if (pos + 4 > buf.length)
        return "";
      return String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]);
    }
    _empty() {
      return {
        frames: [],
        videoCodec: "",
        audioCodec: "",
        width: 0,
        height: 0,
        fps: 0,
        sampleRate: 0,
        channels: 0,
        duration: 0,
        errors: 0
      };
    }
  };
  var StreamingFLVDemuxer = class {
    parse(buffer) {
      const buf = new Uint8Array(buffer);
      const view = new DataView(buffer);
      const result = {
        frames: [],
        videoCodec: "",
        audioCodec: "",
        width: 0,
        height: 0,
        fps: 0,
        sampleRate: 0,
        channels: 0,
        duration: 0,
        errors: 0
      };
      if (buf.length < 13 || buf[0] !== 70 || buf[1] !== 76 || buf[2] !== 86)
        return result;
      const headerSize = view.getUint32(5);
      let pos = headerSize;
      while (pos < buf.length - 15) {
        pos += 4;
        if (pos + 11 > buf.length)
          break;
        const tagType = buf[pos];
        const dataSize = buf[pos + 1] << 16 | buf[pos + 2] << 8 | buf[pos + 3];
        const ts = (buf[pos + 7] << 24 | buf[pos + 4] << 16 | buf[pos + 5] << 8 | buf[pos + 6]) >>> 0;
        const dataStart = pos + 11;
        if (dataStart + dataSize > buf.length) {
          result.errors++;
          break;
        }
        try {
          if (tagType === 9 && dataSize > 5) {
            const frameType = buf[dataStart] >> 4 & 15;
            const codecId = buf[dataStart] & 15;
            result.videoCodec = codecId === 7 ? "H.264" : codecId === 2 ? "H.263" : "FLV" + codecId;
            let cts = 0;
            if (codecId === 7 && dataSize > 5) {
              const avcType = buf[dataStart + 1];
              cts = buf[dataStart + 2] << 16 | buf[dataStart + 3] << 8 | buf[dataStart + 4];
              if (cts & 8388608)
                cts -= 16777216;
              if (avcType === 0) {
                pos = dataStart + dataSize;
                continue;
              }
            }
            result.frames.push({
              type: "video",
              pts: ts + cts,
              dts: ts,
              isKey: frameType === 1,
              data: buf.subarray(codecId === 7 ? dataStart + 5 : dataStart + 1, dataStart + dataSize),
              codec: result.videoCodec
            });
          } else if (tagType === 8 && dataSize > 2) {
            const audioCodecId = buf[dataStart] >> 4 & 15;
            result.audioCodec = audioCodecId === 10 ? "AAC" : audioCodecId === 2 ? "MP3" : "FLV_A" + audioCodecId;
            const rates = [5500, 11025, 22050, 44100];
            result.sampleRate = rates[buf[dataStart] >> 2 & 3] || 44100;
            result.channels = (buf[dataStart] & 1) + 1;
            if (audioCodecId === 10) {
              if (buf[dataStart + 1] === 0) {
                pos = dataStart + dataSize;
                continue;
              }
              result.frames.push({
                type: "audio",
                pts: ts,
                dts: ts,
                isKey: true,
                data: buf.subarray(dataStart + 2, dataStart + dataSize),
                codec: result.audioCodec
              });
            } else {
              result.frames.push({
                type: "audio",
                pts: ts,
                dts: ts,
                isKey: true,
                data: buf.subarray(dataStart + 1, dataStart + dataSize),
                codec: result.audioCodec
              });
            }
          }
        } catch (_) {
          result.errors++;
        }
        pos = dataStart + dataSize;
      }
      if (result.frames.length > 0) {
        const last = result.frames[result.frames.length - 1];
        result.duration = Math.max(last.pts, last.dts) / 1e3;
      }
      return result;
    }
  };

  // src/gpu/color_space.ts
  var CSColorSpace = /* @__PURE__ */ ((CSColorSpace2) => {
    CSColorSpace2[CSColorSpace2["BT601_LIMITED"] = 0] = "BT601_LIMITED";
    CSColorSpace2[CSColorSpace2["BT601_FULL"] = 1] = "BT601_FULL";
    CSColorSpace2[CSColorSpace2["BT709_LIMITED"] = 2] = "BT709_LIMITED";
    CSColorSpace2[CSColorSpace2["BT709_FULL"] = 3] = "BT709_FULL";
    CSColorSpace2[CSColorSpace2["BT2020_LIMITED"] = 4] = "BT2020_LIMITED";
    CSColorSpace2[CSColorSpace2["BT2020_FULL"] = 5] = "BT2020_FULL";
    return CSColorSpace2;
  })(CSColorSpace || {});
  var CSChromaFormat = /* @__PURE__ */ ((CSChromaFormat2) => {
    CSChromaFormat2[CSChromaFormat2["YUV420"] = 0] = "YUV420";
    CSChromaFormat2[CSChromaFormat2["YUV422"] = 1] = "YUV422";
    CSChromaFormat2[CSChromaFormat2["YUV444"] = 2] = "YUV444";
    CSChromaFormat2[CSChromaFormat2["NV12"] = 3] = "NV12";
    CSChromaFormat2[CSChromaFormat2["NV21"] = 4] = "NV21";
    return CSChromaFormat2;
  })(CSChromaFormat || {});
  var COLOR_SPACE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_y;
uniform sampler2D u_u;
uniform sampler2D u_v;
uniform vec2 u_chromaSize;
uniform int u_colorSpace;
uniform float u_sigmaS;
uniform float u_sigmaR;

mat3 getMatrix(int cs) {
    if (cs == 0 || cs == 1) {
        return mat3(
            1.0, 1.0, 1.0,
            0.0, -0.344136, 1.772,
            1.402, -0.714136, 0.0
        );
    } else if (cs == 2 || cs == 3) {
        return mat3(
            1.0, 1.0, 1.0,
            0.0, -0.1873, 1.8556,
            1.5748, -0.4681, 0.0
        );
    } else {
        return mat3(
            1.0, 1.0, 1.0,
            0.0, -0.1646, 1.8814,
            1.4746, -0.5714, 0.0
        );
    }
}

vec2 getRange(int cs) {
    if (cs == 0 || cs == 2 || cs == 4) {
        return vec2(16.0 / 255.0, 219.0 / 255.0);
    }
    return vec2(0.0, 1.0);
}

float bilateral(sampler2D tex, vec2 uv, vec2 texel, float ref, float sigS, float sigR) {
    float acc = 0.0;
    float wt = 0.0;
    float s2 = sigS * sigS * 2.0;
    float r2 = sigR * sigR * 2.0;
    int r = int(ceil(sigS * 2.0));
    for (int dy = -r; dy <= r; dy++) {
        for (int dx = -r; dx <= r; dx++) {
            vec2 off = vec2(float(dx), float(dy)) * texel;
            float s = texture(tex, uv + off).r;
            float sw = exp(-float(dx * dx + dy * dy) / s2);
            float rw = exp(-((s - ref) * (s - ref)) / r2);
            float w = sw * rw;
            acc += s * w;
            wt += w;
        }
    }
    return acc / max(wt, 1e-4);
}

void main() {
    float y = texture(u_y, v_uv).r;
    vec2 range = getRange(u_colorSpace);
    float yNorm = (y - range.x) / range.y;
    vec2 chromaTexel = 1.0 / u_chromaSize;
    float sigS = max(u_sigmaS, 0.5);
    float sigR = max(u_sigmaR, 0.01);
    float cb = bilateral(u_u, v_uv, chromaTexel, yNorm, sigS, sigR) - 0.5;
    float cr = bilateral(u_v, v_uv, chromaTexel, yNorm, sigS, sigR) - 0.5;
    mat3 M = getMatrix(u_colorSpace);
    vec3 yuv = vec3(yNorm, cb, cr);
    vec3 rgb = M * yuv;
    o = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;
  var ColorSpaceConverter = class {
    _gl;
    _yTex = null;
    _uTex = null;
    _vTex = null;
    _nv12U = null;
    _nv12V = null;
    _nv12Size = 0;
    constructor(width, height) {
      this._gl = new GL(width, height);
      this._gl.loadFragmentShader(COLOR_SPACE_FRAG);
    }
    convert(yPlane, uPlane, vPlane, width, height, chromaW, chromaH, colorSpace = 2 /* BT709_LIMITED */, sigmaS = 1.5, sigmaR = 0.1) {
      const gl = this._gl.gl;
      this._yTex = this._uploadPlane(gl, this._yTex, yPlane, width, height, 0, "u_y");
      this._uTex = this._uploadPlane(gl, this._uTex, uPlane, chromaW, chromaH, 1, "u_u");
      this._vTex = this._uploadPlane(gl, this._vTex, vPlane, chromaW, chromaH, 2, "u_v");
      this._gl.setUniform2f("u_chromaSize", chromaW, chromaH).setUniform1f("u_sigmaS", sigmaS).setUniform1f("u_sigmaR", sigmaR).setUniform1i("u_colorSpace", colorSpace).render();
    }
    convertNV12(yPlane, uvPlane, width, height, colorSpace = 2 /* BT709_LIMITED */) {
      const chromaW = width >> 1;
      const chromaH = height >> 1;
      const chromaLen = chromaW * chromaH;
      if (this._nv12Size !== chromaLen) {
        this._nv12U = new Uint8Array(chromaLen);
        this._nv12V = new Uint8Array(chromaLen);
        this._nv12Size = chromaLen;
      }
      const uPlane = this._nv12U;
      const vPlane = this._nv12V;
      for (let i = 0; i < chromaLen; i++) {
        uPlane[i] = uvPlane[i * 2];
        vPlane[i] = uvPlane[i * 2 + 1];
      }
      this.convert(yPlane, uPlane, vPlane, width, height, chromaW, chromaH, colorSpace);
    }
    async extract() {
      return this._gl.extract();
    }
    readPixels() {
      const gl = this._gl.gl;
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    }
    async toVideoFrame(timestamp) {
      const bitmap = await this.extract();
      if (typeof VideoFrame !== "undefined") {
        return new VideoFrame(bitmap, { timestamp });
      }
      return bitmap;
    }
    _uploadPlane(gl, tex, data, w, h, unit, name) {
      if (!tex)
        tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const p = this._gl.program;
      if (p) {
        const loc = gl.getUniformLocation(p, name);
        if (loc)
          gl.uniform1i(loc, unit);
      }
      return tex;
    }
    dispose() {
      const gl = this._gl.gl;
      if (this._yTex)
        gl.deleteTexture(this._yTex);
      if (this._uTex)
        gl.deleteTexture(this._uTex);
      if (this._vTex)
        gl.deleteTexture(this._vTex);
    }
    static cpuConvert(yPlane, uPlane, vPlane, width, height, chromaW, chromaH, colorSpace = 2 /* BT709_LIMITED */) {
      const out = new Uint8ClampedArray(width * height * 4);
      const matrices = {
        0: [1.164, 0, 1.596, 1.164, -0.392, -0.813, 1.164, 2.017, 0],
        1: [1, 0, 1.402, 1, -0.344136, -0.714136, 1, 1.772, 0],
        2: [1.164, 0, 1.793, 1.164, -0.213, -0.533, 1.164, 2.112, 0],
        3: [1, 0, 1.5748, 1, -0.1873, -0.4681, 1, 1.8556, 0],
        4: [1.164, 0, 1.679, 1.164, -0.188, -0.652, 1.164, 2.142, 0],
        5: [1, 0, 1.4746, 1, -0.1646, -0.5714, 1, 1.8814, 0]
      };
      const m = matrices[colorSpace] || matrices[2];
      const isLimited = colorSpace % 2 === 0;
      const scaleX = chromaW / width;
      const scaleY = chromaH / height;
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          const yVal = yPlane[py * width + px];
          const cx = Math.min(Math.floor(px * scaleX), chromaW - 1);
          const cy = Math.min(Math.floor(py * scaleY), chromaH - 1);
          const cb = uPlane[cy * chromaW + cx] - 128;
          const cr = vPlane[cy * chromaW + cx] - 128;
          const y = isLimited ? yVal - 16 : yVal;
          const r = m[0] * y + m[1] * cb + m[2] * cr;
          const g = m[3] * y + m[4] * cb + m[5] * cr;
          const b = m[6] * y + m[7] * cb + m[8] * cr;
          const i = (py * width + px) * 4;
          out[i] = Math.max(0, Math.min(255, r));
          out[i + 1] = Math.max(0, Math.min(255, g));
          out[i + 2] = Math.max(0, Math.min(255, b));
          out[i + 3] = 255;
        }
      }
      return out;
    }
  };

  // src/core/transcoder.ts
  init_core();
  var TE = new TextEncoder();
  var DEFAULT_TRANSCODE = {
    outputFormat: "mp4",
    videoCodec: "avc1.42E01E",
    audioCodec: "mp4a.40.2",
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 5e6,
    audioBitrate: 128e3,
    audioSampleRate: 48e3,
    audioChannels: 2
  };
  var DirectTranscoder = class _DirectTranscoder {
    cfg;
    _videoChunks = [];
    _audioChunks = [];
    _chunkBytes = 0;
    static SOFT_LIMIT = 256 * 1024 * 1024;
    static HARD_LIMIT = 512 * 1024 * 1024;
    _softWarnEmitted = false;
    _progress;
    _onProgress = null;
    _startTime = 0;
    _videoFrameCount = 0;
    _audioSampleCount = 0;
    _videoEncoder = null;
    _audioEncoder = null;
    _videoDecoderConfig = null;
    constructor(config) {
      this.cfg = { ...DEFAULT_TRANSCODE, ...config };
      this._progress = {
        phase: "demux",
        framesProcessed: 0,
        totalEstimate: 0,
        percent: 0,
        elapsedMs: 0
      };
    }
    onProgress(cb) {
      this._onProgress = cb;
    }
    async transcode(videoFrames, audioFrames) {
      this._startTime = performance.now();
      this._videoChunks = [];
      this._audioChunks = [];
      this._videoFrameCount = 0;
      this._audioSampleCount = 0;
      await this._initEncoders();
      this._updateProgress("encode", 0);
      try {
        const videoPromise = this._processVideoStream(videoFrames);
        const audioPromise = audioFrames ? this._processAudioStream(audioFrames) : Promise.resolve();
        await Promise.all([videoPromise, audioPromise]);
      } finally {
        await this._flushEncoders();
      }
      this._updateProgress("mux", this._videoFrameCount);
      const muxed = this._muxToContainer();
      this._updateProgress("done", this._videoFrameCount);
      return muxed;
    }
    async transcodeFromRawBuffers(videoRGBA, audioPCM) {
      this._startTime = performance.now();
      this._videoChunks = [];
      this._audioChunks = [];
      await this._initEncoders();
      try {
        for (const frame of videoRGBA) {
          try {
            const vf = new VideoFrame(
              frame.pixels.buffer,
              { timestamp: frame.timestamp, codedWidth: frame.width, codedHeight: frame.height, format: "RGBA" }
            );
            this._videoEncoder.encode(vf, { keyFrame: this._videoFrameCount % 30 === 0 });
            vf.close();
            this._videoFrameCount++;
            if (this._videoFrameCount % 10 === 0)
              this._updateProgress("encode", this._videoFrameCount);
          } catch (e) {
            log.warn("[DirectTranscoder]", e);
          }
        }
        for (const chunk of audioPCM) {
          try {
            const ad = new AudioData({
              format: "f32-planar",
              sampleRate: chunk.sampleRate,
              numberOfFrames: chunk.samples.length / this.cfg.audioChannels,
              numberOfChannels: this.cfg.audioChannels,
              timestamp: chunk.timestamp,
              data: chunk.samples.buffer
            });
            this._audioEncoder.encode(ad);
            ad.close();
          } catch (e) {
            log.warn("[DirectTranscoder]", e);
          }
        }
      } finally {
        await this._flushEncoders();
      }
      return this._muxToContainer();
    }
    async _initEncoders() {
      if (typeof VideoEncoder !== "undefined") {
        this._videoEncoder = new VideoEncoder({
          output: (chunk, meta) => this._onVideoChunk(chunk, meta),
          error: (e) => log.warn("[DirectTranscoder] VideoEncoder error:", e)
        });
        this._videoEncoder.configure({
          codec: this.cfg.videoCodec,
          width: this.cfg.width,
          height: this.cfg.height,
          bitrate: this.cfg.videoBitrate,
          framerate: this.cfg.fps
        });
      }
      if (typeof AudioEncoder !== "undefined") {
        this._audioEncoder = new AudioEncoder({
          output: (chunk) => this._onAudioChunk(chunk),
          error: (e) => log.warn("[DirectTranscoder] AudioEncoder error:", e)
        });
        this._audioEncoder.configure({
          codec: this.cfg.audioCodec,
          sampleRate: this.cfg.audioSampleRate,
          numberOfChannels: this.cfg.audioChannels,
          bitrate: this.cfg.audioBitrate
        });
      }
    }
    async _processVideoStream(frames) {
      if (!this._videoEncoder)
        return;
      for await (const frame of frames) {
        try {
          let vf;
          if (frame.data instanceof ImageBitmap) {
            vf = new VideoFrame(frame.data, { timestamp: frame.timestamp });
          } else {
            const rgba = frame.data;
            vf = new VideoFrame(
              rgba.buffer,
              { timestamp: frame.timestamp, codedWidth: this.cfg.width, codedHeight: this.cfg.height, format: "RGBA" }
            );
          }
          this._videoEncoder.encode(vf, { keyFrame: frame.isKey || this._videoFrameCount % 60 === 0 });
          vf.close();
          this._videoFrameCount++;
          if (this._videoFrameCount % 10 === 0)
            this._updateProgress("encode", this._videoFrameCount);
        } catch (e) {
          log.warn("[DirectTranscoder]", e);
        }
      }
    }
    async _processAudioStream(frames) {
      if (!this._audioEncoder)
        return;
      for await (const frame of frames) {
        try {
          const ad = new AudioData({
            format: "f32-planar",
            sampleRate: this.cfg.audioSampleRate,
            numberOfFrames: Math.floor(frame.data.length / this.cfg.audioChannels),
            numberOfChannels: this.cfg.audioChannels,
            timestamp: frame.timestamp,
            data: frame.data.buffer
          });
          this._audioEncoder.encode(ad);
          ad.close();
          this._audioSampleCount += frame.data.length;
        } catch (e) {
          log.warn("[DirectTranscoder]", e);
        }
      }
    }
    _onVideoChunk(chunk, meta) {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      if (meta?.decoderConfig?.description && !this._videoDecoderConfig) {
        const desc = meta.decoderConfig.description;
        if (desc instanceof ArrayBuffer) {
          this._videoDecoderConfig = new Uint8Array(desc);
        } else if (ArrayBuffer.isView(desc)) {
          this._videoDecoderConfig = new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength);
        }
        log.info(`[DirectTranscoder] Captured ${this._videoDecoderConfig?.length || 0}B codec config`);
      }
      this._videoChunks.push({
        data,
        isKey: chunk.type === "key",
        timestamp: chunk.timestamp
      });
      this._chunkBytes += data.byteLength;
      this._checkMemoryLimit();
    }
    _onAudioChunk(chunk) {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      this._audioChunks.push({
        data,
        isKey: true,
        timestamp: chunk.timestamp
      });
      this._chunkBytes += data.byteLength;
      this._checkMemoryLimit();
    }
    _checkMemoryLimit() {
      if (this._chunkBytes >= _DirectTranscoder.HARD_LIMIT) {
        throw new Error(`[DirectTranscoder] Chunk accumulation exceeded ${_DirectTranscoder.HARD_LIMIT / (1024 * 1024)}MB hard limit. Input file is too large for in-memory transcoding. Use AegisMuxer in streaming mode instead.`);
      }
      if (!this._softWarnEmitted && this._chunkBytes >= _DirectTranscoder.SOFT_LIMIT) {
        this._softWarnEmitted = true;
        log.warn(`[DirectTranscoder] Chunk accumulation at ${(this._chunkBytes / (1024 * 1024)).toFixed(0)}MB \u2014 approaching memory limit. Consider using streaming mode for large files.`);
      }
    }
    async _flushEncoders() {
      if (this._videoEncoder && this._videoEncoder.state === "configured") {
        try {
          await this._videoEncoder.flush();
        } catch (e) {
          log.warn("[DirectTranscoder] flush error:", e);
        }
        try {
          this._videoEncoder.close();
        } catch (_) {
        }
      }
      if (this._audioEncoder && this._audioEncoder.state === "configured") {
        try {
          await this._audioEncoder.flush();
        } catch (e) {
          log.warn("[DirectTranscoder] flush error:", e);
        }
        try {
          this._audioEncoder.close();
        } catch (_) {
        }
      }
    }
    _muxToContainer() {
      if (this.cfg.outputFormat === "mp4")
        return this._muxMP4();
      return this._muxWebM();
    }
    _muxMP4() {
      const vChunks = this._videoChunks;
      const aChunks = this._audioChunks;
      let mdatPayload = 0;
      for (const c of vChunks)
        mdatPayload += c.data.length;
      for (const c of aChunks)
        mdatPayload += c.data.length;
      const ftyp = this._buildFtyp();
      const dummyMoov = this._buildMoov(vChunks, aChunks, 0);
      const moovSize = dummyMoov.length;
      const needs64bitMdat = mdatPayload + 8 > 4294967295;
      const mdatHeaderSize = needs64bitMdat ? 16 : 8;
      const dataOffset = ftyp.length + moovSize + mdatHeaderSize;
      const moov = this._buildMoov(vChunks, aChunks, dataOffset);
      const mdatHeader = new Uint8Array(mdatHeaderSize);
      const mdDv = new DataView(mdatHeader.buffer);
      if (needs64bitMdat) {
        mdDv.setUint32(0, 1);
        mdatHeader.set([109, 100, 97, 116], 4);
        const totalMdat = mdatPayload + 16;
        mdDv.setUint32(8, Math.floor(totalMdat / 4294967296));
        mdDv.setUint32(12, totalMdat >>> 0);
      } else {
        mdDv.setUint32(0, mdatPayload + 8);
        mdatHeader.set([109, 100, 97, 116], 4);
      }
      const parts = [ftyp, moov, mdatHeader];
      for (const c of vChunks)
        parts.push(c.data);
      for (const c of aChunks)
        parts.push(c.data);
      return new Blob(parts, { type: "video/mp4" });
    }
    _buildFtyp() {
      const buf = new Uint8Array(32);
      const dv = new DataView(buf.buffer);
      dv.setUint32(0, 32);
      buf.set([102, 116, 121, 112], 4);
      buf.set([105, 115, 111, 109], 8);
      dv.setUint32(12, 512);
      buf.set([105, 115, 111, 109], 16);
      buf.set([105, 115, 111, 50], 20);
      buf.set([97, 118, 99, 49], 24);
      buf.set([109, 112, 52, 49], 28);
      return buf;
    }
    _buildMoov(vChunks, aChunks, dataOffset) {
      const timescale = 9e4;
      const vDurationTicks = vChunks.length > 0 ? Math.round(this._videoFrameCount / this.cfg.fps * timescale) : 0;
      const aDurationTicks = aChunks.length > 0 ? Math.round(this._audioSampleCount / this.cfg.audioChannels / this.cfg.audioSampleRate * timescale) : 0;
      const totalDuration = Math.max(vDurationTicks, aDurationTicks);
      const mvhd = this._buildMvhd(timescale, totalDuration);
      const children = [mvhd];
      let currentOffset = dataOffset;
      if (vChunks.length > 0) {
        const vTrak = this._buildVideoTrak(vChunks, currentOffset);
        children.push(vTrak);
        for (const c of vChunks)
          currentOffset += c.data.length;
      }
      if (aChunks.length > 0) {
        const aTrak = this._buildAudioTrak(aChunks, currentOffset);
        children.push(aTrak);
      }
      return this._mp4Container("moov", children);
    }
    _buildMvhd(timescale, duration) {
      const buf = new Uint8Array(116);
      const dv = new DataView(buf.buffer);
      dv.setUint32(0, 116);
      buf.set([109, 118, 104, 100], 4);
      dv.setUint32(12, timescale);
      dv.setUint32(16, duration);
      dv.setUint32(20, 65536);
      dv.setUint16(24, 256);
      const identity = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
      for (let i = 0; i < 9; i++)
        dv.setUint32(36 + i * 4, identity[i]);
      dv.setUint32(112, this._videoChunks.length > 0 && this._audioChunks.length > 0 ? 3 : 2);
      return buf;
    }
    _buildVideoTrak(chunks, startOffset) {
      const timescale = 9e4;
      const sampleDelta = Math.round(timescale / this.cfg.fps);
      const duration = chunks.length * sampleDelta;
      const tkhd = new Uint8Array(100);
      const tkDv = new DataView(tkhd.buffer);
      tkDv.setUint32(0, 100);
      tkhd.set([116, 107, 104, 100], 4);
      tkhd[11] = 3;
      tkDv.setUint32(12, 1);
      tkDv.setUint32(20, duration);
      const identity = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
      for (let i = 0; i < 9; i++)
        tkDv.setUint32(44 + i * 4, identity[i]);
      tkDv.setUint32(84, this.cfg.width << 16);
      tkDv.setUint32(88, this.cfg.height << 16);
      const mdhd = new Uint8Array(40);
      const mdDv = new DataView(mdhd.buffer);
      mdDv.setUint32(0, 40);
      mdhd.set([109, 100, 104, 100], 4);
      mdDv.setUint32(12, timescale);
      mdDv.setUint32(16, duration);
      mdDv.setUint16(20, 21956);
      const hdlr = new Uint8Array(45);
      new DataView(hdlr.buffer).setUint32(0, 45);
      hdlr.set([104, 100, 108, 114], 4);
      hdlr.set([118, 105, 100, 101], 16);
      hdlr.set([86, 105, 100, 101, 111, 0], 36);
      const stsdEntry = this._buildVideoStsdEntry();
      const stsd = this._mp4Box("stsd", stsdEntry, 1);
      const sttsData = new Uint8Array(8);
      const sttsDv = new DataView(sttsData.buffer);
      sttsDv.setUint32(0, chunks.length);
      sttsDv.setUint32(4, sampleDelta);
      const stts = this._mp4FullBox("stts", sttsData, 1);
      const stszData = new Uint8Array(4 + 4 + chunks.length * 4);
      const szDv = new DataView(stszData.buffer);
      szDv.setUint32(0, 0);
      szDv.setUint32(4, chunks.length);
      for (let i = 0; i < chunks.length; i++) {
        szDv.setUint32(8 + i * 4, chunks[i].data.length);
      }
      const stsz = this._mp4FullBox("stsz", stszData);
      const keyIndices = [];
      for (let i = 0; i < chunks.length; i++) {
        if (chunks[i].isKey)
          keyIndices.push(i + 1);
      }
      let stss = null;
      if (keyIndices.length > 0 && keyIndices.length < chunks.length) {
        const stssData = new Uint8Array(keyIndices.length * 4);
        const ssDv = new DataView(stssData.buffer);
        for (let i = 0; i < keyIndices.length; i++)
          ssDv.setUint32(i * 4, keyIndices[i]);
        stss = this._mp4FullBox("stss", stssData, keyIndices.length);
      }
      const stscData = new Uint8Array(12);
      const scDv = new DataView(stscData.buffer);
      scDv.setUint32(0, 1);
      scDv.setUint32(4, chunks.length);
      scDv.setUint32(8, 1);
      const stsc = this._mp4FullBox("stsc", stscData, 1);
      const usesCo64 = startOffset > 4294967295;
      let stco;
      if (usesCo64) {
        const coData = new Uint8Array(8);
        const coDv = new DataView(coData.buffer);
        coDv.setUint32(0, Math.floor(startOffset / 4294967296));
        coDv.setUint32(4, startOffset >>> 0);
        stco = this._mp4FullBox("co64", coData, 1);
      } else {
        const coData = new Uint8Array(4);
        new DataView(coData.buffer).setUint32(0, startOffset);
        stco = this._mp4FullBox("stco", coData, 1);
      }
      const stblParts = [stsd, stts, stsz, stsc, stco];
      if (stss)
        stblParts.splice(2, 0, stss);
      const stbl = this._mp4Container("stbl", stblParts);
      const vmhd = new Uint8Array(20);
      new DataView(vmhd.buffer).setUint32(0, 20);
      vmhd.set([118, 109, 104, 100], 4);
      vmhd[11] = 1;
      const dref = this._mp4FullBox("dref", new Uint8Array([0, 0, 0, 1, 0, 0, 0, 12, 117, 114, 108, 32, 0, 0, 0, 1]));
      const dinf = this._mp4Container("dinf", [dref]);
      const minf = this._mp4Container("minf", [vmhd, dinf, stbl]);
      const mdia = this._mp4Container("mdia", [mdhd, hdlr, minf]);
      return this._mp4Container("trak", [tkhd, mdia]);
    }
    _buildVideoStsdEntry() {
      const codecBase = this.cfg.videoCodec.split(".")[0].toLowerCase();
      const isH264 = codecBase.startsWith("avc");
      const isH265 = codecBase.startsWith("hvc") || codecBase.startsWith("hev");
      const isVP9 = codecBase.startsWith("vp09") || codecBase.startsWith("vp9");
      const isAV1 = codecBase.startsWith("av01") || codecBase.startsWith("av1");
      let fourcc;
      let configBoxType;
      if (isH265) {
        fourcc = [104, 118, 99, 49];
        configBoxType = "hvcC";
      } else if (isVP9) {
        fourcc = [118, 112, 48, 57];
        configBoxType = "vpcC";
      } else if (isAV1) {
        fourcc = [97, 118, 48, 49];
        configBoxType = "av1C";
      } else {
        fourcc = [97, 118, 99, 49];
        configBoxType = "avcC";
      }
      let configBox;
      if (this._videoDecoderConfig && this._videoDecoderConfig.length > 0) {
        configBox = this._mp4Container(configBoxType, [this._videoDecoderConfig]);
      } else {
        log.warn("[DirectTranscoder] No codec config from encoder \u2014 MP4 may not be playable");
        if (isH264) {
          const profile = parseInt(this.cfg.videoCodec.split(".")[1] || "42", 16) || 66;
          const compat = parseInt(this.cfg.videoCodec.split(".")[2] || "C0", 16) || 192;
          const level = parseInt(this.cfg.videoCodec.split(".")[3] || "1E", 16) || 30;
          const minAvcC = new Uint8Array([
            1,
            profile,
            compat,
            level,
            255,
            225,
            0,
            0,
            1,
            0,
            0
          ]);
          configBox = this._mp4Container("avcC", [minAvcC]);
        } else {
          configBox = new Uint8Array(0);
        }
      }
      const totalSize = 86 + configBox.length;
      const entry = new Uint8Array(totalSize);
      const dv = new DataView(entry.buffer);
      dv.setUint32(0, totalSize);
      entry.set(fourcc, 4);
      dv.setUint16(14, 1);
      dv.setUint16(32, this.cfg.width);
      dv.setUint16(34, this.cfg.height);
      dv.setUint32(36, 4718592);
      dv.setUint32(40, 4718592);
      dv.setUint16(48, 1);
      dv.setUint16(82, 24);
      dv.setInt16(84, -1);
      if (configBox.length > 0)
        entry.set(configBox, 86);
      return entry;
    }
    _buildAudioTrak(chunks, startOffset) {
      const timescale = this.cfg.audioSampleRate;
      const samplesPerChunk = 1024;
      const totalSamples = chunks.length * samplesPerChunk;
      const duration = totalSamples;
      const tkhd = new Uint8Array(100);
      const tkDv = new DataView(tkhd.buffer);
      tkDv.setUint32(0, 100);
      tkhd.set([116, 107, 104, 100], 4);
      tkhd[11] = 7;
      tkDv.setUint32(12, 2);
      tkDv.setUint32(20, Math.round(duration / timescale * 9e4));
      tkDv.setUint16(36, 256);
      const identity = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
      for (let i = 0; i < 9; i++)
        tkDv.setUint32(44 + i * 4, identity[i]);
      const mdhd = new Uint8Array(40);
      const mdDv = new DataView(mdhd.buffer);
      mdDv.setUint32(0, 40);
      mdhd.set([109, 100, 104, 100], 4);
      mdDv.setUint32(12, timescale);
      mdDv.setUint32(16, duration);
      mdDv.setUint16(20, 21956);
      const hdlr = new Uint8Array(45);
      new DataView(hdlr.buffer).setUint32(0, 45);
      hdlr.set([104, 100, 108, 114], 4);
      hdlr.set([115, 111, 117, 110], 16);
      hdlr.set([83, 111, 117, 110, 100, 0], 36);
      const stsdEntry = this._buildAudioStsdEntry();
      const stsd = this._mp4Box("stsd", stsdEntry, 1);
      const sttsData = new Uint8Array(8);
      const sttsDv = new DataView(sttsData.buffer);
      sttsDv.setUint32(0, chunks.length);
      sttsDv.setUint32(4, samplesPerChunk);
      const stts = this._mp4FullBox("stts", sttsData, 1);
      const stszData = new Uint8Array(4 + 4 + chunks.length * 4);
      const szDv = new DataView(stszData.buffer);
      szDv.setUint32(0, 0);
      szDv.setUint32(4, chunks.length);
      for (let i = 0; i < chunks.length; i++)
        szDv.setUint32(8 + i * 4, chunks[i].data.length);
      const stsz = this._mp4FullBox("stsz", stszData);
      const stscData = new Uint8Array(12);
      const scDv = new DataView(stscData.buffer);
      scDv.setUint32(0, 1);
      scDv.setUint32(4, chunks.length);
      scDv.setUint32(8, 1);
      const stsc = this._mp4FullBox("stsc", stscData, 1);
      const usesCo64 = startOffset > 4294967295;
      let stco;
      if (usesCo64) {
        const coData = new Uint8Array(8);
        const coDv = new DataView(coData.buffer);
        coDv.setUint32(0, Math.floor(startOffset / 4294967296));
        coDv.setUint32(4, startOffset >>> 0);
        stco = this._mp4FullBox("co64", coData, 1);
      } else {
        const coData = new Uint8Array(4);
        new DataView(coData.buffer).setUint32(0, startOffset);
        stco = this._mp4FullBox("stco", coData, 1);
      }
      const stbl = this._mp4Container("stbl", [stsd, stts, stsz, stsc, stco]);
      const smhd = new Uint8Array(16);
      new DataView(smhd.buffer).setUint32(0, 16);
      smhd.set([115, 109, 104, 100], 4);
      const dref = this._mp4FullBox("dref", new Uint8Array([0, 0, 0, 1, 0, 0, 0, 12, 117, 114, 108, 32, 0, 0, 0, 1]));
      const dinf = this._mp4Container("dinf", [dref]);
      const minf = this._mp4Container("minf", [smhd, dinf, stbl]);
      const mdia = this._mp4Container("mdia", [mdhd, hdlr, minf]);
      return this._mp4Container("trak", [tkhd, mdia]);
    }
    _buildAudioStsdEntry() {
      const aacProfile = 2;
      const srIdx = [96e3, 88200, 64e3, 48e3, 44100, 32e3, 24e3, 22050, 16e3, 12e3, 11025, 8e3, 7350].indexOf(this.cfg.audioSampleRate);
      const srIndex = srIdx >= 0 ? srIdx : 4;
      const audioConfig = new Uint8Array([aacProfile << 3 | srIndex >> 1, (srIndex & 1) << 7 | this.cfg.audioChannels << 3]);
      const esdsPayloadSize = 23 + audioConfig.length;
      const esdsBox = new Uint8Array(12 + esdsPayloadSize);
      const eDv = new DataView(esdsBox.buffer);
      eDv.setUint32(0, 12 + esdsPayloadSize);
      esdsBox.set([101, 115, 100, 115], 4);
      let p = 12;
      esdsBox[p++] = 3;
      esdsBox[p++] = 19 + audioConfig.length;
      eDv.setUint16(p, 1);
      p += 2;
      esdsBox[p++] = 0;
      esdsBox[p++] = 4;
      esdsBox[p++] = 11 + audioConfig.length;
      esdsBox[p++] = 64;
      esdsBox[p++] = 21;
      p += 3;
      eDv.setUint32(p, this.cfg.audioBitrate);
      p += 4;
      eDv.setUint32(p, this.cfg.audioBitrate);
      p += 4;
      esdsBox[p++] = 5;
      esdsBox[p++] = audioConfig.length;
      esdsBox.set(audioConfig, p);
      p += audioConfig.length;
      esdsBox[p++] = 6;
      esdsBox[p++] = 1;
      esdsBox[p++] = 2;
      const totalSize = 36 + esdsBox.length;
      const entry = new Uint8Array(totalSize);
      const dv = new DataView(entry.buffer);
      dv.setUint32(0, totalSize);
      entry.set([109, 112, 52, 97], 4);
      dv.setUint16(14, 1);
      dv.setUint16(24, this.cfg.audioChannels);
      dv.setUint16(26, 16);
      dv.setUint32(32, this.cfg.audioSampleRate << 16);
      entry.set(esdsBox, 36);
      return entry;
    }
    _muxWebM() {
      const ebml = this._ebml;
      const parts = [];
      parts.push(ebml(440786851, [
        ebml(17030, this._ebmlUint(1)),
        ebml(17143, this._ebmlUint(1)),
        ebml(17138, this._ebmlUint(4)),
        ebml(17139, this._ebmlUint(8)),
        ebml(17026, TE.encode("webm")),
        ebml(17031, this._ebmlUint(4)),
        ebml(17029, this._ebmlUint(2))
      ]));
      const durationMs = this._videoFrameCount / this.cfg.fps * 1e3;
      const info = ebml(357149030, [
        ebml(2807729, this._ebmlUint(1e6)),
        ebml(19840, TE.encode("AegisForge")),
        ebml(22337, TE.encode("AegisForge")),
        ebml(17545, this._ebmlFloat64(durationMs))
      ]);
      const trackEntries = [];
      const codecId = this.cfg.videoCodec.includes("vp9") ? "V_VP9" : this.cfg.videoCodec.includes("av1") ? "V_AV1" : "V_VP8";
      trackEntries.push(ebml(174, [
        ebml(215, this._ebmlUint(1)),
        ebml(29637, this._ebmlUint(1)),
        ebml(131, this._ebmlUint(1)),
        ebml(134, TE.encode(codecId)),
        ebml(224, [
          ebml(176, this._ebmlUint(this.cfg.width)),
          ebml(186, this._ebmlUint(this.cfg.height))
        ])
      ]));
      if (this._audioChunks.length > 0) {
        const aCodecId = this.cfg.audioCodec.includes("opus") ? "A_OPUS" : "A_AAC";
        trackEntries.push(ebml(174, [
          ebml(215, this._ebmlUint(2)),
          ebml(29637, this._ebmlUint(2)),
          ebml(131, this._ebmlUint(2)),
          ebml(134, TE.encode(aCodecId)),
          ebml(225, [
            ebml(181, this._ebmlFloat64(this.cfg.audioSampleRate)),
            ebml(159, this._ebmlUint(this.cfg.audioChannels))
          ])
        ]));
      }
      const tracks = ebml(374648427, trackEntries);
      const MAX_CLUSTER_MS = 3e4;
      const frameDurMs = 1e3 / this.cfg.fps;
      const clusters = [];
      let clusterStartMs = 0;
      let clusterChildren = [];
      let needsNewCluster = true;
      for (let i = 0; i < this._videoChunks.length; i++) {
        const timeMs = Math.round(i * frameDurMs);
        const chunk = this._videoChunks[i];
        const relativeMs = timeMs - clusterStartMs;
        if (needsNewCluster || chunk.isKey && relativeMs >= MAX_CLUSTER_MS) {
          if (clusterChildren.length > 0) {
            clusters.push(ebml(524531317, clusterChildren));
          }
          clusterStartMs = timeMs;
          clusterChildren = [ebml(231, this._ebmlUint(timeMs))];
          needsNewCluster = false;
        }
        const blockTimecode = timeMs - clusterStartMs;
        const tc16 = Math.max(-32768, Math.min(32767, blockTimecode));
        const simpleBlockHeader = new Uint8Array(4);
        simpleBlockHeader[0] = 129;
        simpleBlockHeader[1] = tc16 >> 8 & 255;
        simpleBlockHeader[2] = tc16 & 255;
        simpleBlockHeader[3] = chunk.isKey ? 128 : 0;
        const blockData = new Uint8Array(4 + chunk.data.length);
        blockData.set(simpleBlockHeader);
        blockData.set(chunk.data, 4);
        clusterChildren.push(ebml(163, blockData));
      }
      for (let i = 0; i < this._audioChunks.length; i++) {
        const achunk = this._audioChunks[i];
        const timeMs = Math.round(achunk.timestamp / 1e3);
        const tc16 = Math.max(-32768, Math.min(32767, timeMs - clusterStartMs));
        const simpleBlockHeader = new Uint8Array(4);
        simpleBlockHeader[0] = 130;
        simpleBlockHeader[1] = tc16 >> 8 & 255;
        simpleBlockHeader[2] = tc16 & 255;
        simpleBlockHeader[3] = 128;
        const blockData = new Uint8Array(4 + achunk.data.length);
        blockData.set(simpleBlockHeader);
        blockData.set(achunk.data, 4);
        clusterChildren.push(ebml(163, blockData));
      }
      if (clusterChildren.length > 0) {
        clusters.push(ebml(524531317, clusterChildren));
      }
      const segContent = this._concatArrays([info, tracks, ...clusters]);
      const segHeader = this._ebmlId(408125543);
      const segSize = new Uint8Array([1, 255, 255, 255, 255, 255, 255, 255]);
      parts.push(segHeader, segSize, segContent);
      return new Blob(parts, { type: "video/webm" });
    }
    _ebml(id, content) {
      const idBytes = this._ebmlId(id);
      const data = Array.isArray(content) ? this._concatArrays(content) : content;
      const sizeBytes = this._ebmlSize(data.length);
      const result = new Uint8Array(idBytes.length + sizeBytes.length + data.length);
      result.set(idBytes);
      result.set(sizeBytes, idBytes.length);
      result.set(data, idBytes.length + sizeBytes.length);
      return result;
    }
    _ebmlId(id) {
      if (id <= 255)
        return new Uint8Array([id]);
      if (id <= 65535)
        return new Uint8Array([id >> 8 & 255, id & 255]);
      if (id <= 16777215)
        return new Uint8Array([id >> 16 & 255, id >> 8 & 255, id & 255]);
      return new Uint8Array([id >> 24 & 255, id >> 16 & 255, id >> 8 & 255, id & 255]);
    }
    _ebmlSize(size) {
      if (size < 127)
        return new Uint8Array([128 | size]);
      if (size < 16383)
        return new Uint8Array([64 | size >> 8 & 63, size & 255]);
      if (size < 2097151)
        return new Uint8Array([32 | size >> 16 & 31, size >> 8 & 255, size & 255]);
      if (size < 268435455)
        return new Uint8Array([
          16 | size >> 24 & 15,
          size >> 16 & 255,
          size >> 8 & 255,
          size & 255
        ]);
      const buf = new Uint8Array(8);
      buf[0] = 1;
      const dv = new DataView(buf.buffer);
      dv.setUint32(4, size >>> 0);
      return buf;
    }
    _ebmlUint(val) {
      if (val <= 255)
        return new Uint8Array([val]);
      if (val <= 65535)
        return new Uint8Array([val >> 8 & 255, val & 255]);
      if (val <= 16777215)
        return new Uint8Array([val >> 16 & 255, val >> 8 & 255, val & 255]);
      const buf = new Uint8Array(4);
      new DataView(buf.buffer).setUint32(0, val);
      return buf;
    }
    _ebmlFloat64(val) {
      const buf = new Uint8Array(8);
      new DataView(buf.buffer).setFloat64(0, val);
      return buf;
    }
    _concatArrays(arrays) {
      let total = 0;
      for (const a of arrays)
        total += a.length;
      const result = new Uint8Array(total);
      let off = 0;
      for (const a of arrays) {
        result.set(a, off);
        off += a.length;
      }
      return result;
    }
    _mp4Box(type, data, entryCount) {
      const hasEntry = entryCount !== void 0;
      const size = 8 + 4 + (hasEntry ? 4 : 0) + data.length;
      const buf = new Uint8Array(size);
      const dv = new DataView(buf.buffer);
      dv.setUint32(0, size);
      buf.set(TE.encode(type), 4);
      let off = 12;
      if (hasEntry) {
        dv.setUint32(off, entryCount);
        off += 4;
      }
      buf.set(data, off);
      return buf;
    }
    _mp4FullBox(type, data, entryCount) {
      const hasEntry = entryCount !== void 0;
      const size = 12 + (hasEntry ? 4 : 0) + data.length;
      const buf = new Uint8Array(size);
      new DataView(buf.buffer).setUint32(0, size);
      buf.set(TE.encode(type), 4);
      let off = 12;
      if (hasEntry) {
        new DataView(buf.buffer).setUint32(off, entryCount);
        off += 4;
      }
      buf.set(data, off);
      return buf;
    }
    _mp4Container(type, children) {
      let childSize = 0;
      for (const c of children)
        childSize += c.length;
      const size = 8 + childSize;
      const buf = new Uint8Array(size);
      new DataView(buf.buffer).setUint32(0, size);
      buf.set(TE.encode(type), 4);
      let off = 8;
      for (const c of children) {
        buf.set(c, off);
        off += c.length;
      }
      return buf;
    }
    _updateProgress(phase, frames) {
      this._progress = {
        phase,
        framesProcessed: frames,
        totalEstimate: Math.max(frames, this._progress.totalEstimate),
        percent: this._progress.totalEstimate > 0 ? frames / this._progress.totalEstimate * 100 : 0,
        elapsedMs: performance.now() - this._startTime
      };
      if (this._onProgress)
        this._onProgress(this._progress);
    }
  };

  // src/core/frame_cache.ts
  var DEFAULT_CACHE_CFG = {
    maxMemoryMB: 512,
    maxFrames: 300,
    prefetchAhead: 10,
    prefetchBehind: 3,
    evictionPolicy: "lru"
  };
  var FrameCache = class {
    cfg;
    _frames = /* @__PURE__ */ new Map();
    _usedBytes = 0;
    _maxBytes;
    _gopTable = /* @__PURE__ */ new Map();
    _stats = { hits: 0, misses: 0, evictions: 0, prefetches: 0 };
    constructor(config) {
      this.cfg = { ...DEFAULT_CACHE_CFG, ...config };
      this._maxBytes = this.cfg.maxMemoryMB * 1024 * 1024;
    }
    get(sourceId, timestamp) {
      const key = this._key(sourceId, timestamp);
      const frame = this._frames.get(key);
      if (frame) {
        frame.lastAccess = performance.now();
        frame.accessCount++;
        this._stats.hits++;
        return frame;
      }
      this._stats.misses++;
      return null;
    }
    getNearest(sourceId, timestamp, toleranceMs = 33.34) {
      let best = null;
      let bestDist = Infinity;
      for (const [_, frame] of this._frames) {
        if (frame.sourceId !== sourceId)
          continue;
        const dist = Math.abs(frame.timestamp - timestamp);
        if (dist < bestDist && dist <= toleranceMs) {
          bestDist = dist;
          best = frame;
        }
      }
      if (best) {
        best.lastAccess = performance.now();
        best.accessCount++;
        this._stats.hits++;
      }
      return best;
    }
    put(frame) {
      const key = this._key(frame.sourceId, frame.timestamp);
      if (this._frames.has(key)) {
        const old = this._frames.get(key);
        this._usedBytes -= old.byteSize;
        this._disposeFrame(old);
      }
      while (this._usedBytes + frame.byteSize > this._maxBytes || this._frames.size >= this.cfg.maxFrames) {
        if (!this._evictOne())
          break;
      }
      frame.lastAccess = performance.now();
      this._frames.set(key, frame);
      this._usedBytes += frame.byteSize;
    }
    buildGOPTable(sourceId, keyframes, totalFrames, fps) {
      const gops = [];
      for (let i = 0; i < keyframes.length; i++) {
        const kf = keyframes[i];
        const nextKf = i + 1 < keyframes.length ? keyframes[i + 1] : null;
        const endPts = nextKf ? nextKf.pts : kf.pts + (totalFrames - kf.idx) / fps;
        gops.push({
          keyframePts: kf.pts,
          keyframeIdx: kf.idx,
          endPts,
          frameCount: nextKf ? nextKf.idx - kf.idx : totalFrames - kf.idx
        });
      }
      this._gopTable.set(sourceId, gops);
    }
    findKeyframeForSeek(sourceId, targetPts) {
      const gops = this._gopTable.get(sourceId);
      if (!gops || gops.length === 0)
        return null;
      let lo = 0, hi = gops.length - 1;
      while (lo < hi) {
        const mid = lo + hi + 1 >> 1;
        if (gops[mid].keyframePts <= targetPts)
          lo = mid;
        else
          hi = mid - 1;
      }
      return gops[lo];
    }
    getFramesBetween(sourceId, startPts, endPts) {
      const result = [];
      for (const [_, frame] of this._frames) {
        if (frame.sourceId === sourceId && frame.timestamp >= startPts && frame.timestamp < endPts) {
          result.push(frame);
        }
      }
      return result.sort((a, b) => a.timestamp - b.timestamp);
    }
    prefetchRange(sourceId, centerPts, fps) {
      const frameDur = 1e3 / fps;
      const start = centerPts - this.cfg.prefetchBehind * frameDur;
      const end = centerPts + this.cfg.prefetchAhead * frameDur;
      this._stats.prefetches++;
      return { start, end };
    }
    invalidateSource(sourceId) {
      let freed = 0;
      const toDelete = [];
      for (const [key, frame] of this._frames) {
        if (frame.sourceId === sourceId) {
          this._usedBytes -= frame.byteSize;
          this._disposeFrame(frame);
          toDelete.push(key);
          freed += frame.byteSize;
        }
      }
      for (const k of toDelete)
        this._frames.delete(k);
      return freed;
    }
    invalidateRange(sourceId, startPts, endPts) {
      let freed = 0;
      const toDelete = [];
      for (const [key, frame] of this._frames) {
        if (frame.sourceId === sourceId && frame.timestamp >= startPts && frame.timestamp < endPts) {
          this._usedBytes -= frame.byteSize;
          this._disposeFrame(frame);
          toDelete.push(key);
          freed += frame.byteSize;
        }
      }
      for (const k of toDelete)
        this._frames.delete(k);
      return freed;
    }
    purgeAll() {
      const freed = this._usedBytes;
      for (const [_, frame] of this._frames)
        this._disposeFrame(frame);
      this._frames.clear();
      this._usedBytes = 0;
      return freed;
    }
    get stats() {
      return {
        ...this._stats,
        cachedFrames: this._frames.size,
        usedMB: this._usedBytes / (1024 * 1024),
        hitRate: this._stats.hits + this._stats.misses > 0 ? this._stats.hits / (this._stats.hits + this._stats.misses) : 0
      };
    }
    _evictOne() {
      if (this._frames.size === 0)
        return false;
      let victim = null;
      if (this.cfg.evictionPolicy === "lru") {
        let oldestAccess = Infinity;
        for (const entry of this._frames) {
          if (entry[1].lastAccess < oldestAccess) {
            oldestAccess = entry[1].lastAccess;
            victim = entry;
          }
        }
      } else {
        let leastFreq = Infinity;
        for (const entry of this._frames) {
          if (entry[1].accessCount < leastFreq) {
            leastFreq = entry[1].accessCount;
            victim = entry;
          }
        }
      }
      if (victim) {
        this._usedBytes -= victim[1].byteSize;
        this._disposeFrame(victim[1]);
        this._frames.delete(victim[0]);
        this._stats.evictions++;
        return true;
      }
      return false;
    }
    _disposeFrame(frame) {
      if (frame.data) {
        try {
          frame.data.close();
        } catch (_) {
        }
        frame.data = null;
      }
      frame.rgba = null;
    }
    _key(sourceId, timestamp) {
      return sourceId + ":" + Math.round(timestamp * 10);
    }
  };

  // src/core/fast_pipeline.ts
  init_core();
  var DEFAULT_PIPE = {
    width: 1920,
    height: 1080,
    fps: 30,
    totalFrames: 0,
    batchSize: 8,
    maxConcurrentDecode: 4,
    skipIdenticalFrames: true,
    useFrameCache: true,
    backpressureThreshold: 16
  };
  var FastRenderPipeline = class {
    cfg;
    _clipTree;
    _cache;
    _lastClipSet = "";
    _lastFrameHash = 0;
    _pendingEncodes = 0;
    _stats;
    _onFrame = null;
    _onBatch = null;
    _running = false;
    constructor(config) {
      this.cfg = { ...DEFAULT_PIPE, ...config };
      this._clipTree = new IntervalTree();
      this._cache = new FrameCache({ maxMemoryMB: 512, maxFrames: 600, prefetchAhead: 15 });
      this._stats = this._emptyStats();
    }
    get clipTree() {
      return this._clipTree;
    }
    get cache() {
      return this._cache;
    }
    loadClips(clips) {
      this._clipTree.buildFromClips(clips);
    }
    onFrame(cb) {
      this._onFrame = cb;
    }
    onBatch(cb) {
      this._onBatch = cb;
    }
    async render(decodeFrame, encodeFrame) {
      this._running = true;
      this._stats = this._emptyStats();
      this._stats.totalFrames = this.cfg.totalFrames;
      const t0 = performance.now();
      const frameDur = 1e3 / this.cfg.fps;
      let batchResults = [];
      for (let i = 0; i < this.cfg.totalFrames && this._running; i++) {
        const timestamp = i * frameDur;
        const frameStart = performance.now();
        const activeClips = this._clipTree.queryPoint(timestamp);
        const clipSetKey = this._clipSetHash(activeClips, timestamp);
        if (this.cfg.skipIdenticalFrames && clipSetKey === this._lastClipSet && activeClips.length > 0) {
          const result2 = {
            frameIndex: i,
            timestamp,
            skipped: true,
            fromCache: false,
            renderTimeMs: performance.now() - frameStart
          };
          this._stats.skippedFrames++;
          batchResults.push(result2);
          if (this._onFrame)
            this._onFrame(result2);
          if (batchResults.length >= this.cfg.batchSize) {
            if (this._onBatch)
              this._onBatch(batchResults);
            batchResults = [];
          }
          continue;
        }
        this._lastClipSet = clipSetKey;
        let cached = null;
        let fromCache = false;
        if (this.cfg.useFrameCache && activeClips.length > 0) {
          const primary = activeClips[0];
          const clipData = primary.data;
          const sourceTime = timestamp - primary.lo + (clipData?.sourceStart || 0);
          cached = this._cache.get(clipData?.sourceId || primary.id, sourceTime);
          if (cached)
            fromCache = true;
        }
        if (!cached && activeClips.length > 0) {
          const decodePromises = [];
          const toDecode = activeClips.slice(0, this.cfg.maxConcurrentDecode);
          for (const clip of toDecode) {
            const clipData = clip.data;
            const sourceTime = timestamp - clip.lo + (clipData?.sourceStart || 0);
            const sourceId = clipData?.sourceId || clip.id;
            if (this.cfg.useFrameCache) {
              const nearest = this._cache.getNearest(sourceId, sourceTime);
              if (nearest) {
                cached = nearest;
                fromCache = true;
                break;
              }
            }
            decodePromises.push(decodeFrame(sourceId, sourceTime));
          }
          if (!fromCache && decodePromises.length > 0) {
            try {
              const results = await Promise.all(decodePromises);
              cached = results.find((r) => r !== null) || null;
              if (cached && this.cfg.useFrameCache) {
                this._cache.put(cached);
              }
            } catch (decodeErr) {
              log.warn("[FastPipeline] Frame decode failed, skipping frame", decodeErr);
            }
          }
        }
        while (this._pendingEncodes >= this.cfg.backpressureThreshold) {
          await new Promise((r) => setTimeout(r, 1));
        }
        if (cached) {
          this._pendingEncodes++;
          try {
            const output = cached.data || cached.rgba;
            if (output)
              await encodeFrame(output, timestamp * 1e3);
          } catch (encodeErr) {
            log.error("[FastPipeline] Frame encode failed", encodeErr);
            throw encodeErr;
          }
          this._pendingEncodes--;
          this._stats.renderedFrames++;
        }
        if (fromCache)
          this._stats.cachedFrames++;
        const renderTime = performance.now() - frameStart;
        const result = { frameIndex: i, timestamp, skipped: false, fromCache, renderTimeMs: renderTime };
        batchResults.push(result);
        if (this._onFrame)
          this._onFrame(result);
        if (batchResults.length >= this.cfg.batchSize) {
          if (this._onBatch)
            this._onBatch(batchResults);
          batchResults = [];
        }
      }
      if (batchResults.length > 0 && this._onBatch)
        this._onBatch(batchResults);
      const totalMs = performance.now() - t0;
      this._stats.totalMs = totalMs;
      this._stats.avgRenderMs = this._stats.renderedFrames > 0 ? totalMs / this._stats.renderedFrames : 0;
      this._stats.fps = totalMs > 0 ? this._stats.renderedFrames / (totalMs / 1e3) : 0;
      this._stats.cacheHitRate = this._cache.stats.hitRate;
      this._running = false;
      return this._stats;
    }
    stop() {
      this._running = false;
    }
    async renderRange(startFrame, endFrame, decodeFrame, encodeFrame) {
      const originalTotal = this.cfg.totalFrames;
      this.cfg.totalFrames = endFrame - startFrame;
      const origCfg = { ...this.cfg };
      const stats = await this.render(
        (sourceId, ts) => decodeFrame(sourceId, ts + startFrame * (1e3 / this.cfg.fps)),
        encodeFrame
      );
      this.cfg.totalFrames = originalTotal;
      return stats;
    }
    _clipSetHash(clips, timestamp) {
      if (clips.length === 0)
        return "";
      let h = 2166136261;
      for (const c of clips) {
        for (let i = 0; i < c.id.length; i++) {
          h ^= c.id.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
      }
      h ^= Math.round(timestamp * 10);
      h = Math.imul(h, 16777619);
      return String(h >>> 0);
    }
    _emptyStats() {
      return {
        totalFrames: 0,
        renderedFrames: 0,
        skippedFrames: 0,
        cachedFrames: 0,
        avgRenderMs: 0,
        totalMs: 0,
        fps: 0,
        cacheHitRate: 0
      };
    }
  };

  // src/interactive.ts
  var InteractiveCanvas = class {
    canvas;
    ctx;
    sprites = [];
    selected = null;
    _dragging = false;
    _zone = 0 /* None */;
    _startX = 0;
    _startY = 0;
    _origX = 0;
    _origY = 0;
    _origW = 0;
    _origH = 0;
    _origR = 0;
    _hSize;
    _hColor;
    _gColor;
    _snap;
    _onChange;
    _pinchDist = 0;
    _pinchAngle = 0;
    _rafId = 0;
    constructor(container, opts) {
      const w = opts?.width ?? 1280, h = opts?.height ?? 720;
      this._hSize = opts?.handleSize ?? 8;
      this._hColor = opts?.handleColor ?? "#00aaff";
      this._gColor = opts?.guideColor ?? "rgba(0,170,255,0.4)";
      this._snap = opts?.snapThreshold ?? 5;
      this._onChange = opts?.onChange ?? null;
      this.canvas = document.createElement("canvas");
      this.canvas.width = w;
      this.canvas.height = h;
      this.canvas.style.cssText = "touch-action:none;user-select:none;display:block;max-width:100%;cursor:default;";
      this.ctx = this.canvas.getContext("2d");
      container.appendChild(this.canvas);
      this.canvas.addEventListener("pointerdown", this._onDown);
      this.canvas.addEventListener("pointermove", this._onMove);
      this.canvas.addEventListener("pointerup", this._onUp);
      this.canvas.addEventListener("pointercancel", this._onUp);
      this.canvas.addEventListener("touchstart", this._onTouch, { passive: false });
      this.canvas.addEventListener("touchmove", this._onTouch, { passive: false });
      this.canvas.addEventListener("touchend", this._onTouchEnd);
      this._loop();
    }
    addSprite(opts) {
      const s = {
        id: opts.id ?? Math.random().toString(36).slice(2, 9),
        source: opts.source,
        x: opts.x ?? 0,
        y: opts.y ?? 0,
        w: opts.w ?? 200,
        h: opts.h ?? 200,
        rotation: opts.rotation ?? 0,
        scaleX: opts.scaleX ?? 1,
        scaleY: opts.scaleY ?? 1,
        opacity: opts.opacity ?? 1,
        locked: opts.locked ?? false,
        visible: opts.visible ?? true
      };
      this.sprites.push(s);
      return s;
    }
    removeSprite(id) {
      this.sprites = this.sprites.filter((s) => s.id !== id);
      if (this.selected?.id === id)
        this.selected = null;
    }
    dispose() {
      cancelAnimationFrame(this._rafId);
      this.canvas.removeEventListener("pointerdown", this._onDown);
      this.canvas.removeEventListener("pointermove", this._onMove);
      this.canvas.removeEventListener("pointerup", this._onUp);
      this.canvas.removeEventListener("pointercancel", this._onUp);
      this.canvas.removeEventListener("touchstart", this._onTouch);
      this.canvas.removeEventListener("touchmove", this._onTouch);
      this.canvas.removeEventListener("touchend", this._onTouchEnd);
      this.canvas.remove();
    }
    _loop = () => {
      this._draw();
      this._rafId = requestAnimationFrame(this._loop);
    };
    _draw() {
      const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
      c.clearRect(0, 0, W, H);
      c.fillStyle = "#111";
      c.fillRect(0, 0, W, H);
      for (const s of this.sprites) {
        if (!s.visible || !s.source)
          continue;
        c.save();
        c.globalAlpha = s.opacity;
        c.translate(s.x + s.w * s.scaleX / 2, s.y + s.h * s.scaleY / 2);
        c.rotate(s.rotation);
        c.scale(s.scaleX, s.scaleY);
        c.drawImage(s.source, -s.w / 2, -s.h / 2, s.w, s.h);
        c.restore();
      }
      if (this.selected && !this.selected.locked)
        this._drawHandles(this.selected);
    }
    _drawHandles(s) {
      const c = this.ctx, hw = s.w * s.scaleX / 2, hh = s.h * s.scaleY / 2;
      c.save();
      c.translate(s.x + hw, s.y + hh);
      c.rotate(s.rotation);
      c.strokeStyle = this._hColor;
      c.lineWidth = 1.5;
      c.setLineDash([4, 3]);
      c.strokeRect(-hw, -hh, hw * 2, hh * 2);
      c.setLineDash([]);
      const hs = this._hSize, corners = [
        [-hw, -hh],
        [hw, -hh],
        [-hw, hh],
        [hw, hh]
      ];
      c.fillStyle = "#fff";
      c.strokeStyle = this._hColor;
      c.lineWidth = 2;
      for (const [cx, cy] of corners) {
        c.beginPath();
        c.arc(cx, cy, hs, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
      c.beginPath();
      c.moveTo(0, -hh);
      c.lineTo(0, -hh - 25);
      c.strokeStyle = this._gColor;
      c.lineWidth = 1.5;
      c.stroke();
      c.fillStyle = this._hColor;
      c.beginPath();
      c.arc(0, -hh - 25, hs, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    _toLocal(e) {
      const r = this.canvas.getBoundingClientRect();
      return [
        (e.clientX - r.left) * (this.canvas.width / r.width),
        (e.clientY - r.top) * (this.canvas.height / r.height)
      ];
    }
    _hitTest(mx, my) {
      for (let i = this.sprites.length - 1; i >= 0; i--) {
        const s = this.sprites[i];
        if (!s.visible || s.locked)
          continue;
        const hw = s.w * s.scaleX / 2, hh = s.h * s.scaleY / 2;
        const cx = s.x + hw, cy = s.y + hh;
        const cos = Math.cos(-s.rotation), sin = Math.sin(-s.rotation);
        const dx = mx - cx, dy = my - cy;
        const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
        const rh = this._hSize + 4;
        if (Math.abs(lx) < rh && Math.abs(ly - (-hh - 25)) < rh)
          return [s, 6 /* RotateHandle */];
        if (Math.abs(lx - -hw) < rh && Math.abs(ly - -hh) < rh)
          return [s, 2 /* TL */];
        if (Math.abs(lx - hw) < rh && Math.abs(ly - -hh) < rh)
          return [s, 3 /* TR */];
        if (Math.abs(lx - -hw) < rh && Math.abs(ly - hh) < rh)
          return [s, 4 /* BL */];
        if (Math.abs(lx - hw) < rh && Math.abs(ly - hh) < rh)
          return [s, 5 /* BR */];
        if (lx >= -hw && lx <= hw && ly >= -hh && ly <= hh)
          return [s, 1 /* Body */];
      }
      return [null, 0 /* None */];
    }
    _onDown = (e) => {
      const [mx, my] = this._toLocal(e);
      const [hit, zone] = this._hitTest(mx, my);
      if (hit) {
        if (this.selected !== hit) {
          if (this.selected)
            this._onChange?.(this.selected, "deselect");
          this.selected = hit;
          this._onChange?.(hit, "select");
        }
        this._dragging = true;
        this._zone = zone;
        this._startX = mx;
        this._startY = my;
        this._origX = hit.x;
        this._origY = hit.y;
        this._origW = hit.w * hit.scaleX;
        this._origH = hit.h * hit.scaleY;
        this._origR = hit.rotation;
        this.canvas.setPointerCapture(e.pointerId);
      } else {
        if (this.selected)
          this._onChange?.(this.selected, "deselect");
        this.selected = null;
      }
    };
    _onMove = (e) => {
      if (!this._dragging || !this.selected) {
        const [mx2, my2] = this._toLocal(e);
        const [, z] = this._hitTest(mx2, my2);
        this.canvas.style.cursor = z === 1 /* Body */ ? "move" : z === 6 /* RotateHandle */ ? "crosshair" : z !== 0 /* None */ ? "nwse-resize" : "default";
        return;
      }
      const [mx, my] = this._toLocal(e);
      const s = this.selected;
      const hw = this._origW / 2, hh = this._origH / 2;
      const cx = this._origX + hw, cy = this._origY + hh;
      if (this._zone === 1 /* Body */) {
        s.x = this._origX + (mx - this._startX);
        s.y = this._origY + (my - this._startY);
        const snap = this._snap, cw = this.canvas.width, ch = this.canvas.height;
        const scx = s.x + s.w * s.scaleX / 2, scy = s.y + s.h * s.scaleY / 2;
        if (Math.abs(scx - cw / 2) < snap)
          s.x = cw / 2 - s.w * s.scaleX / 2;
        if (Math.abs(scy - ch / 2) < snap)
          s.y = ch / 2 - s.h * s.scaleY / 2;
        this._onChange?.(s, "move");
      } else if (this._zone === 6 /* RotateHandle */) {
        s.rotation = Math.atan2(my - cy, mx - cx) + Math.PI / 2;
        this._onChange?.(s, "rotate");
      } else {
        const cos = Math.cos(-s.rotation), sin = Math.sin(-s.rotation);
        const dx = mx - cx, dy = my - cy;
        const lx = Math.abs(dx * cos - dy * sin), ly = Math.abs(dx * sin + dy * cos);
        const newW = Math.max(20, lx * 2), newH = Math.max(20, ly * 2);
        s.scaleX = newW / s.w;
        s.scaleY = newH / s.h;
        s.x = cx - newW / 2;
        s.y = cy - newH / 2;
        this._onChange?.(s, "scale");
      }
      this._onChange?.(s, "change");
    };
    _onUp = (_) => {
      this._dragging = false;
      this._zone = 0 /* None */;
    };
    _onTouch = (e) => {
      e.preventDefault();
      if (e.touches.length === 2 && this.selected) {
        const [ax, ay] = this._toLocal(e.touches[0]);
        const [bx, by] = this._toLocal(e.touches[1]);
        const dist = Math.hypot(bx - ax, by - ay);
        const angle = Math.atan2(by - ay, bx - ax);
        if (this._pinchDist > 0) {
          const ratio = dist / this._pinchDist;
          this.selected.scaleX *= ratio;
          this.selected.scaleY *= ratio;
          this.selected.rotation += angle - this._pinchAngle;
          this._onChange?.(this.selected, "change");
        }
        this._pinchDist = dist;
        this._pinchAngle = angle;
      }
    };
    _onTouchEnd = () => {
      this._pinchDist = 0;
    };
  };

  // src/recorder.ts
  var FLUSH_TIMEOUT_MS = 1e4;
  var MediaStreamRecorder = class {
    _stream = null;
    _worker = null;
    _workerBlobUrl = null;
    _vReader = null;
    _aReader = null;
    _running = false;
    _paused = false;
    _startTs = 0;
    _pauseTs = 0;
    _pauseAcc = 0;
    _opts;
    _resolveFlush = null;
    _rejectFlush = null;
    constructor(opts) {
      this._opts = {
        width: opts?.width ?? 1280,
        height: opts?.height ?? 720,
        fps: opts?.fps ?? 30,
        videoBitrate: opts?.videoBitrate ?? 4e6,
        videoCodec: opts?.videoCodec ?? "vp8",
        audioBitrate: opts?.audioBitrate ?? 128e3,
        audioSampleRate: opts?.audioSampleRate ?? 48e3,
        audioChannels: opts?.audioChannels ?? 2,
        mp4: opts?.mp4 ?? true,
        onError: opts?.onError ?? (() => {
        }),
        onProgress: opts?.onProgress ?? (() => {
        })
      };
    }
    async start(stream) {
      this._stream = stream;
      this._running = true;
      this._paused = false;
      this._pauseAcc = 0;
      this._startTs = -1;
      const hasVideo = stream.getVideoTracks().length > 0;
      const hasAudio = stream.getAudioTracks().length > 0;
      const blob = new Blob([WORKER_SCRIPT], { type: "text/javascript" });
      const workerUrl = URL.createObjectURL(blob);
      this._worker = new Worker(workerUrl);
      this._workerBlobUrl = workerUrl;
      this._worker.onmessage = (e) => {
        if (e.data.type === "done")
          this._resolveFlush?.(e.data.buffer);
        if (e.data.type === "error") {
          const err = new Error(e.data.error);
          this._rejectFlush?.(err);
          this._opts.onError(err);
        }
      };
      this._worker.onerror = (e) => {
        const err = new Error(`Worker error: ${e.message}`);
        this._rejectFlush?.(err);
        this._opts.onError(err);
      };
      const o = this._opts;
      this._worker.postMessage({
        type: "init",
        payload: {
          mp4Container: o.mp4,
          video: hasVideo ? { width: o.width, height: o.height, framerate: o.fps, bitrate: o.videoBitrate, codec: o.videoCodec } : void 0,
          audio: hasAudio ? { sampleRate: o.audioSampleRate, numberOfChannels: o.audioChannels, bitrate: o.audioBitrate } : void 0
        }
      });
      if (hasVideo)
        this._pumpVideo(stream);
      if (hasAudio)
        this._pumpAudio(stream);
    }
    async _pumpVideo(stream) {
      try {
        const track = stream.getVideoTracks()[0];
        if (!MediaStreamTrackProcessor)
          throw new Error("[Recorder] MediaStreamTrackProcessor not available");
        const processor = new MediaStreamTrackProcessor({ track });
        this._vReader = processor.readable.getReader();
        let frameIdx = 0;
        while (this._running) {
          const { value: frame, done } = await this._vReader.read();
          if (done || !frame)
            break;
          if (this._paused) {
            frame.close();
            continue;
          }
          if (this._startTs < 0)
            this._startTs = frame.timestamp;
          const ts = frame.timestamp - this._startTs - this._pauseAcc;
          this._opts.onProgress(ts / 1e6);
          if (!this._worker) {
            frame.close();
            break;
          }
          this._worker.postMessage({
            type: "encode-video",
            payload: { frame, keyFrame: frameIdx % 60 === 0 }
          }, [frame]);
          frameIdx++;
        }
      } catch (e) {
        this._opts.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
    async _pumpAudio(stream) {
      try {
        const track = stream.getAudioTracks()[0];
        if (!MediaStreamTrackProcessor)
          throw new Error("[Recorder] MediaStreamTrackProcessor not available");
        const processor = new MediaStreamTrackProcessor({ track });
        this._aReader = processor.readable.getReader();
        while (this._running) {
          const { value: audioData, done } = await this._aReader.read();
          if (done || !audioData)
            break;
          if (this._paused) {
            audioData.close();
            continue;
          }
          if (!this._worker) {
            audioData.close();
            break;
          }
          this._worker.postMessage({
            type: "encode-audio",
            payload: { audioData }
          }, [audioData]);
        }
      } catch (e) {
        this._opts.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
    pause() {
      if (!this._running || this._paused)
        return;
      this._paused = true;
      this._pauseTs = performance.now() * 1e3;
    }
    resume() {
      if (!this._running || !this._paused)
        return;
      this._pauseAcc += performance.now() * 1e3 - this._pauseTs;
      this._paused = false;
    }
    async stop() {
      this._running = false;
      try {
        this._vReader?.cancel();
      } catch {
      }
      try {
        this._aReader?.cancel();
      } catch {
      }
      this._stream?.getTracks().forEach((t) => t.stop());
      if (!this._worker)
        throw new Error("[Recorder] No active worker");
      let settled = false;
      const buffer = await new Promise((resolve, reject) => {
        this._resolveFlush = (v) => {
          if (!settled) {
            settled = true;
            resolve(v);
          }
        };
        this._rejectFlush = (e) => {
          if (!settled) {
            settled = true;
            reject(e);
          }
        };
        this._worker.postMessage({ type: "flush" });
        setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error("[Recorder] Flush timed out after 10s \u2014 worker unresponsive"));
          }
        }, FLUSH_TIMEOUT_MS);
      }).finally(() => {
        if (this._workerBlobUrl) {
          URL.revokeObjectURL(this._workerBlobUrl);
          this._workerBlobUrl = null;
        }
        this._worker?.terminate();
        this._worker = null;
      });
      const parts = Array.isArray(buffer) ? buffer : [buffer];
      const mime = this._opts.mp4 ? "video/mp4" : "video/webm";
      return new Blob(parts, { type: mime });
    }
    get isRecording() {
      return this._running && !this._paused;
    }
    get isPaused() {
      return this._paused;
    }
  };
  return __toCommonJS(src_exports);
})();
