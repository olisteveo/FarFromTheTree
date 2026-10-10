// Touch controls for phones and tablets: a floating stick under the left thumb (push up to
// dive, pull back to flare, left/right to bank) and buttons under the right thumb: SPREAD
// and CURL (hold), the two corkscrews and the loop (tap), and restart. Feeds Input.

import type { Input } from "./input";

export const isTouchDevice = () => matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;

export class TouchControls {
  readonly el: HTMLElement;
  private stickId: number | null = null;
  private ox = 0; private oy = 0;
  private base: HTMLElement; private knob: HTMLElement;
  private R = 64;

  constructor(root: HTMLElement, private input: Input) {
    this.el = document.createElement("div");
    this.el.className = "touch";
    this.el.innerHTML = `
      <div class="touch-stick-zone"></div>
      <div class="touch-stick"><div class="touch-knob"></div></div>
      <div class="touch-buttons">
        <button data-hold="spread" class="big">SPREAD</button>
        <button data-hold="curl" class="big">CURL</button>
        <button data-tap="KeyQ" title="corkscrew left">⟲</button>
        <button data-tap="Loop" title="loop the loop">LOOP</button>
        <button data-tap="KeyE" title="corkscrew right">⟳</button>
      </div>
      <button class="touch-restart" data-tap="KeyR" title="fall again">↻</button>`;
    root.appendChild(this.el);
    this.base = this.el.querySelector(".touch-stick")!;
    this.knob = this.el.querySelector(".touch-knob")!;
    const zone = this.el.querySelector(".touch-stick-zone") as HTMLElement;

    // the stick lives just below the leaf (so your thumb never covers it); touch anywhere in the
    // lower part of the screen and it's measured from there
    const home = () => { this.ox = innerWidth / 2; this.oy = innerHeight * 0.84; this.base.style.left = `${this.ox}px`; this.base.style.top = `${this.oy}px`; };
    home();
    addEventListener("resize", home);
    zone.addEventListener("pointerdown", (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      home();
      this.base.classList.add("on");
      this.move(e.clientX, e.clientY);
      input.touchStart();
    });
    zone.addEventListener("pointermove", (e) => { if (e.pointerId === this.stickId) this.move(e.clientX, e.clientY); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.base.classList.remove("on");
      input.touch.pitch = 0; input.touch.roll = 0;
      this.knob.style.transform = "translate(-50%, -50%)";
    };
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);

    for (const b of this.el.querySelectorAll<HTMLButtonElement>("button")) {
      const hold = b.dataset.hold as "spread" | "curl" | undefined, tap = b.dataset.tap;
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add("down");
        input.touchStart();
        if (hold) input.touch[hold] = true;
        if (tap) input.tap(tap);
      });
      const up = () => { b.classList.remove("down"); if (hold) input.touch[hold] = false; };
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      b.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    // anywhere else: a tap starts the run (let go of the tree)
    root.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") input.touchStart(); });
  }

  private move(x: number, y: number) {
    let dx = x - this.ox, dy = y - this.oy;
    const d = Math.hypot(dx, dy);
    if (d > this.R) { dx *= this.R / d; dy *= this.R / d; }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // a little dead zone, then a gentle curve so small thumb moves are fine control
    const f = (v: number) => { const a = Math.max(0, Math.abs(v) - 0.12) / 0.88; return Math.sign(v) * a * a * (3 - 2 * a); };
    this.input.touch.roll = f(dx / this.R);
    this.input.touch.pitch = f(-dy / this.R); // push up: dive (like W)
  }

  /** Hide while a menu (the leaderboard form) needs the screen. */
  show(on: boolean, title = false) { this.el.classList.toggle("hidden", !on); this.el.classList.toggle("title", title); }
}
