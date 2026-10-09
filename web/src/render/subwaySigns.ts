// Finding the subway: a big glowing green SUBWAY sign on a post at every way in (the stairs
// that draw air down), a small red EXIT ONLY at the ways out (they blow you back up), and,
// while you're flying the street, a beam of light over the next way in ahead plus an arrow
// at the edge of the screen with the distance to it.

import * as THREE from "three";
import type { CityData } from "../world/data";
import type { Shaft, Underground } from "../world/underground";

function signTexture(lines: [string, number][], bg: string, fg: string, w = 512, h = 192, arrow = false) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d")!;
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.strokeStyle = fg; x.lineWidth = 8; x.strokeRect(10, 10, w - 20, h - 20);
  x.fillStyle = fg; x.textAlign = "center"; x.textBaseline = "middle";
  const tx = arrow ? w * 0.42 : w / 2;
  let y = h / 2 - ((lines.length - 1) * lines[0][1]) / 2;
  for (const [t, size] of lines) { x.font = `800 ${size}px Inter, Helvetica, Arial, sans-serif`; x.fillText(t, tx, y, w * (arrow ? 0.66 : 0.88)); y += size * 1.05; }
  if (arrow) {
    // a big down arrow: this way in
    const ax = w * 0.85, ay = h / 2;
    x.beginPath(); x.moveTo(ax - 34, ay - 10); x.lineTo(ax + 34, ay - 10); x.lineTo(ax, ay + 48); x.closePath(); x.fill();
    x.fillRect(ax - 13, ay - 56, 26, 50);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class SubwaySigns {
  readonly root = new THREE.Group();
  /** the ways in, for finding the next one ahead */
  readonly ins: Shaft[] = [];
  private insS: number[] = [];
  private beam: THREE.Mesh;
  private chevron: THREE.Mesh;
  private pointer: HTMLElement;
  private target: Shaft | null = null;
  /** the way in the beam and pointer are showing (for the minimap) */
  get next(): Shaft | null { return this.target; }
  private pick = 0;
  private v = new THREE.Vector3();

  constructor(city: CityData, under: Underground, hud: HTMLElement) {
    const stairs = under.shafts.filter((s) => s.kind === "stairs");
    for (const s of stairs) if (!s.out) this.ins.push(s);
    this.insS = this.ins.map((s) => city.route.nearest(s.x, s.z).s);
    const mk = (list: Shaft[], tex: THREE.Texture, w: number, h: number, y: number, glow: number) => {
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
      mat.color.setScalar(glow);
      const geo = new THREE.PlaneGeometry(w, h);
      const front = new THREE.InstancedMesh(geo, mat, list.length), back = new THREE.InstancedMesh(geo, mat, list.length);
      const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.11, y, 8).translate(0, y / 2, 0), new THREE.MeshStandardMaterial({ color: 0x1f3a28, roughness: 0.5, metalness: 0.5 }), list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
      list.forEach((s, i) => {
        // stand the post at the kerb side of the stairs, the sign facing along the street
        const L = Math.hypot(s.tx, s.tz) || 1, ax = s.tx / L, az = s.tz / L;
        const px = s.x - ax * (s.r + 0.4), pz = s.z - az * (s.r + 0.4);
        const yaw = Math.atan2(ax, az) + Math.PI / 2;
        posts.setMatrixAt(i, m.compose(p.set(px, 0, pz), q.identity(), one));
        front.setMatrixAt(i, m.compose(p.set(px, y + h / 2, pz), q.setFromEuler(e.set(0, yaw, 0)), one));
        back.setMatrixAt(i, m.compose(p.set(px, y + h / 2, pz), q.setFromEuler(e.set(0, yaw + Math.PI, 0)), one));
      });
      posts.castShadow = true;
      for (const im of [front, back, posts]) { im.computeBoundingSphere(); this.root.add(im); }
    };
    mk(this.ins, signTexture([["SUBWAY", 104]], "#0f6b3a", "#ffffff", 512, 192, true), 2.6, 0.98, 4.6, 1.35);
    mk(stairs.filter((s) => s.out), signTexture([["EXIT", 64], ["ONLY", 64]], "#a3221a", "#ffffff", 256, 192), 0.9, 0.68, 3.0, 1.1);

    // the beam over the next way in: tall, soft, green, fading upward
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { t: { value: 0 }, a: { value: 0 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform float t; uniform float a; varying vec2 vUv; void main(){ float up = 1.0 - vUv.y; float edge = 1.0 - abs(vUv.x * 2.0 - 1.0); float k = up * up * (0.55 + 0.45 * sin(vUv.y * 30.0 - t * 4.0)) * edge * a; gl_FragColor = vec4(vec3(0.25, 1.0, 0.55) * k, k); }",
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 36, 20, 1, true).translate(0, 18, 0), beamMat);
    this.beam.frustumCulled = false;
    this.root.add(this.beam);
    const cv = signTexture([["SUBWAY", 100]], "#0f6b3a", "#ffffff", 512, 192, true);
    this.chevron = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2), new THREE.MeshBasicMaterial({ map: cv, toneMapped: false, transparent: true, depthTest: false, fog: false }));
    this.chevron.renderOrder = 5;
    this.root.add(this.chevron);

    this.pointer = document.createElement("div");
    this.pointer.className = "subway-pointer";
    this.pointer.innerHTML = `<span class="arrow">➤</span><span class="label">SUBWAY <b></b></span>`;
    hud.appendChild(this.pointer);
  }

  /** Each frame: show the way to the next way in ahead while flying the street. */
  update(t: number, leaf: THREE.Vector3, routeS: number, onStreet: boolean, cam: THREE.Camera, dt: number) {
    if ((this.pick -= dt) <= 0) {
      this.pick = 0.5;
      this.target = null;
      if (onStreet) {
        let best = 1e9;
        for (let i = 0; i < this.ins.length; i++) {
          const s = this.ins[i], ahead = this.insS[i] - routeS;
          const d = Math.hypot(s.x - leaf.x, s.z - leaf.z);
          if (ahead > -10 && ahead < 380 && d < 420 && d < best) { best = d; this.target = s; }
        }
      }
    }
    const mat = this.beam.material as THREE.ShaderMaterial;
    const want = this.target ? 1 : 0;
    mat.uniforms.a.value += (want - mat.uniforms.a.value) * Math.min(1, dt * 3);
    mat.uniforms.t.value = t;
    const s = this.target;
    this.beam.visible = this.chevron.visible = mat.uniforms.a.value > 0.02 && !!s;
    if (!s) { this.pointer.classList.remove("show"); return; }
    const d = Math.hypot(s.x - leaf.x, s.z - leaf.z);
    this.beam.position.set(s.x, 0, s.z);
    // fade the beam out as you get there (you can see the sign by then)
    mat.uniforms.a.value *= Math.min(1, Math.max(0.15, (d - 6) / 30));
    this.chevron.position.set(s.x, 8 + Math.sin(t * 2.5) * 0.4, s.z);
    this.chevron.quaternion.copy(cam.quaternion);
    this.chevron.scale.setScalar(Math.max(1, d / 40));
    // the screen-edge pointer
    this.v.set(s.x, 1.5, s.z).project(cam);
    const behind = this.v.z > 1;
    let sx = this.v.x, sy = -this.v.y;
    if (behind) { sx = -sx; sy = -sy; }
    const onScreen = !behind && Math.abs(sx) < 0.9 && Math.abs(sy) < 0.85;
    const k = onScreen ? 1 : 0.8 / Math.max(Math.abs(sx), Math.abs(sy), 1e-3);
    // keep it clear of the screen edges and the HUD corners (leaf meter bottom left, clock top right)
    const px = Math.min(88, Math.max(12, (sx * k * 0.5 + 0.5) * 100)), py = Math.min(72, Math.max(16, (sy * k * 0.5 + 0.5) * 100));
    this.pointer.style.left = `${px}%`;
    this.pointer.style.top = `${onScreen ? py - 6 : py}%`;
    (this.pointer.querySelector(".arrow") as HTMLElement).style.transform = `rotate(${onScreen ? 90 : (Math.atan2(sy, sx) * 180) / Math.PI}deg)`;
    (this.pointer.querySelector("b") as HTMLElement).textContent = `${Math.round(d)} m`;
    this.pointer.classList.add("show");
  }
}
