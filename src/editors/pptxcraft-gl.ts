// Draws a slide transition's triangles on the GPU: the engine hands over its pictures once and the triangles of each frame.
import type { Rendered } from "craftbridge/deck";

const VERT = `attribute vec2 p;attribute vec2 t;attribute float a;varying vec2 v;varying float w;
void main(){gl_Position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0.0,1.0);v=t;w=a;}`;
const FRAG = `precision mediump float;uniform sampler2D s;varying vec2 v;varying float w;
void main(){gl_FragColor=texture2D(s,v)*w;}`;

/** Floats per triangle in the engine's mesh: a texture slot, then three vertices of x, y, u, v, opacity. */
const TRI = 16;
const BLACK = 6;
const WHITE = 7;

export class TransitionGL {
  private gl: WebGLRenderingContext;
  private tex: (WebGLTexture | null)[] = [];
  private buf: WebGLBuffer;

  private constructor(readonly canvas: HTMLCanvasElement, gl: WebGLRenderingContext) {
    this.gl = gl;
    this.buf = gl.createBuffer()!;
  }

  /** Null when the browser has no WebGL. */
  static create(): TransitionGL | null {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl", { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
      if (!gl) return null;
      const g = new TransitionGL(c, gl);
      return g.init() ? g : null;
    } catch {
      return null;
    }
  }

  private init(): boolean {
    const gl = this.gl;
    const sh = (type: number, src: string): WebGLShader | null => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = sh(gl.VERTEX_SHADER, VERT);
    const fs = sh(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return false;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const attr = (name: string, size: number, off: number): void => {
      const at = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, size, gl.FLOAT, false, 20, off * 4);
    };
    attr("p", 2, 0);
    attr("t", 2, 2);
    attr("a", 1, 4);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }

  get lost(): boolean {
    return this.gl.isContextLost();
  }

  private upload(w: number, h: number, data: ArrayBufferView): WebGLTexture | null {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** The pictures of a transition by slot (old, new, old and new background, old and new contents). */
  setTextures(pics: (Rendered | null)[]): void {
    const gl = this.gl;
    for (const t of this.tex) if (t) gl.deleteTexture(t);
    this.tex = pics.map((p) => (p ? this.upload(p.width, p.height, p.rgba) : null));
    this.tex[BLACK] = this.upload(1, 1, new Uint8Array([0, 0, 0, 255]));
    this.tex[WHITE] = this.upload(1, 1, new Uint8Array([255, 255, 255, 255]));
    const first = pics[1];
    if (first && (this.canvas.width !== first.width || this.canvas.height !== first.height)) {
      this.canvas.width = first.width;
      this.canvas.height = first.height;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Draws one frame from the engine's mesh; the result is in `canvas` until the next task. */
  draw(mesh: Float32Array): void {
    const gl = this.gl;
    const n = Math.floor(mesh.length / TRI);
    const verts = new Float32Array(n * 15);
    for (let i = 0; i < n; i++) verts.set(mesh.subarray(i * TRI + 1, i * TRI + TRI), i * 15);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    let i = 0;
    while (i < n) {
      const slot = mesh[i * TRI]!;
      let j = i + 1;
      while (j < n && mesh[j * TRI] === slot) j++;
      const t = this.tex[slot];
      if (t) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.drawArrays(gl.TRIANGLES, i * 3, (j - i) * 3);
      }
      i = j;
    }
  }

  dispose(): void {
    for (const t of this.tex) if (t) this.gl.deleteTexture(t);
    this.tex = [];
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
