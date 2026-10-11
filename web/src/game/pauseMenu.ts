// The pause menu: Esc / P (or the ⏸ button on screen) during a run. Resume, start again, back to the
// title screen, watch the story, and the settings: music and sound volumes (remembered). The game also pauses itself when the tab or app goes away.

export interface PauseHandlers {
  onRestart(): void;
  onTitle(): void;
  onStory(): void;
  /** the achievements gallery (opens over the menu; the game stays paused) */
  onAchievements(): void;
  setMusic(v: number): void;
  setSound(v: number): void;
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

    const saved = (key: string, d: number) => {
      try { const s = localStorage.getItem(key); const v = Number(s); return s !== null && isFinite(v) ? v : d; } catch { return d; }
    };
    const music = saved("fftt.music", 1), sound = saved("fftt.volume", 0.9);
    h.setMusic(music); h.setSound(sound);

    this.el = document.createElement("div");
    this.el.className = "pause-menu";
    this.el.innerHTML = `
      <div class="pause-card">
        <div class="pause-title">Paused</div>
        <button data-act="resume" class="primary">Resume</button>
        <button data-act="restart">Fall again</button>
        <button data-act="title">Back to the title</button>
        <button data-act="story">Watch the story</button>
        <button data-act="achievements">Achievements</button>
        <div class="pause-sub">Settings</div>
        <label class="pause-vol"><span>Music</span><input data-vol="music" type="range" min="0" max="1" step="0.05" value="${music}"/></label>
        <label class="pause-vol"><span>Sound</span><input data-vol="sound" type="range" min="0" max="1" step="0.05" value="${sound}"/></label>
        <div class="pause-hint">Esc to resume</div>
      </div>`;
    this.el.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.el.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest("button")?.dataset.act;
      if (!act) return;
      if (act === "achievements") { h.onAchievements(); return; }
      this.show(false);
      if (act === "restart") h.onRestart();
      else if (act === "title") h.onTitle();
      else if (act === "story") h.onStory();
    });
    for (const range of this.el.querySelectorAll<HTMLInputElement>("input[data-vol]")) {
      range.addEventListener("input", () => {
        const v = Number(range.value), music = range.dataset.vol === "music";
        (music ? h.setMusic : h.setSound)(v);
        try { localStorage.setItem(music ? "fftt.music" : "fftt.volume", String(v)); } catch { /* no storage */ }
      });
    }
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
