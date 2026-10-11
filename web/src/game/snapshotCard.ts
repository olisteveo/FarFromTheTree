// The snapshot card: landing on a landmark (achievements with snap: true) "takes a photo". A polaroid
// slides in at the top right with the pixel-art snapshot (public/achievements/<id>.png, drawn by
// tools/achievements/snapshots.py), the pun and its line; a shutter flash, then after ~4.5 s it slides
// away. Several at once queue up. It never takes a tap (pointer-events: none), keeps out of the middle
// of the screen and inside the safe area on phones. Scoped CSS is injected once; mounted on body.

import type { Achievement } from "./achievements";

export const snapshotUrl = (id: string) => `./achievements/${id}.png`;

const CSS = `
.snapcard-flash { position: fixed; inset: 0; z-index: 30; pointer-events: none; background: #fff; opacity: 0; }
.snapcard-flash.go { animation: snapcard-flash 0.45s ease-out; }
@keyframes snapcard-flash { 0% { opacity: 0.32; } 100% { opacity: 0; } }
.snapcard { position: fixed; z-index: 30; pointer-events: none; top: calc(18px + env(safe-area-inset-top)); right: calc(18px + env(safe-area-inset-right));
  width: 212px; padding: 9px 9px 12px; border-radius: 3px; background: #f6f2ea; color: #2a2018;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.6) inset;
  transform: translateX(calc(100% + 40px)) rotate(6deg); opacity: 0;
  transition: transform 0.55s cubic-bezier(0.2, 0.9, 0.25, 1.15), opacity 0.35s; }
.snapcard.on { transform: translateX(0) rotate(2.5deg); opacity: 1; }
.snapcard.off { transform: translateX(calc(100% + 40px)) rotate(8deg); opacity: 0; transition: transform 0.5s ease-in, opacity 0.5s ease-in; }
.snapcard-photo { position: relative; aspect-ratio: 4 / 3; background: #9aa6b6; overflow: hidden; }
.snapcard-photo img { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
.snapcard-photo::after { content: ""; position: absolute; inset: 0; background: #fff; opacity: 0; }
.snapcard.on .snapcard-photo::after { animation: snapcard-develop 1.1s ease-out; }
@keyframes snapcard-develop { 0% { opacity: 1; } 100% { opacity: 0; } }
.snapcard-kicker { margin: 8px 2px 1px; font: 700 9px/1 Inter, system-ui, sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #b0412c; }
.snapcard-name { margin: 3px 2px 0; font: italic 700 17px/1.15 Fraunces, Georgia, serif; color: #2a2018; }
.snapcard-desc { margin: 4px 2px 0; font: 12px/1.35 Inter, system-ui, sans-serif; color: #5a4c40; }
body.is-touch .snapcard { width: 150px; padding: 6px 6px 8px; top: calc(10px + env(safe-area-inset-top)); right: calc(72px + env(safe-area-inset-right)); }
body.is-touch .snapcard-kicker { margin-top: 5px; font-size: 8px; }
body.is-touch .snapcard-name { font-size: 13px; }
body.is-touch .snapcard-desc { font-size: 10px; }
@media (max-height: 420px) { body.is-touch .snapcard { width: 128px; } body.is-touch .snapcard-desc { display: none; } }
@media (prefers-reduced-motion: reduce) { .snapcard, .snapcard.off { transition: opacity 0.3s; transform: rotate(2.5deg); } .snapcard-flash.go { animation: none; } }
`;

function injectCss() {
  if (document.getElementById("snapcard-css")) return;
  const s = document.createElement("style");
  s.id = "snapcard-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export class SnapshotCard {
  private queue: Achievement[] = [];
  private busy = false;
  /** called as each card appears (the shutter sound) */
  onShow: (a: Achievement) => void = () => {};

  constructor(private seconds = 4.5) {}

  show(a: Achievement) {
    this.queue.push(a);
    if (!this.busy) void this.next();
  }

  private async next() {
    const a = this.queue.shift();
    if (!a) { this.busy = false; return; }
    this.busy = true;
    injectCss();
    // load the snapshot only now (a couple of KB); don't wait long for it
    const img = new Image();
    img.alt = "";
    img.decoding = "async";
    await new Promise<void>((done) => {
      const t = setTimeout(done, 1500);
      img.onload = img.onerror = () => { clearTimeout(t); done(); };
      img.src = snapshotUrl(a.id);
    });

    const flash = document.createElement("div");
    flash.className = "snapcard-flash";
    const card = document.createElement("div");
    card.className = "snapcard";
    card.setAttribute("role", "status");
    card.innerHTML = `<div class="snapcard-photo"></div><div class="snapcard-kicker">Snapshot · achievement</div><div class="snapcard-name">${esc(a.name)}</div><div class="snapcard-desc">${esc(a.desc)}</div>`;
    if (img.naturalWidth) card.querySelector(".snapcard-photo")!.appendChild(img);
    document.body.append(flash, card);
    void card.offsetWidth; // start the slide from off-screen
    card.classList.add("on");
    flash.classList.add("go");
    this.onShow(a);

    await new Promise((r) => setTimeout(r, this.seconds * 1000));
    card.classList.add("off");
    await new Promise((r) => setTimeout(r, 550));
    card.remove();
    flash.remove();
    void this.next();
  }
}
