// The HUD: millisecond timer, best time, a thin route bar with the districts, the layer
// you're in, district title cards, layer-drop and trick call-outs, and the start, death
// and planted screens. Integrity shows on the leaf itself, not here.

import type { CityData } from "../world/data";
import { isTouchDevice } from "./touch";
import type { Glider } from "../sim/glider";

const fmt = (t: number) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
};

export class Hud {
  private timer: HTMLElement;
  private best: HTMLElement;
  private marker: HTMLElement;
  private layer: HTMLElement;
  private card: HTMLElement;
  private callout: HTMLElement;
  private screen: HTMLElement;
  private toast: HTMLElement;
  private lastDistrict = "";
  private cardTimer = 0;
  private calloutTimer = 0;
  private toastTimer = 0;
  private lastBoost = -99;
  private lastTrick = -99;
  bestTime: number | null = null;

  constructor(root: HTMLElement, private city: CityData) {
    try { const b = localStorage.getItem("fftt.best"); this.bestTime = b ? Number(b) : null; } catch { /* storage blocked */ }
    const L = city.route.length;
    const segs = city.raw.districts.map((d, i, all) => {
      const a = d.s0 / L, b = (all[i + 1]?.s0 ?? L) / L;
      return `<div class="seg" style="left:${a * 100}%;width:${(b - a) * 100}%"><span>${d.name}</span></div>`;
    }).join("");
    root.innerHTML = `
      <div class="top"><div class="route">${segs}<div class="marker"></div></div></div>
      <div class="clock"><div class="time">0:00.000</div><div class="best"></div></div>
      <div class="status"><div class="layer">STREET</div></div>
      <div class="card"></div>
      <div class="callout"></div>
      <div class="toast"></div>
      <div class="screen"></div>
      <div class="keys"><span class="key">W</span><span class="key">S</span> dive / flare · <span class="key">A</span><span class="key">D</span> bank · <span class="key">SPACE</span> spread · <span class="key">SHIFT</span> curl · <span class="key">Q</span><span class="key">E</span> corkscrew · <span class="key">R</span> fall again</div>
      <div class="credit">${city.raw.meta.credit} Distant city and New Jersey: © OpenStreetMap contributors.</div>`;
    this.timer = root.querySelector(".time")!;
    this.best = root.querySelector(".best")!;
    this.marker = root.querySelector(".marker")!;
    this.layer = root.querySelector(".layer")!;
    this.card = root.querySelector(".card")!;
    this.callout = root.querySelector(".callout")!;
    this.toast = root.querySelector(".toast")!;
    this.screen = root.querySelector(".screen")!;
    this.showBest();
  }

  private showBest() { this.best.textContent = this.bestTime ? `best ${fmt(this.bestTime)}` : ""; }

  reset() {
    this.lastDistrict = "";
    this.screen.dataset.kind = "";
    this.screen.className = "screen";
    this.lastBoost = -99;
    this.lastTrick = -99;
  }

  /** A short message in the top centre (achievements, tutorial nudges). */
  notify(html: string, seconds = 3.5) {
    this.toast.innerHTML = html;
    this.toast.classList.add("show");
    this.toastTimer = seconds;
  }

  update(dt: number, leaf: Glider, progressS: number) {
    this.timer.textContent = fmt(leaf.time);
    this.marker.style.left = `${Math.min(100, (progressS / this.city.route.length) * 100)}%`;
    const names = { subway: "SUBWAY", street: "STREET", roof: "ROOFTOPS" } as const;
    this.layer.textContent = `${names[leaf.lane]} · ${Math.max(0, leaf.pos.y).toFixed(0)} m`;
    this.layer.dataset.layer = leaf.lane;

    const d = this.city.district(progressS);
    if (leaf.state === "flying" && d.name !== this.lastDistrict) {
      this.card.innerHTML = `<div class="name">${d.name}</div><div class="sub">${d.sub}</div>`;
      this.card.classList.add("show");
      this.cardTimer = 3.2;
      this.lastDistrict = d.name;
    }
    if (this.cardTimer > 0 && (this.cardTimer -= dt) <= 0) this.card.classList.remove("show");

    if (leaf.boost.t > this.lastBoost) {
      this.lastBoost = leaf.boost.t;
      this.callout.innerHTML = `${leaf.boost.kind} <b>+${leaf.boost.amount.toFixed(0)}</b>`;
      this.callout.classList.add("show");
      this.calloutTimer = 1.6;
    } else if (leaf.tricks.lastAt > this.lastTrick) {
      this.lastTrick = leaf.tricks.lastAt;
      this.callout.innerHTML = leaf.tricks.last === "loop" ? "Loop the loop" : "Corkscrew";
      this.callout.classList.add("show");
      this.calloutTimer = 1.2;
    }
    if (this.calloutTimer > 0 && (this.calloutTimer -= dt) <= 0) this.callout.classList.remove("show");
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toast.classList.remove("show");

    if (leaf.state === "attached") {
      this.setScreen("start", `<div class="title">Far From the Tree</div><div class="sub">Battery Park, late November. Every other leaf in the city has fallen.<br/>Ride the wind uptown and plant your seed in Central Park.</div><div class="cta">${isTouchDevice() ? "tap the screen" : "press any key"} to let go</div><button class="intro-again">▶ Watch the story</button>`);
    } else if (leaf.state === "dead") {
      this.setScreen("dead", `<div class="title small">${leaf.failure}</div><div class="sub">${fmt(leaf.time)} · ${((progressS / this.city.route.length) * 100).toFixed(0)}% of the way to the park</div><div class="cta">${document.body.classList.contains("is-touch") ? "tap ↻" : "R"} to fall again</div>`);
    } else if (leaf.state === "planted") {
      if (this.screen.dataset.kind !== "won") {
        const pb = this.bestTime === null || leaf.time < this.bestTime;
        if (pb) {
          this.bestTime = leaf.time;
          try { localStorage.setItem("fftt.best", String(leaf.time)); } catch { /* ignore */ }
          this.showBest();
        }
        this.setScreen("won", `<div class="title">Seed planted</div><div class="sub">${fmt(leaf.time)}${pb ? " · new best" : ""}<br/>Next spring, a tree.</div><div class="cta">${document.body.classList.contains("is-touch") ? "tap ↻" : "R"} to fall again</div>`);
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
