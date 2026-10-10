// Achievements: cute and funny, mostly for landing on landmarks and famous spots, plus a
// few for style and nerve. Saved in this browser; announced with a toast and a chime.

import type { Glider } from "../sim/glider";
import type { Landmarks } from "../world/landmarks";

export interface Achievement { id: string; name: string; desc: string }

export const ACHIEVEMENTS: Achievement[] = [
  { id: "bull", name: "Bull Market", desc: "Land on the bronze bull at Bowling Green." },
  { id: "cityhall", name: "Leaf of Absence", desc: "Land on the roof of City Hall." },
  { id: "arch", name: "Arch Nemesis", desc: "Land on top of the Washington Square arch." },
  { id: "flatiron", name: "Pressing Matters", desc: "Perch on the very tip of the Flatiron." },
  { id: "steps", name: "Front Row Seat", desc: "Settle on the red steps in Times Square." },
  { id: "column", name: "Going Round in Circles", desc: "Land on top of the Columbus Circle column." },
  { id: "empire", name: "Top of the World, Ma!", desc: "Land on the roof of the Empire State." },
  { id: "cat", name: "Catnap", desc: "Get swatted by a cat. Curiosity didn't kill this one." },
  { id: "laundry", name: "Laundry Day", desc: "Get caught on a washing line." },
  { id: "gobble", name: "Gobble Gobble", desc: "Boing off the giant turkey at the Thanksgiving parade." },
  { id: "splash", name: "Making a Splash", desc: "Fly into the spray from the burst water main." },
  { id: "kid", name: "Finders Keepers", desc: "Get caught by a kid in Central Park." },
  { id: "currents", name: "Current Affairs", desc: "Find five of the city's hidden currents." },
  { id: "allcurrents", name: "Wind Whisperer", desc: "Find every hidden current in Manhattan." },
  { id: "devil", name: "Spin Doctor", desc: "Ride a dust devil twenty metres up." },
  { id: "vent", name: "Mind the Gap", desc: "Get blown out of the subway up a vent shaft." },
  { id: "cab", name: "Cab Surfer", desc: "Ride a cab's slipstream for three seconds." },
  { id: "mole", name: "Mole Person", desc: "Spend a whole minute underground in one run." },
  { id: "high", name: "Bird's Eye View", desc: "Fly higher than 150 metres." },
  { id: "fast", name: "Speed of Leaf", desc: "Hit 30 metres a second." },
  { id: "spin", name: "Spin Cycle", desc: "Pull ten corkscrews." },
  { id: "loop", name: "Loop de Leaf", desc: "Pull a loop-the-loop." },
  { id: "drop", name: "Drop It Like It's Hot", desc: "Dive from the rooftops into the subway in one go." },
  { id: "plant", name: "The Last Leaf", desc: "Plant your seed in Central Park." },
  { id: "mint", name: "Mint Condition", desc: "Plant your seed with the leaf barely scratched." },
  { id: "quick", name: "Leaf Blower", desc: "Plant your seed in under fifteen minutes." },
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
    // landmarks: resting on one
    if (leaf.grounded && leaf.vel.length() < 3) {
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
    // touching the spray curtain of the water main
    if (p.y < 8 && p.y > 0) {
      for (const bar of leaf.flow.blockers.barriers) {
        if (bar.kind !== "water") continue;
        const rx = p.x - bar.x, rz = p.z - bar.z;
        if (Math.abs(rx * bar.ax + rz * bar.az) < bar.half && Math.abs(rx * bar.nx + rz * bar.nz) < 1.2) this.unlock("splash");
      }
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
