// The subway, built along the real line: grimy tiled tunnels with track and work
// lights, stations that open out with platforms, I-beam columns and mosaic name
// tablets, stair shafts with green globes at street level, grates you can see daylight
// through, the flooded stretch at Prince St and the bumpers at the end of the line.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TUNNEL, ratAt, type Underground } from "../world/underground";
import { Grid } from "../world/data";

function tex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = true) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const tileTex = () => tex(512, 512, (c) => {
  c.fillStyle = "#6f6a60"; c.fillRect(0, 0, 512, 512); // grout
  for (let y = 0; y < 512; y += 32) for (let x = 0; x < 512; x += 64) {
    const v = 205 + Math.random() * 30;
    c.fillStyle = `rgb(${v},${v - 4},${v - 14})`;
    c.fillRect(x + ((y / 32) % 2) * 32 + 2, y + 2, 60, 28);
  }
  for (let i = 0; i < 60; i++) { // grime and leaks
    const g = c.createLinearGradient(0, 0, 0, 512);
    const x = Math.random() * 512;
    g.addColorStop(0, "rgba(60,50,40,0)"); g.addColorStop(1, `rgba(60,50,40,${0.2 + Math.random() * 0.3})`);
    c.fillStyle = g; c.fillRect(x, Math.random() * 300, 4 + Math.random() * 30, 512);
  }
  c.fillStyle = "rgba(40,36,30,0.55)"; c.fillRect(0, 430, 512, 82); // dirt line at the bottom
});

const tunnelWallTex = () => tex(512, 512, (c) => {
  c.fillStyle = "#3a3632"; c.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26000; i++) { c.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,0.3)" : "rgba(255,240,220,0.06)"; c.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
  // poured-concrete lifts and leaks
  c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = 3;
  for (let y = 64; y < 512; y += 128) { c.beginPath(); c.moveTo(0, y); c.lineTo(512, y); c.stroke(); }
  for (let i = 0; i < 40; i++) {
    const g = c.createLinearGradient(0, 0, 0, 512); const x = Math.random() * 512;
    g.addColorStop(0, "rgba(20,16,12,0)"); g.addColorStop(1, `rgba(20,16,12,${0.3 + Math.random() * 0.4})`);
    c.fillStyle = g; c.fillRect(x, Math.random() * 200, 3 + Math.random() * 24, 512);
  }
  // rust streaks
  for (let i = 0; i < 12; i++) { c.fillStyle = `rgba(110,60,30,${0.15 + Math.random() * 0.2})`; c.fillRect(Math.random() * 512, Math.random() * 300, 4 + Math.random() * 8, 120 + Math.random() * 200); }
  // graffiti tags
  const cols = ["#d23a3a", "#e8c02a", "#3ab0d2", "#e8e8e8", "#a24ad2", "#3ad27a"];
  for (let i = 0; i < 2; i++) {
    c.save(); c.translate(40 + Math.random() * 380, 260 + Math.random() * 160); c.rotate((Math.random() - 0.5) * 0.3);
    c.font = `bold ${40 + Math.random() * 30}px Impact, Arial Black, sans-serif`;
    c.lineWidth = 6; c.strokeStyle = "rgba(10,10,10,0.8)";
    const word = ["LEAF", "NYC", "FALL", "KRS", "ZEPH", "OKAY", "SKY", "RAT KING"][Math.floor(Math.random() * 8)];
    c.strokeText(word, 0, 0); c.fillStyle = cols[Math.floor(Math.random() * cols.length)]; c.fillText(word, 0, 0);
    c.restore();
  }
});

const concreteTex = () => tex(256, 256, (c) => {
  c.fillStyle = "#4a4743"; c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) { c.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.08)"; c.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  for (let i = 0; i < 12; i++) { c.fillStyle = "rgba(20,18,16,0.35)"; c.beginPath(); c.arc(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 30, 0, 7); c.fill(); }
});

function nameTablet(name: string) {
  return tex(1024, 256, (c) => {
    c.fillStyle = "#3a2a1c"; c.fillRect(0, 0, 1024, 256);
    c.fillStyle = "#b9843a"; c.fillRect(10, 10, 1004, 236);
    c.fillStyle = "#efe6d0"; c.fillRect(34, 34, 956, 188);
    for (let y = 34; y < 222; y += 10) for (let x = 34; x < 990; x += 10) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; c.fillRect(x, y, 9, 9); }
    c.fillStyle = "#1d1d1d"; c.font = "bold 92px Georgia, serif"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(name.toUpperCase().replace("-", " – "), 512, 132, 900);
  }, false);
}

export class SubwayMesh {
  readonly root = new THREE.Group();
  /** the simple versions of what render/subwayArt.ts models properly: hidden once that loads */
  readonly legacy = new THREE.Group();
  readonly flood: THREE.Mesh | null = null;
  /** every light fitting, for placing the real point lights near the camera */
  readonly lamps: { x: number; y: number; z: number; station: boolean }[] = [];
  readonly lampGrid = new Grid<{ x: number; y: number; z: number; station: boolean }>(40);
  private rats!: THREE.InstancedMesh;
  private pool: THREE.PointLight[] = [];

  constructor(readonly u: Underground) {
    const sub = u.city.subway;
    const tile = tileTex();
    tile.repeat.set(1 / 4, 1 / 2);
    const tileMat = new THREE.MeshStandardMaterial({ map: tile, roughness: 0.55, side: THREE.DoubleSide });
    const twall = tunnelWallTex();
    twall.repeat.set(1 / 26, 1 / 6.5); // one tile of wall per 26 m, so tags and leaks don't visibly repeat
    const tunnelWallMat = new THREE.MeshStandardMaterial({ map: twall, roughness: 0.9, side: THREE.DoubleSide });
    const conc = concreteTex();
    conc.repeat.set(1 / 4, 1 / 4);
    const floorMat = new THREE.MeshStandardMaterial({ map: conc, roughness: 0.9 });
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.95, side: THREE.DoubleSide });

    const width = (s: number) => {
      let k = 0;
      for (const st of u.stations) { const d = Math.abs(st.ss - s); if (d < TUNNEL.stationHalfLength + 30) k = Math.max(k, Math.min(1, (TUNNEL.stationHalfLength + 30 - d) / 30)); }
      return { hw: TUNNEL.halfWidth + (TUNNEL.stationHalfWidth - TUNNEL.halfWidth) * k, ceil: TUNNEL.ceiling + (TUNNEL.stationCeiling - TUNNEL.ceiling) * k, k };
    };
    const twallP: number[] = [], twallUv: number[] = [];
    const wall: number[] = [], wallUv: number[] = [], floor: number[] = [], floorUv: number[] = [], ceil: number[] = [];
    const quad = (arr: number[], uv: number[] | null, a: number[], b: number[], c: number[], d: number[], ua = 0, ub = 1, va = 0, vb = 1) => {
      arr.push(...a, ...b, ...c, ...a, ...c, ...d);
      uv?.push(ua, va, ub, va, ub, vb, ua, va, ub, vb, ua, vb);
    };
    // where each vent shaft meets the tunnel roof (lateral offset in the same sign as Polyline.nearest)
    const ventHoles = u.shafts.filter((g) => g.kind === "grate").map((g) => { const n = sub.nearest(g.x, g.z); return { ss: n.s, off: n.off, r: g.r }; });
    const step = 4;
    for (let s = 0; s < u.end; s += step) {
      if (u.isBlocked(s + step / 2) && u.blocked[0].kind === "flood" && s > u.blocked[0].ss0 + 6 && s < u.blocked[0].ss1 - 6) continue;
      const a = sub.at(s), b = sub.at(s + step);
      const wa = width(s), wb = width(s + step);
      // left and right walls (normal into the tunnel)
      for (const side of [-1, 1]) {
        const ax = a.x + a.tz * wa.hw * side, az = a.z - a.tx * wa.hw * side;
        const bx = b.x + b.tz * wb.hw * side, bz = b.z - b.tx * wb.hw * side;
        if (wa.k > 0.4) quad(wall, wallUv, [ax, TUNNEL.floor, az], [bx, TUNNEL.floor, bz], [bx, wb.ceil, bz], [ax, wa.ceil, az], s, s + step, TUNNEL.floor, wa.ceil);
        else quad(twallP, twallUv, [ax, TUNNEL.floor, az], [bx, TUNNEL.floor, bz], [bx, wb.ceil, bz], [ax, wa.ceil, az], s, s + step, TUNNEL.floor, wa.ceil);
      }
      const L = (p: typeof a, w: number, y: number) => [p.x + p.tz * w, y, p.z - p.tx * w];
      quad(floor, floorUv, L(a, wa.hw, TUNNEL.floor), L(a, -wa.hw, TUNNEL.floor), L(b, -wb.hw, TUNNEL.floor), L(b, wb.hw, TUNNEL.floor), wa.hw, -wa.hw, s, s + step); // wound to face up
      // the roof, with just the grate's own hole cut out where a vent shaft rises
      const g = ventHoles.find((gr) => Math.abs(gr.ss - (s + step / 2)) < 2.5);
      if (!g) quad(ceil, null, L(a, -wa.hw, wa.ceil), L(b, -wb.hw, wb.ceil), L(b, wb.hw, wb.ceil), L(a, wa.hw, wa.ceil));
      else {
        const g0 = Math.max(-wa.hw, g.off - g.r * 1.05), g1 = Math.min(wa.hw, g.off + g.r * 1.05);
        quad(ceil, null, L(a, -wa.hw, wa.ceil), L(b, -wb.hw, wb.ceil), L(b, g0, wb.ceil), L(a, g0, wa.ceil));
        quad(ceil, null, L(a, g1, wa.ceil), L(b, g1, wb.ceil), L(b, wb.hw, wb.ceil), L(a, wa.hw, wa.ceil));
      }
    }
    const mk = (pos: number[], uv: number[] | null, mat: THREE.Material) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      if (uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      this.root.add(m);
      return m;
    };
    mk(wall, wallUv, tileMat).name = "wall";
    mk(twallP, twallUv, tunnelWallMat).name = "twall";
    mk(floor, floorUv, floorMat).name = "floor";
    mk(ceil, null, ceilMat).name = "ceil";
    this.root.add(this.legacy);

    // track: two pairs of rails and the ties, work lights along both walls
    const stripLights: THREE.BufferGeometry[] = [];
    const rails: THREE.BufferGeometry[] = [], lights: THREE.BufferGeometry[] = [], cols: THREE.BufferGeometry[] = [], plats: THREE.BufferGeometry[] = [];
    for (let s = 0; s < u.end; s += 8) {
      if (u.isBlocked(s)) continue;
      const a = sub.at(s);
      const yaw = Math.atan2(a.tx, a.tz);
      const w = width(s);
      for (const off of [-4.05, -2.55, 2.55, 4.05]) rails.push(new THREE.BoxGeometry(0.09, 0.16, 8.05).rotateY(yaw).translate(a.x + a.tz * off, TUNNEL.floor + 0.25, a.z - a.tx * off));
      for (const off of [-3.3, 3.3]) rails.push(new THREE.BoxGeometry(2.4, 0.12, 0.3).rotateY(yaw).translate(a.x + a.tz * off, TUNNEL.floor + 0.12, a.z - a.tx * off));
      if (w.k > 0.6) {
        if (s % 8 === 0) for (const off of [-3.3, 3.3, -8.5, 8.5]) {
          stripLights.push(new THREE.BoxGeometry(0.22, 0.06, 2.6).rotateY(yaw).translate(a.x + a.tz * off, w.ceil - 0.05, a.z - a.tx * off));
          if (off === 3.3 && s % 16 === 0) this.lamps.push({ x: a.x, y: w.ceil - 0.4, z: a.z, station: true });
        }
      } else if (s % 32 === 0) {
        const side = (s / 32) % 2 ? 1 : -1;
        const lx = a.x + a.tz * (w.hw - 0.15) * side, lz = a.z - a.tx * (w.hw - 0.15) * side;
        lights.push(new THREE.BoxGeometry(0.18, 0.22, 0.35).rotateY(yaw).translate(lx, w.ceil - 1.2, lz));
        this.lamps.push({ x: lx - a.tz * side * 0.6, y: w.ceil - 1.4, z: lz + a.tx * side * 0.6, station: false });
      }
      if (w.k > 0.6) {
        // platforms and I-beam columns in the stations
        for (const side of [-1, 1]) {
          const po = (w.hw + 5.4) / 2 * side;
          plats.push(new THREE.BoxGeometry(w.hw - 5.4, 1.1, 8.05).rotateY(yaw).translate(a.x + a.tz * po, TUNNEL.floor + 0.55, a.z - a.tx * po));
          if (s % 16 === 0) cols.push(new THREE.BoxGeometry(0.35, w.ceil - TUNNEL.floor, 0.35).rotateY(yaw).translate(a.x + a.tz * 5.6 * side, (w.ceil + TUNNEL.floor) / 2, a.z - a.tx * 5.6 * side));
        }
      }
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0x6d6a66, metalness: 0.8, roughness: 0.4 });
    this.legacy.add(new THREE.Mesh(mergeGeometries(rails)!, steel));
    const lm = new THREE.MeshBasicMaterial({ toneMapped: false });
    lm.color.setRGB(2.2, 1.5, 0.55); // old tungsten work lights: dim and yellow
    this.legacy.add(new THREE.Mesh(mergeGeometries(lights)!, lm));
    const fm = new THREE.MeshBasicMaterial({ toneMapped: false });
    fm.color.setRGB(1.6, 1.7, 1.55); // station fluorescents
    if (stripLights.length) this.legacy.add(new THREE.Mesh(mergeGeometries(stripLights)!, fm));
    for (const l of this.lamps) this.lampGrid.add(l, l.x - 1, l.z - 1, l.x + 1, l.z + 1);
    if (plats.length) this.legacy.add(new THREE.Mesh(mergeGeometries(plats)!, floorMat));
    if (cols.length) this.legacy.add(new THREE.Mesh(mergeGeometries(cols)!, new THREE.MeshStandardMaterial({ color: 0x2d4a6a, metalness: 0.5, roughness: 0.5 })));

    // the details that make it the New York subway
    const ibeams: THREE.BufferGeometry[] = [], trays: THREE.BufferGeometry[] = [], pipes: THREE.BufferGeometry[] = [];
    const edges: THREE.BufferGeometry[] = [], benches: THREE.BufferGeometry[] = [], trash: THREE.BufferGeometry[] = [];
    const sigRed: THREE.BufferGeometry[] = [], sigGreen: THREE.BufferGeometry[] = [];
    const people: { x: number; z: number; yaw: number; h: number; c: number }[] = [];
    let seedN = 7;
    const rnd = () => ((seedN = (seedN * 16807) % 2147483647) / 2147483647);
    for (let s = 2; s < u.end; s += TUNNEL.columnEvery) {
      if (u.isBlocked(s)) continue;
      const a = sub.at(s), w = width(s), yaw = Math.atan2(a.tx, a.tz);
      if (w.k < 0.3) {
        // the I-beam row between the tracks
        const x = a.x, z = a.z, hgt = w.ceil - TUNNEL.floor;
        ibeams.push(new THREE.BoxGeometry(0.36, hgt, 0.08).rotateY(yaw).translate(x, (w.ceil + TUNNEL.floor) / 2, z));
        ibeams.push(new THREE.BoxGeometry(0.08, hgt, 0.32).rotateY(yaw).translate(x, (w.ceil + TUNNEL.floor) / 2, z));
      }
      if (Math.round(s) % 10 === 2) {
        for (const side of [-1, 1]) {
          const off = (w.hw - 0.25) * side;
          trays.push(new THREE.BoxGeometry(0.5, 0.08, 10.05).rotateY(yaw).translate(a.x + a.tz * off, w.ceil - 0.5, a.z - a.tx * off));
          const po = (w.hw - 0.12) * side;
          pipes.push(new THREE.CylinderGeometry(0.09, 0.09, 10.05, 6).rotateX(Math.PI / 2).rotateY(yaw).translate(a.x + a.tz * po, TUNNEL.floor + 1.6, a.z - a.tx * po));
          pipes.push(new THREE.CylinderGeometry(0.06, 0.06, 10.05, 6).rotateX(Math.PI / 2).rotateY(yaw).translate(a.x + a.tz * po, TUNNEL.floor + 1.9, a.z - a.tx * po));
        }
      }
      if (w.k < 0.3 && Math.round(s) % 120 === 2) {
        for (const side of [-1, 1]) {
          const off = (w.hw - 0.3) * side;
          const box = new THREE.BoxGeometry(0.2, 0.2, 0.2).rotateY(yaw).translate(a.x + a.tz * off, TUNNEL.floor + 2.6, a.z - a.tx * off);
          (rnd() < 0.5 ? sigRed : sigGreen).push(box);
        }
      }
      if (w.k > 0.6) {
        for (const side of [-1, 1]) {
          const eo = 5.5 * side;
          edges.push(new THREE.BoxGeometry(0.5, 0.02, 5.05).rotateY(yaw).translate(a.x + a.tz * eo, TUNNEL.floor + 1.11, a.z - a.tx * eo));
          if (rnd() < 0.18) { const bo = (w.hw - 1.0) * side; benches.push(new THREE.BoxGeometry(0.5, 0.45, 2.2).rotateY(yaw).translate(a.x + a.tz * bo, TUNNEL.floor + 1.32, a.z - a.tx * bo)); }
          if (rnd() < 0.12) { const to = (w.hw - 0.6) * side; trash.push(new THREE.SphereGeometry(0.35, 7, 5).scale(1, 0.85, 1).translate(a.x + a.tz * to, TUNNEL.floor + 1.4, a.z - a.tx * to)); }
          const n = rnd() < 0.5 ? Math.floor(rnd() * 3) : 0;
          for (let i = 0; i < n; i++) {
            const po = (6.3 + rnd() * (w.hw - 7.5)) * side, ds = (rnd() - 0.5) * 4;
            const pa = sub.at(s + ds);
            people.push({ x: pa.x + pa.tz * po, z: pa.z - pa.tx * po, yaw: yaw + (rnd() - 0.5) * 2, h: 1.55 + rnd() * 0.35, c: Math.floor(rnd() * 6) });
          }
        }
      }
    }
    const beamSteel = new THREE.MeshStandardMaterial({ color: 0x2a2d30, metalness: 0.7, roughness: 0.6 });
    if (ibeams.length) this.legacy.add(new THREE.Mesh(mergeGeometries(ibeams)!, beamSteel));
    this.legacy.add(new THREE.Mesh(mergeGeometries(trays)!, new THREE.MeshStandardMaterial({ color: 0x4a4a46, metalness: 0.6, roughness: 0.6 })));
    this.legacy.add(new THREE.Mesh(mergeGeometries(pipes)!, new THREE.MeshStandardMaterial({ color: 0x5a3a26, metalness: 0.5, roughness: 0.7 })));
    const sr = new THREE.MeshBasicMaterial({ toneMapped: false }); sr.color.setRGB(4, 0.25, 0.15);
    const sg = new THREE.MeshBasicMaterial({ toneMapped: false }); sg.color.setRGB(0.2, 3.2, 0.8);
    if (sigRed.length) this.legacy.add(new THREE.Mesh(mergeGeometries(sigRed)!, sr));
    if (sigGreen.length) this.legacy.add(new THREE.Mesh(mergeGeometries(sigGreen)!, sg));
    if (edges.length) this.legacy.add(new THREE.Mesh(mergeGeometries(edges)!, new THREE.MeshStandardMaterial({ color: 0xe0b423, roughness: 0.7 })));
    if (benches.length) this.legacy.add(new THREE.Mesh(mergeGeometries(benches)!, new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.8 })));
    if (trash.length) this.legacy.add(new THREE.Mesh(mergeGeometries(trash.map((g) => g.toNonIndexed()))!, new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.35, metalness: 0.1 })));
    // people waiting on the platforms: simple winter-coated figures
    if (people.length) {
      const body = mergeGeometries([
        new THREE.CylinderGeometry(0.2, 0.26, 1, 8).translate(0, 0.5, 0),
        new THREE.SphereGeometry(0.13, 8, 6).translate(0, 1.16, 0),
      ].map((g) => g.toNonIndexed()))!;
      const coats = [0x2a2a30, 0x5a2a2a, 0x2a3a5a, 0x6b5a40, 0x1e1e1e, 0x3a4a3a];
      const im = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.85 }), people.length);
      const mm = new THREE.Matrix4(), qq = new THREE.Quaternion(), ss = new THREE.Vector3(), pp = new THREE.Vector3(), YY = new THREE.Vector3(0, 1, 0), cc = new THREE.Color();
      people.forEach((pe, i) => {
        im.setMatrixAt(i, mm.compose(pp.set(pe.x, TUNNEL.floor + 1.1, pe.z), qq.setFromAxisAngle(YY, pe.yaw), ss.set(1, pe.h / 1.3, 1)));
        im.setColorAt(i, cc.set(coats[pe.c]));
      });
      this.root.add(im);
    }

    // name tablets on the station walls
    for (const st of u.stations) {
      const map = nameTablet(st.name);
      for (const ds of [-30, 0, 30]) for (const side of [-1, 1]) {
        const a = sub.at(st.ss + ds);
        const w = width(st.ss + ds);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), new THREE.MeshStandardMaterial({ map, roughness: 0.6 }));
        m.position.set(a.x + a.tz * (w.hw - 0.05) * side, TUNNEL.floor + 3.4, a.z - a.tx * (w.hw - 0.05) * side);
        m.rotation.y = Math.atan2(a.tx, a.tz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        this.legacy.add(m);
      }
    }

    // stair shafts and passages, and their street-level railings and green globes
    const shaftParts: THREE.BufferGeometry[] = [], rail: THREE.BufferGeometry[] = [], globes: THREE.BufferGeometry[] = [], grates: THREE.BufferGeometry[] = [];
    for (const s of u.shafts) {
      if (s.kind === "stairs") {
        // the stairwell down from the street, as far as the station ceiling (the platform stairs below are subwayArt's)
        const top = 0.6, bot = TUNNEL.ceiling + 0.1;
        shaftParts.push(new THREE.BoxGeometry(s.r * 2, top - bot, s.r * 2).translate(s.x, (top + bot) / 2, s.z));
        // the passage from the stairs to the platform: stop it at the station wall, or its inside
        // shows as a box hanging in the station
        const full = Math.hypot(s.tx, s.tz) || 1, ux = s.tx / full, uz = s.tz / full;
        let L = full;
        for (let t = 0; t <= full; t += 0.25) {
          const n = sub.nearest(s.x + ux * t, s.z + uz * t);
          if (Math.abs(n.off) < width(n.s).hw + 0.1) { L = Math.max(0.5, t); break; }
        }
        shaftParts.push(new THREE.BoxGeometry(3.8, 2.8, L).rotateY(Math.atan2(s.tx, s.tz)).translate(s.x + ux * L / 2, -4, s.z + uz * L / 2));
        for (const [dx, dz, w, d] of [[0, s.r + 0.05, s.r * 2 + 0.2, 0.06], [0, -s.r - 0.05, s.r * 2 + 0.2, 0.06], [s.r + 0.05, 0, 0.06, s.r * 2 + 0.2]] as const) rail.push(new THREE.BoxGeometry(w, 1.0, d).translate(s.x + dx, 0.6, s.z + dz));
        globes.push(new THREE.SphereGeometry(0.22, 12, 8).translate(s.x + s.r, 2.3, s.z + s.r));
        globes.push(new THREE.SphereGeometry(0.22, 12, 8).translate(s.x + s.r, 2.3, s.z - s.r));
        rail.push(new THREE.CylinderGeometry(0.05, 0.05, 2.1).translate(s.x + s.r, 1.05, s.z + s.r), new THREE.CylinderGeometry(0.05, 0.05, 2.1).translate(s.x + s.r, 1.05, s.z - s.r));
      } else {
        shaftParts.push(new THREE.BoxGeometry(s.r * 2, -TUNNEL.ceiling + 0.6, s.r * 2).translate(s.x, TUNNEL.ceiling / 2 + 0.3, s.z));
        grates.push(new THREE.PlaneGeometry(s.r * 2, s.r * 2).rotateX(-Math.PI / 2).translate(s.x, 0.06, s.z));
      }
    }
    const beams: THREE.BufferGeometry[] = [], ducts: THREE.BufferGeometry[] = [];
    for (const g of u.shafts) {
      if (g.kind !== "grate") continue;
      ducts.push(new THREE.CylinderGeometry(g.r * 1.05, g.r * 1.05, -TUNNEL.ceiling + 0.4, 12, 1, true).translate(g.x, TUNNEL.ceiling / 2 + 0.1, g.z));
      beams.push(new THREE.CylinderGeometry(g.r * 0.9, g.r * 1.6, -TUNNEL.floor, 12, 1, true).translate(g.x, TUNNEL.floor / 2, g.z));
    }
    this.root.add(new THREE.Mesh(mergeGeometries(ducts)!, new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide })));
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      vertexShader: "varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "varying float vY; void main(){ float a = smoothstep(-9.5, 0.0, vY) * 0.13; gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, a); }",
    });
    this.root.add(new THREE.Mesh(mergeGeometries(beams)!, beamMat));
    const shaftMat = new THREE.MeshStandardMaterial({ map: tile, roughness: 0.6, side: THREE.BackSide });
    this.root.add(new THREE.Mesh(mergeGeometries(shaftParts.map((g) => g.toNonIndexed()))!, shaftMat));
    this.legacy.add(new THREE.Mesh(mergeGeometries(rail)!, new THREE.MeshStandardMaterial({ color: 0x1f2a22, metalness: 0.6, roughness: 0.5 })));
    const gm = new THREE.MeshBasicMaterial({ toneMapped: false });
    gm.color.setRGB(0.6, 2.4, 1.0);
    this.legacy.add(new THREE.Mesh(mergeGeometries(globes)!, gm));
    const grille = tex(128, 128, (c) => { c.clearRect(0, 0, 128, 128); c.fillStyle = "#1a1a1a"; for (let i = 0; i < 128; i += 16) { c.fillRect(i, 0, 5, 128); c.fillRect(0, i, 128, 3); } }, false);
    this.root.add(new THREE.Mesh(mergeGeometries(grates)!, new THREE.MeshStandardMaterial({ map: grille, transparent: true, alphaTest: 0.3, metalness: 0.6, roughness: 0.5 })));

    // the flood at Prince St, and the end of the line
    const fl = u.blocked.find((b) => b.kind === "flood");
    if (fl) {
      const water = new THREE.MeshStandardMaterial({ color: 0x18242a, roughness: 0.05, metalness: 0.2 });
      for (const ss of [fl.ss0, fl.ss1]) {
        const a = sub.at(ss);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(TUNNEL.halfWidth * 2, -TUNNEL.ceiling + TUNNEL.floor === 0 ? 1 : TUNNEL.ceiling - TUNNEL.floor), water);
        m.position.set(a.x, (TUNNEL.ceiling + TUNNEL.floor) / 2, a.z);
        m.rotation.y = Math.atan2(a.tx, a.tz);
        this.root.add(m);
      }
    }
    const endA = sub.at(u.end);
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(TUNNEL.stationHalfWidth * 2, 7, 1), new THREE.MeshStandardMaterial({ color: 0x5a5148, roughness: 0.9 }));
    bumper.position.set(endA.x, TUNNEL.floor + 3.5, endA.z);
    bumper.rotation.y = Math.atan2(endA.tx, endA.tz);
    const red = new THREE.MeshBasicMaterial({ toneMapped: false });
    red.color.setRGB(4, 0.3, 0.2);
    for (const off of [-3.3, 3.3]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), red);
      l.position.set(endA.x + endA.tz * off - endA.tx * 0.6, TUNNEL.floor + 1.5, endA.z - endA.tx * off - endA.tz * 0.6);
      this.root.add(l);
    }
    this.root.add(bumper);

    // rats: little grey-brown bodies with tails, scurrying along the track bed
    const rat = mergeGeometries([
      new THREE.SphereGeometry(0.11, 8, 6).scale(1, 0.7, 1.9).translate(0, 0.08, 0),
      new THREE.SphereGeometry(0.06, 8, 6).scale(1, 0.9, 1.3).translate(0, 0.09, 0.22),
      new THREE.CylinderGeometry(0.012, 0.02, 0.32, 5).rotateX(Math.PI / 2 - 0.25).translate(0, 0.05, -0.34),
    ].map((g) => g.toNonIndexed()))!;
    this.rats = new THREE.InstancedMesh(rat, new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.9 }), 200);
    this.rats.frustumCulled = false;
    this.rats.count = 0;
    this.root.add(this.rats);
    // the real lights: a handful of point lights that follow the camera from lamp to lamp
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffb85a, 0, 22, 1.6);
      this.pool.push(l);
      this.root.add(l);
    }
  }

  update(t: number, cam: THREE.Vector3, underground: number) {
    const sub = this.u.city.subway;
    const near = sub.nearest(cam.x, cam.z).s;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    let n = 0;
    if (underground > 0.01) for (const r of this.u.rats) {
      if (Math.abs(r.home - near) > 160 || n >= 200) continue;
      const ra = ratAt(r, t);
      const a = sub.at(ra.ss);
      q.setFromAxisAngle(Y, Math.atan2(a.tx, a.tz) + (ra.dir > 0 ? 0 : Math.PI));
      this.rats.setMatrixAt(n++, m.compose(p.set(a.x + a.tz * ra.off, TUNNEL.floor + 0.02, a.z - a.tx * ra.off), q, sc));
    }
    this.rats.count = n;
    this.rats.instanceMatrix.needsUpdate = true;
    const lamps = this.lampGrid.around(cam.x, cam.z, 60, []);
    const uniq = [...new Set(lamps)].sort((a, b) => (a.x - cam.x) ** 2 + (a.z - cam.z) ** 2 - ((b.x - cam.x) ** 2 + (b.z - cam.z) ** 2));
    this.pool.forEach((l, i) => {
      const lamp = uniq[i];
      if (!lamp || underground < 0.01) { l.intensity = 0; return; }
      l.position.set(lamp.x, lamp.y, lamp.z);
      l.color.set(lamp.station ? 0xe8f0ff : 0xffb050);
      l.intensity = (lamp.station ? 14 : 7) * underground * (0.92 + 0.08 * Math.sin(t * 37 + i * 7) * (lamp.station ? 0.3 : 1));
    });
  }
}
