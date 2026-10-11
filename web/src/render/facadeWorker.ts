// Decodes facade images off the main thread (render/facades.ts): fetch, scale to the array's size,
// read the pixels and flip the rows (image row 0 is the top of the tile; texture v = 1 is the top).
// With `mips` it also builds the whole mip chain (a box filter, colour averaged in linear light for the
// sRGB albedo, as the GPU's own mipmapping does), so the main thread can upload one layer at a time
// instead of re-sending (and re-mipmapping) the whole array.

// sRGB byte -> linear, and linear (0..1 in 1/4096 steps) -> sRGB byte
const toLin = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; toLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const toSrgb = new Uint8Array(4097);
for (let i = 0; i <= 4096; i++) { const l = i / 4096; const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055; toSrgb[i] = Math.max(0, Math.min(255, Math.round(c * 255))); }

function halve(src: Uint8Array, size: number, srgb: boolean): Uint8Array<ArrayBuffer> {
  const h = size >> 1, out = new Uint8Array(h * h * 4);
  for (let y = 0; y < h; y++) {
    const r0 = y * 2 * size * 4, r1 = r0 + size * 4;
    for (let x = 0; x < h; x++) {
      const a = r0 + x * 8, b = a + 4, c = r1 + x * 8, d = c + 4, o = (y * h + x) * 4;
      if (srgb) for (let k = 0; k < 3; k++) out[o + k] = toSrgb[Math.round((toLin[src[a + k]] + toLin[src[b + k]] + toLin[src[c + k]] + toLin[src[d + k]]) * 1024)];
      else for (let k = 0; k < 3; k++) out[o + k] = (src[a + k] + src[b + k] + src[c + k] + src[d + k] + 2) >> 2;
      out[o + 3] = (src[a + 3] + src[b + 3] + src[c + 3] + src[d + 3] + 2) >> 2;
    }
  }
  return out;
}

self.onmessage = async (e: MessageEvent<{ id: number; url: string; size: number; mips?: boolean; srgb?: boolean }>) => {
  const { id, url, size, mips, srgb } = e.data;
  try {
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none", resizeWidth: size, resizeHeight: size, resizeQuality: "high" });
    const cv = new OffscreenCanvas(size, size);
    const c = cv.getContext("2d", { willReadFrequently: true })!;
    c.clearRect(0, 0, size, size);
    c.drawImage(bmp, 0, 0);
    bmp.close();
    const src = c.getImageData(0, 0, size, size).data;
    const out = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) out.set(src.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    if (mips) {
      const levels: Uint8Array<ArrayBuffer>[] = [out];
      for (let s = size; s > 1; s >>= 1) levels.push(halve(levels[levels.length - 1], s, !!srgb));
      (self as unknown as Worker).postMessage({ id, data: out, levels }, levels.map((l) => l.buffer));
    } else {
      (self as unknown as Worker).postMessage({ id, data: out }, [out.buffer]);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
