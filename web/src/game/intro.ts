// The story films: pixel-art cutscenes made with Tesseract (tools/cutscene).
// The intro: the last tree in Battery Park through summer and autumn until one leaf is left. A
// press-any-key card first (browsers only play sound after a gesture), then the film; any key skips
// it. Once per session; restarts go straight to the tree.
// The ending: the seed goes into Sheep Meadow and grows into a tree over the years, scored with a cut
// of "Next Spring". Straight in (no card), any key skips it. It starts from the planting, not a tap,
// so where a browser won't autoplay sound (iPhones) it plays muted and the game's own "Next Spring"
// plays under it instead.

import { isTouchDevice } from "./touch";

interface FilmOptions {
  /** the files in public/video: <name>.webm, <name>.mp4, <name>_poster.jpg */
  name: string;
  /** a press-any-key card first (needed for sound: a gesture has to start it) */
  gate: boolean;
  /** if the browser won't play it with sound (no gesture): play it muted and call this */
  onMuted?: () => void;
  /** fade in over the game rather than cutting to it */
  fadeIn?: boolean;
  onGesture?: () => void;
  onFinish?: () => void;
}

/** Plays a film full screen; resolves when it ends or is skipped (any key / tap). */
function playFilm(root: HTMLElement, o: FilmOptions): Promise<void> {
  return new Promise((done) => {
    const touch = isTouchDevice();
    const el = document.createElement("div");
    el.className = `intro${o.fadeIn ? " fade-in" : ""}`;
    el.innerHTML = `
      <video playsinline preload="auto" poster="./video/${o.name}_poster.jpg">
        <source src="./video/${o.name}.webm" type="video/webm" />
        <source src="./video/${o.name}.mp4" type="video/mp4" />
      </video>
      ${o.gate ? `<div class="intro-gate"><div class="title">Far From the Tree</div><div class="cta">${touch ? "tap the screen" : "press any key"}</div></div>` : ""}
      <div class="intro-skip">${touch ? "tap to skip" : "any key to skip"}</div>`;
    root.appendChild(el);
    const video = el.querySelector("video")!;
    let stage: "gate" | "film" | "out" = "gate";

    const finish = () => {
      if (stage === "out") return;
      stage = "out";
      o.onFinish?.();
      el.classList.add("leaving");
      removeEventListener("keydown", onKey, true);
      removeEventListener("pointerdown", onKey, true);
      setTimeout(() => { video.pause(); el.remove(); }, 700);
      done();
    };
    const start = () => {
      stage = "film";
      el.classList.add("playing");
      o.onGesture?.();
      video.play().catch(() => {
        if (!o.onMuted || video.muted) { finish(); return; }
        video.muted = true;
        o.onMuted();
        video.play().catch(() => finish());
      });
    };
    const onKey = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      if (stage === "gate") start();
      else if (stage === "film") finish();
    };
    if (!o.gate) start();
    video.addEventListener("ended", finish);
    video.addEventListener("error", finish);
    addEventListener("keydown", onKey, true);
    addEventListener("pointerdown", onKey, true);
  });
}

/** again: replaying it from the title screen (a click already happened, so straight into the film) */
export function playIntro(root: HTMLElement, onGesture?: () => void, again = false): Promise<void> {
  let seen = false;
  try { seen = sessionStorage.getItem("fftt.intro") === "seen"; } catch { /* ignore */ }
  if (!again && (seen || new URLSearchParams(location.search).has("nointro"))) return Promise.resolve();
  return playFilm(root, {
    name: "intro", gate: !again, onGesture,
    onFinish: () => { try { sessionStorage.setItem("fftt.intro", "seen"); } catch { /* ignore */ } },
  });
}

/**
 * The ending film, once the seed's planted: after a moment (the planting and the cheer first),
 * faded in over the game. Resolves when it's over or skipped, or straight away if wanted() has
 * gone false by then (the player restarted). onMuted: it's playing without its sound (the browser
 * wouldn't allow it), so the game's music should carry on under it. gate: the press-any-key card first
 * (?ending=1 at load, so it can play with sound).
 */
export function playEnding(root: HTMLElement, wanted: () => boolean = () => true, delayMs = 1600, onMuted?: () => void, gate = false): Promise<void> {
  return new Promise((done) => {
    setTimeout(() => {
      if (!wanted()) { done(); return; }
      playFilm(root, { name: "ending", gate, fadeIn: !gate, onMuted }).then(done);
    }, delayMs);
  });
}
