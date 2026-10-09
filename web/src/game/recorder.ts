// The flight recorder, for playtests: samples the run 15 times a second (position,
// velocity, inputs, wind, layer, integrity, fps), logs every event (hits, drops, tricks,
// deaths, restarts, district changes, errors) and grabs screenshots at every hit and
// death and every 10 s. It all goes to the dev server (vite.config.ts, /__rec), which
// writes web/recordings/<session>/. ?replay=<session>/<run> plays a run back.

import type { Glider, LeafInput } from "../sim/glider";

export interface Sample {
  t: number; s: number;
  p: [number, number, number]; v: [number, number, number];
  h: number; b: number; a: number; lane: string; hp: number;
  w: [number, number, number]; in: [number, number, number, number]; fps: number;
}

export interface RunLog {
  session: string; run: number; started: string; quality: string; ua: string; screen: [number, number];
  samples: Sample[]; events: { t: number; s: number; kind: string; detail: string }[];
  result?: { state: string; failure: string; time: number; furthest: number };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export class Recorder {
  readonly session = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  private run = 0;
  private log: RunLog | null = null;
  private acc = 0;
  private shotAt = 0;
  private wantShot: string | null = null;
  private flushedAt = 0;
  private lastEvents = 0;
  private lastBoost = -99;
  private lastTrick = -99;
  private lastLane = "";
  private lastDistrict = "";
  private frames = 0;
  private fpsAcc = 0;
  fps = 60;
  enabled: boolean;

  constructor(private canvas: HTMLCanvasElement, private quality: string) {
    this.enabled = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!this.enabled) return;
    window.addEventListener("error", (e) => this.event("error", `${e.message} @ ${e.filename}:${e.lineno}`));
    window.addEventListener("unhandledrejection", (e) => this.event("error", String(e.reason)));
    window.addEventListener("beforeunload", () => this.flush(true));
  }

  start(leaf: Glider) {
    if (!this.enabled) return;
    if (this.log) this.finish(leaf, "restart");
    this.run++;
    this.log = {
      session: this.session, run: this.run, started: new Date().toISOString(), quality: this.quality,
      ua: navigator.userAgent, screen: [innerWidth, innerHeight], samples: [], events: [],
    };
    this.lastEvents = 0;
    this.lastBoost = leaf.boost.t;
    this.lastTrick = leaf.tricks.lastAt;
    this.shotAt = 0;
    this.event("start", "let go of the tree");
  }

  event(kind: string, detail: string, t = this.log?.samples.at(-1)?.t ?? 0, s = this.log?.samples.at(-1)?.s ?? 0) {
    if (!this.log) return;
    this.log.events.push({ t: r2(t), s: Math.round(s), kind, detail });
  }

  /** Call every frame after the sim has stepped. */
  update(dt: number, leaf: Glider, input: LeafInput, s: number, district: string) {
    this.frames++; this.fpsAcc += dt;
    if (this.fpsAcc > 0.5) { this.fps = this.frames / this.fpsAcc; this.frames = 0; this.fpsAcc = 0; }
    if (!this.log || leaf.state === "attached") return;
    const t = leaf.time;
    // events from the leaf
    for (; this.lastEvents < leaf.events.length; this.lastEvents++) { this.event("hit", leaf.events[this.lastEvents], t, s); this.wantShot ??= "hit"; }
    if (leaf.boost.t > this.lastBoost) { this.lastBoost = leaf.boost.t; this.event("drop", `${leaf.boost.kind} +${leaf.boost.amount.toFixed(1)}`, t, s); }
    if (leaf.tricks.lastAt > this.lastTrick) { this.lastTrick = leaf.tricks.lastAt; this.event("trick", leaf.tricks.last, t, s); }
    if (leaf.lane !== this.lastLane) { this.lastLane = leaf.lane; this.event("lane", leaf.lane, t, s); }
    if (district !== this.lastDistrict) { this.lastDistrict = district; this.event("district", district, t, s); }
    if (this.fps < 40 && this.frames === 0) this.event("perf", `fps ${this.fps.toFixed(0)}`, t, s);
    this.acc += dt;
    if (this.acc >= 1 / 15) {
      this.acc = 0;
      const p = leaf.pos, v = leaf.vel, w = leaf.air;
      this.log.samples.push({
        t: r2(t), s: Math.round(s), p: [r2(p.x), r2(p.y), r2(p.z)], v: [r2(v.x), r2(v.y), r2(v.z)],
        h: r2(leaf.heading), b: r2(leaf.bank), a: r2(leaf.alpha), lane: leaf.lane, hp: r2(leaf.integrity),
        w: [r2(w.x), r2(w.y), r2(w.z)], in: [r2(input.pitch), r2(input.roll), input.spread ? 1 : 0, input.curl ? 1 : 0], fps: Math.round(this.fps),
      });
    }
    if (t - this.shotAt > 10) { this.shotAt = t; this.wantShot ??= "every10s"; }
    if ((leaf.state === "dead" || leaf.state === "planted") && !this.log.result) this.finish(leaf, leaf.state);
    if (performance.now() - this.flushedAt > 5000) this.flush();
  }

  /** Call right after rendering: grabs a screenshot if one is due (the drawing buffer is still valid). */
  afterRender(t: number, s: number) {
    if (!this.log || !this.wantShot) return;
    const why = this.wantShot;
    this.wantShot = null;
    const c = document.createElement("canvas");
    const k = Math.min(1, 960 / this.canvas.width);
    c.width = Math.round(this.canvas.width * k); c.height = Math.round(this.canvas.height * k);
    c.getContext("2d")!.drawImage(this.canvas, 0, 0, c.width, c.height);
    const name = `run${this.run}_t${t.toFixed(1)}_s${Math.round(s)}_${why}.jpg`;
    const data = c.toDataURL("image/jpeg", 0.82);
    this.post(`shot/${name}`, data);
    this.event("shot", name, t, s);
  }

  finish(leaf: Glider, why: string) {
    if (!this.log || this.log.result) return;
    const last = this.log.samples.at(-1);
    this.log.result = { state: why === "restart" && leaf.state === "flying" ? "restarted" : leaf.state, failure: leaf.failure, time: r2(leaf.time), furthest: Math.max(0, ...this.log.samples.map((x) => x.s)) };
    this.event(leaf.state === "dead" ? "death" : why, leaf.failure || why, leaf.time, last?.s ?? 0);
    if (leaf.state === "dead") this.wantShot = "death";
    this.flush(true);
  }

  flush(final = false) {
    if (!this.log) return;
    this.flushedAt = performance.now();
    this.post(`run/run${this.log.run}.json`, JSON.stringify(this.log), final);
  }

  private post(path: string, body: string, beacon = false) {
    const url = `/__rec/${this.session}/${path}`;
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon(url, body); return; }
    fetch(url, { method: "POST", body, keepalive: body.length < 60000 }).catch(() => { /* dev server not there */ });
  }
}

/** Play a recorded run back: returns the interpolated sample at time t. */
export function sampleAt(log: RunLog, t: number): Sample | null {
  const s = log.samples;
  if (!s.length) return null;
  let lo = 0, hi = s.length - 1;
  if (t <= s[0].t) return s[0];
  if (t >= s[hi].t) return s[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m].t <= t) lo = m; else hi = m; }
  const a = s[lo], b = s[hi], k = (t - a.t) / (b.t - a.t || 1);
  const L = (x: number, y: number) => x + (y - x) * k;
  return { ...a, t, p: [L(a.p[0], b.p[0]), L(a.p[1], b.p[1]), L(a.p[2], b.p[2])], v: [L(a.v[0], b.v[0]), L(a.v[1], b.v[1]), L(a.v[2], b.v[2])], h: L(a.h, b.h), b: L(a.b, b.b), a: L(a.a, b.a), hp: L(a.hp, b.hp) };
}
