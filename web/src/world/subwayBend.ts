// The tunnels between the stations aren't ruler-straight: the line snakes a few metres either side of
// its surveyed course in long S-curves, and dips and rises a little as it threads under the city.
// Stations (and the approaches to them), the stairs' passages, the big vents and the closed stretches
// keep exactly the surveyed line, so nothing that meets the tunnel there moves.
//
// Applied once, in CityData: city.subway is the bent line (its s is still the surveyed s: points move
// sideways, never along), and city.subwayDip(s) is how far the tunnel's floor and ceiling sit below
// their usual height there (negative = deeper). Everything that draws, collides or blows along the
// tunnel uses those two. Deterministic: a function of s alone.

/** how far from a station's centre the line must be the surveyed one (the station opens out from 105 m) */
const STATION_HOLD = 108;
/** how far either side of a stair passage's foot / a vent / a closed stretch's wall */
const PASSAGE_HOLD = 26;
const VENT_HOLD = 10;
/** over how many metres the bend fades in */
const FADE = 70;
/** ...and the dips (longer: a gentle grade) */
const FADE_V = 100;

export interface BendInput { step: number; stations: number[]; passages: number[]; vents: number[]; walls: number[] }

const smoother = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));

/** 0 where the line must keep its course, 1 where it's free to bend. */
function freedom(s: number, inp: BendInput, vertical: boolean) {
  let m = 1;
  const fade = vertical ? FADE_V : FADE;
  const hold = (c: number, r: number) => { m = Math.min(m, smoother((Math.abs(s - c) - r) / fade)); };
  for (const c of inp.stations) hold(c, STATION_HOLD);
  for (const c of inp.passages) hold(c, PASSAGE_HOLD);
  for (const c of inp.walls) hold(c, PASSAGE_HOLD);
  // the vents' shafts are built to the usual roof height: the line may swing under them, but not dip
  if (vertical) for (const c of inp.vents) hold(c, VENT_HOLD);
  hold(0, 4);
  return m;
}

/** sideways (m, + = the polyline's +off side) and up (m) at s, before smoothing */
export function bendAt(s: number) {
  // three long swells of different lengths (about 380, 235 and 160 m) so no two stretches look alike
  const side = 5.2 * Math.sin((2 * Math.PI * s) / 383 + 1.3) + 2.8 * Math.sin((2 * Math.PI * s) / 237 + 4.1) + 1.0 * Math.sin((2 * Math.PI * s) / 161 + 0.4);
  // dips and gentle rises: from about 2 m down to 0.8 m up (the roof never comes near the street)
  const up = -0.6 + 1.1 * Math.sin((2 * Math.PI * s) / 311 + 2.2) + 0.3 * Math.sin((2 * Math.PI * s) / 173 + 5.0);
  return { side, up };
}

/** Bend a surveyed line (flat x, z pairs every `step` m). Returns the new points and the dip per point. */
export function bendSubway(flat: number[], inp: BendInput): { flat: number[]; dip: Float32Array } {
  const n = flat.length / 2, step = inp.step;
  const side = new Float32Array(n), up = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i * step, b = bendAt(s);
    side[i] = b.side * freedom(s, inp, false);
    up[i] = b.up * freedom(s, inp, true);
  }
  // smooth both (a few passes of a 5-point binomial: rounds off where the bend fades in), but never
  // where the line is held (that stays exactly the surveyed course)
  const smooth = (a: Float32Array, vertical: boolean) => {
    for (let pass = 0; pass < 4; pass++) {
      const b = a.slice();
      for (let i = 2; i < n - 2; i++) {
        if (freedom(i * step, inp, vertical) === 0) continue;
        b[i] = (a[i - 2] + 4 * a[i - 1] + 6 * a[i] + 4 * a[i + 1] + a[i + 2]) / 16;
      }
      a.set(b);
    }
  };
  smooth(side, false);
  smooth(up, true);
  const out = flat.slice();
  for (let i = 0; i < n; i++) {
    if (!side[i]) continue;
    // the surveyed line's left normal at this point (the same sign as Polyline.nearest's off)
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = flat[b * 2] - flat[a * 2], dz = flat[b * 2 + 1] - flat[a * 2 + 1], L = Math.hypot(dx, dz) || 1;
    out[i * 2] += (dz / L) * side[i];
    out[i * 2 + 1] += (-dx / L) * side[i];
  }
  return { flat: out, dip: up };
}

/** Where the line is closed and where its big vents go: worked out from the stations alone, so the bend
 *  (made before the Underground exists) and the Underground agree. stationHalfLength / ventEvery are
 *  TUNNEL.stationHalfLength and VENT.every. */
export function subwayPlan(stations: { ss: number; name: string }[], length: number, stationHalfLength: number, ventEvery: number) {
  const prince = stations.find((s) => /Prince/.test(s.name))?.ss ?? 2593;
  const end57 = stations.find((s) => /57 St/.test(s.name))?.ss ?? length - 20;
  const end = Math.min(length, end57 + stationHalfLength - 5);
  const blocked = [{ ss0: prince - 150, ss1: prince + 140 }, { ss0: end, ss1: length + 1000 }];
  const isBlocked = (ss: number) => blocked.some((b) => ss > b.ss0 && ss < b.ss1);
  // massive vents over the tunnel between stations, every 110-160 m (seeded by the line), two ways in for every
  // way out; clear of the stations (their stairs do that job) and the closed stretches
  const vents: { ss: number; out: boolean }[] = [];
  const h = (k: number) => { let x = Math.imul((k * 7919 + 13) | 0, 0x9e3779b1) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; return (x >>> 0) / 4294967296; };
  let k = 0;
  // (tools: globalThis.__fftt_oldVents = true lays them out as before: every 260 m, alternating)
  if ((globalThis as { __fftt_oldVents?: boolean }).__fftt_oldVents) {
    let flip = 0;
    for (let s = 150; s < end - 60; s += ventEvery) {
      let ss = s;
      const st = stations.find((q) => Math.abs(q.ss - ss) < stationHalfLength + 40);
      if (st) ss = st.ss + Math.sign(ss - st.ss || 1) * (stationHalfLength + 45);
      if (isBlocked(ss) || isBlocked(ss + 10) || isBlocked(ss - 10) || ss > end - 60) continue;
      if (stations.some((q) => Math.abs(q.ss - ss) < stationHalfLength + 30)) continue;
      vents.push({ ss, out: flip % 2 === 1 });
      flip++;
    }
    return { end, blocked, vents };
  }
  for (let ss = 140; ss < end - 60;) {
    const st = stations.find((q) => Math.abs(q.ss - ss) < stationHalfLength + 30);
    if (st) { ss = st.ss + stationHalfLength + 35; continue; }
    if (isBlocked(ss) || isBlocked(ss + 12) || isBlocked(ss - 12)) { ss += 20; continue; }
    vents.push({ ss, out: k % 3 === 2 });
    k++;
    ss += 110 + 50 * h(k);
  }
  void ventEvery;
  return { end, blocked, vents };
}
