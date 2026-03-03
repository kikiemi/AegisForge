<p align="center">
  <img src="https://img.shields.io/badge/version-1.1.0-blue" alt="version">
  <img src="https://img.shields.io/badge/size-271KB_(full)-blueviolet" alt="size">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="deps">
  <img src="https://img.shields.io/badge/license-WTFPL-orange" alt="license">
  <img src="https://img.shields.io/badge/vibe-chaotic--good-ff69b4" alt="vibe">
</p>

# ⚔️ AegisForge

**A browser-native video editor engine that does way too much for its size.**

ブラウザだけで動く、サイズの割にやりすぎな動画エディタエンジン。

---

## What is this? / これ何？

AegisForge is a zero-dependency, pure-browser video editing engine. No FFmpeg. No server. No `node_modules` black hole. Just ~271KB of minified JS that turns your browser into a surprisingly competent NLE.

AegisForge はゼロ依存・純ブラウザ動画編集エンジンです。FFmpeg なし。サーバーなし。`node_modules` のブラックホールなし。約271KBのminified JSで、あなたのブラウザをそこそこ有能なNLEに変えます。

## ✨ Features / 機能

### 🎬 Video Editing / 動画編集
- Multi-track timeline with magnetic snapping — タイムラインにクリップを突っ込むだけ
- Keyframe animation (Bézier curves!) — ベジェ曲線でヌルヌルアニメーション
- Pre-composition — After Effects ごっこ
- Undo/Redo with structural diffing — 無限にCtrl+Zできる安心感

### 🔄 Format Conversion / フォーマット変換
- **Native muxing**: MP4 / MOV / WebM / MKV / AVI / OGG / MP3 / GIF / APNG / WAV — だいたい何でも吐ける
- **Demuxing**: MP4, WebM, MKV, AVI, FLV, OGG — だいたい何でも食える
- Direct-to-disk via OPFS — メモリが爆発しない（たぶん）

### 🎨 Effects / エフェクト
- **12 GPU blend modes** — multiply, screen, overlay, etc.
- **Bloom** — everything looks better with bloom（何にでもブルーム足す人向け）
- **ASCII art rendering** — because why not（なぜなら、できるから）
- **Fractal generator** — Mandelbrot & Julia sets for your corporate video（会社のプレゼンにフラクタル）
- **Glitch** — make it look intentionally broken（意図的に壊す）
- **Chroma key** — green screen the old-fashioned way
- **AI Segmentation** — green screen without the green screen (WebNN)
- **Motion tracking** — GPU frame differencing
- **Blur, Color, Distort, Luma Key, DOM overlay** — the usual suspects

### 🧠 ML / 機械学習
- **AI Subject Cutout** — Real encoder-decoder CNN via WebNN API（本物のAI被写体切り抜き）
- **Super Resolution** — ESPCN upscaling (bring your own weights)
- **Optical Flow** — Lucas-Kanade via WebGPU compute shaders
- **Beat Sync** — auto-cut to music because manual editing is for mortals
- **Video Stabilization** — smooth operator via GL warping
- **VJ Engine** — MIDI + audio-reactive visuals for your DJ career

### 🔊 Audio / オーディオ
- Mix, pan, normalize, reverb, echo, pitch shift, karaoke, bleep
- Chiptune synthesizer — 8-bit dreams in 2026
- Binaural audio, room tone generator, spectrogram, beat detection
- Silence removal — finally, a use for FFT

### 📦 Other Cool Stuff / その他
- **SDF Text Rendering** — GPU-accelerated text with JFA distance fields
- **Lottie animation** — After Effects animations without After Effects
- **Subtitle parsing** — SRT & VTT with full cue positioning
- **Particle system** — WebGL transform feedback go brrr
- **Distributed rendering** — WebRTC swarm because one browser isn't enough
- **Interactive sprite editor** — drag, rotate, pinch-zoom
- **Adaptive quality scaling** — auto-downgrades when your GPU starts sweating
- **Memory panic handler** — LRU texture eviction before the OOM reaper comes

## 🔨 Build Tool / ビルドツール

Don't want all 271KB? Fair enough. Pick only what you need:

全部いらない？わかる。必要なものだけ選んで：

**👉 [https://kikiemi.github.io/AegisForge/builder/](https://kikiemi.github.io/AegisForge/builder/)**

| Preset | Size | What you get |
|--------|------|-------------|
| `minimal` | ~31KB | Core + Timeline + Export — 最低限で動く |
| `editor` | ~140KB | Full editing suite — ちゃんとしたエディタ |
| `converter` | ~155KB | Format conversion focus — 変換特化 |
| `effects` | ~62KB | All the eye candy — 目の保養 |
| `full` | ~271KB | Everything and the kitchen sink — 全部入り |

Or build custom presets via CLI:

```bash
node build-presets.js my-preset src/core.ts src/effects/bloom.ts src/effects/glitch.ts
```

## 🚀 Quick Start

```html
<script src="AegisForge.min.js"></script>
<script>
const core = new AegisForge.AegisCore();
core.config.width = 1920;
core.config.height = 1080;
core.config.fps = 30;

// Load stuff / 素材を読み込む
const img = await AegisForge.Img.load('cat.jpg');
const aud = await AegisForge.Aud.load('bgm.mp3');

// Add to timeline / タイムラインに追加
core.input(img, { start: 0, duration: 5000 });
core.input(aud, { start: 0, duration: 5000, layer: -1 });

// Export / 書き出し
const file = await core.save('output.mp4');
</script>
```

## 🎛️ Use Cases / 使い道

| Use Case | How | どうやって |
|----------|-----|-----------|
| **Video Editor** | Timeline + Effects + Export | タイムライン+エフェクト+書き出し |
| **Format Converter** | Demux → Re-encode | デマックス→再エンコード |
| **GIF Maker** | Import video → AnimatedGifEncoder | 動画→GIF変換器 |
| **Thumbnail Generator** | Load video → Seek → Img.createFrame | 動画→シーク→サムネイル |
| **Audio Processor** | Aud.load → normalize/reverb/echo → WAV | 音声加工パイプライン |
| **Subtitle Burner** | parseSRT + subtitlePlugin | 字幕焼き込み |
| **AI Background Removal** | AISegmentEngine + loadWeights | AI背景除去 |
| **Live Recording** | MediaStreamRecorder → MP4/WebM | ライブ録画 |
| **Batch Processing** | WorkerPool + parallel encode | バッチ処理 |
| **VJ Performance** | VJEngine + MIDI + AudioReactive | VJパフォーマンス |

## 🏗️ Architecture / 設計思想

```
┌──────────────────────────────────────────────┐
│  AegisCore (Timeline + Compositor + Export)   │
├──────────┬──────────┬──────────┬─────────────┤
│ Effects  │ ML/AI    │ Audio    │ Text        │
│ (WebGL2) │ (WebNN)  │ (WebAud)│ (SDF/JFA)   │
├──────────┴──────────┴──────────┴─────────────┤
│  WebCodecs + AegisMuxer (MP4/MOV/MKV/AVI/OGG) │
├──────────────────────────────────────────────┤
│  Demuxers (MP4 / WebM / MKV / AVI / FLV/OGG) │
└──────────────────────────────────────────────┘
Zero dependencies. No npm install. Just vibes.
依存ゼロ。npm install なし。バイブスだけ。
```

## 📋 Browser Support / ブラウザ対応

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Core editing | ✅ 94+ | ✅ 100+ | ✅ 16.4+ | ✅ 94+ |
| WebCodecs | ✅ | ⚠️ Flag | ❌ | ✅ |
| WebGPU | ✅ 113+ | ⚠️ Flag | ✅ 18+ | ✅ |
| WebNN | ✅ 124+ | ❌ | ❌ | ✅ |

## 📄 License / ライセンス

```
            DO WHAT THE F**K YOU WANT TO PUBLIC LICENSE
                    Version 2, December 2004

 Everyone is permitted to copy and distribute verbatim or modified
 copies of this license document, and changing it is allowed as long
 as the name is changed.

            DO WHAT THE F**K YOU WANT TO PUBLIC LICENSE
   TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION

  0. You just DO WHAT THE F**K YOU WANT TO.
```

No copyright. No attribution required. No lawyers. Do literally whatever you want with this code. Sell it, fork it, print it out and make origami, we don't care.

著作権なし。帰属表示不要。弁護士なし。このコードで文字通り好きなことをしてください。売っても、フォークしても、印刷して折り紙にしてもOK。

---

<p align="center">
  <sub>Built with mass amounts of mass amount of mass amount of mass amount ∞ mass amounts of mass amounts of mass amounts and mass amounts</sub>
</p>
