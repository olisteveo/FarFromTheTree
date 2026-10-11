// Shader and texture warm-up: the stutter of new things.
//
// Whenever something new joins the scene (a model finishing its download, a pool of props, a station),
// three compiles its shaders and uploads its textures the first time it's drawn, all inside that frame:
// on Windows (ANGLE turns every shader into HLSL) one new material costs 30-150 ms, and a model arriving
// with ten of them froze the game for a second. Here, every object added to the scene is caught as it's
// added, and before it's ever drawn:
//   - its programs (and the shadow-map depth programs it will need) start compiling in parallel
//     (KHR_parallel_shader_compile), without blocking;
//   - its textures are decoded off the thread (img.decode) and uploaded a few per frame under a time budget
//     (phones: shrunk to their size limit first, so the full-size version never reaches the GPU);
//   - meanwhile the new object is kept out of the picture (layers mask 0) and shown the frame its shaders
//     and textures are ready (a few frames later; a 4 s safety net shows it regardless).
// Things already in the scene but not drawn yet (out of view, out of range, underground) get the same
// compile + upload ahead of time, without being hidden, by a slow sweep.

import * as THREE from "three";

type Renderable = THREE.Mesh | THREE.Points | THREE.Line | THREE.Sprite;
type Prog = { program?: WebGLProgram; isReady(): boolean };
interface Waiting { objs: Renderable[]; masks: number[]; progs: Prog[]; texs: THREE.Texture[]; t0: number }

const isRenderable = (o: THREE.Object3D): o is Renderable =>
  !!(o as Renderable).material && ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) === true;

const shadowSide: Record<number, THREE.Side> = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };

export class Warmup {
  /** objects added to any Object3D since the last frame (from the add() hook) */
  private added: THREE.Object3D[] = [];
  /** renderable -> the material it had when it was warmed */
  private seen = new WeakMap<THREE.Object3D, THREE.Material | THREE.Material[]>();
  private waiting: Waiting[] = [];
  private texQueue: THREE.Texture[] = [];
  private texQueued = new WeakSet<THREE.Texture>();
  private late: THREE.Texture[] = [];
  private decoding = new WeakSet<THREE.Texture>();
  private sweepAt = 0;
  private depthMats = new Map<string, THREE.MeshDepthMaterial>();
  private frames = 0;
  /** ms of texture uploads per frame (at least one texture always goes) */
  budgetMs: number;
  /** phones: images bigger than this are shrunk before their first upload (0: never) */
  maxTexture: number;
  enabled = true;
  /** for tools/perf: what it has done */
  readonly stats = { warmed: 0, hidden: 0, programs: 0, textures: 0 };

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera, opts: { budgetMs?: number; maxTexture?: number } = {}) {
    this.budgetMs = opts.budgetMs ?? 3;
    this.maxTexture = opts.maxTexture ?? 0;
    const self = this;
    const proto = THREE.Object3D.prototype as THREE.Object3D & { __warmAdd?: boolean };
    if (!proto.__warmAdd) {
      proto.__warmAdd = true;
      const add = proto.add;
      proto.add = function (this: THREE.Object3D, ...objs: THREE.Object3D[]) {
        const r = add.apply(this, objs);
        if (self.enabled) for (const o of objs) if (o && o !== this) self.added.push(o);
        return r;
      } as typeof proto.add;
    }
  }

  /** Once a frame, just before the scene is drawn. target: a render target the scene is drawn into
   *  (the shaders differ for the screen and for a target: tone mapping, output colour space). */
  frame(target: THREE.WebGLRenderTarget | null) {
    if (!this.enabled) return;
    this.frames++;
    const now = performance.now();
    // 1. what was added since the last frame: warm it, hidden until it's ready
    if (this.added.length) {
      const roots = this.added;
      this.added = [];
      const fresh: Renderable[] = [];
      for (const r of roots) if (this.inScene(r)) this.collect(r, fresh);
      if (fresh.length) this.warm(fresh, true, target);
    }
    // 2. a slow sweep for the rest: material swaps, things added before the hook, whatever isn't drawn yet
    if (now > this.sweepAt) {
      this.sweepAt = now + 1000;
      const fresh: Renderable[] = [];
      this.collect(this.scene, fresh);
      if (fresh.length) this.warm(fresh, false, target);
    }
    // 3. textures, a few a frame (and the ones that just finished downloading)
    if (this.late.length) this.late = this.late.filter((t) => { if (t.version === 0) return true; this.queueTexture(t); return false; });
    this.uploadTextures(now);
    // 4. show what's ready
    if (this.waiting.length) {
      this.waiting = this.waiting.filter((w) => {
        if (now - w.t0 < 4000 && (!w.progs.every((p) => p.program === undefined || p.isReady()) || !w.texs.every((t) => t.version > 0 && this.uploaded(t)))) return true;
        w.objs.forEach((o, i) => { if (o.layers.mask === 0) o.layers.mask = w.masks[i]; });
        return false;
      });
    }
  }

  private inScene(o: THREE.Object3D) {
    let p: THREE.Object3D | null = o;
    while (p.parent) p = p.parent;
    return p === this.scene;
  }

  private collect(root: THREE.Object3D, out: Renderable[]) {
    root.traverse((o) => {
      if (!isRenderable(o)) return;
      if (this.seen.get(o) === o.material) return;
      this.seen.set(o, o.material);
      out.push(o);
    });
  }

  private warm(objs: Renderable[], hide: boolean, target: THREE.WebGLRenderTarget | null) {
    const R = this.renderer;
    const info = R.info as unknown as { programs: Prog[] | null };
    const before = new Set(info.programs ?? []);
    // the depth programs the shadow map will use for them: stand-ins that share the object's geometry
    // flags (instancing, skinning...) but carry the depth material three's shadow pass would pick
    const list: THREE.Object3D[] = [...objs];
    if (R.shadowMap.enabled) for (const o of objs) if ((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints) {
      for (const m of ([] as THREE.Material[]).concat(o.material)) {
        if (!m || !m.visible) continue;
        const d = this.depthFor(o, m);
        if (!d) continue;
        const proxy = Object.create(o) as THREE.Object3D;
        (proxy as unknown as { material: THREE.Material }).material = d;
        (proxy as unknown as { children: THREE.Object3D[] }).children = [];
        list.push(proxy);
      }
    }
    const root = new THREE.Object3D();
    (root as unknown as { children: THREE.Object3D[] }).children = list; // (not re-parented: traverse only reads children)
    const prev = R.getRenderTarget();
    try {
      R.setRenderTarget(target);
      R.compile(root, this.camera, this.scene);
    } catch (e) {
      console.warn("warm-up compile failed", e);
    } finally {
      R.setRenderTarget(prev);
    }
    const progs = (info.programs ?? []).filter((p) => !before.has(p));
    this.stats.warmed += objs.length;
    this.stats.programs += progs.length;
    const texs = new Set<THREE.Texture>();
    const mats = new Set<THREE.Material>();
    for (const o of objs) for (const m of ([] as THREE.Material[]).concat(o.material)) if (m) mats.add(m);
    for (const m of mats) texturesOf(m, texs);
    const need: THREE.Texture[] = [];
    for (const t of texs) {
      if (t.version > 0) { if (!this.uploaded(t)) { need.push(t); this.queueTexture(t); } }
      // an image still downloading (TextureLoader.load hands the texture back at once): wait for it too,
      // and upload it the frame it lands
      else if (typeof HTMLImageElement !== "undefined" && t.image instanceof HTMLImageElement) { need.push(t); if (!this.late.includes(t)) this.late.push(t); }
    }
    if (hide && (need.length || progs.some((p) => !p.isReady()))) {
      // (the very first frame keeps everything: it's the loading screen, and an empty city there looks broken)
      if (this.frames <= 1) return;
      const w: Waiting = { objs: [], masks: [], progs, texs: need, t0: performance.now() };
      for (const o of objs) { if (o.layers.mask === 0) continue; w.objs.push(o); w.masks.push(o.layers.mask); o.layers.mask = 0; }
      if (w.objs.length) { this.waiting.push(w); this.stats.hidden += w.objs.length; }
    }
  }

  /** The depth material three's shadow pass will draw o with (WebGLShadowMap.getDepthMaterial), as a stand-in. */
  private depthFor(o: THREE.Object3D, m: THREE.Material): THREE.Material | null {
    const custom = (o as THREE.Mesh).customDepthMaterial;
    const mm = m as THREE.MeshStandardMaterial & { alphaToCoverage?: boolean };
    const side = m.shadowSide !== null && m.shadowSide !== undefined ? m.shadowSide : shadowSide[m.side];
    const alphaTest = mm.alphaToCoverage ? 0.5 : m.alphaTest;
    if (custom) return null; // (shared and configured by the shadow pass itself: leave it alone)
    const key = [side, alphaTest > 0, !!mm.map, !!mm.alphaMap, !!(mm.displacementMap && mm.displacementScale !== 0), !!mm.wireframe].join();
    let d = this.depthMats.get(key);
    if (!d) {
      d = new THREE.MeshDepthMaterial();
      d.side = side;
      d.alphaTest = alphaTest;
      d.wireframe = !!mm.wireframe;
      this.depthMats.set(key, d);
    }
    // the maps decide the program's defines (uv sets, channels): use the object's own
    d.map = mm.map ?? null;
    d.alphaMap = mm.alphaMap ?? null;
    d.displacementMap = mm.displacementMap ?? null;
    d.displacementScale = mm.displacementScale ?? 1;
    d.needsUpdate = true;
    return d;
  }

  private uploaded(t: THREE.Texture) {
    const p = this.renderer.properties.get(t) as { __version?: number };
    return p.__version === t.version || t.version === 0 || (t as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture === true;
  }

  private queueTexture(t: THREE.Texture) {
    if (this.texQueued.has(t)) return;
    this.texQueued.add(t);
    const img = t.image as HTMLImageElement | undefined;
    // decode off the thread first: a plain <img> otherwise decodes inside the upload, on the main thread
    if (typeof HTMLImageElement !== "undefined" && img instanceof HTMLImageElement && typeof img.decode === "function" && !this.decoding.has(t)) {
      this.decoding.add(t);
      img.decode().catch(() => {}).then(() => this.texQueue.push(t));
    } else this.texQueue.push(t);
  }

  private uploadTextures(now: number) {
    const R = this.renderer;
    let n = 0;
    while (this.texQueue.length) {
      const t = this.texQueue.shift()!;
      this.texQueued.delete(t);
      if (this.uploaded(t)) continue;
      if (this.maxTexture) shrink(t, this.maxTexture);
      this.stats.textures++;
      try { R.initTexture(t); } catch { /* a texture three can't take yet: it'll go up on first use as before */ }
      n++;
      if (performance.now() - now > this.budgetMs && n > 0) break;
    }
  }
}

/** Every texture a material samples: its maps, and a ShaderMaterial's uniforms. */
function texturesOf(m: THREE.Material, out: Set<THREE.Texture>) {
  const rec = m as unknown as Record<string, unknown>;
  for (const k in rec) {
    const v = rec[k] as THREE.Texture | undefined;
    if (v && (v as THREE.Texture).isTexture) out.add(v);
  }
  const u = (m as THREE.ShaderMaterial).uniforms;
  if (u) for (const k in u) {
    const v = u[k]?.value;
    if (v && (v as THREE.Texture).isTexture) out.add(v as THREE.Texture);
    else if (Array.isArray(v)) for (const x of v) if (x && (x as THREE.Texture).isTexture) out.add(x as THREE.Texture);
  }
}

/** Phones: an image texture over max px goes to the GPU at max instead (as main.ts shrinkTextures did after
 *  the fact, by then the full-size version had already been uploaded once). */
function shrink(t: THREE.Texture, max: number) {
  const img = t.image as { width?: number; height?: number } | undefined;
  if (!img || !img.width || !img.height || Math.max(img.width, img.height) <= max) return;
  if ((t as THREE.DataTexture).isDataTexture || (t as unknown as { isDataArrayTexture?: boolean }).isDataArrayTexture || (t as THREE.CompressedTexture).isCompressedTexture) return;
  if (!(img instanceof HTMLImageElement || img instanceof HTMLCanvasElement || (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap))) return;
  const k = max / Math.max(img.width, img.height);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  c.getContext("2d")!.drawImage(img as CanvasImageSource, 0, 0, c.width, c.height);
  t.image = c;
  t.needsUpdate = true;
}
