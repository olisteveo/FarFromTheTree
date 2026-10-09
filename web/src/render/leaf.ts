// The leaf: an autumn leaf (the last one in the city) carrying its seed. A canvas
// texture with veins and blotches, a flutter in the vertex shader, and tears that open
// up as it loses integrity.

import * as THREE from "three";

// ------------------------------------------------------------------ the leaf

function leafTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 512;
  const x = c.getContext("2d")!;
  // outline: a broad leaf with a pointed tip (tip at the top of the canvas)
  const path = new Path2D();
  path.moveTo(128, 500);
  path.bezierCurveTo(10, 420, 0, 220, 128, 12);
  path.bezierCurveTo(256, 220, 246, 420, 128, 500);
  const g = x.createLinearGradient(0, 512, 0, 0);
  g.addColorStop(0, "#b8521f");
  g.addColorStop(0.45, "#e0892c");
  g.addColorStop(0.8, "#f0b443");
  g.addColorStop(1, "#c9c14a");
  x.fillStyle = g;
  x.fill(path);
  // blotches
  x.save();
  x.clip(path);
  for (let i = 0; i < 70; i++) {
    x.fillStyle = `rgba(${120 + Math.random() * 60},${40 + Math.random() * 40},20,${Math.random() * 0.18})`;
    x.beginPath();
    x.arc(Math.random() * 256, Math.random() * 512, 4 + Math.random() * 26, 0, 6.3);
    x.fill();
  }
  // veins
  x.strokeStyle = "rgba(255,226,170,0.55)";
  x.lineWidth = 5;
  x.beginPath(); x.moveTo(128, 500); x.lineTo(128, 30); x.stroke();
  x.lineWidth = 2.5;
  for (let i = 0; i < 7; i++) {
    const y = 440 - i * 58;
    for (const s of [-1, 1]) {
      x.beginPath(); x.moveTo(128, y); x.quadraticCurveTo(128 + s * 50, y - 30, 128 + s * (95 - i * 9), y - 80); x.stroke();
    }
  }
  x.restore();
  x.strokeStyle = "rgba(90,40,15,0.6)";
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
    const geo = new THREE.PlaneGeometry(0.3, 0.46, 8, 14);
    geo.rotateX(-Math.PI / 2); // lie flat, normal +Y, tip toward -Z ...
    geo.rotateY(Math.PI);      // ... then turn the tip to +Z (forward)
    this.mat = new THREE.MeshStandardMaterial({ map: leafTexture(), side: THREE.DoubleSide, alphaTest: 0.5, transparent: false, roughness: 0.65 });
    const U = this.uniforms;
    this.mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime, uFlutter;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          float along = position.z / 0.23;
          float side = position.x / 0.15;
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
    seed.position.set(0, 0.02, -0.19);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.06, 5).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5b3a1a }));
    stem.position.set(0, 0, -0.255);
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

