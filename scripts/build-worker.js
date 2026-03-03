#!/usr/bin/env node

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ENTRY = path.resolve(__dirname, '..', 'src', 'worker.entry.ts');
const OUT = path.resolve(__dirname, '..', 'src', 'worker.ts');

async function build() {
    const result = await esbuild.build({
        entryPoints: [ENTRY],
        bundle: true,
        write: false,
        format: 'iife',
        target: 'es2020',
        minify: true,
        treeShaking: true,
        platform: 'browser',
    });

    const code = result.outputFiles[0].text;
    const escaped = code.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    const output = `export const WORKER_SCRIPT = \`${escaped}\`;\n`;

    fs.writeFileSync(OUT, output, 'utf-8');
    console.log(`[build-worker] ${path.basename(ENTRY)} → ${path.basename(OUT)} (${output.length} bytes, minified: ${code.length} bytes)`);
}

build().catch(err => {
    console.error('[build-worker] Build failed:', err);
    process.exit(1);
});
