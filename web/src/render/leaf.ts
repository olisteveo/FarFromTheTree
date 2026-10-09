// The leaf: an autumn leaf (the last one in the city) carrying its seed. A canvas
// texture with veins and blotches, a flutter in the vertex shader, and tears that open
// up as it loses integrity.

import * as THREE from "three";

// ------------------------------------------------------------------ the leaf

function leafTexture(): THREE.CanvasTexture {
  // a red maple leaf, to match the intro: five pointed lobes, stem at the bottom, tip at the top
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const x = c.getContext("2d")!;
  const cx = 256, cy = 300;
  // lobes: [angle from up (deg), length, width]
  const lobes: [number, number, number][] = [[0, 250, 26], [-52, 205, 24], [52, 205, 24], [-108, 140, 20], [108, 140, 20]];
  const pt = (ang: number, r: number): [number, number] => [cx + Math.sin((ang * Math.PI) / 180) * r, cy - Math.cos((ang * Math.PI) / 180) * r];
  // a smooth maple outline: broad lobes as bumps on a small core, with serrated teeth
  const path = new Path2D();
  for (let i = 0; i <= 360; i++) {
    const ang = -180 + i;
    let r = 70;
    for (const [la, len, wid] of lobes) {
      const d = (ang - la) / (wid * 1.25);
      r = Math.max(r, 70 + (len - 70) * Math.exp(-d * d * 2.2) * (1 - Math.abs(d) * 0.18));
    }
    if (Math.abs(ang) > 150) r = Math.max(r, 60);
    r *= 1 + 0.05 * Math.sin(ang * 0.55 * Math.PI) * (r > 110 ? 1 : 0);
    const [px, py] = pt(ang, r);
    if (i === 0) path.moveTo(px, py); else path.lineTo(px, py);
  }
  path.closePath();
  const g = x.createRadialGradient(cx, cy - 40, 20, cx, cy - 40, 260);
  g.addColorStop(0, "#e2502a");
  g.addColorStop(0.55, "#c43a1e");
  g.addColorStop(0.85, "#9e2a18");
  g.addColorStop(1, "#7a2414");
  x.fillStyle = g;
  x.fill(path);
  x.save();
  x.clip(path);
  for (let i = 0; i < 90; i++) {
    x.fillStyle = `rgba(${150 + Math.random() * 90},${40 + Math.random() * 60},20,${Math.random() * 0.22})`;
    x.beginPath();
    x.arc(Math.random() * 512, Math.random() * 512, 4 + Math.random() * 30, 0, 6.3);
    x.fill();
  }
  // veins from the stem out to each lobe tip
  x.strokeStyle = "rgba(255,200,150,0.5)";
  for (const [ang, r] of lobes) {
    x.lineWidth = ang === 0 ? 6 : 4;
    const [tx, ty] = pt(ang, r * 0.95);
    x.beginPath(); x.moveTo(cx, cy + 6); x.lineTo(tx, ty); x.stroke();
    x.lineWidth = 2;
    for (let k = 0.35; k < 0.9; k += 0.18) {
      const [bx, by] = pt(ang, r * k);
      for (const side of [-1, 1]) { const [ex, ey] = pt(ang + side * 22, r * (k + 0.12)); x.beginPath(); x.moveTo(bx, by); x.lineTo(ex, ey); x.stroke(); }
    }
  }
  x.restore();
  x.strokeStyle = "rgba(70,20,10,0.7)";
  x.lineWidth = 3;
  x.stroke(path);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class LeafView {
  readonly root = new THREE.Group();
  private mat: THREE.MeshStandardMaterial;
  private uniforms = { uTime: { value: 0 }, uFlutter: { value: 0.3 }, uTear: { value: 0 } };

  constructor() {
    const geo = new THREE.PlaneGeometry(0.44, 0.44, 12, 12);
    geo.rotateX(-Math.PI / 2); // lie flat, normal +Y, tip toward -Z ...
    geo.rotateY(Math.PI);      // ... then turn the tip to +Z (forward)
    this.mat = new THREE.MeshStandardMaterial({ map: leafTexture(), side: THREE.DoubleSide, alphaTest: 0.5, transparent: false, roughness: 0.65 });
    const U = this.uniforms;
    this.mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime, uFlutter;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          float along = position.z / 0.22;
          float side = position.x / 0.22;
          transformed.y += sin(uTime * 13.0 + along * 2.4) * 0.012 * uFlutter * (along + 1.0);
          transformed.y += side * side * 0.025 - along * along * 0.01;
          transformed.y += sin(uTime * 21.0 + side * 3.0) * 0.006 * uFlutter * abs(side);`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uTear;")
        .replace("#include <alphatest_fragment>", `#include <alphatest_fragment>
          { vec2 cell = floor(vMapUv * vec2(14.0, 24.0));
            float n = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
            float edge = abs(vMapUv.x - 0.5) * 2.0;
            if (n * 0.6 + (1.0 - edge) * 0.7 < uTear * 1.1) discard; }`);
    };
    const leaf = new THREE.Mesh(geo, this.mat);
    leaf.castShadow = true;
    // the seed it carries, tucked at the stem
    const seed = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8).scale(1, 0.8, 1.6), new THREE.MeshStandardMaterial({ color: 0x5a3a1c, roughness: 0.5 }));
    seed.position.set(0, 0.02, -0.11);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.06, 5).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5b3a1a }));
    stem.position.set(0, 0, -0.16);
    this.root.add(leaf, seed, stem);
  }

  update(pos: THREE.Vector3, q: THREE.Quaternion, t: number, airspeed: number, integrity: number) {
    this.root.position.copy(pos);
    this.root.quaternion.copy(q);
    this.uniforms.uTime.value = t;
    this.uniforms.uFlutter.value = 0.25 + Math.min(1.5, airspeed / 8) + (1 - integrity) * 0.8;
    this.uniforms.uTear.value = 1 - integrity;
  }
}

