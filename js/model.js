/*
 * Climate emulator: a simplified, transparent model, NOT a full climate model.
 *
 * Inputs:
 *  - Scenario pathways (warming, CO₂, radiative forcing, sea level) anchored to IPCC AR6 WG1,
 *    the assessment NASA's climate site (science.nasa.gov/climate-change) and the
 *    NASA Sea Level Projection Tool (sealevel.nasa.gov/ipcc-ar6-sea-level-projection-tool) present.
 *    2025–2100: AR6 central estimates (medium-high confidence).
 *    2100–2150: NASA/IPCC sea-level tool medians; warming from extended AR6 runs.
 *    2150–2325: AR6 long-term ranges (Ch. 4.7, Ch. 9.6), shown as LOW CONFIDENCE.
 *  - Present-day observations from NASA GISTEMP v4 (temperature) and NASA GISS CO₂ history.
 *  - Impact scaling vs warming level from AR6 SPM Figure SPM.6 (10-year extreme event frequency).
 *
 * Visitor controls:
 *  - CO₂-equivalent and radiation sliders change radiative forcing → warming → everything else.
 *  - Deforestation adds land-use CO₂.
 *  - Every other factor slider scales that factor's impact intensity (0–200%).
 */

export const START = 2025, END = 2325;
const PREIND_CO2 = 278;

export const SCENARIOS = {
  ssp126: {
    name: "Paris Path", code: "SSP1-2.6",
    blurb: "Rapid emissions cuts, net zero CO₂ around 2070. Warming peaks below 2 °C.",
    dT:     [[2025, 1.45], [2050, 1.7], [2075, 1.8], [2100, 1.8], [2150, 1.7], [2200, 1.6], [2300, 1.5], [2325, 1.5]],
    co2:    [[2025, 424], [2050, 465], [2075, 460], [2100, 446], [2150, 420], [2200, 400], [2300, 380], [2325, 378]],
    forcing:[[2025, 2.9], [2050, 3.0], [2075, 2.8], [2100, 2.6], [2150, 2.4], [2200, 2.2], [2300, 2.0], [2325, 2.0]],
    sea:    [[2025, 0.06], [2050, 0.19], [2075, 0.30], [2100, 0.44], [2150, 0.68], [2200, 0.85], [2300, 1.2], [2325, 1.3]],
    forest: [[2025, 0], [2050, -2], [2100, 3], [2200, 6], [2325, 7]],
    air:    [[2025, 1], [2050, 0.65], [2100, 0.4], [2325, 0.35]],
  },
  ssp245: {
    name: "Current Policies", code: "SSP2-4.5",
    blurb: "Today's policies continue. Emissions plateau then fall slowly. About 2.7 °C by 2100.",
    dT:     [[2025, 1.45], [2050, 2.0], [2075, 2.4], [2100, 2.7], [2150, 3.1], [2200, 3.4], [2300, 3.7], [2325, 3.75]],
    co2:    [[2025, 424], [2050, 509], [2075, 562], [2100, 603], [2150, 590], [2200, 560], [2300, 520], [2325, 512]],
    forcing:[[2025, 2.9], [2050, 3.8], [2075, 4.2], [2100, 4.5], [2150, 4.6], [2200, 4.5], [2300, 4.5], [2325, 4.5]],
    sea:    [[2025, 0.06], [2050, 0.20], [2075, 0.36], [2100, 0.56], [2150, 0.92], [2200, 1.3], [2300, 2.0], [2325, 2.2]],
    forest: [[2025, 0], [2050, -5], [2100, -10], [2200, -14], [2325, -15]],
    air:    [[2025, 1], [2050, 0.85], [2100, 0.75], [2325, 0.75]],
  },
  ssp585: {
    name: "Extreme Fossil Fuel", code: "SSP5-8.5",
    blurb: "Fossil-fuelled growth, emissions triple by 2075. About 4.4 °C by 2100 and still rising.",
    dT:     [[2025, 1.5], [2050, 2.4], [2075, 3.4], [2100, 4.4], [2150, 6.0], [2200, 7.5], [2300, 9.0], [2325, 9.2]],
    co2:    [[2025, 425], [2050, 563], [2075, 780], [2100, 1135], [2150, 1700], [2200, 1960], [2300, 2000], [2325, 2000]],
    forcing:[[2025, 2.9], [2050, 5.2], [2075, 6.9], [2100, 8.5], [2150, 10.9], [2200, 11.8], [2300, 12.0], [2325, 12.0]],
    sea:    [[2025, 0.06], [2050, 0.23], [2075, 0.45], [2100, 0.77], [2150, 1.32], [2200, 2.1], [2300, 4.0], [2325, 4.4]],
    forest: [[2025, 0], [2050, -6], [2100, -12], [2200, -17], [2325, -18]],
    air:    [[2025, 1], [2050, 0.8], [2100, 0.65], [2325, 0.7]],
  },
};

/** AR6 SPM.6: frequency of 10-year extremes vs 1850–1900, at 1 / 1.5 / 2 / 4 °C. */
const SPM6 = {
  heat:    [[0, 1], [1, 2.8], [1.5, 4.1], [2, 5.6], [4, 9.4]],
  precip:  [[0, 1], [1, 1.3], [1.5, 1.5], [2, 1.7], [4, 2.7]],
  drought: [[0, 1], [1, 1.7], [1.5, 2.0], [2, 2.4], [4, 4.1]],
};

export const FACTORS = [
  { key: "seaLevel",  label: "Sea level",               icon: "≋" },
  { key: "co2e",      label: "CO₂ equivalent",          icon: "◍" },
  { key: "desert",    label: "Desertification",         icon: "◠" },
  { key: "ice",       label: "Ice loss",                icon: "❄" },
  { key: "fire",      label: "Wildfires",               icon: "🜂" },
  { key: "storms",    label: "Extreme storms",          icon: "🌀" },
  { key: "drought",   label: "Drought",                 icon: "◌" },
  { key: "air",       label: "Air quality",             icon: "☁" },
  { key: "ocean",     label: "Ocean & coral",           icon: "◒" },
  { key: "deforest",  label: "Deforestation",           icon: "♣" },
  { key: "radiation", label: "Radiation (forcing)",     icon: "☀" },
];

function interp(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const t = (x - x0) / (x1 - x0);
      const s = t * t * (3 - 2 * t); // smooth between anchors
      return y0 + (y1 - y0) * (0.5 * t + 0.5 * s);
    }
  }
  const n = pts.length, [x0, y0] = pts[n - 2], [x1, y1] = pts[n - 1];
  return y1 + (y1 - y0) / (x1 - x0) * (x - x1); // linear extrapolation
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Confidence label for a given year. */
export function confidence(year) {
  if (year <= 2100) return { level: "medium–high", note: "IPCC AR6 central estimate" };
  if (year <= 2150) return { level: "medium", note: "NASA/IPCC sea-level tool, extended model runs" };
  return { level: "low", note: "AR6 long-term range: deep uncertainty" };
}

/**
 * Compute the climate state for a scenario, year and visitor adjustments.
 * adj[key] is a multiplier (0–2, 1 = scenario as published).
 */
export function compute(scenarioKey, year, adj = {}) {
  const S = SCENARIOS[scenarioKey];
  const a = (k) => (adj[k] ?? 1);
  const progress = (year - START) / (END - START);

  // Published scenario values
  const dTs = interp(S.dT, year), co2s = interp(S.co2, year), Fs = interp(S.forcing, year), seas = interp(S.sea, year);

  // Visitor-adjusted forcing: CO₂e slider scales the human CO₂ increment,
  // deforestation adds up to +60 ppm by 2325 at 200%, radiation slider scales total forcing.
  const co2 = PREIND_CO2 + (co2s - PREIND_CO2) * a("co2e") + (a("deforest") - 1) * 60 * progress;
  const Fco2s = 5.35 * Math.log(co2s / PREIND_CO2), Fco2 = 5.35 * Math.log(Math.max(co2, 150) / PREIND_CO2);
  const F = Math.max(0.1, (Fs - Fco2s + Fco2) * a("radiation"));
  const today = 1.45;
  // Warming above today scales with forcing (keeps present-day observations fixed)
  const dT = Math.max(0, today + (dTs - today) * (F / Fs) + (F - Fs) * 0.25 * Math.min(1, progress * 3));
  const warmRatio = dTs > 0 ? dT / dTs : 1;

  const sea = Math.max(0, (0.06 + (seas - 0.06) * Math.pow(warmRatio, 0.9)) * a("seaLevel"));
  // Arctic September sea ice: ~4.3 M km² today, practically ice-free near +2.9 °C (AR6 9.3)
  const seaIceLoss = clamp01(clamp01((dT - 1.45) / 1.4) * a("ice"));
  const arcticIce = 4.3 * (1 - seaIceLoss);
  const iceLossFrac = clamp01(seaIceLoss * 0.8 + clamp01((dT - 1.5) / 8) * 0.2 * a("ice"));

  const heat = interp(SPM6.heat, dT) / interp(SPM6.heat, today);
  const precip = interp(SPM6.precip, dT) / interp(SPM6.precip, today);
  const drought = interp(SPM6.drought, dT) / interp(SPM6.drought, today);
  const coralLoss = clamp01(interp([[1, 0.3], [1.5, 0.8], [2, 0.99], [3, 1]], dT));
  const forestBase = interp(S.forest, year);
  const forestChange = forestBase < 0 ? forestBase * a("deforest") : forestBase - (a("deforest") - 1) * 10 * progress;
  const airIdx = interp(S.air, year) * (1 + Math.max(0, dT - 3) * 0.08) * a("air");
  const acidPH = 8.05 - 0.39 * Math.log(Math.max(co2, 200) / 424); // log fit: ≈7.9 (SSP2-4.5) and ≈7.67 (SSP5-8.5) by 2100, as in AR6

  const vis = {
    sea,
    ice: clamp01(iceLossFrac * a("ice")),
    desert: clamp01((0.12 + (drought - 1) * 0.35) * a("desert")),
    fire: clamp01((0.18 + (heat - 1) * 0.3) * a("fire")),
    storms: clamp01((0.15 + (precip - 1) * 0.6) * a("storms")),
    drought: clamp01((0.1 + (drought - 1) * 0.4) * a("drought")),
    air: clamp01(0.55 * airIdx),
    ocean: clamp01(coralLoss * 0.85 * a("ocean")),
    deforest: clamp01((0.12 + Math.max(0, -forestChange) / 25) * Math.min(a("deforest"), 1.3)),
    radiation: clamp01((F - 2) / 11),
    dT,
  };

  const f = (n, d = 1) => Number(n).toFixed(d);
  const readout = {
    seaLevel:  { value: `+${f(sea, 2)} m`, detail: "Global mean sea level vs 2020" },
    co2e:      { value: `${Math.round(co2)} ppm`, detail: "Atmospheric CO₂ concentration" },
    desert:    { value: `${Math.round(vis.desert * 100)}/100`, detail: "Dryland degradation index (from drought scaling)" },
    ice:       { value: `${f(arcticIce, 1)} M km²`, detail: "September Arctic sea ice extent" },
    fire:      { value: `×${f(heat * a("fire"), 1)}`, detail: "Fire-weather / heat extremes vs today" },
    storms:    { value: `×${f(precip * a("storms"), 2)}`, detail: "Extreme rainfall events vs today" },
    drought:   { value: `×${f(drought * a("drought"), 1)}`, detail: "Agricultural drought frequency vs today" },
    air:       { value: `${Math.round(airIdx * 100)}%`, detail: "Air-pollution level vs today" },
    ocean:     { value: `${Math.round(coralLoss * 100 * Math.min(1, a("ocean")))}% · pH ${f(acidPH, 2)}`, detail: "Warm-water coral loss · surface ocean pH" },
    deforest:  { value: `${forestChange > 0 ? "+" : ""}${f(forestChange, 0)}%`, detail: "Tropical forest area vs 2025" },
    radiation: { value: `${f(F, 1)} W/m²`, detail: "Radiative forcing (extra energy trapped)" },
  };

  return { year, scenario: S, dT, co2, forcing: F, sea, arcticIce, vis, readout, confidence: confidence(year) };
}

/** Warming path for a scenario (for sparkline). */
export function pathway(scenarioKey, adj, step = 5) {
  const out = [];
  for (let y = START; y <= END; y += step) out.push([y, compute(scenarioKey, y, adj).dT]);
  return out;
}
