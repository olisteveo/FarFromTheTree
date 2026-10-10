// The distant city's data (public/far.dat, written by tools/build-city.ts): the land across the
// rivers and every building outside the playable corridor, as flat typed arrays. No three.js,
// so the far-city worker and the build tools can share it.

export interface FarData {
  /** land across the rivers: x,z pairs and triangle indices */
  landV: Float32Array;
  landI: Uint32Array;
  /** buildings: footprint ring i is verts[start[i]*2 .. (start[i]+count[i])*2) (x,z pairs, CCW) */
  start: Uint32Array;
  count: Uint16Array;
  type: Uint8Array;
  height: Float32Array;
  seed: Uint16Array;
  verts: Float32Array;
}

/** far.dat is gzipped; some servers decode it for us (Content-Encoding), some don't. */
export async function gunzipMaybe(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const b = new Uint8Array(buf);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return buf;
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return await new Response(stream).arrayBuffer();
}

export function decodeFar(buf: ArrayBuffer): FarData {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "FAR1") throw new Error("far.dat: bad magic " + magic);
  const nLV = dv.getUint32(4, true), nLT = dv.getUint32(8, true), nB = dv.getUint32(12, true);
  const Q = dv.getFloat32(16, true), OX = dv.getFloat32(20, true), OZ = dv.getFloat32(24, true);
  const ux = (v: number) => (v - 32768) * Q + OX, uz = (v: number) => (v - 32768) * Q + OZ;
  let o = 32;
  const landV = new Float32Array(nLV * 2);
  for (let i = 0; i < nLV; i++, o += 4) { landV[i * 2] = ux(dv.getUint16(o, true)); landV[i * 2 + 1] = uz(dv.getUint16(o + 2, true)); }
  const landI = new Uint32Array(nLT * 3);
  for (let i = 0; i < nLT * 3; i++, o += 4) landI[i] = dv.getUint32(o, true);
  // first pass: count vertices
  const start = new Uint32Array(nB), count = new Uint16Array(nB), type = new Uint8Array(nB), height = new Float32Array(nB), seed = new Uint16Array(nB);
  let nv = 0;
  {
    let p = o;
    for (let i = 0; i < nB; i++) { const n = dv.getUint8(p); start[i] = nv; count[i] = n; nv += n; p += 10 + (n - 1) * 4; }
  }
  const verts = new Float32Array(nv * 2);
  for (let i = 0; i < nB; i++) {
    const n = count[i];
    type[i] = dv.getUint8(o + 1);
    height[i] = dv.getUint16(o + 2, true) / 10;
    seed[i] = dv.getUint16(o + 4, true);
    let px = dv.getUint16(o + 6, true), pz = dv.getUint16(o + 8, true);
    o += 10;
    let w = start[i] * 2;
    verts[w++] = ux(px); verts[w++] = uz(pz);
    for (let k = 1; k < n; k++, o += 4) {
      px += dv.getInt16(o, true); pz += dv.getInt16(o + 2, true);
      verts[w++] = ux(px); verts[w++] = uz(pz);
    }
  }
  return { landV, landI, start, count, type, height, seed, verts };
}

// projection (same as tools/build-city.ts)
const rad = (d: number) => (d * Math.PI) / 180;
const KY = 111132.954 - 559.822 * Math.cos(2 * rad(40.74)) + 1.175 * Math.cos(4 * rad(40.74));
const KX = 111412.84 * Math.cos(rad(40.74)) - 93.5 * Math.cos(3 * rad(40.74));
const GC = Math.cos(rad(28.9)), GS = Math.sin(rad(28.9));
export function projLL(lat: number, lon: number): [number, number] {
  const e = (lon + 74.017) * KX, n = (lat - 40.7033) * KY;
  return [-(e * GC - n * GS), e * GS + n * GC];
}

