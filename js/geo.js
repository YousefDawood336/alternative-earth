/*
 * Countries (non-NASA supporting data):
 *  - Borders: Natural Earth 1:50m via world-atlas (public domain)
 *  - Names & capitals: mledoze/countries (ODbL), snapshot in data/countries.json
 * Builds a borders texture and a fast pixel lookup: countryAt(lat, lon).
 */
import { feature, mesh } from "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";
import { geoEquirectangular, geoPath } from "https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/+esm";

export async function loadCountries({ bordersW = 4096, idW = 4096 } = {}) {
  const [topo, meta] = await Promise.all([
    fetch("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json").then((r) => r.json()),
    fetch(new URL("../data/countries.json", import.meta.url)).then((r) => r.json()),
  ]);
  const geo = feature(topo, topo.objects.countries);
  const borders = mesh(topo, topo.objects.countries, (a, b) => a !== b);

  // Borders texture (white lines on transparent)
  const bW = bordersW, bH = bordersW / 2;
  const bc = document.createElement("canvas"); bc.width = bW; bc.height = bH;
  const bctx = bc.getContext("2d");
  const bProj = geoEquirectangular().scale(bW / (2 * Math.PI)).translate([bW / 2, bH / 2]);
  bctx.strokeStyle = "rgba(255,255,255,1)"; bctx.lineWidth = bW / 4096; bctx.lineJoin = "round";
  bctx.beginPath(); geoPath(bProj, bctx)(borders); bctx.stroke();

  // ID raster: each country filled with a unique colour
  const iW = idW, iH = idW / 2;
  const ic = document.createElement("canvas"); ic.width = iW; ic.height = iH;
  const ictx = ic.getContext("2d", { willReadFrequently: true });
  const iProj = geoEquirectangular().scale(iW / (2 * Math.PI)).translate([iW / 2, iH / 2]);
  const ipath = geoPath(iProj, ictx);
  const list = geo.features.map((f) => {
    const m = meta.countries[String(parseInt(f.id, 10))] || {};
    return { name: m.name || f.properties.name, capital: m.capital || "", iso2: m.iso2 || "", region: m.region || "", subregion: m.subregion || "", landlocked: !!m.landlocked };
  });
  geo.features.forEach((f, i) => {
    const n = i + 1;
    ictx.fillStyle = `rgb(${n & 255},${(n >> 8) & 255},0)`;
    ictx.beginPath(); ipath(f); ictx.fill();
  });
  const ids = ictx.getImageData(0, 0, iW, iH).data;

  function countryAt(lat, lon) {
    const x = Math.floor(((lon + 180) / 360) * iW), y = Math.floor(((90 - lat) / 180) * iH);
    // check the pixel and its neighbours (edge pixels can be anti-aliased blends)
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = Math.min(iW - 1, Math.max(0, x + dx)), yy = Math.min(iH - 1, Math.max(0, y + dy));
      const o = (yy * iW + xx) * 4;
      if (ids[o + 3] < 250) continue;
      const n = ids[o] + (ids[o + 1] << 8);
      if (n > 0 && n <= list.length) return list[n - 1];
    }
    return null;
  }
  return { bordersCanvas: bc, countryAt };
}

/** 30.0444, 31.2357 → 30°02′40″N 31°14′09″E */
export function dms(lat, lon) {
  const f = (v, pos, neg) => {
    const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60);
    return `${d}°${String(m).padStart(2, "0")}′${String(s % 60).padStart(2, "0")}″${v >= 0 ? pos : neg}`;
  };
  return `${f(lat, "N", "S")} ${f(lon, "E", "W")}`;
}
