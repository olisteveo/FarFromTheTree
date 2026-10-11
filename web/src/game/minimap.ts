// The minimap, bottom right: the city around you, turned so you're always flying up the map.
// The route to Central Park in gold, subway ways in as green dots (the next one ahead pulses),
// closed streets in red, the park and the meadow where the seed goes, and how far is left.
// Underground it shows the subway line and its stations instead.

import type { CityData, Polyline } from "../world/data";
import type { Blockers } from "../world/blockers";
import type { Shaft, Underground } from "../world/underground";
import type { WindFeatures } from "../world/windFeatures";

const S = 0.36; // map pixels per metre in the baked map

export class Minimap {
  readonly el: HTMLElement;
  private c: HTMLCanvasElement;
  private x: CanvasRenderingContext2D;
  private bake: HTMLCanvasElement;
  private x0 = 0; private z1 = 0; // baked map origin: px = (x0 - x) * S... see toPx
  private ins: Shaft[];
  private acc = 0;
  private zoom = 1;
  private size = 190;
  /** the wind's secrets you've found, drawn once found */
  features: WindFeatures | null = null;
  found: Set<number> = new Set();
  clock = 0;

  constructor(root: HTMLElement, private city: CityData, private under: Underground, private blockers: Blockers, private goal: { x: number; z: number }) {
    this.el = document.createElement("div");
    this.el.className = "minimap";
    this.c = document.createElement("canvas");
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.c.width = this.c.height = Math.round(this.size * dpr);
    this.el.appendChild(this.c);
    const lbl = document.createElement("div");
    lbl.className = "minimap-label";
    this.el.appendChild(lbl);
    root.appendChild(this.el);
    this.x = this.c.getContext("2d")!;
    this.x.scale(dpr, dpr);
    this.ins = under.shafts.filter((s) => (s.kind === "stairs" || s.kind === "vent") && !s.out);
    this.bake = this.bakeMap();
  }

  // world (x = -east, +z = uptown) to baked pixels, east to the right and uptown at the top
  private px(x: number) { return (this.x0 - x) * S; }
  private py(z: number) { return (this.z1 - z) * S; }

  private bakeMap(): HTMLCanvasElement {
    const raw = this.city.raw;
    // the playable strip: the route plus a margin
    let xa = Infinity, xb = -Infinity, za = Infinity, zb = -Infinity;
    const r = this.city.route;
    for (let i = 0; i < r.x.length; i++) { xa = Math.min(xa, r.x[i]); xb = Math.max(xb, r.x[i]); za = Math.min(za, r.z[i]); zb = Math.max(zb, r.z[i]); }
    const M = 650;
    xa -= M; xb += M; za -= M; zb += M;
    this.x0 = xb; this.z1 = zb;
    const c = document.createElement("canvas");
    c.width = Math.ceil((xb - xa) * S); c.height = Math.ceil((zb - za) * S);
    const g = c.getContext("2d")!;
    g.fillStyle = "#24343f"; g.fillRect(0, 0, c.width, c.height); // the rivers and the harbour
    const poly = (rings: number[][], fill: string) => {
      g.fillStyle = fill;
      g.beginPath();
      for (const ring of rings) {
        for (let k = 0; k < ring.length; k += 2) { const X = this.px(ring[k]), Y = this.py(ring[k + 1]); if (k === 0) g.moveTo(X, Y); else g.lineTo(X, Y); }
        g.closePath();
      }
      g.fill("evenodd");
    };
    for (const p of raw.land) poly(p, "#3b3532");
    for (const p of raw.sidewalk) poly(p, "#58524c");
    for (const p of raw.roadbed) poly(p, "#7a736a");
    for (const p of raw.plaza) poly(p, "#5e5850");
    for (const s of raw.sites) poly(s.p, "#5a4a36");
    for (const p of raw.parks) poly(p.p, /Sheep Meadow/.test(p.n) ? "#7a9a4a" : "#4d6235");
    for (const b of raw.buildings) poly(b.p, b.h > 60 ? "#1d1a19" : "#2a2624");
    return c;
  }

  /** dt; the leaf's position and heading; underground?; the next way in the signs point to */
  /** the way along the streets (world/course.ts), drawn in place of the route line, which cuts through buildings */
  path: Polyline | null = null;

  update(dt: number, x: number, y: number, z: number, heading: number, underground: boolean, routeS: number, next: Shaft | null) {
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    const g = this.x, W = this.size, cx = W / 2, cy = W * 0.58;
    // zoom out as you climb (you can see further from up there)
    const want = 1 / (1 + Math.max(0, y) / 160);
    this.zoom += (want - this.zoom) * 0.15;
    const z2 = this.zoom * 1.35; // screen px per baked px
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(cx, W / 2, W / 2 - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = "#24343f"; g.fillRect(0, 0, W, W);
    // turn the map so the heading points up
    const hx = -Math.sin(heading), hy = -Math.cos(heading); // heading in baked-pixel space
    const rot = -Math.PI / 2 - Math.atan2(hy, hx);
    g.translate(cx, cy);
    g.rotate(rot);
    g.scale(z2, z2);
    g.translate(-this.px(x), -this.py(z));
    g.imageSmoothingEnabled = true;
    g.drawImage(this.bake, 0, 0);
    const lw = 1 / z2;
    if (underground) {
      g.fillStyle = "rgba(10, 8, 6, 0.6)";
      g.fillRect(this.px(x) - 1000, this.py(z) - 1000, 2000, 2000);
      const sub = this.city.subway;
      g.strokeStyle = "#f2c230"; g.lineWidth = 4 * lw;
      g.beginPath();
      for (let i = 0; i < sub.x.length; i += 2) { const X = this.px(sub.x[i]), Y = this.py(sub.z[i]); if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y); }
      g.stroke();
      for (const st of this.under.stations) {
        const a = sub.at(st.ss);
        g.fillStyle = "#fff"; g.beginPath(); g.arc(this.px(a.x), this.py(a.z), 5 * lw, 0, 7); g.fill();
      }
      // the ways out
      for (const s of this.under.shafts) {
        if (s.kind === "stairs" && !s.out) continue;
        g.fillStyle = s.kind === "grate" ? "#9ad" : "#e8e8e8";
        g.beginPath(); g.arc(this.px(s.x), this.py(s.z), 2.5 * lw, 0, 7); g.fill();
      }
    } else {
      // the way uptown along the streets, ahead of you
      const r = this.path ?? this.city.route;
      g.strokeStyle = "rgba(255, 190, 80, 0.85)"; g.lineWidth = 3 * lw; g.setLineDash([8 * lw, 6 * lw]);
      g.beginPath();
      const from = Math.max(0, Math.floor((this.path ? this.path.nearest(x, z).s : routeS) / r.step) - 20);
      for (let i = from; i < r.x.length; i += 3) { const X = this.px(r.x[i]), Y = this.py(r.z[i]); if (i === from) g.moveTo(X, Y); else g.lineTo(X, Y); }
      g.stroke(); g.setLineDash([]);
      // closed streets
      for (const b of this.blockers.list) {
        g.fillStyle = "rgba(230, 60, 40, 0.28)"; g.strokeStyle = "rgba(255, 90, 60, 0.8)"; g.lineWidth = 2 * lw;
        g.beginPath(); g.arc(this.px(b.x), this.py(b.z), b.r * S, 0, 7); g.fill(); g.stroke();
      }
      // hidden currents you've found (cyan), and the dust devils (white swirls)
      if (this.features) {
        g.strokeStyle = "rgba(90, 230, 255, 0.85)"; g.lineWidth = 3 * lw; g.lineCap = "round";
        for (const id of this.found) {
          const j = this.features.jets[id];
          if (!j) continue;
          g.beginPath();
          for (let k = 0; k < j.pts.length; k += 6) { const X = this.px(j.pts[k]), Y = this.py(j.pts[k + 2]); if (k === 0) g.moveTo(X, Y); else g.lineTo(X, Y); }
          g.stroke();
        }
        for (const d of this.features.devils) {
          const [dx, dz] = this.features.devilAt(d, this.clock);
          const X = this.px(dx), Y = this.py(dz);
          g.strokeStyle = "rgba(255, 255, 255, 0.75)"; g.lineWidth = 1.6 * lw;
          g.beginPath();
          for (let a = 0; a < 9.5; a += 0.3) { const rr = (1 + a * 0.75) * lw; const px = X + Math.cos(a + this.clock * 3) * rr, py = Y + Math.sin(a + this.clock * 3) * rr; if (a === 0) g.moveTo(px, py); else g.lineTo(px, py); }
          g.stroke();
        }
      }
      // subway ways in
      const t = performance.now() / 1000;
      for (const s of this.ins) {
        const X = this.px(s.x), Y = this.py(s.z), hot = s === next;
        const rr = (hot ? 6 + Math.sin(t * 6) * 1.5 : 3.5) * lw;
        g.fillStyle = hot ? "#3dff8a" : "#1fa860"; g.strokeStyle = "#fff"; g.lineWidth = 1.2 * lw;
        g.beginPath(); g.arc(X, Y, rr, 0, 7); g.fill(); g.stroke();
      }
    }
    // the goal: Sheep Meadow
    g.fillStyle = "#c8ff6a"; g.strokeStyle = "#1a2a10"; g.lineWidth = 2 * lw;
    g.beginPath(); g.arc(this.px(this.goal.x), this.py(this.goal.z), 7 * lw, 0, 7); g.fill(); g.stroke();
    g.restore();
    // the goal off the edge: an arrow on the rim pointing to it
    {
      const dx = (this.px(this.goal.x) - this.px(x)) * z2, dy = (this.py(this.goal.z) - this.py(z)) * z2;
      const c = Math.cos(rot), s = Math.sin(rot);
      const sx = dx * c - dy * s, sy = dx * s + dy * c;
      const d = Math.hypot(sx, sy), R = W / 2 - 10;
      if (d + (cy - W / 2) > R) {
        const ax = cx + (sx / d) * R, ay = W / 2 + (sy / d) * R;
        g.save(); g.translate(ax, ay); g.rotate(Math.atan2(sy, sx) + Math.PI / 2);
        g.fillStyle = "#c8ff6a"; g.beginPath(); g.moveTo(0, -7); g.lineTo(6, 5); g.lineTo(-6, 5); g.closePath(); g.fill();
        g.restore();
      }
    }
    // you: the leaf, always pointing up
    g.save(); g.translate(cx, cy);
    g.fillStyle = "#ff6a3a"; g.strokeStyle = "#fff"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6.5, 7); g.lineTo(0, 3.5); g.lineTo(-6.5, 7); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // rim
    g.strokeStyle = "rgba(255, 240, 225, 0.35)"; g.lineWidth = 2;
    g.beginPath(); g.arc(cx, W / 2, W / 2 - 2, 0, Math.PI * 2); g.stroke();
    const left = Math.max(0, this.city.route.length - routeS);
    (this.el.querySelector(".minimap-label") as HTMLElement).textContent = underground ? "SUBWAY" : `${(left / 1000).toFixed(1)} km to the park`;
  }
}
