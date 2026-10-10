// Loads the modelled architecture kit (models/buildings_kit.glb, built by tools/buildings/kit_blender.py).
// Every top-level object in the GLB is one kit piece named like the stand-ins in architectureKit.ts;
// its meshes are merged into one geometry with a group per material, in the piece's own frame.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export type KitParts = Map<string, { geo: THREE.BufferGeometry; mats: THREE.Material[] }>;

let cache: Promise<KitParts | null> | null = null;

export function kitBase(): string {
  return location.pathname.includes("/tools/") ? "/" : "./";
}

export function loadKitModels(): Promise<KitParts | null> {
  if (cache) return cache;
  cache = (async () => {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    let gltf;
    try { gltf = await new GLTFLoader().loadAsync(`${kitBase()}models/buildings_kit.glb`); } catch { return null; }
    const parts: KitParts = new Map();
    // every slot samples the one kit atlas (tools/buildings/kit_design.py)
    const atlas = await new THREE.TextureLoader().loadAsync(`${kitBase()}models/buildings_kit.webp`).catch(() => null);
    if (atlas) {
      atlas.colorSpace = THREE.SRGBColorSpace;
      atlas.flipY = false;   // glTF UV convention
      atlas.anisotropy = 4;
    }
    const SLOT: Record<string, THREE.MeshStandardMaterialParameters> = {
      atlas: { roughness: 0.75, metalness: 0.12, side: THREE.DoubleSide },
      metal: { roughness: 0.5, metalness: 0.45 },
      glow: { roughness: 0.5, metalness: 0, emissive: 0xffffff, emissiveIntensity: 1.4 },
      cutout: { roughness: 0.6, metalness: 0.3, alphaTest: 0.5, side: THREE.DoubleSide },
      cloth: { roughness: 0.92, metalness: 0, side: THREE.DoubleSide },
    };
    const mats = new Map<string, THREE.Material>();
    const shared = (m: THREE.Material) => {
      // painted, metal and cloth share one material (one draw call per piece); glow and cut-outs need their own
      let name = (m.name || "atlas").replace(/\.\d+$/, "");
      if (name === "metal" || name === "cloth") name = "atlas";
      if (mats.has(name)) return mats.get(name)!;
      const s = new THREE.MeshStandardMaterial({ ...(SLOT[name] ?? SLOT.atlas), map: atlas ?? undefined });
      if (name === "glow" && atlas) s.emissiveMap = atlas;
      s.name = name;
      mats.set(name, s);
      return s;
    };
    for (const obj of gltf.scene.children) {
      obj.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
      const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const list = Array.isArray(m.material) ? m.material : [m.material];
        const g = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
        if (list.length === 1 || !g.groups.length) {
          const mat = shared(list[0]);
          (byMat.get(mat) ?? byMat.set(mat, []).get(mat)!).push(stripTo(g));
        } else {
          for (const grp of g.groups) {
            const sub = g.clone();
            const idx = g.index!.array.slice(grp.start, grp.start + grp.count);
            sub.setIndex(Array.from(idx));
            sub.clearGroups();
            const mat = shared(list[grp.materialIndex ?? 0]);
            (byMat.get(mat) ?? byMat.set(mat, []).get(mat)!).push(stripTo(sub));
          }
        }
      });
      if (!byMat.size) continue;
      const geos: THREE.BufferGeometry[] = [], ms: THREE.Material[] = [];
      for (const [mat, list] of byMat) { geos.push(mergeGeometries(list)!); ms.push(mat); }
      const geo = mergeGeometries(geos, true)!;
      geo.computeBoundingSphere();
      parts.set(obj.name, { geo, mats: ms });
    }
    return parts;
  })();
  return cache;
}

/** Keep only what the kit material reads, so pieces merge. */
function stripTo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", g.attributes.position);
  if (!g.attributes.normal) g.computeVertexNormals();
  out.setAttribute("normal", g.attributes.normal);
  out.setAttribute("uv", g.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (g.index) out.setIndex(g.index);
  return out.index ? out.toNonIndexed() : out;
}
