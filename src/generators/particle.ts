import { AegisError, log } from '../core';

export interface ParticleConfig {

    count?: number;

    origin?: [number, number];

    gravity?: [number, number];

    speed?: number;

    lifetime?: number;

    size?: number;

    color?: [number, number, number];

    turbulence?: number;
}

const UPDATE_VERT = `#version 300 es
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

const DRAW_VERT = `#version 300 es
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

const DRAW_FRAG = `#version 300 es
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

export class ParticleSystem {
    private gl: WebGL2RenderingContext;
    private canvas: OffscreenCanvas;
    private updateProg: WebGLProgram;
    private drawProg: WebGLProgram;
    private tf: [WebGLTransformFeedback, WebGLTransformFeedback];
    private vaos: [WebGLVertexArrayObject, WebGLVertexArrayObject];
    private vbos: [WebGLBuffer, WebGLBuffer];
    private readIdx = 0;
    private count: number;
    private cfg: Required<ParticleConfig>;

    constructor(width: number, height: number, cfg: ParticleConfig = {}) {
        this.cfg = {
            count: 10000, origin: [0.5, 0.0], gravity: [0, -0.0005],
            speed: 0.005, lifetime: 3.0, size: 4,
            color: [1, 1, 0.5], turbulence: 0.0002, ...cfg
        };
        this.count = this.cfg.count;
        this.canvas = new OffscreenCanvas(width, height);
        const ctx = this.canvas.getContext('webgl2', {
            alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true
        }) as WebGL2RenderingContext;
        if (!ctx) throw new AegisError('WebGL2 required for ParticleSystem');
        this.gl = ctx;

        this.updateProg = this._prog(UPDATE_VERT, null, ['v_pos', 'v_vel', 'v_age', 'v_life']);
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

        this.vaos = [this.gl.createVertexArray()!, this.gl.createVertexArray()!];
        this.vbos = [this.gl.createBuffer()!, this.gl.createBuffer()!];
        this.tf = [this.gl.createTransformFeedback()!, this.gl.createTransformFeedback()!];

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

    public async tick(dt: number): Promise<ImageBitmap> {
        const gl = this.gl;
        const read = this.readIdx;
        const write = 1 - read;

        gl.useProgram(this.updateProg);
        gl.uniform1f(gl.getUniformLocation(this.updateProg, 'u_dt')!, dt);
        gl.uniform2f(gl.getUniformLocation(this.updateProg, 'u_gravity')!, this.cfg.gravity[0], this.cfg.gravity[1]);
        gl.uniform1f(gl.getUniformLocation(this.updateProg, 'u_turbulence')!, this.cfg.turbulence);

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
        gl.uniform1f(gl.getUniformLocation(this.drawProg, 'u_size')!, this.cfg.size);
        gl.uniform3f(gl.getUniformLocation(this.drawProg, 'u_color')!, ...this.cfg.color);
        gl.bindVertexArray(this.vaos[write]);
        gl.drawArrays(gl.POINTS, 0, this.count);
        gl.disable(gl.BLEND);

        this.readIdx = write;
        return createImageBitmap(this.canvas);
    }

    private _prog(vert: string, frag: string | null, tfVaryings?: string[]): WebGLProgram {
        const gl = this.gl;
        const vs = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vs, vert); gl.compileShader(vs);
        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS))
            throw new AegisError('Particle VS: ' + gl.getShaderInfoLog(vs));

        const prog = gl.createProgram()!;
        gl.attachShader(prog, vs);

        if (frag) {
            const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
            gl.shaderSource(fs, frag); gl.compileShader(fs);
            if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS))
                throw new AegisError('Particle FS: ' + gl.getShaderInfoLog(fs));
            gl.attachShader(prog, fs);
        }

        if (tfVaryings) {
            gl.transformFeedbackVaryings(prog, tfVaryings, gl.INTERLEAVED_ATTRIBS);
        }
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
            throw new AegisError('Particle prog: ' + gl.getProgramInfoLog(prog));
        return prog;
    }

    public dispose(): void {
        const gl = this.gl;
        for (let i = 0; i < 2; i++) {
            gl.deleteBuffer(this.vbos[i]);
            gl.deleteVertexArray(this.vaos[i]);
            gl.deleteTransformFeedback(this.tf[i]);
        }
        gl.deleteProgram(this.updateProg);
        gl.deleteProgram(this.drawProg);
    }
}
