/*
 * ÉcoVie's answer engine. It runs in the browser with no external AI service, and every answer comes from this site's data:
 *  - NASA GISTEMP v4 (observed temperature), NASA GISS CO₂ history, NASA NTRS reports
 *  - The scenario emulator (IPCC AR6 pathways as presented by NASA's climate site and sea-level tool)
 *  - The species risk index, the region advice, and the site's Q&A
 * Each answer returns { html, sources, actions, glow }.
 */
import { SCENARIOS, compute, START, END } from "./model.js";
import { SPECIES, riskTable, PERIODS } from "./species.js";
import { QA, CITIES, RESOURCES, OFFICIAL_RESOURCES } from "./content.js";

const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[ʻ’']/g, "");
const sign = (n, d = 1) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(d);
const STOP = new Set("the a an is are was were be to of in on for and or what how why when where which who will would could should does do did i you me my it its this that with by from at as about much many can there their than then into over under more most less very".split(" "));
const tokens = (s) => norm(s).split(/[^a-z0-9₂]+/).filter((w) => w.length > 2 && !STOP.has(w));

const SRC = {
  gistemp: { label: "NASA GISTEMP v4", url: "https://data.giss.nasa.gov/gistemp/" },
  sealevel: { label: "NASA Sea Level Projection Tool", url: "https://sealevel.nasa.gov/ipcc-ar6-sea-level-projection-tool" },
  climate: { label: "NASA Climate Change", url: "https://science.nasa.gov/climate-change/" },
  co2: { label: "NASA GISS greenhouse-gas history", url: "https://data.giss.nasa.gov/modelforce/ghgases/" },
  iucn: { label: "IUCN Red List", url: "https://www.iucnredlist.org/" },
};

const FACTOR_WORDS = {
  seaLevel: ["sea level", "sea-level", "sea rise", "ocean rise", "rising sea", "flood", "coast", "sea"],
  co2e: ["co2", "co₂", "carbon", "greenhouse", "emission", "ppm"],
  ice: ["ice", "arctic", "glacier", "polar", "melt", "frozen"],
  fire: ["fire", "wildfire", "burn", "bushfire"],
  storms: ["storm", "hurricane", "cyclone", "typhoon", "rainfall", "extreme rain"],
  drought: ["drought", "dry", "water shortage"],
  desert: ["desert"],
  air: ["air quality", "pollution", "smog", "haze", "air"],
  ocean: ["coral", "reef", "acid", "ocean"],
  deforest: ["forest", "deforest", "tree", "amazon", "rainforest"],
  radiation: ["radiation", "forcing", "energy imbalance", "w/m"],
  temp: ["temperature", "warming", "warm", "hot", "heat", "degree", "°c", "celsius"],
};
const FACTOR_NAME = { seaLevel: "Sea level", co2e: "CO₂", ice: "Arctic sea ice (September)", fire: "Fire weather", storms: "Extreme rainfall", drought: "Agricultural drought", desert: "Dryland degradation", air: "Air pollution", ocean: "Coral loss · ocean pH", deforest: "Tropical forest area", radiation: "Radiative forcing", temp: "Global warming" };

const HELP = [
  { k: ["zoom"], a: "To zoom: on the 3D Earth, scroll or use the + / − buttons. On the 2D map, scroll toward a spot, pinch, or double-click. When you get close, a sharper NASA image loads.", glow: ".zoom-ctl, #nav a[data-route='3d']" },
  { k: ["timeline", "year", "play", "animate", "time"], a: "The timeline at the bottom of the 3D/2D view runs from 2025 to 2325. Drag it, or press ▶ (or the space bar) to watch about 15 years pass each second. The arrow keys step 5 years.", glow: "#nav a[data-route='3d']" },
  { k: ["slider", "factor", "control", "adjust", "percent", "200"], a: "Each climate factor has a slider from 0% to 200%. 100% is the scenario as published. CO₂, radiation and deforestation change how much heat is trapped. The others strengthen or weaken that impact.", glow: "#nav a[data-route='3d']" },
  { k: ["thermal", "heat map", "giss"], a: "Turn on Thermal view in the right panel. On the globe it colours local warming. On the 2D map it looks like a NASA GISS temperature-anomaly map, with 2° squares and the GISS colour scale.", glow: "#nav a[data-route='2d']" },
  { k: ["2d", "map", "flat"], a: "The 2D View shows the same Earth as a flat map, always in sync with the globe. Use the 3D / 2D switch, or the 2D View tab.", glow: "#nav a[data-route='2d']" },
  { k: ["3d", "globe", "spin", "rotate"], a: "Open the 3D View, then drag to spin, scroll to zoom, and click to pin a spot. I'll show the country, capital and coordinates there.", glow: "#nav a[data-route='3d']" },
  { k: ["cloud"], a: "Clouds follow real weather belts and drift with the winds. Drought thins them and storms thicken them. Switch them off in the right panel.", glow: "#nav a[data-route='3d']" },
  { k: ["border", "country", "capital", "coordinate", "crosshair"], a: "Move your cursor over the Earth and the crosshair card shows the country, capital and exact coordinates. Click to pin it.", glow: "#nav a[data-route='3d']" },
  { k: ["species page", "animal page"], a: "The Species page shows the animals most likely to be lost in each period, with photos and probabilities.", glow: "#nav a[data-route='species']" },
  { k: ["my matter", "my city", "where i live", "my location", "advice"], a: "Open My Matter and choose a city, or type coordinates. You'll see local warming, sea level against your elevation, nearby events, and advice for your region.", glow: "#nav a[data-route='my-matter']" },
  { k: ["video"], a: "The Videos page searches NASA's video library. Pick a topic and click a video to play it.", glow: "#nav a[data-route='videos']" },
  { k: ["document", "report", "pdf", "paper"], a: "The Documents page lists NASA data portals and technical reports from NASA's Technical Reports Server (NTRS), filterable by topic.", glow: "#nav a[data-route='documents']" },
  { k: ["sleep", "hide ecovie", "turn off"], a: "Click me and choose 'Sleep for now'. I'll rest in the corner until you click me again.", glow: null },
];

function detectScenarios(q) {
  const s = [];
  if (/paris|1\.5|ssp1|best case|optimis|low emission/.test(q)) s.push("ssp126");
  if (/current polic|today'?s polic|ssp2|middle|moderate|business as usual|bau/.test(q)) s.push("ssp245");
  if (/extreme|fossil|worst|ssp5|high emission|pessimis/.test(q)) s.push("ssp585");
  return s;
}
function detectYear(q) {
  const m = q.match(/\b(1[89]\d\d|20\d\d|21\d\d|22\d\d|23[0-2]\d)\b/);
  if (m) return +m[1];
  if (/end of (the )?century/.test(q)) return 2100;
  const n = q.match(/in (\d{2,3}) years/); if (n) return Math.min(END, START + +n[1]);
  if (/next century/.test(q)) return 2200;
  return null;
}
function detectFactors(q) {
  const out = [];
  // match at word starts, so "price" doesn't count as "ice" or "research" as "sea"
  const hit = (w) => new RegExp("(^|[^a-z])" + w.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).test(q);
  for (const [k, words] of Object.entries(FACTOR_WORDS)) if (words.some(hit)) out.push(k);
  if (out.includes("seaLevel") && out.includes("ocean") && !/coral|reef|acid/.test(q)) out.splice(out.indexOf("ocean"), 1);
  if (out.includes("air") && out.length > 1 && !/air quality|pollution|smog|haze/.test(q)) out.splice(out.indexOf("air"), 1);
  return out;
}
function bestMatch(list, q, text) {
  const qt = new Set(tokens(q));
  let best = null, score = 0;
  for (const item of list) {
    const t = tokens(text(item));
    const hits = t.filter((w) => qt.has(w)).length;
    const s = hits / Math.sqrt(t.length + 4);
    if (s > score) { score = s; best = item; }
  }
  return { best, score };
}

export function createBrain(ctx) {
  // ctx: { bandRatio, data: { gistemp, co2, docs, countries }, regionFor(lat, lon, countryObj) }
  const { bandRatio, data } = ctx;

  function projection(q, factors, scenarios, year) {
    const Y = Math.max(START, Math.min(END, year || 2100));
    const scn = scenarios.length ? scenarios : Object.keys(SCENARIOS);
    const fs = factors.length ? factors : ["temp"];
    const rows = scn.map((k) => {
      const r = compute(k, Y);
      const cells = fs.map((f) => (f === "temp" ? `${sign(r.dT, 2)} °C` : r.readout[f].value));
      return `<tr><th class="${k}">${SCENARIOS[k].name}</th>${cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`;
    }).join("");
    const conf = compute(scn[0], Y).confidence;
    const usesSea = fs.includes("seaLevel");
    const lead = fs.length === 1 && fs[0] === "temp"
      ? `Here's how much warmer the world would be in ${Y} than before industrialisation (1850–1900):`
      : `Here's what the data shows for ${Y}:`;
    return {
      html: `<p>${lead}</p><table class="eco-table"><thead><tr><th>Scenario</th>${fs.map((f) => `<th>${FACTOR_NAME[f]}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
        <p class="eco-note">Confidence: ${conf.level} (${esc(conf.note)}).${Y < 2026 ? " That's about today." : ""}</p>`,
      sources: [usesSea ? SRC.sealevel : SRC.climate, SRC.gistemp],
      actions: [{ label: `See ${Y} on the 3D Earth`, go: { hash: "#/3d", scenario: scn[0], year: Y } }],
      glow: "#nav a[data-route='3d']",
    };
  }

  function history(q, year) {
    const g = data.gistemp?.series || [];
    if (!g.length) return null;
    const last = g.at(-1), warm = g.reduce((a, b) => (b[1] > a[1] ? b : a));
    const wantsCo2 = /co2|co₂|carbon|ppm/.test(q);
    if (wantsCo2 && data.co2?.series?.length) {
      const cs = data.co2.series.filter(([y]) => y <= 2024);
      const pick = year ? cs.reduce((a, b) => (Math.abs(b[0] - year) < Math.abs(a[0] - year) ? b : a)) : cs.at(-1);
      return { html: `<p>In <b>${pick[0]}</b>, CO₂ in the atmosphere was about <b>${Math.round(pick[1])} ppm</b>, compared with about 280 ppm before the industrial era. Today it's about 424 ppm.</p>`, sources: [SRC.co2], actions: [], glow: "#nav a[data-route='main']" };
    }
    if (year && year >= g[0][0] && year <= last[0]) {
      const v = g.find(([y]) => y === year);
      return { html: `<p>According to NASA GISTEMP, ${year} was <b>${sign(v[1], 2)} °C</b> compared with the 1951–1980 average.${year === warm[0] ? " That's the warmest year on record!" : ""}</p>`, sources: [SRC.gistemp], actions: [{ label: "See the temperature chart", go: { hash: "#/main" } }], glow: "#nav a[data-route='main']" };
    }
    const first = g.slice(0, 30).reduce((a, [, v]) => a + v, 0) / 30;
    return {
      html: `<p>NASA's GISTEMP record shows the latest year (<b>${last[0]}</b>) at <b>${sign(last[1], 2)} °C</b> compared with 1951–1980. The warmest year on record is <b>${warm[0]}</b> (${sign(warm[1], 2)} °C). Since the 1880s the planet has warmed by about <b>${(last[1] - first).toFixed(1)} °C</b>, and most of that has happened since 1980.</p>`,
      sources: [SRC.gistemp], actions: [{ label: "See the temperature chart", go: { hash: "#/main" } }], glow: "#nav a[data-route='main']",
    };
  }

  function speciesAnswer(q, scenarios, year) {
    const nq = norm(q);
    const sp = SPECIES.find((s) => nq.includes(norm(s.name)) || nq.includes(norm(s.name).replace(/s$/, "")) || nq.includes(norm(s.sci).split(" ")[0]))
      || SPECIES.find((s) => norm(s.name).split(" ").some((w) => w.length > 4 && nq.includes(w)));
    if (sp) {
      const rows = Object.keys(SCENARIOS).map((k) => {
        const r = riskTable(k, {}, bandRatio).find((x) => x.name === sp.name);
        return `<tr><th class="${k}">${SCENARIOS[k].name}</th><td>${Math.round(r.byPeriod[1] * 100)}%</td><td>${Math.round(r.byPeriod[3] * 100)}%</td><td>${Math.round(r.byPeriod[5] * 100)}%</td></tr>`;
      }).join("");
      const r0 = riskTable("ssp245", {}, bandRatio).find((x) => x.name === sp.name);
      return {
        html: `<p>The <b>${esc(sp.name)}</b> (<i>${esc(sp.sci)}</i>) lives in ${esc(sp.where.toLowerCase())}. It's listed as <b>${esc(r0.statusLabel)}</b> on the IUCN Red List. Its biggest climate threats are ${esc(r0.threats.join(" and ").toLowerCase())}.</p>
          <table class="eco-table"><thead><tr><th>Scenario</th><th>by 2100</th><th>by 2200</th><th>by 2325</th></tr></thead><tbody>${rows}</tbody></table>
          <p class="eco-note">Chance of extinction from this site's illustrative risk index (IUCN status × climate exposure), not an official IUCN projection.</p>`,
        sources: [SRC.iucn], actions: [{ label: "Open the Species page", go: { hash: "#/species", scenario: scenarios[0] } }], glow: "#nav a[data-route='species']",
      };
    }
    const k = scenarios[0] || "ssp245";
    const Y = year || 2100;
    const pi = Math.max(0, PERIODS.findIndex(([, b]) => b >= Y));
    const top = riskTable(k, {}, bandRatio).sort((a, b) => b.byPeriod[pi] - a.byPeriod[pi]).slice(0, 6);
    return {
      html: `<p>Under <b>${SCENARIOS[k].name}</b>, these animals have the highest chance of extinction by ${PERIODS[pi][1]}:</p>
        <ol class="eco-list">${top.map((s) => `<li><b>${esc(s.name)}</b>: ${Math.round(s.byPeriod[pi] * 100)}% (${esc(s.threats[0]?.toLowerCase() || "")})</li>`).join("")}</ol>`,
      sources: [SRC.iucn], actions: [{ label: "See them on the Species page", go: { hash: "#/species", scenario: k } }], glow: "#nav a[data-route='species']",
    };
  }

  function placeAnswer(q) {
    const nq = norm(q);
    let place = null;
    for (const [name, lat, lon] of CITIES) {
      const city = norm(name.split(",")[0]);
      if (nq.includes(city)) { place = { name, lat, lon }; break; }
    }
    let country = null;
    if (!place && data.countries) {
      const list = Object.values(data.countries).filter((c) => c.name && c.latlng?.length === 2).sort((a, b) => b.name.length - a.name.length);
      country = list.find((c) => new RegExp(`\\b${norm(c.name)}\\b`).test(nq));
      if (country) place = { name: country.name, lat: country.latlng[0], lon: country.latlng[1] };
    }
    if (!place) return null;
    if (!country && data.countries) {
      const cname = norm(place.name.split(",").at(-1).trim());
      country = Object.values(data.countries).find((c) => norm(c.name) === cname) || null;
    }
    const ratio = bandRatio(place.lat);
    const rows = Object.keys(SCENARIOS).map((k) => `<tr><th class="${k}">${SCENARIOS[k].name}</th><td>${sign(compute(k, 2100).dT * ratio)} °C</td><td>${sign(compute(k, 2300).dT * ratio)} °C</td></tr>`).join("");
    const region = ctx.regionFor(place.lat, place.lon, country);
    return {
      html: `<p><b>${esc(place.name)}</b> sits at ${place.lat.toFixed(1)}°, ${place.lon.toFixed(1)}°. NASA GISTEMP shows its latitude band warming <b>×${ratio.toFixed(2)}</b> as fast as the global average, so its local warming would be:</p>
        <table class="eco-table"><thead><tr><th>Scenario</th><th>2100</th><th>2300</th></tr></thead><tbody>${rows}</tbody></table>
        ${region ? `<p><b>${esc(region.title)}:</b> ${esc(region.risks)}</p><ul class="eco-list">${region.tips.slice(0, 3).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}`,
      sources: [SRC.gistemp, SRC.climate],
      actions: [{ label: "Open in My Matter", go: { hash: "#/my-matter", place } }, { label: "Fly there on the 3D Earth", go: { hash: "#/3d", focus: place } }],
      glow: "#nav a[data-route='my-matter']",
    };
  }

  function docsAnswer(q) {
    const docs = data.docs?.documents || [];
    const qt = new Set(tokens(q));
    const scored = docs.map((d) => {
      const t = tokens(d.title + " " + d.abstract);
      return { d, s: t.filter((w) => qt.has(w)).length / Math.sqrt(t.length + 10) };
    }).filter((x) => x.s > 0.12).sort((a, b) => b.s - a.s).slice(0, 3);
    if (!scored.length) return null;
    return {
      html: `<p>I found these NASA technical reports on that:</p><ul class="eco-list">${scored.map(({ d }) => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a>${d.date ? ` (${new Date(d.date).getFullYear()})` : ""}</li>`).join("")}</ul>`,
      sources: [{ label: "NASA Technical Reports Server", url: "https://ntrs.nasa.gov" }], actions: [{ label: "Browse all documents", go: { hash: "#/documents" } }], glow: "#nav a[data-route='documents']",
    };
  }

  return {
    answer(raw) {
      const q = norm(raw.trim());
      if (!q) return { html: "<p>Ask me something about Earth's climate!</p>", sources: [], actions: [] };
      if (/^(hi|hello|hey|bonjour|salut|coucou|good (morning|evening))\b/.test(q))
        return { html: "<p>Bonjour ! I'm <b>ÉcoVie</b>, your firefly guide to The Alternative Earth. Ask me about warming, sea level, ice, fires, animals, your city, or how to use the website.</p>", sources: [], actions: [] };
      if (/who are you|your name|ecovie\b.*\?|what are you/.test(q))
        return { html: "<p>I'm ÉcoVie: <i>éco</i> + <i>vie</i>, “eco-life” in French. I'm a firefly made of light and NASA data. I answer from NASA's temperature records and the projections on this site, and I can show you around: just hover over anything.</p>", sources: [SRC.climate], actions: [] };

      const scenarios = detectScenarios(q), year = detectYear(q), factors = detectFactors(q);

      // Official references (NASA, NCA5 and the Space Apps resources listed on this site)
      const ref = findReference(q);
      if (ref) return ref;

      // Scope guard: ÉcoVie only answers about climate, Earth data, these references and this website
      const isSpecies = SPECIES.some((s) => q.includes(norm(s.name)) || q.includes(norm(s.name).replace(/s$/, "")));
      const isPlace = CITIES.some(([n]) => q.includes(norm(n.split(",")[0]))) || (data.countries && Object.values(data.countries).some((c) => c.name && new RegExp(`\\b${norm(c.name)}\\b`).test(q)));
      if (!factors.length && !isSpecies && !isPlace && !ON_TOPIC.test(q)) return OFF_TOPIC;

      // How to use the website
      if (/how (do|can|to)|where (is|do|can)|what does|use the|button|click/.test(q)) {
        const h = HELP.find((x) => x.k.some((k) => q.includes(k)));
        if (h) return { html: `<p>${esc(h.a)}</p>`, sources: [], actions: [], glow: h.glow?.split(",").at(-1).trim() };
      }
      // Animals
      if (/species|animal|extinct|wildlife|biodiversity/.test(q) || SPECIES.some((s) => q.includes(norm(s.name)) || q.includes(norm(s.name).replace(/s$/, ""))))
        return speciesAnswer(q, scenarios, year);
      // Places
      const place = placeAnswer(raw);
      if (place) return place;
      // Observed history
      const past = year && year <= 2025;
      if (past || /warmest|record|so far|since 18|observed|already|has (the )?(earth|world|planet) warmed|right now|today|currently|current (temperature|co2)/.test(q)) {
        const h = history(q, year);
        if (h) return h;
      }
      // Scenario explanations
      if (/what is|explain|difference|scenario/.test(q) && /paris|current polic|fossil|scenario|ssp/.test(q) && !factors.length) {
        const qa = QA.find((x) => /three scenarios/.test(x.q));
        return { html: `<p>${esc(qa.a)}</p>`, sources: [SRC.sealevel], actions: [{ label: "Compare them on the 3D Earth", go: { hash: "#/3d" } }], glow: "#scenario-seg, #nav a[data-route='3d']".split(",").at(-1).trim() };
      }
      // Concept questions ("what is…", "why…"): explain first, then add numbers when a factor is involved
      if (/^(what is|whats|what are|explain|why|what does .* mean)/.test(q)) {
        const { best, score } = bestMatch(QA, q, (x) => x.q + " " + x.q + " " + x.a);
        if (best && score > 0.2) {
          const extra = factors.length ? projection(q, factors, scenarios, year) : null;
          return {
            html: `<p>${esc(best.a)}</p>${extra ? extra.html : ""}`,
            sources: [...(best.src ? [{ label: best.src[0], url: best.src[1] }] : []), ...(extra?.sources || [])],
            actions: extra?.actions || [{ label: "More questions & answers", go: { hash: "#/qa" } }],
            glow: extra?.glow || "#nav a[data-route='qa']",
          };
        }
      }
      // Projections
      if (factors.length || year || scenarios.length || /future|will|projection|predict|going to|by 2|expect/.test(q))
        return projection(q, factors, scenarios, year);
      // Site Q&A
      const { best, score } = bestMatch(QA, q, (x) => x.q + " " + x.q + " " + x.a);
      if (best && score > 0.35)
        return { html: `<p>${esc(best.a)}</p>`, sources: best.src ? [{ label: best.src[0], url: best.src[1] }] : [], actions: [{ label: "More questions & answers", go: { hash: "#/qa" } }], glow: "#nav a[data-route='qa']" };
      // How-to without a "how" phrasing
      const h = HELP.find((x) => x.k.some((k) => q.includes(k)));
      if (h) return { html: `<p>${esc(h.a)}</p>`, sources: [], actions: [], glow: h.glow?.split(",").at(-1).trim() };
      // NASA reports
      const d = docsAnswer(q);
      if (d) return d;
      return {
        html: "<p>I couldn't find that in the NASA data and official references on this site, and I only answer from those. Try asking about <b>warming</b>, <b>sea level</b>, <b>Arctic ice</b>, <b>wildfires</b>, <b>a city</b>, <b>an animal</b>, or <b>how to use the 3D Earth</b>.</p>",
        sources: [], actions: [{ label: "See all data sources", go: { hash: "#/documents" } }],
      };
    },
  };
}

// Words that keep a question inside ÉcoVie's scope (climate, Earth data, the references, the website)
const ON_TOPIC = /\b(?:climat|earth|planet|global|warm|nasa|nca5?|national climate|ipcc|ar6|ssp|scenario|paris|fossil|polic|emission|carbon|co2|greenhouse|methane|ocean|sea|ice|glacier|arctic|antarctic|polar|permafrost|fire|storm|hurricane|cyclone|typhoon|rain|drought|desert|forest|coral|reef|species|animal|extinct|wildlife|biodivers|temperature|heat|weather|flood|pollution|air quality|smog|radiation|forcing|energy|gistemp|satellite|data|projection|predict|future|year 2|sar\b|radar|radarsat|swot|knmi|seawifs|chlorophyll|geo\.?ca|statistic|significan|trend|time series|cdo\b|ecosystem|environment|human|3d|2d|map|globe|timeline|slider|zoom|thermal|cloud|border|page|button|website|site|tab|video|document|report|matter|ecovie|tour|help|how do i|bonjour|hello|hi\b)/;

const OFF_TOPIC = {
  html: "<p>Désolé ! I'm ÉcoVie, and I only answer questions about Earth's climate, its future, and how to use this website. My answers come only from NASA data and the official references listed on the Documents page. Try asking: <i>“How much will the sea rise by 2100?”</i></p>",
  sources: [], actions: [{ label: "See the data sources", go: { hash: "#/documents" } }], glow: "#nav a[data-route='documents']",
};

// Match a question to one of the official references shown on the Documents page
const REF_KEYS = [
  [/\bsar\b|synthetic aperture|radar tutorial|python tutorial/, "Synthetic Aperture Radar Python Tutorial"],
  [/ecosystem.*space|monitor.*ecosystem|protect.*ecosystem/, "Monitoring and protecting our ecosystems from space"],
  [/swot|surface water and ocean topography/, "SWOT Satellite Mission"],
  [/geo\.?ca\b/, "Geo.ca"],
  [/radarsat|\brcm\b|constellation mission/, "RADARSAT Constellation Mission (RCM) - Data"],
  [/statistical significance|significan|p-value|p value/, "A Comprehensive Guide to Statistical Significance"],
  [/trend test|detect trend|time series|mann.?kendall/, "Statistical test methods to detect trends in time series data"],
  [/knmi|climate explorer/, "KNMI Climate Explorer"],
  [/seawifs|chlorophyll|ocean colou?r/, "Time-Series Analysis of Remotely-Sensed SeaWiFS Chlorophyll in River-Influenced Coastal Regions"],
  [/climate data online|\bcdo\b|ncei|noaa/, "Climate Data Online (CDO)"],
  [/nca5|national climate assessment|globalchange/, "Fifth National Climate Assessment (NCA5)"],
];
function findReference(q) {
  for (const [re, title] of REF_KEYS) {
    if (!re.test(q)) continue;
    const r = [...OFFICIAL_RESOURCES, ...RESOURCES].find((x) => x[1] === title);
    if (!r) continue;
    const [org, t, d, u] = r;
    return {
      html: `<p><b>${esc(t)}</b> (${esc(org)}): ${esc(d)}</p><p>It's one of the official references this project is built on. You'll find it, with the others, on the Documents page.</p>`,
      sources: [{ label: t, url: u }], actions: [{ label: "Open all official resources", go: { hash: "#/documents" } }], glow: "#nav a[data-route='documents']",
    };
  }
  return null;
}
