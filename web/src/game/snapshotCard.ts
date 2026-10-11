// The snapshot card: earning a landmark achievement (snap: true) "takes a photo". The pixel-art polaroid
// (public/achievements/<id>.png, drawn by tools/achievements/snapshots.py: the frame and the handwritten
// pun are part of the picture) slides in at the top right, tilted, with a shutter flash as it develops;
// the achievement's line sits underneath. After ~4.5 s it slides away. Several at once queue up. It never
// takes a tap (pointer-events: none), keeps out of the middle of the screen and inside the safe area on
// phones. Scoped CSS is injected once; mounted on body.

import type { Achievement } from "./achievements";

export const snapshotUrl = (id: string) => `./achievements/${id}.png`;

const CSS = `
.snapcard-flash { position: fixed; inset: 0; z-index: 30; pointer-events: none; background: #fff; opacity: 0; }
.snapcard-flash.go { animation: snapcard-flash 0.45s ease-out; }
@keyframes snapcard-flash { 0% { opacity: 0.32; } 100% { opacity: 0; } }
.snapcard { position: fixed; z-index: 30; pointer-events: none; top: calc(16px + env(safe-area-inset-top)); right: calc(16px + env(safe-area-inset-right));
  width: 198px; transform: translateX(calc(100% + 40px)) rotate(7deg); opacity: 0;
  transition: transform 0.55s cubic-bezier(0.2, 0.9, 0.25, 1.15), opacity 0.35s; }
.snapcard.on { transform: translateX(0) rotate(3deg); opacity: 1; }
.snapcard.off { transform: translateX(calc(100% + 40px)) rotate(9deg); opacity: 0; transition: transform 0.5s ease-in, opacity 0.5s ease-in; }
.snapcard-photo { position: relative; aspect-ratio: 132 / 120; }
.snapcard-photo img { display: block; width: 100%; height: 100%; image-rendering: pixelated; filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.35)); }
/* the photo develops: a white wash over the picture (inside the frame) fading out */
.snapcard-photo::after { content: ""; position: absolute; left: 3.8%; top: 4.2%; width: 90.9%; height: 75%; background: #fff; opacity: 0; }
.snapcard.on .snapcard-photo::after { animation: snapcard-develop 1.2s ease-out; }
@keyframes snapcard-develop { 0% { opacity: 1; } 100% { opacity: 0; } }
.snapcard-line { margin: 6px 4px 0 10px; padding: 6px 9px 7px; border-radius: 8px; background: rgba(20, 14, 10, 0.62); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  color: #fff7ec; font: 12px/1.35 Inter, system-ui, sans-serif; transform: rotate(-3deg); }
.snapcard-line b { display: block; margin-bottom: 2px; font: 700 9px/1 Inter, system-ui, sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #ffb04a; }
body.is-touch .snapcard { width: 165px; top: calc(8px + env(safe-area-inset-top)); right: calc(70px + env(safe-area-inset-right)); }
body.is-touch .snapcard-line { font-size: 10.5px; padding: 5px 7px 6px; }
@media (max-height: 420px) { body.is-touch .snapcard { width: 132px; } body.is-touch .snapcard-line { display: none; } }
@media (prefers-reduced-motion: reduce) { .snapcard, .snapcard.off { transition: opacity 0.3s; transform: rotate(3deg); } .snapcard-flash.go { animation: none; } }
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
    // load the snapshot only now (a few KB); don't wait long for it
    const img = new Image();
    img.alt = a.name;
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
    card.setAttribute("aria-label", `Achievement: ${a.name}`);
    card.innerHTML = `<div class="snapcard-photo"></div><div class="snapcard-line"><b>New snapshot</b>${esc(a.desc)}</div>`;
    if (img.naturalWidth) card.querySelector(".snapcard-photo")!.appendChild(img);
    else card.querySelector(".snapcard-line")!.innerHTML = `<b>${esc(a.name)}</b>${esc(a.desc)}`;
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
