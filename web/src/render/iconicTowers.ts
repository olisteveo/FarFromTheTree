// The buildings you'd know anywhere, drawn on the massing in world/iconic.ts: Trinity's brownstone steeple, the Stock
// Exchange's temple front, the Woolworth's gothic crown, the Municipal's wedding cake, the Met Life's clock, the Flatiron,
// the Empire State's setbacks and mast, One Times Square's screens and ball, the Hearst's diagrid, and the Chrysler and One
// World Trade on the skyline. The silhouettes and everything that stands proud of a wall (ribs, buttresses, cornices,
// colonnades, pinnacles, arches) are real geometry; the windows and masonry are patterned in the shader, in metres along
// the wall and metres up, with the glass set back by parallax so a thousand windows have depth for a handful of triangles.

import * as THREE from "three";
import type { CityData } from "../world/data";
import { FLATIRON, ICONS, SKYLINE } from "../world/iconic";
import { REFLECT_GLSL } from "./reflections";
import { sunDirection } from "./sun";

/** Wall patterns: 0 coursed stone (bay: block length, floor: course height, win: how strong the joints are), 1 punched
 *  windows, 2 window strips between piers, 3 curtain glass, 4 diagrid, 5 pointed lancets, 6 smooth (metal, slate, render) */
type Mode = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export interface Skin { c: number; mode: Mode; bay?: number; floor?: number; win?: number; metal?: number }

const smooth = (c: number, metal = 0): Skin => ({ c, mode: 6, metal });
const COPPER = smooth(0x5f9a84, 0.2);
const GILT = smooth(0xd8ac4e, 1);
const STEEL = smooth(0xb9bec4, 1);
const LEAD = smooth(0x3a3c40, 0.5);
const IRON = smooth(0x1b1c1e, 0.4);
const SLATE = smooth(0x34363b);
const TAR = smooth(0x4a4845);
const VOID = smooth(0x0c0d10);
const stoneOf = (c: number, joints = 0.7, block = 1.5, course = 0.62): Skin => ({ c, mode: 0, bay: block, floor: course, win: joints });

type P3 = [number, number, number];
interface Box { x0: number; x1: number; z0: number; z1: number }
interface Block extends Box { y0: number; y1: number }
/** One flat side of something: u runs along it, left to right from outside; n is out. */
interface Face { x: number; z: number; ux: number; uz: number; nx: number; nz: number; w: number }

const facesOf = (t: Box): Face[] => [
  { x: t.x0, z: t.z1, ux: 1, uz: 0, nx: 0, nz: 1, w: t.x1 - t.x0 },
  { x: t.x1, z: t.z0, ux: -1, uz: 0, nx: 0, nz: -1, w: t.x1 - t.x0 },
  { x: t.x0, z: t.z0, ux: 0, uz: 1, nx: -1, nz: 0, w: t.z1 - t.z0 },
  { x: t.x1, z: t.z1, ux: 0, uz: -1, nx: 1, nz: 0, w: t.z1 - t.z0 },
];
const on = (f: Face, u: number, y: number, out = 0): P3 => [f.x + f.ux * u + f.nx * out, y, f.z + f.uz * u + f.nz * out];

class Builder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; fac: number[] = []; idx: number[] = [];
  private tmp = new THREE.Color();
  private vert(p: number[], n: number[], u: number, v: number, s: Skin) {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.uv.push(u, v);
    this.tmp.set(s.c); this.col.push(this.tmp.r, this.tmp.g, this.tmp.b);
    this.fac.push(s.mode, s.bay ?? 3, s.floor ?? 3.6, s.win ?? 0.55, s.metal ?? 0);
  }
  /** a quad, a b c d anticlockwise seen from outside, in its own wall coordinates (metres along, metres up) */
  quad(a: number[], b: number[], c: number[], d: number[], s: Skin, uvs?: number[][]) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]], e3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const f = Math.hypot(e2[0], e2[1], e2[2]) > 1e-5 ? e2 : e3;
    const n = [e1[1] * f[2] - e1[2] * f[1], e1[2] * f[0] - e1[0] * f[2], e1[0] * f[1] - e1[1] * f[0]], l = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= l; n[1] /= l; n[2] /= l;
    const L = Math.hypot(e1[0], e1[1], e1[2]), i = this.pos.length / 3;
    const U = uvs ?? [[0, a[1]], [L, b[1]], [L, c[1]], [0, d[1]]];
    [a, b, c, d].forEach((p, k) => this.vert(p, n, U[k][0], U[k][1], s));
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  /** a closed box: four walls, a lid and a soffit (you look up at most of these from the street) */
  block(t: Block, s: Skin, lid: Skin = s) {
    const { x0, x1, z0, z1, y0, y1 } = t;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], s);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], s);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], s);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], s);
    const flat = lid.mode === 6 ? lid : { ...lid, mode: 6 as Mode };
    const U = [[x0, z1], [x0, z0], [x1, z0], [x1, z1]];
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], flat, [U[0], U[3], U[2], U[1]]);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], flat, [U[1], U[2], U[3], U[0]]);
  }
  /** a box narrowing to the top: a pyramid, a pitched roof, a stage of a crown */
  taper(t: Block, ix: number, iz: number, s: Skin) {
    const { x0, x1, z0, z1, y0, y1 } = t, X0 = x0 + ix, X1 = x1 - ix, Z0 = z0 + iz, Z1 = z1 - iz;
    const h = y1 - y0, slope = (run: number) => Math.hypot(h, run);
    const up = (L: number, S: number) => [[0, y0], [L, y0], [L, y0 + S], [0, y0 + S]];
    this.quad([x0, y0, z1], [x1, y0, z1], [X1, y1, Z1], [X0, y1, Z1], s, up(x1 - x0, slope(iz)));
    this.quad([x1, y0, z0], [x0, y0, z0], [X0, y1, Z0], [X1, y1, Z0], s, up(x1 - x0, slope(iz)));
    this.quad([x0, y0, z0], [x0, y0, z1], [X0, y1, Z1], [X0, y1, Z0], s, up(z1 - z0, slope(ix)));
    this.quad([x1, y0, z1], [x1, y0, z0], [X1, y1, Z0], [X1, y1, Z1], s, up(z1 - z0, slope(ix)));
    if (X1 > X0 + 1e-3 && Z1 > Z0 + 1e-3) this.quad([X0, y1, Z1], [X1, y1, Z1], [X1, y1, Z0], [X0, y1, Z0], { ...s, mode: 6 }, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  /** a round or many-sided shaft */
  drum(x: number, z: number, r0: number, r1: number, y0: number, y1: number, sides: number, s: Skin, cap = false) {
    const P = (r: number, q: number, y: number) => [x + Math.sin(q) * r, y, z + Math.cos(q) * r];
    const L = (2 * Math.PI * Math.max(r0, r1)) / sides;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2, b = ((i + 1) / sides) * Math.PI * 2;
      this.quad(P(r0, a, y0), P(r0, b, y0), P(r1, b, y1), P(r1, a, y1), s, [[i * L, y0], [(i + 1) * L, y0], [(i + 1) * L, y1], [i * L, y1]]);
    }
    if (cap && r1 > 0) for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2, b = ((i + 1) / sides) * Math.PI * 2, c = [x, y1, z];
      this.quad(c, P(r1, a, y1), P(r1, b, y1), c, { ...s, mode: 6 }, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  }
  /** a moulding standing out round a box */
  ledge(t: Box, y0: number, y1: number, out: number, s: Skin) {
    this.block({ x0: t.x0 - out, x1: t.x1 + out, z0: t.z0 - out, z1: t.z1 + out, y0, y1 }, s, s.metal ? s : TAR);
  }
  /** a heavier cornice: a sloped bed under a projecting top */
  cornice(t: Box, y: number, h: number, out: number, s: Skin) {
    const bed = y + h * 0.45;
    const T = { x0: t.x0 - out, x1: t.x1 + out, z0: t.z0 - out, z1: t.z1 + out };
    this.quad([t.x1, y, t.z1], [t.x0, y, t.z1], [T.x0, bed, T.z1], [T.x1, bed, T.z1], s, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    this.quad([t.x0, y, t.z0], [t.x1, y, t.z0], [T.x1, bed, T.z0], [T.x0, bed, T.z0], s, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    this.quad([t.x0, y, t.z1], [t.x0, y, t.z0], [T.x0, bed, T.z0], [T.x0, bed, T.z1], s, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    this.quad([t.x1, y, t.z0], [t.x1, y, t.z1], [T.x1, bed, T.z1], [T.x1, bed, T.z0], s, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    this.block({ ...T, y0: bed, y1: y + h }, s, TAR);
  }
  /** vertical piers standing out of all four walls */
  ribs(t: Box, y0: number, y1: number, step: number, out: number, w: number, s: Skin) {
    for (const f of facesOf(t)) {
      const n = Math.max(1, Math.round(f.w / step)), d = f.w / n;
      for (let i = 0; i <= n; i++) this.onWall(f, i * d, y0, y1, w, out, s);
    }
  }
  /** a small box on a wall: u along it, y0..y1 up, standing out by `out` */
  onWall(f: Face, u: number, y0: number, y1: number, w: number, out: number, s: Skin, from = -0.02) {
    const a = on(f, u - w / 2, 0, from), b = on(f, u + w / 2, 0, out);
    this.block({ x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[2], b[2]), z1: Math.max(a[2], b[2]), y0, y1 }, s);
  }
  /** the pointed or round head of an opening, as a flat plate on a wall */
  arch(f: Face, u: number, y0: number, w: number, spring: number, rise: number, out: number, s: Skin, pointed = true) {
    const N = 8, pts: [number, number][] = [[u - w / 2, y0], [u + w / 2, y0], [u + w / 2, spring]];
    const prof = (q: number) => (pointed ? 1 - Math.abs(q) ** 1.6 : Math.sqrt(Math.max(0, 1 - q * q)));
    for (let i = 1; i < N; i++) { const q = 1 - (2 * i) / N; pts.push([u + (q * w) / 2, spring + prof(q) * rise]); }
    pts.push([u - w / 2, spring]);
    const cu = u, cy = y0 + (spring - y0) * 0.5, c = on(f, cu, cy, out);
    for (let i = 0; i < pts.length; i++) {
      const [au, ay] = pts[i], [bu, by] = pts[(i + 1) % pts.length];
      this.quad(c, on(f, au, ay, out), on(f, bu, by, out), c, s, [[cu, cy], [au, ay], [bu, by], [cu, cy]]);
    }
  }
  /** a row of little gables or merlons along the top of a wall */
  gable(f: Face, u: number, y: number, w: number, h: number, depth: number, s: Skin) {
    const a = on(f, u - w / 2, y, depth), b = on(f, u + w / 2, y, depth), c = on(f, u, y + h, depth), a2 = on(f, u - w / 2, y, 0), b2 = on(f, u + w / 2, y, 0), c2 = on(f, u, y + h, 0);
    const flat = [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.quad(a, b, c, c, s, flat);
    this.quad(b, b2, c2, c, s, flat);
    this.quad(a2, a, c, c2, s, flat);
  }
  /** a tapering spike with a little square base */
  pinnacle(x: number, z: number, y0: number, h: number, r: number, s: Skin) {
    this.block({ x0: x - r, x1: x + r, z0: z - r, z1: z + r, y0, y1: y0 + h * 0.45 }, s);
    this.block({ x0: x - r * 1.2, x1: x + r * 1.2, z0: z - r * 1.2, z1: z + r * 1.2, y0: y0 + h * 0.43, y1: y0 + h * 0.48 }, s);
    this.taper({ x0: x - r, x1: x + r, z0: z - r, z1: z + r, y0: y0 + h * 0.45, y1: y0 + h }, r * 0.97, r * 0.97, s);
  }
  mesh(mat: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    const inter = new THREE.InterleavedBuffer(new Float32Array(this.fac), 5);
    g.setAttribute("aFacA", new THREE.InterleavedBufferAttribute(inter, 4, 0));
    g.setAttribute("aMetal", new THREE.InterleavedBufferAttribute(inter, 1, 4));
    g.setIndex(this.idx);
    return new THREE.Mesh(g, mat);
  }
}

function facadeMaterial(): THREE.MeshStandardMaterial {
  const load = (n: string) => { const t = new THREE.TextureLoader().load(`./textures/buildings/${n}.webp`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
  const wear = load("wear"), grain = load("grain");
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, envMapIntensity: 0.75, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWear = { value: wear };
    sh.uniforms.uGrainI = { value: grain };
    sh.uniforms.uSun = { value: sunDirection() };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        attribute vec4 aFacA; attribute float aMetal; varying vec2 vWall; varying vec4 vFac; varying float vMetalIn; varying vec3 vWorld;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vWall = uv; vFac = aFacA; vMetalIn = aMetal; vWorld = (modelMatrix * vec4(position, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform sampler2D uWear, uGrainI; uniform vec3 uSun; varying vec2 vWall; varying vec4 vFac; varying float vMetalIn; varying vec3 vWorld;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        ${REFLECT_GLSL}
        // 1 inside the rectangle centred in a repeating cell, softly, however far off it's seen
        float icBox(vec2 f, vec2 half_, vec2 w){ vec2 d = half_ - abs(f); return smoothstep(-w.x, w.x, d.x) * smoothstep(-w.y, w.y, d.y); }
        float icLine(float d, float t, float w){ return 1.0 - smoothstep(t - w, t + w, abs(d)); }
        float icLancet(vec2 f, float hw, float y0, float y1, vec2 w){
          float spring = mix(y0, y1, 0.62), k = clamp((f.y - spring) / (y1 - spring), 0.0, 1.0);
          float x = hw * (1.0 - k * k);
          return smoothstep(-w.x, w.x, x - abs(f.x)) * smoothstep(-w.y, w.y, f.y - y0) * smoothstep(-w.y, w.y, y1 - f.y);
        }
        float icGlass, icLit; vec3 icRefl;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        {
          float mode = floor(vFac.x + 0.5), bay = vFac.y, fl = vFac.z, win = vFac.w;
          vec2 size = vec2(bay, fl), wall = vWall, fw = fwidth(wall) + 1e-4;
          vec2 cellW = fw / size;
          vec2 id = floor(wall / size), f = fract(wall / size) - 0.5;
          icGlass = 0.0; icLit = 0.0; icRefl = vec3(0.0);
          vec3 stone = diffuseColor.rgb;

          // the eye's direction in wall coordinates, to set the glass back from the face of the wall
          vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
          vec2 dux = dFdx(wall), duy = dFdy(wall);
          float det = dux.x * duy.y - dux.y * duy.x;
          vec3 Nw = normalize(cross(dpx, dpy)), Vw = normalize(cameraPosition - vWorld);
          if (dot(Nw, Vw) < 0.0) Nw = -Nw;
          vec2 shift = vec2(0.0);
          if (abs(det) > 1e-9) {
            vec3 Tw = (dpx * duy.y - dpy * dux.y) / det, Bw = (dpy * dux.x - dpx * duy.x) / det;
            shift = vec2(dot(Vw, Tw) / (dot(Tw, Tw) + 1e-6), dot(Vw, Bw) / (dot(Bw, Bw) + 1e-6)) / max(dot(Vw, Nw), 0.22);
          }
          float closeUp = 1.0 - smoothstep(0.03, 0.22, max(fw.x, fw.y));

          // masonry: courses and joints, each block a little its own colour, gone by the time they'd only shimmer
          if (mode < 3.5 && vMetalIn < 0.5) {
            vec2 bs = mode < 0.5 ? size : vec2(1.45, 0.58);
            float row = floor(wall.y / bs.y), off = mod(row, 2.0) * 0.5;
            vec2 bf = vec2(fract(wall.x / bs.x + off), fract(wall.y / bs.y));
            vec2 bid = vec2(floor(wall.x / bs.x + off), row);
            float strength = mode < 0.5 ? win : 0.45;
            stone *= 0.94 + 0.12 * h21(bid);
            float joint = max(1.0 - smoothstep(0.0, 0.05 / bs.y + fw.y / bs.y, min(bf.y, 1.0 - bf.y)), 1.0 - smoothstep(0.0, 0.03 / bs.x + fw.x / bs.x, min(bf.x, 1.0 - bf.x)));
            stone *= 1.0 - joint * strength * 0.42 * closeUp;
            stone *= mix(1.0, 0.8 + texture2D(uGrainI, wall / 1.7).b * 0.42, closeUp);
          }

          float aperture = 0.0, inner = 0.0, sash = 0.0, shade = 0.0;
          if (mode > 0.5 && mode < 1.5) {
            vec2 half_ = vec2(win * 0.5, 0.33);
            aperture = icBox(f, half_, cellW);
            vec2 g = f - shift * 0.34 / size;
            inner = icBox(g, half_, cellW);
            // a stone surround and sill
            float frame = icBox(f, half_ + vec2(0.05, 0.05), cellW) * (1.0 - aperture);
            float sill = icBox(f + vec2(0.0, 0.37), vec2(win * 0.5 + 0.08, 0.035), cellW);
            stone = mix(stone, stone * 1.13, max(frame, sill));
            // and its shadow, under the head and the sill
            stone *= 1.0 - 0.35 * icBox(f + vec2(0.0, 0.42), vec2(win * 0.5 + 0.08, 0.035), cellW);
            sash = max(icLine(g.x, 0.012, cellW.x), icLine(g.y - 0.08, 0.012, cellW.y)) * closeUp;
            shade = smoothstep(0.33 - 0.5 * h21(id + 7.0), 0.33, g.y);
          } else if (mode > 1.5 && mode < 2.5) {
            // piers run clear up the wall; between them, a window and a metal spandrel, one over another
            float strip = icBox(vec2(f.x, 0.0), vec2(win * 0.5, 1.0), cellW);
            vec2 g = f - shift * 0.3 / size;
            float stripIn = icBox(vec2(g.x, 0.0), vec2(win * 0.5, 1.0), cellW);
            float pane = icBox(vec2(0.0, g.y), vec2(1.0, 0.33), cellW);
            aperture = strip;
            inner = stripIn * pane;
            vec3 spandrel = mix(stone, vec3(0.42, 0.41, 0.39), 0.7) * (0.82 + 0.1 * h21(id));
            stone = mix(stone, stone * 0.9, icBox(f, vec2(win * 0.5 + 0.08, 1.0), cellW));
            stone = mix(stone, spandrel, strip * stripIn * (1.0 - pane));
            aperture *= pane;
            sash = icLine(g.x, 0.02, cellW.x) * closeUp;
            shade = smoothstep(0.33 - 0.5 * h21(id + 7.0), 0.33, g.y);
          } else if (mode > 2.5 && mode < 3.5) {
            aperture = 1.0; inner = 1.0;
            float rail = 1.0 - icBox(vec2(0.0, f.y), vec2(1.0, 0.46), cellW), mull = 1.0 - icBox(vec2(f.x, 0.0), vec2(0.47, 1.0), cellW);
            sash = max(rail * 0.9, mull * 0.5);
            stone *= 0.55;
          } else if (mode > 3.5 && mode < 4.5) {
            // the diagrid: two families of steel diagonals, with floors and mullions showing faintly through the glass
            vec2 d = vec2(wall.x + wall.y * 0.92, wall.x - wall.y * 0.92) / bay, w = fwidth(d) + 1e-4;
            float lat = max(icLine(fract(d.x) - 0.5, 0.042, w.x), icLine(fract(d.y) - 0.5, 0.042, w.y));
            aperture = 1.0 - lat;
            inner = 1.0;
            float fln = fract(wall.y / 4.05) - 0.5, ml = fract(wall.x / 1.5) - 0.5;
            sash = max(icLine(fln, 0.04, fwidth(wall.y / 4.05)) * 0.8, icLine(ml, 0.025, fwidth(wall.x / 1.5)) * 0.35);
            stone = mix(vec3(0.82, 0.84, 0.85), stone, 0.3);
          } else if (mode > 4.5 && mode < 5.5) {
            aperture = icLancet(f, win * 0.5, -0.4, 0.44, cellW);
            vec2 g = f - shift * 0.5 / size;
            inner = icLancet(g, win * 0.5, -0.4, 0.44, cellW);
            sash = max(icLine(g.x, 0.018, cellW.x), icLine(fract(g.y * 6.0) - 0.5, 0.05, cellW.y * 6.0) * 0.6);
            // the dressed stone round the arch
            stone = mix(stone, stone * 1.22, icLancet(f, win * 0.5 + 0.05, -0.43, 0.48, cellW) * (1.0 - aperture));
          }
          diffuseColor.rgb = stone;

          if (aperture > 0.0) {
            float glass = aperture * inner * (1.0 - sash);
            diffuseColor.rgb = mix(diffuseColor.rgb, stone * 0.34, aperture * (1.0 - inner));   // the reveal, in shadow
            diffuseColor.rgb = mix(diffuseColor.rgb, stone * 0.5, aperture * inner * sash);     // the sash
            float r = h21(id + 3.3);
            vec3 room = vec3(0.03, 0.033, 0.04) + vec3(0.02, 0.018, 0.014) * r;
            vec3 blind = mix(vec3(0.33, 0.3, 0.25), vec3(0.2, 0.22, 0.24), r);
            vec3 inside = mix(room, blind * 0.8, shade * (mode < 2.5 ? 1.0 : 0.0));
            icLit = mode > 3.5 ? 0.0 : step(0.94, h21(id * 1.7 + 3.1)) * glass;
            if (mode > 4.5) inside = mix(vec3(0.05, 0.05, 0.07), vec3(0.13, 0.05, 0.09) + vec3(0.0, 0.05, 0.09) * r, 0.5 + 0.5 * sin(wall.x * 3.0 + wall.y * 2.0));
            diffuseColor.rgb = mix(diffuseColor.rgb, inside, glass);
            icGlass = glass;
            // what the panes show, each hung very slightly out of true
            float wob = (h21(id) - 0.5) * (mode > 2.5 ? 0.012 : 0.05);
            vec3 Nn = normalize(Nw + vec3(wob, wob * 0.6, -wob));
            float fres = mix(mode > 4.5 ? 0.1 : mode > 2.5 ? 0.62 : 0.42, 1.0, pow(1.0 - max(dot(Vw, Nn), 0.0), 3.0));
            icRefl = reflCity(vWorld, normalize(reflect(-Vw, Nn))) * fres * glass;
          }

          if (mode < 5.5 || vMetalIn < 0.5) {
            // city grime: rain streaks off every ledge and soot, on stone more than on glass and metal
            vec3 w = texture2D(uWear, vec2(wall.x, wall.y) / 34.0).rgb;
            vec3 w2 = texture2D(uWear, vec2(wall.x, wall.y) / 9.0 + 0.37).rgb;
            float dirt = (0.2 * w.r + 0.16 * w.g + 0.08 * w2.r * closeUp) * (1.0 - 0.85 * icGlass) * (1.0 - 0.8 * vMetalIn);
            // and darker the nearer the street, where the buses are
            dirt += 0.14 * (1.0 - smoothstep(0.0, 26.0, vWorld.y)) * (1.0 - icGlass);
            diffuseColor.rgb *= 1.0 - dirt;
            // copper goes green unevenly
            if (diffuseColor.g > diffuseColor.r * 1.2 && vMetalIn > 0.1) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.3, 0.24), w.g * 0.5);
          }
        }`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = mix(mix(roughnessFactor, 0.36, vMetalIn), 0.75, icGlass);`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
        metalnessFactor = mix(vMetalIn * 0.95, 0.0, icGlass);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += icRefl + vec3(1.0, 0.72, 0.4) * icLit * 0.42;`);
  };
  return m;
}

// ---------------------------------------------------------------- the recipes

const icon = (id: string) => ICONS.find((i) => i.id === id)!;
const corners = (t: Box): [number, number][] => [[t.x0, t.z0], [t.x1, t.z0], [t.x0, t.z1], [t.x1, t.z1]];

/** A stepped deco parapet, climbing to the middle of each side. */
function steppedParapet(B: Builder, t: Block, h: number, s: Skin) {
  for (const f of facesOf(t)) {
    const n = Math.max(2, Math.round(f.w / 2.2)), d = f.w / n;
    for (let i = 0; i < n; i++) {
      const k = 1 - Math.abs((i + 0.5) / n - 0.5) * 2;
      B.onWall(f, (i + 0.5) * d, t.y1 - 0.2, t.y1 + 0.4 + Math.ceil(k * 3) / 3 * h, d - 0.04, 0.35, s, -0.3);
    }
  }
}

function empire(B: Builder) {
  const T = icon("empire").tiers;
  const lime = 0xdad2be;
  const shaft: Skin = { c: lime, mode: 2, bay: 3.05, floor: 3.9, win: 0.42 };
  const lid = TAR, pier = stoneOf(0xe6dfcc, 0.35), trim = stoneOf(0xefe9d8, 0.3);
  const t0 = T[0];
  // the base: a two-storey shop band of dark glass and bronze, limestone above, the corner piers carrying down to the street
  B.block({ ...t0, y1: 8 }, { c: 0x2a2c2e, mode: 3, bay: 2.6, floor: 2.7, metal: 0.2 }, lid);
  B.block({ ...t0, y0: 8 }, { c: lime, mode: 1, bay: 3.05, floor: 3.9, win: 0.5 }, lid);
  B.ribs(t0, 0, t0.y1, 9.15, 0.5, 1.4, pier);
  B.cornice(t0, 7.6, 1.1, 0.5, stoneOf(0x8a7648, 0.2));
  B.cornice(t0, t0.y1 - 1, 1.5, 0.7, trim);
  // the great entrance on Fifth Avenue: a tall bay of bronze and glass under a deco sunburst
  const fifth = facesOf(t0)[2], mid = fifth.w / 2;
  B.onWall(fifth, mid, 0, 18, 15, 0.9, stoneOf(0xe0d8c4, 0.4));
  B.arch(fifth, mid, 0, 9, 11, 4.5, 0.95, smooth(0x2a2418, 0.7), true);
  B.arch(fifth, mid, 0, 7, 8, 3, 1.0, { c: 0x202a30, mode: 3, bay: 1.4, floor: 2.2, metal: 0.2 });
  for (let i = -3; i <= 3; i++) B.onWall(fifth, mid + i * 1.2, 11 + (3 - Math.abs(i)) * 0.9, 16.5, 0.28, 1.1, smooth(0xb8974e, 1));
  B.onWall(facesOf(t0)[1], t0.x1 - t0.x0 - 22, 0, 12, 12, 0.7, stoneOf(0xe0d8c4, 0.4));
  B.arch(facesOf(t0)[1], t0.x1 - t0.x0 - 22, 0, 7, 8, 2.8, 0.74, smooth(0x24282c, 0.6));
  // the setbacks: each stage's piers and its stepped top
  T.slice(1, 9).forEach((t, i) => {
    B.block(t, shaft, lid);
    B.ribs(t, t.y0, t.y1, 3.05 * 3, 0.42, 1.25, pier);
    if (t.y1 - t.y0 > 12) steppedParapet(B, t, i < 3 ? 2.6 : 1.6, trim);
    B.ledge(t, t.y1 - 0.5, t.y1, 0.42, trim);
    // the notched corners that make it look so slim
    for (const [cx, cz] of corners(t)) {
      const sx = cx === t.x0 ? 1 : -1, sz = cz === t.z0 ? 1 : -1;
      B.block({ x0: Math.min(cx, cx + sx * 1.1), x1: Math.max(cx, cx + sx * 1.1), z0: Math.min(cz - sz * 0.05, cz + sz * 1.1), z1: Math.max(cz - sz * 0.05, cz + sz * 1.1), y0: t.y0, y1: t.y1 + 0.1 }, stoneOf(0xcfc7b2, 0.3));
    }
  });
  // the top: deco fins climbing past the deck to the mast
  const M = T[9], x = (M.x0 + M.x1) / 2, z = (M.z0 + M.z1) / 2;
  for (const q of T.slice(5, 9)) B.ribs(q, q.y0, q.y1 + 2.5, 3.4, 0.6, 0.55, trim);
  // the 86th-floor deck's fence
  const deck = T[8];
  B.ribs(deck, deck.y1, deck.y1 + 2.6, 1.5, 0.05, 0.05, IRON);
  B.ledge(deck, deck.y1 + 2.5, deck.y1 + 2.6, 0.03, IRON);
  // the mooring mast: aluminium fins, a glass drum, the dome and the antenna
  B.block(M, { c: 0x86909a, mode: 2, bay: 1.1, floor: 3, win: 0.5, metal: 0.8 }, STEEL);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8, r = 6.8, fx = x + Math.sin(a) * r, fz = z + Math.cos(a) * r;
    B.drum(fx, fz, 0.36, 0.18, M.y0 - 3, M.y1 + 3, 5, STEEL);
  }
  B.drum(x, z, 4.4, 4.4, M.y1, M.y1 + 1, 16, STEEL, true);
  B.drum(x, z, 3.6, 3, M.y1 + 1, M.y1 + 8, 16, { c: 0xc2cad2, mode: 2, bay: 0.95, floor: 3, win: 0.6, metal: 0.8 });
  B.drum(x, z, 3.2, 1, M.y1 + 8, M.y1 + 11, 16, STEEL);
  B.drum(x, z, 0.9, 0.55, M.y1 + 11, M.y1 + 22, 8, LEAD);
  B.drum(x, z, 0.55, 0.1, M.y1 + 22, 445, 6, smooth(0xd8dade, 0.8));
  for (const [yy, rr] of [[M.y1 + 26, 1.5], [M.y1 + 31, 1.1], [M.y1 + 36, 0.8]] as const) B.drum(x, z, rr, rr, yy, yy + 0.25, 8, LEAD, true);
}

function woolworth(B: Builder) {
  const T = icon("woolworth").tiers;
  const cream = 0xe9dec2;
  const terra: Skin = { c: cream, mode: 2, bay: 2.3, floor: 4, win: 0.34 };
  const rib = stoneOf(0xf1e8d0, 0.25, 1.4, 0.9), trim = stoneOf(0xf4ecd8, 0.2);
  // the base: broad, ribbed, a loggia of arches at the street and a green mansard
  const b = T[0];
  B.block(b, terra, TAR);
  B.ribs(b, 0, b.y1, 6.9, 0.55, 0.85, rib);
  for (const f of facesOf(b)) {
    const n = Math.round(f.w / 6.9), d = f.w / n;
    for (let i = 0; i < n; i++) {
      B.arch(f, (i + 0.5) * d, 0, d * 0.62, 9, 4, 0.06, { c: 0x24282c, mode: 3, bay: 1.2, floor: 2.4 });
      B.arch(f, (i + 0.5) * d, b.y1 - 12, d * 0.66, b.y1 - 5, 3, 0.06, { c: 0x2c3036, mode: 5, bay: 2.2, floor: 7, win: 0.5 });
      B.gable(f, (i + 0.5) * d, b.y1 + 0.2, d * 0.9, 3.6, 0.5, rib);
    }
  }
  for (const y of [15, 34, b.y1 - 13]) B.ledge(b, y, y + 0.7, 0.75, trim);
  B.cornice(b, b.y1 - 1.8, 2, 1.1, trim);
  B.taper({ x0: b.x0 + 0.3, x1: b.x1 - 0.3, z0: b.z0 + 0.3, z1: b.z1 - 0.3, y0: b.y1 + 0.2, y1: b.y1 + 9 }, 7.5, 7.5, COPPER);
  // the tower, in stages, ribs running clear up each, gabled and pinnacled where it steps in
  for (let i = 1; i <= 3; i++) {
    const t = T[i], big = 4 - i;
    B.block(t, terra, TAR);
    B.ribs(t, t.y0, t.y1 + 2, 4.6, 0.55, 0.62, rib);
    B.ledge(t, t.y1 - 1.1, t.y1 + 0.2, 0.75, trim);
    B.ledge(t, t.y1 - 7.2, t.y1 - 6.6, 0.55, trim);
    for (const f of facesOf(t)) {
      const n = Math.max(3, Math.round(f.w / 4.6)), d = f.w / n;
      for (let k = 0; k < n; k++) {
        B.arch(f, (k + 0.5) * d, t.y1 - 6.4, d * 0.56, t.y1 - 3, 2.1, 0.05, { c: 0x22262c, mode: 6 });
        B.gable(f, (k + 0.5) * d, t.y1 + 0.2, d * 0.86, 2 + big * 0.5, 0.5, rib);
        if (k > 0) B.pinnacle(f.x + f.ux * k * d + f.nx * 0.45, f.z + f.uz * k * d + f.nz * 0.45, t.y1 - 0.2, 3.6 + big, 0.26, rib);
      }
    }
    for (const [px, pz] of corners(t)) {
      B.drum(px, pz, 1.3, 1.1, t.y1 - 11 - big * 3, t.y1 + 2, 8, rib);
      B.pinnacle(px, pz, t.y1 + 1.5, 7 + big * 2.6, 0.9, rib);
    }
  }
  // the copper crown, its dormers, the lantern and its gold spike
  const P = T[4], L = T[5], cx = (P.x0 + P.x1) / 2, cz = (P.z0 + P.z1) / 2;
  B.ledge(T[3], T[3].y1, T[3].y1 + 0.4, 0, COPPER);
  B.taper({ x0: T[3].x0 + 1, x1: T[3].x1 - 1, z0: T[3].z0 + 1, z1: T[3].z1 - 1, y0: T[3].y1, y1: P.y1 }, (T[3].x1 - T[3].x0) / 2 - 2.4, (T[3].z1 - T[3].z0) / 2 - 2.4, COPPER);
  for (const y of [T[3].y1 + 3, T[3].y1 + 8]) {
    const r = (T[3].x1 - T[3].x0) / 2 - 1 - ((y - T[3].y1) / (P.y1 - T[3].y1)) * ((T[3].x1 - T[3].x0) / 2 - 3.4);
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, 4], [r, -4], [-r, 4], [-r, -4], [4, r], [-4, r], [4, -r], [-4, -r]]) {
      B.block({ x0: cx + dx - 0.55, x1: cx + dx + 0.55, z0: cz + dz - 0.55, z1: cz + dz + 0.55, y0: y, y1: y + 1.4 }, stoneOf(0xe6dcc0, 0.2));
      B.taper({ x0: cx + dx - 0.7, x1: cx + dx + 0.7, z0: cz + dz - 0.7, z1: cz + dz + 0.7, y0: y + 1.4, y1: y + 2.6 }, 0.68, 0.68, GILT);
    }
  }
  B.drum(cx, cz, 2.2, 1.7, L.y0 - 1, L.y0 + 1.2, 8, COPPER);
  B.drum(cx, cz, 1.3, 0.12, L.y0 + 1.2, L.y1 + 1, 8, GILT);
}

function municipal(B: Builder) {
  const T = icon("municipal").tiers, cx = (T[0].x0 + T[0].x1) / 2, cz = (T[0].z0 + T[0].z1) / 2;
  const granite = 0xd9d3c2, pale: Skin = { c: granite, mode: 2, bay: 2.4, floor: 3.6, win: 0.38 };
  const marble = stoneOf(0xe8e3d5, 0.35), rust = stoneOf(0xcbc5b4, 1, 2.2, 1.1);
  const t = T[0];
  B.block(t, { c: granite, mode: 1, bay: 2.6, floor: 3.7, win: 0.46 }, TAR);
  B.ribs(t, 22, t.y1 - 10, 12.5, 0.45, 1.5, marble);
  // the rusticated base and the colonnade along both long fronts, the street's own arch through the middle
  B.block({ x0: t.x0, x1: t.x1, z0: t.z0, z1: t.z1, y0: 0, y1: 24 }, rust, marble);
  for (let i = 0; i < 20; i++) {
    const z = t.z0 + 3 + (i * (t.z1 - t.z0 - 6)) / 19;
    if (Math.abs(z - cz) < 9.5) continue;
    for (const x of [t.x1 + 1.6, t.x0 - 1.6]) { B.drum(x, z, 0.92, 0.82, 0, 17, 12, marble); B.drum(x, z, 0.9, 1.3, 17, 18.2, 12, marble); B.drum(x, z, 1.2, 0.95, 0, 0.9, 12, marble); }
  }
  for (const x0 of [t.x0 - 2.9, t.x1 - 0.1]) B.block({ x0, x1: x0 + 3, z0: t.z0, z1: t.z1, y0: 18.2, y1: 21 }, marble);
  for (const f of facesOf(t).slice(2)) {
    B.onWall(f, f.w / 2, 0, 29, 25, 2.8, marble);
    B.arch(f, f.w / 2, 0, 15, 12, 7.5, 2.85, VOID, false);
    B.onWall(f, f.w / 2, 29, 31.5, 28, 3.3, marble);
    for (const o of [-10.5, 10.5]) B.onWall(f, f.w / 2 + o, 0, 26, 2.4, 3.3, marble);
  }
  B.cornice(t, 21, 2.6, 0.7, marble);
  // up near the top a screen of columns on the main block, under the big cornice
  for (const f of facesOf(t)) {
    const n = Math.round(f.w / 3.4), d = f.w / n;
    for (let i = 0; i <= n; i++) { const p = on(f, i * d, 0, 0.7); B.drum(p[0], p[2], 0.42, 0.36, t.y1 - 11, t.y1 - 3.2, 8, marble); }
  }
  B.cornice(t, t.y1 - 3.2, 3.2, 1.3, marble);
  B.ribs(t, t.y1, t.y1 + 1.3, 1.1, 0.1, 0.45, marble);
  // the tiers of the cake: each its colonnade and corner turrets, each smaller than the last
  [T[1], T[2]].forEach((q, k) => {
    B.block(q, pale, TAR);
    for (const f of facesOf(q)) {
      const n = Math.round(f.w / 2.7), d = f.w / n;
      for (let i = 0; i <= n; i++) { const p = on(f, i * d, 0, 0.6); B.drum(p[0], p[2], 0.34, 0.3, q.y0 + 3, q.y1 - 2.4, 8, marble); }
      B.gable(f, f.w / 2, q.y1 + 0.8, f.w * 0.52, 2.8, 0.7, marble);
    }
    B.cornice(q, q.y1 - 2.4, 3.2, 0.9, marble);
    for (const [px, pz] of corners(q)) {
      const r = k === 0 ? 2.7 : 2.1;
      B.drum(px, pz, r, r, q.y0, q.y1 + 2.2, 14, { c: granite, mode: 2, bay: 1.3, floor: 3.2, win: 0.46 });
      B.drum(px, pz, r + 0.35, r + 0.35, q.y1 + 2.2, q.y1 + 2.8, 14, marble, true);
      B.drum(px, pz, r * 0.72, r * 0.72, q.y1 + 2.8, q.y1 + 5, 10, marble);
      B.drum(px, pz, r * 0.88, 0.1, q.y1 + 5, q.y1 + 9, 10, GILT);
    }
  });
  // the drum, ringed with columns, under its gold dome
  const R = 6.6, D = T[3];
  B.drum(cx, cz, R - 1.2, R - 1.2, D.y0, D.y1, 20, { c: granite, mode: 2, bay: 1.4, floor: 3, win: 0.42 });
  B.drum(cx, cz, R + 0.4, R + 0.4, D.y0, D.y0 + 0.9, 20, marble, true);
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; B.drum(cx + Math.sin(a) * R, cz + Math.cos(a) * R, 0.36, 0.3, D.y0 + 0.9, D.y1 - 1.2, 8, marble); }
  B.drum(cx, cz, R + 0.5, R + 0.5, D.y1 - 1.2, D.y1 + 0.2, 20, marble);
  B.drum(cx, cz, R + 0.2, 4.4, D.y1 + 0.2, D.y1 + 2.2, 20, GILT);
  B.drum(cx, cz, 4.4, 1.6, D.y1 + 2.2, D.y1 + 4, 20, GILT);
  // Civic Fame, in gold, her crown held up
  const y = D.y1 + 4;
  B.drum(cx, cz, 0.85, 0.78, y, y + 0.8, 10, marble);
  B.drum(cx, cz, 0.62, 0.34, y + 0.8, y + 3.6, 10, GILT);
  B.drum(cx, cz, 0.34, 0.42, y + 3.6, y + 4.6, 8, GILT);
  B.drum(cx, cz, 0.3, 0.24, y + 4.6, y + 5.1, 8, GILT);
  B.drum(cx, cz, 0.12, 0.12, y + 4.5, y + 7, 5, GILT);
  B.drum(cx, cz, 0.42, 0.42, y + 6.8, y + 7.05, 10, GILT, true);
}

interface ClockFace { x: number; y: number; z: number; nx: number; nz: number; r: number }

function metlife(B: Builder, clock: ClockFace[]) {
  const T = icon("metlife").tiers, cx = (T[0].x0 + T[0].x1) / 2, cz = (T[0].z0 + T[0].z1) / 2;
  const marble = stoneOf(0xe6e2d5, 0.5, 1.8, 0.75), trim = stoneOf(0xf0ecdf, 0.2);
  const t = T[0];
  B.block(t, { c: 0xe1dccd, mode: 1, bay: 2.45, floor: 3.9, win: 0.46 }, TAR);
  // the campanile's corner piers, running the height of it, and its belt courses
  for (const [px, pz] of corners(t)) B.block({ x0: px - 1.5, x1: px + 1.5, z0: pz - 1.5, z1: pz + 1.5, y0: 0, y1: t.y1 - 2 }, marble);
  for (const y of [14, 30, 62, 104, 124, 150, 166]) B.cornice(t, y - 0.7, 1, 0.5, trim);
  // triple arches at the head of the shaft, on each face, over the clocks
  for (const f of facesOf(t)) {
    for (const o of [-5.2, 0, 5.2]) B.arch(f, f.w / 2 + o, 152, 3.8, 160, 3.2, 0.06, VOID, false);
    for (const o of [-7.5, -2.6, 2.6, 7.5]) { const p = on(f, f.w / 2 + o, 0, 0.5); B.drum(p[0], p[2], 0.34, 0.28, 152, 163, 8, trim); }
    const m = on(f, f.w / 2, 138, 0.3);
    clock.push({ x: m[0], y: 138, z: m[2], nx: f.nx, nz: f.nz, r: 7.6 });
    B.onWall(f, f.w / 2, 128.5, 147.5, 18.6, 0.28, stoneOf(0xd2c7ab, 0.2));
    // the arcade down at the street
    for (const o of [-7, 0, 7]) B.arch(f, f.w / 2 + o, 0, 5, 7.5, 2.6, 0.06, { c: 0x22262a, mode: 3, bay: 1.2, floor: 2.4 }, false);
  }
  // the loggia: columns round a recessed tier, under a deep cornice
  const L = T[1];
  B.block({ x0: L.x0 + 1.5, x1: L.x1 - 1.5, z0: L.z0 + 1.5, z1: L.z1 - 1.5, y0: L.y0, y1: L.y1 }, VOID);
  for (const f of facesOf(L)) {
    const n = 5, d = f.w / n;
    for (let i = 0; i <= n; i++) { const p = on(f, i * d, 0, -0.6); B.drum(p[0], p[2], 0.5, 0.42, L.y0 + 0.3, L.y1 - 1.8, 10, trim); }
  }
  B.block({ ...L, y0: L.y0, y1: L.y0 + 0.4 }, trim);
  B.cornice(L, L.y1 - 1.8, 2.2, 0.8, trim);
  B.ribs(L, L.y1 + 0.3, L.y1 + 1.4, 1, 0.1, 0.34, trim);
  // the pyramid and its lantern, all in gold
  const P = T[2], Q = T[3], C = T[4];
  B.taper({ x0: L.x0 + 0.3, x1: L.x1 - 0.3, z0: L.z0 + 0.3, z1: L.z1 - 0.3, y0: L.y1 + 0.4, y1: P.y1 + 8 }, 8, 6.5, GILT);
  B.block({ ...Q, y0: Q.y0 + 2, y1: Q.y1 - 1 }, marble);
  for (const [px, pz] of corners(Q)) B.drum(px, pz, 0.45, 0.38, Q.y0 + 2, Q.y1 - 1, 8, trim);
  B.ledge(Q, Q.y1 - 1.2, Q.y1 - 0.4, 0.6, trim);
  B.taper({ ...Q, y0: Q.y1 - 0.4, y1: C.y0 + 3 }, 2.6, 1.8, GILT);
  B.drum(cx, cz, 1.8, 1.5, C.y0 + 2, C.y0 + 4.4, 10, GILT);
  B.drum(cx, cz, 1.6, 0.06, C.y0 + 4.4, C.y1, 10, GILT);
}

function flatiron(B: Builder, city: CityData) {
  const b = city.buildings.find((q) => Math.hypot(q.cx - FLATIRON.x, q.cz - FLATIRON.z) < 4);
  if (!b) return;
  const ring = b.poly[0], n = ring.length / 2, cx = b.cx, cz = b.cz, top = b.h;
  const lime = stoneOf(0xcfc7b0, 1, 1.9, 0.72), terra = 0xd2c6a4;
  let area = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; area += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1]; }
  const wall = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number, s: Skin) => {
    if (area > 0) B.quad([bx, y0, bz], [ax, y0, az], [ax, y1, az], [bx, y1, bz], s); else B.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], s);
  };
  const grow = (x: number, z: number, k: number) => { const d = Math.hypot(x - cx, z - cz) || 1; return [x + ((x - cx) / d) * k, z + ((z - cz) / d) * k] as const; };
  const moulding = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number, k: number, s: Skin) => {
    const [Ax, Az] = grow(ax, az, k), [Bx, Bz] = grow(bx, bz, k), U = [[0, 0], [1, 0], [1, 1], [0, 1]];
    wall(Ax, Az, Bx, Bz, y0, y1, s);
    if (area > 0) { B.quad([Ax, y1, Az], [ax, y1, az], [bx, y1, bz], [Bx, y1, Bz], s, U); B.quad([ax, y0, az], [Ax, y0, Az], [Bx, y0, Bz], [bx, y0, bz], s, U); }
    else { B.quad([Bx, y1, Bz], [bx, y1, bz], [ax, y1, az], [Ax, y1, Az], s, U); B.quad([bx, y0, bz], [Bx, y0, Bz], [Ax, y0, Az], [ax, y0, az], s, U); }
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1], L = Math.hypot(bx - ax, bz - az);
    // shops, a rusticated limestone base, the long rippling shaft, an arcade at the top
    wall(ax, az, bx, bz, 0, 5, { c: 0x40423f, mode: 3, bay: 3.4, floor: 5, metal: 0.3 });
    wall(ax, az, bx, bz, 5, 16, lime);
    wall(ax, az, bx, bz, 16, top - 15, { c: terra, mode: 1, bay: 2.15, floor: 3.55, win: 0.5 });
    wall(ax, az, bx, bz, top - 15, top - 5.5, { c: 0xcabd9a, mode: 5, bay: 2.15, floor: 9.5, win: 0.66 });
    wall(ax, az, bx, bz, top - 5.5, top, stoneOf(0xd6caaa, 0.3));
    moulding(ax, az, bx, bz, 15.4, 16.5, 0.7, stoneOf(0xe0d6bb, 0.2));
    moulding(ax, az, bx, bz, top - 15.6, top - 14.8, 0.5, stoneOf(0xe0d6bb, 0.2));
    moulding(ax, az, bx, bz, top - 5, top - 4, 0.5, stoneOf(0xe0d6bb, 0.2));
    moulding(ax, az, bx, bz, top - 2.4, top - 1.2, 2.2, stoneOf(0xe6dcc2, 0.15));
    moulding(ax, az, bx, bz, top - 3.2, top - 2.4, 1.1, stoneOf(0xd6caaa, 0.15));
    moulding(ax, az, bx, bz, 4.8, 5.5, 0.35, stoneOf(0x8a8370, 0.15));
    if (L > 12) {
      // the shallow oriels that ripple along its long sides, and the piers between them
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      let nx = -tz, nz = tx;
      if (nx * ((ax + bx) / 2 - cx) + nz * ((az + bz) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
      const face: Face = { x: ax, z: az, ux: tx, uz: tz, nx, nz, w: L };
      const bays = Math.round(L / 8.6), d = L / bays;
      for (let k = 0; k < bays; k++) {
        const c = (k + 0.5) * d;
        B.onWall(face, c, 16.5, top - 15, d * 0.42, 0.5, { c: terra, mode: 1, bay: 1.2, floor: 3.55, win: 0.56 });
        B.onWall(face, k * d, 5, 16, 0.9, 0.35, lime);
        B.onWall(face, k * d, 16.5, top - 15, 0.5, 0.25, stoneOf(0xd8ccab, 0.3));
      }
      for (let k = 0; k <= L / 1.3; k++) B.onWall(face, k * 1.3, top - 2.7, top - 2.4, 0.32, 1, stoneOf(0xe6dcc2, 0.1));
    }
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, c = [cx, top - 0.5, cz], p = [ring[i * 2], top - 0.5, ring[i * 2 + 1]], q = [ring[j * 2], top - 0.5, ring[j * 2 + 1]], U = [[0, 0], [1, 0], [1, 1], [0, 1]];
    if (area > 0) B.quad(q, p, c, c, TAR, U); else B.quad(p, q, c, c, TAR, U);
  }
  // the parapet and a roof shed and tank, as there are
  B.block({ x0: cx - 3, x1: cx + 3, z0: cz - 4, z1: cz + 4, y0: top - 0.5, y1: top + 2 }, stoneOf(0xa49a84, 0.2), TAR);
}

function oneTimes(B: Builder) {
  const T = icon("onetimes").tiers, t = T[0];
  B.block(t, { c: 0xcfcabb, mode: 1, bay: 2.7, floor: 3.8, win: 0.5 }, TAR);
  B.ribs(t, 12, t.y1, 5.4, 0.3, 0.7, stoneOf(0xd9d4c6, 0.3));
  B.block({ ...t, y1: 11 }, { c: 0x1a1c20, mode: 6 }, TAR);
  B.cornice(t, t.y1 - 1, 1.2, 0.5, stoneOf(0xdad5c6, 0.2));
  // the frame the ball rides up and down, and the machine room under it
  const M = T[1], x = (M.x0 + M.x1) / 2, z = (M.z0 + M.z1) / 2;
  B.block({ ...M, y1: M.y1 - 1 }, stoneOf(0x8d8a82, 0.2), LEAD);
  B.drum(x, z, 0.35, 0.2, M.y1 - 1, 123, 8, STEEL);
  for (const o of [-1.2, 1.2]) B.drum(x + o, z, 0.08, 0.08, M.y1 - 1, 119, 5, IRON);
  for (const y of [111, 114, 117]) B.block({ x0: x - 1.4, x1: x + 1.4, z0: z - 0.06, z1: z + 0.06, y0: y, y1: y + 0.1 }, IRON);
}

/** The New Year's ball, and the screens stacked up the building: bright, flat, always on. */
function oneTimesScreens(root: THREE.Group, screen: (i: number) => THREE.Texture) {
  const T = icon("onetimes").tiers[0];
  const face = (w: number, h: number, x: number, y: number, z: number, ry: number, i: number) => {
    const mat = new THREE.MeshBasicMaterial({ map: screen(i), toneMapped: false });
    mat.color.setScalar(1.05);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    root.add(m);
  };
  const cx = (T.x0 + T.x1) / 2, w = T.x1 - T.x0 + 1;
  // the south face is nothing but screens, one over another, from the marquee to the top
  let y = 12, i = 0;
  while (y < T.y1 - 6) {
    const h = Math.min(w * (0.42 + ((i * 7) % 5) * 0.08), T.y1 - y - 2);
    face(w, h, cx, y + h / 2, T.z0 - 0.6, Math.PI, i++);
    y += h + 0.7;
  }
  for (const [X, ry] of [[T.x0 - 0.5, -Math.PI / 2], [T.x1 + 0.5, Math.PI / 2]] as const) {
    let q = 16;
    for (let k = 0; k < 4; k++) { const h = 16; face(26, h, X, q + h / 2, T.z0 + 15, ry, i++); q += h + 3; }
  }
  // a news ticker round the base, and the ball itself: a mosaic of crystal, lit from inside
  face(w, 3.6, cx, 9, T.z0 - 0.8, Math.PI, 3);
  const g = new THREE.IcosahedronGeometry(2.1, 3).toNonIndexed();
  const col = new Float32Array(g.attributes.position.count * 3), c = new THREE.Color();
  for (let k = 0; k < col.length; k += 9) {
    c.setHSL(Math.abs(Math.sin(k * 12.9)), 0.75, 0.62);
    for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], k + v * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const ball = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.5, flatShading: true, metalness: 0.7, roughness: 0.15 }));
  ball.position.set(cx, 120.5, (T.z0 + T.z1) / 2);
  root.add(ball);
}

function trinity(B: Builder) {
  const T = icon("trinity").tiers;
  const brown = stoneOf(0x54413a, 0.8, 1.3, 0.55), dressed = stoneOf(0x5e4b43, 0.5, 1, 0.5), dark = stoneOf(0x3d2f2a, 0.5);
  const aisle = T[0], nave = T[1], ridge = T[2], W = T[3];
  // the aisles and the clerestory over them, each bay a pointed window between buttresses
  B.block(aisle, brown, SLATE);
  B.block(nave, brown, SLATE);
  const stained: Skin = { c: 0x14161c, mode: 5, bay: 3.2, floor: 7.4, win: 0.8 };
  for (const f of facesOf(aisle).slice(0, 2)) {
    const n = 7, d = f.w / n;
    for (let i = 0; i < n; i++) {
      B.arch(f, (i + 0.5) * d, 3, 3.3, 7.4, 2.4, 0.06, dressed);
      B.arch(f, (i + 0.5) * d, 3.2, 2.7, 7.3, 2.1, 0.09, stained);
      B.onWall(f, i * d, 0, 11, 1.2, 0.95, dressed);
      const p = on(f, i * d, 0, 0.45);
      B.pinnacle(p[0], p[2], 11, 4, 0.4, dressed);
    }
  }
  for (const f of facesOf(nave).slice(0, 2)) {
    const n = 7, d = f.w / n;
    for (let i = 0; i < n; i++) { B.arch(f, (i + 0.5) * d, 13, 2.6, 16.5, 1.6, 0.06, stained); B.onWall(f, i * d, 12, 19, 0.7, 0.4, dressed); }
  }
  B.taper({ x0: aisle.x0, x1: aisle.x1, z0: aisle.z0 - 0.25, z1: aisle.z1 + 0.25, y0: aisle.y1, y1: aisle.y1 + 3.2 }, 0, 4.9, SLATE);
  B.ledge(nave, nave.y1 - 0.5, nave.y1, 0.35, dressed);
  B.taper({ x0: ridge.x0, x1: ridge.x1, z0: nave.z0 - 0.25, z1: nave.z1 + 0.25, y0: nave.y1, y1: ridge.y1 + 1 }, 0, 8.05, SLATE);
  // the east end, its gable and great window
  const east = facesOf(aisle)[2];
  B.arch(east, east.w / 2, 3, 8, 14, 7, 0.06, dressed);
  B.arch(east, east.w / 2, 3.4, 6.8, 13.6, 6.2, 0.1, { c: 0x10121a, mode: 5, bay: 1.7, floor: 16, win: 0.72 });
  // the tower: stepped angle buttresses, three stages, a parapet of little gables
  B.block(W, brown, LEAD);
  for (const [px, pz] of corners(W)) {
    for (const [y0, y1, r] of [[0, 15, 1.9], [15, 29, 1.6], [29, 41, 1.25]] as const) {
      B.block({ x0: px - r, x1: px + r, z0: pz - r, z1: pz + r, y0, y1 }, dressed);
      B.taper({ x0: px - r, x1: px + r, z0: pz - r, z1: pz + r, y0: y1, y1: y1 + 1 }, 0.3, 0.3, dressed);
    }
    B.pinnacle(px, pz, 42, 8.5, 1.05, dressed);
    for (const a of [-1, 1]) B.pinnacle(px + a * 0.9, pz - a * 0.9, 42, 5, 0.3, dressed);
  }
  for (const y of [15, 29, 42.2]) B.cornice(W, y - 0.6, 0.9, 0.45, dressed);
  for (const f of facesOf(W)) {
    // the belfry: paired louvred lancets
    for (const o of [-2.1, 2.1]) {
      B.arch(f, f.w / 2 + o, 31.5, 3.2, 37.5, 2.6, 0.06, dressed);
      B.arch(f, f.w / 2 + o, 31.8, 2.5, 37.2, 2.1, 0.1, dark);
      for (let y = 32.2; y < 39; y += 0.75) B.onWall(f, f.w / 2 + o, y, y + 0.18, 2.1 - Math.max(0, y - 37.2) * 0.55, 0.14, dressed);
    }
    // the tall window below
    B.arch(f, f.w / 2, 17.5, 4.6, 24, 3.4, 0.06, dressed);
    B.arch(f, f.w / 2, 17.9, 3.7, 23.6, 2.9, 0.1, { c: 0x10121a, mode: 5, bay: 1.2, floor: 8.8, win: 0.72 });
    const n = 7;
    for (let k = 0; k < n; k++) B.gable(f, ((k + 0.5) * f.w) / n, 43, f.w / n - 0.1, 1.3, 0.3, dressed);
  }
  // the west door on Broadway, three orders deep, bronze
  const west = facesOf(W)[3], m = west.w / 2;
  B.arch(west, m, 0, 8.4, 7.4, 5.2, 0.3, dressed);
  B.arch(west, m, 0, 7, 7, 4.3, 0.42, brown);
  B.arch(west, m, 0, 5.6, 6.6, 3.5, 0.5, dressed);
  B.arch(west, m, 0, 4.2, 6.2, 2.7, 0.56, smooth(0x3e2f1c, 0.8));
  B.gable(west, m, 8.5, 11.5, 6.5, 0.6, dressed);
  // the spire, eight-sided and ribbed, little gabled lucarnes round its foot, to its gilt cross
  const cx = (W.x0 + W.x1) / 2, cz = (W.z0 + W.z1) / 2;
  B.drum(cx, cz, 6, 0.28, 43.6, 83, 8, stoneOf(0x4c3a34, 0.6, 1.2, 0.5));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, c = Math.sin(a), s = Math.cos(a);
    for (let k = 0; k < 14; k++) {
      const u = k / 14, r = 6 + (0.28 - 6) * (u + 0.035), y = 43.6 + 39.4 * u;
      B.block({ x0: cx + c * r - 0.16, x1: cx + c * r + 0.16, z0: cz + s * r - 0.16, z1: cz + s * r + 0.16, y0: y, y1: y + 3 }, dressed);
    }
    const b = a + Math.PI / 8, lx = cx + Math.sin(b) * 5.2, lz = cz + Math.cos(b) * 5.2;
    if (i % 2 === 0) { B.block({ x0: lx - 0.7, x1: lx + 0.7, z0: lz - 0.7, z1: lz + 0.7, y0: 47, y1: 49.6 }, dark); B.taper({ x0: lx - 0.85, x1: lx + 0.85, z0: lz - 0.85, z1: lz + 0.85, y0: 49.6, y1: 51.4 }, 0.8, 0.8, dressed); }
  }
  B.block({ x0: cx - 0.12, x1: cx + 0.12, z0: cz - 0.12, z1: cz + 0.12, y0: 83, y1: 86.4 }, GILT);
  B.block({ x0: cx - 0.8, x1: cx + 0.8, z0: cz - 0.09, z1: cz + 0.09, y0: 85, y1: 85.3 }, GILT);
  // the churchyard: grass and old stones tilted by three centuries, inside an iron railing
  const yard = { x0: -137, x1: -69, z0: 632, z1: 677 };
  B.quad([yard.x0, 0.42, yard.z1], [yard.x1, 0.42, yard.z1], [yard.x1, 0.42, yard.z0], [yard.x0, 0.42, yard.z0], smooth(0x56663c), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  B.ribs(yard, 0.1, 1.9, 0.55, 0.03, 0.035, IRON);
  for (const y of [1.75, 0.6]) B.ledge(yard, y, y + 0.05, 0.03, IRON);
  let sd = 77;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 160; k++) {
    const x = -136 + rnd() * 66, z = 633 + rnd() * 43;
    if (x > aisle.x0 - 1.5 && x < W.x1 + 1.5 && z > aisle.z0 - 1.5 && z < aisle.z1 + 1.5) continue;
    const w = 0.24 + rnd() * 0.28, h = 0.55 + rnd() * 0.75, lean = (rnd() - 0.5) * 0.28, c = rnd() < 0.5 ? 0x7d786c : 0x5f5b52, st = smooth(c);
    const U = [[0, 0], [1, 0], [1, 1], [0, 1]], top = 0.42 + h, d = 0.07;
    B.quad([x - w, 0.42, z + d], [x + w, 0.42, z + d], [x + w + lean, top, z + d], [x - w + lean, top, z + d], st, U);
    B.quad([x + w, 0.42, z - d], [x - w, 0.42, z - d], [x - w + lean, top, z - d], [x + w + lean, top, z - d], st, U);
    B.quad([x - w + lean, top, z + d], [x + w + lean, top, z + d], [x + lean, top + w * 0.7, z], [x + lean, top + w * 0.7, z], st, U);
    B.quad([x + w + lean, top, z - d], [x - w + lean, top, z - d], [x + lean, top + w * 0.7, z], [x + lean, top + w * 0.7, z], st, U);
  }
}

function nyse(B: Builder, flag: { x: number; y: number; z: number; w: number; h: number }[]) {
  const T = icon("nyse").tiers;
  const marble = stoneOf(0xe3decf, 0.55, 2, 0.8), trim = stoneOf(0xefeadc, 0.2), rust = stoneOf(0xd3cebd, 1, 2.4, 1.2);
  const body = T.find((t) => t.x0 === -246 && t.y0 === 9)!, base = T[0], E = T.find((t) => t.y0 === 28)!;
  const z0 = 566, z1 = 608, zm = 587;
  B.block(base, rust, TAR);
  B.block({ ...T[1] }, marble, trim);
  // the steps up to the portico
  for (let i = 0; i < 5; i++) B.block({ x0: -252.2 - (5 - i) * 0.42, x1: -252.2, z0: zm - 21, z1: zm + 21, y0: i * 0.3, y1: (i + 1) * 0.3 }, trim);
  B.block(body, { c: 0xdcd7c7, mode: 1, bay: 4.4, floor: 6.4, win: 0.5 }, TAR);
  B.ribs(body, 9, 28, 4.4, 0.25, 0.8, marble);
  // the great wall of glass behind the columns, gridded in bronze
  B.block({ x0: -246.3, x1: -245.9, z0: zm - 18.5, z1: zm + 18.5, y0: 5, y1: 27.6 }, { c: 0x3a4250, mode: 3, bay: 2.4, floor: 2.6, metal: 0.3 });
  // the six Corinthian columns and the pair of end piers
  for (const o of [-15, -9, -3, 3, 9, 15]) {
    const z = zm + o, x = -250;
    B.drum(x, z, 1.28, 1.08, 6, 25.4, 20, { c: 0xe6e1d3, mode: 6 });
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; B.drum(x + Math.sin(a) * 1.16, z + Math.cos(a) * 1.16, 0.06, 0.05, 6.4, 25.2, 4, trim); }
    B.drum(x, z, 1.7, 1.28, 5, 5.5, 20, trim); B.drum(x, z, 1.5, 1.4, 5.5, 6, 20, trim);
    // the capital: rows of acanthus flaring to the abacus
    B.drum(x, z, 1.1, 1.3, 25.4, 26.3, 20, trim);
    B.drum(x, z, 1.3, 1.62, 26.3, 27.3, 12, trim);
    B.block({ x0: x - 1.75, x1: x + 1.75, z0: z - 1.75, z1: z + 1.75, y0: 27.3, y1: 28 }, trim);
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.taper({ x0: x + a * 1.3 - 0.28, x1: x + a * 1.3 + 0.28, z0: z + b * 1.3 - 0.28, z1: z + b * 1.3 + 0.28, y0: 26.4, y1: 27.35 }, 0.2, 0.2, trim);
  }
  for (const z of [z0 + 2, z1 - 2]) B.block({ x0: -252, x1: -246, z0: z - 2, z1: z + 2, y0: 5, y1: 28 }, marble);
  // the entablature, its frieze and dentils
  B.block({ ...E, y1: E.y1 - 0.2 }, marble, TAR);
  B.cornice(E, 32.8, 1.5, 0.8, trim);
  const front = facesOf(E)[2];
  for (let i = 0; i < 44; i++) B.onWall(front, 0.5 + i * ((front.w - 1) / 43), 32.4, 32.8, 0.42, 0.4, trim);
  // the pitched roof over it all and the pediment at the front
  const y0 = 34.3, y1 = 41.5, x = -252.6, xb = -206, s = stoneOf(0xbdb8a8, 0.3);
  const U = [[0, 0], [1, 0], [1, 1], [0, 1]], rake = 23.8;
  B.block({ x0: -252, x1: -206, z0: zm - 11, z1: zm + 11, y0: 34, y1: 40 - 3.4 }, TAR);
  B.quad([x, y0, zm + rake], [x, y0, zm - rake], [x, y1, zm], [x, y1, zm], s, U);
  B.quad([xb, y0, zm + rake], [x, y0, zm + rake], [x, y1, zm], [xb, y1, zm], SLATE, U);
  B.quad([x, y0, zm - rake], [xb, y0, zm - rake], [xb, y1, zm], [x, y1, zm], SLATE, U);
  // the raking cornice, stood out from the tympanum
  const slope = (zA: number, zB: number) => {
    for (let k = 0; k < 12; k++) {
      const u = k / 12, v = (k + 1) / 12, ya = y0 + (y1 - y0) * u, yb = y0 + (y1 - y0) * v, za = zA + (zB - zA) * u, zb = zA + (zB - zA) * v;
      B.block({ x0: x - 0.7, x1: x + 0.1, z0: Math.min(za, zb), z1: Math.max(za, zb), y0: Math.min(ya, yb) + 0.05, y1: Math.max(ya, yb) + 0.45 }, trim);
    }
  };
  slope(zm + rake + 0.5, zm); slope(zm - rake - 0.5, zm);
  // Integrity Protecting the Works of Man: a row of pale figures, tallest at the middle, reclining toward the ends
  for (let i = -5; i <= 5; i++) {
    const zz = zm + i * 3.7, k = 1 - Math.abs(i) / 6.6, hh = 0.9 + k * 3.8, fx = x - 0.2;
    if (Math.abs(i) >= 4) { B.block({ x0: fx - 0.35, x1: fx + 0.2, z0: zz - 1.4, z1: zz + 1.4, y0: y0 + 0.1, y1: y0 + 0.75 }, trim); B.drum(fx, zz + Math.sign(i) * 1.2, 0.3, 0.26, y0 + 0.7, y0 + 1.15, 6, trim, true); continue; }
    B.drum(fx, zz, 0.62, 0.38, y0 + 0.1, y0 + hh * 0.72, 8, trim);
    B.drum(fx, zz, 0.3, 0.26, y0 + hh * 0.72, y0 + hh * 0.86, 6, trim);
    B.drum(fx, zz, 0.27, 0.14, y0 + hh * 0.86, y0 + hh, 6, trim, true);
  }
  // behind the columns, not over them
  flag.push({ x: -247.2, y: 16, z: zm, w: 33, h: 20 });
}

function hearst(B: Builder) {
  const T = icon("hearst").tiers, t = T[0], g = T[1];
  const stone = stoneOf(0xcbbf9f, 0.55, 2, 0.85), trim = stoneOf(0xd9cfb4, 0.2);
  // the 1928 base: rusticated, three-storey arched windows between giant pilasters, columns carrying urns and figures
  B.block(t, stone, smooth(0x65686c));
  B.cornice(t, 22, 1.2, 0.6, trim);
  B.cornice(t, t.y1 - 1.2, 1.5, 0.8, trim);
  for (const f of facesOf(t)) {
    const n = 5, d = f.w / n;
    for (let i = 0; i < n; i++) {
      const c = (i + 0.5) * d;
      B.arch(f, c, 7, d * 0.56, 17, d * 0.28, 0.05, trim, false);
      B.arch(f, c, 7.4, d * 0.46, 16.8, d * 0.23, 0.09, { c: 0x2a3038, mode: 3, bay: 1.2, floor: 2.3, metal: 0.2 }, false);
      B.onWall(f, c, 0, 6, d * 0.72, 0.1, { c: 0x25282c, mode: 3, bay: 2, floor: 6 });
      B.onWall(f, c, 24.6, 30, d * 0.55, 0.06, { c: 0xcbbf9f, mode: 1, bay: 2.2, floor: 5.4, win: 0.56 });
    }
    for (let i = 0; i <= n; i++) {
      B.onWall(f, i * d, 0, 22, 2.2, 0.55, stone);
      const p = on(f, i * d, 0, 1.2);
      B.drum(p[0], p[2], 0.72, 0.6, 7, 22, 12, trim);
      B.drum(p[0], p[2], 0.6, 1, 22, 23.2, 12, trim);
      // the figures the original builder meant to go on up there
      if (i > 0 && i < n) { B.drum(p[0], p[2], 0.5, 0.3, 24, 26, 8, trim); B.drum(p[0], p[2], 0.28, 0.14, 26, 26.8, 6, trim, true); }
    }
  }
  // the glass atrium showing between the old walls and the new tower
  B.block({ ...g, y0: t.y1, y1: 42, x0: g.x0 + 0.3, x1: g.x1 - 0.3, z0: g.z0 + 0.3, z1: g.z1 - 0.3 }, { c: 0x47505c, mode: 3, bay: 1.5, floor: 4, metal: 0.3 }, TAR);
  // the tower, cut back at each corner into the bird's mouth, its steel diagrid and a clean white top
  const skin: Skin = { c: 0x9fb2c0, mode: 4, bay: 15.5, floor: 4.05, metal: 0 };
  const C = 3.4, top = g.y1 - 0.4;
  B.block({ x0: g.x0, x1: g.x1, z0: g.z0 + C, z1: g.z1 - C, y0: 42, y1: top }, skin, smooth(0x7c8085));
  B.block({ x0: g.x0 + C, x1: g.x1 - C, z0: g.z0, z1: g.z1, y0: 42, y1: top }, skin, smooth(0x7c8085));
  for (const [px, pz] of corners(g)) {
    const sx = px === g.x0 ? 1 : -1, sz = pz === g.z0 ? 1 : -1;
    // the triangles at the chamfer, in pure white steel, zig-zagging up the corner
    for (let y = 42; y < top - 3; y += 12.4) {
      const a: P3 = [px + sx * C, y, pz], b: P3 = [px, y + 6.2, pz + sz * C], c: P3 = [px + sx * C, y + 12.4, pz];
      for (const [p, q] of [[a, b], [b, c]] as const) {
        const m = new THREE.Vector3(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        const L = m.length(), parts = 4;
        for (let k = 0; k < parts; k++) {
          const u = k / parts, x = q[0] + (p[0] - q[0]) * u, yy = q[1] + (p[1] - q[1]) * u, z = q[2] + (p[2] - q[2]) * u;
          B.block({ x0: x - 0.26, x1: x + 0.26, z0: z - 0.26, z1: z + 0.26, y0: yy - 0.2, y1: yy + L / parts + 0.2 }, smooth(0xe6e9ea, 0.5));
        }
      }
    }
    B.quad([px + sx * C, 42, pz], [px, 42, pz + sz * C], [px, top, pz + sz * C], [px + sx * C, top, pz], { c: 0x7f93a3, mode: 3, bay: 1.5, floor: 4, metal: 0.2 });
    B.quad([px, 42, pz + sz * C], [px + sx * C, 42, pz], [px + sx * C, top, pz], [px, top, pz + sz * C], { c: 0x7f93a3, mode: 3, bay: 1.5, floor: 4, metal: 0.2 });
  }
  B.block({ ...g, y0: top, y1: g.y1, x0: g.x0 + 0.1, x1: g.x1 - 0.1, z0: g.z0 + 0.1, z1: g.z1 - 0.1 }, smooth(0xdfe2e3, 0.3), smooth(0x7c8085));
  B.block({ x0: g.x0 + 8, x1: g.x1 - 8, z0: g.z0 + 8, z1: g.z1 - 8, y0: g.y1, y1: g.y1 + 3 }, smooth(0xb7bbbf, 0.4));
}

function chrysler(B: Builder) {
  const { x, z } = SKYLINE.chrysler;
  const brick: Skin = { c: 0xcfc9bc, mode: 2, bay: 2.8, floor: 3.8, win: 0.42 };
  const trim = stoneOf(0xe6e1d4, 0.2);
  const b0 = { x0: x - 44, x1: x + 44, z0: z - 40, z1: z + 40, y0: 0, y1: 66 }, b1 = { x0: x - 28, x1: x + 28, z0: z - 28, z1: z + 28, y0: 66, y1: 170 }, b2 = { x0: x - 21, x1: x + 21, z0: z - 21, z1: z + 21, y0: 170, y1: 225 };
  for (const q of [b0, b1, b2]) { B.block(q, brick, TAR); B.ribs(q, q.y0, q.y1, 8.4, 0.5, 1.2, trim); B.ledge(q, q.y1 - 1, q.y1, 0.5, trim); }
  // the steel eagles at the setback, and the terraced sunburst of seven arches round triangular windows
  const steel = smooth(0xd2d8df, 1), dark = smooth(0x181b20, 0.3);
  for (const [px, pz] of corners(b2)) { const sx = Math.sign(px - x), sz = Math.sign(pz - z); B.block({ x0: Math.min(px, px + sx * 4), x1: Math.max(px, px + sx * 4), z0: Math.min(pz, pz + sz * 4), z1: Math.max(pz, pz + sz * 4), y0: 222, y1: 224 }, steel); }
  let hw = 18, y = 225;
  for (let i = 0; i < 7; i++) {
    const h = 15 - i, top = hw * 0.76, q = { x0: x - hw, x1: x + hw, z0: z - hw, z1: z + hw };
    B.taper({ ...q, y0: y, y1: y + h }, hw - top, hw - top, steel);
    for (const f of facesOf(q)) {
      const k = (hw - top) / (hw * 2);
      // each face's arch is ribs of steel over a fan of narrow black triangles
      for (const r of [0.86, 0.7, 0.54]) {
        const W = f.w * r * (1 - k), u = f.w / 2;
        const p0 = on(f, u - W / 2, y + 1.2, 0.18 - k), p1 = on(f, u + W / 2, y + 1.2, 0.18 - k), p2 = on(f, u, y + h * (0.32 + r * 0.72), -(hw - top) * 0.7 + 0.1);
        B.quad(p0, p1, p2, p2, r === 0.54 ? dark : steel, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
    }
    y += h; hw = top;
  }
  B.drum(x, z, hw, 0.12, y, 319, 8, steel);
}

function oneWtc(B: Builder) {
  const { x, z } = SKYLINE.oneWtc, g: Skin = { c: 0x7f99b0, mode: 3, bay: 3, floor: 4, metal: 0.3 };
  B.block({ x0: x - 31, x1: x + 31, z0: z - 31, z1: z + 31, y0: 0, y1: 56 }, { c: 0xb0b6ba, mode: 3, bay: 1.4, floor: 2.4, metal: 0.6 }, TAR);
  // a square that turns as it climbs: four tall triangles, and four the other way up
  const yb = 56, yt = 417, h = 31, t = 22;
  const c = (a: number, r: number, y: number) => [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
  for (let i = 0; i < 4; i++) {
    const A = i * Math.PI / 2 + Math.PI / 4, B1 = A + Math.PI / 2, M = A + Math.PI / 4, R = h * Math.SQRT2;
    B.quad(c(B1, R, yb), c(A, R, yb), c(M, t * Math.SQRT2, yt), c(M, t * Math.SQRT2, yt), g, [[0, yb], [62, yb], [31, yt], [31, yt]]);
    const M2 = M + Math.PI / 2;
    B.quad(c(M2, t * Math.SQRT2, yt), c(M, t * Math.SQRT2, yt), c(B1, R, yb), c(B1, R, yb), g, [[0, yt], [44, yt], [22, yb], [22, yb]]);
  }
  B.block({ x0: x - t, x1: x + t, z0: z - t, z1: z + t, y0: yt - 0.5, y1: yt + 3 }, LEAD);
  B.drum(x, z, 7, 7, yt + 3, yt + 12, 12, STEEL);
  B.drum(x, z, 9, 9, yt + 12, yt + 14, 12, STEEL, true);
  B.drum(x, z, 2.5, 0.25, yt + 14, 541, 10, smooth(0xdcdfe2, 0.9));
}

/** Everything but the bright bits on one material, on one mesh a building. */
export class IconicTowers {
  readonly root = new THREE.Group();

  constructor(city: CityData, opts: { screen: (i: number) => THREE.Texture }) {
    this.root.name = "iconic";
    const mat = facadeMaterial();
    const clocks: ClockFace[] = [];
    const flags: { x: number; y: number; z: number; w: number; h: number }[] = [];
    const recipes: ((b: Builder) => void)[] = [
      empire, woolworth, municipal, (b) => metlife(b, clocks), (b) => flatiron(b, city), oneTimes, trinity, (b) => nyse(b, flags), hearst, chrysler, oneWtc,
    ];
    for (const r of recipes) {
      const b = new Builder();
      r(b);
      const m = b.mesh(mat);
      m.castShadow = true; m.receiveShadow = true;
      this.root.add(m);
    }
    oneTimesScreens(this.root, opts.screen);
    this.clocks(clocks);
    this.flags(flags);
  }

  /** The Met Life's four clocks: their faces lit, their hands at whatever the time is now. */
  private clockHands: { minute: THREE.Object3D; hour: THREE.Object3D }[] = [];
  private clocks(list: ClockFace[]) {
    const c = document.createElement("canvas"); c.width = c.height = 512;
    const d = c.getContext("2d")!;
    d.fillStyle = "#f4efdc"; d.beginPath(); d.arc(256, 256, 250, 0, 6.3); d.fill();
    d.strokeStyle = "#8a6a2a"; d.lineWidth = 14; d.stroke();
    d.fillStyle = "#26221c"; d.textAlign = "center"; d.textBaseline = "middle"; d.font = '700 54px Georgia, serif';
    ["XII", "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI"].forEach((t, i) => { const a = (i / 12) * Math.PI * 2; d.fillText(t, 256 + Math.sin(a) * 196, 256 - Math.cos(a) * 196); });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
    const hand = new THREE.MeshBasicMaterial({ color: 0x1a1612 });
    for (const k of list) {
      const pivot = new THREE.Group();
      pivot.position.set(k.x + k.nx * 0.1, k.y, k.z + k.nz * 0.1);
      pivot.rotation.y = Math.atan2(k.nx, k.nz);
      const disc = new THREE.Mesh(new THREE.PlaneGeometry(k.r * 2, k.r * 2), face);
      const minute = new THREE.Mesh(new THREE.BoxGeometry(0.34, k.r * 0.86, 0.06).translate(0, k.r * 0.36, 0.06), hand);
      const hour = new THREE.Mesh(new THREE.BoxGeometry(0.5, k.r * 0.55, 0.06).translate(0, k.r * 0.22, 0.1), hand);
      pivot.add(disc, minute, hour);
      this.root.add(pivot);
      this.clockHands.push({ minute, hour });
    }
  }

  /** The flag behind the Stock Exchange's columns. */
  private flags(list: { x: number; y: number; z: number; w: number; h: number }[]) {
    const c = document.createElement("canvas"); c.width = 760; c.height = 400;
    const d = c.getContext("2d")!;
    for (let i = 0; i < 13; i++) { d.fillStyle = i % 2 ? "#f4f2ec" : "#b22234"; d.fillRect(0, (i * 400) / 13, 760, 400 / 13 + 1); }
    d.fillStyle = "#3c3b6e"; d.fillRect(0, 0, 304, (7 * 400) / 13);
    d.fillStyle = "#f4f2ec";
    for (let y = 0; y < 9; y++) for (let x = 0; x < (y % 2 ? 5 : 6); x++) { d.beginPath(); d.arc(26 + (y % 2 ? 25 : 0) + x * 50, 18 + y * 22.5, 5.2, 0, 6.3); d.fill(); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    for (const f of list) {
      const g = new THREE.PlaneGeometry(f.w, f.h, 40, 10);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 0.5) * 0.22 + Math.sin(p.getX(i) * 0.13 + p.getY(i) * 0.2) * 0.2);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, side: THREE.DoubleSide }));
      m.position.set(f.x, f.y, f.z); m.rotation.y = -Math.PI / 2;
      m.castShadow = true;
      this.root.add(m);
    }
  }

  /** The clocks tell the real time. */
  update() {
    const now = new Date(), mins = now.getMinutes() + now.getSeconds() / 60, hrs = (now.getHours() % 12) + mins / 60;
    for (const h of this.clockHands) { h.minute.rotation.z = -(mins / 60) * Math.PI * 2; h.hour.rotation.z = -(hrs / 12) * Math.PI * 2; }
  }
}
