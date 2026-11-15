import * as NASA from "./nasa.js";
import { SCENARIOS, FACTORS, START, END, compute, pathway } from "./model.js";
import { state, set, subscribe } from "./state.js";
import { QA, RESOURCES, OFFICIAL_RESOURCES, CITIES, VIDEO_TOPICS, REGION_ADVICE, HAZARD_ADVICE } from "./content.js";
import { riskTable, PERIODS } from "./species.js";
import { createEcovie } from "./ecovie-guide.js";
import { createBrain } from "./ecovie-brain.js";

// 30.0444, 31.2357 → 30°02′40″N 31°14′09″E
function dms(lat, lon) {
  const f = (v, pos, neg) => {
    const a = Math.abs(v), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), s = Math.min(59, Math.round((mf - m) * 60));
    return `${d}°${String(m).padStart(2, "0")}′${String(s).padStart(2, "0")}″${v >= 0 ? pos : neg}`;
  };
  return `${f(lat, "N", "S")} ${f(lon, "E", "W")}`;
}

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");
const sign = (n, d = 1) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(d);
const INIT = {};

/* ---------------- Latitude warming pattern from NASA GISTEMP zonal data ---------------- */
let bands = [2.2, 1.4, 1.15, 0.8, 0.75, 0.75, 0.7, 0.9];
const BAND_LAT = [77, 54, 34, 12, -12, -34, -54, -77];
function bandRatio(lat) {
  if (lat >= BAND_LAT[0]) return bands[0];
  if (lat <= BAND_LAT[7]) return bands[7];
  for (let i = 0; i < 7; i++) if (lat <= BAND_LAT[i] && lat >= BAND_LAT[i + 1])
    return bands[i] + (bands[i + 1] - bands[i]) * (BAND_LAT[i] - lat) / (BAND_LAT[i] - BAND_LAT[i + 1]);
  return 1;
}
const bandsReady = Promise.all([NASA.gistempZonal(), NASA.gistempGlobal()]).then(([z, g]) => {
  const recent = (s) => { const r = s.filter(([y]) => y >= 2015 && y <= 2024).map(([, v]) => v); return r.reduce((a, b) => a + b, 0) / r.length; };
  const glob = recent(g.series);
  bands = ["64N-90N", "44N-64N", "24N-44N", "EQU-24N", "24S-EQU", "44S-24S", "64S-44S", "90S-64S"].map((b) => +(recent(z.bands[b]) / glob).toFixed(3));
  return bands;
}).catch(() => bands);

/* ---------------- Earth engine (lazy) ---------------- */
let earthPromise = null, earth = null;
function getEarth() {
  if (earthPromise) return earthPromise;
  earthPromise = import("./earth.js").then(({ createEarth }) => createEarth({
    globeCanvas: $("#globe-canvas"), mapCanvas: $("#map-canvas"),
    onStatus: (t) => { $("#loading").hidden = !t; if (t) $("#loading-text").textContent = t; },
    onHover: (p) => showProbe(p, false),
    onPick: (p) => { pinned = p; showProbe(p, true); },
    onMapZoom: (z) => { $("#map-zoom-level").textContent = (z < 10 ? z.toFixed(1) : Math.round(z)) + "×"; },
  })).then(async (e) => {
    earth = e;
    e.setBands(await bandsReady);
    applyState();
    return e;
  }).catch((err) => {
    $("#loading").hidden = false;
    $("#loading-text").textContent = "Could not load the Earth: " + err.message;
    throw err;
  });
  return earthPromise;
}

/* ---------------- Router ---------------- */
const ROUTES = { "": "welcome", main: "home", "3d": "viewer", "2d": "viewer", species: "species", ask: "ask", qa: "qa", documents: "documents", videos: "videos", "my-matter": "my-matter" };
const inited = new Set();
function route() {
  const key = location.hash.replace(/^#\/?/, "").split("?")[0];
  const page = ROUTES[key] ?? "welcome";
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === "page-" + page));
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === key));
  document.body.dataset.page = page;
  $("#nav").classList.remove("open");
  $("#menu-btn").setAttribute("aria-expanded", "false");
  if (key === "3d" || key === "2d") set({ view: key });
  if (!inited.has(page)) { inited.add(page); INIT[page]?.(); }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
$("#menu-btn").addEventListener("click", () => {
  const open = $("#nav").classList.toggle("open");
  $("#menu-btn").setAttribute("aria-expanded", String(open));
});

/* ---------------- Welcome ---------------- */
INIT.welcome = function () {
  NASA.latestEarthPhoto().then((p) => ($("#w-earth").src = p.url)).catch(() => $(".w-earth").classList.add("no-img"));

  // Twinkling star field
  const c = $("#w-stars"), ctx = c.getContext("2d");
  const stars = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + 0.2, p: Math.random() * 6.28 }));
  const draw = (t) => {
    if (document.body.dataset.page !== "welcome") return requestAnimationFrame(draw);
    const w = (c.width = c.clientWidth * devicePixelRatio), h = (c.height = c.clientHeight * devicePixelRatio);
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t / 1400 + s.p));
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r * devicePixelRatio, 0, 6.29); ctx.fill();
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  // The Earth slowly "lives" its future: years count 2025 → 2325 under Current Policies, the planet warms in colour
  const cycle = 14000, t0 = performance.now();
  const tick = (t) => {
    if (document.body.dataset.page === "welcome") {
      const k = ((t - t0) % cycle) / cycle, ease = k < 0.85 ? k / 0.85 : 1;
      const year = Math.round(START + (END - START) * ease);
      const r = compute("ssp245", year);
      const heat = Math.min(1, (r.dT - 1.45) / 2.5);
      $("#w-year").textContent = year;
      $("#w-temp").textContent = `${sign(r.dT, 2)}°C · Current Policies`;
      $("#w-earth").style.filter = `sepia(${heat * 0.55}) saturate(${1 + heat * 0.6}) hue-rotate(${-heat * 18}deg) brightness(${1 + heat * 0.05})`;
      $("#w-glow").style.setProperty("--heat", heat);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

/* ---------------- Home ---------------- */
function lineChart(el, series, { color = "currentColor", yLabel = "" } = {}) {
  const W = 1000, H = 260, P = { l: 44, r: 12, t: 12, b: 28 };
  const xs = series.map((d) => d[0]), ys = series.map((d) => d[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys, 0) - 0.1, y1 = Math.max(...ys) + 0.1;
  const X = (x) => P.l + (x - x0) / (x1 - x0) * (W - P.l - P.r), Y = (y) => H - P.b - (y - y0) / (y1 - y0) * (H - P.t - P.b);
  const d = series.map(([x, y], i) => `${i ? "L" : "M"}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join("");
  const yt = []; for (let v = Math.ceil(y0 * 2) / 2; v <= y1; v += 0.5) yt.push(v);
  const xt = []; for (let v = Math.ceil(x0 / 20) * 20; v <= x1; v += 20) xt.push(v);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${yt.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid${v === 0 ? " zero" : ""}"/><text x="${P.l - 8}" y="${Y(v) + 4}" text-anchor="end">${v > 0 ? "+" : ""}${v.toFixed(1)}</text>`).join("")}
    ${xt.map((v) => `<text x="${X(v)}" y="${H - 6}" text-anchor="middle">${v}</text>`).join("")}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" vector-effect="non-scaling-stroke"/>
    <circle cx="${X(xs.at(-1))}" cy="${Y(ys.at(-1))}" r="5" fill="${color}"/>
    <text x="${P.l}" y="${P.t + 4}" class="ylabel">${esc(yLabel)}</text>
  </svg>`;
}

INIT.home = async function () {
  observeReveal();
  NASA.latestEarthPhoto().then((p) => {
    $("#epic-img").src = p.url;
    $("#epic-cap").textContent = `Earth on ${fmtDate(p.date)}, photographed by NASA's EPIC camera from 1.5 million km away`;
  }).catch(() => ($("#epic-img").closest("figure").classList.add("no-img")));

  try {
    const [g, c] = await Promise.all([NASA.gistempGlobal(), NASA.co2History()]);
    const last = g.series.at(-1), warm = g.series.reduce((a, b) => (b[1] > a[1] ? b : a));
    const co2Now = c.series.filter(([y]) => y <= new Date().getFullYear()).at(-1);
    $("#h-latest").textContent = sign(last[1], 2) + "°C";
    $("#h-latest-cap").textContent = `Global temperature anomaly, ${last[0]} (vs 1951–1980)`;
    $("#h-warmest").textContent = warm[0];
    $("#h-co2").textContent = Math.round(co2Now[1]) + " ppm";
    $("#h-co2").nextElementSibling.textContent = `CO₂ in the atmosphere (${co2Now[0]}, latest in NASA GISS record)`;
    lineChart($("#h-chart"), g.series, { color: "#b4472a", yLabel: "°C vs 1951–1980" });
  } catch (e) { $("#h-chart").textContent = "NASA temperature data unavailable."; }

  $("#h-scenarios").innerHTML = Object.entries(SCENARIOS).map(([k, s]) => {
    const a = compute(k, 2100), b = compute(k, 2300);
    return `<a class="scenario-card ${k}" href="#/3d" data-scn="${k}">
      <span class="code">${s.code}</span><h3>${s.name}</h3><p>${s.blurb}</p>
      <div class="sc-stats"><div><b>${sign(a.dT)}°C</b><span>2100</span></div><div><b>${sign(b.dT)}°C</b><span>2300</span></div><div><b>+${b.sea.toFixed(1)} m</b><span>sea · 2300</span></div></div>
    </a>`;
  }).join("");
  $$("#h-scenarios a").forEach((a) => a.addEventListener("click", () => set({ scenario: a.dataset.scn })));
};

function observeReveal() {
  const els = $$(".band .band-inner");
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")), { threshold: 0.05 });
  els.forEach((el) => io.observe(el));
  // Safety net: never leave sections invisible if the observer doesn't fire
  setTimeout(() => els.forEach((el) => el.classList.add("in")), 2500);
}

/* ---------------- Viewer ---------------- */
let pinned = null, playing = false, lastT = 0;

INIT.viewer = function () {
  getEarth();
  $("#scenario-seg").innerHTML = Object.entries(SCENARIOS).map(([k, s]) => `<button data-scn="${k}" class="${k}">${s.name}</button>`).join("");
  $$("#scenario-seg button").forEach((b) => b.addEventListener("click", () => set({ scenario: b.dataset.scn })));

  $("#factors").innerHTML = FACTORS.map((f) => `
    <div class="factor" data-key="${f.key}">
      <div class="f-top"><span class="f-name">${f.label}</span><b class="f-val" id="fv-${f.key}"></b></div>
      <input type="range" min="0" max="200" step="5" value="100" aria-label="${f.label} adjustment" id="fs-${f.key}">
      <div class="f-bot"><span class="f-detail" id="fd-${f.key}"></span><span class="f-pct" id="fp-${f.key}">100%</span></div>
    </div>`).join("");
  FACTORS.forEach((f) => $("#fs-" + f.key).addEventListener("input", (e) => set({ adj: { ...state.adj, [f.key]: e.target.value / 100 } })));
  $("#reset-factors").addEventListener("click", () => set({ adj: Object.fromEntries(FACTORS.map((f) => [f.key, 1])) }));

  $("#year").addEventListener("input", (e) => { playing = false; set({ year: +e.target.value }); });
  $("#play").addEventListener("click", () => {
    playing = !playing;
    if (playing && state.year >= END) set({ year: START });
    lastT = performance.now();
    requestAnimationFrame(tick);
    updatePlay();
  });
  $$("#view-seg button, .mh-views button").forEach((b) => b.addEventListener("click", () => {
    const v = b.dataset.view;
    if (location.hash === "#/" + v) set({ view: v }); else location.hash = "#/" + v;
  }));
  $("#mode-thermal").addEventListener("change", (e) => set({ thermal: e.target.checked }));
  $("#mode-clouds").addEventListener("change", (e) => set({ clouds: e.target.checked }));
  $("#mode-borders").addEventListener("change", (e) => set({ borders: e.target.checked }));
  $$("#map-zoom button").forEach((b) => b.addEventListener("click", () => {
    if (!earth) return;
    if (b.dataset.z === "reset") earth.resetMap(); else earth.zoomMap(b.dataset.z === "in" ? 2 : 0.5);
  }));
  $$("#globe-zoom button").forEach((b) => b.addEventListener("click", () => earth?.zoomGlobe(b.dataset.z === "in" ? 0.8 : 1.25)));
  $("#panel-toggle").addEventListener("click", () => {
    const b = document.body.classList, mobile = matchMedia("(max-width: 860px)").matches;
    if (!b.contains("panels-open")) b.add("panels-open");
    else if (mobile && !b.contains("show-right")) b.add("show-right");
    else b.remove("panels-open", "show-right");
    $("#panel-toggle").textContent = !b.contains("panels-open") ? "Controls" : mobile && !b.contains("show-right") ? "Readouts" : "Hide";
  });
  document.addEventListener("keydown", (e) => {
    if (document.body.dataset.page !== "viewer" || e.target.matches("input[type=range], input[type=text], input[type=search]")) return;
    if (e.key === "ArrowRight") set({ year: Math.min(END, state.year + 5) });
    if (e.key === "ArrowLeft") set({ year: Math.max(START, state.year - 5) });
    if (e.key === " ") { e.preventDefault(); $("#play").click(); }
  });
  applyState();
};

function tick(t) {
  if (!playing) return;
  const dy = (t - lastT) / 1000 * 15; // 15 years per second
  if (dy >= 1) {
    lastT = t;
    const y = Math.min(END, state.year + Math.floor(dy));
    set({ year: y });
    if (y >= END) { playing = false; updatePlay(); return; }
  }
  requestAnimationFrame(tick);
}
const updatePlay = () => { $("#play").textContent = playing ? "❚❚" : "▶"; $("#play").setAttribute("aria-label", playing ? "Pause" : "Play timeline"); };

function sparkline(el) {
  const W = 260, H = 90;
  const X = (y) => (y - START) / (END - START) * W, Y = (v) => H - 6 - v / 10 * (H - 12);
  const lines = Object.keys(SCENARIOS).map((k) => {
    const p = pathway(k, k === state.scenario ? state.adj : undefined, 5);
    return `<path class="sp ${k}${k === state.scenario ? " on" : ""}" d="${p.map(([x, v], i) => `${i ? "L" : "M"}${X(x).toFixed(1)},${Y(v).toFixed(1)}`).join("")}"/>`;
  }).join("");
  const cur = compute(state.scenario, state.year, state.adj);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">
    <rect x="${X(2150)}" y="0" width="${W - X(2150)}" height="${H}" class="sp-low"/>
    ${[2, 4, 6, 8].map((v) => `<line x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" class="sp-grid"/><text x="2" y="${Y(v) - 2}">${v}°</text>`).join("")}
    ${lines}
    <line x1="${X(state.year)}" x2="${X(state.year)}" y1="0" y2="${H}" class="sp-cur"/>
    <circle cx="${X(state.year)}" cy="${Y(cur.dT)}" r="3.5" class="sp-dot"/>
  </svg>`;
}

function legend() {
  const el = $("#legend");
  if (state.thermal && state.view === "2d") {
    el.innerHTML = `<p class="eyebrow">2D thermal · NASA GISS map style</p><p class="lg-note">Surface temperature anomaly vs 1951–1980 on a 2°×2° grid, using the GISS colour scale. Latitude pattern from NASA GISTEMP v4.</p>`;
  } else if (state.thermal) {
    el.innerHTML = `<p class="eyebrow">Local warming vs 1850–1900</p><div class="ramp"></div><div class="ramp-l"><span>0°</span><span>2.5°</span><span>5°</span><span>7.5°</span><span>10°C+</span></div>
      <p class="lg-note">Latitude pattern from NASA GISTEMP v4 zonal record</p>`;
  } else {
    el.innerHTML = `<span class="lg"><i style="background:#0d6bb8"></i>Flooded land (NASA SRTM)</span><span class="lg"><i style="background:#ff6a10"></i>Active fire</span><span class="lg"><i style="background:#f5f5ee"></i>Bleached coral / storm cloud</span><span class="lg"><i style="background:#cdb07a"></i>Desert & drought</span><span class="lg"><i style="background:#8e6d4a"></i>Cleared forest</span>`;
  }
}

let lastThermal = null, lastView = null;
function applyState() {
  if (!$("#factors").children.length) return;
  const r = compute(state.scenario, state.year, state.adj);
  $("#stage").dataset.view = state.view;
  $$("#view-seg button, .mh-views button").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view));
  $("#mh-year").textContent = state.year;
  $("#mh-temp").textContent = sign(r.dT, 2) + "°C";
  $("#mh-scn").textContent = SCENARIOS[state.scenario].name;
  $$("#scenario-seg button").forEach((b) => b.classList.toggle("on", b.dataset.scn === state.scenario));
  document.body.dataset.scenario = state.scenario;
  $("#scenario-blurb").textContent = SCENARIOS[state.scenario].blurb + ` (${SCENARIOS[state.scenario].code})`;
  $("#year").value = state.year;
  $("#year").style.setProperty("--p", ((state.year - START) / (END - START) * 100) + "%");
  $("#r-year").textContent = state.year;
  $("#r-temp").textContent = sign(r.dT, 2) + "°C";
  $("#r-conf").textContent = `${r.confidence.level} confidence · ${r.confidence.note}`;
  $("#r-conf").dataset.level = r.confidence.level;
  $("#r-co2").textContent = Math.round(r.co2) + " ppm";
  $("#r-sea").textContent = "+" + r.sea.toFixed(2) + " m";
  $("#r-forc").textContent = r.forcing.toFixed(1) + " W/m²";
  $("#r-ice").textContent = r.arcticIce.toFixed(1) + " M km²";
  FACTORS.forEach((f) => {
    $("#fv-" + f.key).textContent = r.readout[f.key].value;
    $("#fd-" + f.key).textContent = r.readout[f.key].detail;
    const pct = Math.round(state.adj[f.key] * 100);
    $("#fp-" + f.key).textContent = pct + "%";
    $("#fs-" + f.key).value = pct;
    $("#fs-" + f.key).style.setProperty("--p", pct / 2 + "%");
  });
  $("#mode-thermal").checked = state.thermal;
  $("#mode-clouds").checked = state.clouds;
  $("#mode-borders").checked = state.borders;
  sparkline($("#r-spark"));
  if (state.thermal !== lastThermal || state.view !== lastView) legend();
  lastView = state.view;

  // NASA GISS-style header + colour bar on the 2D map in thermal view
  const gissOn = state.thermal && state.view === "2d";
  $("#giss").hidden = !gissOn;
  if (gissOn) {
    const anom = r.dT - 0.3;
    $("#giss-title").textContent = `Surface Temperature Anomaly (°C) · ${SCENARIOS[state.scenario].name}, ${state.year} vs 1951–1980`;
    $("#giss-mean").textContent = `Global mean ${anom >= 0 ? "" : "−"}${Math.abs(anom).toFixed(2)}`;
  }

  if (earth) {
    earth.update(r.vis);
    earth.setClouds(state.clouds);
    earth.setBorders(state.borders);
    if (state.thermal !== lastThermal) earth.setThermal(state.thermal);
    lastThermal = state.thermal;
  }
  if (pinned) showProbe(pinned, true);
}
subscribe((s, patch) => {
  if (document.body.dataset.page === "species" && ("scenario" in patch || "adj" in patch)) renderSpecies?.();
  applyState();
  if ("view" in patch && earth && state.view !== "3d") earth.resetMap();
});

function probeHTML(p) {
  const r = compute(state.scenario, state.year, state.adj);
  const local = r.dT * bandRatio(p.lat);
  const el = earth?.elevationAt(p.lat, p.lon);
  let elevTxt = "Ocean";
  if (el?.land) elevTxt = el.elevation == null ? "Land · elevation outside SRTM coverage" : `Land · ${el.elevation < 5 ? "0–5" : `${el.elevation}–${el.elevation + 5}`} m (SRTM)`;
  const flooded = el?.land && el.elevation != null && el.elevation + 2.5 < r.sea;
  const c = earth?.countryAt(p.lat, p.lon);
  const place = c ? `<div class="pr-country">${esc(c.name)}</div><div class="pr-capital">Capital: ${esc(c.capital || "—")}</div>`
    : `<div class="pr-country">${el?.land ? "Land" : "Ocean"}</div>`;
  return `${place}
    <div class="pr-coord">${p.lat.toFixed(4)}°, ${p.lon.toFixed(4)}°</div>
    <div class="pr-dms">${dms(p.lat, p.lon)}</div>
    <div class="pr-row"><span>Local warming</span><b>${sign(local)}°C</b></div>
    <div class="pr-row"><span>Surface</span><b>${elevTxt}</b></div>
    ${flooded ? `<div class="pr-flag">Likely below sea level by ${state.year}</div>` : ""}`;
}
function showProbe(p, pin) {
  const el = $("#probe");
  if (!p) { if (pinned) return showProbe(pinned, true); el.hidden = true; return; }
  el.hidden = false;
  el.classList.toggle("pinned", !!pin);
  el.innerHTML = probeHTML(p) + (pin ? `<button class="link pr-close" aria-label="Close">Close</button>` : "");
  if (pin) $(".pr-close", el).addEventListener("click", () => { pinned = null; el.hidden = true; earth?.unpin(); });
  // While hovering, the card follows the crosshair; a pinned card sits at the top
  const follow = !pin && p.x != null && !matchMedia("(max-width: 860px)").matches;
  el.classList.toggle("follow", follow);
  if (follow) {
    const host = $("#page-viewer").getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = p.x - host.left + 18, y = p.y - host.top + 18;
    if (x + w > host.width - 8) x = p.x - host.left - w - 18;
    if (y + h > host.height - 8) y = p.y - host.top - h - 18;
    el.style.left = x + "px"; el.style.top = y + "px";
  } else { el.style.left = ""; el.style.top = ""; }
}

/* ---------------- Species ---------------- */
let renderSpecies = null;
let spPeriod = 1;
const pct = (p) => (p >= 0.995 ? ">99" : p < 0.005 ? "<1" : Math.round(p * 100)) + "%";
function riskColor(p) {
  const stops = [[0, [64, 70, 78]], [0.25, [201, 164, 106]], [0.5, [224, 120, 60]], [0.8, [190, 40, 40]], [1, [110, 10, 20]]];
  for (let i = 1; i < stops.length; i++) if (p <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (p - a) / (b - a);
    return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(",")})`;
  }
  return "rgb(110,10,20)";
}
function miniCurve(curve, period) {
  const W = 220, H = 44, X = (y) => (y - START) / (END - START) * W, Y = (p) => H - 2 - p * (H - 4);
  const [a, b] = PERIODS[period];
  return `<svg class="sp-curve" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <rect x="${X(a)}" width="${X(b) - X(a)}" y="0" height="${H}" class="sp-band"/>
    <line x1="0" x2="${W}" y1="${Y(0.5)}" y2="${Y(0.5)}" class="sp-half"/>
    <path d="${curve.map(([y, p], i) => `${i ? "L" : "M"}${X(y).toFixed(1)},${Y(p).toFixed(1)}`).join("")}"/>
  </svg>`;
}

INIT.species = async function () {
  const [imgs] = await Promise.all([fetch("data/species_images.json").then((r) => r.json()).catch(() => ({ species: {} })), bandsReady]);
  const photo = (s) => imgs.species[s.wiki] || {};
  $("#sp-scenario").innerHTML = Object.entries(SCENARIOS).map(([k, s]) => `<button data-scn="${k}" class="${k}">${s.name}</button>`).join("");
  $$("#sp-scenario button").forEach((b) => b.addEventListener("click", () => set({ scenario: b.dataset.scn })));
  $("#sp-periods").innerHTML = PERIODS.map(([a, b], i) => `<button type="button" class="chip" data-i="${i}">${a}–${b}</button>`).join("");
  $$("#sp-periods .chip").forEach((c) => c.addEventListener("click", () => { spPeriod = +c.dataset.i; renderSpecies(); }));

  renderSpecies = () => {
    const rows = riskTable(state.scenario, state.adj, bandRatio);
    const [a, b] = PERIODS[spPeriod];
    $$("#sp-scenario button").forEach((x) => x.classList.toggle("on", x.dataset.scn === state.scenario));
    $$("#sp-periods .chip").forEach((x) => x.classList.toggle("on", +x.dataset.i === spPeriod));

    const prev = (r) => (spPeriod ? r.byPeriod[spPeriod - 1] : 0);
    const lost = rows.filter((r) => r.lostIn === spPeriod).sort((x, y) => y.byPeriod[spPeriod] - x.byPeriod[spPeriod]);
    const rising = rows.filter((r) => r.lostIn === -1 || r.lostIn > spPeriod)
      .map((r) => ({ ...r, delta: r.byPeriod[spPeriod] - prev(r) })).sort((x, y) => y.delta - x.delta)
      .slice(0, Math.max(0, 8 - lost.length));
    const already = rows.filter((r) => r.lostIn >= 0 && r.lostIn < spPeriod).length;
    const custom = Object.values(state.adj).some((v) => v !== 1);
    $("#sp-note").textContent = `${SCENARIOS[state.scenario].name}, ${a}–${b}: ${lost.length} species pass a 50% chance of extinction in this period` +
      (already ? `, and ${already} already passed it in an earlier period` : "") + "." + (custom ? " Includes your 3D View factor adjustments." : "") +
      (a >= 2150 ? " Low confidence beyond 2150." : "");

    const card = (s, tag) => {
      const ph = photo(s), p = s.byPeriod[spPeriod];
      return `<article class="sp-card">
        <a class="sp-photo" href="${esc(ph.page || "#")}" target="_blank" rel="noopener">${ph.img ? `<img loading="lazy" src="${esc(ph.img)}" alt="${esc(s.name)}">` : ""}<span class="sp-tag ${tag.cls}">${tag.text}</span></a>
        <div class="sp-body">
          <div class="sp-top"><h3>${esc(s.name)}</h3><span class="sp-status ${s.status}" title="IUCN Red List: ${esc(s.statusLabel)}">${s.status}</span></div>
          <p class="sp-sci">${esc(s.sci)} · ${esc(s.group)}</p>
          <p class="sp-where">${esc(s.where)}</p>
          <div class="sp-prob"><b style="color:${riskColor(p)}">${pct(p)}</b><span>chance of extinction by ${b}</span></div>
          <div class="sp-bar"><i style="width:${Math.min(100, p * 100)}%;background:${riskColor(p)}"></i></div>
          ${miniCurve(s.curve, spPeriod)}
          <p class="sp-threats">${s.threats.map((t) => `<span>${esc(t)}</span>`).join("")}</p>
        </div>
      </article>`;
    };
    $("#sp-grid").innerHTML = lost.map((s) => card(s, { cls: "lost", text: "Likely lost in this period" })).join("")
      + rising.map((s) => card(s, { cls: "rising", text: "Risk rising" })).join("")
      || `<p class="muted">No species in this list is likely to be lost in this period.</p>`;

    const sorted = [...rows].sort((x, y) => y.byPeriod.at(-1) - x.byPeriod.at(-1) || y.byPeriod[1] - x.byPeriod[1]);
    $("#sp-table").innerHTML = `<thead><tr><th>Species</th><th>IUCN</th>${PERIODS.map(([, e], i) => `<th class="${i === spPeriod ? "cur" : ""}">by ${e}</th>`).join("")}</tr></thead>
      <tbody>${sorted.map((s) => `<tr>
        <th><span class="sp-row">${photo(s).img ? `<img src="${esc(photo(s).img)}" alt="" loading="lazy">` : ""}${esc(s.name)}</span></th>
        <td><span class="sp-status ${s.status}">${s.status}</span></td>
        ${s.byPeriod.map((p, i) => `<td class="${i === spPeriod ? "cur" : ""}${i === s.lostIn ? " cross" : ""}"><span class="cell" style="background:${riskColor(p)}">${pct(p)}</span></td>`).join("")}
      </tr>`).join("")}</tbody>`;
  };
  renderSpecies();
};

/* ---------------- Q&A ---------------- */
INIT.qa = function () {
  const render = (q = "") => {
    const t = q.toLowerCase();
    $("#qa-list").innerHTML = QA.filter((x) => !t || (x.q + x.a).toLowerCase().includes(t)).map((x, i) => `
      <details class="qa"${i === 0 && !t ? " open" : ""}>
        <summary><span>${esc(x.q)}</span><i></i></summary>
        <div class="qa-a"><p>${esc(x.a)}</p>${x.src ? `<a href="${esc(x.src[1])}" target="_blank" rel="noopener">${esc(x.src[0])} ↗</a>` : ""}</div>
      </details>`).join("") || `<p class="muted">No questions match “${esc(q)}”.</p>`;
  };
  $("#qa-search").addEventListener("input", (e) => render(e.target.value));
  render();
};

/* ---------------- Documents ---------------- */
INIT.documents = async function () {
  const card = ([org, t, d, u]) => `
    <a class="resource" href="${u}" target="_blank" rel="noopener"><span class="r-org">${esc(org)}</span><h3>${esc(t)}</h3><p>${esc(d)}</p><span class="arrow">↗</span></a>`;
  $("#resources").innerHTML = RESOURCES.map(card).join("");
  $("#official").innerHTML = OFFICIAL_RESOURCES.map(card).join("");
  const list = $("#doc-list");
  list.innerHTML = `<p class="muted">Loading NASA reports…</p>`;
  let docs = [];
  try { docs = (await NASA.documents()).documents; } catch { list.innerHTML = `<p class="muted">Reports unavailable. Run scripts/fetch_nasa_data.py.</p>`; return; }
  const topics = ["all", ...new Set(docs.map((d) => d.topic))];
  let topic = "all", q = "";
  $("#doc-chips").innerHTML = topics.map((t) => `<button type="button" class="chip${t === "all" ? " on" : ""}" data-t="${esc(t)}">${esc(t)}</button>`).join("");
  const render = () => {
    const t = q.toLowerCase();
    const rows = docs.filter((d) => (topic === "all" || d.topic === topic) && (!t || (d.title + d.abstract).toLowerCase().includes(t)));
    list.innerHTML = rows.map((d) => `
      <article class="doc">
        <div class="doc-meta"><span>${esc(d.type || "Report")}</span><span>${d.date ? new Date(d.date).getFullYear() : ""}</span><span>${esc(d.topic)}</span></div>
        <h3><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a></h3>
        ${d.authors?.filter(Boolean).length ? `<p class="doc-auth">${esc(d.authors.filter(Boolean).join(", "))}</p>` : ""}
        ${d.abstract ? `<p class="doc-abs">${esc(d.abstract)}${d.abstract.length >= 600 ? "…" : ""}</p>` : ""}
        <div class="doc-links"><a href="${esc(d.url)}" target="_blank" rel="noopener">NTRS record ↗</a>${d.pdf ? `<a href="${esc(d.pdf)}" target="_blank" rel="noopener">PDF ↗</a>` : ""}</div>
      </article>`).join("") || `<p class="muted">No reports match.</p>`;
  };
  $$("#doc-chips .chip").forEach((c) => c.addEventListener("click", () => {
    topic = c.dataset.t; $$("#doc-chips .chip").forEach((x) => x.classList.toggle("on", x === c)); render();
  }));
  $("#doc-search").addEventListener("input", (e) => { q = e.target.value; render(); });
  render();
};

/* ---------------- Videos ---------------- */
INIT.videos = function () {
  $("#video-chips").innerHTML = VIDEO_TOPICS.map((t, i) => `<button type="button" class="chip${i === 0 ? " on" : ""}" data-q="${esc(t)}">${esc(t)}</button>`).join("");
  const load = async (q) => {
    const grid = $("#video-grid");
    grid.innerHTML = `<p class="muted">Searching NASA's library…</p>`;
    try {
      const vids = await NASA.searchVideos(q);
      grid.innerHTML = vids.map((v) => `
        <button class="video" data-id="${esc(v.id)}">
          <div class="thumb">${v.thumb ? `<img loading="lazy" src="${esc(v.thumb)}" alt="">` : ""}<span class="playicon">▶</span></div>
          <h3>${esc(v.title)}</h3>
          <p>${fmtDate(v.date)}${v.center ? " · " + esc(v.center) : ""}</p>
        </button>`).join("") || `<p class="muted">No NASA videos found for “${esc(q)}”.</p>`;
      $$(".video", grid).forEach((b, i) => b.addEventListener("click", () => openVideo(vids[i])));
    } catch (e) { grid.innerHTML = `<p class="muted">NASA video library unavailable: ${esc(e.message)}</p>`; }
  };
  $$("#video-chips .chip").forEach((c) => c.addEventListener("click", () => {
    $$("#video-chips .chip").forEach((x) => x.classList.toggle("on", x === c)); $("#video-q").value = ""; load(c.dataset.q);
  }));
  $("#video-form").addEventListener("submit", (e) => { e.preventDefault(); const q = $("#video-q").value.trim(); if (q) { $$("#video-chips .chip").forEach((x) => x.classList.remove("on")); load(q); } });
  $("#video-close").addEventListener("click", () => $("#video-dialog").close());
  $("#video-dialog").addEventListener("close", () => $("#video-player").pause());
  load(VIDEO_TOPICS[0]);
};
async function openVideo(v) {
  const dlg = $("#video-dialog"), player = $("#video-player");
  $("#video-title").textContent = v.title;
  $("#video-desc").textContent = (v.description || "").slice(0, 700);
  player.removeAttribute("src"); player.poster = v.thumb || "";
  dlg.showModal();
  try {
    const src = await NASA.videoFile(v.id);
    if (src) { player.src = src; player.play().catch(() => {}); } else $("#video-desc").textContent = "No playable file was found for this video.";
  } catch (e) { $("#video-desc").textContent = "Could not load video: " + e.message; }
}

/* ---------------- ÉcoVie: firefly guide + Ask ÉcoVie ---------------- */
const ecovie = createEcovie({ onAsk: () => (location.hash = "#/ask") });
let brainP = null;
function getBrain() {
  brainP = brainP || Promise.all([
    NASA.gistempGlobal().catch(() => null), NASA.co2History().catch(() => null), NASA.documents().catch(() => null),
    fetch("data/countries.json").then((r) => r.json()).catch(() => null), bandsReady,
  ]).then(([gistemp, co2, docs, countries]) => createBrain({
    bandRatio, data: { gistemp, co2, docs, countries: countries?.countries }, regionFor: (lat, lon, c) => regionFor(lat, lon, c),
  }));
  return brainP;
}

async function runAction(go) {
  if (go.scenario || go.year) set({ ...(go.scenario ? { scenario: go.scenario } : {}), ...(go.year ? { year: go.year } : {}) });
  location.hash = go.hash;
  if (go.focus) { const e = await getEarth(); setTimeout(() => { e.focus(go.focus.lat, go.focus.lon, { zoom: true }); pinned = { lat: go.focus.lat, lon: go.focus.lon }; showProbe(pinned, true); }, 150); }
  if (go.place) setTimeout(() => {
    $("#m-lat").value = go.place.lat; $("#m-lon").value = go.place.lon;
    const opt = [...$("#m-city").options].find((o) => o.text === go.place.name);
    if (opt) { $("#m-city").value = opt.value; $("#m-city").dispatchEvent(new Event("change")); } else $("#m-go").click();
  }, 150);
}

const ASK_SUGGESTIONS = [
  "How much will the sea rise by 2100?", "How hot will it be in 2300 under Extreme Fossil Fuel?", "What happens to Arctic ice under the Paris Path?",
  "Which animals could go extinct first?", "Will the polar bear survive?", "What does the future look like for Cairo?",
  "What was the warmest year on record?", "How do I use the timeline?", "What is radiative forcing?",
];

INIT.ask = async function () {
  $("#ask-chips").innerHTML = ASK_SUGGESTIONS.map((s) => `<button type="button" class="chip ask-chip">${esc(s)}</button>`).join("");
  $$(".ask-chip").forEach((c) => c.addEventListener("click", () => ask(c.textContent)));
  $("#ask-form").addEventListener("submit", (e) => { e.preventDefault(); const q = $("#ask-input").value.trim(); if (q) { ask(q); $("#ask-input").value = ""; } });
  addMsg("eco", `<p>Bonjour ! I'm <b>ÉcoVie</b> ✨. Ask me anything about Earth's next 300 years. I answer from NASA's data and this site's projections.</p>`);
  getBrain();
};

function addMsg(who, html) {
  const el = document.createElement("div");
  el.className = `ask-msg ${who}`;
  el.innerHTML = who === "eco" ? `<span class="ask-av" aria-hidden="true"></span><div class="ask-bubble">${html}</div>` : `<div class="ask-bubble">${html}</div>`;
  $("#ask-log").appendChild(el);
  el.scrollIntoView({ behavior: "smooth", block: "end" });
  return el;
}

async function ask(q) {
  addMsg("me", esc(q));
  const thinking = addMsg("eco", `<p class="eco-dots"><i></i><i></i><i></i></p>`);
  const brain = await getBrain();
  await new Promise((r) => setTimeout(r, 450));
  const a = brain.answer(q);
  thinking.querySelector(".ask-bubble").innerHTML = a.html
    + (a.sources?.length ? `<p class="eco-src">Sources: ${a.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(" · ")}</p>` : "")
    + (a.actions?.length ? `<div class="eco-acts">${a.actions.map((x, i) => `<button class="btn btn-ghost" data-i="${i}">${esc(x.label)}</button>`).join("")}</div>` : "");
  $$(".eco-acts button", thinking).forEach((b) => b.addEventListener("click", () => runAction(a.actions[+b.dataset.i].go)));
  // ÉcoVie flies to the part of the site it's talking about and makes it glow
  if (a.glow) setTimeout(() => ecovie.point(a.glow, "Look here! This is where you'll find it."), 300);
}

/* ---------------- My Matter: region-specific advice ---------------- */
function regionFor(lat, lon, country, elev) {
  if (Math.abs(lat) >= 60) return REGION_ADVICE.find((r) => r.id === "polar");
  if (country?.subregion) {
    const g = REGION_ADVICE.find((r) => r.subregions.includes(country.subregion));
    if (g) return g;
  }
  if (elev && !elev.land && !country) return REGION_ADVICE.find((r) => r.id === "ocean");
  // Fallback by coordinates when no country is found
  if (lat > 35 && lon > -25 && lon < 45) return REGION_ADVICE.find((r) => r.id === "europe");
  if (lat > 12 && lon > -20 && lon < 60) return REGION_ADVICE.find((r) => r.id === "mena");
  if (lat < 12 && lat > -35 && lon > -20 && lon < 52) return REGION_ADVICE.find((r) => r.id === "subsahara");
  if (lon < -30) return REGION_ADVICE.find((r) => r.id === (lat > 15 ? "namerica" : "latam"));
  if (lat < -10 && lon > 110 && lon < 180) return REGION_ADVICE.find((r) => r.id === "aunz");
  return REGION_ADVICE.find((r) => r.id === "eastasia");
}
function adviceHTML(lat, lon, elev, e) {
  const country = e?.countryAt(lat, lon);
  const g = regionFor(lat, lon, country, elev);
  const alat = Math.abs(lat), extra = [];
  const onShore = elev && !elev.land && country && !country.landlocked; // point falls on a coastal water pixel
  if (onShore || (elev?.land && elev.elevation != null && elev.elevation <= 10 && !country?.landlocked)) extra.push(HAZARD_ADVICE.coastal);
  if (alat >= 60) extra.push(HAZARD_ADVICE.arctic);
  else if (bandRatio(lat) > 1.1) extra.push(HAZARD_ADVICE.heat);
  // Subtropical drylands only (not monsoon or rainforest areas at the same latitude)
  const sub = country?.subregion || "";
  const dry = ["Northern Africa", "Western Asia", "Central Asia", "Southern Africa", "Australia and New Zealand"].includes(sub)
    || (["North America", "Northern America", "Central America"].includes(sub) && lon < -97)
    || (sub === "Southern Asia" && lon < 76)
    || (sub === "Western Africa" && lat > 12) || (sub === "Eastern Africa" && lat > 3)
    || (sub === "South America" && lat < -18 && lon < -60);
  if (elev?.land && alat >= 12 && alat <= 38 && dry) extra.push(HAZARD_ADVICE.dryland);
  if (elev?.land && ((alat >= 30 && alat <= 45) || (alat >= 50 && alat <= 66))) extra.push(HAZARD_ADVICE.fire);
  return `<h3 class="m-sub">Advice for ${esc(country?.name ? `${country.name} · ` : "")}${esc(g.title)}</h3>
    <p class="muted">${esc(g.risks)}</p>
    <ol class="actions">${g.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>
    ${extra.length ? `<h3 class="m-sub small-sub">Because of this exact spot</h3><ul class="actions spot">${extra.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}`;
}

/* ---------------- My Matter ---------------- */
INIT["my-matter"] = function () {
  getEarth();
  $("#m-city").innerHTML = `<option value="">Choose a city…</option>` + CITIES.map(([n, la, lo], i) => `<option value="${i}">${esc(n)}</option>`).join("");
  $("#m-city").addEventListener("change", (e) => {
    const c = CITIES[e.target.value]; if (!c) return;
    $("#m-lat").value = c[1]; $("#m-lon").value = c[2]; run(c[0]);
  });
  $("#m-go").addEventListener("click", () => run());
  const run = async (name) => {
    const lat = parseFloat($("#m-lat").value), lon = parseFloat($("#m-lon").value);
    const out = $("#m-result");
    if (Number.isNaN(lat) || Number.isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { out.innerHTML = `<p class="muted">Enter a valid latitude and longitude, or choose a city.</p>`; return; }
    out.innerHTML = `<p class="muted">Reading NASA elevation and events…</p>`;
    await bandsReady;
    let elev = null, earthRef = null;
    try { earthRef = await getEarth(); elev = earthRef.elevationAt(lat, lon); } catch {}
    const years = [2050, 2100, 2200, 2300];
    const rows = Object.entries(SCENARIOS).map(([k, s]) => {
      const cells = years.map((y) => `<td>${sign(compute(k, y).dT * bandRatio(lat), 1)}°C</td>`).join("");
      let floodYear = "—";
      if (elev?.land && elev.elevation != null) {
        for (let y = START; y <= END; y += 5) if (compute(k, y).sea > elev.elevation + 2.5) { floodYear = "~" + y; break; }
        if (floodYear === "—") floodYear = "Not by 2325";
      }
      return `<tr class="${k}"><th>${s.name}</th>${cells}<td>${floodYear}</td></tr>`;
    }).join("");
    let near = [];
    try {
      const ev = await NASA.naturalEvents(300);
      const R = 6371, rad = Math.PI / 180;
      near = ev.map((e) => {
        const d = 2 * R * Math.asin(Math.sqrt(Math.sin((e.lat - lat) * rad / 2) ** 2 + Math.cos(lat * rad) * Math.cos(e.lat * rad) * Math.sin((e.lon - lon) * rad / 2) ** 2));
        return { ...e, d };
      }).filter((e) => e.d < 1500).sort((a, b) => a.d - b.d).slice(0, 6);
    } catch {}
    const elevTxt = !elev ? "Unknown" : !elev.land ? "This point is in the ocean." : elev.elevation == null ? "Outside NASA SRTM coverage (60°N–56°S)." : `${elev.elevation < 5 ? "0–5" : elev.elevation + "–" + (elev.elevation + 5)} m above sea level (NASA SRTM, 5 m steps)`;
    out.innerHTML = `
      <div class="m-head"><h2 class="display-3">${esc(name || `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`)}</h2>
        <button class="btn btn-ghost" id="m-show">Show on the 3D Earth</button></div>
      <div class="m-grid">
        <div class="m-card"><p class="eyebrow">Elevation</p><p class="m-big">${esc(elevTxt)}</p></div>
        <div class="m-card"><p class="eyebrow">Local warming factor</p><p class="m-big">×${bandRatio(lat).toFixed(2)} global</p><p class="muted">Your latitude band warms ${bandRatio(lat) > 1 ? "faster" : "slower"} than the world average (NASA GISTEMP, 2015–2024).</p></div>
      </div>
      <div class="table-wrap"><table class="m-table">
        <thead><tr><th>Scenario</th>${years.map((y) => `<th>${y}</th>`).join("")}<th>Sea reaches ground*</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="muted small">*Rough estimate: global mean sea level against the midpoint of the SRTM 5 m elevation band. It ignores tides, storm surge, land subsidence and defences. Values after 2150 are low confidence.</p>
      <h3 class="m-sub">Active NASA-tracked events within 1,500 km</h3>
      ${near.length ? `<ul class="m-events">${near.map((e) => `<li><span class="tag">${esc(e.categoryTitle)}</span><a href="${esc(e.source)}" target="_blank" rel="noopener">${esc(e.title)}</a><span class="muted">${Math.round(e.d)} km</span></li>`).join("")}</ul>` : `<p class="muted">None right now (NASA EONET).</p>`}
      ${adviceHTML(lat, lon, elev, earthRef)}`;
    $("#m-show").addEventListener("click", async () => {
      location.hash = "#/3d";
      const e = await getEarth();
      setTimeout(() => { e.focus(lat, lon, { zoom: true }); pinned = { lat, lon }; showProbe(pinned, true); }, 100);
    });
  };
};

route();
setTimeout(() => ecovie.welcome(), 1200);
