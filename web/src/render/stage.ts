// Renderer, the winter sky, the low November sun, fog and post-processing.
//
// The sun sets in the south-west in late November, which in the grid-aligned world
// sits behind the player as they head uptown: long shadows stretch up the avenues
// ahead and the sun never blinds you. Shade is cold blue, light is pale gold.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { N8AOPass } from "n8ao";

export type Quality = "low" | "medium" | "high";

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uLift: { value: new THREE.Vector3(0.006, 0.004, 0.006) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSat: { value: 1.08 },
    uSpeed: { value: 0 },
    uVignette: { value: 0.35 },
    uTime: { value: 0 },
    uHurt: { value: 0 },
    uCold: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uLift, uGain;
    uniform float uSat, uSpeed, uVignette, uTime, uHurt, uCold;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c);
      vec3 col = vec3(0.0);
      float s = max(0.0, uSpeed - 12.0) * 0.0045; // only real speed smears
      for (int i = 0; i < 6; i++) {
        float k = float(i) / 5.0;
        col += texture2D(tDiffuse, 0.5 + c * (1.0 - s * k * smoothstep(0.15, 0.65, r))).rgb;
      }
      col /= 6.0;
      // cold split tone: blue in the shadows, warm in the highlights
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col += uLift * (1.0 - smoothstep(0.0, 0.5, l));
      col *= uGain;
      col = mix(col, col * vec3(0.95, 0.98, 1.04), uCold * (1.0 - smoothstep(0.1, 0.7, l)));
      col *= 1.0 - uVignette * smoothstep(0.3, 0.85, r);
      col = mix(col, col * vec3(1.25, 0.6, 0.55), uHurt * smoothstep(0.2, 0.7, r));
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.014;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// ------------------------------------------------------------------ sky and haze
// One description of the late-November air, shared by the sky dome and the fog on every
// material: whatever sits far away dissolves into exactly the colour of the sky behind it, so
// distance reads as depth (bluer, paler, warmer toward the sun) rather than a grey wall.

/** GLSL: the haze colour seen looking along d (linear), and the sky without clouds. */
function hazeGLSL(sun: THREE.Vector3) {
  const v = (x: number) => x.toFixed(5);
  return /* glsl */ `
    const vec3 SKY_SUN = vec3(${v(sun.x)}, ${v(sun.y)}, ${v(sun.z)});
    vec3 skyHaze(vec3 d) {
      vec2 flatD = normalize(d.xz + vec2(1e-5));
      float az = max(dot(flatD, normalize(SKY_SUN.xz)), 0.0);
      // cold and pale away from the sun, a soft peach under it
      vec3 col = mix(vec3(0.53, 0.60, 0.70), vec3(0.80, 0.68, 0.56), pow(az, 4.0) * 0.85);
      // forward scattering around the low sun (kept under the bloom threshold: readable, not blinding)
      col += vec3(0.30, 0.22, 0.13) * pow(max(dot(normalize(d), SKY_SUN), 0.0), 12.0);
      return col;
    }
    vec3 skyClear(vec3 d) {
      float h = max(d.y, 0.0);
      vec3 zen = vec3(0.21, 0.31, 0.47);
      return mix(skyHaze(d), zen, pow(smoothstep(0.0, 1.0, h), 0.6));
    }`;
}

function skyMaterial(sunDir: THREE.Vector3, octaves = 5) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uSun: { value: sunDir }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 uSun; uniform float uTime; varying vec3 vDir;
      ${hazeGLSL(sunDir)}
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < ${octaves}; i++){ s += vn(p) * a; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        float toSun = max(dot(d, uSun), 0.0);
        vec3 col = skyClear(d);
        // the sun itself: a small, soft disc (the bloom gives it a modest halo)
        col += vec3(1.0, 0.86, 0.66) * smoothstep(0.99986, 0.99996, toSun) * 5.0;
        col += vec3(1.0, 0.8, 0.6) * pow(toSun, 400.0) * 0.5;
        // soft stratocumulus with breaks: a cloud deck, lit from the sun side, grey-blue underneath
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 1.5 + vec2(uTime * 0.006, uTime * 0.002);
          vec2 w = vec2(fbm(uv * 0.7 + 3.1), fbm(uv * 0.7 - 7.4));
          float c = fbm(uv * 1.3 + w * 1.4);
          float cover = smoothstep(0.40, 0.68, c);
          // a cheap light march: thinner toward the sun means a brighter edge
          float c2 = fbm(uv * 1.3 + w * 1.4 + normalize(uSun.xz) * 0.16);
          float lit = clamp(0.45 + (c - c2) * 4.0, 0.0, 1.0);
          vec3 under = vec3(0.40, 0.43, 0.49);
          vec3 edge = mix(vec3(0.78, 0.78, 0.80), vec3(0.98, 0.84, 0.68), pow(toSun, 3.0));
          vec3 cc = mix(under, edge, lit * 0.8 + pow(toSun, 8.0) * 0.3);
          float fade = smoothstep(0.015, 0.22, h); // the deck melts into the haze toward the horizon
          col = mix(col, cc, cover * 0.85 * fade);
          // the disc shows through the thin parts only
        }
        if (h < 0.0) col = skyHaze(d); // below the horizon: the same haze the fog fades into
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/**
 * Height fog for every material that uses three's fog chunks. With FogExp2 above ground the
 * density thins with height (towers poke out of the haze), the colour is the sky's own haze
 * along the view ray, and everything is fully hazed by ~15 km (the horizon). Underground
 * (density > 0.004) it is the old exp2 murk in the fog colour.
 */
/** Custom ShaderMaterials don't write logarithmic depth by themselves: inject three's log-depth chunks
 *  (only for shaders that don't already have them) so they sort against everything else. */
function useLogDepthInShaderMaterials() {
  const proto = THREE.ShaderMaterial.prototype as THREE.ShaderMaterial & { __logDepth?: boolean };
  if (proto.__logDepth) return;
  proto.__logDepth = true;
  const lastBrace = (src: string, insert: string) => { const i = src.lastIndexOf("}"); return i < 0 ? src : src.slice(0, i) + "\n" + insert + "\n" + src.slice(i); };
  proto.onBeforeCompile = function (this: THREE.ShaderMaterial, sh) {
    if ((this as unknown as { isRawShaderMaterial?: boolean }).isRawShaderMaterial) return;
    if (sh.vertexShader.includes("logdepthbuf") || !sh.vertexShader.includes("gl_Position")) return;
    sh.vertexShader = (sh.vertexShader.includes("#include <common>") ? "" : "#include <common>\n") + "#include <logdepthbuf_pars_vertex>\n" + lastBrace(sh.vertexShader, "#include <logdepthbuf_vertex>");
    sh.fragmentShader = "#include <logdepthbuf_pars_fragment>\n" + lastBrace(sh.fragmentShader, "#include <logdepthbuf_fragment>");
  };
}

/** far: the camera's far plane; the haze is total before it so the city never ends in a hard edge */
function installFog(sun: THREE.Vector3, far: number) {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.fog_pars_vertex = /* glsl */ `
    #ifdef USE_FOG
      varying float vFogDepth;
      varying vec3 vFogRay;
    #endif`;
  C.fog_vertex = /* glsl */ `
    #ifdef USE_FOG
      vFogDepth = - mvPosition.z;
      vFogRay = mvPosition.xyz * mat3( viewMatrix ); // camera -> vertex, in world space
    #endif`;
  C.fog_pars_fragment = /* glsl */ `
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying float vFogDepth;
      varying vec3 vFogRay;
      #ifdef FOG_EXP2
        uniform float fogDensity;
        ${hazeGLSL(sun)}
      #else
        uniform float fogNear;
        uniform float fogFar;
      #endif
    #endif`;
  C.fog_fragment = /* glsl */ `
    #ifdef USE_FOG
      vec3 fogCol = fogColor;
      #ifdef FOG_EXP2
        float fogFactor;
        if ( fogDensity > 0.004 ) {
          fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
        } else {
          float fd = length( vFogRay );
          const float FH = 1.0 / 330.0; // haze scale height (m)
          float y0 = max( cameraPosition.y, 0.0 ), y1 = max( cameraPosition.y + vFogRay.y, 0.0 );
          float dy = ( y1 - y0 ) * FH;
          float avg = abs( dy ) > 1e-3 ? ( exp( - y0 * FH ) - exp( - y1 * FH ) ) / dy : exp( - y0 * FH );
          float tau = fogDensity * max( fd - 40.0, 0.0 ) * avg;
          fogFactor = max( 1.0 - exp( - tau ), smoothstep( ${(far * 0.56).toFixed(1)}, ${(far * 0.94).toFixed(1)}, fd ) );
          fogCol = skyHaze( vFogRay / max( fd, 1e-3 ) );
        }
      #else
        float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
      #endif
      gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
    #endif`;
}

/** Ground-level haze density above ground (per metre; see installFog). */
const HAZE = 0.0002;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  // near/far kept to a sane ratio: phones keep little depth precision, and 0.05 m to 16 km made
  // nearby surfaces flicker against each other there
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.15, 16000);
  readonly sun = new THREE.DirectionalLight(0xffd2a0, 3.4);
  readonly hemi = new THREE.HemisphereLight(0xa8b4c8, 0x4a4038, 0.6);
  readonly sunDir = new THREE.Vector3();
  readonly fog: THREE.FogExp2;
  private composer: EffectComposer;
  private grade: ShaderPass;
  private bloom: UnrealBloomPass;
  private ao: N8AOPass | null = null;
  private sky: THREE.Mesh;
  quality: Quality;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.camera.far = quality === "high" ? 16000 : quality === "medium" ? 9000 : 1200; // phones: a foggy horizon
    this.camera.updateProjectionMatrix();
    // Phones often give the page only a 16-bit depth buffer: at that precision anything past ~100 m
    // can't tell road from road markings or a facade from its far-city stand-in, and they flash.
    // A logarithmic depth buffer spreads the precision over distance, so on low quality use one,
    // and teach the custom shaders to write log depth too.
    if (quality === "low") useLogDepthInShaderMaterials();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false, logarithmicDepthBuffer: quality === "low" });
    this.maxRatio = Math.min(window.devicePixelRatio, quality === "high" ? 1.5 : 1);
    this.renderer.setPixelRatio(this.maxRatio);
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = quality !== "low";
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // the low November sun, south-west (true azimuth ~235 deg, 11 deg up), which in the
    // grid frame (avenues along +z) is behind and to the left of a player heading uptown
    const az = THREE.MathUtils.degToRad(247 - 28.9), el = THREE.MathUtils.degToRad(11);
    this.sunDir.set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize(); // east is -x
    installFog(this.sunDir, this.camera.far); // before any material compiles

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), skyMaterial(this.sunDir, quality === "low" ? 4 : 5));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    // environment: a blurred version of the same sky for reflections in the glass
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial(this.sunDir)));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(100, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4a4440 }));
    ground.position.y = -2;
    env.add(ground);
    this.scene.environment = pmrem.fromScene(env, 0.03).texture;
    this.scene.environmentIntensity = 0.5;

    this.sun.castShadow = quality !== "low";
    const map = quality === "high" ? 4096 : 2048;
    this.sun.shadow.mapSize.set(map, map);
    const sc = this.sun.shadow.camera;
    const box = quality === "high" ? 220 : 170;
    sc.left = -box; sc.right = box; sc.top = box; sc.bottom = -box; sc.near = 1; sc.far = 2400;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.8;
    this.scene.add(this.sun, this.sun.target, this.hemi);

    this.fog = new THREE.FogExp2(0xb9bcc4, HAZE);
    this.scene.fog = this.fog;

    const w = window.innerWidth, h = window.innerHeight;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, rt);
    if (quality === "low") {
      this.composer.addPass(new RenderPass(this.scene, this.camera));
    } else {
      this.ao = new N8AOPass(this.scene, this.camera, w, h);
      this.ao.configuration.aoRadius = 4;
      this.ao.configuration.distanceFalloff = 1.2;
      this.ao.configuration.intensity = 2.2;
      this.ao.configuration.color = new THREE.Color(0x1a2030);
      this.ao.configuration.halfRes = quality === "medium";
      this.ao.configuration.gammaCorrection = false; // the OutputPass at the end does that
      this.ao.setQualityMode(quality === "high" ? "Medium" : "Performance");
      this.composer.addPass(this.ao);
    }
    // the sun glinting off glass is thousands of times brighter than the sky: cap the HDR peaks before the
    // bloom so a reflection is a sparkle, not a blown-out disc across a third of the screen (AgX maps
    // anything this bright to white anyway, so the image itself barely changes)
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main() { vec4 c = texture2D(tDiffuse, vUv); float m = max(max(c.r, c.g), c.b); gl_FragColor = vec4(c.rgb * min(1.0, 4.0 / max(m, 1e-4)), c.a); }`,
    }));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.45, 1.0);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    if (quality !== "low") this.composer.addPass(new SMAAPass());

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  /** Resolution governor: if frames run slow for a couple of seconds, render at a lower resolution
   *  (down to half); when there's headroom again, step back up. Call once per real frame. */
  private maxRatio = 1;
  private resScale = 1;
  private ema = 1 / 60;
  private judge = 0;
  adapt(dt: number) {
    this.ema += (Math.min(dt, 0.2) - this.ema) * 0.05;
    if ((this.judge += dt) < 2) return;
    this.judge = 0;
    let next = this.resScale;
    if (this.ema > 1 / 38 && this.resScale > 0.5) next = Math.max(0.5, this.resScale - 0.15);
    else if (this.ema < 1 / 56 && this.resScale < 1) next = Math.min(1, this.resScale + 0.1);
    if (next === this.resScale) return;
    this.resScale = next;
    this.renderer.setPixelRatio(this.maxRatio * next);
    this.composer.setPixelRatio(this.maxRatio * next);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.ao?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Follow the player: the shadow box, the sky, and the underground mood. */
  update(focus: THREE.Vector3, t: number, speed: number, hurt: number, underground: boolean) {
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 1200);
    this.sun.target.position.copy(focus);
    const step = (this.sun.shadow.camera.right * 2) / this.sun.shadow.mapSize.x;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / step) * step;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / step) * step;
    this.sky.position.copy(this.camera.position);
    this.sky.visible = !underground; // no daylight leaking through anything down there
    this.scene.background = underground ? new THREE.Color(0x050403) : null;
    (this.sky.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    this.fog.density = underground ? 0.045 : HAZE;
    this.fog.color.set(underground ? 0x0d0b09 : 0xb9bcc4);
    const ug = this.grade.uniforms;
    ug.uSpeed.value += (speed - ug.uSpeed.value) * 0.08;
    ug.uTime.value = t;
    ug.uHurt.value = hurt;
    ug.uCold.value = 0.8;
    this.bloom.strength = underground ? 0.32 : 0.3;
  }

  render() {
    this.composer.render();
  }
}
