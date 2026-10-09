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
    const add = (id: string, name: string, p: [number, number], test: Landmark["test"], building?: Building | null) =>
      this.list.push({ id, name, x: p[0], z: p[1], test, building: building ?? undefined });

    add("bull", "the bronze bull", this.bull, near3(this.bull, 2.6, 0.2, 2.6));
    add("cityhall", "City Hall", L.cityHall, onRoof(cityHall), cityHall);
    add("arch", "the Washington Square arch", this.arch, near3(this.arch, 7, 21, 25));
    add("flatiron", "the Flatiron", L.flatiron, (x, y, z) => {
      const b = this.flatiron;
      if (!b || !onRoof(b)(x, y, z)) return false;
      // the narrow tip: the vertex furthest uptown
      let tx = 0, tz = -1e9;
      for (let i = 0; i < b.poly[0].length; i += 2) if (b.poly[0][i + 1] > tz) { tx = b.poly[0][i]; tz = b.poly[0][i + 1]; }
      return Math.hypot(x - tx, z - tz) < 7;
    }, this.flatiron);
    add("steps", "the red steps in Times Square", this.steps, near3(this.steps, 9, 0.2, 5.5));
    add("column", "the Columbus Circle column", this.column, near3(this.column, 3, 22, 26));
    add("empire", "the top of the Empire State", L.heraldSquare, onRoof(this.empire, 6), this.empire);
  }

  /** The landmark the leaf is resting on, if any. */
  at(x: number, y: number, z: number): Landmark | null {
    for (const l of this.list) if (Math.abs(x - l.x) < 120 && Math.abs(z - l.z) < 120 && l.test(x, y, z)) return l;
    // the Empire State and Flatiron centres aren't at their landmark coordinates; test them anyway
    for (const l of this.list) if (l.building && l.test(x, y, z)) return l;
    return null;
  }
}
