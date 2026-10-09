// The course: where the last tree stands in Battery Park, and where the seed can be
// planted (open ground in Sheep Meadow: a tree can't grow on top of another tree).
// Shared by the game and the headless test pilots so both run the same course.

import { inRing, type CityData } from "./data";

export interface Course {
  tree: { x: number; z: number };
  start: { x: number; y: number; z: number; heading: number };
  inMeadow: (x: number, z: number) => boolean;
}

export function makeCourse(city: CityData): Course {
  const parks = (re: RegExp) => city.raw.parks.filter((p) => re.test(p.n)).map((p) => p.p[0]);
  const battery = parks(/Battery Park/);
  const meadow = parks(/Sheep Meadow/);
  const inAny = (rings: number[][], x: number, z: number) => rings.some((r) => inRing(r, x, z));
  // the route starts at the old fort: find open lawn nearby
  let tree = { x: city.route.at(0).x, z: city.route.at(0).z };
  search: for (let s = 30; s < 400; s += 10) for (const off of [0, 12, -12, 24, -24, 36, -36]) {
    const p = city.route.at(s);
    const x = p.x + p.tz * off, z = p.z - p.tx * off;
    if (inAny(battery, x, z) && city.canopy(x, z, 18) < 1) { tree = { x, z }; break search; }
  }
  const rs = city.route.nearest(tree.x, tree.z);
  const ahead = city.route.at(rs.s + 30);
  const heading = Math.atan2(ahead.x - tree.x, ahead.z - tree.z);
  return {
    tree,
    start: { x: tree.x + Math.sin(heading) * 4.2, y: 7.6, z: tree.z + Math.cos(heading) * 4.2, heading },
    inMeadow: (x, z) => inAny(meadow, x, z),
  };
}
