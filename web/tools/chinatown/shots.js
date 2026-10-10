// CDP steps for tools/entrances/cdp.mjs: hide the HUD, wait for the Chinatown assets, screenshot a few cams, print stats.
//   CT_CAMS="ct_gate=-601,7,2331,-172,-5;ct_route=at:2150,6" node tools/entrances/cdp.mjs "?nointro&cam=-601,7,2331,-172,-5" tools/chinatown/shots.js 5173
// (CT_CAMS: name=x,y,z,yaw,pitch (free cam) or name=at:s,height (flying);... the first must match the start query; CT_Q=low for phones)
const cams = (process.env.CT_CAMS || "ct_gate=-601,7,2331,-172,-5").split(";").map((s) => s.split("="));
const hide = `const keep = new Set(); for (const c of document.querySelectorAll('canvas')) { let e = c; while (e) { keep.add(e); e = e.parentElement; } }
  for (const e of document.body.querySelectorAll('*')) if (!keep.has(e) && !e.closest('canvas')) { if ([...keep].some((k) => e.contains(k))) continue; e.style.visibility = 'hidden'; } return 1;`;
for (let i = 0; i < 120; i++) { if (await ev("return !!(window.ffttViews && ffttViews.chinatown && ffttViews.chinatown.ready)")) break; await sleep(500); }
await sleep(9000);
for (const [name, cam] of cams) {
  if (name !== cams[0][0]) { await nav("?nointro&" + (cam.startsWith("at:") ? "at=" + cam.slice(3) : "cam=" + cam) + (process.env.CT_Q ? "&q=" + process.env.CT_Q : "") + (process.env.CT_EXTRA || "")); for (let i = 0; i < 120; i++) { if (await ev("return !!(window.ffttViews && ffttViews.chinatown && ffttViews.chinatown.ready)")) break; await sleep(500); } await sleep(4000); }
  await ev(hide);
  await sleep(1500);
  await shot(name);
}
console.log(JSON.stringify(await ev(`
  const r = fftt.stage.renderer, info = r.info;
  let geo = 0, tex = 0; const seenG = new Set(), seenT = new Set();
  fftt.stage.scene.traverse((o) => {
    if (o.geometry && !seenG.has(o.geometry)) { seenG.add(o.geometry); for (const a of Object.values(o.geometry.attributes)) geo += a.array ? a.array.byteLength : 0; if (o.geometry.index && o.geometry.index.array) geo += o.geometry.index.array.byteLength; }
    for (const m of [].concat(o.material || [])) for (const k in m) { const t = m[k]; if (t && t.isTexture && !seenT.has(t)) { seenT.add(t); const im = t.image; if (im && im.width) tex += im.width * im.height * 4 * (im.depth || 1) * 1.33; } }
  });
  return { quality: fftt.stage.quality, chinatown: ffttViews.chinatown.stats, sceneGeoMB: +(geo / 1e6).toFixed(1), sceneTexMB: +(tex / 1e6).toFixed(1), gpuGeometries: info.memory.geometries, gpuTextures: info.memory.textures, calls: info.render.calls, tris: info.render.triangles,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(0) : null };
`)));
