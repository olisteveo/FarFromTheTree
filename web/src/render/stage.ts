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

function skyMaterial(sunDir: THREE.Vector3) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uSun: { value: sunDir }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 uSun; uniform float uTime; varying vec3 vDir;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += vn(p) * a; p *= 2.03; a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        float toSun = max(dot(d, uSun), 0.0);
        // late November: a pale, cold sky that warms toward the low sun
        vec3 zenith = vec3(0.30, 0.42, 0.62);
        vec3 horizon = vec3(0.78, 0.76, 0.76);
        vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.55));
        col = mix(col, vec3(1.0, 0.74, 0.48), pow(toSun, 6.0) * 0.55 * (1.0 - smoothstep(0.0, 0.5, h)));
        col += vec3(1.0, 0.8, 0.55) * pow(toSun, 64.0) * 0.6;   // soft glow, no blinding disc
        col += vec3(1.0, 0.92, 0.8) * smoothstep(0.9993, 0.9998, toSun) * 1.2;
        // thin high cloud, lit from the sun side
        vec2 uv = d.xz / max(h, 0.08) * 0.6 + uTime * 0.004;
        float cl = smoothstep(0.45, 0.85, fbm(uv * 1.6)) * smoothstep(0.02, 0.25, h);
        col = mix(col, mix(vec3(0.82, 0.82, 0.86), vec3(1.0, 0.82, 0.66), pow(toSun, 3.0)), cl * 0.65);
        col = mix(col, horizon * 0.95, 1.0 - smoothstep(-0.02, 0.06, h)); // haze at the horizon
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.05, 6000);
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
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === "high" ? 1.5 : 1));
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = quality !== "low";
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // the low November sun, south-west (true azimuth ~235 deg, 11 deg up), which in the
    // grid frame (avenues along +z) is behind and to the left of a player heading uptown
    const az = THREE.MathUtils.degToRad(235 - 28.9), el = THREE.MathUtils.degToRad(11);
    this.sunDir.set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize(); // east is -x

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), skyMaterial(this.sunDir));
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

    this.fog = new THREE.FogExp2(0xb9bcc4, 0.00042);
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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.55, 0.9);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    if (quality !== "low") this.composer.addPass(new SMAAPass());

    window.addEventListener("resize", () => this.resize());
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
    this.fog.density = underground ? 0.045 : 0.00042;
    this.fog.color.set(underground ? 0x0d0b09 : 0xb9bcc4);
    const ug = this.grade.uniforms;
    ug.uSpeed.value += (speed - ug.uSpeed.value) * 0.08;
    ug.uTime.value = t;
    ug.uHurt.value = hurt;
    ug.uCold.value = 0.8;
    this.bloom.strength = underground ? 0.6 : 0.3;
  }

  render() {
    this.composer.render();
  }
}
