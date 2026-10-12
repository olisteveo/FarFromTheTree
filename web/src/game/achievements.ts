// Achievements: cute and funny, mostly for landing on landmarks and famous spots, plus a
// few for style and nerve. Saved in this browser. Landmark landings are announced with a pixel-art
// snapshot card (game/snapshotCard.ts), the rest with a toast; all with a chime. game/achievementGallery.ts
// lists them. tools/achievement-landings.ts checks every landmark one can be landed.

import type { Glider } from "../sim/glider";
import type { Landmarks } from "../world/landmarks";

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  /** a cryptic nudge shown while it's locked (the gallery) */
  hint: string;
  /** a plain-text stand-in (every achievement now has a polaroid, public/achievements/<id>.png from
   *  tools/achievements/snapshots.py, shown in the album: game/achievementGallery.ts) */
  icon: string;
  /** a landmark landing: unlocks with the polaroid card (game/snapshotCard.ts) rather than a toast */
  snap?: true;
}

// ids are saved in players' browsers: never change one
export const ACHIEVEMENTS: Achievement[] = [
  // ---- landmarks (snapshots)
  { id: "bull", snap: true, icon: "🐂", name: "Seeing Red", desc: "Land on the bronze bull at Bowling Green. Never wave a red leaf at a bull.", hint: "Something bronze downtown is in a charging mood." },
  { id: "cityhall", snap: true, icon: "🏛️", name: "Leaf of Absence", desc: "Land on the roof of City Hall. Out of office until spring.", hint: "Take some time off where the mayor works." },
  { id: "arch", snap: true, icon: "🕊️", name: "Arch Nemesis", desc: "Land on top of the Washington Square arch. The pigeon was there first.", hint: "A pigeon guards the gate to Fifth Avenue." },
  { id: "flatiron", snap: true, icon: "♨️", name: "Pressing Matters", desc: "Land on the Flatiron. Steam's up; mind the creases.", hint: "Get pressed by the city's most famous iron." },
  { id: "steps", snap: true, icon: "🌟", name: "Stair Struck", desc: "Settle on the red steps in Times Square. Your name in lights, sort of.", hint: "Every star needs a staircase. A red one." },
  { id: "column", snap: true, icon: "🚩", name: "Leaf Erikson", desc: "Land on top of the Columbus Circle column. Got there first, like Leif did.", hint: "Beat a famous explorer to the top of his own column." },
  { id: "empire", snap: true, icon: "💐", name: "Don't Leave Me Waiting", desc: "Land on top of the Empire State. Someone's been waiting up there for ages.", hint: "A rendezvous at the top of the tallest one." },
  { id: "maine", snap: true, icon: "✨", name: "Main Character", desc: "Strike a pose on the gilded figure atop the Maine monument.", hint: "Upstage the golden lady at the park's corner gate." },
  // ---- the city
  { id: "cat", icon: "🐈", name: "Catnap", desc: "Get swatted by a cat. Curiosity didn't kill this one.", hint: "Curiosity, meet the leaf." },
  { id: "laundry", icon: "🧺", name: "Laundry Day", desc: "Get caught on a washing line.", hint: "Hang out to dry." },
  { id: "gobble", icon: "🦃", name: "Gobble Gobble", desc: "Boing off the giant turkey at the Thanksgiving parade.", hint: "Something big and bouncy floats down the avenue." },
  { id: "splash", icon: "💦", name: "Making a Splash", desc: "Fly into the spray from the burst water main.", hint: "Somewhere under the street, a pipe gave up." },
  { id: "kid", icon: "🧒", name: "Finders Keepers", desc: "Get caught by a kid in Central Park.", hint: "Small hands, open sky." },
  // ---- the wind
  { id: "currents", icon: "🌬️", name: "Current Affairs", desc: "Find five of the city's hidden currents.", hint: "The wind keeps secrets. Learn five." },
  { id: "allcurrents", icon: "🍃", name: "Wind Whisperer", desc: "Find every hidden current in Manhattan.", hint: "The wind keeps secrets. Learn them all." },
  { id: "devil", icon: "🌪️", name: "Spin Doctor", desc: "Ride a dust devil twenty metres up.", hint: "Something on the ground is spinning. Go up with it." },
  { id: "vent", icon: "🚇", name: "Mind the Gap", desc: "Get blown out of the subway up a vent shaft.", hint: "Leave the subway the fast way." },
  { id: "cab", icon: "🚕", name: "Cab Surfer", desc: "Ride a cab's slipstream for three seconds.", hint: "Hail one. Don't get in." },
  { id: "mole", icon: "🕳️", name: "Mole Person", desc: "Spend a whole minute underground in one run.", hint: "Stay down there a while." },
  // ---- style
  { id: "high", icon: "🦅", name: "Bird's Eye View", desc: "Fly higher than 150 metres.", hint: "Higher than the pigeons dare." },
  { id: "fast", icon: "💨", name: "Speed of Leaf", desc: "Hit 30 metres a second.", hint: "Faster than a falling leaf has any right to." },
  { id: "spin", icon: "🌀", name: "Spin Cycle", desc: "Pull ten corkscrews.", hint: "Round and round, ten times over." },
  { id: "loop", icon: "➰", name: "Loop de Leaf", desc: "Pull a loop-the-loop.", hint: "Go all the way round." },
  { id: "drop", icon: "⬇️", name: "Drop It Like It's Hot", desc: "Dive from the rooftops into the subway in one go.", hint: "Top floor to basement, no stops." },
  // ---- the end
  { id: "plant", icon: "🌱", name: "The Last Leaf", desc: "Plant your seed in Central Park.", hint: "Finish what the tree started." },
  { id: "mint", icon: "🪙", name: "Iron Leaf", desc: "Plant your seed with 90% or more of the leaf left.", hint: "Arrive in one piece. Nearly." },
  { id: "quick", icon: "⏱️", name: "Leaf Blower", desc: "Plant your seed in under fifteen minutes.", hint: "The park, against the clock." },
];

export class Achievements {
  private got = new Set<string>();
  private cab = 0;
  private under = 0;
  private lastLane = "";
  private lastEvents = 0;
  private corks = 0;
  private lastState = "";
  onUnlock: (a: Achievement) => void = () => {};

  constructor(private landmarks: Landmarks) {
    try {
      for (const id of JSON.parse(localStorage.getItem("fftt.ach") ?? "[]")) this.got.add(id);
      this.corks = Number(localStorage.getItem("fftt.corks") ?? 0);
    } catch { /* storage blocked */ }
  }

  has(id: string) { return this.got.has(id); }
  /** earned ids, in the order they were earned */
  get earned(): readonly string[] { return [...this.got]; }
  get count() { return this.got.size; }

  /** for things tracked elsewhere (the wind's secrets) */
  grant(id: string) { this.unlock(id); }

  private unlock(id: string) {
    if (this.got.has(id)) return;
    this.got.add(id);
    try { localStorage.setItem("fftt.ach", JSON.stringify([...this.got])); } catch { /* ignore */ }
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (a) this.onUnlock(a);
  }

  reset() { this.cab = 0; this.under = 0; this.lastEvents = 0; this.lastLane = ""; this.lastState = ""; }

  update(dt: number, leaf: Glider) {
    if (leaf.state === "attached") return;
    const p = leaf.pos;
    // landmarks: touching down on top of one (grounded = an upward-facing contact this step). Not
    // "come to rest": the wind (14 m/s round the bull, 25+ over the rink) whips a leaf off before it
    // stops, so any touchdown on top counts (tools/achievement-landings.ts checks each one)
    if (leaf.grounded) {
      const l = this.landmarks.at(p.x, p.y, p.z);
      if (l) this.unlock(l.id);
    }
    // what happened to the leaf
    for (; this.lastEvents < leaf.events.length; this.lastEvents++) {
      const e = leaf.events[this.lastEvents];
      if (/cat/.test(e)) this.unlock("cat");
      if (/washing line/.test(e)) this.unlock("laundry");
      if (/parade balloon/.test(e)) this.unlock("gobble");
      if (/caught by a kid/.test(e)) this.unlock("kid");
    }
    // touching the burst water main's geyser
    for (const b of leaf.flow.blockers.list) {
      const gz = b.geyser;
      if (gz && p.y > 0 && p.y < gz.h && Math.hypot(p.x - gz.x, p.z - gz.z) < gz.r + 0.5) this.unlock("splash");
    }
    if (leaf.lane !== this.lastLane) {
      if (this.lastLane === "subway" && leaf.lane !== "subway" && leaf.vel.y > 6) this.unlock("vent");
      this.lastLane = leaf.lane;
    }
    if (/Roof to subway/.test(leaf.boost.kind) && leaf.clock - leaf.boost.t < 0.1) this.unlock("drop");
    if (leaf.lane === "subway") { this.under += dt; if (this.under > 60) this.unlock("mole"); }
    if (p.y > 150) this.unlock("high");
    if (leaf.vel.length() > 30) this.unlock("fast");
    // riding a slipstream: a vehicle just ahead, going your way
    if (leaf.lane === "street" && p.y < 4) {
      let riding = false;
      for (const v of leaf.flow.traffic.grid.at(p.x, p.z)) {
        const rx = p.x - v.x, rz = p.z - v.z, along = -(rx * v.tx + rz * v.tz), side = Math.abs(rx * v.tz - rz * v.tx);
        if (along > 2 && along < 16 && side < 1.4 && leaf.vel.x * v.tx + leaf.vel.z * v.tz > 4) riding = true;
      }
      this.cab = riding ? this.cab + dt : 0;
      if (this.cab > 3) this.unlock("cab");
    }
    if (leaf.tricks.loop > 0) this.unlock("loop");
    const corks = leaf.tricks.corkscrew;
    if (corks > 0 && this.corks + corks >= 10) this.unlock("spin");
    if (leaf.state !== this.lastState) {
      if (leaf.state === "planted") {
        this.unlock("plant");
        if (leaf.integrity >= 0.9) this.unlock("mint");
        if (leaf.time < 15 * 60) this.unlock("quick");
      }
      if (leaf.state === "dead" || leaf.state === "planted") {
        this.corks += corks;
        try { localStorage.setItem("fftt.corks", String(this.corks)); } catch { /* ignore */ }
      }
      this.lastState = leaf.state;
    }
  }
}
