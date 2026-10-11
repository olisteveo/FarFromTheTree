// The leaderboard: when you plant your seed you can leave your name and time; the fastest
// seeds show on the title screen. Talks to functions/api (Cloudflare Pages + D1). The server
// gives each run a ticket when the leaf lets go, and won't take a time faster than the real
// time that passed. Runs that don't count (jumping ahead with ?at, autopilot, a tuned flight
// model) just don't get a ticket. Everything fails quietly when the API isn't there.

interface Entry { name: string; ms: number; at: number; durability?: number | null }

const fmt = (ms: number) => {
  const s = ms / 1000, m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** How much of the leaf made it to the park, 0 to 100 (integrity starts at 1, a whole leaf). */
export const durabilityPct = (integrity: number) => Math.round(Math.min(1, Math.max(0, integrity)) * 100);
/** The durability column: "49%", or a dash for scores from before it was kept. */
const dur = (e: Entry) => `<span class="du">${typeof e.durability === "number" ? `${e.durability}%` : "–"}</span>`;

export class Leaderboard {
  private panel: HTMLElement;
  private mini: HTMLElement;
  private run: Promise<string | null> | null = null;
  private top: Entry[] = [];
  private shown = false;
  /** false once the flight model's been tuned, or the run started somewhere odd */
  eligible = true;

  constructor(root: HTMLElement) {
    this.panel = document.createElement("div");
    this.panel.className = "board";
    root.appendChild(this.panel);
    this.mini = document.createElement("div");
    this.mini.className = "board-mini";
    root.appendChild(this.mini);
    this.refresh();
  }

  private async refresh() {
    try {
      const r = await fetch("/api/scores");
      if (!r.ok) return;
      this.top = ((await r.json()) as { top: Entry[] }).top ?? [];
      this.renderMini();
    } catch { /* offline */ }
  }

  private renderMini() {
    if (!this.top.length) { this.mini.innerHTML = ""; return; }
    this.mini.innerHTML = `<div class="h">Fastest seeds</div>` + this.top.slice(0, 5)
      .map((e, i) => `<div class="row"><span>${i + 1}. ${esc(e.name)}</span><span>${fmt(e.ms)}</span></div>`).join("");
  }

  /** On the title screen, show the top five. */
  showMini(on: boolean) { this.mini.classList.toggle("show", on && this.top.length > 0); }

  /** The leaf let go of the tree: ask for a ticket. */
  startRun() {
    if (!this.eligible) { this.run = null; return; }
    this.run = fetch("/api/run", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { id?: string } | null) => j?.id ?? null)
      .catch(() => null);
  }

  /** The seed's planted: offer to enter the time (and how much of the leaf was left, 0 to 100). */
  async showWon(seconds: number, durability: number) {
    if (this.shown) return;
    this.shown = true;
    const ms = Math.round(seconds * 1000);
    const run = this.run ? await this.run : null;
    if (!this.shown) return;
    if (!run) {
      this.panel.innerHTML = `<div class="note">${this.eligible ? "The leaderboard's offline right now." : "Tuned or jumped-ahead runs don't go on the leaderboard."}</div>`;
      this.panel.classList.add("show");
      return;
    }
    let saved = "";
    try { saved = localStorage.getItem("fftt.name") ?? ""; } catch { /* ignore */ }
    this.panel.innerHTML = `
      <form class="enter">
        <div class="h">Put your seed on the board</div>
        <div class="line"><input name="n" maxlength="16" placeholder="Your name" autocomplete="nickname" value="${esc(saved)}"/><button type="submit">Enter ${fmt(ms)}</button></div>
        <div class="err"></div>
      </form>`;
    this.panel.classList.add("show");
    const form = this.panel.querySelector("form")!, input = form.querySelector("input")!, err = form.querySelector(".err")!;
    input.focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      (form.querySelector("button") as HTMLButtonElement).disabled = true;
      try {
        const r = await fetch("/api/scores", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run, name, ms, durability }) });
        const j = (await r.json()) as { ok?: boolean; error?: string; rank?: number; name?: string };
        if (!j.ok) { err.textContent = j.error ?? "Couldn't save that."; (form.querySelector("button") as HTMLButtonElement).disabled = false; return; }
        try { localStorage.setItem("fftt.name", name); } catch { /* ignore */ }
        await this.refresh();
        this.renderTable(j.name ?? name, j.rank ?? 0);
      } catch {
        err.textContent = "Couldn't reach the leaderboard.";
        (form.querySelector("button") as HTMLButtonElement).disabled = false;
      }
    });
  }

  private renderTable(me: string, rank: number) {
    const rows = this.top.slice(0, 10).map((e, i) =>
      `<div class="row${e.name.toLowerCase() === me.toLowerCase() ? " me" : ""}"><span class="nm">${i + 1}. ${esc(e.name)}</span>${dur(e)}<span>${fmt(e.ms)}</span></div>`).join("");
    this.panel.innerHTML = `<div class="h">You're number ${rank}</div>${rows}`;
  }

  /** The whole board, from the title screen's button: the fastest twenty, your best picked out. */
  fullOpen = false;
  private full: HTMLElement | null = null;
  async showFull() {
    if (!this.full) {
      this.full = document.createElement("div");
      this.full.className = "board-full";
      document.body.appendChild(this.full);
      this.full.addEventListener("pointerdown", (e) => { e.stopPropagation(); if (e.target === this.full || (e.target as HTMLElement).closest(".close")) this.closeFull(); });
      addEventListener("keydown", (e) => { if (this.fullOpen && (e.code === "Escape" || e.code === "Enter")) { e.stopPropagation(); this.closeFull(); } }, true);
    }
    this.fullOpen = true;
    this.full.innerHTML = `<div class="lb-card"><div class="h">Fastest seeds</div><div class="row hd"><span class="rk"></span><span class="nm"></span><span class="du" title="How much of the leaf made it to the park">leaf</span><span class="tm">time</span></div><div class="rows">Loading…</div><button class="close">Close</button></div>`;
    this.full.classList.add("on");
    await this.refresh();
    let me = "";
    try { me = (localStorage.getItem("fftt.name") ?? "").toLowerCase(); } catch { /* ignore */ }
    const rows = this.full.querySelector(".rows")!;
    rows.innerHTML = this.top.length
      ? this.top.slice(0, 20).map((e, i) => `<div class="row${me && e.name.toLowerCase() === me ? " me" : ""}"><span class="rk">${i + 1}</span><span class="nm">${esc(e.name)}</span>${dur(e)}<span class="tm">${fmt(e.ms)}</span></div>`).join("")
      : `<div class="note">No seeds planted yet. Be the first to reach Central Park.</div>`;
  }
  closeFull() { this.fullOpen = false; this.full?.classList.remove("on"); }

  hide() {
    this.shown = false;
    this.panel.classList.remove("show");
    this.panel.innerHTML = "";
  }
}
