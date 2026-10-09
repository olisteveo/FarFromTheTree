// The first-flight tutorial in Battery Park: one short lesson at a time, each waiting
// for you to actually do the thing. Skippable with T, shown on the first run only
// (or when asked for with ?tutorial=1). Knowledge beyond this is learned by dying.

import type { Glider, LeafInput } from "../sim/glider";

interface Step {
  html: string;
  /** done when this returns true (or after `hold` seconds for info steps) */
  done?: (s: Tracker) => boolean;
  hold?: number;
}

interface Tracker { roll: number; dive: number; flare: number; spread: number; curl: number; t: number }

const key = (k: string) => `<span class="key">${k}</span>`;

const STEPS: Step[] = [
  { html: `${key("A")} ${key("D")} bank to turn. The leaf glides where it's pointed, and the wind carries it.`, done: (s) => s.roll > 1.2 },
  { html: `${key("W")} dives: height becomes speed. ${key("S")} flares: speed becomes height.`, done: (s) => s.dive > 0.6 && s.flare > 0.6 },
  { html: `Hold ${key("SPACE")} to spread out and float. Hold ${key("SHIFT")} to curl up and drop fast.`, done: (s) => s.spread > 0.6 && s.curl > 0.4 },
  { html: `Read the wind: <b class="gold">gold</b> streaks carry you uptown, <b class="blue">blue</b> blow against you, <b>white</b> lift you.`, hold: 6 },
  { html: `Steam vents and walls facing the wind lift you. Stay off the ground: puddles, open manholes and cabs end runs.`, hold: 6 },
  { html: `Three ways uptown: the <b>rooftops</b> (slow, safe), the <b>street</b>, or dive down a <b class="green">subway</b> entrance (fastest, deadliest).<br/>Dropping a layer gives you a burst of speed.`, hold: 8 },
  { html: `${key("Q")} ${key("E")} corkscrew through gaps. Double-tap ${key("S")} to loop. ${key("R")} falls again. Good luck.`, hold: 5 },
];

/** On a touch screen, talk about the thumb stick and buttons instead of keys. */
export function useTouchWording() {
  const b = (t: string) => `<span class="key">${t}</span>`;
  STEPS[0].html = `Move your left thumb left and right to bank. The leaf glides where it's pointed, and the wind carries it.`;
  STEPS[1].html = `Push the stick up to dive: height becomes speed. Pull it down to flare: speed becomes height.`;
  STEPS[2].html = `Hold ${b("SPREAD")} to spread out and float. Hold ${b("CURL")} to curl up and drop fast.`;
  STEPS[6].html = `${b("⟲")} ${b("⟳")} corkscrew through gaps, ${b("LOOP")} to loop. ${b("↻")} falls again. Good luck.`;
}

export class Tutorial {
  private el: HTMLElement;
  private i = 0;
  private stepT = 0;
  private tr: Tracker = { roll: 0, dive: 0, flare: 0, spread: 0, curl: 0, t: 0 };
  active: boolean;

  constructor(root: HTMLElement, force: boolean) {
    let seen = false;
    try { seen = localStorage.getItem("fftt.tutorial") === "done"; } catch { /* ignore */ }
    this.active = force || !seen;
    this.el = document.createElement("div");
    this.el.className = "tutorial";
    root.appendChild(this.el);
  }

  reset() { this.i = 0; this.stepT = 0; this.tr = { roll: 0, dive: 0, flare: 0, spread: 0, curl: 0, t: 0 }; }

  skip() { this.active = false; this.finish(); }

  private finish() {
    this.el.classList.remove("show");
    try { localStorage.setItem("fftt.tutorial", "done"); } catch { /* ignore */ }
  }

  update(dt: number, leaf: Glider, input: LeafInput) {
    if (!this.active || leaf.state !== "flying") { this.el.classList.remove("show"); return; }
    const s = this.tr;
    if (Math.abs(input.roll) > 0.5) s.roll += dt;
    if (input.pitch > 0.5) s.dive += dt;
    if (input.pitch < -0.5) s.flare += dt;
    if (input.spread) s.spread += dt;
    if (input.curl) s.curl += dt;
    this.stepT += dt;
    const step = STEPS[this.i];
    const ok = step.done ? step.done(s) && this.stepT > 1.2 : this.stepT > (step.hold ?? 5);
    if (ok) {
      this.i++;
      this.stepT = 0;
      if (this.i >= STEPS.length) { this.active = false; this.finish(); return; }
    }
    const cur = STEPS[this.i];
    if (this.el.dataset.i !== String(this.i)) {
      this.el.dataset.i = String(this.i);
      this.el.innerHTML = `<div class="step">${this.i + 1} / ${STEPS.length}</div><div class="text">${cur.html}</div><div class="skip">${key("T")} skip</div>`;
    }
    this.el.classList.add("show");
  }
}
