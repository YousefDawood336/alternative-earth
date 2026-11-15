/*
 * ÉcoVie: a firefly guide. It drifts after the cursor. When you rest on something it knows,
 * it flies there, makes that element glow, and explains it in a speech bubble.
 * Clicking ÉcoVie opens a small menu: tour of this page, Ask ÉcoVie, sleep.
 */
const TIPS = [
  // Navigation
  ['#nav a[data-route="main"]', "The main page: today's NASA temperature record and the three futures."],
  ['#nav a[data-route="3d"]', "The 3D Earth. Spin it, zoom in, and drive the climate across 300 years."],
  ['#nav a[data-route="2d"]', "The same Earth as a flat map, in sync with the globe. Try the Thermal view here: it looks like a NASA GISS map."],
  ['#nav a[data-route="species"]', "Animals we could lose, period by period, with their chance of extinction."],
  ['#nav a[data-route="qa"]', "Short answers to big questions, each with a NASA source."],
  ['#nav a[data-route="documents"]', "NASA data portals and technical reports behind every factor."],
  ['#nav a[data-route="videos"]', "Videos from NASA's image and video library. Click one to play it here."],
  ['#nav a[data-route="my-matter"]', "Pick your city to see its future, and advice for your region."],
  ['#nav a[data-route="ask"]', "That's me! Ask me anything about the climate data on this site."],
  [".logo", "Back to the main page."],
  // Welcome / main
  [".w-cta .btn-primary", "Come in! This takes you to the main page."],
  [".w-cta .btn-ghost", "Impatient? Jump straight onto the 3D Earth."],
  [".w-earth", "This is the real Earth, photographed by NASA's EPIC camera 1.5 million km away. Watch it warm as the years run on."],
  ["#h-chart", "Global temperature since 1880, from NASA GISTEMP. Each point is one year compared with 1951–1980."],
  [".scenario-card", (el) => `Click to open the 3D Earth with the "${el.querySelector("h3")?.textContent}" scenario.`],
  [".index-list a", (el) => `Open ${el.querySelector("strong")?.textContent}.`],
  // Viewer
  ["#scenario-seg button", (el) => ({
    ssp126: "Paris Path: emissions fall fast and warming stays below 2 °C.",
    ssp245: "Current Policies: roughly where today's policies lead, about 2.7 °C by 2100.",
    ssp585: "Extreme Fossil Fuel: emissions keep growing, about 4.4 °C by 2100 and rising.",
  })[el.dataset.scn]],
  [".factor", (el) => `${el.querySelector(".f-name")?.textContent}: ${el.querySelector(".f-detail")?.textContent}. Now ${el.querySelector(".f-val")?.textContent}. Move the slider from 0% to 200% to weaken or strengthen it, and watch the Earth change.`],
  ["#reset-factors", "Put every factor back to 100%, the scenario as published."],
  ["#play", "Press play and watch 300 years pass, about 15 years per second. You can also press the space bar."],
  ["#year", "Drag the timeline to any year from 2025 to 2325. The hatched part after 2150 is less certain."],
  ["#view-seg button", (el) => (el.dataset.view === "3d" ? "Show the globe." : "Show the flat map. Same data, same moment.")],
  [".year-block", "The year you're looking at and the global warming since pre-industrial times (1850–1900)."],
  ["#r-spark", "Warming over 300 years for all three scenarios. The dot marks where you are."],
  [".kv", "Key numbers for this year: CO₂, sea level, extra energy trapped, and Arctic sea ice."],
  ['label.toggle:has(#mode-thermal)', "Thermal view colours the planet by how much each region warms. In 2D it looks like a NASA GISS map."],
  ['label.toggle:has(#mode-clouds)', "Clouds follow real weather belts, and the climate factors thin or thicken them."],
  ['label.toggle:has(#mode-borders)', "Show or hide country borders."],
  [".zoom-ctl", "Zoom in and out. When you get close, a sharper NASA image loads for that area."],
  ["#globe-canvas", "Drag to spin the Earth, scroll to zoom, and click anywhere to pin it. I'll tell you the country, capital and coordinates there.", true],
  ["#map-canvas", "Drag to move, scroll or pinch to zoom, double-click to dive in. Click to pin a spot.", true],
  ["#giss", "This styling follows NASA GISS temperature maps: 2° squares coloured by how much warmer each one is than 1951–1980."],
  // Species
  ["#sp-scenario button", "Choose a future. The animals' chances change with it."],
  ["#sp-periods .chip", (el) => `Show which animals are most likely to be lost between ${el.textContent}.`],
  [".sp-card", (el) => `${el.querySelector("h3")?.textContent}: ${el.querySelector(".sp-prob b")?.textContent} ${el.querySelector(".sp-prob span")?.textContent}. Click the photo to learn more about it.`],
  ["#sp-table", "Every species and every period. The outlined cell is when its chance first passes 50%."],
  // Other pages
  ["#qa-search", "Type a word such as 'sea' or 'coral' to filter the questions."],
  [".qa summary", "Click to open the answer."],
  [".resource", "A NASA data portal. It opens in a new tab."],
  ["#doc-chips .chip", "Filter the NASA reports by topic."],
  [".doc", "A NASA technical report. Open the record or the PDF."],
  ["#video-chips .chip", "Pick a topic to search NASA's video library."],
  [".video", "Click to play this NASA video."],
  ["#m-city", "Choose a city. I'll fill in its coordinates for you."],
  ["#m-lat", "Or type your own latitude (north is positive)."],
  ["#m-lon", "And longitude (east is positive)."],
  ["#m-go", "Show the future of this place: warming, sea level, nearby events, and advice for your region."],
  ["#m-show", "Fly to this place on the 3D Earth."],
  [".actions", "Advice picked for your region and this exact spot."],
  // Ask page
  ["#ask-input", "Ask me something, for example: 'How much will the sea rise by 2100?'"],
  [".ask-chip", "Click a suggestion to ask it."],
];

const TOURS = {
  welcome: [".w-title", ".w-earth", ".w-cta .btn-primary"],
  home: ["#nav", "#h-chart", ".scenario-card", ".index-list"],
  viewer: ["#scenario-seg", ".factor", "#timeline", "#play", "#view-seg", ".year-block", 'label.toggle:has(#mode-thermal)', "#globe-canvas"],
  species: ["#sp-scenario", "#sp-periods", ".sp-card", "#sp-table"],
  qa: ["#qa-search", ".qa"],
  documents: [".resource", "#doc-chips", ".doc"],
  videos: ["#video-chips", ".video"],
  "my-matter": ["#m-city", "#m-go", "#m-result"],
  ask: ["#ask-input", ".ask-chips"],
};
const TOUR_TEXT = {
  ".w-title": "Bonjour ! I'm ÉcoVie, your firefly guide. Hover over anything and I'll explain it.",
  "#nav": "These tabs are the sections of the site. Rest your cursor on one and I'll tell you what's inside.",
  "#timeline": "This is the timeline: 300 years of climate. Drag it or press play.",
  "#m-result": "Your results appear here, with advice for your region.",
  ".ask-chips": "Not sure what to ask? Start with one of these.",
  ".index-list": "Every section of the site. Click one to open it.",
  "#scenario-seg": "First choose a future: Paris Path, Current Policies or Extreme Fossil Fuel.",
};

function tipFor(el) {
  for (const [sel, text, once] of TIPS) {
    const hit = el.closest?.(sel);
    if (hit) return { el: hit, text: typeof text === "function" ? text(hit) : text, sel, once };
  }
  return null;
}

export function createEcovie({ onAsk = () => {} } = {}) {
  let asleep = false;
  try { asleep = localStorage.getItem("ecovie-asleep") === "1"; } catch {}

  const root = document.createElement("div");
  root.id = "ecovie";
  root.innerHTML = `
    <button class="eco-fly" aria-label="ÉcoVie, your firefly guide. Click for options.">
      <span class="eco-wing l"></span><span class="eco-wing r"></span><span class="eco-body"></span><span class="eco-light"></span>
    </button>
    <div class="eco-bubble" role="status" aria-live="polite"><b>ÉcoVie</b><p></p><div class="eco-actions"></div></div>
    <div class="eco-menu" hidden>
      <button data-a="tour">Show me around this page</button>
      <button data-a="ask">Ask ÉcoVie a question</button>
      <button data-a="sleep">Sleep for now</button>
    </div>`;
  document.body.appendChild(root);
  const fly = root.querySelector(".eco-fly"), bubble = root.querySelector(".eco-bubble"), text = bubble.querySelector("p");
  const actions = bubble.querySelector(".eco-actions"), menu = root.querySelector(".eco-menu");

  // ---------- Motion: drift after the cursor, or fly to a target ----------
  const pos = { x: innerWidth - 90, y: innerHeight - 90 }, mouse = { x: innerWidth - 120, y: innerHeight - 120 };
  let target = null, glowing = null, hideTimer = null, dwellTimer = null, lastTip = null, tour = null, pinUntil = 0;
  const shownOnce = new Set();
  addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });

  function frame(t) {
    let tx, ty;
    if (asleep) { tx = innerWidth - 34; ty = innerHeight - 34; }
    else if (target && document.contains(target)) {
      const r = target.getBoundingClientRect();
      tx = Math.min(innerWidth - 24, r.right - 6) + Math.sin(t / 420) * 4;
      ty = Math.max(24, r.top + 4) + Math.cos(t / 380) * 4;
    } else {
      tx = mouse.x + 34 + Math.sin(t / 700) * 14;
      ty = mouse.y - 30 + Math.cos(t / 560) * 10;
    }
    const k = target ? 0.12 : 0.06;
    pos.x += (tx - pos.x) * k; pos.y += (ty - pos.y) * k;
    root.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    // keep the bubble on screen
    root.classList.toggle("left", pos.x > innerWidth - 330);
    root.classList.toggle("down", pos.y < 170);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function setGlow(el) {
    if (glowing === el) return;
    glowing?.classList.remove("eco-glow");
    glowing = el;
    el?.classList.add("eco-glow");
  }
  function say(msg, { el = null, buttons = [], ms = 0 } = {}) {
    clearTimeout(hideTimer);
    text.textContent = msg;
    actions.innerHTML = "";
    for (const b of buttons) {
      const btn = document.createElement("button");
      btn.textContent = b.label; btn.addEventListener("click", b.onClick);
      actions.appendChild(btn);
    }
    bubble.classList.add("show");
    target = el; setGlow(el);
    if (ms) hideTimer = setTimeout(quiet, ms);
  }
  function quiet() {
    if (tour || Date.now() < pinUntil) return;
    bubble.classList.remove("show");
    target = null; setGlow(null); lastTip = null;
  }

  // ---------- Hover tips ----------
  document.addEventListener("pointerover", (e) => {
    if (asleep || tour || Date.now() < pinUntil || root.contains(e.target)) return;
    const tip = tipFor(e.target);
    clearTimeout(dwellTimer);
    if (!tip) { hideTimer = setTimeout(quiet, 900); return; }
    if (lastTip && lastTip.el === tip.el) return;
    if (tip.once && shownOnce.has(tip.sel)) return;
    dwellTimer = setTimeout(() => {
      lastTip = tip;
      if (tip.once) shownOnce.add(tip.sel);
      say(tip.text, { el: tip.el });
    }, 380);
  });
  document.addEventListener("pointerout", (e) => {
    if (lastTip && !lastTip.el.contains(e.relatedTarget)) { clearTimeout(hideTimer); hideTimer = setTimeout(quiet, 700); }
  });

  // ---------- Menu, tour, sleep ----------
  fly.addEventListener("click", (e) => {
    e.stopPropagation();
    if (asleep) { wake(); return; }
    menu.hidden = !menu.hidden;
  });
  document.addEventListener("click", (e) => { if (!root.contains(e.target)) menu.hidden = true; });
  menu.addEventListener("click", (e) => {
    const a = e.target.dataset.a; if (!a) return;
    menu.hidden = true;
    if (a === "tour") startTour();
    if (a === "ask") onAsk();
    if (a === "sleep") sleep();
  });
  function sleep() {
    asleep = true; root.classList.add("asleep"); quiet();
    try { localStorage.setItem("ecovie-asleep", "1"); } catch {}
  }
  function wake() {
    asleep = false; root.classList.remove("asleep");
    try { localStorage.removeItem("ecovie-asleep"); } catch {}
    say("Bonjour ! I'm awake. Hover over anything and I'll explain it.", { ms: 3500 });
  }
  if (asleep) root.classList.add("asleep");

  function startTour() {
    const page = document.body.dataset.page;
    const steps = (TOURS[page] || []).map((s) => document.querySelector(s)).filter((el) => el && el.offsetParent !== null);
    if (!steps.length) { say("There's nothing to show on this page yet. Try hovering over things!", { ms: 3000 }); return; }
    tour = { steps, i: 0 };
    showStep();
  }
  function showStep() {
    const { steps, i } = tour;
    const el = steps[i];
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const tip = tipFor(el);
    const sel = (TOURS[document.body.dataset.page] || []).find((s) => el.matches(s));
    const msg = TOUR_TEXT[sel] || tip?.text || "This is part of the page.";
    say(`${i + 1}/${steps.length} · ${msg}`, {
      el,
      buttons: [
        ...(i < steps.length - 1 ? [{ label: "Next →", onClick: () => { tour.i++; showStep(); } }] : []),
        { label: i < steps.length - 1 ? "End tour" : "Merci, done!", onClick: endTour },
      ],
    });
  }
  function endTour() { tour = null; quiet(); }
  addEventListener("hashchange", () => { if (tour) endTour(); else quiet(); menu.hidden = true; });

  return {
    say,
    /** Fly to an element, make it glow and explain (used by Ask ÉcoVie). */
    point(selector, msg, ms = 3200) {
      if (asleep) return;
      let el = document.querySelector(selector);
      if (!el) return;
      // On phones the tabs sit inside the folded menu: point at the Menu button instead
      if (!el.getClientRects().length && el.closest("#nav")) { el = document.querySelector("#menu-btn"); msg = "Open the menu: the page I mean is in there."; }
      pinUntil = Date.now() + ms;
      say(msg, { el });
      setTimeout(() => { pinUntil = 0; quiet(); }, ms);
    },
    welcome() {
      if (asleep) return;
      let seen = false;
      try { seen = sessionStorage.getItem("ecovie-hi") === "1"; sessionStorage.setItem("ecovie-hi", "1"); } catch {}
      if (!seen) say("Bonjour ! I'm ÉcoVie, a little firefly. Hover over anything and I'll explain it, or click me for a tour.", { ms: 6000 });
    },
  };
}
