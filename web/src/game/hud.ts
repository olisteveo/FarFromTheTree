// The HUD: run timer, route progress, the leaf's condition, which layer you're
// in, district title cards, and the start, fail and win screens. Plain DOM.

import { DISTRICTS, WORLD } from "../world/spec";
import type { Leaf, Telemetry } from "../sim/leaf";

const fmt = (t: number) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
};

export class Hud {

  private timer!: HTMLElement;
  private best!: HTMLElement;
  private marker!: HTMLElement;
  private layer!: HTMLElement;
  private leafBar!: HTMLElement;
  private card!: HTMLElement;
  private screen!: HTMLElement;
  private lastDistrict = "";
  private cardTimer = 0;
  private bestTime: number | null = null;

  constructor(root: HTMLElement) {

    try {
      const b = localStorage.getItem("fftt.best");
      this.bestTime = b ? Number(b) : null;
    } catch { /* storage blocked */ }
    const total = WORLD.goal.z - WORLD.start.z;
    const segs = DISTRICTS.map((d) => {
      const a = Math.max(0, (d.z0 - WORLD.start.z) / total), b = Math.min(1, (d.z1 - WORLD.start.z) / total);
      return `<div class="seg" style="left:${a * 100}%;width:${(b - a) * 100}%"><span>${d.name}</span></div>`;
    }).join("");
    root.innerHTML = `
      <div class="top">
        <div class="route">${segs}<div class="marker"></div></div>
      </div>
      <div class="clock"><div class="time">0:00.00</div><div class="best"></div></div>
      <div class="status">
        <div class="leafbar"><div class="fill"></div></div>
        <div class="layer">STREET</div>
      </div>
      <div class="card"></div>
      <div class="screen"></div>
      <div class="keys">W/S dive / flare · A/D bank · SPACE spread · SHIFT curl · R fall again · G tuning</div>`;
    this.timer = root.querySelector(".time")!;
    this.best = root.querySelector(".best")!;
    this.marker = root.querySelector(".marker")!;
    this.layer = root.querySelector(".layer")!;
    this.leafBar = root.querySelector(".leafbar .fill")!;
    this.card = root.querySelector(".card")!;
    this.screen = root.querySelector(".screen")!;
    this.showBest();
  }

  private showBest() {
    this.best.textContent = this.bestTime ? `best ${fmt(this.bestTime)}` : "";
  }

  reset() {
    this.lastDistrict = "";
    this.screen.className = "screen";
  }

  update(dt: number, leaf: Leaf, tm: Telemetry) {
    this.timer.textContent = fmt(leaf.time);
    this.marker.style.left = `${tm.progress * 100}%`;
    this.leafBar.style.width = `${leaf.integrity * 100}%`;
    this.leafBar.parentElement!.classList.toggle("low", leaf.integrity < 0.35);
    const names = { subway: "SUBWAY", street: "STREET", rooftop: "ROOFTOPS", sky: "OPEN SKY" } as const;
    this.layer.textContent = `${names[tm.layer]} · ${Math.max(0, tm.height).toFixed(0)} m`;
    this.layer.dataset.layer = tm.layer;

    if (leaf.state === "flying" && tm.district !== this.lastDistrict) {
      const d = DISTRICTS.find((x) => x.name === tm.district)!;
      this.card.innerHTML = `<div class="name">${d.name}</div><div class="sub">${d.subtitle}</div>`;
      this.card.classList.add("show");
      this.cardTimer = 3.2;
      this.lastDistrict = tm.district;
    }
    if (this.cardTimer > 0 && (this.cardTimer -= dt) <= 0) this.card.classList.remove("show");

    if (leaf.state === "attached") {
      this.setScreen("start", `<div class="title">Far From the Tree</div><div class="sub">Columbus Park, Chinatown. The last leaf on the old tree.<br/>Ride the wind uptown and plant your seed in Central Park.</div><div class="cta">press any key to let go</div>`);
    } else if (leaf.state === "dead") {
      this.setScreen("dead", `<div class="title small">${leaf.failure}</div><div class="sub">${fmt(leaf.time)} · ${(tm.progress * 100).toFixed(0)}% of the way</div><div class="cta">R to fall again</div>`);
    } else if (leaf.state === "planted") {
      if (this.screen.dataset.kind !== "won") {
        const pb = this.bestTime === null || leaf.time < this.bestTime;
        if (pb) {
          this.bestTime = leaf.time;
          try { localStorage.setItem("fftt.best", String(leaf.time)); } catch { /* ignore */ }
          this.showBest();
        }
        this.setScreen("won", `<div class="title">Seed planted</div><div class="sub">${fmt(leaf.time)}${pb ? " · new best" : ""}</div><div class="cta">R to fall again</div>`);
      }
    } else {
      this.setScreen("", "");
    }
  }

  private setScreen(kind: string, html: string) {
    if (this.screen.dataset.kind === kind) return;
    this.screen.dataset.kind = kind;
    this.screen.innerHTML = html;
    this.screen.className = kind ? `screen show ${kind}` : "screen";
  }
}
