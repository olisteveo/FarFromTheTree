// Keyboard and gamepad. The leaf only ever changes its shape and angle: dive / flare,
// bank, spread, curl, and two tricks (corkscrew, loop). No thrust.

import type { LeafInput } from "../sim/glider";

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private lastS = -1;
  private padPrev: boolean[] = [];
  readonly state: LeafInput = { pitch: 0, roll: 0, spread: false, curl: false, corkscrew: 0, loop: false };
  anyKey = false;
  usingPad = false;

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this.anyKey = true;
      this.usingPad = false;
      if (e.code === "KeyS" || e.code === "ArrowDown") {
        const now = performance.now();
        if (now - this.lastS < 320) this.pressed.add("Loop");
        this.lastS = now;
      }
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  hit(code: string): boolean { return this.pressed.has(code); }
  held(code: string): boolean { return this.keys.has(code); }

  update(dt: number) {
    const k = (c: string) => this.keys.has(c);
    let pitch = (k("KeyW") || k("ArrowUp") ? 1 : 0) - (k("KeyS") || k("ArrowDown") ? 1 : 0);
    let roll = (k("KeyD") || k("ArrowRight") ? 1 : 0) - (k("KeyA") || k("ArrowLeft") ? 1 : 0);
    let spread = k("Space");
    let curl = k("ShiftLeft") || k("ShiftRight");
    let cork: -1 | 0 | 1 = this.hit("KeyQ") ? -1 : this.hit("KeyE") ? 1 : 0;
    let loop = this.hit("Loop");
    const pad = navigator.getGamepads?.().find((p) => p);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.14 ? 0 : v);
      const btn = (i: number) => !!pad.buttons[i]?.pressed;
      const edge = (i: number) => btn(i) && !this.padPrev[i];
      if (dz(pad.axes[1]) || dz(pad.axes[0])) { pitch = dz(pad.axes[1]); roll = dz(pad.axes[0]); this.usingPad = true; }
      spread ||= btn(0) || (pad.buttons[7]?.value ?? 0) > 0.3;
      curl ||= btn(1) || (pad.buttons[6]?.value ?? 0) > 0.3;
      if (edge(4)) cork = -1;
      if (edge(5)) cork = 1;
      if (edge(3)) loop = true;
      if (edge(9)) this.pressed.add("KeyR");
      if (pad.buttons.some((b) => b.pressed)) { this.anyKey = true; this.usingPad = true; }
      this.padPrev = pad.buttons.map((b) => b.pressed);
    }
    // keyboard is digital: ease it so the leaf doesn't snap
    const s = this.state;
    const ease = 1 - Math.exp(-dt * 10);
    s.pitch += (pitch - s.pitch) * ease;
    s.roll += (roll - s.roll) * ease;
    s.spread = spread;
    s.curl = curl;
    s.corkscrew = cork;
    s.loop = loop;
  }

  endFrame() {
    this.pressed.clear();
    this.anyKey = false;
  }
}
