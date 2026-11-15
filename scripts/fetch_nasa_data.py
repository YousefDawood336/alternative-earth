"""
Snapshot NASA datasets that browsers cannot fetch directly (no CORS) into data/nasa/*.json.
Run from the project root:  py scripts/fetch_nasa_data.py
Sources that DO allow browser access (GIBS, EONET, Image Library, EPIC, APOD) are read live by js/nasa.js.
"""
import csv, io, json, os, re, sys, time, urllib.request, urllib.parse
from datetime import datetime, timezone

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "nasa")
os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "alternative-earth-site/1.0 (data snapshot script)"}
report = []


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def save(name, payload):
    payload["fetched"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    report.append(f"OK   {name}")


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# 1. GISTEMP v4 global annual mean temperature anomaly (vs 1951-1980)
def gistemp_global():
    url = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv"
    rows = list(csv.reader(io.StringIO(fetch(url))))
    hdr = rows[1]
    i_year, i_jd = hdr.index("Year"), hdr.index("J-D")
    series = [[int(r[i_year]), num(r[i_jd])] for r in rows[2:] if r and r[0].isdigit() and num(r[i_jd]) is not None]
    save("gistemp_global.json", {
        "source": "NASA GISS Surface Temperature Analysis (GISTEMP v4)",
        "url": url, "baseline": "1951-1980", "units": "degC", "series": series})


# 2. GISTEMP v4 zonal annual anomalies (for latitude pattern / polar amplification)
def gistemp_zonal():
    url = "https://data.giss.nasa.gov/gistemp/tabledata_v4/ZonAnn.Ts+dSST.csv"
    rows = list(csv.reader(io.StringIO(fetch(url))))
    hdr = rows[0]
    bands = ["64N-90N", "44N-64N", "24N-44N", "EQU-24N", "24S-EQU", "44S-24S", "64S-44S", "90S-64S"]
    idx = {b: hdr.index(b) for b in bands}
    data = {b: [] for b in bands}
    for r in rows[1:]:
        if r and r[0].isdigit():
            for b in bands:
                v = num(r[idx[b]])
                if v is not None:
                    data[b].append([int(r[0]), v])
    save("gistemp_zonal.json", {
        "source": "NASA GISS GISTEMP v4 zonal annual means", "url": url,
        "baseline": "1951-1980", "units": "degC", "bands": data})


# 3. Greenhouse gas history used by NASA GISS climate models
def ghg_history():
    url = "https://data.giss.nasa.gov/modelforce/ghgases/Fig1A.ext.txt"
    txt = fetch(url)
    series = []
    for line in txt.splitlines():
        p = line.split()
        if len(p) >= 2 and re.fullmatch(r"\d{4}(\.\d+)?", p[0]) and num(p[1]):
            series.append([int(float(p[0])), num(p[1])])
    if not series:
        raise ValueError("no rows parsed")
    save("co2_history.json", {"source": "NASA GISS greenhouse gas history (CO2, ppm)", "url": url, "units": "ppm", "series": series})


# 4. NASA Technical Reports Server: climate documents
def ntrs_documents():
    queries = ["climate projection", "sea level rise", "ice sheet mass loss", "wildfire climate",
               "tropical cyclone intensity", "drought", "air quality satellite", "coral reef", "deforestation", "radiative forcing"]
    docs, seen = [], set()
    for q in queries:
        url = "https://ntrs.nasa.gov/api/citations/search?" + urllib.parse.urlencode({"q": q, "page.size": 8})
        try:
            res = json.loads(fetch(url)).get("results", [])
        except Exception as e:
            report.append(f"WARN ntrs '{q}': {e}")
            continue
        for d in res:
            if d.get("id") in seen:
                continue
            seen.add(d.get("id"))
            pdf = next((dl.get("links", {}).get("pdf") for dl in d.get("downloads", []) if dl.get("links", {}).get("pdf")), None)
            docs.append({
                "id": d.get("id"), "topic": q, "title": d.get("title"),
                "abstract": (d.get("abstract") or "")[:600],
                "authors": [a.get("meta", {}).get("author", {}).get("name") for a in d.get("authorAffiliations", [])][:4],
                "date": (d.get("publications") or [{}])[0].get("publicationDate") or d.get("submittedDate"),
                "type": d.get("stiType"),
                "url": f"https://ntrs.nasa.gov/citations/{d.get('id')}",
                "pdf": ("https://ntrs.nasa.gov" + pdf) if pdf else None,
            })
    save("documents.json", {"source": "NASA Technical Reports Server (NTRS)", "url": "https://ntrs.nasa.gov", "documents": docs})


# 5. (non-NASA) Country names + capitals keyed by ISO numeric code, matching Natural Earth / world-atlas ids
def countries():
    url = "https://cdn.jsdelivr.net/gh/mledoze/countries@master/countries.json"
    rows = json.loads(fetch(url))
    out = {}
    for c in rows:
        code = c.get("ccn3")
        if code:
            out[str(int(code))] = {"name": c["name"]["common"], "capital": ", ".join(c.get("capital") or []), "iso2": c.get("cca2"),
                                   "region": c.get("region"), "subregion": c.get("subregion"),
                                   "latlng": c.get("latlng"), "landlocked": c.get("landlocked")}
    with open(os.path.join(os.path.dirname(OUT), "countries.json"), "w", encoding="utf-8") as f:
        json.dump({"source": "mledoze/countries (ODbL)", "url": url, "countries": out}, f, ensure_ascii=False, separators=(",", ":"))
    report.append(f"OK   ../countries.json ({len(out)} countries)")


# 6. (non-NASA) Species photos from Wikipedia / Wikimedia Commons, for the titles listed in js/species.js
def species_images():
    src = open(os.path.join(os.path.dirname(OUT), "..", "js", "species.js"), encoding="utf-8").read()
    titles = re.findall(r'wiki:\s*"([^"]+)"', src)
    out = {}
    for t in titles:
        url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(t.replace(" ", "_"), safe="")
        d = None
        for attempt in range(4):  # be polite: pause between requests, back off on HTTP 429
            time.sleep(1.2 + attempt * 3)
            try:
                d = json.loads(fetch(url))
                break
            except Exception as e:
                err = e
        if d is None:
            report.append(f"WARN wiki '{t}': {err}")
            continue
        img = (d.get("thumbnail") or {}).get("source")
        if img:  # Wikimedia only serves standard thumbnail widths (e.g. 500px)
            img = re.sub(r"/(\d+)px-", "/500px-", img.split("?")[0])
        out[t] = {"img": img, "page": (d.get("content_urls") or {}).get("desktop", {}).get("page"), "extract": (d.get("extract") or "")[:400]}
    with open(os.path.join(os.path.dirname(OUT), "species_images.json"), "w", encoding="utf-8") as f:
        json.dump({"source": "Wikipedia / Wikimedia Commons (see each page for image licence)", "species": out}, f, ensure_ascii=False, separators=(",", ":"))
    missing = [t for t in titles if not (out.get(t) or {}).get("img")]
    report.append(f"OK   ../species_images.json ({len(out)} pages, missing images: {missing})")


for job in (gistemp_global, gistemp_zonal, ghg_history, ntrs_documents, countries, species_images):
    try:
        job()
    except Exception as e:
        report.append(f"FAIL {job.__name__}: {e}")

print("\n".join(report))
sys.exit(0)
