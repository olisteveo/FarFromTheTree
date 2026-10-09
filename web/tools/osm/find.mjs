for (const q of process.argv.slice(2)) {
  const url = "https://api.us.socrata.com/api/catalog/v1?" + new URLSearchParams({ domains: "data.cityofnewyork.us", q, limit: "6" });
  try {
    const r = await fetch(url, { headers: { "User-Agent": "FarFromTheTree/0.1" } });
    const d = await r.json();
    console.log("==", q);
    for (const x of d.results ?? []) console.log("  ", x.resource.id, "|", x.resource.name.slice(0, 70), "|", x.resource.type);
  } catch (e) { console.log("==", q, "ERR", e.message); }
  await new Promise((r) => setTimeout(r, 800));
}
