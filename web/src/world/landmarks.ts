// Landmarks along the route (stylised, never copies) and the spots that earn achievements
// when the leaf lands on them. Real buildings from the data (the Flatiron, the Empire
// State, City Hall) are found by footprint; the sculptures and structures are added here.

import { inPoly, type Building, type CityData } from "./data";

/** Same projection as tools/build-city.ts: lat/lon to grid-aligned metres (east is -x). */
export function project(city: CityData, lat: number, lon: number): [number, number] {
  const rad = (d: number) => (d * Math.PI) / 180;
  const o = city.raw.meta.origin;
  const KY = 111132.954 - 559.822 * Math.cos(2 * rad(40.74)) + 1.175 * Math.cos(4 * rad(40.74));
  const KX = 111412.84 * Math.cos(rad(40.74)) - 93.5 * Math.cos(3 * rad(40.74));
  const G = rad(city.raw.meta.gridDeg);
  const e = (lon - o.lon) * KX, n = (lat - o.lat) * KY;
  return [-(e * Math.cos(G) - n * Math.sin(G)), e * Math.sin(G) + n * Math.cos(G)];
}

export interface Landmark {
  id: string;
  name: string;
  x: number; z: number;
  /** a landing volume: inside it and settled (slow, touching) counts as landing on it */
  test: (x: number, y: number, z: number) => boolean;
  building?: Building;
  /** a point just above where you'd land on it (tools/achievement-landings.ts drops a leaf here) */
  spot: [number, number, number];
}

export class Landmarks {
  readonly list: Landmark[] = [];
  readonly statue: [number, number];
  readonly bull: [number, number];
  readonly arch: [number, number];
  readonly column: [number, number];
  readonly steps: [number, number];
  readonly empire: Building | null;
  readonly flatiron: Building | null;

  constructor(city: CityData) {
    const L = city.raw.landmarks;
    this.statue = L.statue;
    this.bull = project(city, 40.7056, -74.0134);
    this.arch = project(city, 40.73115, -73.99707);
    this.column = L.columbusCircle;
    this.steps = project(city, 40.7591, -73.9849);
    const near = (p: [number, number], r: number, pick: (a: Building, b: Building) => number) =>
      city.buildings.filter((b) => Math.hypot(b.cx - p[0], b.cz - p[1]) < r).sort(pick)[0] ?? null;
    this.empire = near(project(city, 40.7484, -73.9857), 120, (a, b) => b.h - a.h);
    this.flatiron = near(L.flatiron, 70, (a, b) => b.h - a.h);
    const cityHall = near(L.cityHall, 80, (a, b) => b.area - a.area);

    const onRoof = (b: Building | null, slack = 2.5) => (x: number, y: number, z: number) => !!b && y > b.h - 0.5 && y < b.h + slack && inPoly(b.poly, x, z);
    const near3 = (p: [number, number], r: number, y0: number, y1: number) => (x: number, y: number, z: number) => Math.hypot(x - p[0], z - p[1]) < r && y > y0 && y < y1;
    /** an axis-aligned box about p: half widths in x and z, heights y0..y1 */
    const box3 = (p: [number, number], hx: number, hz: number, y0: number, y1: number, dz = 0) => (x: number, y: number, z: number) =>
      Math.abs(x - p[0]) < hx && Math.abs(z - p[1] - dz) < hz && y > y0 && y < y1;
    const roofSpot = (b: Building | null, p: [number, number]): [number, number, number] => {
      if (!b) return [p[0], 0, p[1]];
      // the centroid can miss an L-shaped roof: walk towards a vertex until we're on it
      for (let k = 0; k <= 10; k++) {
        const x = b.cx + (b.poly[0][0] - b.cx) * k * 0.08, z = b.cz + (b.poly[0][1] - b.cz) * k * 0.08;
        if (inPoly(b.poly, x, z)) return [x, b.h + 0.5, z];
      }
      return [b.cx, b.h + 0.5, b.cz];
    };
    const add = (id: string, name: string, p: [number, number], test: Landmark["test"], spot: [number, number, number], building?: Building | null) =>
      this.list.push({ id, name, x: p[0], z: p[1], test, spot, building: building ?? undefined });

    // the solid boxes these stand on are in render/landmarks.ts (landmarkSolids): keep the volumes in step
    // the bull: 1.6 m tall, 4.8 m nose to tail (along z)
    add("bull", "the bronze bull", this.bull, box3(this.bull, 1.6, 3.2, 0.5, 3.2), [this.bull[0], 2.0, this.bull[1]]);
    add("cityhall", "City Hall", L.cityHall, onRoof(cityHall, 3), roofSpot(cityHall, L.cityHall), cityHall);
    // the arch: its attic is 18 m wide (x) and 5 m deep, its top at 23.4 m
    add("arch", "the Washington Square arch", this.arch, box3(this.arch, 9.8, 3.4, 21.5, 26), [this.arch[0] + 3, 23, this.arch[1]]);
    // the Flatiron: anywhere on its roof (the old test wanted the very tip, which the wind rarely allows)
    add("flatiron", "the Flatiron", L.flatiron, onRoof(this.flatiron, 3), roofSpot(this.flatiron, L.flatiron), this.flatiron);
    // the red steps: six risers 10 m wide climbing to 8.8 m (z from -5.8 to +3.8)
    add("steps", "the red steps in Times Square", this.steps, box3(this.steps, 5.8, 5.2, 0.5, 10.5, -1), [this.steps[0], 7.6, this.steps[1] + 1.4]);
    // the column: its capital is 2.6 m square at 22 m, the figure above it
    add("column", "the Columbus Circle column", this.column, near3(this.column, 3, 21.5, 27), [this.column[0], 22.4, this.column[1]]);
    // the Empire State: its whole roof (the data has it as one block; the tiers and mast are drawn on top)
    add("empire", "the top of the Empire State", L.heraldSquare, onRoof(this.empire, 8), roofSpot(this.empire, L.heraldSquare), this.empire);
    // the Maine monument at Merchants' Gate (its place is fixed in render/centralPark.ts parkLayout; copied
    // here): its pylon tops out at 14.6 m, the gilded group above it to 18.7 m. (Gapstow Bridge and Wollman
    // Rink were tried too, but the park's stream toward the meadow runs at 25+ m/s over them and nothing
    // can touch down there: tools/achievement-landings.ts)
    const mRot = Math.atan2(882 - 846, 7733 - 7787), maine: [number, number] = [846 - Math.sin(mRot) * 1.2, 7787 - Math.cos(mRot) * 1.2];
    add("maine", "the Maine monument", maine, near3(maine, 3.6, 13.8, 21.5), [maine[0], 19, maine[1]]);
  }

  /** The landmark the leaf is resting on, if any. */
  at(x: number, y: number, z: number): Landmark | null {
    for (const l of this.list) if (Math.abs(x - l.x) < 120 && Math.abs(z - l.z) < 120 && l.test(x, y, z)) return l;
    // the Empire State and Flatiron centres aren't at their landmark coordinates; test them anyway
    for (const l of this.list) if (l.building && l.test(x, y, z)) return l;
    return null;
  }
}
