// The achievements, as a pixel-art photo album. Opening it shows the closed album (worn leather, an
// embossed maple leaf, a "My Journey" label: public/achievements/album/cover.png); the cover swings open
// onto a two-page spread (one page at a time on a phone held upright). The inside cover keeps a pencilled
// tally ("7 of 27 snapshots"); after it, four slots a page. An earned achievement is its polaroid
// (public/achievements/<id>.png, from tools/achievements/snapshots.py) held down with photo corners at a
// slight tilt, its line pencilled underneath; a missing one is the faint outline of a photo, the corners
// still stuck down, with a cryptic hint pencilled in. Tap a photo to lift it up close.
//
// Pages turn with the arrows, a swipe, or the arrow keys; close with ✕, Esc or a tap outside the album.
// Only the pages on show are built (their photos load as they're turned to). While it's open it swallows
// keys and taps so the game behind never sees them. Opened from the pause menu and from a button it adds
// to the title screen (hud.ts draws that screen; the button is put in whenever it appears).
// Scoped CSS is injected once; mounted on body above the HUD, the touch controls and the pause menu.

import { ACHIEVEMENTS, type Achievement, type Achievements } from "./achievements";
import { snapshotUrl } from "./snapshotCard";
import { icon } from "./pixelIcons";

const ART = "./achievements/album/";
const PER_PAGE = 4;

const CSS = `
.alb { position: fixed; inset: 0; z-index: 18; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
  padding: calc(10px + env(safe-area-inset-top)) calc(10px + env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) calc(10px + env(safe-area-inset-left));
  background: rgba(10, 7, 5, 0.66); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; }
.alb.on { display: flex; }
.alb { --pw: min(calc((100vw - 40px) / 2), calc((100dvh - 110px) * 0.75), 400px); --ph: calc(var(--pw) * 4 / 3); }
.alb.single { --pw: min(calc(100vw - 28px), calc((100dvh - 110px) * 0.75), 400px); }
.alb-book { position: relative; width: calc(var(--pw) * 2); height: var(--ph); perspective: 2200px; transition: transform 0.7s cubic-bezier(0.3, 0.7, 0.3, 1); }
.alb.single .alb-book { width: var(--pw); }
.alb-book.closed { transform: translateX(calc(var(--pw) / -2)); }
.alb.single .alb-book.closed { transform: none; }
.alb-page { position: absolute; top: 0; width: var(--pw); height: var(--ph); overflow: hidden; background: #eee5ce url(${ART}paper.png) 0 0 / 160px 160px; image-rendering: pixelated;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); }
.alb-page.l { left: 0; border-radius: 6px 0 0 6px; }
.alb-page.r { left: var(--pw); border-radius: 0 6px 6px 0; }
.alb.single .alb-page.r { left: 0; border-radius: 6px; }
.alb-page.l::after { content: ""; position: absolute; inset: 0 0 0 auto; width: 26px; background: linear-gradient(90deg, transparent, rgba(80, 56, 30, 0.22)); pointer-events: none; }
.alb-page.r::after { content: ""; position: absolute; inset: 0 auto 0 0; width: 26px; background: linear-gradient(270deg, transparent, rgba(80, 56, 30, 0.26)); pointer-events: none; }
.alb.single .alb-page::after { display: none; }
.alb-page.blank { background: transparent; box-shadow: none; }
.alb-page.blank::after { display: none; }
.alb-flip { position: absolute; top: 0; width: var(--pw); height: var(--ph); transform-style: preserve-3d; z-index: 3; transition: transform 0.65s cubic-bezier(0.4, 0.1, 0.3, 1); }
.alb-flip.fwd { left: var(--pw); transform-origin: 0 50%; }
.alb-flip.back { left: 0; transform-origin: 100% 50%; }
.alb.single .alb-flip { left: 0; transition: transform 0.5s ease-in, opacity 0.5s ease-in; }
.alb-flip > .alb-page { left: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.alb-flip > .alb-page.backface { transform: rotateY(180deg); }
.alb-cover { background: #683e2a url(${ART}cover.png) 0 0 / 100% 100%; border-radius: 3px 8px 8px 3px; box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55); }
.alb-cover::after { display: none; }
/* the pages' contents */
.alb-in { position: absolute; inset: 0; padding: 7% 8% 6%; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 4% 7%; }
.alb-slot { position: relative; display: flex; flex-direction: column; align-items: center; min-height: 0; }
.alb-photo { position: relative; display: block; width: 100%; padding: 0; border: 0; background: none; cursor: zoom-in; transform: rotate(var(--tilt)); transition: transform 0.2s; }
.alb-photo:hover, .alb-photo:focus-visible { transform: rotate(var(--tilt)) translateY(-2px) scale(1.03); outline: none; }
.alb-photo img { display: block; width: 100%; aspect-ratio: 132 / 120; image-rendering: pixelated; }
.alb-empty { position: relative; width: 100%; aspect-ratio: 132 / 120; transform: rotate(var(--tilt)); border: 2px dashed rgba(96, 78, 58, 0.28); border-radius: 2px; display: grid; place-items: center; padding: 10%; text-align: center; }
.alb-c { position: absolute; width: 16px; height: 16px; background: url(${ART}corner.png) 0 0 / 100% 100%; image-rendering: pixelated; }
.alb-c.tl { left: -4px; top: -4px; }
.alb-c.tr { right: -4px; top: -4px; transform: rotate(90deg); }
.alb-c.br { right: -4px; bottom: -4px; transform: rotate(180deg); }
.alb-c.bl { left: -4px; bottom: -4px; transform: rotate(270deg); }
.alb-photo .alb-c { width: 18px; height: 18px; }
.alb-pencil { margin: 7px 2px 0; font: 12px/1.3 "Segoe Print", "Bradley Hand", "Noteworthy", "Chalkboard SE", "Comic Sans MS", cursive; color: #5c544c; text-align: center; transform: rotate(calc(var(--tilt) * -0.4)); }
.alb-empty .alb-pencil { margin: 0; color: rgba(92, 84, 76, 0.78); font-size: 11.5px; }
.alb-empty .alb-q { display: block; font: 700 22px/1 "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive; color: rgba(92, 84, 76, 0.4); margin-bottom: 4px; }
.alb-front { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 12%; text-align: center; color: #4c4640; font-family: "Segoe Print", "Bradley Hand", "Noteworthy", "Chalkboard SE", "Comic Sans MS", cursive; }
.alb-front h2 { margin: 0; font: 700 30px/1.1 "Segoe Print", "Bradley Hand", "Noteworthy", "Comic Sans MS", cursive; color: #2c3c78; transform: rotate(-3deg); }
.alb-front .alb-tally { font-size: 17px; }
.alb-front .alb-marks { font: 24px/1 "Segoe Print", "Comic Sans MS", cursive; letter-spacing: 1px; color: #6a625a; word-break: break-all; max-width: 90%; }
.alb-front .alb-note { font-size: 13px; color: #7a7066; }
.alb-pno { position: absolute; bottom: 2.5%; left: 0; right: 0; text-align: center; font: 11px "Segoe Print", "Comic Sans MS", cursive; color: rgba(92, 84, 76, 0.6); }
/* navigation and closing */
.alb-nav { display: flex; align-items: center; gap: 18px; color: #f2e8d2; font: 600 13px Inter, system-ui, sans-serif; letter-spacing: 0.06em; }
.alb-arrow { width: 48px; height: 48px; padding: 6px; border: 0; background: none; cursor: pointer; }
.alb-arrow img { width: 36px; height: 36px; image-rendering: pixelated; display: block; }
.alb-arrow.prev img { transform: scaleX(-1); }
.alb-arrow:disabled { opacity: 0.25; cursor: default; }
.alb-arrow:not(:disabled):hover img, .alb-arrow:focus-visible img { filter: brightness(1.15) drop-shadow(0 0 4px rgba(255, 200, 120, 0.6)); }
.alb-arrow:focus-visible { outline: none; }
.alb-x { position: absolute; top: calc(10px + env(safe-area-inset-top)); right: calc(10px + env(safe-area-inset-right)); width: 44px; height: 44px; display: grid; place-items: center;
  border: 3px solid #42281a; border-radius: 4px; background: #efe4c8; color: #42281a; cursor: pointer; box-shadow: 0 3px 0 #42281a; z-index: 5; }
.alb-x:hover, .alb-x:focus-visible { background: #ffd9a0; outline: none; }
.alb-x .px-icon { width: 24px; height: 24px; }
/* a photo lifted up close */
.alb-lift { position: absolute; inset: 0; z-index: 6; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 16px; background: rgba(10, 7, 5, 0.6); cursor: zoom-out; }
.alb-lift.on { display: flex; animation: alb-lift 0.25s ease-out; }
@keyframes alb-lift { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: none; } }
.alb-lift img { width: min(528px, 92vw, calc((100dvh - 140px) * 1.1)); image-rendering: pixelated; transform: rotate(-2deg); filter: drop-shadow(0 16px 30px rgba(0, 0, 0, 0.5)); }
.alb-lift p { max-width: min(460px, 90vw); margin: 0; padding: 8px 14px; background: #eee5ce url(${ART}paper.png) 0 0 / 160px 160px; color: #4c4640; transform: rotate(1deg);
  font: 14px/1.35 "Segoe Print", "Bradley Hand", "Noteworthy", "Comic Sans MS", cursive; text-align: center; box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35); }
.screen .ach-open { margin-top: 6px; padding: 8px 16px; border: 1px solid rgba(255, 240, 225, 0.35); border-radius: 999px; background: rgba(20, 10, 4, 0.45); color: #fff7ec;
  font: 600 13px Inter, system-ui, sans-serif; letter-spacing: 0.06em; cursor: pointer; pointer-events: auto; }
.screen .ach-open:hover { background: rgba(255, 176, 74, 0.25); }
body.is-touch .screen .ach-open { padding: 14px 26px; font-size: 15px; margin-top: 14px; }
body.is-touch .alb-pencil { font-size: 10.5px; }
body.is-touch .alb-empty .alb-pencil { font-size: 10px; }
@media (max-width: 380px) { .alb-pencil { font-size: 9.5px !important; } .alb-in { gap: 3% 6%; padding: 7% 6% 6%; } }
@media (prefers-reduced-motion: reduce) { .alb-flip, .alb-book { transition-duration: 0.01s !important; } }
`;

function injectCss() {
  if (document.getElementById("alb-css")) return;
  const s = document.createElement("style");
  s.id = "alb-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const corners = `<i class="alb-c tl"></i><i class="alb-c tr"></i><i class="alb-c br"></i><i class="alb-c bl"></i>`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AchievementGallery {
  open = false;
  /** opened or closed */
  onShow: (open: boolean) => void = () => {};
  private el: HTMLDivElement;
  private book: HTMLDivElement;
  private left: HTMLDivElement;
  private right: HTMLDivElement;
  private prev: HTMLButtonElement;
  private next: HTMLButtonElement;
  private label: HTMLElement;
  private lift: HTMLDivElement;
  private returnFocus: Element | null = null;
  /** the first page on show (the left one of a spread) */
  private page = 0;
  private turning = false;
  private single = false;
  private swipe: { x: number; y: number; id: number } | null = null;
  private swiped = false;

  constructor(private achievements: Achievements) {
    injectCss();
    this.el = document.createElement("div");
    this.el.className = "alb";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-modal", "true");
    this.el.setAttribute("aria-label", "Achievements: your photo album");
    this.el.innerHTML = `
      <button class="alb-x" aria-label="Close the album">${icon("close", 12, false)}</button>
      <div class="alb-book"><div class="alb-page l"></div><div class="alb-page r"></div></div>
      <div class="alb-nav"><button class="alb-arrow prev" aria-label="Previous page"><img src="${ART}arrow.png" alt=""/></button><span class="alb-label"></span><button class="alb-arrow next" aria-label="Next page"><img src="${ART}arrow.png" alt=""/></button></div>
      <div class="alb-lift" role="button" aria-label="Put the photo back"><img alt=""/><p></p></div>`;
    this.book = this.el.querySelector(".alb-book")!;
    this.left = this.el.querySelector(".alb-page.l")!;
    this.right = this.el.querySelector(".alb-page.r")!;
    this.prev = this.el.querySelector(".alb-arrow.prev")!;
    this.next = this.el.querySelector(".alb-arrow.next")!;
    this.label = this.el.querySelector(".alb-label")!;
    this.lift = this.el.querySelector(".alb-lift")!;

    // nothing in here reaches the game (the touch layer, the title screen's "tap to let go")
    for (const ev of ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "wheel"] as const) {
      this.el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    }
    // swipes turn pages
    this.el.addEventListener("pointerdown", (e) => { this.swipe = { x: e.clientX, y: e.clientY, id: e.pointerId }; this.swiped = false; });
    this.el.addEventListener("pointerup", (e) => {
      const s = this.swipe;
      this.swipe = null;
      if (!s || s.id !== e.pointerId || this.lift.classList.contains("on")) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) { this.swiped = true; setTimeout(() => (this.swiped = false), 350); void this.turn(dx < 0 ? 1 : -1); }
    });
    this.el.addEventListener("click", (e) => {
      if (this.swiped) { this.swiped = false; return; }
      const t = e.target as HTMLElement;
      if (this.lift.classList.contains("on")) { this.unlift(); return; }
      if (t.closest(".alb-x")) { this.show(false); return; }
      if (t.closest(".alb-arrow")) { void this.turn(t.closest(".alb-arrow.next") ? 1 : -1); return; }
      if (this.covered && t.closest(".alb-book")) { void this.turn(1); return; }
      const photo = t.closest<HTMLElement>(".alb-photo");
      if (photo?.dataset.id) { this.liftUp(photo.dataset.id); return; }
      if (!t.closest(".alb-book, .alb-nav")) this.show(false);   // a tap outside the album
    });
    // keys: arrows turn, Esc closes (a lifted photo first); none of them reach the game while it's open
    addEventListener("keydown", (e) => {
      if (!this.open) return;
      e.stopPropagation();
      if (e.code === "Escape") { e.preventDefault(); if (this.lift.classList.contains("on")) this.unlift(); else this.show(false); }
      else if (e.code === "ArrowRight" || e.code === "PageDown") { e.preventDefault(); void this.turn(1); }
      else if (e.code === "ArrowLeft" || e.code === "PageUp") { e.preventDefault(); void this.turn(-1); }
    }, true);
    addEventListener("resize", () => { if (this.open) this.layout(); });
    document.body.appendChild(this.el);
  }

  show(on: boolean) {
    if (on === this.open) return;
    this.open = on;
    if (on) {
      this.returnFocus = document.activeElement;
      this.el.classList.add("on");
      this.layout();
      void this.openCover();
      this.el.querySelector<HTMLElement>(".alb-x")!.focus({ preventScroll: true });
    } else {
      this.unlift();
      this.el.classList.remove("on");
      this.book.querySelector(".alb-flip")?.remove();
      this.turning = false;
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
        b.innerHTML = `${icon("camera")}Achievements`;
        const board = row.querySelector(".board-open");
        if (board) board.after(b); else row.appendChild(b);
      }
    };
    place();
    // hud.ts redraws its .screen (innerHTML) when the screen changes: watch just that
    const screen = document.querySelector("#hud .screen");
    new MutationObserver(place).observe(screen ?? document.body, { childList: true, subtree: !screen });
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

  // ------------------------------------------------------------------ pages
  private get pageCount() { return 1 + Math.ceil(ACHIEVEMENTS.length / PER_PAGE); }

  private layout() {
    this.single = innerWidth < 700 && innerHeight > innerWidth * 1.05;
    this.el.classList.toggle("single", this.single);
    if (!this.single) this.page -= this.page % 2;
    if (this.covered && !this.turning) void this.openCover(); // (re-laid for the new shape, still shut)
    else if (!this.turning && !this.book.classList.contains("closed")) this.render();
  }

  private pageHtml(i: number): string {
    if (i === 0) {
      const got = ACHIEVEMENTS.filter((a) => this.achievements.has(a.id)).length;
      const tally = Array.from({ length: Math.floor(got / 5) }, () => "<s>||||</s>").join(" ") + (got % 5 ? " " + "|".repeat(got % 5) : "");
      return `<div class="alb-front"><h2>My Journey</h2>
        <div class="alb-tally">${got} of ${ACHIEVEMENTS.length} snapshots</div><div class="alb-marks" aria-hidden="true">${tally || "&nbsp;"}</div>
        <div class="alb-note">Battery Park to Central Park,<br/>one leaf, late November</div></div>`;
    }
    if (i >= this.pageCount) return "";
    const list = ACHIEVEMENTS.slice((i - 1) * PER_PAGE, i * PER_PAGE);
    return `<div class="alb-in">${list.map((a, k) => this.slot(a, (i * PER_PAGE + k) % 2 ? 2.4 : -2.2)).join("")}</div><div class="alb-pno">${i + 1}</div>`;
  }

  private slot(a: Achievement, tilt: number) {
    if (!this.achievements.has(a.id)) {
      return `<div class="alb-slot" style="--tilt:${tilt}deg"><div class="alb-empty">${corners}<div><span class="alb-q">?</span><p class="alb-pencil">${esc(a.hint)}</p></div></div></div>`;
    }
    return `<div class="alb-slot" style="--tilt:${tilt}deg"><button class="alb-photo" data-id="${a.id}" aria-label="${esc(a.name)}: lift the photo"><img src="${snapshotUrl(a.id)}" alt="${esc(a.name)}" decoding="async"/>${corners}</button><p class="alb-pencil">${esc(a.desc)}</p></div>`;
  }

  private fill(el: HTMLElement, i: number) {
    const blank = i < 0 || i >= this.pageCount;
    el.classList.toggle("blank", blank);
    el.innerHTML = blank ? "" : this.pageHtml(i);
  }

  private render() {
    if (this.single) {
      this.left.style.display = "none";
      this.fill(this.right, this.page);
    } else {
      this.left.style.display = "";
      this.fill(this.left, this.page);
      this.fill(this.right, this.page + 1);
    }
    const step = this.single ? 1 : 2;
    this.prev.disabled = false; // (from the first pages it shuts the album again)
    this.next.disabled = this.page + step >= this.pageCount;
    const n = this.single ? `page ${this.page + 1} of ${this.pageCount}` : `pages ${this.page + 1}–${Math.min(this.page + 2, this.pageCount)} of ${this.pageCount}`;
    this.label.textContent = this.page === 0 ? "My Journey" : n;
    // warm up the next pages' photos
    for (let i = this.page + step; i < this.page + step * 2 && i < this.pageCount; i++) {
      for (const a of ACHIEVEMENTS.slice((i - 1) * PER_PAGE, i * PER_PAGE)) if (i > 0 && this.achievements.has(a.id)) new Image().src = snapshotUrl(a.id);
    }
  }

  private flipper(cls: "fwd" | "back", front: string, back: string, frontClass = "") {
    const f = document.createElement("div");
    f.className = `alb-flip ${cls}`;
    f.innerHTML = `<div class="alb-page ${frontClass}">${front}</div><div class="alb-page backface">${back}</div>`;
    this.book.appendChild(f);
    void f.offsetWidth;
    return f;
  }

  /** the closed album: it waits on its cover until you open it (next, a swipe, a tap on the cover) */
  private covered = false;
  private coverFlip: HTMLElement | null = null;
  private async openCover() {
    this.turning = true;
    this.page = 0;
    this.covered = true;
    this.book.classList.add("closed");
    this.coverFlip?.remove();
    if (this.single) {
      this.left.style.display = "none";
      this.fill(this.right, 0);
      this.coverFlip = this.flipper("fwd", "", "", "alb-cover");
    } else {
      this.left.style.display = "";
      this.fill(this.left, -1);
      this.fill(this.right, 1);
      this.coverFlip = this.flipper("fwd", "", this.pageHtml(0), "alb-cover");
    }
    this.prev.disabled = true;
    this.next.disabled = false;
    this.label.textContent = "Open the album";
    this.turning = false;
  }

  /** the cover swings open onto the inside cover and the first page */
  private async swingOpen() {
    const f = this.coverFlip;
    if (!f) return;
    this.turning = true;
    this.covered = false;
    this.coverFlip = null;
    if (this.single) {
      this.render();
      f.style.transform = "rotateY(-100deg)"; f.style.opacity = "0";
      this.book.classList.remove("closed");
      await wait(520);
      f.remove();
    } else {
      f.style.transform = "rotateY(-180deg)";
      this.book.classList.remove("closed");
      await wait(680);
      f.remove();
      this.render();
    }
    this.turning = false;
  }

  private async turn(dir: 1 | -1) {
    if (this.turning || this.lift.classList.contains("on")) return;
    if (this.covered) { if (dir > 0) await this.swingOpen(); return; }
    const step = this.single ? 1 : 2;
    const to = this.page + dir * step;
    if (to < 0) { await this.openCover(); return; } // (back from the first pages: shut it again)
    if (to >= this.pageCount) return;
    this.turning = true;
    if (this.single) {
      const old = this.pageHtml(this.page);
      this.page = to;
      this.render();
      const f = this.flipper(dir > 0 ? "fwd" : "back", old, "");
      f.style.transformOrigin = dir > 0 ? "0 50%" : "100% 50%";
      f.style.transform = `rotateY(${dir > 0 ? -100 : 100}deg)`; f.style.opacity = "0";
      await wait(500);
      f.remove();
    } else if (dir > 0) {
      // the right page turns over onto the left: underneath, the next spread's right page
      const oldRight = this.pageHtml(this.page + 1), newLeft = this.pageHtml(to);
      this.fill(this.right, to + 1);
      const f = this.flipper("fwd", oldRight, newLeft);
      f.style.transform = "rotateY(-180deg)";
      await wait(660);
      this.page = to;
      this.render();
      f.remove();
    } else {
      const oldLeft = this.pageHtml(this.page), newRight = this.pageHtml(to + 1);
      this.fill(this.left, to);
      const f = this.flipper("back", oldLeft, newRight);
      f.style.transform = "rotateY(180deg)";
      await wait(660);
      this.page = to;
      this.render();
      f.remove();
    }
    this.turning = false;
  }

  // ------------------------------------------------------------------ a photo, lifted up close
  private liftUp(id: string) {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    this.lift.querySelector("img")!.src = snapshotUrl(a.id);
    this.lift.querySelector("img")!.alt = a.name;
    this.lift.querySelector("p")!.textContent = a.desc;
    this.lift.classList.add("on");
  }

  private unlift() { this.lift.classList.remove("on"); }
}
