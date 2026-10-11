// The hit flash: every bump against something solid shows, harmless or not. A quick pale flash round the
// screen's edges, plus a little shake of the leaf meter; when the bump hurt, the flash is red and stronger.

const CSS = `
.hitflash { position: fixed; inset: 0; pointer-events: none; z-index: 5; opacity: 0;
  background: radial-gradient(ellipse at center, transparent 55%, var(--hf, rgba(255,245,230,0.55)) 100%); }
.leafmeter-shake { animation: leafmeter-shake 0.22s ease-out; }
@keyframes leafmeter-shake { 0% { transform: translate(0,0) } 25% { transform: translate(-3px,1px) rotate(-3deg) } 55% { transform: translate(3px,-1px) rotate(2deg) } 100% { transform: translate(0,0) } }
`;

export class HitFlash {
  private el: HTMLDivElement;
  private a = 0;
  private lastBumps = 0;
  private lastHp = 1;

  constructor(private meter?: HTMLElement | null) {
    const st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);
    this.el = document.createElement("div");
    this.el.className = "hitflash";
    document.body.appendChild(this.el);
  }

  reset() { this.lastBumps = 0; this.lastHp = 1; this.a = 0; this.el.style.opacity = "0"; }

  update(dt: number, leaf: { bumps: number; bumpK: number; integrity: number; state: string }) {
    if (leaf.bumps < this.lastBumps) this.lastBumps = leaf.bumps; // (a new run)
    const hurt = leaf.integrity < this.lastHp - 0.02;
    if (leaf.state === "flying" && (leaf.bumps > this.lastBumps || hurt)) {
      const k = hurt ? Math.min(1, 0.55 + (this.lastHp - leaf.integrity) * 3) : 0.25 + 0.4 * leaf.bumpK;
      this.el.style.setProperty("--hf", hurt ? "rgba(230,40,20,0.6)" : "rgba(255,245,230,0.5)");
      this.a = Math.max(this.a, k);
      if (this.meter) { this.meter.classList.remove("leafmeter-shake"); void this.meter.offsetWidth; this.meter.classList.add("leafmeter-shake"); }
    }
    this.lastBumps = leaf.bumps;
    this.lastHp = leaf.integrity;
    this.a = Math.max(0, this.a - dt * 4);
    this.el.style.opacity = this.a.toFixed(3);
  }
}
