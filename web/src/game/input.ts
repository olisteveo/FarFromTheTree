// Keyboard and gamepad. The leaf only ever tilts: pitch, bank, spread, curl.

import type { LeafInput } from "../sim/leaf";

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  readonly state: LeafInput = { pitch: 0, roll: 0, spread: false, curl: false };
  anyKey = false;

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this.anyKey = true;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  /** True once per key press. */
  hit(code: string): boolean {
    return this.pressed.has(code);
  }

  update(dt: number) {
    const k = (c: string) => this.keys.has(c);
    let pitch = (k("KeyW") || k("ArrowUp") ? 1 : 0) - (k("KeyS") || k("ArrowDown") ? 1 : 0);
    let roll = (k("KeyD") || k("ArrowRight") ? 1 : 0) - (k("KeyA") || k("ArrowLeft") ? 1 : 0);
    let spread = k("Space");
    let curl = k("ShiftLeft") || k("ShiftRight");
    const pad = navigator.getGamepads?.().find((p) => p);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
      if (dz(pad.axes[1]) || dz(pad.axes[0])) {
        pitch = -dz(pad.axes[1]);
        roll = dz(pad.axes[0]);
      }
      spread ||= pad.buttons[0]?.pressed || (pad.buttons[7]?.value ?? 0) > 0.3;
      curl ||= pad.buttons[1]?.pressed || (pad.buttons[6]?.value ?? 0) > 0.3;
      if (pad.buttons.some((b) => b.pressed)) this.anyKey = true;
      if (pad.buttons[3]?.pressed) this.pressed.add("KeyR");
    }
    // keyboard is digital: ease it so the leaf doesn't snap
    const s = this.state;
    const ease = 1 - Math.exp(-dt * 9);
    s.pitch += (pitch - s.pitch) * ease;
    s.roll += (roll - s.roll) * ease;
    s.spread = spread;
    s.curl = curl;
  }

  endFrame() {
    this.pressed.clear();
    this.anyKey = false;
  }
}
