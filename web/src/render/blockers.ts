// Draws the closures (world/blockers.ts), each one something a New Yorker would recognise:
//   water         the burst main: the block fenced off at street level with the crews' raw MDF hoarding, sandbags,
//                 sawhorses and an A-frame, FDNY / DEP / NYPD trucks with their lights going, crew in hi-vis; in
//                 the open middle a crater of broken asphalt with a cab nose-down at its edge, and the geyser
//                 erupting from it (billboards: a thick white column, sheets falling back, droplets, boil, mist
//                 drifting off downwind), the flood running away down the street both ways
//   construction  a building site on the block: full-height scaffold and green netting on the building's own
//                 frontage, a sidewalk shed along it, and the street shut at ground level by a shed deck run
//                 across it with MDF hoarding under its ends; jersey barriers and drums; a tower crane with its
//                 load swinging over the street (world/blockers.ts craneAt: solid), a concrete pump with its
//                 boom across the street (solid)
//   crowd         Times Square: NYPD and sanitation trucks parked nose to tail across the streets, stacked
//                 crowd-control barricades, and above them a dense web of holiday lights and banners up to
//                 the top (the lanes kept open along the ways through stay clear, signed EMERGENCY LANE)
//   parade        grandstands and police sawhorses, a web of bunting and parade banners up high, the balloon
//   festival      curtains of red lanterns, wall to wall up to the top (the low part is a stand-in:
//                 render/chinatown.ts puts paifang gates there and hides it, userData.festival, once it loads)
// The modelled pieces are public/models/closures.glb and the MDF / netting textures public/textures/closures
// (tools/closures: Blender + Tesseract), instanced; they arrive a moment after the rest.
// blockerMeshes(...).userData.update(t, clock) animates it all (the crane on the leaf's clock: it's solid).
// Lean on the low tier.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { craneAt, type Barrier, type Blocker, type Blockers } from "../world/blockers";

type Quality = "low" | "medium" | "high";

function colored(g: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
  g = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  g.deleteAttribute("uv");
  return g;
}

/** A giant inflatable turkey, about 13 m across, facing +z. */
function turkey(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    colored(new THREE.SphereGeometry(4.2, 20, 14).scale(1, 0.95, 1.15), 0x8a5428),                         // body
    colored(new THREE.SphereGeometry(2.0, 16, 12).translate(0, 3.6, 3.4), 0x9a6230),                       // head
    colored(new THREE.ConeGeometry(0.55, 1.4, 10).rotateX(Math.PI / 2).translate(0, 3.4, 5.6), 0xf0b020),  // beak
    colored(new THREE.SphereGeometry(0.55, 10, 8).scale(0.8, 1.6, 0.8).translate(0.3, 2.3, 5.1), 0xc8201c), // wattle
    colored(new THREE.SphereGeometry(0.42, 10, 8).translate(-0.85, 4.25, 5.05), 0xffffff),                 // eyes
    colored(new THREE.SphereGeometry(0.42, 10, 8).translate(0.85, 4.25, 5.05), 0xffffff),
    colored(new THREE.SphereGeometry(0.22, 8, 6).translate(-0.85, 4.3, 5.42), 0x111111),
    colored(new THREE.SphereGeometry(0.22, 8, 6).translate(0.85, 4.3, 5.42), 0x111111),
    colored(new THREE.CylinderGeometry(0.5, 0.4, 2.2, 8).translate(-1.6, -4.6, 0.6), 0xf0b020),            // legs
    colored(new THREE.CylinderGeometry(0.5, 0.4, 2.2, 8).translate(1.6, -4.6, 0.6), 0xf0b020),
  ];
  // the tail fan: a ring of fat feathers behind
  const fan = [0xc8381c, 0xf08a1c, 0xf0c22a, 0xc8381c, 0x6a9a3a, 0xf08a1c, 0xf0c22a, 0xc8381c, 0xf08a1c];
  fan.forEach((c, i) => {
    const a = -1.25 + (i / (fan.length - 1)) * 2.5;
    parts.push(colored(new THREE.SphereGeometry(1.6, 12, 8).scale(1, 3.2, 0.5).translate(0, 4.5, 0).rotateZ(a).translate(0, 1.0, -3.6), c));
  });
  return mergeGeometries(parts)!;
}

function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void, repeat = false) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

function banner(text: string, bg: string, fg: string) {
  return canvasTex(1024, 128, (x) => {
    x.fillStyle = bg; x.fillRect(0, 0, 1024, 128);
    x.strokeStyle = fg; x.lineWidth = 6; x.strokeRect(8, 8, 1008, 112);
    x.fillStyle = fg; x.font = "bold 64px Georgia, serif"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(text, 512, 68, 960);
  });
}

/** a soft round blob (mist, spray, halos) */
function blob() {
  return canvasTex(64, 64, (x) => {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.45, "rgba(255,255,255,0.5)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  });
}

// -------------------------------------------------------------------------------- the water

// billboards of water and mist: each its own size and opacity (sized in metres), fogged like everything else
const SPRAY_VS = /* glsl */ `
  #include <fog_pars_vertex>
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying float vA;
  void main() {
    vA = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * uScale / max(0.5, -mvPosition.z);
    #include <fog_vertex>
  }`;
const SPRAY_FS = /* glsl */ `
  #include <fog_pars_fragment>
  uniform sampler2D uMap;
  uniform vec3 uColor;
  varying float vA;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
    #include <fog_fragment>
  }`;

/** A cloud of water billboards: n of them, positions/sizes/alphas written each frame by update(). */
function sprayPoints(n: number, map: THREE.Texture, color: number) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(n), 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uColor: { value: new THREE.Color(color) }, uScale: { value: 620 } }]),
    vertexShader: SPRAY_VS, fragmentShader: SPRAY_FS, transparent: true, depthWrite: false, fog: true,
  });
  mat.uniforms.uMap.value = map;
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  return pts;
}

// -------------------------------------------------------------------------------- textures for the works

/** scale a plane's UVs so a repeating texture tiles every (su, sv) of it, from offset ou */
function tile(geo: THREE.BufferGeometry, su: number, sv: number, ou = 0) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su + ou, uv.getY(i) * sv);
  return geo;
}

function holidayBannerTex(i: number) {
  const bg = ["#9e1b1b", "#1d5a3a", "#1d3a7a"][i % 3], words = ["HAPPY", "SEASON'S", "NEW YORK"][i % 3], words2 = ["HOLIDAYS", "GREETINGS", "WINTER"][i % 3];
  return canvasTex(128, 512, (x) => {
    x.fillStyle = bg; x.fillRect(0, 0, 128, 512);
    x.strokeStyle = "#f4d27a"; x.lineWidth = 6; x.strokeRect(6, 6, 116, 500);
    x.fillStyle = "#f4f0e0";
    // a big snowflake
    x.save(); x.translate(64, 150); x.strokeStyle = "#f4f0e0"; x.lineWidth = 6;
    for (let k = 0; k < 6; k++) { x.rotate(Math.PI / 3); x.beginPath(); x.moveTo(0, 0); x.lineTo(0, 46); x.moveTo(0, 30); x.lineTo(12, 40); x.moveTo(0, 30); x.lineTo(-12, 40); x.stroke(); }
    x.restore();
    x.font = "bold 22px Georgia"; x.textAlign = "center";
    x.fillText(words, 64, 290); x.fillText(words2, 64, 320);
  });
}

// -------------------------------------------------------------------------------- the view

export function blockerMeshes(b: Blockers, quality: Quality = "medium"): THREE.Group {
  const g = new THREE.Group();
  g.name = "blockers";
  const low = quality === "low", high = quality === "high";
  /** instances of the modelled pieces, by name (placed once closures.glb has loaded) */
  const inst = new Map<string, THREE.Matrix4[]>();
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(0, 0, 0, "YXZ"), v4 = new THREE.Vector3(), s4 = new THREE.Vector3();
  const put = (name: string, x: number, y: number, z: number, yaw: number, s = 1, pitch = 0, roll = 0) => {
    e4.set(pitch, yaw, roll); q4.setFromEuler(e4);
    const list = inst.get(name) ?? inst.set(name, []).get(name)!;
    list.push(new THREE.Matrix4().compose(v4.set(x, y, z), q4, s4.set(s, s, s)));
  };
  const putM = (name: string, mm: THREE.Matrix4) => { (inst.get(name) ?? inst.set(name, []).get(name)!).push(mm); };
  /** rotation.y that turns local +z to (dx, dz) */
  const yawTo = (dx: number, dz: number) => Math.atan2(dx, dz);
  const P = (bar: Barrier, across: number, out: number) => [bar.x + bar.ax * across + bar.nx * out, bar.z + bar.az * across + bar.nz * out] as const;
  /** the stretches of a barrier at height y not in an open lane */
  const runs = (bar: Barrier, y: number, pad = 0.6): [number, number][] => {
    const cut = bar.gaps.filter((gp) => y < gp.top + pad).map((gp) => [gp.a0 - pad, gp.a1 + pad]).sort((a, c) => a[0] - c[0]);
    const out: [number, number][] = [];
    let a = -bar.half;
    for (const [c0, c1] of cut) { if (c0 > a + 0.3) out.push([a, Math.min(c0, bar.half)]); a = Math.max(a, c1); }
    if (a < bar.half - 0.3) out.push([a, bar.half]);
    return out;
  };
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blobTex = blob();

  const bannerMats = new Map<string, THREE.Material>();
  const bannerMat = (text: string, bg: string, fg: string, glow = false) => {
    const k = text + bg;
    if (!bannerMats.has(k)) bannerMats.set(k, new THREE.MeshBasicMaterial({ map: banner(text, bg, fg), side: THREE.FrontSide, toneMapped: !glow }));
    return bannerMats.get(k)!;
  };
  const festival: THREE.Object3D[] = [];
  /** a banner across (a0..a1 of) a barrier at height y, readable from both sides */
  const addBanner = (mat: THREE.Material, bar: Barrier, a0: number, a1: number, y: number, h: number, out = 0, list?: THREE.Object3D[]) => {
    const w = a1 - a0;
    if (w < 1.5) return;
    const geo = new THREE.PlaneGeometry(w, h);
    const [x, z] = P(bar, (a0 + a1) / 2, out);
    for (const flip of [0, Math.PI]) {
      const ban = new THREE.Mesh(geo, mat);
      ban.position.set(x, y, z);
      ban.rotation.y = yawTo(bar.nx, bar.nz) + flip;
      g.add(ban);
      list?.push(ban);
    }
  };

  // shared buffers
  const lanternPos: THREE.Matrix4[] = [], lanternCol: THREE.Color[] = [], lanternLow: THREE.Matrix4[] = [], lanternLowCol: THREE.Color[] = [];
  const strings: number[] = [], stringsLow: number[] = [];
  const bulbs: number[] = [], bulbCol: number[] = [], wires: number[] = [];
  const pennants: THREE.Matrix4[] = [], pennantCol: THREE.Color[] = [];
  const plain: THREE.BufferGeometry[] = [];
  const glowSpots: { x: number; y: number; z: number; c: number; ph: number }[] = [];
  /** the geysers' water: jets (launched up from a crater, arcing out and falling back), boil (churning at the
   *  crater), mist (drifting off downwind); each particle loops on its own clock */
  type Drop = { x: number; y: number; z: number; vx: number; vy: number; vz: number; T: number; ph: number; s0: number; s1: number; a0: number; g: number };
  const jets: Drop[] = [], mist: Drop[] = [], drops: Drop[] = [];
  const flows: THREE.Texture[] = [];
  const cranes: { bl: Blocker; top: THREE.Group; load: THREE.Object3D; cable: THREE.BufferAttribute }[] = [];
  const cranePending: Blocker[] = [];
  const handlers: { x: number; z: number; yaw: number; seed: number }[] = [];
  // the site hoarding's raw MDF sheets and the debris netting (tools/closures: Tesseract textures)
  const texLoader = new THREE.TextureLoader();
  const loadTex = (url: string) => { const t = texLoader.load(url); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = low ? 1 : 4; return t; };
  const hoardMat = new THREE.MeshStandardMaterial({ map: loadTex("./textures/closures/hoarding.jpg"), roughness: 0.88, side: THREE.DoubleSide });
  const netMat = new THREE.MeshStandardMaterial({ map: loadTex("./textures/closures/netting.png"), transparent: true, roughness: 0.95, side: THREE.DoubleSide, alphaTest: 0.04 });
  /** a run of MDF hoarding (w x h, one tile = 4.88 x 2.44 m) or netting (one tile = a 2.5 x 2 m bay), facing (fx, fz) */
  const panel = (mat: THREE.Material, x: number, y0: number, z: number, w: number, h: number, fx: number, fz: number, tw: number, th: number) => {
    const m = new THREE.Mesh(tile(new THREE.PlaneGeometry(w, h), w / tw, h / th, rnd()), mat);
    m.position.set(x, y0 + h / 2, z);
    m.rotation.y = yawTo(fx, fz);
    m.receiveShadow = !low;
    g.add(m);
    return m;
  };
  /** a stretch of scaffold across a barrier face (or any line: start, unit direction along, outward normal), rows lifts high,
   *  bays standing out along the normal, with ladders, base plates and amber lamps */
  const scaffold = (x0: number, z0: number, ux: number, uz: number, nx: number, nz: number, len: number, rows: number, ladders = true) => {
    const yawOut = yawTo(nx, nz), lx = Math.cos(yawOut), lz = -Math.sin(yawOut);
    const sgn = lx * ux + lz * uz >= 0 ? 1 : -1;
    const nb = Math.max(1, Math.round(len / 2.5)), bw = len / nb;
    const bay = low ? "scaffold_bay_lo" : "scaffold_bay";
    for (let i = 0; i < nb; i++) {
      const a = sgn > 0 ? i * bw : (i + 1) * bw;
      const bx = x0 + ux * a, bz = z0 + uz * a;
      for (let r = 0; r < rows; r++) {
        const mm = new THREE.Matrix4().compose(v4.set(bx, r * 2, bz), q4.setFromEuler(e4.set(0, yawOut, 0)), s4.set(bw / 2.5, 1, 1));
        putM(bay, mm);
        if (r === 0) putM("scaffold_base", mm.clone());
        if (ladders && !low && i % 4 === 1 && r < rows - 1) {
          const c = (i + 0.5) * bw;
          put("ladder", x0 + ux * c + nx * 0.62, r * 2 + 0.06, z0 + uz * c + nz * 0.62, yawOut);
        }
        if ((i === 0 || i === nb - 1 || i % 5 === 2) && r % 2 === 1) {
          const c = i === 0 ? 0.1 : i === nb - 1 ? len - 0.1 : (i + 0.5) * bw;
          const x = x0 + ux * c + nx * 1.25, z = z0 + uz * c + nz * 1.25;
          put("warning_lamp", x, r * 2 + 1.05, z, yawTo(-nx, -nz));
          glowSpots.push({ x: x + nx * 0.3, y: r * 2 + 1.2, z: z + nz * 0.3, c: 0xffa020, ph: (i * 0.37 + r * 0.21) % 1 });
        }
      }
    }
  };
  const holiday = [0, 1, 2].map((i) => new THREE.MeshBasicMaterial({ map: holidayBannerTex(i), side: THREE.DoubleSide }));

  /** a web of strung lights (or bunting) over a barrier from y0 up to its top: horizontal strings every dy
   *  wall to wall (stopping at the lanes), sagging, and drops every 3 m */
  const web = (bar: Barrier, y0: number, dy: number, palette: number[], bunting: boolean) => {
    const yaw = yawTo(bar.ax, bar.az);
    for (let y = y0; y <= bar.height - 0.3; y += dy) {
      for (const [a0, a1] of runs(bar, y)) {
        const L = a1 - a0, N = Math.max(2, Math.ceil(L / (bunting ? 0.7 : low ? 0.9 : 0.45)));
        let px = 0, py = 0, pz = 0;
        for (let i = 0; i <= N; i++) {
          const t = i / N, a = a0 + t * L, sag = Math.sin(t * Math.PI) * Math.min(0.6, L * 0.03);
          const [x, z] = P(bar, a, (rnd() - 0.5) * 0.1), yy = y - sag;
          if (i > 0) wires.push(px, py, pz, x, yy, z);
          px = x; py = yy; pz = z;
          if (i === 0 || i === N) continue;
          const c = new THREE.Color(palette[Math.floor(rnd() * palette.length)]);
          if (bunting) {
            pennants.push(new THREE.Matrix4().compose(v4.set(x, yy, z), q4.setFromEuler(e4.set(0, yaw, (rnd() - 0.5) * 0.2)), s4.set(1, 1, 1)));
            pennantCol.push(c);
          } else { bulbs.push(x, yy - 0.06, z); bulbCol.push(c.r, c.g, c.b); }
        }
      }
    }
    // drops: strings hanging straight down, every 3 m (bulbs every half metre)
    if (!bunting) for (let a = -bar.half + 1.5; a < bar.half - 1; a += low ? 4.5 : 3) {
      let yb = y0;
      for (const gp of bar.gaps) if (a > gp.a0 - 0.6 && a < gp.a1 + 0.6) yb = Math.max(yb, gp.top + 0.6);
      if (yb >= bar.height - 1) continue;
      const [x, z] = P(bar, a, 0.05);
      wires.push(x, yb, z, x, bar.height, z);
      for (let y = yb; y < bar.height; y += low ? 1 : 0.5) { const c = new THREE.Color(palette[Math.floor(rnd() * palette.length)]); bulbs.push(x, y, z); bulbCol.push(c.r, c.g, c.b); }
    }
  };

  /** a lantern curtain from y0 to y1 (strings every `da` across, a lantern every ~1.15 m) */
  const lanterns = (bar: Barrier, y0: number, y1: number, da: number, pos: THREE.Matrix4[], col: THREE.Color[], str: number[]) => {
    for (let a = -bar.half + 0.4; a <= bar.half - 0.3; a += da) {
      // (none in a lane kept open along a way through)
      let yb = y0;
      for (const gp of bar.gaps) if (a > gp.a0 - 0.5 && a < gp.a1 + 0.5) yb = Math.max(yb, gp.top + 0.5);
      if (yb >= y1) continue;
      const [x0, z0] = P(bar, a, 0);
      str.push(x0, yb - 0.4, z0, x0, y1 + 0.3, z0);
      for (let y = yb; y < y1; y += 1.05 + rnd() * 0.25) {
        const [x, z] = P(bar, a + (rnd() - 0.5) * 0.15, (rnd() - 0.5) * 0.3);
        const s = 0.85 + rnd() * 0.5;
        pos.push(new THREE.Matrix4().compose(v4.set(x, y, z), q4.identity(), s4.set(s, s, s)));
        col.push(new THREE.Color(rnd() < 0.78 ? 0xff2a1a : 0xffc23a).multiplyScalar(1.5 + rnd() * 0.5));
      }
    }
  };

  /** the burst main: a crater of broken asphalt, a cab nose-down at its edge, the geyser, the flood running down the
   *  street both ways under the hoarding, crew inside */
  const geyserSite = (gz: { x: number; z: number; r: number; h: number }, bar: Barrier, mates: Barrier[]) => {
    const tx = bar.nx, tz = bar.nz; // along the street
    const len = Math.max(...mates.map((q) => Math.abs((q.x - gz.x) * tx + (q.z - gz.z) * tz))) * 2 + 34;
    // the flood: a reflective sheet the width of the street, foam streaks flowing away from the crater
    const fw = bar.half * 2 + 1;
    const flood = new THREE.Mesh(new THREE.PlaneGeometry(fw, len), new THREE.MeshStandardMaterial({ color: 0x18222a, roughness: 0.06, metalness: 0.65, transparent: true, opacity: 0.86 }));
    flood.rotation.order = "YXZ";
    flood.rotation.set(-Math.PI / 2, yawTo(bar.ax, bar.az), 0);
    flood.position.set(gz.x, 0.05, gz.z);
    flood.receiveShadow = !low;
    g.add(flood);
    for (const dir of [1, -1]) {
      const ft = canvasTex(128, 256, (x) => {
        x.clearRect(0, 0, 128, 256);
        for (let i = 0; i < 70; i++) {
          const px = rnd() * 128, py = rnd() * 256, l = 10 + rnd() * 40;
          x.strokeStyle = "rgba(230,240,245," + (0.15 + rnd() * 0.35).toFixed(2) + ")"; x.lineWidth = 1 + rnd() * 2;
          x.beginPath(); x.moveTo(px, py); x.lineTo(px + (rnd() - 0.5) * 4, py + l); x.stroke();
        }
      }, true);
      ft.repeat.set(fw / 6, len / 2 / 10);
      ft.userData.dir = dir;
      flows.push(ft);
      const foam = new THREE.Mesh(new THREE.PlaneGeometry(fw, len / 2), new THREE.MeshBasicMaterial({ map: ft, transparent: true, depthWrite: false, opacity: 0.8 }));
      foam.rotation.order = "YXZ";
      foam.rotation.set(-Math.PI / 2, yawTo(bar.ax, bar.az) + (dir > 0 ? 0 : Math.PI), 0);
      foam.position.set(gz.x + tx * dir * len / 4, 0.07, gz.z + tz * dir * len / 4);
      g.add(foam);
    }
    // the crater: mud and broken slabs tilted up all round, a cab nose-down at its edge
    const crater = new THREE.Mesh(new THREE.CircleGeometry(4.6, 22).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.35, metalness: 0.2 }));
    crater.position.set(gz.x, 0.09, gz.z);
    g.add(crater);
    for (let i = 0; i < 22; i++) {
      const ang = (i / 22) * Math.PI * 2 + rnd() * 0.25, r = 3.6 + rnd() * 2.6;
      put(["slab_a", "slab_b", "slab_c"][i % 3], gz.x + Math.sin(ang) * r, -0.1 + rnd() * 0.25, gz.z + Math.cos(ang) * r, ang + (rnd() - 0.5), 0.8 + rnd() * 0.8, -0.35 - rnd() * 0.5, (rnd() - 0.5) * 0.4);
    }
    { const ang = rnd() * 6.3; put("cab", gz.x + Math.sin(ang) * 5.4, -0.55, gz.z + Math.cos(ang) * 5.4, ang + Math.PI, 1, 0.42, 0.18); }
    put("hydrant", gz.x + bar.ax * (bar.half - 1.6) + tx * 6, 0, gz.z + bar.az * (bar.half - 1.6) + tz * 6, 0, 1, 0.3, 0.25);
    for (let k = 0; k < 4; k++) { const ang = rnd() * 6.3, r = 8 + rnd() * 5; put("worker", gz.x + Math.sin(ang) * r, 0, gz.z + Math.cos(ang) * r, ang + Math.PI); }
    put("dep_truck", gz.x - tx * 11 + bar.ax * (bar.half - 2.5), 0, gz.z - tz * 11 + bar.az * (bar.half - 2.5), yawTo(tx, tz));
    // the water: jets launched up the column, arcing out and falling back in sheets; boil at the crater; mist
    // drifting off downwind (the winter wind is from the north-west)
    const WX = 0.96, WZ = 0.28, nj = low ? 260 : high ? 1500 : 1000, big = low ? 1.8 : 1;
    for (let i = 0; i < nj; i++) {
      // (most of it the column: fast and straight up; some thrown out wide to fall back in sheets; some boiling
      // up out of the hole)
      const r = rnd(), boil = r < 0.14, sheet = !boil && r < 0.4, ang = rnd() * Math.PI * 2;
      const v0 = boil ? 2 + rnd() * 3 : sheet ? 13 + rnd() * 6 : 18.5 + rnd() * 5, vr = boil ? 0.5 + rnd() * 1.5 : sheet ? 3 + rnd() * 4.5 : 0.15 + rnd() * 1.1;
      const T = (2 * v0) / 9.8;
      jets.push({ x: gz.x + Math.sin(ang) * rnd() * (boil ? 3 : 1.0), y: 0.2, z: gz.z + Math.cos(ang) * rnd() * (boil ? 3 : 1.0), vx: Math.sin(ang) * vr, vy: v0, vz: Math.cos(ang) * vr, T, ph: rnd(), s0: (boil ? 1.6 : sheet ? 0.5 : 0.7) * big, s1: (boil ? 2.4 : sheet ? 1.2 + rnd() * 0.6 : 1.3 + rnd() * 1.0) * big, a0: boil ? 0.6 : sheet ? 0.6 : 0.95, g: 9.8 });
    }
    // and the droplets: small and bright, thrown out of the plume in arcs
    const nd = low ? 120 : high ? 700 : 450;
    for (let i = 0; i < nd; i++) {
      const ang = rnd() * Math.PI * 2, v0 = 9 + rnd() * 13, vr = 1 + rnd() * 5.5;
      drops.push({ x: gz.x + Math.sin(ang) * 0.8, y: 0.5 + rnd() * 6, z: gz.z + Math.cos(ang) * 0.8, vx: Math.sin(ang) * vr, vy: v0, vz: Math.cos(ang) * vr, T: (v0 + Math.sqrt(v0 * v0 + 2 * 9.8 * 3)) / 9.8, ph: rnd(), s0: 0.22, s1: 0.32, a0: 0.95, g: 9.8 });
    }
    const nm = low ? 30 : high ? 120 : 80;
    for (let i = 0; i < nm; i++) {
      // (a third of it churning round the column, the rest drifting off downwind)
      const y = 2 + rnd() * gz.h * 0.95;
      if (i % 3 === 0) {
        const ang = rnd() * 6.3, v = 1.5 + rnd() * 2;
        mist.push({ x: gz.x, y, z: gz.z, vx: Math.sin(ang) * v, vy: -0.6 + rnd() * 1.2, vz: Math.cos(ang) * v, T: 4 + rnd() * 3, ph: rnd(), s0: 3 * big, s1: 7 * big, a0: 0.16, g: 0 });
        continue;
      }
      mist.push({ x: gz.x, y, z: gz.z, vx: WX * (2 + rnd() * 3) + (rnd() - 0.5) * 2, vy: -0.3 + rnd() * 0.8, vz: WZ * (2 + rnd() * 3) + (rnd() - 0.5) * 2, T: 6 + rnd() * 5, ph: rnd(), s0: 4 * big, s1: 13 * big, a0: 0.28, g: 0 });
    }
  };

  /** a building site on the block: the scaffold and netting on the building's own frontage (full height), a
   *  sidewalk shed along it, the tower crane on its kerb, the concrete pump in the street with its boom across */
  const buildingSite = (bl: Blocker) => {
    const st = bl.site!, e = st.side;
    // the frontage: the building's face along the closed block and a little past it
    const flen = st.len + 14, H = Math.min(st.wall, 52), rows = Math.max(3, Math.floor(H / 2));
    const fx = st.x + st.ax * e * (st.half - 0.3) - st.tx * flen / 2, fz = st.z + st.az * e * (st.half - 0.3) - st.tz * flen / 2;
    const nx = -st.ax * e, nz = -st.az * e; // the face looks out over the street
    // full scaffold on the bottom lifts and the top one; the netting over the lot of it
    scaffold(fx, fz, st.tx, st.tz, nx, nz, flen, Math.min(rows, low ? 2 : 4));
    if (!low && rows > 5) {
      const nbt = Math.max(1, Math.round(flen / 2.5)), bwt = flen / nbt, yawOut = yawTo(nx, nz), sx2 = Math.cos(yawOut) * st.tx - Math.sin(yawOut) * st.tz >= 0 ? 1 : -1;
      for (let i = 0; i < nbt; i++) {
        const a = sx2 > 0 ? i * bwt : (i + 1) * bwt;
        putM("scaffold_bay", new THREE.Matrix4().compose(v4.set(fx + st.tx * a, (rows - 1) * 2, fz + st.tz * a), q4.setFromEuler(e4.set(0, yawOut, 0)), s4.set(bwt / 2.5, 1, 1)));
      }
    }
    { const cx = fx + st.tx * flen / 2 + nx * 1.3, cz = fz + st.tz * flen / 2 + nz * 1.3; panel(netMat, cx, 4, cz, flen, rows * 2 - 4 + 1, nx, nz, 2.5, 2); }
    // a few lifts boarded with MDF where the crew's working, and the site's sign
    for (let k = 0; k < 4; k++) {
      const a = (0.1 + rnd() * 0.8) * flen, r = 3 + Math.floor(rnd() * (rows - 4));
      panel(hoardMat, fx + st.tx * a + nx * 1.32, r * 2, fz + st.tz * a + nz * 1.32, 2.5 * (1 + Math.floor(rnd() * 2)), 2, nx, nz, 4.88, 2.44);
    }
    // the sidewalk shed along the frontage
    {
      const nbs = Math.max(1, Math.round(flen / 2.5)), bws = flen / nbs, yawOut = yawTo(nx, nz), sx2 = Math.cos(yawOut) * st.tx - Math.sin(yawOut) * st.tz >= 0 ? 1 : -1;
      for (let i = 0; i < nbs; i++) {
        const a = sx2 > 0 ? i * bws : (i + 1) * bws;
        // (its front edge out at the kerb, its back against the scaffold)
        putM("shed_bay", new THREE.Matrix4().compose(v4.set(fx + st.tx * a + nx * 6.9, 0, fz + st.tz * a + nz * 6.9), q4.setFromEuler(e4.set(0, yawOut, 0)), s4.set(bws / 2.5, 1, 1)));
      }
    }
    addBannerAt(bannerMat(bl.name.toUpperCase(), "#1d2a22", "#f4e2b0"), fx + st.tx * flen / 2 + nx * 1.4, 4.9, fz + st.tz * flen / 2 + nz * 1.4, Math.min(16, flen * 0.6), 1.2, nx, nz);
    // the tower crane: its mast (instanced), its top, hook and load placed once the model's in (they move)
    const c = bl.crane;
    if (c) {
      for (let k = 0; k < c.top / 3; k++) put("crane_mast", c.x, k * 3, c.z, yawTo(st.tx, st.tz));
      cranePending.push(bl);
    }
    // the concrete pump in the street, its boom up and across to the building, the hose hanging
    const sol = bl.solids ?? [];
    if (sol.length) {
      const k1 = sol[0];
      put("concrete_pump", k1.ax, 0, k1.az, yawTo(st.tx, st.tz));
      const boomMat = new THREE.MeshStandardMaterial({ color: 0xe8b81a, roughness: 0.55, metalness: 0.2 });
      const hoseMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 });
      for (const cp of sol) {
        const A = new THREE.Vector3(cp.ax, cp.ay, cp.az), B = new THREE.Vector3(cp.bx, cp.by, cp.bz), L = A.distanceTo(B);
        const hose = cp.what.includes("hose");
        const geo = hose ? new THREE.CylinderGeometry(cp.r, cp.r, L, 8) : new THREE.BoxGeometry(cp.r * 1.6, L, cp.r * 2.2);
        const m = new THREE.Mesh(geo, hose ? hoseMat : boomMat);
        m.position.copy(A).add(B).multiplyScalar(0.5);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
        m.castShadow = !low;
        g.add(m);
        // the delivery pipe along the boom
        if (!hose) {
          const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, L, 6), new THREE.MeshStandardMaterial({ color: 0x8a8e92, roughness: 0.5, metalness: 0.5 }));
          pipe.position.copy(m.position).add(new THREE.Vector3(0, cp.r * 1.1, 0));
          pipe.quaternion.copy(m.quaternion);
          g.add(pipe);
        }
      }
    }
  };
  /** a two-sided banner at a point, facing (fx, fz) */
  const addBannerAt = (mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, fx: number, fz: number) => {
    const geo = new THREE.PlaneGeometry(w, h);
    for (const flip of [0, Math.PI]) {
      const ban = new THREE.Mesh(geo, mat);
      ban.position.set(x + fx * (flip ? -0.02 : 0.02), y, z + fz * (flip ? -0.02 : 0.02));
      ban.rotation.y = yawTo(fx, fz) + flip;
      g.add(ban);
    }
  };

  // ============================================================================ each barrier
  const done = new Set<string>();
  for (const bar of b.barriers) {
    const yawA = yawTo(bar.ax, bar.az), yawN = yawTo(bar.nx, bar.nz);
    const bl = b.list.find((q) => q.id === bar.blocker)!;
    // ------------------------------------------------------------------------ the burst main
    if (bar.kind === "water") {
      // the crews' fence across the street: raw MDF sheets on a frame, sandbags at its foot (the flood's coming out
      // under it), sawhorses, an A-frame, cones, the emergency trucks with their lights going, a crew in hi-vis
      const w = bar.half * 2;
      { const [x, z] = P(bar, 0, 0.02); panel(hoardMat, x, 0, z, w, bar.height, bar.nx, bar.nz, 4.88, 2.44); }
      { const [x, z] = P(bar, 0, -0.08); plain.push(colored(new THREE.BoxGeometry(w, 0.1, 0.12).rotateY(yawN).translate(x, bar.height + 0.05, z), 0x6a5a44)); }
      addBanner(bannerMat("WATER MAIN BREAK · ROAD CLOSED", "#e8701c", "#ffffff"), bar, -Math.min(bar.half - 1, 6), Math.min(bar.half - 1, 6), bar.height - 0.7, 0.8, 0.1);
      for (let a = -bar.half + 1.2; a < bar.half - 1; a += 2.4) { const [x, z] = P(bar, a, 0.45); put("sandbags", x, 0, z, yawA + Math.PI / 2); }
      for (let a = -bar.half + 1.5; a < bar.half - 1; a += 2.6) { const [x, z] = P(bar, a, 5.5); put("sawhorse", x, 0, z, yawA + Math.PI / 2); }
      { const [x, z] = P(bar, -1.5, 7.6); put("aframe", x, 0, z, yawN); }
      for (let k = 0; k < 6; k++) { const [x, z] = P(bar, -bar.half + 1 + k * (w - 2) / 5, 8.5 + rnd() * 2); put("cone", x, 0, z, rnd() * 6); }
      const first = b.barriers.find((q) => q.blocker === bar.blocker) === bar;
      const [t1x, t1z] = P(bar, -bar.half * 0.45, 14), [t2x, t2z] = P(bar, bar.half * 0.4, 18);
      put(first ? "fdny_engine" : "dep_truck", t1x, 0, t1z, yawA + 0.45);
      put(first ? "dep_truck" : "nypd_truck", t2x, 0, t2z, yawA + Math.PI - 0.4);
      glowSpots.push({ x: t1x, y: 3.2, z: t1z, c: first ? 0xff2020 : 0xffa020, ph: 0 }, { x: t2x, y: 3, z: t2z, c: first ? 0xffa020 : 0x2050ff, ph: 0.5 });
      for (let k = 0; k < 3; k++) { const [x, z] = P(bar, (rnd() - 0.5) * w * 0.7, 2.5 + rnd() * 4); put("worker", x, 0, z, yawN + Math.PI + (rnd() - 0.5) * 2); }
      { const [x, z] = P(bar, bar.half - 2, 10); put("work_light", x, 0, z, yawN + Math.PI); }
      if (!done.has(bar.blocker)) {
        done.add(bar.blocker);
        if (bl.geyser) geyserSite(bl.geyser, bar, b.barriers.filter((q) => q.blocker === bar.blocker));
      }
    } else if (bar.kind === "construction") {
      // the shed deck run across the street, MDF hoarding under its front edge, jersey barriers and drums
      const w = bar.half * 2;
      const yawOut = yawTo(bar.nx, bar.nz), lx = Math.cos(yawOut), lz = -Math.sin(yawOut);
      const sgn = lx * bar.ax + lz * bar.az >= 0 ? 1 : -1, nb = Math.max(1, Math.round(w / 2.5)), bw = w / nb;
      for (let i = 0; i < nb; i++) {
        const a = sgn > 0 ? -bar.half + i * bw : -bar.half + (i + 1) * bw;
        const [x, z] = P(bar, a, 0);
        putM("shed_bay", new THREE.Matrix4().compose(v4.set(x, 0, z), q4.setFromEuler(e4.set(0, yawOut, 0)), s4.set(bw / 2.5, 1, 1)));
      }
      { const [x, z] = P(bar, 0, 0.06); panel(hoardMat, x, 0, z, w, 2.95, bar.nx, bar.nz, 4.88, 2.44); }
      addBanner(bannerMat("ROAD CLOSED · CONSTRUCTION SITE", "#f07a10", "#111111"), bar, -Math.min(bar.half - 1, 6.5), Math.min(bar.half - 1, 6.5), 3.7, 0.75, 0.12);
      for (let a = -bar.half + 1.55; a < bar.half - 1.2; a += 3.1) { const [x, z] = P(bar, a, 1.6); put("jersey", x, 0, z, yawA + Math.PI / 2); }
      for (let a = -bar.half + 1.4, k = 0; a < bar.half - 1; a += 2.6, k++) { const [x, z] = P(bar, a, 3.6 + (k % 2) * 1.4); put("barrel", x, 0, z, rnd() * 6); }
      for (let k = 0; k < 5; k++) { const [x, z] = P(bar, (rnd() - 0.5) * bar.half * 1.6, 6 + rnd() * 3); put("cone", x, 0, z, rnd() * 6); }
      for (let a = -bar.half + 2; a < bar.half - 1; a += 5) { const [x, z] = P(bar, a, 0.2); glowSpots.push({ x, y: 2.75, z, c: 0xffa020, ph: (a * 0.31) % 1 }); }
      if (!done.has(bar.blocker) && bl.site) { done.add(bar.blocker); buildingSite(bl); }
    // ------------------------------------------------------------------------ the festival
    } else if (bar.kind === "festival") {
      // the low curtain (paifang gates take over there) and, above it, lanterns all the way up
      lanterns(bar, 1.2, Math.min(9.6, bar.height), 0.85, lanternLow, lanternLowCol, stringsLow);
      if (bar.height > 10) lanterns(bar, 10.4, bar.height, low ? 1.2 : 0.8, lanternPos, lanternCol, strings);
      for (const [a0, a1] of runs(bar, bar.height - 1)) addBanner(bannerMat("MULBERRY STREET FESTIVAL · STREET CLOSED", "#b51f1f", "#ffd84a", true), bar, a0, a1, bar.height + 1.0, 1.4, 0, festival);
      // the wires the lanterns hang from, wall to wall at the top
      { const [x0, z0] = P(bar, -bar.half, 0), [x1, z1] = P(bar, bar.half, 0); wires.push(x0, bar.height + 0.3, z0, x1, bar.height + 0.3, z1); }
    // ------------------------------------------------------------------------ Times Square
    } else if (bar.kind === "crowd") {
      // trucks parked across nose to tail, stacked barricades between, the lanes clear
      let flip = 0;
      for (const [a0, a1] of runs(bar, 1, 0.4)) {
        let a = a0 + 0.3;
        while (a < a1 - 0.5) {
          const room = a1 - a;
          const truck = room > 9.8 ? "dsny_truck" : room > 8 ? "nypd_truck" : "";
          if (truck && (flip++ % 3 !== 2 || room < 11)) {
            const L = truck === "dsny_truck" ? 9.4 : 7.6;
            const [x, z] = P(bar, a + L / 2, 0);
            put(truck, x, 0, z, yawA + (flip % 2 ? Math.PI : 0));
            glowSpots.push({ x, y: 3.6, z, c: truck === "dsny_truck" ? 0xffa020 : flip % 2 ? 0xff2020 : 0x2050ff, ph: rnd() });
            a += L + 0.4;
          } else {
            // a stack of barricades, three high, braced
            const n = Math.max(1, Math.floor(Math.min(room, 7.5) / 2.45));
            for (let i = 0; i < n; i++) {
              const [x, z] = P(bar, a + 1.22 + i * 2.45, 0);
              put("bike_rack", x, 0, z, yawA + Math.PI / 2);
              put("bike_rack", x, 1.12, z, yawA + Math.PI / 2, 1, 0, 0.04);
              if (!low) put("bike_rack", x, 2.24, z, yawA + Math.PI / 2, 1, 0, -0.05);
            }
            a += n * 2.45 + 0.2;
          }
        }
      }
      // the lanes: barricades lining them, and a sign over each
      for (const gp of bar.gaps) {
        for (const e of [gp.a0, gp.a1]) for (const out of [-3.6, -1.2, 1.2, 3.6]) { const [x, z] = P(bar, e, out); put("bike_rack", x, 0, z, yawN + Math.PI / 2); }
        addBanner(bannerMat("EMERGENCY LANE · KEEP CLEAR", "#1d3f8a", "#ffffff"), bar, gp.a0, gp.a1, gp.top - 0.6, 0.9, 0);
      }
      // the police line along the trucks' tops, then the lights up to the top, and holiday banners
      for (const [a0, a1] of runs(bar, 4.3)) addBanner(bannerMat("POLICE LINE · DO NOT CROSS", "#1d3f8a", "#ffffff"), bar, a0, a1, 4.3, 0.6, 0);
      web(bar, 5.2, low ? 2.2 : 1.25, [0xfff1c8, 0xffe6a0, 0xff3030, 0x30d060, 0x4080ff, 0xfff1c8], false);
      for (const [a0, a1] of runs(bar, bar.height - 8)) for (let a = a0 + 2; a < a1 - 1; a += 6) {
        const ban = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 5.6), holiday[Math.floor(rnd() * 3)]);
        const [x, z] = P(bar, a, 0.15);
        ban.position.set(x, bar.height - 3.6, z); ban.rotation.y = yawN;
        g.add(ban);
      }
      for (const [y, text, bg, fg] of [[9.5, "HAPPY HOLIDAYS FROM TIMES SQUARE", "#9e1b1b", "#f4d27a"], [17.5, "NEW YEAR'S EVE · COUNTDOWN · SEE YOU AT MIDNIGHT", "#14204a", "#f4f0e0"], [27, "SEASON'S GREETINGS · NEW YORK CITY", "#1d5a3a", "#f4d27a"]] as const) {
        if (y > bar.height - 2) continue;
        for (const [a0, a1] of runs(bar, y + 1.4)) addBanner(bannerMat(text, bg, fg, true), bar, a0 + 0.2, a1 - 0.2, y, 2.6, 0.2);
      }
      addBanner(bannerMat("TIMES SQUARE · CLOSED TO TRAFFIC", "#111111", "#ffd84a", true), bar, -Math.min(bar.half, 8), Math.min(bar.half, 8), bar.height + 0.8, 1.3, 0);
    // ------------------------------------------------------------------------ the parade
    } else {
      // grandstands facing in, police sawhorses in front of them
      for (const [a0, a1] of runs(bar, 1, 0.4)) {
        const n = Math.floor((a1 - a0) / 8.2);
        for (let i = 0; i < n; i++) {
          const a = a0 + (a1 - a0 - n * 8.2) / 2 + 4.1 + i * 8.2;
          const [x, z] = P(bar, a, 0.6);
          put("grandstand", x, 0, z, yawTo(-bar.nx, -bar.nz));
        }
        for (let a = a0 + 1.2; a < a1 - 1; a += 2.5) { const [x, z] = P(bar, a, -1.6); put("sawhorse", x, 0, z, yawA + Math.PI / 2); }
        if (n === 0) for (let a = a0 + 1.2; a < a1 - 1; a += 2.45) {
          const [x, z] = P(bar, a, 0);
          put("bike_rack", x, 0, z, yawA + Math.PI / 2); put("bike_rack", x, 1.12, z, yawA + Math.PI / 2);
        }
      }
      web(bar, 5, low ? 2.2 : 1.5, [0xe8701c, 0x7a3a12, 0xf0c22a, 0xc8381c, 0xf4efe0], true);
      for (const y of [6.5, 14, 22, 30]) if (y < bar.height - 1) for (const [a0, a1] of runs(bar, y)) addBanner(bannerMat("THANKSGIVING DAY PARADE · ROUTE CLOSED", "#7a2a12", "#ffcf5a"), bar, a0, a1, y, 1.3, 0.1);
      { const [x0, z0] = P(bar, -bar.half, 0), [x1, z1] = P(bar, bar.half, 0); wires.push(x0, bar.height, z0, x1, bar.height, z1); }
    }
  }

  // ============================================================================ the shared meshes
  if (plain.length) {
    const pm = new THREE.Mesh(mergeGeometries(plain)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    g.add(pm);
  }
  if (wires.length) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(wires, 3));
    g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x141414 })));
  }
  let bulbMat: THREE.PointsMaterial | null = null;
  if (bulbs.length) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.Float32BufferAttribute(bulbs, 3));
    bg.setAttribute("color", new THREE.Float32BufferAttribute(bulbCol.map((c) => c * 2.4), 3));
    bulbMat = new THREE.PointsMaterial({ vertexColors: true, size: low ? 0.5 : 0.36, map: blobTex, transparent: true, depthWrite: false, toneMapped: false });
    const pts = new THREE.Points(bg, bulbMat);
    pts.renderOrder = 2;
    g.add(pts);
  }
  if (pennants.length) {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute("position", new THREE.Float32BufferAttribute([-0.28, 0, 0, 0.28, 0, 0, 0, -0.55, 0], 3));
    tri.computeVertexNormals();
    const im = new THREE.InstancedMesh(tri, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }), pennants.length);
    pennants.forEach((mm, i) => { im.setMatrixAt(i, mm); im.setColorAt(i, pennantCol[i]); });
    g.add(im);
  }
  const lantern = new THREE.SphereGeometry(0.28, low ? 6 : 10, low ? 5 : 8).scale(1, 1.25, 1);
  const lanternMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  for (const [pos, col, str, isLow] of [[lanternPos, lanternCol, strings, false], [lanternLow, lanternLowCol, stringsLow, true]] as const) {
    if (!pos.length) continue;
    const im = new THREE.InstancedMesh(lantern, lanternMat, pos.length);
    pos.forEach((mm, i) => { im.setMatrixAt(i, mm); im.setColorAt(i, col[i]); });
    g.add(im);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(str, 3));
    const ls = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a1a14 }));
    g.add(ls);
    if (isLow) festival.push(im, ls);
  }
  // the geysers' water, animated in update()
  const jetPts = jets.length ? sprayPoints(jets.length, blobTex, 0xf2f6f8) : null;
  const mistPts = mist.length ? sprayPoints(mist.length, blobTex, 0xdfe7ec) : null;
  const dropPts = drops.length ? sprayPoints(drops.length, blobTex, 0xffffff) : null;
  if (jetPts) g.add(jetPts);
  if (dropPts) g.add(dropPts);
  if (mistPts) g.add(mistPts);
  const animate = (pts: THREE.Points | null, list: Drop[], t: number) => {
    if (!pts) return;
    const pa = pts.geometry.attributes.position as THREE.BufferAttribute, sa = pts.geometry.attributes.aSize as THREE.BufferAttribute, aa = pts.geometry.attributes.aAlpha as THREE.BufferAttribute;
    list.forEach((p, i) => {
      const u = (t / p.T + p.ph) % 1, tt = u * p.T;
      // (a little curl as it goes, and the wind leaning the plume over: it's ragged)
      const wob = Math.sin(tt * 3 + p.ph * 40) * 0.25 * tt, lean = p.g ? 0.2 * tt * tt : 0;
      pa.setXYZ(i, p.x + p.vx * tt + wob + lean * 0.96, Math.max(0.1, p.y + p.vy * tt - 0.5 * p.g * tt * tt), p.z + p.vz * tt + wob * 0.7 + lean * 0.28);
      sa.setX(i, p.s0 + (p.s1 - p.s0) * u);
      aa.setX(i, p.a0 * Math.min(1, u * 8) * (1 - u * u) * (p.g ? 1 - 0.5 * u : 1));
    });
    pa.needsUpdate = sa.needsUpdate = aa.needsUpdate = true;
  };
  // flashing lights: a halo over each vehicle and lamp
  let halo: THREE.Points | null = null;
  const haloCol: Float32Array = new Float32Array(glowSpots.length * 3);
  if (glowSpots.length) {
    const hg = new THREE.BufferGeometry();
    hg.setAttribute("position", new THREE.Float32BufferAttribute(glowSpots.flatMap((s) => [s.x, s.y, s.z]), 3));
    hg.setAttribute("color", new THREE.BufferAttribute(haloCol, 3));
    halo = new THREE.Points(hg, new THREE.PointsMaterial({ vertexColors: true, size: 1.7, map: blobTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    halo.renderOrder = 5;
    g.add(halo);
  }
  // the parade balloon and the ropes down to its handlers
  const balloons: THREE.Mesh[] = [];
  if (b.balloons.length) {
    const geo = turkey();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 });
    const ropes: number[] = [];
    for (const bl of b.balloons) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(bl.x, bl.y, bl.z);
      mesh.rotation.y = bl.yaw;
      mesh.castShadow = !low;
      mesh.userData.y = bl.y;
      balloons.push(mesh);
      g.add(mesh);
      const sx = Math.cos(bl.yaw), sz = -Math.sin(bl.yaw), fx = Math.sin(bl.yaw), fz = Math.cos(bl.yaw);
      for (const [u, f] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1.4, 0], [1.4, 0]]) {
        const gx = bl.x + sx * u * 5.5 + fx * f * 7, gz = bl.z + sz * u * 5.5 + fz * f * 7;
        ropes.push(bl.x + sx * u * 3 + fx * f * 3, bl.y - 3.5, bl.z + sz * u * 3 + fz * f * 3, gx, 1.0, gz);
        handlers.push({ x: gx + fx * 0.4, z: gz + fz * 0.4, yaw: Math.atan2(bl.x - gx, bl.z - gz), seed: 8_800_000 + handlers.length });
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.Float32BufferAttribute(ropes, 3));
    g.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x3a3a3a })));
  }

  // ============================================================================ the modelled pieces
  const glowMats: { m: THREE.MeshBasicMaterial; base: THREE.Color; ph: number; amber: boolean }[] = [];
  new GLTFLoader().loadAsync("./models/closures.glb").then((gltf) => {
    const lib = new Map<string, THREE.Mesh[]>();
    const mats = new Map<string, THREE.Material>();
    const matFor = (src: THREE.Material) => {
      const name = src.name || "paint";
      if (mats.has(name)) return mats.get(name)!;
      let m: THREE.Material;
      if (name === "glow_d") m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color(3, 3, 3) }); // (floodlights: steady)
      else if (name.startsWith("glow")) {
        const bm = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
        glowMats.push({ m: bm, base: new THREE.Color(1, 1, 1), ph: name === "glow_b" ? 0.5 : name === "glow_c" ? 0.25 : 0, amber: name === "glow_c" });
        m = bm;
      } else if (name === "glass") m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.7 });
      else m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.08 });
      mats.set(name, m);
      return m;
    };
    for (const node of gltf.scene.children) {
      const list: THREE.Mesh[] = [];
      node.traverse((o) => { if ((o as THREE.Mesh).isMesh) list.push(o as THREE.Mesh); });
      lib.set(node.name, list);
    }
    for (const [name, mats4] of inst) {
      const parts = lib.get(name);
      if (!parts || !mats4.length) continue;
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geometry, matFor(part.material as THREE.Material), mats4.length);
        // (the part's own transform inside the piece, if any)
        part.updateWorldMatrix(true, false);
        const local = part.matrixWorld;
        mats4.forEach((mm, i) => im.setMatrixAt(i, m4.multiplyMatrices(mm, local)));
        im.castShadow = !low && name !== "cone" && name !== "slab_a";
        im.receiveShadow = !low;
        im.computeBoundingSphere();
        im.name = "closure:" + name;
        g.add(im);
      }
    }
    // the cranes' tops: each its own group (it slews), the hook and load on a cable (world/blockers.ts craneAt)
    for (const bl of cranePending) {
      const c = bl.crane!;
      const top = new THREE.Group();
      top.position.set(c.x, c.top, c.z);
      const add = (to: THREE.Object3D, name: string, dy = 0) => {
        for (const part of lib.get(name) ?? []) {
          const mesh = new THREE.Mesh(part.geometry, matFor(part.material as THREE.Material));
          part.updateWorldMatrix(true, false);
          mesh.applyMatrix4(part.matrixWorld);
          mesh.position.y += dy;
          mesh.castShadow = !low;
          to.add(mesh);
        }
      };
      add(top, "crane_top");
      const load = new THREE.Group();
      add(load, "hook");
      add(load, "crane_load", 0);
      const cg = new THREE.BufferGeometry();
      const cable = new THREE.BufferAttribute(new Float32Array(6), 3);
      cg.setAttribute("position", cable);
      const line = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0x1a1a1a }));
      line.frustumCulled = false;
      g.add(top, load, line);
      cranes.push({ bl, top, load, cable });
    }
  }).catch((e) => console.warn("closures didn't load", e));

  g.userData.handlers = handlers;
  g.userData.festival = festival;
  g.userData.update = (t: number, clock = t) => {
    animate(jetPts, jets, t);
    animate(mistPts, mist, t);
    animate(dropPts, drops, t);
    for (const f of flows) f.offset.y = -t * 0.9 * (f.userData.dir as number);
    // the lights: red and blue out of phase, amber on its own beat
    for (const gm of glowMats) {
      const ph = (t * (gm.amber ? 1.4 : 2.2) + gm.ph) % 1;
      gm.m.color.setScalar(ph < 0.45 ? 2.6 : 0.25);
    }
    if (halo) {
      const c = new THREE.Color();
      glowSpots.forEach((s, i) => {
        const on = ((t * 2.2 + s.ph) % 1) < 0.45 ? 1 : 0.15;
        c.set(s.c).multiplyScalar(on * 0.9);
        haloCol[i * 3] = c.r; haloCol[i * 3 + 1] = c.g; haloCol[i * 3 + 2] = c.b;
      });
      (halo.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
    if (bulbMat) bulbMat.size = (low ? 0.5 : 0.36) * (0.92 + 0.08 * Math.sin(t * 3.1));
    for (const c of cranes) {
      const k = craneAt(c.bl.crane!, clock);
      c.top.rotation.y = k.yaw;
      c.load.position.set(k.hx, k.hy, k.hz);
      c.load.rotation.y = k.yaw;
      c.cable.setXYZ(0, k.tx, k.ty, k.tz); c.cable.setXYZ(1, k.hx, k.hy, k.hz);
      c.cable.needsUpdate = true;
    }
    for (const bm of balloons) {
      bm.position.y = bm.userData.y + Math.sin(t * 0.7) * 0.3;
      bm.rotation.z = Math.sin(t * 0.45) * 0.04;
    }
  };
  return g;
}
