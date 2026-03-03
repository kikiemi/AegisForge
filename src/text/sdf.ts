import { GL } from '../gl';
import { AegisError, log } from '../core';

const SDF_INIT_FRAG = `#version 300 es
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

const SDF_JFA_FRAG = `#version 300 es
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

const SDF_FINAL_FRAG = `#version 300 es
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

const TEXT_RENDER_FRAG = `#version 300 es
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

const ATLAS_SIZE = 1024;
const CELL_SIZE = 64; 
const COLS = Math.floor(ATLAS_SIZE / CELL_SIZE);

interface GlyphInfo {
    col: number; row: number;
    advance: number; 
}

export interface TextRenderOpts {
    text: string;
    fontSize: number;
    color?: [number, number, number, number]; 
    align?: 'left' | 'center' | 'right';
    width: number;
    height: number;
    x?: number;
    y?: number;
    thickness?: number; 
    softness?: number;
}

export class SDFTextRenderer {
    private _initGL: GL;
    private _jfaGL: GL;
    private _finalGL: GL;
    private _renderGL: GL;
    private _atlasCanvas: OffscreenCanvas;
    private _atlasCtx: OffscreenCanvasRenderingContext2D;
    private _atlasTexture: WebGLTexture | null = null;
    private _glyphMap: Map<string, GlyphInfo> = new Map();
    private _nextSlot = 0;
    private _atlasDirty = false;
    private _spread = 0.1; 
    private _gl: WebGL2RenderingContext;

    constructor() {
        
        this._atlasCanvas = new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE);
        const ctx = this._atlasCanvas.getContext('2d');
        if (!ctx) throw new AegisError('OffscreenCanvas 2D not available for glyph seeding');
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

    private async _ensureGlyph(char: string, fontSize: number): Promise<GlyphInfo> {
        const key = `${char}@${fontSize}`;
        if (this._glyphMap.has(key)) return this._glyphMap.get(key)!;

        const slot = this._nextSlot++;
        const col = slot % COLS;
        const row = Math.floor(slot / COLS);
        const px = col * CELL_SIZE, py = row * CELL_SIZE;

        const ctx = this._atlasCtx;
        ctx.clearRect(px, py, CELL_SIZE, CELL_SIZE);
        ctx.font = `${Math.min(fontSize, CELL_SIZE - 8)}px sans-serif`;
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(char, px + CELL_SIZE / 2, py + CELL_SIZE / 2);

        const info: GlyphInfo = {
            col, row,
            advance: (ctx.measureText(char).width / CELL_SIZE)
        };
        this._glyphMap.set(key, info);
        this._atlasDirty = true;

        return info;
    }

    private async _rebuildAtlas(): Promise<void> {
        if (!this._atlasDirty) return;
        const gl = this._gl;

        if (!this._atlasTexture) {
            this._atlasTexture = gl.createTexture();
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._atlasTexture!);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this._atlasCanvas);

        this._atlasDirty = false;
    }

    public async render(opts: TextRenderOpts): Promise<ImageBitmap> {
        const {
            text, fontSize, width, height,
            color = [1, 1, 1, 1],
            align = 'center', x = 0, y = 0,
            thickness = 0.5, softness = 0.04
        } = opts;

        const glyphs: GlyphInfo[] = [];
        for (const ch of text) {
            glyphs.push(await this._ensureGlyph(ch, fontSize));
        }
        await this._rebuildAtlas();

        const out = new OffscreenCanvas(width, height);
        const outCtx = out.getContext('2d')!;

        const scale = fontSize / CELL_SIZE;
        let totalW = glyphs.reduce((s, g) => s + g.advance * CELL_SIZE * scale, 0);
        let startX = x;
        if (align === 'center') startX = x + (width - totalW) / 2;
        else if (align === 'right') startX = x + width - totalW;
        let cx = startX;

        for (let i = 0; i < glyphs.length; i++) {
            const g = glyphs[i];
            const atlasX0 = (g.col * CELL_SIZE) / ATLAS_SIZE;
            const atlasY0 = (g.row * CELL_SIZE) / ATLAS_SIZE;
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
            glGL.setUniform1i('u_sdfAtlas', 0)
                .setUniform4f('u_color', color[0], color[1], color[2], color[3])
                .setUniform1f('u_thickness', thickness)
                .setUniform1f('u_softness', softness)
                .setUniform4f('u_glyphUV', atlasX0, atlasY0, atlasX1, atlasY1)
                .render();

            const glBitmap = await glGL.extract();
            outCtx.drawImage(glBitmap, cx, y - glH / 2, glW, glH);
            glBitmap.close();

            cx += glW;
        }

        return createImageBitmap(out);
    }
}
