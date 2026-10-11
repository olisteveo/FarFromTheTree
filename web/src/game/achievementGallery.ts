// The achievements gallery: every achievement in a grid. Earned ones show their snapshot (the landmark
// landings, public/achievements/<id>.png) or an icon, with the pun and its line; locked ones are a dimmed
// "?" with a cryptic hint. Tap an earned snapshot to see it bigger. Opened from the pause menu and from
// a button this module adds to the title screen (next to the leaderboard's: hud.ts draws that screen,
// so the button is put in whenever it appears). Close with ✕, a tap outside or Esc. While it's open it
// swallows keys and taps so the game behind never sees them (no letting go of the tree by accident).
// Scoped CSS is injected once; mounted on body above the HUD, the touch controls and the pause menu.

import { ACHIEVEMENTS, type Achievement, type Achievements } from "./achievements";
import { snapshotUrl } from "./snapshotCard";

const CSS = `
.achg { position: fixed; inset: 0; z-index: 18; display: none; place-items: center; padding: calc(12px + env(safe-area-inset-top)) calc(12px + env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) calc(12px + env(safe-area-inset-left));
  background: rgba(8, 6, 4, 0.6); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); pointer-events: auto; touch-action: manipulation; }
.achg.on { display: grid; }
.achg-panel { position: relative; width: min(780px, 100%); max-height: 100%; display: flex; flex-direction: column; border-radius: 14px; background: rgba(28, 18, 10, 0.94);
  border: 1px solid rgba(255, 240, 225, 0.18); box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5); color: #fff7ec; overflow: hidden; }
.achg-head { display: flex; align-items: baseline; gap: 12px; padding: 18px 56px 12px 22px; border-bottom: 1px solid rgba(255, 240, 225, 0.1); }
.achg-title { font: 800 26px/1 Fraunces, Georgia, serif; }
.achg-count { font: 700 13px/1 Inter, system-ui, sans-serif; letter-spacing: 0.08em; color: #ffb04a; }
.achg-bar { flex: 1; height: 4px; align-self: center; border-radius: 2px; background: rgba(255, 240, 225, 0.12); overflow: hidden; }
.achg-bar i { display: block; height: 100%; background: #ffb04a; }
.achg-x { position: absolute; top: 10px; right: 10px; width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255, 240, 225, 0.3); background: rgba(255, 255, 255, 0.05);
  color: #fff7ec; font: 600 17px/1 Inter, system-ui, sans-serif; cursor: pointer; }
.achg-x:hover, .achg-x:focus-visible { background: rgba(255, 176, 74, 0.25); outline: none; }
.achg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; padding: 16px 18px 20px; overflow: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.achg-item { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 10px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 240, 225, 0.08); text-align: left; color: inherit; font: inherit; }
button.achg-item { cursor: zoom-in; }
button.achg-item:hover, button.achg-item:focus-visible { background: rgba(255, 176, 74, 0.14); border-color: rgba(255, 176, 74, 0.5); outline: none; }
.achg-pic { aspect-ratio: 4 / 3; border-radius: 4px; display: grid; place-items: center; overflow: hidden; background: rgba(255, 240, 225, 0.06); font-size: 34px; line-height: 1; }
.achg-pic img { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
.achg-snap .achg-pic { background: #f6f2ea; padding: 4px; }
.achg-name { font: italic 700 14px/1.2 Fraunces, Georgia, serif; }
.achg-desc { font: 11.5px/1.35 Inter, system-ui, sans-serif; color: rgba(255, 240, 225, 0.72); }
.achg-locked { opacity: 0.55; }
.achg-locked .achg-pic { font: 800 30px/1 Fraunces, Georgia, serif; color: rgba(255, 240, 225, 0.45); background: repeating-linear-gradient(45deg, rgba(255, 240, 225, 0.05) 0 6px, rgba(255, 240, 225, 0.02) 6px 12px); }
.achg-locked .achg-desc { font-style: italic; }
.achg-zoom { position: absolute; inset: 0; display: none; place-items: center; padding: 16px; background: rgba(8, 6, 4, 0.72); cursor: zoom-out; }
.achg-zoom.on { display: grid; }
.achg-polaroid { width: min(540px, 92vw, calc((100dvh - 150px) * 4 / 3)); padding: 12px 12px 16px; border-radius: 3px; background: #f6f2ea; color: #2a2018; transform: rotate(-1.5deg); box-shadow: 0 14px 40px rgba(0, 0, 0, 0.55); }
.achg-polaroid img { display: block; width: 100%; aspect-ratio: 4 / 3; image-rendering: pixelated; }
.achg-polaroid .achg-name { margin-top: 10px; font-size: 22px; }
.achg-polaroid .achg-desc { margin-top: 4px; font-size: 13.5px; color: #5a4c40; }
body.is-touch .achg-grid { grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 9px; padding: 12px; }
body.is-touch .achg-head { padding: 14px 56px 10px 16px; }
body.is-touch .achg-title { font-size: 21px; }
body.is-touch .achg-desc { font-size: 10.5px; }
body.is-touch .achg-x { width: 44px; height: 44px; top: 8px; right: 8px; }
.screen .ach-open { margin-top: 6px; padding: 8px 16px; border: 1px solid rgba(255, 240, 225, 0.35); border-radius: 999px; background: rgba(20, 10, 4, 0.45); color: #fff7ec;
  font: 600 13px Inter, system-ui, sans-serif; letter-spacing: 0.06em; cursor: pointer; pointer-events: auto; }
.screen .ach-open:hover { background: rgba(255, 176, 74, 0.25); }
body.is-touch .screen .ach-open { padding: 14px 26px; font-size: 15px; margin-top: 14px; }
`;

function injectCss() {
  if (document.getElementById("achg-css")) return;
  const s = document.createElement("style");
  s.id = "achg-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export class AchievementGallery {
  open = false;
  /** opened or closed */
  onShow: (open: boolean) => void = () => {};
  private el: HTMLDivElement;
  private grid: HTMLDivElement;
  private zoom: HTMLDivElement;
  private count: HTMLElement;
  private bar: HTMLElement;
  private returnFocus: Element | null = null;

  constructor(private achievements: Achievements) {
    injectCss();
    this.el = document.createElement("div");
    this.el.className = "achg";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-modal", "true");
    this.el.setAttribute("aria-label", "Achievements");
    this.el.innerHTML = `
      <div class="achg-panel">
        <div class="achg-head"><div class="achg-title">Achievements</div><div class="achg-count"></div><div class="achg-bar"><i></i></div></div>
        <button class="achg-x" aria-label="Close">✕</button>
        <div class="achg-grid"></div>
        <div class="achg-zoom" role="button" aria-label="Close the snapshot"><div class="achg-polaroid"><img alt=""/><div class="achg-name"></div><div class="achg-desc"></div></div></div>
      </div>`;
    this.grid = this.el.querySelector(".achg-grid")!;
    this.zoom = this.el.querySelector(".achg-zoom")!;
    this.count = this.el.querySelector(".achg-count")!;
    this.bar = this.el.querySelector(".achg-bar i")!;
    // nothing in here reaches the game (the touch layer, the title screen's "tap to let go")
    for (const ev of ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "wheel"] as const) {
      this.el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    }
    this.el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (this.zoom.classList.contains("on")) { if (t.closest(".achg-zoom")) this.unzoom(); return; }
      if (t.closest(".achg-x") || !t.closest(".achg-panel")) { this.show(false); return; }
      const item = t.closest<HTMLElement>("button.achg-item");
      if (item?.dataset.id) this.zoomTo(item.dataset.id);
    });
    // keys: Esc closes (the snapshot first); none of them reach the game while it's open
    addEventListener("keydown", (e) => {
      if (!this.open) return;
      e.stopPropagation();
      if (e.code === "Escape") { e.preventDefault(); if (this.zoom.classList.contains("on")) this.unzoom(); else this.show(false); }
    }, true);
    document.body.appendChild(this.el);
  }

  show(on: boolean) {
    if (on === this.open) return;
    this.open = on;
    if (on) {
      this.render();
      this.returnFocus = document.activeElement;
      this.el.classList.add("on");
      this.el.querySelector<HTMLElement>(".achg-x")!.focus({ preventScroll: true });
    } else {
      this.unzoom();
      this.el.classList.remove("on");
      (this.returnFocus as HTMLElement | null)?.focus?.({ preventScroll: true });
    }
    this.onShow(on);
  }

  /** put an "Achievements" button on the title screen next to the leaderboard's, whenever hud.ts draws it */
  addTitleButton() {
    const place = () => {
      for (const row of document.querySelectorAll(".title-buttons")) {
        if (row.querySelector(".ach-open")) continue;
        const b = document.createElement("button");
        b.className = "ach-open";
        b.textContent = "🍂 Achievements";
        const board = row.querySelector(".board-open");
        if (board) board.after(b); else row.appendChild(b);
      }
    };
    place();
    // hud.ts redraws its .screen (innerHTML) when the screen changes: watch just that
    new MutationObserver(place).observe(document.querySelector("#hud .screen") ?? document.body, { childList: true, subtree: !document.querySelector("#hud .screen") });
    // caught before the title screen can count the tap (or Enter on the focused button) as letting go
    addEventListener("pointerdown", (e) => {
      if (!(e.target as HTMLElement | null)?.closest?.(".ach-open")) return;
      e.stopPropagation(); e.preventDefault();
      this.show(true);
    }, true);
    addEventListener("keydown", (e) => {
      if (this.open || (e.code !== "Enter" && e.code !== "Space") || !(e.target as HTMLElement | null)?.closest?.(".ach-open")) return;
      e.stopPropagation(); e.preventDefault();
      this.show(true);
    }, true);
  }

  private render() {
    const got = ACHIEVEMENTS.filter((a) => this.achievements.has(a.id)).length;
    this.count.textContent = `${got} / ${ACHIEVEMENTS.length}`;
    this.bar.style.width = `${(got / ACHIEVEMENTS.length) * 100}%`;
    this.grid.innerHTML = ACHIEVEMENTS.map((a) => this.item(a)).join("");
  }

  private item(a: Achievement) {
    if (!this.achievements.has(a.id)) {
      return `<div class="achg-item achg-locked"><div class="achg-pic" aria-hidden="true">?</div><div class="achg-name">???</div><div class="achg-desc">${esc(a.hint)}</div></div>`;
    }
    if (a.snap) {
      return `<button class="achg-item achg-snap" data-id="${a.id}" aria-label="${esc(a.name)}: see the snapshot"><div class="achg-pic"><img src="${snapshotUrl(a.id)}" alt="" loading="lazy" decoding="async"/></div><div class="achg-name">${esc(a.name)}</div><div class="achg-desc">${esc(a.desc)}</div></button>`;
    }
    return `<div class="achg-item"><div class="achg-pic" aria-hidden="true">${a.icon}</div><div class="achg-name">${esc(a.name)}</div><div class="achg-desc">${esc(a.desc)}</div></div>`;
  }

  private zoomTo(id: string) {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    this.zoom.querySelector("img")!.src = snapshotUrl(a.id);
    this.zoom.querySelector(".achg-name")!.textContent = a.name;
    this.zoom.querySelector(".achg-desc")!.textContent = a.desc;
    this.zoom.classList.add("on");
  }

  private unzoom() { this.zoom.classList.remove("on"); }
}
