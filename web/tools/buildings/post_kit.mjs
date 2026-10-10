// Pack the Tesseract-rendered kit atlas into the game texture:
//   node post_kit.mjs <work dir> <models dir>
// kit_a.png (colour) + kit_m.png (white solid / black cut-out) -> buildings_kit.webp (RGBA)
// lot_asphalt.png, site_dirt.png -> buildings_lot_asphalt.webp, buildings_site_dirt.webp
import sharp from "sharp";
import path from "node:path";

const [work, out] = process.argv.slice(2);
const a = await sharp(path.join(work, "kit_a.png")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const m = await sharp(path.join(work, "kit_m.png")).removeAlpha().resize(a.info.width, a.info.height).raw().toBuffer();
const n = a.info.width * a.info.height;
const rgba = Buffer.alloc(n * 4);
for (let i = 0; i < n; i++) {
  rgba[i * 4] = a.data[i * 3]; rgba[i * 4 + 1] = a.data[i * 3 + 1]; rgba[i * 4 + 2] = a.data[i * 3 + 2];
  rgba[i * 4 + 3] = m[i * 3] > 127 ? 255 : 0;
}
await sharp(rgba, { raw: { width: a.info.width, height: a.info.height, channels: 4 } })
  .webp({ quality: 86, alphaQuality: 100, effort: 5 }).toFile(path.join(out, "buildings_kit.webp"));
await sharp(rgba, { raw: { width: a.info.width, height: a.info.height, channels: 4 } }).png().toFile(path.join(work, "kit_rgba.png"));
for (const [src, dst] of [["lot_asphalt.png", "buildings_lot_asphalt.webp"], ["site_dirt.png", "buildings_site_dirt.webp"]]) {
  await sharp(path.join(work, src)).removeAlpha().webp({ quality: 84, effort: 5 }).toFile(path.join(out, dst));
}
console.log("kit atlas packed");
