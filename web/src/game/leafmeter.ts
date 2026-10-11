// The leaf meter, bottom left: your red maple leaf, drawn live. As integrity drops it
// gets holes punched through it, browns and withers, and curls up; scars (the damage
// that won't heal) show as dark patches. It pulses when it's about to fall apart.

const W = 220, H = 220;

interface Hole { x: number; y: number; r: number; at: number }

export class LeafMeter {
  readonly el: HTMLElement;
  private c: HTMLCanvasElement;
  private x: CanvasRenderingContext2D;
  private holes: Hole[] = [];
  private shown = 1;
  private last = "";

  constructor(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "leafmeter";
    this.c = document.createElement("canvas");
    this.c.width = W * 2; this.c.height = H * 2;
    this.el.appendChild(this.c);
    const label = document.createElement("div");
    label.className = "leafmeter-label";
    this.el.appendChild(label);
    root.appendChild(this.el);
    this.x = this.c.getContext("2d")!;
    // where the holes go as the leaf wears out (fixed, so the same leaf tears the same way)
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2, d = 0.15 + rnd() * 0.62;
      this.holes.push({ x: Math.sin(a) * d, y: -Math.cos(a) * d * 0.95 - 0.05, r: 0.035 + rnd() * 0.06, at: 1 - (i + 1) / 17 });
    }
  }

  private outline(cx: number, cy: number, R: number, curl: number): Path2D {
    // the same broad five-lobed maple as the 3D leaf, curling in as it withers
    const lobes: [number, number, number][] = [[0, 1, 26], [-52, 0.82, 24], [52, 0.82, 24], [-108, 0.56, 20], [108, 0.56, 20]];
    const p = new Path2D();
    for (let i = 0; i <= 360; i++) {
      const ang = -180 + i;
      let r = 0.28;
      for (const [la, len, wid] of lobes) {
        const d = (ang - la) / (wid * 1.25);
        r = Math.max(r, 0.28 + (len - 0.28) * Math.exp(-d * d * 2.2) * (1 - Math.abs(d) * 0.18));
      }
      if (Math.abs(ang) > 150) r = Math.max(r, 0.24);
      r *= 1 + 0.05 * Math.sin(ang * 0.55 * Math.PI) * (r > 0.44 ? 1 : 0);
      const a = (ang * Math.PI) / 180;
      const x = cx + Math.sin(a) * r * R * (1 - curl * 0.35 * Math.abs(Math.sin(a)));
      const y = cy - Math.cos(a) * r * R * (1 - curl * 0.12);
      if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
    }
    p.closePath();
    return p;
  }

  /** wet: 0..1, soaked by Central Park's rain (the leaf darkens, glistens and drips) */
  update(dt: number, integrity: number, maxIntegrity: number, t: number, wet = 0) {
    this.shown += (integrity - this.shown) * Math.min(1, dt * 6);
    const v = Math.max(0, this.shown);
    const key = `${v.toFixed(3)}|${maxIntegrity.toFixed(2)}|${v < 0.3 ? Math.floor(t * 8) : 0}|${wet.toFixed(2)}|${wet > 0.05 ? Math.floor(t * 12) : 0}`;
    if (key === this.last) return;
    this.last = key;
    const x = this.x, S = 2;
    x.setTransform(S, 0, 0, S, 0, 0);
    x.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.56, R = W * 0.46;
    const wear = 1 - v;
    const pulse = v < 0.3 ? 0.5 + 0.5 * Math.sin(t * 9) : 0;
    const shape = this.outline(cx, cy, R, wear * wear);
    // the leaf: red when healthy, browning and greying as it withers
    const lerp = (a: number[], b: number[], k: number) => a.map((q, i) => Math.round(q + (b[i] - q) * k));
    const healthy = [214, 64, 36], brown = [122, 74, 40], dead = [92, 84, 74];
    const col = wear < 0.5 ? lerp(healthy, brown, wear * 2) : lerp(brown, dead, (wear - 0.5) * 2);
    const g = x.createRadialGradient(cx, cy - R * 0.25, R * 0.1, cx, cy, R * 1.05);
    g.addColorStop(0, `rgb(${lerp(col, [255, 200, 140], 0.25).join(",")})`);
    g.addColorStop(1, `rgb(${lerp(col, [40, 20, 10], 0.35).join(",")})`);
    x.save();
    x.shadowColor = pulse ? `rgba(255,60,40,${0.4 + pulse * 0.5})` : "rgba(0,0,0,0.45)";
    x.shadowBlur = pulse ? 18 : 10;
    x.fillStyle = g;
    x.fill(shape);
    x.restore();
    // scars: damage that won't heal shows as dark withered patches
    x.save();
    x.clip(shape);
    const scar = 1 - maxIntegrity;
    for (let i = 0; i < 6; i++) {
      const h = this.holes[i * 2 + 1];
      if (scar <= i * 0.07) break;
      x.fillStyle = "rgba(60,30,15,0.45)";
      x.beginPath(); x.arc(cx + h.x * R, cy + h.y * R, h.r * R * 1.8, 0, 7); x.fill();
    }
    // soaked: darker, cold, beaded with water
    if (wet > 0.01) {
      x.fillStyle = `rgba(16,24,40,${Math.min(0.55, wet * 0.55)})`;
      x.fill(shape);
      for (let i = 0; i < 9; i++) {
        const h = this.holes[i];
        if (wet < i * 0.1) break;
        const bx = cx + h.x * R * 0.9 + 10, by = cy + h.y * R * 0.9 - 6;
        x.fillStyle = `rgba(200,225,255,${0.25 + wet * 0.35})`;
        x.beginPath(); x.ellipse(bx, by, 3.2, 4.2, 0, 0, 7); x.fill();
        x.fillStyle = `rgba(255,255,255,${0.5 + wet * 0.4})`;
        x.beginPath(); x.arc(bx - 1, by - 1.5, 1.2, 0, 7); x.fill();
      }
    }
    // veins
    x.strokeStyle = `rgba(255,210,170,${0.55 - wear * 0.35})`;
    x.lineWidth = 1.6;
    for (const ang of [0, -52, 52, -108, 108]) {
      const a = (ang * Math.PI) / 180, L = ang === 0 ? 0.92 : Math.abs(ang) > 100 ? 0.5 : 0.75;
      x.beginPath(); x.moveTo(cx, cy + R * 0.05); x.lineTo(cx + Math.sin(a) * L * R, cy - Math.cos(a) * L * R); x.stroke();
    }
    // holes punched through as it wears out
    x.globalCompositeOperation = "destination-out";
    for (const h of this.holes) {
      if (v > h.at) continue;
      const grow = Math.min(1, (h.at - v) * 6);
      x.beginPath();
      for (let k = 0; k <= 10; k++) {
        const a = (k / 10) * Math.PI * 2, rr = h.r * R * grow * (0.75 + 0.35 * Math.sin(k * 2.7 + h.x * 9));
        const px = cx + h.x * R + Math.cos(a) * rr, py = cy + h.y * R + Math.sin(a) * rr;
        if (k === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.fill();
    }
    x.globalCompositeOperation = "source-over";
    x.restore();
    // outline and stem
    x.strokeStyle = "rgba(40,15,8,0.8)";
    x.lineWidth = 2;
    x.stroke(shape);
    x.strokeStyle = `rgb(${lerp([90, 50, 20], [70, 60, 50], wear).join(",")})`;
    x.lineWidth = 4;
    x.beginPath(); x.moveTo(cx, cy + R * 0.05); x.quadraticCurveTo(cx + 6, cy + R * 0.35, cx - 4, cy + R * 0.48); x.stroke();
    // the seed at the stem: always there, it's the point
    x.fillStyle = "#6a4422";
    x.beginPath(); x.ellipse(cx + 2, cy + R * 0.2, 7, 10, 0.3, 0, 7); x.fill();
    // drips off the tip and the lobes once it's properly wet
    if (wet > 0.25) {
      for (let k = 0; k < 3; k++) {
        const ph = (t * (0.7 + k * 0.23) + k * 0.37) % 1;
        if (ph * 3 > wet * 3 + 0.2) continue;
        const dx = [cx - R * 0.55, cx + R * 0.5, cx + 4][k], dy0 = [cy - R * 0.05, cy - R * 0.1, cy + R * 0.55][k];
        x.fillStyle = `rgba(190,220,255,${(1 - ph) * 0.8})`;
        x.beginPath(); x.ellipse(dx, dy0 + ph * ph * 60, 2.4, 3.6, 0, 0, 7); x.fill();
      }
    }
    const label = this.el.querySelector(".leafmeter-label") as HTMLElement;
    label.textContent = `${Math.round(v * 100)}%`;
    label.classList.toggle("low", v < 0.3);
  }
}
