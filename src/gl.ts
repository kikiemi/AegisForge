import { log, AegisError, KeyframeEngine } from './core';

export class GL {
    public canvas: OffscreenCanvas;
    public gl: WebGL2RenderingContext;
    public program: WebGLProgram | null = null;
    protected uniformLocs: Map<string, WebGLUniformLocation> = new Map();
    public textures: Map<string, WebGLTexture> = new Map();
    private quadVAO: WebGLVertexArrayObject | null = null;

    constructor(width: number, height: number, opts?: { hdr?: boolean }) {
        this.canvas = new OffscreenCanvas(width, height);
        const glOpts: WebGLContextAttributes = {
            alpha: true, antialias: false, depth: false,
            stencil: false, premultipliedAlpha: false,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance'
        };
        const ctx = this.canvas.getContext('webgl2', glOpts) as WebGL2RenderingContext | null;
        if (!ctx) throw new AegisError('WebGL2 not available. AegisForge requires WebGL2.');
        this.gl = ctx;

        if (opts?.hdr) {
            if (!ctx.getExtension('EXT_color_buffer_float')) {
                log.warn('[GL] EXT_color_buffer_float not available — HDR degraded to RGBA8');
            }
        }
        this._initQuad();
    }

    private _initQuad(): void {
        const gl = this.gl;
        this.quadVAO = gl.createVertexArray();
        gl.bindVertexArray(this.quadVAO);
        const buf = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);

        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
    }

    protected _compileShader(src: string, type: number): WebGLShader {
        const s = this.gl.createShader(type)!;
        this.gl.shaderSource(s, src);
        this.gl.compileShader(s);
        if (!this.gl.getShaderParameter(s, this.gl.COMPILE_STATUS))
            throw new AegisError(`Shader compile error:\n${this.gl.getShaderInfoLog(s)}`);
        return s;
    }

    public loadShaders(vert: string, frag: string): this {
        const gl = this.gl;
        const vs = this._compileShader(vert, gl.VERTEX_SHADER);
        const fs = this._compileShader(frag, gl.FRAGMENT_SHADER);
        const prog = gl.createProgram()!;
        gl.attachShader(prog, vs); gl.attachShader(prog, fs);
        gl.bindAttribLocation(prog, 0, 'a_pos');
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
            throw new AegisError(`Program link error:\n${gl.getProgramInfoLog(prog)}`);
        gl.deleteShader(vs); gl.deleteShader(fs);
        this.program = prog;
        this.uniformLocs.clear();
        gl.useProgram(prog);
        return this;
    }

    public loadFragmentShader(frag: string): this {
        return this.loadShaders(VERT_FULLSCREEN, frag);
    }

    public setUniform1f(name: string, v: number): this { const l = this._loc(name); if (l) this.gl.uniform1f(l, v); return this; }
    public setUniform2f(name: string, x: number, y: number): this { const l = this._loc(name); if (l) this.gl.uniform2f(l, x, y); return this; }
    public setUniform3f(name: string, x: number, y: number, z: number): this { const l = this._loc(name); if (l) this.gl.uniform3f(l, x, y, z); return this; }
    public setUniform4f(name: string, x: number, y: number, z: number, w: number): this { const l = this._loc(name); if (l) this.gl.uniform4f(l, x, y, z, w); return this; }
    public setUniform1i(name: string, v: number): this { const l = this._loc(name); if (l) this.gl.uniform1i(l, v); return this; }
    public setUniform1fv(name: string, v: Float32List): this { const l = this._loc(name); if (l) this.gl.uniform1fv(l, v); return this; }
    public setUniformMatrix3fv(name: string, v: Float32List): this { const l = this._loc(name); if (l) this.gl.uniformMatrix3fv(l, false, v); return this; }
    public setUniformMatrix4fv(name: string, v: Float32List): this { const l = this._loc(name); if (l) this.gl.uniformMatrix4fv(l, false, v); return this; }

    protected _loc(name: string): WebGLUniformLocation | null {
        if (!this.program) return null;
        if (!this.uniformLocs.has(name)) {
            const l = this.gl.getUniformLocation(this.program, name);
            if (l) this.uniformLocs.set(name, l);
            else return null;
        }
        return this.uniformLocs.get(name) ?? null;
    }

    public bindTexture(name: string, source: TexImageSource | VideoFrame | null, unit: number = 0, hdr: boolean = false): this {
        const gl = this.gl;
        if (!this.program || source === null) return this;
        let tex = this.textures.get(name);
        const isNew = !tex;
        if (!tex) { tex = gl.createTexture()!; this.textures.set(name, tex); }
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

        gl.texImage2D(gl.TEXTURE_2D, 0, internalFmt, fmt, type, source as TexImageSource);
        const loc = this._loc(name);
        if (loc) gl.uniform1i(loc, unit);
        return this;
    }

    public render(target: WebGLFramebuffer | null = null): this {
        const gl = this.gl;
        if (!this.program) throw new AegisError('No shader loaded');
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindVertexArray(this.quadVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);
        return this;
    }

    public async extract(): Promise<ImageBitmap> {
        return createImageBitmap(this.canvas);
    }
}

export class FBOChain {
    public fbos: [WebGLFramebuffer, WebGLFramebuffer];
    public textures: [WebGLTexture, WebGLTexture];
    private idx = 0;
    private gl: WebGL2RenderingContext;
    private w: number; private h: number;

    constructor(gl: WebGL2RenderingContext, width: number, height: number, hdr: boolean = false) {
        this.gl = gl; this.w = width; this.h = height;
        const mk = (): [WebGLFramebuffer, WebGLTexture] => {
            const tex = gl.createTexture()!;
            gl.bindTexture(gl.TEXTURE_2D, tex);
            const internalFmt = hdr ? gl.RGBA16F : gl.RGBA8;
            const type = hdr ? gl.FLOAT : gl.UNSIGNED_BYTE;
            gl.texImage2D(gl.TEXTURE_2D, 0, internalFmt, width, height, 0, gl.RGBA, type, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            const fbo = gl.createFramebuffer()!;
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

    public get writeFBO(): WebGLFramebuffer { return this.fbos[this.idx]; }

    public get readTex(): WebGLTexture { return this.textures[1 - this.idx]; }

    public swap(): void { this.idx = 1 - this.idx; }

    public dispose(): void {
        this.fbos.forEach(f => this.gl.deleteFramebuffer(f));
        this.textures.forEach(t => this.gl.deleteTexture(t));
    }
}

export const MAX_LAYERS = 8;

export type BlendMode = 'normal' | 'add' | 'multiply' | 'screen' | 'overlay' | 'hardlight' | 'dodge' | 'burn';
const BLEND_ID: Record<BlendMode, number> = {
    normal: 0, add: 1, multiply: 2, screen: 3,
    overlay: 4, hardlight: 5, dodge: 6, burn: 7
};

export interface LayerDesc {
    texture: WebGLTexture;
    opacity: number;
    blend: BlendMode;

    rect: [number, number, number, number];
}

export class MultiLayerCompositor extends GL {
    constructor(width: number, height: number) {
        super(width, height, { hdr: true });
        this.loadShaders(VERT_FULLSCREEN, buildCompositorFrag(MAX_LAYERS));
        this.gl.useProgram(this.program);
    }

    public composite(layers: LayerDesc[]): this {
        const gl = this.gl;
        gl.useProgram(this.program);

        const count = Math.min(layers.length, MAX_LAYERS);
        this.setUniform1i('u_layerCount', count);

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
}

export function bindVideoFrameTexture(
    gl: WebGL2RenderingContext,
    tex: WebGLTexture,
    frame: TexImageSource,
    unit: number = 0
): void {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, frame);
}

const VERT_FULLSCREEN = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main(){
    v_uv = a_pos * 0.5 + 0.5;
    v_uv.y = 1.0 - v_uv.y;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

function buildCompositorFrag(nLayers: number): string {
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

export const Shaders = {
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
}`,
};

export class CompositeGL extends GL {
    constructor(width: number, height: number) {
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
    public drawPIP(base: TexImageSource, overlay: TexImageSource, alpha: number, rect: [number, number, number, number]): this {
        this.bindTexture('u_base', base, 0);
        this.bindTexture('u_overlay', overlay, 1);
        this.setUniform1f('u_overlay_alpha', alpha);
        this.setUniform4f('u_pip_rect', rect[0], rect[1], rect[2], rect[3]);
        return this.render();
    }
}

export class WebGPUEngine {
    public device: GPUDevice | null = null;
    public pipeline: GPUComputePipeline | null = null;

    public async init(wgsl: string): Promise<void> {
        const gpu = navigator.gpu;
        if (!gpu) throw new AegisError('WebGPU not supported');
        const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) throw new AegisError('No WebGPU adapter');
        this.device = await adapter.requestDevice();
        const module = this.device.createShaderModule({ code: wgsl });
        this.pipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module, entryPoint: 'main' }
        });
    }

    public async computeOnTexture(
        src: GPUTexture, dst: GPUTexture,
        width: number, height: number,
        extras?: GPUBindGroupEntry[]
    ): Promise<void> {
        if (!this.device || !this.pipeline) throw new AegisError('WebGPU not initialized');
        const entries: GPUBindGroupEntry[] = [
            { binding: 0, resource: src.createView() },
            { binding: 1, resource: dst.createView() },
            ...(extras ?? [])
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

    public async compute(width: number, height: number): Promise<void> {

        throw new AegisError('WebGPUEngine.compute(): Use computeOnTexture() with valid src/dst GPUTexture arguments');
    }
}
