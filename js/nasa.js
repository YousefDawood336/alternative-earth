/*
 * NASA data layer — the single source of data for this website.
 * Every page reads through this module; nothing else talks to the network.
 *
 * Live (browser-accessible, CORS-enabled) NASA services:
 *   GIBS   – Global Imagery Browse Services (Earth textures, elevation, live layers)
 *   EONET  – Earth Observatory Natural Event Tracker (real-time events)
 *   Images – NASA Image & Video Library (videos)
 *   EPIC   – DSCOVR Earth Polychromatic Imaging Camera (daily Earth photo)
 * Snapshots (no CORS, refreshed with scripts/fetch_nasa_data.py → data/nasa/*.json):
 *   GISTEMP v4 global + zonal temperature, GISS CO₂ history, NTRS documents
 */

const GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";
const GIBS_COLORMAPS = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/";
const EONET = "https://eonet.gsfc.nasa.gov/api/v3";
const IMAGES = "https://images-api.nasa.gov";
const EPIC = "https://epic.gsfc.nasa.gov";
const CACHE_MIN = 30;

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function cacheGet(k) {
  try {
    const raw = sessionStorage.getItem("nasa:" + k);
    if (!raw) return null;
    const { t, d } = JSON.parse(raw);
    return Date.now() - t < CACHE_MIN * 60000 ? d : null;
  } catch { return null; }
}
function cacheSet(k, d) {
  try { sessionStorage.setItem("nasa:" + k, JSON.stringify({ t: Date.now(), d })); } catch {}
}

async function getJSON(url) {
  const hit = cacheGet(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NASA source returned ${res.status}`);
  const data = await res.json();
  cacheSet(url, data);
  return data;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load NASA image layer"));
    img.src = src;
  });
}

/** GIBS WMS GetMap URL for a whole-Earth equirectangular image. */
export function gibsMap(layer, { w = 2048, h = 1024, png = false, time, transparent = false } = {}) {
  const p = new URLSearchParams({
    SERVICE: "WMS", REQUEST: "GetMap", VERSION: "1.3.0", LAYERS: layer, CRS: "EPSG:4326",
    BBOX: "-90,-180,90,180", WIDTH: w, HEIGHT: h, FORMAT: png ? "image/png" : "image/jpeg",
  });
  if (transparent) p.set("TRANSPARENT", "true");
  if (time) p.set("TIME", time);
  return `${GIBS_WMS}?${p}`;
}

/** NASA imagery layers used by the Earth viewers. */
export const LAYERS = {
  // Blue Marble with shaded relief + ocean bathymetry: realistic sea floor shading, no clouds, no night side
  dayLow: () => gibsMap("BlueMarble_ShadedRelief_Bathymetry", { w: 2048, h: 1024 }),
  day: () => gibsMap("BlueMarble_ShadedRelief_Bathymetry", { w: 8192, h: 4096 }),
  liveTrue: () => gibsMap(LIVE_TRUE, { w: 4096, h: 2048, time: daysAgo(1) }),
  liveFires: () => gibsMap("VIIRS_NOAA20_Thermal_Anomalies_375m_All", { w: 4096, h: 2048, png: true, transparent: true, time: daysAgo(1) }),
  liveAerosol: () => gibsMap("MODIS_Combined_Value_Added_AOD", { w: 2048, h: 1024, png: true, transparent: true, time: daysAgo(1) }),
  liveLandTemp: () => gibsMap("MODIS_Terra_Land_Surface_Temp_Day", { w: 2048, h: 1024, png: true, transparent: true, time: daysAgo(2) }),
  liveSeaTemp: () => gibsMap("GHRSST_L4_MUR_Sea_Surface_Temperature", { w: 2048, h: 1024, png: true, transparent: true, time: daysAgo(2) }),
  liveDate: () => daysAgo(1),
};
const LIVE_TRUE = "VIIRS_NOAA20_CorrectedReflectance_TrueColor";

/**
 * High-resolution image of one region (for zooming in without pixelation).
 * box = {latMin, latMax, lonMin, lonMax}. Returns a URL.
 */
export function detailMap(live, box, w = 2048) {
  const latSpan = box.latMax - box.latMin, lonSpan = box.lonMax - box.lonMin;
  const h = Math.max(256, Math.min(2048, Math.round(w * latSpan / lonSpan)));
  const p = new URLSearchParams({
    SERVICE: "WMS", REQUEST: "GetMap", VERSION: "1.3.0", CRS: "EPSG:4326",
    LAYERS: live ? LIVE_TRUE : "BlueMarble_ShadedRelief_Bathymetry",
    BBOX: [box.latMin, box.lonMin, box.latMax, box.lonMax].map((v) => v.toFixed(4)).join(","),
    WIDTH: w, HEIGHT: h, FORMAT: "image/jpeg",
  });
  if (live) p.set("TIME", daysAgo(1));
  return `${GIBS_WMS}?${p}`;
}

/**
 * Land mask + SRTM elevation, decoded from NASA GIBS into an RGBA byte array
 * (rows bottom-to-top, ready for a WebGL DataTexture):
 *   R = land (255) / water (0)
 *   G = elevation in metres (0–254; 255 = above 254 m)
 *   B = 255 when SRTM elevation is known for that pixel (SRTM covers 56°S–60°N)
 * Also returns a lookup function elevationAt(lat, lon).
 */
export async function loadLandAndElevation(w = 2048, h = 1024) {
  const [landImg, srtmImg, xml] = await Promise.all([
    loadImage(gibsMap("OSM_Land_Water_Map", { w, h, png: true })),
    loadImage(gibsMap("SRTM_Color_Index", { w, h, png: true, transparent: true })),
    fetch(GIBS_COLORMAPS + "SRTM_Color_Index.xml").then((r) => r.text()),
  ]);

  // SRTM colour → elevation (lower bound of each bin, metres)
  const lut = new Map();
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  for (const e of doc.getElementsByTagName("ColorMapEntry")) {
    if (e.getAttribute("nodata") === "true") continue;
    const [r, g, b] = e.getAttribute("rgb").split(",").map(Number);
    const lo = parseFloat((e.getAttribute("value") || "").replace(/[[\]()]/g, "").split(",")[0]);
    if (!Number.isNaN(lo)) lut.set((r << 16) | (g << 8) | b, lo);
  }

  const px = (img) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const land = px(landImg), srtm = px(srtmImg);

  // Land vs water: classify against reference colours sampled at mid-Atlantic and central Africa
  const at = (lat, lon) => (Math.floor((90 - lat) / 180 * h) * w + Math.floor((lon + 180) / 360 * w)) * 4;
  const wi = at(0, -30), li = at(0, 22);
  const water = [land[wi], land[wi + 1], land[wi + 2]], ground = [land[li], land[li + 1], land[li + 2]];
  const d2 = (a, i) => (land[i] - a[0]) ** 2 + (land[i + 1] - a[1]) ** 2 + (land[i + 2] - a[2]) ** 2;

  const out = new Uint8Array(w * h * 4);
  const elevGrid = new Float32Array(w * h).fill(NaN);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const isLand = d2(ground, i) < d2(water, i);
      let elev = NaN;
      if (srtm[i + 3] > 0) {
        const v = lut.get((srtm[i] << 16) | (srtm[i + 1] << 8) | srtm[i + 2]);
        if (v !== undefined) elev = Math.max(v, 0);
      } else if (isLand && Math.abs((90 - (y + 0.5) / h * 180)) < 56) {
        elev = 1; // land with no SRTM value inside coverage = at/below sea level (e.g. polders) → treat as 1 m
      }
      const o = ((h - 1 - y) * w + x) * 4;
      out[o] = isLand ? 255 : 0;
      out[o + 1] = Number.isNaN(elev) ? 255 : Math.min(255, Math.round(elev));
      out[o + 2] = Number.isNaN(elev) ? 0 : 255;
      out[o + 3] = 255;
      if (isLand) elevGrid[y * w + x] = elev;
    }
  }
  const elevationAt = (lat, lon) => {
    const y = Math.min(h - 1, Math.max(0, Math.floor((90 - lat) / 180 * h)));
    const x = Math.min(w - 1, Math.max(0, Math.floor(((lon + 180) % 360) / 360 * w)));
    const e = elevGrid[y * w + x];
    return { land: out[((h - 1 - y) * w + x) * 4] === 255, elevation: Number.isNaN(e) ? null : e };
  };
  return { data: out, width: w, height: h, elevationAt };
}

/** Open natural events from EONET, simplified. */
export async function naturalEvents(limit = 200) {
  const data = await getJSON(`${EONET}/events?status=open&limit=${limit}`);
  return data.events.map((e) => {
    const g = e.geometry?.[e.geometry.length - 1];
    let coords = null;
    if (g?.type === "Point") coords = g.coordinates;
    else if (g?.type === "Polygon") coords = g.coordinates[0][0];
    return {
      id: e.id, title: e.title,
      category: e.categories?.[0]?.id, categoryTitle: e.categories?.[0]?.title,
      date: g?.date, lon: coords?.[0], lat: coords?.[1],
      source: e.sources?.[0]?.url || e.link,
    };
  }).filter((e) => e.lat != null);
}

/** NASA Image & Video Library: video search. */
export async function searchVideos(q, page = 1) {
  const p = new URLSearchParams({ q, media_type: "video", page, page_size: 18 });
  const data = await getJSON(`${IMAGES}/search?${p}`);
  return (data.collection?.items || []).map((it) => {
    const d = it.data?.[0] || {};
    return {
      id: d.nasa_id, title: d.title, description: d.description, date: d.date_created, center: d.center,
      thumb: it.links?.find((l) => l.render === "image")?.href || it.links?.[0]?.href,
    };
  });
}

/** Playable MP4 URL for a NASA Image & Video Library item. */
export async function videoFile(nasaId) {
  const data = await getJSON(`${IMAGES}/asset/${encodeURIComponent(nasaId)}`);
  const files = (data.collection?.items || []).map((i) => i.href.replace(/^http:/, "https:"));
  return files.find((f) => /~mobile\.mp4$/i.test(f)) || files.find((f) => /~medium\.mp4$/i.test(f))
    || files.find((f) => /\.mp4$/i.test(f) && !/~orig/i.test(f)) || files.find((f) => /\.mp4$/i.test(f));
}

/** Latest DSCOVR/EPIC full-disc Earth photo. */
export async function latestEarthPhoto() {
  const data = await getJSON(`${EPIC}/api/natural`);
  const img = data[0];
  const [y, m, d] = img.date.slice(0, 10).split("-");
  return { url: `${EPIC}/archive/natural/${y}/${m}/${d}/jpg/${img.image}.jpg`, date: img.date, caption: img.caption };
}

/** Local NASA snapshots (see scripts/fetch_nasa_data.py). */
const snap = (name) => getJSON(new URL(`../data/nasa/${name}`, import.meta.url).href);
export const gistempGlobal = () => snap("gistemp_global.json");
export const gistempZonal = () => snap("gistemp_zonal.json");
export const co2History = () => snap("co2_history.json");
export const documents = () => snap("documents.json");
