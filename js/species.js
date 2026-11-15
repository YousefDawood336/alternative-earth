/*
 * Climate-threatened animal species and an illustrative extinction-risk index.
 * Status: IUCN Red List category (as assessed up to 2025). Exposure weights (0–1) describe how strongly
 * each species depends on what each climate factor destroys (from IUCN threat accounts and species literature).
 * Photos: Wikipedia / Wikimedia Commons (snapshot in data/species_images.json).
 */
import { compute, START, END } from "./model.js";

export const STATUS = {
  LC: { label: "Least Concern", hazard: 0.00002 },
  NT: { label: "Near Threatened", hazard: 0.00015 },
  VU: { label: "Vulnerable", hazard: 0.0007 },
  EN: { label: "Endangered", hazard: 0.0018 },
  CR: { label: "Critically Endangered", hazard: 0.004 },
};

export const PERIODS = [[2025, 2050], [2050, 2100], [2100, 2150], [2150, 2200], [2200, 2250], [2250, 2325]];

const THREAT_LABEL = { ice: "Sea-ice loss", coral: "Reef collapse", sea: "Sea-level rise", heat: "Heat", fire: "Wildfire", drought: "Drought", deforest: "Deforestation", acid: "Ocean warming & acidification" };

export const SPECIES = [
  { name: "Polar bear", sci: "Ursus maritimus", status: "VU", group: "Mammal", where: "Arctic sea ice", lat: 75, w: { ice: 1, heat: 0.3 }, wiki: "Polar bear" },
  { name: "Walrus", sci: "Odobenus rosmarus", status: "VU", group: "Mammal", where: "Arctic shelf seas", lat: 72, w: { ice: 0.9, acid: 0.3 }, wiki: "Walrus" },
  { name: "Narwhal", sci: "Monodon monoceros", status: "LC", group: "Mammal", where: "High Arctic waters", lat: 74, w: { ice: 1, acid: 0.3 }, wiki: "Narwhal" },
  { name: "Emperor penguin", sci: "Aptenodytes forsteri", status: "NT", group: "Bird", where: "Antarctic fast ice", lat: -72, w: { ice: 1 }, wiki: "Emperor penguin" },
  { name: "Snowy owl", sci: "Bubo scandiacus", status: "VU", group: "Bird", where: "Arctic tundra", lat: 70, w: { heat: 0.7, ice: 0.3 }, wiki: "Snowy owl" },
  { name: "Staghorn coral", sci: "Acropora cervicornis", status: "CR", group: "Coral", where: "Caribbean reefs", lat: 18, w: { coral: 1, acid: 0.8, heat: 0.4 }, wiki: "Acropora cervicornis" },
  { name: "Elkhorn coral", sci: "Acropora palmata", status: "CR", group: "Coral", where: "Caribbean reefs", lat: 18, w: { coral: 1, acid: 0.8, heat: 0.4 }, wiki: "Elkhorn coral" },
  { name: "Hawksbill sea turtle", sci: "Eretmochelys imbricata", status: "CR", group: "Reptile", where: "Tropical reefs & beaches", lat: 15, w: { coral: 0.8, sea: 0.6, heat: 0.5 }, wiki: "Hawksbill sea turtle" },
  { name: "Leatherback sea turtle", sci: "Dermochelys coriacea", status: "VU", group: "Reptile", where: "Open ocean, tropical beaches", lat: 10, w: { sea: 0.5, heat: 0.6, acid: 0.3 }, wiki: "Leatherback sea turtle" },
  { name: "Hawaiian monk seal", sci: "Neomonachus schauinslandi", status: "EN", group: "Mammal", where: "Low Hawaiian islands", lat: 23, w: { sea: 1, acid: 0.3 }, wiki: "Hawaiian monk seal" },
  { name: "Dugong", sci: "Dugong dugon", status: "VU", group: "Mammal", where: "Indo-Pacific seagrass", lat: -20, w: { sea: 0.4, coral: 0.4, heat: 0.4 }, wiki: "Dugong" },
  { name: "Galápagos penguin", sci: "Spheniscus mendiculus", status: "EN", group: "Bird", where: "Galápagos Islands", lat: 0, w: { heat: 0.9, acid: 0.5 }, wiki: "Galápagos penguin" },
  { name: "Atlantic puffin", sci: "Fratercula arctica", status: "VU", group: "Bird", where: "North Atlantic cliffs", lat: 63, w: { heat: 0.5, acid: 0.6 }, wiki: "Atlantic puffin" },
  { name: "North Atlantic right whale", sci: "Eubalaena glacialis", status: "CR", group: "Mammal", where: "Western North Atlantic", lat: 42, w: { acid: 0.6, heat: 0.4 }, wiki: "North Atlantic right whale" },
  { name: "Koala", sci: "Phascolarctos cinereus", status: "VU", group: "Mammal", where: "Eastern Australia", lat: -28, w: { fire: 1, drought: 0.8, heat: 0.5 }, wiki: "Koala" },
  { name: "Mountain pygmy possum", sci: "Burramys parvus", status: "CR", group: "Mammal", where: "Australian Alps", lat: -36, w: { heat: 1, fire: 0.5 }, wiki: "Mountain pygmy possum" },
  { name: "Bornean orangutan", sci: "Pongo pygmaeus", status: "CR", group: "Mammal", where: "Borneo rainforest", lat: 1, w: { deforest: 1, fire: 0.7, drought: 0.4 }, wiki: "Bornean orangutan" },
  { name: "Sumatran orangutan", sci: "Pongo abelii", status: "CR", group: "Mammal", where: "Sumatra rainforest", lat: 3, w: { deforest: 1, fire: 0.5 }, wiki: "Sumatran orangutan" },
  { name: "Mountain gorilla", sci: "Gorilla beringei beringei", status: "EN", group: "Mammal", where: "Virunga & Bwindi forests", lat: -1, w: { heat: 0.5, deforest: 0.5, drought: 0.4 }, wiki: "Mountain gorilla" },
  { name: "Ring-tailed lemur", sci: "Lemur catta", status: "EN", group: "Mammal", where: "Southern Madagascar", lat: -23, w: { drought: 1, deforest: 0.7, heat: 0.4 }, wiki: "Ring-tailed lemur" },
  { name: "Bengal tiger", sci: "Panthera tigris tigris", status: "EN", group: "Mammal", where: "Sundarbans mangroves", lat: 22, w: { sea: 1, deforest: 0.4, heat: 0.3 }, wiki: "Bengal tiger" },
  { name: "African bush elephant", sci: "Loxodonta africana", status: "EN", group: "Mammal", where: "African savannas", lat: -2, w: { drought: 1, heat: 0.4 }, wiki: "African bush elephant" },
  { name: "Snow leopard", sci: "Panthera uncia", status: "VU", group: "Mammal", where: "High Asian mountains", lat: 35, w: { heat: 0.8, ice: 0.2 }, wiki: "Snow leopard" },
  { name: "American pika", sci: "Ochotona princeps", status: "LC", group: "Mammal", where: "Western US mountains", lat: 40, w: { heat: 1 }, wiki: "American pika" },
  { name: "ʻAkikiki", sci: "Oreomystis bairdi", status: "CR", group: "Bird", where: "Kauaʻi, Hawaiʻi", lat: 22, w: { heat: 1 }, wiki: "Akikiki" },
  { name: "Panamanian golden frog", sci: "Atelopus zeteki", status: "CR", group: "Amphibian", where: "Panama cloud forest", lat: 9, w: { heat: 0.6, drought: 0.5 }, wiki: "Panamanian golden frog" },
  { name: "Monarch butterfly", sci: "Danaus plexippus plexippus", status: "VU", group: "Insect", where: "North America ↔ Mexico", lat: 30, w: { heat: 0.6, drought: 0.6, deforest: 0.4 }, wiki: "Monarch butterfly" },
  { name: "Rusty patched bumble bee", sci: "Bombus affinis", status: "CR", group: "Insect", where: "Eastern North America", lat: 42, w: { heat: 0.8, drought: 0.4 }, wiki: "Rusty patched bumble bee" },
];

/** Exposure of a species to the climate state r (from model.compute) at its latitude. */
function exposure(sp, r, bandRatio) {
  const v = r.vis, w = sp.w, local = r.dT * bandRatio(sp.lat);
  const parts = {
    ice: (w.ice || 0) * v.ice * 6,
    coral: (w.coral || 0) * v.ocean * 6,
    sea: (w.sea || 0) * Math.min(r.sea, 4) * 1.4,
    heat: (w.heat || 0) * Math.max(0, local - 1.5) * 1.1,
    fire: (w.fire || 0) * Math.max(0, v.fire - 0.18) * 5,
    drought: (w.drought || 0) * Math.max(0, v.drought - 0.1) * 5,
    deforest: (w.deforest || 0) * Math.max(0, v.deforest - 0.12) * 6,
    acid: (w.acid || 0) * Math.max(0, (r.co2 - 424) / 300) * 1.6,
  };
  return parts;
}

/**
 * Risk path for every species: cumulative extinction probability at each 5-year step.
 * Returns [{...species, curve: [[year, p]], topThreat, byPeriod: [p at end of each period], lostIn}].
 */
export function riskTable(scenario, adj, bandRatio) {
  const years = [];
  for (let y = START; y <= END; y += 5) years.push(y);
  const states = years.map((y) => compute(scenario, y, adj));
  return SPECIES.map((sp) => {
    let surv = 1;
    const curve = [[START, 0]];
    const threatSum = {};
    for (let i = 1; i < years.length; i++) {
      const r = states[i];
      const parts = exposure(sp, r, bandRatio);
      const E = Object.values(parts).reduce((a, b) => a + b, 0);
      for (const [k, v] of Object.entries(parts)) threatSum[k] = (threatSum[k] || 0) + v;
      const hazard = STATUS[sp.status].hazard * (1 + 0.8 * E) + 0.00018 * E * E;
      surv *= Math.exp(-hazard * 5);
      curve.push([years[i], 1 - surv]);
    }
    const at = (y) => { let p = 0; for (const [yy, pp] of curve) if (yy <= y) p = pp; return p; };
    const byPeriod = PERIODS.map(([, b]) => at(b));
    const idx = byPeriod.findIndex((p) => p >= 0.5);
    const topThreat = Object.entries(threatSum).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => THREAT_LABEL[k]);
    const declared = Object.keys(sp.w).map((k) => THREAT_LABEL[k]);
    return { ...sp, curve, byPeriod, lostIn: idx, threats: topThreat.length ? topThreat : declared.slice(0, 2), statusLabel: STATUS[sp.status].label };
  });
}
