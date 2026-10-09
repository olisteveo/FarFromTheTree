// Turns the generated city into meshes: merged buildings with a procedural
// facade shader (windows, storefronts, glass curtain walls, cornices), the
// streets and pavements, the subway, and instanced street furniture.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Box, Building, City, Prop } from "../world/city";
import { WORLD } from "../world/spec";
import { hash01 } from "../core/rng";

const CHUNK = 200;
const chunkKey = (x: number, z: number) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;

// ------------------------------------------------------------------ facade material

function facadeMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        attribute vec4 aB; attribute vec3 aRoof; attribute float aTop;
        varying vec4 vB; varying vec3 vRoof; varying float vTop; varying vec3 vWP; varying vec3 vWN;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vB = aB; vRoof = aRoof; vTop = aTop; vWP = position; vWN = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec4 vB; varying vec3 vRoof; varying float vTop; varying vec3 vWP; varying vec3 vWN;
        float fh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gWin = 0.0, gLit = 0.0, gGlass = 0.0; vec3 gEm = vec3(0.0);`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        {
          float facade = vB.x, flH = vB.y, lit = vB.z, seed = vB.w;
          bool wall = abs(vWN.y) < 0.5;
          if (!wall) {
            diffuseColor.rgb = vRoof * (0.85 + 0.3 * fh(floor(vWP.xz * 0.5)));
          } else if (facade > 0.5) {
            float u = abs(vWN.x) > 0.5 ? vWP.z : vWP.x;
            float pitch = facade > 1.5 ? 2.1 : 3.0;
            vec2 cell = vec2(u / pitch, vWP.y / flH);
            vec2 id = floor(cell), f = fract(cell);
            float w;
            if (facade > 1.5) {
              w = step(0.05, f.x) * step(f.x, 0.95) * step(0.1, f.y) * step(f.y, 0.92);
              gGlass = 1.0;
            } else {
              w = step(0.24, f.x) * step(f.x, 0.76) * step(0.26, f.y) * step(f.y, 0.8);
              // storefronts: the ground floor is mostly glass
              if (id.y < 0.5) w = step(0.04, f.x) * step(f.x, 0.96) * step(0.04, f.y) * step(f.y, 0.72);
            }
            float cornice = smoothstep(vTop - 1.2, vTop - 0.9, vWP.y);
            w *= 1.0 - cornice;
            float r = fh(id + seed);
            float on = step(r, lit * (id.y < 0.5 ? 1.6 : 1.0)) * w;
            // grime toward the street, a little variation floor to floor
            float grime = mix(0.72, 1.0, smoothstep(0.0, 9.0, vWP.y)) * (0.92 + 0.16 * fh(vec2(id.y, seed)));
            vec3 wallCol = diffuseColor.rgb * grime;
            wallCol = mix(wallCol, min(vec3(1.0), diffuseColor.rgb * 1.45 + 0.1), cornice);
            vec3 glass = facade > 1.5 ? vec3(0.09, 0.12, 0.16) : vec3(0.05, 0.055, 0.06);
            diffuseColor.rgb = mix(wallCol, glass, w);
            float warm = fh(id * 1.7 + seed);
            vec3 lamp = mix(vec3(1.0, 0.62, 0.32), vec3(1.0, 0.86, 0.62), warm);
            if (id.y < 0.5) lamp = mix(lamp, vec3(1.0, 0.75, 0.5), 0.5);
            gEm = lamp * on * (0.18 + 0.5 * fh(id + 3.1));
            gWin = w;
          }
        }`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, gGlass > 0.5 ? 0.08 : 0.25, gWin);`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, gGlass > 0.5 ? 0.85 : 0.4, gWin);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += gEm;`);
  };
  return m;
}

// ------------------------------------------------------------------ building geometry

function buildingGeometry(list: Building[]): THREE.BufferGeometry {
  const n = list.length * 5 * 4;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const aB = new Float32Array(n * 4), aRoof = new Float32Array(n * 3), aTop = new Float32Array(n);
  const idx: number[] = [];
  let v = 0;
  const c = new THREE.Color(), rc = new THREE.Color();
  for (const b of list) {
    c.set(b.color).convertSRGBToLinear();
    rc.set(b.roof).convertSRGBToLinear();
    const faces: [number[], number[]][] = [
      // normal, 4 corners
      [[0, 0, 1], [b.x0, b.y0, b.z1, b.x1, b.y0, b.z1, b.x1, b.y1, b.z1, b.x0, b.y1, b.z1]],
      [[0, 0, -1], [b.x1, b.y0, b.z0, b.x0, b.y0, b.z0, b.x0, b.y1, b.z0, b.x1, b.y1, b.z0]],
      [[1, 0, 0], [b.x1, b.y0, b.z1, b.x1, b.y0, b.z0, b.x1, b.y1, b.z0, b.x1, b.y1, b.z1]],
      [[-1, 0, 0], [b.x0, b.y0, b.z0, b.x0, b.y0, b.z1, b.x0, b.y1, b.z1, b.x0, b.y1, b.z0]],
      [[0, 1, 0], [b.x0, b.y1, b.z1, b.x1, b.y1, b.z1, b.x1, b.y1, b.z0, b.x0, b.y1, b.z0]],
    ];
    for (const [nrm, p] of faces) {
      for (let k = 0; k < 4; k++) {
        pos.set(p.slice(k * 3, k * 3 + 3), (v + k) * 3);
        nor.set(nrm, (v + k) * 3);
        col.set([c.r, c.g, c.b], (v + k) * 3);
        aB.set([b.facade, b.floor, b.lit, (b.seed % 1000) * 0.137], (v + k) * 4);
        aRoof.set([rc.r, rc.g, rc.b], (v + k) * 3);
        aTop[v + k] = b.y1;
      }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aB", new THREE.BufferAttribute(aB, 4));
  g.setAttribute("aRoof", new THREE.BufferAttribute(aRoof, 3));
  g.setAttribute("aTop", new THREE.BufferAttribute(aTop, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function boxGeo(b: Box): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
  g.translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
  return g;
}

function quad(x0: number, x1: number, z0: number, z1: number, y: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  return g;
}

// ------------------------------------------------------------------ prop library

function lib() {
  const iron = new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.6, metalness: 0.6 });
  const ac = new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.7, metalness: 0.2 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.9 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const trunk = new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 1 });
  const canopy = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x232325, roughness: 0.5, metalness: 0.4 });

  const tower = mergeGeometries([
    new THREE.CylinderGeometry(0.5, 0.5, 1, 14).translate(0, 0.5 + 0.35, 0),
    new THREE.ConeGeometry(0.56, 0.35, 14).translate(0, 1.35 + 0.17, 0),
    ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.BoxGeometry(0.05, 0.35, 0.05).translate(a * 0.32, 0.175, b * 0.32)),
  ])!;
  const fireLevel = mergeGeometries([
    new THREE.BoxGeometry(1, 0.06, 1.1).translate(0, 0, 0.55),
    new THREE.BoxGeometry(1, 0.9, 0.03).translate(0, 0.45, 1.1),
    new THREE.BoxGeometry(0.03, 0.9, 1.1).translate(-0.5, 0.45, 0.55),
    new THREE.BoxGeometry(0.03, 0.9, 1.1).translate(0.5, 0.45, 0.55),
    new THREE.BoxGeometry(0.5, 0.04, 0.4).rotateZ(0.75).translate(0.1, 1.5, 0.75),
  ])!;
  const pole = mergeGeometries([
    new THREE.CylinderGeometry(0.07, 0.1, 7, 6).translate(0, 3.5, 0),
    new THREE.BoxGeometry(0.06, 0.06, 2.2).translate(0, 6.9, 1.1),
  ])!;
  return {
    iron, ac, wood, glow, trunk, canopy, dark,
    geo: {
      ac: new THREE.BoxGeometry(0.9, 0.55, 0.6),
      tower,
      fireLevel,
      lantern: new THREE.SphereGeometry(0.42, 10, 8).scale(1, 1.2, 1),
      neon: new THREE.BoxGeometry(1, 1, 0.08),
      pole,
      lamp: new THREE.BoxGeometry(0.5, 0.12, 0.8),
      trunk: new THREE.CylinderGeometry(0.18, 0.3, 1, 6).translate(0, 0.5, 0),
      canopy: new THREE.IcosahedronGeometry(1, 1),
      vent: new THREE.CylinderGeometry(0.4, 0.4, 0.05, 12),
      grate: new THREE.BoxGeometry(1, 0.04, 1),
      globe: new THREE.SphereGeometry(0.22, 10, 8),
    },
  };
}

type Lib = ReturnType<typeof lib>;

const AUTUMN = ["#d9822b", "#c4532a", "#e8b04a", "#9c3b22", "#7f8b3a", "#b8742a", "#e39a3b", "#6f7d34"];

function buildProps(props: Prop[], L: Lib): THREE.Group {
  const g = new THREE.Group();
  const by: Record<string, Prop[]> = {};
  for (const p of props) (by[p.kind] ??= []).push(p);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow = false) => {
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.castShadow = shadow;
    im.receiveShadow = !(mat instanceof THREE.MeshBasicMaterial);
    g.add(im);
    return im;
  };
  const face = (p: Prop) => Math.atan2(p.nx ?? 0, p.nz ?? 1);

  if (by.ac) {
    const im = mk(L.geo.ac, L.ac, by.ac.length);
    by.ac.forEach((p, i) => {
      q.setFromAxisAngle(yAxis, face(p));
      im.setMatrixAt(i, m4.compose(t.set(p.x, p.y, p.z), q, s.set(1, 1, 1)));
    });
  }
  if (by.waterTower) {
    const im = mk(L.geo.tower, L.wood, by.waterTower.length, true);
    by.waterTower.forEach((p, i) => {
      q.setFromAxisAngle(yAxis, p.seed % 7);
      im.setMatrixAt(i, m4.compose(t.set(p.x, p.y, p.z), q, s.set(p.w!, p.h! * 0.62, p.w!)));
    });
  }
  if (by.fireEscape) {
    const levels: [Prop, number][] = [];
    for (const p of by.fireEscape) for (let y = p.y; y < p.y + (p.h ?? 0); y += 3.3) levels.push([p, y]);
    const im = mk(L.geo.fireLevel, L.iron, levels.length, true);
    levels.forEach(([p, y], i) => {
      q.setFromAxisAngle(yAxis, face(p));
      im.setMatrixAt(i, m4.compose(t.set(p.x - (p.nx ?? 0) * 0.85, y, p.z - (p.nz ?? 0) * 0.85), q, s.set(p.w!, 1, 1)));
    });
  }
  if (by.lantern) {
    const im = mk(L.geo.lantern, L.glow, by.lantern.length);
    const pts: number[] = [];
    by.lantern.forEach((p, i) => {
      im.setMatrixAt(i, m4.compose(t.set(p.x, p.y, p.z), q.identity(), s.set(1, 1, 1)));
      im.setColorAt(i, col.set(p.color!).multiplyScalar(2.6));
      const half = (p.w ?? 16) / 2;
      pts.push(p.x, p.y + 0.9, p.z - half, p.x, p.y + 0.5, p.z, p.x, p.y + 0.5, p.z, p.x, p.y + 0.9, p.z + half);
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x241815 })));
  }
  if (by.neon) {
    const im = mk(L.geo.neon, L.glow, by.neon.length);
    by.neon.forEach((p, i) => {
      q.setFromAxisAngle(yAxis, face(p) + (p.w! < 1.5 ? Math.PI / 2 : 0));
      im.setMatrixAt(i, m4.compose(t.set(p.x, p.y, p.z), q, s.set(p.w!, p.h!, p.w! < 1.5 ? 1.2 : 1)));
      im.setColorAt(i, col.set(p.color!).multiplyScalar(2.2 + hash01(p.seed) * 1.5));
    });
  }
  if (by.billboard) {
    const im = mk(L.geo.neon, billboardMaterial(), by.billboard.length);
    by.billboard.forEach((p, i) => {
      q.setFromAxisAngle(yAxis, face(p));
      im.setMatrixAt(i, m4.compose(t.set(p.x, p.y, p.z), q, s.set(p.w!, p.h!, 1)));
      im.setColorAt(i, col.set(p.color!));
    });
  }
  if (by.streetLight) {
    const poles = mk(L.geo.pole, L.dark, by.streetLight.length);
    const lamps = mk(L.geo.lamp, L.glow, by.streetLight.length);
    by.streetLight.forEach((p, i) => {
      q.setFromAxisAngle(yAxis, Math.atan2(p.nx ?? 0, p.nz ?? 0));
      poles.setMatrixAt(i, m4.compose(t.set(p.x, 0, p.z), q, s.set(1, 1, 1)));
      const dx = (p.nx ?? 0) * 2.1;
      lamps.setMatrixAt(i, m4.compose(t.set(p.x + dx, 6.82, p.z), q, s.set(1, 1, 1)));
      lamps.setColorAt(i, col.set(0xffc27a).multiplyScalar(2.2));
    });
  }
  if (by.tree) {
    const trunks = mk(L.geo.trunk, L.trunk, by.tree.length, true);
    const tops = mk(L.geo.canopy, L.canopy, by.tree.length * 3, true);
    let k = 0;
    by.tree.forEach((p, i) => {
      const h = p.h!, w = p.w!;
      trunks.setMatrixAt(i, m4.compose(t.set(p.x, 0, p.z), q.identity(), s.set(1.4, h * 0.55, 1.4)));
      for (let j = 0; j < 3; j++) {
        const a = hash01(p.seed, j) * 6.28, r = w * 0.35;
        q.setFromAxisAngle(yAxis, a);
        tops.setMatrixAt(k, m4.compose(t.set(p.x + Math.cos(a) * r * (j ? 1 : 0), h * (0.62 + 0.12 * j), p.z + Math.sin(a) * r * (j ? 1 : 0)), q, s.set(w * (0.75 - j * 0.12), w * (0.6 - j * 0.08), w * (0.75 - j * 0.12))));
        tops.setColorAt(k, col.set(AUTUMN[Math.floor(hash01(p.seed, j, 9) * AUTUMN.length)]));
        k++;
      }
    });
  }
  if (by.vent) {
    const im = mk(L.geo.vent, L.dark, by.vent.length);
    by.vent.forEach((p, i) => im.setMatrixAt(i, m4.compose(t.set(p.x, 0.03, p.z), q.identity(), s.set(1, 1, 1))));
  }
  if (by.grate) {
    const im = mk(L.geo.grate, L.iron, by.grate.length);
    by.grate.forEach((p, i) => im.setMatrixAt(i, m4.compose(t.set(p.x, -0.02, p.z), q.identity(), s.set(p.w!, 1, p.d!))));
  }
  if (by.stairs) {
    const im = mk(L.geo.globe, L.glow, by.stairs.length * 2);
    by.stairs.forEach((p, i) => {
      for (let j = 0; j < 2; j++) {
        im.setMatrixAt(i * 2 + j, m4.compose(t.set(p.x + (j ? 2 : -2), 2.4, p.z - 3), q.identity(), s.set(1, 1, 1)));
        im.setColorAt(i * 2 + j, col.set(0x4dff8a).multiplyScalar(2));
      }
    });
  }
  return g;
}

let _billboard: THREE.MeshBasicMaterial | null = null;
function billboardMaterial() {
  if (_billboard) return _billboard;
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const x = c.getContext("2d")!;
  const gr = x.createLinearGradient(0, 0, 512, 256);
  gr.addColorStop(0, "#ffffff"); gr.addColorStop(1, "#9a9a9a");
  x.fillStyle = gr; x.fillRect(0, 0, 512, 256);
  x.fillStyle = "rgba(0,0,0,0.75)";
  x.font = "bold 92px Inter, sans-serif";
  x.textAlign = "center";
  x.fillText("FALL", 256, 128);
  x.font = "600 34px Inter, sans-serif";
  x.fillText("IS COMING", 256, 182);
  x.strokeStyle = "rgba(0,0,0,0.5)"; x.lineWidth = 10; x.strokeRect(8, 8, 496, 240);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _billboard = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  _billboard.color.setScalar(1.6);
  return _billboard;
}

// ------------------------------------------------------------------ the city

export class CityMesh {
  readonly root = new THREE.Group();
  private propChunks: { g: THREE.Group; cx: number; cz: number }[] = [];

  constructor(city: City) {
    const L = lib();
    const fac = facadeMaterial();

    // buildings, merged per chunk
    const byChunk = new Map<string, Building[]>();
    for (const b of city.buildings) {
      const k = chunkKey((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
      (byChunk.get(k) ?? byChunk.set(k, []).get(k)!).push(b);
    }
    for (const list of byChunk.values()) {
      const m = new THREE.Mesh(buildingGeometry(list), fac);
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
    }

    // props, instanced per chunk, shown only near the player
    const propsBy = new Map<string, Prop[]>();
    for (const p of city.props) {
      const k = chunkKey(p.x, p.z);
      (propsBy.get(k) ?? propsBy.set(k, []).get(k)!).push(p);
    }
    for (const [k, list] of propsBy) {
      const [cx, cz] = k.split(",").map(Number);
      const g = buildProps(list, L);
      this.propChunks.push({ g, cx: (cx + 0.5) * CHUNK, cz: (cz + 0.5) * CHUNK });
      this.root.add(g);
    }

    this.root.add(this.ground(city));
    this.root.add(this.subway(city));
    this.root.add(this.landmarks());
  }

  private ground(city: City): THREE.Group {
    const g = new THREE.Group();
    const sw = WORLD.subway;
    const strip = 17;
    // asphalt, with the Broadway strip cut around the subway openings
    const asphalt: THREE.BufferGeometry[] = [
      quad(WORLD.xMin - 400, sw.x - strip, WORLD.zMin - 400, WORLD.zMax + 400, 0),
      quad(sw.x + strip, WORLD.xMax + 400, WORLD.zMin - 400, WORLD.zMax + 400, 0),
    ];
    const cuts = [...new Set(city.openings.flatMap((o) => [o.z0, o.z1]).concat([WORLD.zMin - 400, WORLD.zMax + 400]))].sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const z0 = cuts[i], z1 = cuts[i + 1];
      const holes = city.openings.filter((o) => o.z0 < z1 - 0.01 && o.z1 > z0 + 0.01).sort((a, b) => a.x0 - b.x0);
      let x = sw.x - strip;
      for (const h of holes) {
        if (h.x0 > x) asphalt.push(quad(x, h.x0, z0, z1, 0));
        x = Math.max(x, h.x1);
      }
      if (x < sw.x + strip) asphalt.push(quad(x, sw.x + strip, z0, z1, 0));
    }
    const road = new THREE.Mesh(mergeGeometries(asphalt)!, new THREE.MeshStandardMaterial({ color: 0x2b2a2c, roughness: 0.92 }));
    road.receiveShadow = true;
    g.add(road);

    // lane markings on the avenues
    const marks: THREE.BufferGeometry[] = [];
    for (const r of city.roads) {
      if (r.kind !== "avenue") continue;
      for (let z = WORLD.zMin; z < WORLD.zMax; z += 12) marks.push(quad(r.c - 0.12, r.c + 0.12, z, z + 6, 0.02));
    }
    for (const r of city.roads) {
      if (r.kind !== "street") continue;
      for (const a of city.roads) {
        if (a.kind !== "avenue") continue;
        // zebra crossings
        for (let k = -3; k <= 3; k++) {
          const x = a.c + k * (a.half / 3.5);
          marks.push(quad(x - 0.5, x + 0.5, r.c - r.half - 3, r.c - r.half - 0.6, 0.02));
          marks.push(quad(x - 0.5, x + 0.5, r.c + r.half + 0.6, r.c + r.half + 3, 0.02));
        }
      }
    }
    g.add(new THREE.Mesh(mergeGeometries(marks)!, new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.8 })));

    // pavements and park lawns
    const walks: THREE.BufferGeometry[] = [], lawns: THREE.BufferGeometry[] = [];
    for (const b of city.blocks) (b.park ? lawns : walks).push(boxGeo({ ...b, y1: b.park ? 0.3 : 0.15 }));
    const walk = new THREE.Mesh(mergeGeometries(walks)!, new THREE.MeshStandardMaterial({ color: 0x8d877e, roughness: 0.95 }));
    walk.receiveShadow = true;
    const lawn = new THREE.Mesh(mergeGeometries(lawns)!, new THREE.MeshStandardMaterial({ color: 0x6f7a36, roughness: 1 }));
    lawn.receiveShadow = true;
    g.add(walk, lawn);

    // the Pond
    const p = WORLD.pond;
    const pond = new THREE.Mesh(quad(p.x0, p.x1, p.z0, p.z1, 0.34), new THREE.MeshStandardMaterial({ color: 0x1d3b44, roughness: 0.04, metalness: 0.1 }));
    g.add(pond);
    return g;
  }

  private subway(city: City): THREE.Group {
    const g = new THREE.Group();
    const sw = WORLD.subway;
    const z0 = WORLD.zMin - 300, z1 = WORLD.zMax + 300;
    const tile = new THREE.MeshStandardMaterial({ color: 0x8e9a8a, roughness: 0.6, side: THREE.DoubleSide });
    const parts: THREE.BufferGeometry[] = [
      quad(sw.x - sw.halfWidth, sw.x + sw.halfWidth, z0, z1, sw.floor),
    ];
    const wallL = new THREE.PlaneGeometry(z1 - z0, sw.ceiling - sw.floor).rotateY(Math.PI / 2).translate(sw.x - sw.halfWidth, (sw.floor + sw.ceiling) / 2, (z0 + z1) / 2);
    const wallR = new THREE.PlaneGeometry(z1 - z0, sw.ceiling - sw.floor).rotateY(-Math.PI / 2).translate(sw.x + sw.halfWidth, (sw.floor + sw.ceiling) / 2, (z0 + z1) / 2);
    parts.push(wallL, wallR);
    // ceiling with holes under the grates and stairs
    const cuts = [...new Set(city.openings.flatMap((o) => [o.z0, o.z1]).concat([z0, z1]))].sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1];
      const holes = city.openings.filter((o) => o.kind === "grate" && o.z0 < b - 0.01 && o.z1 > a + 0.01);
      let x = sw.x - sw.halfWidth;
      for (const h of holes) { if (h.x0 > x) parts.push(quad(x, h.x0, a, b, sw.ceiling)); x = h.x1; }
      if (x < sw.x + sw.halfWidth) parts.push(quad(x, sw.x + sw.halfWidth, a, b, sw.ceiling));
    }
    // shafts
    for (const o of city.openings) {
      const h = o.kind === "grate" ? -sw.ceiling : -sw.ceiling + 0.0;
      const yC = -h / 2;
      parts.push(new THREE.PlaneGeometry(o.x1 - o.x0, h).translate((o.x0 + o.x1) / 2, yC, o.z0));
      parts.push(new THREE.PlaneGeometry(o.x1 - o.x0, h).translate((o.x0 + o.x1) / 2, yC, o.z1));
      parts.push(new THREE.PlaneGeometry(o.z1 - o.z0, h).rotateY(Math.PI / 2).translate(o.x0, yC, (o.z0 + o.z1) / 2));
      parts.push(new THREE.PlaneGeometry(o.z1 - o.z0, h).rotateY(Math.PI / 2).translate(o.x1, yC, (o.z0 + o.z1) / 2));
    }
    g.add(new THREE.Mesh(mergeGeometries(parts.map((p) => p.toNonIndexed()))!, tile));
    // rails and lights
    const rails: THREE.BufferGeometry[] = [];
    for (const x of [-4.2, -1.8, 1.8, 4.2]) rails.push(new THREE.BoxGeometry(0.1, 0.15, z1 - z0).translate(sw.x + x, sw.floor + 0.1, (z0 + z1) / 2));
    g.add(new THREE.Mesh(mergeGeometries(rails)!, new THREE.MeshStandardMaterial({ color: 0x9a9fa6, metalness: 0.9, roughness: 0.3 })));
    const lights: THREE.BufferGeometry[] = [];
    for (let z = z0; z < z1; z += 14) lights.push(new THREE.BoxGeometry(0.25, 0.08, 2.2).translate(sw.x, sw.ceiling - 0.05, z));
    const lm = new THREE.MeshBasicMaterial({ toneMapped: false });
    lm.color.setRGB(2.4, 2.2, 1.7);
    g.add(new THREE.Mesh(mergeGeometries(lights)!, lm));
    return g;
  }

  private landmarks(): THREE.Group {
    const g = new THREE.Group();
    // the goal: a ring of light in the meadow and a beam you can see from Chinatown
    const goal = WORLD.goal;
    const ringMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.9 });
    ringMat.color.setRGB(3, 2.2, 0.9);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(goal.radius, 0.35, 8, 96).rotateX(Math.PI / 2), ringMat);
    ring.position.set(goal.x, 0.5, goal.z);
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uCol: { value: new THREE.Color(1.0, 0.75, 0.35) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uCol; varying vec2 vUv; void main(){ float a = (1.0 - vUv.y) * 0.35 * (0.6 + 0.4 * sin(vUv.x * 6.2831 * 3.0)); gl_FragColor = vec4(uCol * a, a); }`,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(goal.radius * 0.6, goal.radius * 0.9, 600, 32, 1, true), beamMat);
    beam.position.set(goal.x, 300, goal.z);
    g.add(ring, beam);
    return g;
  }

  /** Show street furniture only near the player. */
  update(focus: THREE.Vector3) {
    for (const c of this.propChunks) {
      const d = Math.hypot(c.cx - focus.x, c.cz - focus.z);
      c.g.visible = d < 520;
    }
  }
}
