// The driveable network, built from the real street centrelines: a lane per lane on every block, and through each
// junction a connector from each lane that may go there to the lane it leads to, knowing which other connectors it
// crosses. world/traffic.ts drives vehicles along it. Lane positions match what the street furniture keeps clear
// (render/streetLayout.ts laneCentres) and what the road wear is drawn along (tools/ground/road_field.ts).

import type { CityData } from "./data";
import type { SignalNode } from "./signals";

export interface Lane {
  id: number;
  x: Float32Array; z: Float32Array; cum: Float32Array; len: number;
  /** for a block lane: the connectors out of its far end, -1 straight on, turning ones after. For a connector: the lane it joins */
  out: number[];
  /** a connector's other connectors it would hit, and which junction it's in. -1 node means a block lane */
  conflicts: number[];
  node: number;
  /** a connector: speed limit factor for the bend */
  bend: number;
  /** a block lane's signal phase group at its far end (0, 1), -1 if the node has no signal */
  group: number;
  /** does anything feed this lane? (if not, it's somewhere new traffic can come from) */
  fed: boolean;
  /** straight on, right, left: for the choice at the junction (connectors only) */
  turn: number;
}

export interface NetNode { x: number; z: number; r: number; signal: number; arms: number }

export interface RoadNet { lanes: Lane[]; nodes: NetNode[]; blockLanes: number[] }

interface Directed { node0: number; node1: number; px: number[]; pz: number[]; name: string; lanes: number[]; offsets: number[]; tx0: number; tz0: number; tx1: number; tz1: number }

const STOP_LINE = 10.6;

function polyLane(id: number, xs: number[], zs: number[], node: number, bend = 1, turn = 0): Lane {
  const n = xs.length, x = new Float32Array(xs), z = new Float32Array(zs), cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
  return { id, x, z, cum, len: Math.max(cum[n - 1], 0.01), out: [], conflicts: [], node, bend, group: -1, fed: false, turn };
}

/** A polyline with its ends cut back, offset sideways (+ is right of travel), corners mitred. */
function offsetTrim(px: number[], pz: number[], off: number, trimA: number, trimB: number): { x: number[]; z: number[] } {
  const n = px.length, ox: number[] = [], oz: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let tx = px[b] - px[a], tz = pz[b] - pz[a];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    // right of travel, with y up and east = -x, is (-tz, tx) (as it's always been in traffic.ts)
    ox.push(px[i] - tz * off); oz.push(pz[i] + tx * off);
  }
  const cut = (xs: number[], zs: number[], d: number) => {
    let left = d;
    while (xs.length > 2) {
      const L = Math.hypot(xs[1] - xs[0], zs[1] - zs[0]);
      if (L > left) break;
      left -= L; xs.shift(); zs.shift();
    }
    const L = Math.hypot(xs[1] - xs[0], zs[1] - zs[0]) || 1, k = Math.min(0.95, left / L);
    xs[0] += (xs[1] - xs[0]) * k; zs[0] += (zs[1] - zs[0]) * k;
  };
  cut(ox, oz, trimA);
  ox.reverse(); oz.reverse();
  cut(ox, oz, trimB);
  ox.reverse(); oz.reverse();
  return { x: ox, z: oz };
}

export function buildRoadNet(city: CityData, closed: { x: number; z: number; r: number }[], signals: SignalNode[]): RoadNet {
  const nodes: NetNode[] = [];
  const nodeMap = new Map<string, number>();
  const nodeAt = (x: number, z: number) => {
    const kx = Math.round(x / 3), kz = Math.round(z / 3);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const k = nodeMap.get(kx + i + "," + (kz + j));
      if (k !== undefined && Math.hypot(nodes[k].x - x, nodes[k].z - z) < 3) return k;
    }
    nodes.push({ x, z, r: 0, signal: -1, arms: 0 });
    nodeMap.set(kx + "," + kz, nodes.length - 1);
    return nodes.length - 1;
  };
  const shut = (x: number, z: number) => closed.some((b) => (x - b.x) ** 2 + (z - b.z) ** 2 < (b.r + 4) ** 2);

  // ---- directed blocks
  const edges: Directed[] = [];
  const names = new Map<number, Set<string>>();
  const halfWidth = new Map<number, number>();
  // the data sometimes draws a stretch of street twice: a short piece lying along a longer one of the same name
  const driveable = city.raw.streets.filter((st) => st.rw === 1 && st.p.length >= 4);
  const lengthOf = (p: number[]) => { let t = 0; for (let i = 0; i + 3 < p.length; i += 2) t += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); return t; };
  const distTo = (p: number[], x: number, z: number) => {
    let best = 1e9;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], t = Math.max(0, Math.min(1, ((x - p[i]) * dx + (z - p[i + 1]) * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, Math.hypot(p[i] + dx * t - x, p[i + 1] + dz * t - z));
    }
    return best;
  };
  const byName = new Map<string, typeof driveable>();
  for (const st of driveable) (byName.get(st.n) ?? byName.set(st.n, []).get(st.n)!).push(st);
  const lyingOnAnother = (st: (typeof driveable)[number]) => (byName.get(st.n) ?? []).some((o) => {
    if (o === st || lengthOf(o.p) <= lengthOf(st.p)) return false;
    for (let i = 0; i < st.p.length; i += 2) if (distTo(o.p, st.p[i], st.p[i + 1]) > 3) return false;
    return true;
  });
  for (const st of driveable) {
    if (lyingOnAnother(st)) continue;
    const xs: number[] = [], zs: number[] = [];
    for (let i = 0; i < st.p.length; i += 2) { xs.push(st.p[i]); zs.push(st.p[i + 1]); }
    const midI = xs.length >> 1;
    if (shut(xs[0], zs[0]) || shut(xs[xs.length - 1], zs[zs.length - 1]) || shut(xs[midI], zs[midI])) continue;
    const a = nodeAt(xs[0], zs[0]), b = nodeAt(xs[xs.length - 1], zs[zs.length - 1]);
    if (a === b) continue;
    for (const n of [a, b]) {
      (names.get(n) ?? names.set(n, new Set()).get(n)!).add(st.n);
      halfWidth.set(n, Math.max(halfWidth.get(n) ?? 0, st.w / 2));
    }
    const lanes = Math.min(4, Math.max(1, st.l)), step = Math.min(3.3, st.w / lanes);
    const add = (forward: boolean, offsets: number[]) => {
      const px = forward ? xs : [...xs].reverse(), pz = forward ? zs : [...zs].reverse();
      const n = px.length, l0 = Math.hypot(px[1] - px[0], pz[1] - pz[0]) || 1, l1 = Math.hypot(px[n - 1] - px[n - 2], pz[n - 1] - pz[n - 2]) || 1;
      edges.push({
        node0: forward ? a : b, node1: forward ? b : a, px, pz, name: st.n, lanes: [], offsets,
        tx0: (px[1] - px[0]) / l0, tz0: (pz[1] - pz[0]) / l0, tx1: (px[n - 1] - px[n - 2]) / l1, tz1: (pz[n - 1] - pz[n - 2]) / l1,
      });
    };
    if (st.d === 0) {
      const nl = Math.max(1, Math.floor(lanes / 2)), offs = Array.from({ length: nl }, (_, l) => (l + 0.5) * step);
      add(true, offs); add(false, offs);
    } else {
      const offs = Array.from({ length: lanes }, (_, l) => (l - (lanes - 1) / 2) * step);
      add(st.d > 0, offs);
    }
  }
  // ---- how far back from each junction the lanes stop
  for (const [n, set] of names) if (set.size > 1) nodes[n].r = (halfWidth.get(n) ?? 3) + 1.5;
  for (const [i, s] of signals.entries()) {
    const n = nodes.findIndex((m) => Math.hypot(m.x - s.x, m.z - s.z) < 4);
    if (n >= 0 && (names.get(n)?.size ?? 0) > 1) nodes[n].signal = i;
  }

  // ---- lanes
  const lanes: Lane[] = [];
  const blockLanes: number[] = [];
  const inAt = new Map<number, { e: Directed; lane: number; idx: number }[]>(), outAt = new Map<number, { e: Directed; lane: number; idx: number }[]>();
  for (const e of edges) {
    let total = 0;
    for (let i = 1; i < e.px.length; i++) total += Math.hypot(e.px[i] - e.px[i - 1], e.pz[i] - e.pz[i - 1]);
    // arriving, wait at the painted stop line (render/ground.ts paints it 10.1 m back from the junction's centre, behind the crosswalk)
    const ra = nodes[e.node0].r, rb = nodes[e.node1].r > 0 ? Math.max(nodes[e.node1].r, STOP_LINE) : 0, k = ra + rb > total * 0.8 ? (total * 0.8) / (ra + rb) : 1;
    e.offsets.forEach((off, idx) => {
      const p = offsetTrim(e.px, e.pz, off, ra * k, rb * k);
      const l = polyLane(lanes.length, p.x, p.z, -1);
      if (nodes[e.node1].signal >= 0) {
        // obey the head that faces this approach. If none does (odd angles in the data), give way instead: no driver
        // should stop for a light nobody can see
        const s = signals[nodes[e.node1].signal];
        const facing = s.heads.reduce<{ vx: number; vz: number; group: number } | null>((best, h) => {
          const d = e.tx1 * h.vx + e.tz1 * h.vz;
          return d > 0.55 && (!best || d > e.tx1 * best.vx + e.tz1 * best.vz) ? h : best;
        }, null);
        l.group = facing ? facing.group : -1;
      }
      lanes.push(l); blockLanes.push(l.id); e.lanes.push(l.id);
      (inAt.get(e.node1) ?? inAt.set(e.node1, []).get(e.node1)!).push({ e, lane: l.id, idx });
      (outAt.get(e.node0) ?? outAt.set(e.node0, []).get(e.node0)!).push({ e, lane: l.id, idx });
    });
  }

  // ---- where streets meet at a shallow angle, a queue at one stop line would sit in the neighbouring lane: pull that
  // stop line back until a waiting vehicle (and the width of one beside it) clears everything else at the junction
  const trimEnd = (l: Lane, d: number) => {
    const n = l.x.length, x = Array.from(l.x), z = Array.from(l.z);
    let left = d;
    while (x.length > 2) {
      const L = Math.hypot(x[x.length - 1] - x[x.length - 2], z[z.length - 1] - z[z.length - 2]);
      if (L > left) break;
      left -= L; x.pop(); z.pop();
    }
    const m = x.length, L = Math.hypot(x[m - 1] - x[m - 2], z[m - 1] - z[m - 2]) || 1, k = Math.min(0.9, left / L);
    x[m - 1] -= (x[m - 1] - x[m - 2]) * k; z[m - 1] -= (z[m - 1] - z[m - 2]) * k;
    void n;
    const fresh = polyLane(l.id, x, z, -1);
    l.x = fresh.x; l.z = fresh.z; l.cum = fresh.cum; l.len = fresh.len;
  };
  const CLEAR_QUEUE = 2.3;
  nodes.forEach((_, n) => {
    const ins = inAt.get(n) ?? [], outs = outAt.get(n) ?? [];
    if (ins.length + outs.length < 3) return;
    const others = [...ins, ...outs];
    for (const me of ins) {
      for (let pull = 0; pull < 8; pull++) {
        const L = lanes[me.lane];
        if (L.len < 14) break;
        const ex = L.x[L.x.length - 1], ez = L.z[L.z.length - 1];
        // the front of a waiting vehicle, and a car's length behind it
        const tx = L.x[L.x.length - 1] - L.x[L.x.length - 2], tz = L.z[L.z.length - 1] - L.z[L.z.length - 2], tl = Math.hypot(tx, tz) || 1;
        let close = false;
        for (const o of others) {
          if (o.e === me.e) continue;
          const O = lanes[o.lane];
          // only the part of the other lane near this junction: its end if it arrives here, its start if it leaves
          const arriving = o.e.node1 === n, last = O.x.length - 1;
          const ax = arriving ? O.x[last] : O.x[0], az = arriving ? O.z[last] : O.z[0];
          const bx = arriving ? O.x[Math.max(0, last - 1)] : O.x[1], bz = arriving ? O.z[Math.max(0, last - 1)] : O.z[1];
          const bl = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / bl, uz = (bz - az) / bl, reach = Math.min(bl, 18);
          // parallel ones are neighbours on purpose
          if (Math.abs((tx / tl) * ux + (tz / tl) * uz) > 0.985) continue;
          for (const back of [0, 3, 6]) {
            const px = ex - (tx / tl) * back, pz = ez - (tz / tl) * back;
            const along = Math.max(0, Math.min(reach, (px - ax) * ux + (pz - az) * uz));
            if (Math.hypot(ax + ux * along - px, az + uz * along - pz) < CLEAR_QUEUE) { close = true; break; }
          }
          if (close) break;
        }
        if (!close) break;
        trimEnd(L, 2);
      }
    }
  });

  // ---- connectors, junction by junction
  const lastOf = (l: Lane) => [l.x[l.x.length - 1], l.z[l.z.length - 1]];
  const addConnector = (from: Lane, to: Lane, node: number, inT: [number, number], outT: [number, number], turn: number) => {
    const [ax, az] = lastOf(from), bx = to.x[0], bz = to.z[0];
    const span = Math.hypot(bx - ax, bz - az);
    const xs: number[] = [], zs: number[] = [];
    const cross = inT[0] * outT[1] - inT[1] * outT[0];
    const back = inT[0] * outT[0] + inT[1] * outT[1] < -0.8;
    if (back && span >= 0.3) {
      // turning round: out past the lane's end and back
      const cx = (ax + bx) / 2 + inT[0] * Math.max(4, span), cz = (az + bz) / 2 + inT[1] * Math.max(4, span);
      for (let i = 0; i <= 8; i++) {
        const k = i / 8, m = 1 - k;
        xs.push(m * m * ax + 2 * m * k * cx + k * k * bx); zs.push(m * m * az + 2 * m * k * cz + k * k * bz);
      }
    } else if (span < 0.3 || Math.abs(cross) < 0.2) {
      xs.push(ax, bx); zs.push(az, bz);
    } else {
      // a quadratic through the point where the two lanes' lines meet
      const dx = bx - ax, dz = bz - az, t = (dx * outT[1] - dz * outT[0]) / cross;
      const cx = t > 0 && t < span * 2 ? ax + inT[0] * t : (ax + bx) / 2, cz = t > 0 && t < span * 2 ? az + inT[1] * t : (az + bz) / 2;
      for (let i = 0; i <= 8; i++) {
        const k = i / 8, m = 1 - k;
        xs.push(m * m * ax + 2 * m * k * cx + k * k * bx); zs.push(m * m * az + 2 * m * k * cz + k * k * bz);
      }
    }
    const c = polyLane(lanes.length, xs, zs, node, turn === 0 ? 1 : 0.5, turn);
    c.out = [to.id];
    to.fed = true;
    lanes.push(c);
    from.out.push(c.id);
    return c;
  };
  const connectorsAt: number[][] = [];
  nodes.forEach((_, n) => {
    const ins = inAt.get(n) ?? [], outs = outAt.get(n) ?? [];
    const here: number[] = [];
    const seen = new Set<Directed>();
    for (const i of ins) {
      if (seen.has(i.e)) continue;
      seen.add(i.e);
      const inT: [number, number] = [i.e.tx1, i.e.tz1];
      const outEdges = [...new Set(outs.map((o) => o.e))];
      for (const oe of outEdges) {
        const outT: [number, number] = [oe.tx0, oe.tz0];
        const dot = inT[0] * outT[0] + inT[1] * outT[1];
        const side = inT[0] * outT[1] - inT[1] * outT[0]; // >0 is a right turn: right of travel is (-tz, tx)
        // no U-turns, unless there's nowhere else to go: it beats vanishing in front of a closure
        if (dot < -0.8 && outEdges.some((other) => inT[0] * other.tx0 + inT[1] * other.tz0 >= -0.8)) continue;
        const turn = dot > 0.7 ? 0 : side > 0 ? 1 : 2;
        const ni = i.e.lanes.length, no = oe.lanes.length;
        if (turn === 0) {
          for (let k = 0; k < ni; k++) {
            const j = Math.min(no - 1, Math.round((k / Math.max(1, ni - 1)) * (no - 1)));
            here.push(addConnector(lanes[i.e.lanes[k]], lanes[oe.lanes[j]], n, inT, outT, 0).id);
            // drivers shift a lane across a junction when the next one's emptier: the only lane changing they do,
            // and it stops one lane queueing back a block while the next stands empty
            if (nodes[n].r > 0) for (const side of [j - 1, j + 1]) if (side >= 0 && side < no) here.push(addConnector(lanes[i.e.lanes[k]], lanes[oe.lanes[side]], n, inT, outT, 0).id);
          }
        } else {
          // right turns from the rightmost lane into the rightmost lane, left from the leftmost
          const a = turn === 1 ? ni - 1 : 0, b = turn === 1 ? no - 1 : 0;
          here.push(addConnector(lanes[i.e.lanes[a]], lanes[oe.lanes[b]], n, inT, outT, turn).id);
        }
      }
    }
    connectorsAt.push(here);
  });
  // a lane that can only go straight where there's no straight on still needs somewhere to go: let the others' turns serve it
  for (const e of edges) {
    const reach = e.lanes.flatMap((l) => lanes[l].out);
    if (!reach.length) continue;
    for (const l of e.lanes) {
      const L = lanes[l];
      if (L.out.length) continue;
      const near = lanes[reach[0]];
      const inT: [number, number] = [e.tx1, e.tz1];
      const to = lanes[near.out[0]];
      const n = to.x.length > 1 ? Math.hypot(to.x[1] - to.x[0], to.z[1] - to.z[0]) || 1 : 1;
      const c = addConnector(L, to, e.node1, inT, [(to.x[1] - to.x[0]) / n, (to.z[1] - to.z[0]) / n], near.turn);
      connectorsAt[e.node1].push(c.id);
    }
  }
  // ---- which connectors would hit each other
  // (points every metre or so: a straight connector is only two points, and could cross another between them)
  const dense = (l: Lane) => {
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < l.x.length; i++) {
      const steps = Math.max(1, Math.ceil(Math.hypot(l.x[i + 1] - l.x[i], l.z[i + 1] - l.z[i])));
      for (let k = 0; k <= steps; k++) out.push([l.x[i] + (l.x[i + 1] - l.x[i]) * (k / steps), l.z[i] + (l.z[i + 1] - l.z[i]) * (k / steps)]);
    }
    return out;
  };
  const CLEAR = 2.6; // two bodies side by side, centre to centre, plus the points' spacing
  const hits = (a: [number, number][], b: [number, number][]) => {
    // compared at every other point: a body is far wider than the gap that leaves
    for (let i = 0; i < a.length; i += 2) for (let j = 0; j < b.length; j += 2) {
      const dx = a[i][0] - b[j][0], dz = a[i][1] - b[j][1];
      if (dx * dx + dz * dz < CLEAR * CLEAR) return true;
    }
    return false;
  };
  for (const list of connectorsAt) {
    const paths = list.map((c) => dense(lanes[c]));
    const boxes = paths.map((p) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); } return [x0 - CLEAR, x1 + CLEAR, z0 - CLEAR, z1 + CLEAR]; });
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = lanes[list[i]], b = lanes[list[j]], A = boxes[i], B = boxes[j];
      if (A[1] < B[0] || B[1] < A[0] || A[3] < B[2] || B[3] < A[2]) continue;
      if (hits(paths[i], paths[j])) { a.conflicts.push(b.id); b.conflicts.push(a.id); }
    }
  }
  return { lanes, nodes, blockLanes };
}
