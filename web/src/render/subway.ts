// The subway, built along the real line: grimy tiled tunnels with track and work
// lights, stations that open out with platforms, I-beam columns and mosaic name
// tablets, stair shafts with green globes at street level, grates you can see daylight
// through, the flooded stretch at Prince St and the bumpers at the end of the line.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TUNNEL, type Underground } from "../world/underground";

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
  readonly flood: THREE.Mesh | null = null;

  constructor(readonly u: Underground) {
    const sub = u.city.subway;
    const tile = tileTex();
    tile.repeat.set(1 / 4, 1 / 2);
    const tileMat = new THREE.MeshStandardMaterial({ map: tile, roughness: 0.55, side: THREE.DoubleSide });
    const conc = concreteTex();
    conc.repeat.set(1 / 4, 1 / 4);
    const floorMat = new THREE.MeshStandardMaterial({ map: conc, roughness: 0.9 });
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.95, side: THREE.DoubleSide });

    const width = (s: number) => {
      let k = 0;
      for (const st of u.stations) { const d = Math.abs(st.ss - s); if (d < TUNNEL.stationHalfLength + 30) k = Math.max(k, Math.min(1, (TUNNEL.stationHalfLength + 30 - d) / 30)); }
      return { hw: TUNNEL.halfWidth + (TUNNEL.stationHalfWidth - TUNNEL.halfWidth) * k, ceil: TUNNEL.ceiling + (TUNNEL.stationCeiling - TUNNEL.ceiling) * k, k };
    };
    const wall: number[] = [], wallUv: number[] = [], floor: number[] = [], floorUv: number[] = [], ceil: number[] = [];
    const quad = (arr: number[], uv: number[] | null, a: number[], b: number[], c: number[], d: number[], ua = 0, ub = 1, va = 0, vb = 1) => {
      arr.push(...a, ...b, ...c, ...a, ...c, ...d);
      uv?.push(ua, va, ub, va, ub, vb, ua, va, ub, vb, ua, vb);
    };
    const grateSs = u.shafts.filter((s) => s.kind === "grate").map((s) => s.ss);
    const step = 4;
    for (let s = 0; s < u.end; s += step) {
      if (u.isBlocked(s + step / 2) && u.blocked[0].kind === "flood" && s > u.blocked[0].ss0 + 6 && s < u.blocked[0].ss1 - 6) continue;
      const a = sub.at(s), b = sub.at(s + step);
      const wa = width(s), wb = width(s + step);
      // left and right walls (normal into the tunnel)
      for (const side of [-1, 1]) {
        const ax = a.x + a.tz * wa.hw * side, az = a.z - a.tx * wa.hw * side;
        const bx = b.x + b.tz * wb.hw * side, bz = b.z - b.tx * wb.hw * side;
        quad(wall, wallUv, [ax, TUNNEL.floor, az], [bx, TUNNEL.floor, bz], [bx, wb.ceil, bz], [ax, wa.ceil, az], s, s + step, TUNNEL.floor, wa.ceil);
      }
      const L = (p: typeof a, w: number, y: number) => [p.x + p.tz * w, y, p.z - p.tx * w];
      quad(floor, floorUv, L(a, -wa.hw, TUNNEL.floor), L(a, wa.hw, TUNNEL.floor), L(b, wb.hw, TUNNEL.floor), L(b, -wb.hw, TUNNEL.floor), -wa.hw, wa.hw, s, s + step);
      if (!grateSs.some((g) => Math.abs(g - (s + step / 2)) < 2.5)) quad(ceil, null, L(a, -wa.hw, wa.ceil), L(b, -wb.hw, wb.ceil), L(b, wb.hw, wb.ceil), L(a, wa.hw, wa.ceil));
    }
    const mk = (pos: number[], uv: number[] | null, mat: THREE.Material) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      if (uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      this.root.add(m);
    };
    mk(wall, wallUv, tileMat);
    mk(floor, floorUv, floorMat);
    mk(ceil, null, ceilMat);

    // track: two pairs of rails and the ties, work lights along both walls
    const rails: THREE.BufferGeometry[] = [], lights: THREE.BufferGeometry[] = [], cols: THREE.BufferGeometry[] = [], plats: THREE.BufferGeometry[] = [];
    for (let s = 0; s < u.end; s += 8) {
      if (u.isBlocked(s)) continue;
      const a = sub.at(s);
      const yaw = Math.atan2(a.tx, a.tz);
      const w = width(s);
      for (const off of [-4.05, -2.55, 2.55, 4.05]) rails.push(new THREE.BoxGeometry(0.09, 0.16, 8.05).rotateY(yaw).translate(a.x + a.tz * off, TUNNEL.floor + 0.25, a.z - a.tx * off));
      for (const off of [-3.3, 3.3]) rails.push(new THREE.BoxGeometry(2.4, 0.12, 0.3).rotateY(yaw).translate(a.x + a.tz * off, TUNNEL.floor + 0.12, a.z - a.tx * off));
      for (const side of [-1, 1]) lights.push(new THREE.BoxGeometry(0.12, 0.12, 1.2).rotateY(yaw).translate(a.x + a.tz * (w.hw - 0.1) * side, w.ceil - 0.6, a.z - a.tx * (w.hw - 0.1) * side));
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
    this.root.add(new THREE.Mesh(mergeGeometries(rails)!, steel));
    const lm = new THREE.MeshBasicMaterial({ toneMapped: false });
    lm.color.setRGB(3.2, 3.0, 2.4);
    this.root.add(new THREE.Mesh(mergeGeometries(lights)!, lm));
    if (plats.length) this.root.add(new THREE.Mesh(mergeGeometries(plats)!, floorMat));
    if (cols.length) this.root.add(new THREE.Mesh(mergeGeometries(cols)!, new THREE.MeshStandardMaterial({ color: 0x2d4a6a, metalness: 0.5, roughness: 0.5 })));

    // name tablets on the station walls
    for (const st of u.stations) {
      const map = nameTablet(st.name);
      for (const ds of [-30, 0, 30]) for (const side of [-1, 1]) {
        const a = sub.at(st.ss + ds);
        const w = width(st.ss + ds);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), new THREE.MeshStandardMaterial({ map, roughness: 0.6 }));
        m.position.set(a.x + a.tz * (w.hw - 0.05) * side, TUNNEL.floor + 3.4, a.z - a.tx * (w.hw - 0.05) * side);
        m.rotation.y = Math.atan2(a.tx, a.tz) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        this.root.add(m);
      }
    }

    // stair shafts and passages, and their street-level railings and green globes
    const shaftParts: THREE.BufferGeometry[] = [], rail: THREE.BufferGeometry[] = [], globes: THREE.BufferGeometry[] = [], grates: THREE.BufferGeometry[] = [];
    for (const s of u.shafts) {
      if (s.kind === "stairs") {
        shaftParts.push(new THREE.BoxGeometry(s.r * 2, 5.8, s.r * 2).translate(s.x, -2.3, s.z));
        const L = Math.hypot(s.tx, s.tz) || 1;
        shaftParts.push(new THREE.BoxGeometry(3.8, 2.8, L).rotateY(Math.atan2(s.tx, s.tz)).translate(s.x + s.tx / 2, -4, s.z + s.tz / 2));
        for (const [dx, dz, w, d] of [[0, s.r + 0.05, s.r * 2 + 0.2, 0.06], [0, -s.r - 0.05, s.r * 2 + 0.2, 0.06], [s.r + 0.05, 0, 0.06, s.r * 2 + 0.2]] as const) rail.push(new THREE.BoxGeometry(w, 1.0, d).translate(s.x + dx, 0.6, s.z + dz));
        globes.push(new THREE.SphereGeometry(0.22, 12, 8).translate(s.x + s.r, 2.3, s.z + s.r));
        globes.push(new THREE.SphereGeometry(0.22, 12, 8).translate(s.x + s.r, 2.3, s.z - s.r));
        rail.push(new THREE.CylinderGeometry(0.05, 0.05, 2.1).translate(s.x + s.r, 1.05, s.z + s.r), new THREE.CylinderGeometry(0.05, 0.05, 2.1).translate(s.x + s.r, 1.05, s.z - s.r));
      } else {
        shaftParts.push(new THREE.BoxGeometry(s.r * 2, -TUNNEL.ceiling + 0.6, s.r * 2).translate(s.x, TUNNEL.ceiling / 2 + 0.3, s.z));
        grates.push(new THREE.PlaneGeometry(s.r * 2, s.r * 2).rotateX(-Math.PI / 2).translate(s.x, 0.06, s.z));
      }
    }
    const shaftMat = new THREE.MeshStandardMaterial({ map: tile, roughness: 0.6, side: THREE.BackSide });
    this.root.add(new THREE.Mesh(mergeGeometries(shaftParts.map((g) => g.toNonIndexed()))!, shaftMat));
    this.root.add(new THREE.Mesh(mergeGeometries(rail)!, new THREE.MeshStandardMaterial({ color: 0x1f2a22, metalness: 0.6, roughness: 0.5 })));
    const gm = new THREE.MeshBasicMaterial({ toneMapped: false });
    gm.color.setRGB(0.6, 2.4, 1.0);
    this.root.add(new THREE.Mesh(mergeGeometries(globes)!, gm));
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
  }
}
