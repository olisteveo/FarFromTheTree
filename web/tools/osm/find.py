import json, sys, urllib.parse, urllib.request, time
for q in sys.argv[1:]:
    url = "https://api.us.socrata.com/api/catalog/v1?" + urllib.parse.urlencode({"domains": "data.cityofnewyork.us", "q": q, "limit": 6})
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "FarFromTheTree/0.1"}), timeout=60))
    except Exception as e:
        print("==", q, "ERR", e); time.sleep(2); continue
    print("==", q)
    for r in d.get("results", []):
        x = r["resource"]; print("  ", x["id"], "|", x["name"][:70], "|", x.get("type"))
    time.sleep(1)
