// The pause menu: Esc / P (or the ⏸ button on screen) during a run. Resume, start again, watch the
// story, and the volume (remembered). The game also pauses itself when the tab or app goes away.

export interface PauseHandlers {
  onRestart(): void;
  onStory(): void;
  setVolume(v: number): void;
  /** opened or closed (the sound stops while it's open) */
  onShow(open: boolean): void;
}

export class PauseMenu {
  open = false;
  private el: HTMLDivElement;
  private button: HTMLButtonElement;

  constructor(root: HTMLElement, private h: PauseHandlers) {
    this.button = document.createElement("button");
    this.button.className = "pause-button";
    this.button.title = "pause (Esc)";
    this.button.textContent = "⏸";
    this.button.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); this.show(true); });
    root.appendChild(this.button);

    let vol = 0.9;
    try { const v = Number(localStorage.getItem("fftt.volume")); if (localStorage.getItem("fftt.volume") !== null && isFinite(v)) vol = v; } catch { /* no storage */ }
    h.setVolume(vol);

    this.el = document.createElement("div");
    this.el.className = "pause-menu";
    this.el.innerHTML = `
      <div class="pause-card">
        <div class="pause-title">Paused</div>
        <button data-act="resume" class="primary">Resume</button>
        <button data-act="restart">Fall again</button>
        <button data-act="story">Watch the story</button>
        <label class="pause-vol">Volume <input type="range" min="0" max="1" step="0.05" value="${vol}"/></label>
        <div class="pause-hint">Esc to resume</div>
      </div>`;
    this.el.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.el.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest("button")?.dataset.act;
      if (!act) return;
      this.show(false);
      if (act === "restart") h.onRestart();
      else if (act === "story") h.onStory();
    });
    const range = this.el.querySelector("input")!;
    range.addEventListener("input", () => {
      const v = Number(range.value);
      h.setVolume(v);
      try { localStorage.setItem("fftt.volume", String(v)); } catch { /* no storage */ }
    });
    root.appendChild(this.el);
  }

  show(on: boolean) {
    if (on !== this.open) this.h.onShow(on);
    this.open = on;
    this.el.classList.toggle("on", on);
  }

  /** the button only during a run */
  update(running: boolean) {
    this.button.classList.toggle("on", running && !this.open);
    if (!running && this.open) this.show(false);
  }
}
