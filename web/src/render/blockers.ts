// Draws the blockers: curtains of lanterns with a festival banner across each street into
// the Chinatown festival, and blue police barriers with a packed crowd behind them around
// Times Square.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Blockers } from "../world/blockers";

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
  const festivalBanner = new THREE.MeshBasicMaterial({ map: banner("MULBERRY STREET FESTIVAL · STREET CLOSED", "#b51f1f", "#ffd84a"), side: THREE.DoubleSide, toneMapped: false });
  const policeBanner = new THREE.MeshBasicMaterial({ map: banner("POLICE LINE · DO NOT CROSS", "#1d3f8a", "#ffffff"), side: THREE.DoubleSide });
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
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(bar.half * 2, 1.4), festivalBanner);
      ban.position.set(bar.x, bar.height + 1.2, bar.z);
      ban.rotation.y = yaw + Math.PI / 2;
      g.add(ban);
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
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(bar.half * 2, 0.6), policeBanner);
      ban.position.set(bar.x, 1.5, bar.z);
      ban.rotation.y = yaw + Math.PI / 2;
      g.add(ban);
    }
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
  return g;
}
