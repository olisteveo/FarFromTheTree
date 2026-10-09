// The story intro: a pixel-art cutscene (made with Tesseract, tools/cutscene) of the last
// tree in Battery Park through summer and autumn until one leaf is left. A press-any-key
// card first (browsers only play sound after a gesture), then the film; any key skips it.
// Once per session; restarts go straight to the tree.

export function playIntro(root: HTMLElement, onGesture?: () => void): Promise<void> {
  let seen = false;
  try { seen = sessionStorage.getItem("fftt.intro") === "seen"; } catch { /* ignore */ }
  if (seen || new URLSearchParams(location.search).has("nointro")) return Promise.resolve();

  return new Promise((done) => {
    const el = document.createElement("div");
    el.className = "intro";
    el.innerHTML = `
      <video playsinline preload="auto" poster="./video/intro_poster.jpg">
        <source src="./video/intro.webm" type="video/webm" />
        <source src="./video/intro.mp4" type="video/mp4" />
      </video>
      <div class="intro-gate"><div class="title">Far From the Tree</div><div class="cta">press any key</div></div>
      <div class="intro-skip">any key to skip</div>`;
    root.appendChild(el);
    const video = el.querySelector("video")!;
    let stage: "gate" | "film" | "out" = "gate";

    const finish = () => {
      if (stage === "out") return;
      stage = "out";
      try { sessionStorage.setItem("fftt.intro", "seen"); } catch { /* ignore */ }
      el.classList.add("leaving");
      removeEventListener("keydown", onKey, true);
      removeEventListener("pointerdown", onKey, true);
      setTimeout(() => { video.pause(); el.remove(); }, 700);
      done();
    };
    const onKey = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      if (stage === "gate") {
        onGesture?.();
        stage = "film";
        el.classList.add("playing");
        video.play().catch(() => finish());
      } else if (stage === "film") finish();
    };
    video.addEventListener("ended", finish);
    video.addEventListener("error", finish);
    addEventListener("keydown", onKey, true);
    addEventListener("pointerdown", onKey, true);
  });
}
