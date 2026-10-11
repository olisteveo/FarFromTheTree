// Stylised landmarks (never copies): Lady Liberty across the harbour, a bronze bull at
// Bowling Green, the Washington Square arch, the Columbus Circle column and the red
// ticket-booth steps in Times Square with screens all around.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Landmarks } from "../world/landmarks";
import type { Facades } from "../world/facades";
import { nearestEdge, type CityData } from "../world/data";

/** Made-up ads for the Times Square screens (never real brands): bold colour blocks and a word or two. */
function adTexture(i: number): THREE.CanvasTexture {
  const ADS: [string, string, string, string][] = [
    ["BROADWAY", "TONIGHT", "#e8203a", "#ffd23a"], ["THE LAST", "LEAF", "#1a1a2e", "#ff8a2a"], ["NYC", "♥", "#ffffff", "#e8203a"],
    ["FIZZ", "COLA", "#c81414", "#ffffff"], ["NOW", "SHOWING", "#2a1a6a", "#7af0ff"], ["SALE", "70% OFF", "#ffe02b", "#1a1a1a"],
    ["PHONE 17", "PRO", "#0a0a0a", "#e0e0e0"], ["★★★★★", "A HIT!", "#6a1aa0", "#ffd23a"], ["LIVE", "ON ICE", "#0a6ac8", "#ffffff"],
  ];
  const [a, b, bg, fg] = ADS[i % ADS.length];
  const c = document.createElement("canvas");
  c.width = 256; c.height = 160;
  const x = c.getContext("2d")!;
  x.fillStyle = bg; x.fillRect(0, 0, 256, 160);
  x.fillStyle = fg; x.globalAlpha = 0.18; x.fillRect(0, 118, 256, 42); x.fillRect(196, 0, 60, 160); x.globalAlpha = 1;
  x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = fg;
  x.font = "900 54px Impact, Arial Black, sans-serif"; x.fillText(a, 128, 62, 236);
  x.font = "700 30px Arial, sans-serif"; x.fillText(b, 128, 124, 236);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function landmarkSolids(l: Landmarks, f: Facades) {
  // simple solid boxes so the leaf can land on (and bump into) them
  const add = (x: number, y: number, z: number, hw: number, hh: number, hd: number) => {
    const p = { kind: "solid" as const, x, y, z, tx: 1, tz: 0, nx: 0, nz: 1, hw, hh, hd, seed: 0 };
    f.props.push(p);
    f.grid.add(p, x - hw - 1, z - hd - 1, x + hw + 1, z + hd + 1);
  };
  const [bx, bz] = l.bull;
  add(bx, 0.8, bz, 0.8, 0.8, 2.4);
  const [ax, az] = l.arch;
  add(ax - 6.5, 11, az, 2.2, 11, 2.2); add(ax + 6.5, 11, az, 2.2, 11, 2.2); add(ax, 21, az, 8.7, 1.6, 2.2);
  const [cx, cz] = l.column;
  add(cx, 11, cz, 1.3, 11, 1.3);
  add(cx, 23.6, cz, 0.5, 1.6, 0.5); // the figure on top (something to fetch up against, and a head to land on)
  const [sx, sz] = l.steps;
  for (let i = 0; i < 6; i++) add(sx, 0.4 + i * 0.8, sz - 5 + i * 1.6, 5, 0.4 + i * 0.8, 0.8);
}

export function landmarkMeshes(l: Landmarks, city?: CityData): THREE.Group {
  const g = new THREE.Group();
  const bronze = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, metalness: 0.8, roughness: 0.35 });
  const stone = new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.8 });
  const copper = new THREE.MeshStandardMaterial({ color: 0x5a9a86, metalness: 0.3, roughness: 0.6 });

  // the bull: a stylised charging bull in bronze
  {
    const [x, z] = l.bull;
    const bull = mergeGeometries([
      new THREE.SphereGeometry(1, 14, 10).scale(0.8, 0.8, 2.0).translate(0, 1.35, 0),
      new THREE.SphereGeometry(0.55, 12, 8).scale(0.9, 1, 1.2).translate(0, 1.15, 2.1),
      ...[[-0.5, -1.3], [0.5, -1.3], [-0.5, 1.3], [0.5, 1.3]].map(([a, c]) => new THREE.CylinderGeometry(0.16, 0.12, 0.9).translate(a, 0.45, c)),
      new THREE.TorusGeometry(0.6, 0.08, 6, 12, Math.PI).rotateY(Math.PI / 2).translate(0, 1.7, 2.3),
      new THREE.CylinderGeometry(0.05, 0.02, 1.4).rotateX(-0.9).translate(0, 1.8, -2.2),
    ].map((q) => q.toNonIndexed()))!;
    const m = new THREE.Mesh(bull, bronze);
    m.position.set(x, 0.15, z);
    m.castShadow = true;
    g.add(m);
  }
  // the arch
  {
    const [x, z] = l.arch;
    const arch = mergeGeometries([
      new THREE.BoxGeometry(4.4, 22, 4.4).translate(-6.5, 11, 0),
      new THREE.BoxGeometry(4.4, 22, 4.4).translate(6.5, 11, 0),
      new THREE.BoxGeometry(17.4, 3.2, 4.4).translate(0, 21, 0),
      new THREE.BoxGeometry(18.2, 0.8, 5).translate(0, 23, 0),
      new THREE.TorusGeometry(4.3, 0.6, 6, 20, Math.PI).translate(0, 15.5, 0),
    ].map((q) => q.toNonIndexed()))!;
    const m = new THREE.Mesh(arch, stone);
    m.position.set(x, 0, z);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }
  // the column with a figure on top
  {
    const [x, z] = l.column;
    const col = mergeGeometries([
      new THREE.CylinderGeometry(3.5, 3.8, 4, 16).translate(0, 2, 0),
      new THREE.CylinderGeometry(1.1, 1.3, 17, 16).translate(0, 12.5, 0),
      new THREE.BoxGeometry(2.6, 1, 2.6).translate(0, 21.5, 0),
      new THREE.CylinderGeometry(0.4, 0.5, 2.6, 8).translate(0, 23.3, 0),
      new THREE.SphereGeometry(0.4, 8, 6).translate(0, 24.8, 0),
    ].map((q) => q.toNonIndexed()))!;
    const m = new THREE.Mesh(col, stone);
    m.position.set(x, 0, z);
    m.castShadow = true;
    g.add(m);
  }
  // the red steps (glowing) and a ring of screens around Times Square
  {
    const [x, z] = l.steps;
    const red = new THREE.MeshStandardMaterial({ color: 0xc81e1e, emissive: 0xff2a1a, emissiveIntensity: 0.6, roughness: 0.4 });
    const steps = mergeGeometries(Array.from({ length: 6 }, (_, i) => new THREE.BoxGeometry(10, 0.8 + i * 1.6, 1.6).translate(0, (0.8 + i * 1.6) / 2, -5 + i * 1.6)))!;
    const m = new THREE.Mesh(steps, red);
    m.position.set(x, 0, z);
    m.castShadow = true;
    g.add(m);
    // the screens: on the walls of the buildings round the square, facing in (looking out from the steps
    // in each direction, the first wall), stacked up their faces; never floating in the air
    const screens = new THREE.Group();
    const mats = Array.from({ length: 9 }, (_, i) => { const m = new THREE.MeshBasicMaterial({ map: adTexture(i), toneMapped: false }); m.color.setScalar(1.5); return m; });
    let k = 0;
    if (city) for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      let hit: { px: number; pz: number; nx: number; nz: number; h: number } | null = null;
      for (let r = 12; r < 150 && !hit; r += 1) {
        const b = city.buildingAt(x + dx * r, z + dz * r);
        if (!b) continue;
        if (b.h < 16) break;
        const e = nearestEdge(b.poly, x + dx * r, z + dz * r);
        hit = { px: e.px, pz: e.pz, nx: e.nx, nz: e.nz, h: b.h };
      }
      if (!hit) continue;
      const top = Math.min(hit.h - 2, 52);
      for (let y = 12 + (i % 3) * 3; y + 5 < top; y += 13 + (i % 2) * 5) {
        const w = 10 + ((i + k) % 3) * 4, h = w * 0.62;
        if (y + h / 2 > top) break;
        const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mats[k++ % mats.length]);
        s.position.set(hit.px + hit.nx * 0.35, y + h / 2, hit.pz + hit.nz * 0.35);
        s.lookAt(s.position.x + hit.nx, s.position.y, s.position.z + hit.nz);
        screens.add(s);
      }
    }
    g.add(screens);
  }
  // Lady Liberty across the harbour: stone pedestal on a star fort, copper-green figure, torch
  {
    const [x, z] = l.statue;
    const base = mergeGeometries([
      new THREE.CylinderGeometry(60, 64, 6, 11).translate(0, 3, 0),
      new THREE.BoxGeometry(26, 28, 26).translate(0, 20, 0),
      new THREE.BoxGeometry(20, 14, 20).translate(0, 41, 0),
    ].map((q) => q.toNonIndexed()))!;
    const fig = mergeGeometries([
      new THREE.CylinderGeometry(4, 8, 30, 10).translate(0, 63, 0),
      new THREE.CylinderGeometry(3.5, 4.2, 10, 10).translate(0, 83, 0),
      new THREE.SphereGeometry(3.2, 10, 8).translate(0, 90.5, 0),
      ...Array.from({ length: 7 }, (_, i) => new THREE.ConeGeometry(0.5, 4, 4).translate(0, 2, 0).rotateZ(((i - 3) / 3) * 0.8).translate(0, 92.5, 0)),
      new THREE.CylinderGeometry(1.2, 1.4, 16, 6).translate(0, 8, 0).rotateZ(-0.25).translate(4.5, 86, 0),
      new THREE.CylinderGeometry(1.6, 1.0, 3, 8).translate(8.4, 102, 0),
    ].map((q) => q.toNonIndexed()))!;
    const b = new THREE.Mesh(base, stone);
    const f = new THREE.Mesh(fig, copper);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(1.8, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffc04a, toneMapped: false }));
    (flame.material as THREE.MeshBasicMaterial).color.multiplyScalar(3);
    flame.position.set(8.4, 105, 0);
    const statue = new THREE.Group();
    statue.add(b, f, flame);
    statue.position.set(x, -1.5, z);
    statue.rotation.y = Math.atan2(-x, -z); // facing the city
    // artistic licence: a third closer across the harbour and larger, so she reads from Battery Park
    statue.position.set(x * 0.62, -1.5, z * 0.62);
    statue.scale.setScalar(2.2);
    statue.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material & { fog?: boolean }; if (m) m.fog = false; });
    g.add(statue);
    // Liberty Island
    const island = new THREE.Mesh(new THREE.CircleGeometry(160, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5a6a3a, roughness: 1 }));
    island.position.set(x * 0.62, -1.2, z * 0.62);
    island.scale.setScalar(2.2);
    g.add(island);
  }
  return g;
}
