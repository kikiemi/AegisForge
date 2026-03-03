const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pathMap = {
    core: './core', gl: './gl', media: './media', codec: './codec', encoders: './encoders', muxer: './AegisMuxer',
    adaptive: './core/adaptive', memory_panic: './core/memory_panic', recovery: './core/recovery',
    interval_tree: './core/interval_tree', frame_cache: './core/frame_cache', fast_pipeline: './core/fast_pipeline',
    transcoder: './core/transcoder', gpu_fallback: './gpu/fallback',
    mp4: './demux/mp4', webm: './demux/webm', mkv: './demux/mkv', avi: './demux/avi', flv: './demux/flv',
    avi_flv: './demux/avi_flv', ogg: './demux/ogg', video_idct: './codec/video_idct', audio_fft: './codec/audio_fft',
    bloom: './effects/bloom', blur: './effects/blur', color: './effects/color', distort: './effects/distort',
    blend: './effects/blend', fractal: './effects/fractal', glitch: './effects/glitch', luma: './effects/luma',
    tracker: './effects/tracker', ascii: './effects/ascii', dom: './effects/dom', particle: './generators/particle',
    color_space: './gpu/color_space',
    worklet: './audio/worklet', binaural: './audio/binaural', chiptune: './audio/chiptune', roomtone: './audio/roomtone',
    spectrogram: './audio/spectrogram', fft: './audio/fft', imdct: './audio/imdct', autosync: './audio/autosync', resample: './audio/resample',
    webnn: './ml/webnn', optflow: './ml/optflow', stabilize: './ml/stabilize', segment: './ml/segment',
    magnetic: './timeline/magnetic', multicam: './timeline/multicam', history: './timeline/history', project: './timeline/project'
};

const PRESETS = {
    minimal: ['core', 'gl', 'media'],
    editor: ['core', 'gl', 'media', 'codec', 'muxer', 'mp4', 'webm', 'bloom', 'blur', 'color', 'blend', 'glitch', 'worklet', 'magnetic', 'history', 'project', 'interval_tree', 'frame_cache', 'fast_pipeline', 'adaptive', 'memory_panic', 'recovery'],
    converter: ['core', 'gl', 'media', 'codec', 'muxer', 'transcoder', 'mp4', 'webm', 'mkv', 'avi', 'flv', 'avi_flv', 'ogg', 'video_idct', 'audio_fft', 'fft', 'imdct', 'color_space', 'gpu_fallback', 'resample', 'frame_cache', 'interval_tree'],
    effects: ['core', 'gl', 'media', 'bloom', 'blur', 'color', 'distort', 'blend', 'fractal', 'glitch', 'luma', 'tracker', 'ascii', 'dom', 'particle', 'color_space', 'gpu_fallback']
};

const outDir = path.join(__dirname, 'builder', 'presets');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const esbuild = path.join(__dirname, 'node_modules', 'esbuild', 'bin', 'esbuild');

for (const [name, ids] of Object.entries(PRESETS)) {
    const entry = ids.map(id => `export * from '${pathMap[id]}';`).join('\n');
    const tempFile = path.join(__dirname, 'src', `_preset_${name}.ts`);
    const outFile = path.join(outDir, `${name}.min.js`);

    fs.writeFileSync(tempFile, entry, 'utf-8');

    console.log(`  Building preset: ${name} (${ids.length} modules)...`);
    execSync(`node "${esbuild}" "${tempFile}" --bundle --minify --format=iife --global-name=AegisForge --outfile="${outFile}"`, {
        cwd: __dirname, stdio: 'pipe'
    });

    const size = (fs.statSync(outFile).size / 1024).toFixed(1);
    console.log(`    ✓ ${name}.min.js → ${size} KB`);

    fs.unlinkSync(tempFile);
}


const fullSrc = path.join(__dirname, 'dist', 'AegisForge.min.js');
const fullDst = path.join(outDir, 'full.min.js');
if (fs.existsSync(fullSrc)) {
    fs.copyFileSync(fullSrc, fullDst);
    const size = (fs.statSync(fullDst).size / 1024).toFixed(1);
    console.log(`    ✓ full.min.js → ${size} KB`);
}

console.log('\n  ⚡ All preset bundles generated!\n');
