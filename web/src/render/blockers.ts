// Draws the blockers: curtains of lanterns across each street into the Chinatown festival;
// blue police barriers with a packed crowd behind them around Times Square and along the
// Thanksgiving parade (with its giant turkey balloon); a curtain of spray from the burst
// water main in FiDi; rows of red-roofed stalls under strings of lights at Union Square.
// blockerMeshes(...).userData.update(t) animates the spray and bobs the balloon.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Blockers } from "../world/blockers";

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

function banner(text: string, bg: string, fg: string) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 128;
  const x = c.getContext("2d")!;
  x.fillStyle = bg; x.fillRect(0, 0, 1024, 128);
  x.strokeStyle = fg; x.lineWidth = 6; x.strokeRect(8, 8, 1008, 112);
  x.fillStyle = fg; x.font = "bold 64px Georgia, serif"; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(text, 512, 68, 960);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function blockerMeshes(b: Blockers): THREE.Group {
  const g = new THREE.Group();
  const lantern = new THREE.SphereGeometry(0.28, 10, 8).scale(1, 1.25, 1);
  const lanternPos: THREE.Matrix4[] = [], lanternCol: THREE.Color[] = [];
  const strings: number[] = [];
  const barrierGeo: THREE.BufferGeometry[] = [];
  const people: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const festivalBanner = new THREE.MeshBasicMaterial({ map: banner("MULBERRY STREET FESTIVAL · STREET CLOSED", "#b51f1f", "#ffd84a"), side: THREE.FrontSide, toneMapped: false });
  const policeBanner = new THREE.MeshBasicMaterial({ map: banner("POLICE LINE · DO NOT CROSS", "#1d3f8a", "#ffffff"), side: THREE.FrontSide });
  const paradeBanner = new THREE.MeshBasicMaterial({ map: banner("THANKSGIVING DAY PARADE · ROUTE CLOSED", "#7a2a12", "#ffcf5a"), side: THREE.FrontSide });
  const waterBanner = new THREE.MeshBasicMaterial({ map: banner("WATER MAIN BREAK · ROAD CLOSED", "#e8701c", "#ffffff"), side: THREE.FrontSide });
  const marketBanner = new THREE.MeshBasicMaterial({ map: banner("UNION SQUARE HOLIDAY MARKET", "#1e4a2e", "#f4e2b0"), side: THREE.FrontSide, toneMapped: false });
  const plain: THREE.BufferGeometry[] = [];          // vertex-coloured solids (stalls, barricades)
  const bulbs: number[] = [];                         // string-light bulb positions
  const wires: number[] = [];                         // string-light wires (segment pairs)
  const jets: { x: number; z: number; vx: number; vy: number; vz: number; ph: number; T: number }[] = [];
  const floods: THREE.Mesh[] = [];
  const addBanner = (mat: THREE.Material, bar: { x: number; z: number; half: number }, yaw: number, y: number, h: number) => {
    // two faces back to back, so the text reads right from both sides
    for (const flip of [0, Math.PI]) {
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(bar.half * 2, h), mat);
      ban.position.set(bar.x, y, bar.z);
      ban.rotation.y = yaw + Math.PI / 2 + flip;
      g.add(ban);
    }
  };
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const bar of b.barriers) {
    const yaw = Math.atan2(bar.ax, bar.az);
    if (bar.blocker === "festival") {
      for (let a = -bar.half; a <= bar.half; a += 0.85) {
        const x = bar.x + bar.ax * a, z = bar.z + bar.az * a;
        strings.push(x, 0.6, z, x, bar.height + 0.5, z);
        for (let y = 1.2; y < bar.height; y += 1.15 + rnd() * 0.3) {
          lanternPos.push(m.clone().compose(p.set(x + bar.nx * (rnd() - 0.5) * 0.3, y, z + bar.nz * (rnd() - 0.5) * 0.3), q.identity(), s.set(1, 1, 1)));
          lanternCol.push(new THREE.Color(rnd() < 0.75 ? 0xff2a1a : 0xffc23a).multiplyScalar(2.2));
        }
      }
      addBanner(festivalBanner, bar, yaw, bar.height + 1.2, 1.4);
    } else if (bar.kind === "water") {
      // orange-and-white barricades, a sheet of water, and a curtain of spray across the street
      for (let a = -bar.half; a <= bar.half; a += 2.2) {
        const x = bar.x + bar.ax * a + bar.nx * 1.5, z = bar.z + bar.az * a + bar.nz * 1.5;
        for (let k = 0; k < 3; k++) plain.push(colored(new THREE.BoxGeometry(2.0, 0.18, 0.06).rotateY(yaw + Math.PI / 2).translate(x, 0.45 + k * 0.32, z), k % 2 ? 0xffffff : 0xe8701c));
        plain.push(colored(new THREE.BoxGeometry(0.06, 1.2, 0.5).rotateY(yaw + Math.PI / 2).translate(x - bar.ax * 0.95, 0.6, z - bar.az * 0.95), 0x3a3a3a));
      }
      for (let a = -bar.half + 0.3; a <= bar.half; a += 0.25) {
        const x = bar.x + bar.ax * a - bar.nx * 0.6, z = bar.z + bar.az * a - bar.nz * 0.6;
        for (let k = 0; k < 3; k++) {
          const up = 11 + rnd() * 4, out = (rnd() - 0.5) * 1.2, lat = (rnd() - 0.5) * 0.6;
          jets.push({ x, z, vx: bar.nx * out + bar.ax * lat, vy: up, vz: bar.nz * out + bar.az * lat, ph: rnd(), T: (2 * up) / 9.8 });
        }
      }
      const flood = new THREE.Mesh(new THREE.CircleGeometry(bar.half + 3, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2c3a44, roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.75 }));
      flood.position.set(bar.x - bar.nx * 4, 0.04, bar.z - bar.nz * 4);
      floods.push(flood);
      addBanner(waterBanner, { x: bar.x + bar.nx * 1.5, z: bar.z + bar.nz * 1.5, half: Math.min(bar.half, 6) }, yaw, 1.9, 0.55);
    } else if (bar.kind === "market") {
      // a row of little stalls across the street, wooden with red roofs, under strings of lights
      const STALL = [0x2a4a32, 0x7a2a22, 0x2a3a5a, 0x5a3a22];
      for (let a = -bar.half + 1.5; a <= bar.half - 1.2; a += 3.1) {
        const x = bar.x + bar.ax * a - bar.nx * 1.4, z = bar.z + bar.az * a - bar.nz * 1.4;
        const rot = (geo: THREE.BufferGeometry) => geo.rotateY(yaw + Math.PI / 2).translate(x, 0, z);
        plain.push(colored(rot(new THREE.BoxGeometry(2.8, 2.5, 2.4).translate(0, 1.25, 0)), STALL[Math.floor(rnd() * STALL.length)]));
        plain.push(colored(rot(new THREE.BoxGeometry(2.9, 0.12, 2.0).rotateZ(0.5).translate(0, 2.8, 0)), 0xb52020));
        plain.push(colored(rot(new THREE.BoxGeometry(2.9, 0.12, 2.0).rotateZ(-0.5).translate(0, 2.8, 0)), 0xb52020));
        plain.push(colored(rot(new THREE.BoxGeometry(2.6, 0.9, 0.1).translate(0, 1.4, 1.22)), 0xffd890));  // the lit hatch
        plain.push(colored(rot(new THREE.BoxGeometry(2.6, 0.08, 0.4).translate(0, 0.95, 1.4)), 0x6a4a2a)); // counter
      }
      // poles at each end and sagging strings of lights between them, stacked up to the height
      for (const e of [-1, 1]) {
        const x = bar.x + bar.ax * e * bar.half, z = bar.z + bar.az * e * bar.half;
        plain.push(colored(new THREE.CylinderGeometry(0.1, 0.12, bar.height + 0.6, 6).translate(x, (bar.height + 0.6) / 2, z), 0x2a2a2a));
      }
      for (let y = 3.6; y <= bar.height; y += 1.1) {
        const N = Math.max(8, Math.floor(bar.half * 1.6));
        let px = 0, py = 0, pz = 0;
        for (let i = 0; i <= N; i++) {
          const t = i / N, a = -bar.half + t * bar.half * 2, sag = Math.sin(t * Math.PI) * 0.8;
          const x = bar.x + bar.ax * a, z = bar.z + bar.az * a, yy = y - sag;
          if (i > 0) wires.push(px, py, pz, x, yy, z);
          px = x; py = yy; pz = z;
          bulbs.push(x, yy - 0.08, z);
        }
      }
      addBanner(marketBanner, bar, yaw, bar.height + 0.9, 1.2);
    } else {
      // blue sawhorse barriers and a packed crowd behind
      for (let a = -bar.half; a <= bar.half; a += 2.4) {
        const x = bar.x + bar.ax * a, z = bar.z + bar.az * a;
        barrierGeo.push(new THREE.BoxGeometry(2.3, 0.25, 0.08).rotateY(yaw + Math.PI / 2).translate(x, 0.95, z));
        barrierGeo.push(new THREE.BoxGeometry(0.08, 1.0, 0.6).rotateY(yaw + Math.PI / 2).translate(x - bar.ax * 1.1, 0.5, z - bar.az * 1.1));
        for (let k = 0; k < 6; k++) {
          const d = -1 - rnd() * 7, sa = a + (rnd() - 0.5) * 2.2;
          people.push(m.clone().compose(p.set(bar.x + bar.ax * sa + bar.nx * d, 0, bar.z + bar.az * sa + bar.nz * d), q.setFromAxisAngle(Y, rnd() * 6.28), s.set(1, 0.9 + rnd() * 0.25, 1)));
        }
      }
      addBanner(bar.kind === "parade" ? paradeBanner : policeBanner, bar, yaw, 1.5, 0.6);
      if (bar.kind === "parade") addBanner(paradeBanner, bar, yaw, bar.height - 0.6, 1.2);
    }
  }
  if (plain.length) {
    const pm = new THREE.Mesh(mergeGeometries(plain)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    pm.castShadow = true; pm.receiveShadow = true;
    g.add(pm);
  }
  for (const f of floods) g.add(f);
  if (wires.length) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(wires, 3));
    g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x1a1a1a })));
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.Float32BufferAttribute(bulbs, 3));
    g.add(new THREE.Points(bg, new THREE.PointsMaterial({ color: new THREE.Color(0xffc870).multiplyScalar(2.5), size: 0.22, toneMapped: false })));
  }
  // the spray: droplets thrown up and falling back, animated in update()
  let spray: THREE.Points | null = null;
  if (jets.length) {
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(jets.length * 3), 3));
    // a soft round droplet
    const dc = document.createElement("canvas");
    dc.width = dc.height = 32;
    const dx = dc.getContext("2d")!, grad = dx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.5, "rgba(255,255,255,0.45)"); grad.addColorStop(1, "rgba(255,255,255,0)");
    dx.fillStyle = grad; dx.fillRect(0, 0, 32, 32);
    spray = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xf2f6f8, size: 0.5, map: new THREE.CanvasTexture(dc), transparent: true, opacity: 0.8, depthWrite: false }));
    spray.frustumCulled = false;
    g.add(spray);
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
      mesh.castShadow = true;
      mesh.userData.y = bl.y;
      balloons.push(mesh);
      g.add(mesh);
      const sx = Math.cos(bl.yaw), sz = -Math.sin(bl.yaw), fx = Math.sin(bl.yaw), fz = Math.cos(bl.yaw);
      for (const [u, f] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1.4, 0], [1.4, 0]]) {
        const gx = bl.x + sx * u * 5.5 + fx * f * 7, gz = bl.z + sz * u * 5.5 + fz * f * 7;
        ropes.push(bl.x + sx * u * 3 + fx * f * 3, bl.y - 3.5, bl.z + sz * u * 3 + fz * f * 3, gx, 1.0, gz);
        people.push(m.clone().compose(p.set(gx + fx * 0.4, 0, gz + fz * 0.4), q.setFromAxisAngle(Y, bl.yaw), s.set(1, 1, 1)));
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.Float32BufferAttribute(ropes, 3));
    g.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x3a3a3a })));
  }
  if (lanternPos.length) {
    const im = new THREE.InstancedMesh(lantern, new THREE.MeshBasicMaterial({ toneMapped: false }), lanternPos.length);
    lanternPos.forEach((mm, i) => { im.setMatrixAt(i, mm); im.setColorAt(i, lanternCol[i]); });
    g.add(im);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(strings, 3));
    g.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a1a14 })));
  }
  if (barrierGeo.length) g.add(new THREE.Mesh(mergeGeometries(barrierGeo.map((x) => x.toNonIndexed()))!, new THREE.MeshStandardMaterial({ color: 0x2a5ab0, roughness: 0.6 })));
  if (people.length) {
    const body = mergeGeometries([
      new THREE.CylinderGeometry(0.2, 0.25, 1.1, 8).translate(0, 0.6, 0),
      new THREE.SphereGeometry(0.13, 8, 6).translate(0, 1.32, 0),
    ].map((x) => x.toNonIndexed()))!;
    const im = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.85 }), people.length);
    const cols = [0x2a2a30, 0x5a2a2a, 0x2a3a5a, 0x6b5a40, 0x1e1e1e, 0x3a4a3a, 0x8a7a6a];
    people.forEach((mm, i) => { im.setMatrixAt(i, mm); im.setColorAt(i, new THREE.Color(cols[i % cols.length])); });
    im.castShadow = true;
    g.add(im);
  }
  g.userData.update = (t: number) => {
    if (spray) {
      const a = spray.geometry.attributes.position as THREE.BufferAttribute;
      jets.forEach((j, i) => {
        const tt = ((t / j.T + j.ph) % 1) * j.T;
        a.setXYZ(i, j.x + j.vx * tt, Math.max(0.05, j.vy * tt - 4.9 * tt * tt), j.z + j.vz * tt);
      });
      a.needsUpdate = true;
    }
    for (const bm of balloons) {
      bm.position.y = bm.userData.y + Math.sin(t * 0.7) * 0.3;
      bm.rotation.z = Math.sin(t * 0.45) * 0.04;
    }
  };
  return g;
}
