// Finding the wind's secrets: the hidden currents you've ridden (remembered in this browser
// and drawn on the minimap from then on) and the dust devils you've caught.

import type { Glider } from "../sim/glider";
import { JET_SPEC, JET_GRADE, type WindFeatures } from "../world/windFeatures";

export class Discoveries {
  readonly found = new Set<number>();
  private inJet = -1;
  private inDevil = -1;
  private devilFrom = 0;
  /** (html, seconds) when something is found */
  onFind: (html: string, kind: "jet" | "devil") => void = () => {};
  /** how high you rode a dust devil this run (for an achievement) */
  devilClimb = 0;

  constructor(private features: WindFeatures) {
    try { for (const id of JSON.parse(localStorage.getItem("fftt.jets") ?? "[]")) this.found.add(id); } catch { /* storage blocked */ }
  }

  get total() { return this.features.jets.length; }

  update(leaf: Glider) {
    if (leaf.state !== "flying") { this.inJet = this.inDevil = -1; return; }
    const j = leaf.air.jet ?? -1;
    if (j >= 0 && j !== this.inJet) {
      const jet = this.features.jets[j];
      if (!this.found.has(j)) {
        this.found.add(j);
        try { localStorage.setItem("fftt.jets", JSON.stringify([...this.found])); } catch { /* ignore */ }
        this.onFind(`<b>Hidden current found</b><br/><span style="opacity:.85">${jet.name}: a ${JET_GRADE[jet.grade].label} ${JET_SPEC[jet.kind].label} · ${this.found.size} / ${this.total}</span>`, "jet");
      } else this.onFind("", "jet");
    }
    this.inJet = j;
    const d = leaf.air.devil ?? -1;
    if (d >= 0 && this.inDevil < 0) {
      this.devilFrom = leaf.pos.y;
      const dv = this.features.devils.find((q) => q.id === d);
      this.onFind(`<b>Dust devil!</b><br/><span style="opacity:.85">${dv?.name ?? ""}: ride the spin up</span>`, "devil");
    }
    if (d >= 0) this.devilClimb = Math.max(this.devilClimb, leaf.pos.y - this.devilFrom);
    this.inDevil = d;
  }

  reset() { this.devilClimb = 0; this.inJet = this.inDevil = -1; }
}
