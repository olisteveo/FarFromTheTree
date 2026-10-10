// Decodes facade images off the main thread (render/facades.ts): fetch, scale to the array's size,
// read the pixels and flip the rows (image row 0 is the top of the tile; texture v = 1 is the top).

self.onmessage = async (e: MessageEvent<{ id: number; url: string; size: number }>) => {
  const { id, url, size } = e.data;
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
    (self as unknown as Worker).postMessage({ id, data: out }, [out.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
