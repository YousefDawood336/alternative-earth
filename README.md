# The Alternative Earth

A NASA Space Apps Challenge project. It visualises 300-year Earth climate projections (2025 → 2325) based on NASA and NCA5 data, on an interactive 3D Earth with data tables. **Goal:** raise environmental awareness by showing clearly how human choices today shape the planet's future.

**Project rule:** NASA resources are the main database. All NASA data goes through [`js/nasa.js`](js/nasa.js).

## Publish on GitHub Pages (public link)
The site is plain HTML/CSS/JavaScript, with no build step, so GitHub Pages can host it as it is.

1. Create a free account at https://github.com and click **New repository**. Name it, for example `alternative-earth`, and set it to **Public**. Free GitHub Pages needs a public repository.
2. On the new repository page, click **uploading an existing file**. Drag in **everything inside this folder**: `index.html`, `.nojekyll`, and the `css`, `js`, `data` and `scripts` folders. Then click **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, and click **Save**.
4. After about a minute, the page shows your public link: `https://<your-username>.github.io/alternative-earth/`

Anyone with the link can use the whole site: the 3D Earth, the tables, ÉcoVie, the videos. Visitors cannot change the website or its code. Only you, the repository owner, can.

## Run it on your computer
```
py -m http.server 8000
```
Then open http://localhost:8000. To refresh the NASA snapshots, run `py scripts/fetch_nasa_data.py`.

## Sections
| Route | What it does |
|---|---|
| `#/` | Landing page: live NASA EPIC Earth photo, GISTEMP temperature record, the three scenarios |
| `#/3d` | 3D globe: timeline to 2325, 11 climate-factor controls, 3 scenarios, Thermal view, clouds and borders |
| `#/2d` | The same view as a flat map, with identical shader and state (GISS-style map in Thermal view) |
| `#/species` | 28 climate-threatened animals with photos and IUCN status. For each period (2025–2050 … 2250–2325): the species most likely lost, and the extinction probability in a table across all periods |
| `#/qa` | Questions and answers with NASA sources |
| `#/documents` | NASA data portals plus 80 NASA NTRS technical reports |
| `#/videos` | NASA Image & Video Library search with an in-page player |
| `#/my-matter` | Pick a place: local warming per scenario, SRTM elevation vs sea level, nearby EONET events, region-specific advice, plus notes for this exact spot (low-lying coast, fast warming, dryland, fire belt, Arctic) |

| `#/` | Full-screen welcome page; **Enter** goes to `#/main` |
| `#/ask` | **Ask ÉcoVie**: chat with the firefly assistant |

### ÉcoVie (firefly assistant)
- [`js/ecovie-guide.js`](js/ecovie-guide.js): the firefly drifts after the cursor. When you rest on a known element (nav tabs, scenario buttons, every factor slider, timeline, toggles, species cards, forms…), it flies there, makes the element glow, and explains it. Clicking ÉcoVie opens a menu: a guided tour of the current page, Ask ÉcoVie, or sleep (remembered in the browser).
- [`js/ecovie-brain.js`](js/ecovie-brain.js): the answer engine runs in the browser with no external AI service. It reads the question for a scenario, a year, climate factors, species, cities or countries, and how-to questions. It answers from NASA GISTEMP, the GISS CO₂ history, NTRS reports, the scenario emulator, the species risk index, the region advice and the Q&A. Answers list their sources, offer action buttons (open the 3D Earth at that year and scenario, fly to a city, open My Matter), and make ÉcoVie glow the relevant part of the site.

### Species risk model (illustrative)
[`js/species.js`](js/species.js): each species starts from a yearly risk set by its IUCN Red List category, multiplied by its exposure to the model's climate factors at its latitude: sea-ice loss, coral loss, sea level, local heat, fire, drought, deforestation and acidification. Integrated in 5-year steps, this gives the cumulative chance of extinction. It follows the scenario and the 3D View sliders. It is not an official IUCN projection. Photos come from Wikipedia / Wikimedia Commons (`data/species_images.json`).

## NASA data sources
| Used for | NASA source | How |
|---|---|---|
| Globe surface (ocean bathymetry shading, 8192 px) | GIBS `BlueMarble_ShadedRelief_Bathymetry` | live |
| Zoom detail (no pixelation) | GIBS WMS image of just the visible region, fetched after zooming | live |
| Land / water | GIBS `OSM_Land_Water_Map` | live, decoded in browser |
| Sea-level flooding | GIBS `SRTM_Color_Index` + its colormap → elevation (5 m bins, 56°S–60°N) | live, decoded in browser |
| Events near a place (My Matter) | EONET open events | live |
| Thermal latitude pattern | GISTEMP v4 zonal means | snapshot |
| Temperature history | GISTEMP v4 global | snapshot |
| CO₂ history | NASA GISS greenhouse-gas history | snapshot |
| Documents | NTRS | snapshot |
| Videos | NASA Image & Video Library | live |
| Hero photo | DSCOVR EPIC | live |

### Supporting non-NASA data
| Used for | Source |
|---|---|
| Country borders + country under the crosshair | Natural Earth 1:50m via `world-atlas` (public domain) |
| Country names and capitals | `mledoze/countries` (ODbL), snapshot in `data/countries.json` |
| 3D engine / geo helpers | three.js, d3-geo, topojson-client (CDN) |

### Visual notes
- No night side: the light follows the camera, so the visible side of the Earth is always lit.
- Clouds and storms are procedural. Clouds follow climate bands (ITCZ, dry subtropics, storm tracks) and drift with the trade winds and westerlies. Drought and desertification thin them, and the storm factor thickens them. Cyclones form at random in real cyclone basins, track west and then curve poleward, and weaken over land. Their number and strength follow the storm factor.
- The 2D thermal view mimics NASA GISS anomaly maps: 2°×2° cells, the GISS colour scale, a baseline of 1951–1980, and the global mean in the header.

## Climate model
[`js/model.js`](js/model.js) is a simplified, transparent emulator, not a full climate model.
- Scenarios: Paris Path = SSP1-2.6, Current Policies = SSP2-4.5, Extreme Fossil Fuel = SSP5-8.5.
- Values are anchored to IPCC AR6, as presented by NASA's climate site and the NASA Sea Level Projection Tool. Results are robust to 2100, medium confidence to 2150, and low confidence after that (the hatched timeline zone).
- CO₂-equivalent, radiation and deforestation change radiative forcing, which changes warming and everything downstream. The other sliders scale each impact from 0% to 200%.
- Impact scaling vs warming follows AR6 SPM Figure SPM.6.

## Files
- `index.html`: page shell (all sections)
- `css/styles.css`: design (big serif type, black/ivory bands, gold accent)
- `js/nasa.js`: NASA data layer
- `js/model.js`: climate emulator
- `js/earth.js`: Three.js 3D globe + 2D map sharing one shader
- `js/app.js`: router and page logic · `js/state.js`: shared state · `js/content.js`: Q&A, links, cities
- `scripts/fetch_nasa_data.py` → `data/nasa/*.json`
