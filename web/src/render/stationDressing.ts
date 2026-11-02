// What makes a way into the subway read as a real one, over the models in subwayEntrances.ts and subwayArt.ts: the
// station's own black sign (name, lines, "Exit Only"), round glass globes in place of the models' low-poly ones, the
// concrete curb the railings stand on, the steel nosing at the head of the stairs, a sidewalk worn dark by the crowds
// going in, and what collects on the steps. Station names and lines are the data's. All of it is local to the opening.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CityData } from "../world/data";
import type { Facades } from "../world/facades";
import { STAIRS, type Shaft, type Underground } from "../world/underground";
import { entranceStyle } from "./subwayEntrances";
import { softDot } from "./life";

const hash = (a: number, b: number) => { let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; return ((x ^ (x >>> 12)) >>> 0) / 4294967296; };

// the MTA's route colours
const BULLET: Record<string, [string, string]> = {
  "1": ["#ee352e", "#fff"], "2": ["#ee352e", "#fff"], "3": ["#ee352e", "#fff"], "4": ["#00933c", "#fff"], "5": ["#00933c", "#fff"], "6": ["#00933c", "#fff"],
  N: ["#fccc0a", "#111"], Q: ["#fccc0a", "#111"], R: ["#fccc0a", "#111"], W: ["#fccc0a", "#111"],
};
const CELL = { w: 1024, h: 192, cols: 2 };

/** A sheet of every station's sign, in and out. */
function signSheet(cells: { name: string; lines: string; out: boolean }[]): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = CELL.w * CELL.cols; c.height = CELL.h * Math.ceil(cells.length / CELL.cols);
  const d = c.getContext("2d")!;
  cells.forEach((k, i) => {
    const x = (i % CELL.cols) * CELL.w, y = Math.floor(i / CELL.cols) * CELL.h;
    d.fillStyle = "#101113"; d.fillRect(x, y, CELL.w, CELL.h);
    // the white rule along the top of every sign in the system
    d.fillStyle = "#f4f4f0"; d.fillRect(x, y + 14, CELL.w, 7);
    let px = x + 44;
    d.textBaseline = "middle"; d.textAlign = "left";
    d.fillStyle = "#f6f6f2"; d.font = '700 76px "Helvetica Neue", Helvetica, Arial, sans-serif';
    let name = k.name;
    while (d.measureText(name).width > 620 && d.font.startsWith("700 7")) { d.font = '700 58px "Helvetica Neue", Helvetica, Arial, sans-serif'; name = k.name; }
    d.fillText(name, px, y + 80);
    d.font = '500 38px "Helvetica Neue", Helvetica, Arial, sans-serif';
    d.fillStyle = k.out ? "#e8604f" : "#cfcfca";
    d.fillText(k.out ? "Exit Only" : "Uptown & Downtown", px, y + 146);
    px = x + CELL.w - 40;
    for (const l of k.lines.split(" ").reverse()) {
      const [bg, fg] = BULLET[l] ?? ["#808183", "#fff"];
      d.fillStyle = bg; d.beginPath(); d.arc(px - 42, y + 104, 42, 0, 6.3); d.fill();
      d.fillStyle = fg; d.font = '700 58px "Helvetica Neue", Helvetica, Arial, sans-serif'; d.textAlign = "center";
      d.fillText(l, px - 42, y + 107);
      px -= 94;
    }
    d.textAlign = "left";
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Where a globe sits on each style of entrance, and where its sign plate is: (b, y, a) in the shaft's frame. */
const GLOBES: Record<string, [number, number, number]> = { railing: [2.15, 2.65, -2.35], kiosk: [2.5, 2.52, -2.35], canopy: [2.24, 3.13, -2.35], stone: [2.25, 3.89, -2.35] };
const PLATE: Record<string, { y: number; a: number; w: number; h: number; back?: number }> = {
  railing: { y: 2.05, a: 2.104, w: 2.0, h: 0.36, back: 2.196 },
  kiosk: { y: 2.27, a: 2.185, w: 2.6, h: 0.48 },
  canopy: { y: 2.25, a: 2.15, w: 2.6, h: 0.48 },
  stone: { y: 2.25, a: 2.17, w: 2.7, h: 0.5 },
};

export class StationDressing {
  readonly root = new THREE.Group();

  constructor(private u: Underground, private city: CityData, private facades: Facades) {
    const stairs = u.shafts.filter((s) => s.kind === "stairs");
    this.signs(stairs);
    this.globes(stairs);
    this.street(stairs);
    this.steps(stairs);
  }

  private at(s: Shaft, b: number, a: number) { return [s.x + s.ux * a + s.uz * b, s.z + s.uz * a - s.ux * b] as const; }

  private signs(stairs: Shaft[]) {
    const cells: { name: string; lines: string; out: boolean }[] = [], index = new Map<string, number>();
    const cellOf = (s: Shaft) => {
      const key = `${s.name}|${!!s.out}`;
      let i = index.get(key);
      if (i === undefined) {
        i = cells.length;
        cells.push({ name: s.name, lines: this.city.raw.stations.find((q) => q.n === s.name)?.r ?? "", out: !!s.out });
        index.set(key, i);
      }
      return i;
    };
    const assigned = stairs.map(cellOf), rows = Math.ceil(cells.length / CELL.cols);
    const pos: number[] = [], uv: number[] = [];
    const plate = (s: Shaft, cell: number, a: number, y: number, w: number, h: number, facing: 1 | -1) => {
      const u0 = (cell % CELL.cols) / CELL.cols, u1 = u0 + 1 / CELL.cols, v1 = 1 - Math.floor(cell / CELL.cols) / rows, v0 = v1 - 1 / rows;
      // read left to right facing it: looking along +a from the way in, right is -b (b = (uz, -ux))
      const c = (t: number, q: number) => { const [x, z] = this.at(s, -facing * (t - 0.5) * w, a); return [x, y + (q - 0.5) * h, z]; };
      const A = c(0, 0), B = c(1, 0), C = c(1, 1), D = c(0, 1);
      pos.push(...A, ...B, ...C, ...A, ...C, ...D);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    };
    stairs.forEach((s, i) => {
      const p = PLATE[entranceStyle(s, this.u)];
      plate(s, assigned[i], p.a, p.y, p.w, p.h, 1);
      { const [x, z] = this.at(s, 0, p.a); this.facades.addSolid(x, p.y, z, s.uz, -s.ux, p.w / 2, p.h / 2, 0.08, "a subway sign"); }
      if (p.back) plate(s, assigned[i], p.back, p.y, p.w, p.h, -1);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: signSheet(cells), toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.root.add(m);
  }

  private globes(stairs: Shaft[]) {
    const n = stairs.length * 2;
    const geo = new THREE.SphereGeometry(0.255, 24, 16);
    const col = new Float32Array(n * 3);
    geo.setAttribute("aCol", new THREE.InstancedBufferAttribute(col, 3));
    const mat = new THREE.ShaderMaterial({
      vertexShader: `attribute vec3 aCol; varying vec3 vC, vN, vV; varying float vY;
        void main(){ vC = aCol; vY = position.y; vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      // a lamp seen through thick glass: bright through the middle, deep at the rim, ribbed where it was moulded
      fragmentShader: `varying vec3 vC, vN, vV; varying float vY;
        void main(){ float f = pow(max(dot(normalize(vN), normalize(vV)), 0.0), 1.5);
          vec3 c = mix(vC * 0.28, mix(vC, vec3(1.0), 0.55) * 1.35, f) * (0.96 + 0.04 * sin(vY * 90.0));
          gl_FragColor = vec4(c, 1.0); }`,
    });
    const im = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    stairs.forEach((s, i) => {
      const [b, y, a] = GLOBES[entranceStyle(s, this.u)];
      [-1, 1].forEach((o, k) => {
        const [x, z] = this.at(s, o * b, a), j = i * 2 + k;
        this.facades.addSolid(x, y, z, 1, 0, 0.22, 0.22, 0.22, "a subway globe");
        im.setMatrixAt(j, m.makeTranslation(x, y, z));
        if (s.out) col.set([0.95, 0.16, 0.12], j * 3); else col.set([0.2, 0.78, 0.38], j * 3);
      });
    });
    im.frustumCulled = false;
    this.root.add(im);
  }

  private street(stairs: Shaft[]) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const SW = STAIRS.top, rail = stairs.filter((s) => entranceStyle(s, this.u) === "railing");
    // the curb the railings are let into
    const curb = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x8c8981, roughness: 0.95 }), rail.length * 3);
    rail.forEach((s, i) => {
      const yaw = Math.atan2(s.ux, s.uz);
      q.setFromAxisAngle(Y, yaw);
      [[-2.15, 0, 0.3, 4.6], [2.15, 0, 0.3, 4.6], [0, 2.15, 4.6, 0.3]].forEach(([b, a, w, d], k) => {
        const [x, z] = this.at(s, b, a);
        curb.setMatrixAt(i * 3 + k, m.compose(p.set(x, SW + 0.06, z), q, s3.set(w, 0.14, d)));
      });
    });
    curb.castShadow = false; curb.receiveShadow = true; curb.frustumCulled = false;
    this.root.add(curb);
    // the nosing at the head of the stairs: tread plate, and the yellow line along its edge
    const plate = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x3f4144, roughness: 0.42, metalness: 0.85 }), stairs.length);
    const line = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.7 }), stairs.length);
    // a sidewalk worn dark and polished by everyone going in
    const wear = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: softDot(), color: 0x0c0b0a, transparent: true, opacity: 0.34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), stairs.length);
    stairs.forEach((s, i) => {
      q.setFromAxisAngle(Y, Math.atan2(s.ux, s.uz));
      let [x, z] = this.at(s, 0, -STAIRS.half - 0.14);
      plate.setMatrixAt(i, m.compose(p.set(x, SW + 0.012, z), q, s3.set(STAIRS.halfWidth * 2, 0.024, 0.28)));
      [x, z] = this.at(s, 0, -STAIRS.half - 0.015);
      line.setMatrixAt(i, m.compose(p.set(x, SW + 0.014, z), q, s3.set(STAIRS.halfWidth * 2, 0.026, 0.05)));
      [x, z] = this.at(s, 0, -STAIRS.half - 1.7);
      wear.setMatrixAt(i, m.compose(p.set(x, SW + 0.018, z), q, s3.set(5.2, 1, 4.2)));
    });
    for (const im of [plate, line, wear]) { im.frustumCulled = false; this.root.add(im); }
    wear.renderOrder = 1;
  }

  private steps(stairs: Shaft[]) {
    // paper, a crushed cup, a dead MetroCard; only ever on the open steps, never in mid-air over the hall
    const paper = new THREE.PlaneGeometry(0.16, 0.11).rotateX(-Math.PI / 2);
    const cup = new THREE.CylinderGeometry(0.04, 0.03, 0.1, 8).rotateZ(Math.PI / 2).translate(0, 0.04, 0);
    const paint = (g: THREE.BufferGeometry, c: number) => { const k = new THREE.Color(c), a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) a.set([k.r, k.g, k.b], i); g.setAttribute("color", new THREE.BufferAttribute(a, 3)); g.deleteAttribute("uv"); return g.index ? g.toNonIndexed() : g; };
    const geos: THREE.BufferGeometry[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
    const COL = [0xe6e2d6, 0xe6e2d6, 0xcbb994, 0xd8b23a, 0x3a64a8, 0xb83a2c];
    for (const s of stairs) {
      for (let k = 0; k < 7; k++) {
        const r = (j: number) => hash(Math.round(s.x * 10) + k * 97, Math.round(s.z * 10) + j);
        const a = -STAIRS.half + 0.5 + r(1) * 5.2;
        if (s.aCut !== undefined && a > s.aCut - 0.5) continue;
        const [x, z] = this.at(s, (r(2) - 0.5) * STAIRS.halfWidth * 1.8, a);
        const stepUp = 0.18; // the steps are saw-toothed about the slope
        const y = STAIRS.top - (a + STAIRS.half) * STAIRS.slope + stepUp;
        const c = COL[Math.floor(r(3) * COL.length)], g = (r(4) < 0.2 ? cup : paper).clone();
        m.compose(p.set(x, y, z), q.setFromAxisAngle(Y, r(5) * 6.28), one);
        geos.push(paint(g.applyMatrix4(m), c));
      }
    }
    if (!geos.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(geos)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x444444, emissiveIntensity: 0.4 }));
    this.root.add(mesh);
  }
}
