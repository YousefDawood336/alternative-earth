/*
 * Earth engine: one shader drives BOTH the 3D globe and the 2D map, with shared uniforms,
 * so the two views always show exactly the same climate state.
 * Base imagery: NASA GIBS Blue Marble (shaded relief + bathymetry), always fully lit (no night side).
 * Zooming fetches a high-resolution NASA image of just the visible region (no pixelation).
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as NASA from "./nasa.js";
import { loadCountries } from "./geo.js";

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vPos;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const NOISE = /* glsl */ `
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise3(p); p = p * 2.03 + 0.17; a *= 0.5; } return v; }
float fbm3l(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { v += a * noise3(p); p = p * 2.03 + 0.17; a *= 0.5; } return v / 0.875; }
vec3 dirOf(float lat, float lon) { float a = radians(lat), b = radians(lon); return vec3(cos(a) * cos(b), sin(a), cos(a) * sin(b)); }
`;

// One-time bake of static noise fields into equirectangular textures (keeps the per-frame shader light)
const BAKE_FRAG = /* glsl */ `
precision highp float;
uniform float uPass, uSeed;
varying vec2 vUv;
${NOISE}
void main() {
  float lat = (vUv.y - 0.5) * 180.0, lon = (vUv.x - 0.5) * 360.0;
  vec3 P = dirOf(lat, lon);
  if (uPass < 0.5) {
    gl_FragColor = vec4(fbm3(P * 9.0), fbm3(P * 6.0 + 3.1), fbm3(P * 4.0 + 7.7), fbm3(P * 14.0));
  } else {
    vec3 warp = vec3(fbm3(P * 2.1 + uSeed), fbm3(P * 2.1 + uSeed + 5.2), fbm3(P * 2.1 + uSeed + 9.7)) - 0.5;
    vec3 W = P + warp * 0.55;
    float big = fbm3(W * 3.4 + uSeed), mid = fbm3(W * 12.0 + uSeed * 1.7), fine = fbm3(W * 40.0 + uSeed * 0.3);
    gl_FragColor = vec4(big * 0.45 + mid * 0.38 + fine * 0.17, fbm3(P * 1.3 + uSeed * 0.7), mid, fbm3(P * 6.0 + 11.0));
  }
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uDay, uMask, uLive, uFires, uAero, uLst, uSst, uBorders, uDetail, uNoiseA, uNoiseB;
uniform float uFlat, uGissOn, uTime, uThermal, uLiveOn, uLiveReady, uReady, uClouds, uSeed, uBordersOn;
uniform float uDT, uSea, uIce, uDesert, uFire, uStorm, uDrought, uAir, uCoral, uDeforest, uRad;
uniform float uDetailOn, uDetailLive;
uniform vec4 uDetailBox;
uniform float uBand[8];
uniform vec4 uStorms[8];
uniform vec3 uAirC[7];
uniform vec2 uReefs[6];
uniform vec3 uLight;
uniform vec3 uFocus;
uniform float uFocusScale;
uniform vec2 uTexel;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vPos;
${NOISE}
float bandRatio(float lat) {
  float c[8] = float[8](77.0, 54.0, 34.0, 12.0, -12.0, -34.0, -54.0, -77.0);
  if (lat >= c[0]) return uBand[0];
  if (lat <= c[7]) return uBand[7];
  for (int i = 0; i < 7; i++) {
    if (lat <= c[i] && lat >= c[i + 1]) return mix(uBand[i], uBand[i + 1], (c[i] - lat) / (c[i] - c[i + 1]));
  }
  return 1.0;
}

vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.10, 0.22, 0.50), b = vec3(0.25, 0.62, 0.78), c = vec3(0.98, 0.88, 0.50), d = vec3(0.94, 0.40, 0.16), e = vec3(0.50, 0.04, 0.12);
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.5) return mix(b, c, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c, d, (t - 0.5) / 0.25);
  return mix(d, e, (t - 0.75) / 0.25);
}

// NASA GISS map colour scale (°C anomaly vs 1951–1980)
vec3 giss(float a) {
  if (a < -2.0) return vec3(0.25, 0.27, 0.70);
  if (a < -1.0) return vec3(0.40, 0.55, 0.86);
  if (a < -0.5) return vec3(0.62, 0.76, 0.93);
  if (a < -0.2) return vec3(0.82, 0.89, 0.96);
  if (a < 0.2) return vec3(1.0);
  if (a < 0.5) return vec3(1.0, 0.95, 0.68);
  if (a < 1.0) return vec3(1.0, 0.83, 0.40);
  if (a < 2.0) return vec3(1.0, 0.58, 0.22);
  if (a < 4.0) return vec3(0.93, 0.27, 0.13);
  if (a < 8.0) return vec3(0.68, 0.06, 0.10);
  return vec3(0.36, 0.03, 0.07);
}

vec2 offsetDeg(vec2 ll, vec2 c) {
  float dlon = mod(ll.y - c.y + 540.0, 360.0) - 180.0;
  return vec2(dlon * cos(radians(ll.x)), ll.x - c.x);
}

// Base imagery: Blue Marble, or today's VIIRS image with data gaps filled; plus hi-res patch when zoomed
vec3 baseColor(vec2 uv, float lat, float lon) {
  vec3 c = texture2D(uDay, uv).rgb;
  if (uLiveOn > 0.5 && uLiveReady > 0.5) {
    vec3 l = texture2D(uLive, uv).rgb;
    c = mix(c, l, smoothstep(0.02, 0.06, dot(l, vec3(0.333))));
  }
  if (uDetailOn > 0.5) {
    vec4 b = uDetailBox;
    if (lat > b.x && lat < b.y && lon > b.z && lon < b.w) {
      vec2 duv = vec2((lon - b.z) / (b.w - b.z), (lat - b.x) / (b.y - b.x));
      vec3 d = texture2D(uDetail, duv).rgb;
      float edge = min(min(duv.x, 1.0 - duv.x), min(duv.y, 1.0 - duv.y));
      float k = smoothstep(0.0, 0.02, edge);
      if (uDetailLive > 0.5) k *= smoothstep(0.02, 0.06, dot(d, vec3(0.333)));
      c = mix(c, d, k);
    }
  }
  return c;
}

// Tropical cyclones: spiral rain bands, eye and eyewall, turbulent cloud texture, rotating
float storms(vec2 ll) {
  float cover = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 s = uStorms[i];
    if (s.w < 0.02) continue;
    vec2 d = offsetDeg(ll, s.xy) / s.z;          // normalised offset (1 = storm radius)
    float r = length(d);
    if (r > 3.0) continue;
    float hemi = s.x >= 0.0 ? 1.0 : -1.0;          // NH counter-clockwise, SH clockwise
    float spin = uTime * (0.35 + 0.5 * s.w) * hemi / (r + 0.35);
    vec2 q = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * d;
    float ang = atan(q.y, q.x) * hemi;
    float n = fbm3l(vec3(q * 2.6, float(i) * 13.7 + uSeed));
    float n2 = noise3(vec3(q * 7.0, float(i) * 5.1 + 3.0));
    float bands = 0.5 + 0.5 * sin(ang * 2.0 - log(r + 0.04) * 4.2 + n * 3.5);
    float body = exp(-r * 1.25);
    float eyeR = mix(0.16, 0.07, s.w);
    float eye = smoothstep(eyeR, eyeR * 1.9, r);
    float wall = exp(-pow((r - eyeR * 2.2) / (eyeR * 1.4), 2.0));
    float cdo = exp(-pow(r / 0.55, 2.0));          // central dense overcast
    float cov = (bands * 0.5 + n * 0.85) * body * 1.7 + cdo * 0.9 + wall * 0.5;
    cov = smoothstep(0.12, 0.85, cov * (0.75 + 0.45 * n2)) * eye;
    cover = max(cover, cov * clamp(s.w * 1.6, 0.0, 1.0));
  }
  return clamp(cover, 0.0, 1.0);
}

// Cloud field: climatological bands (ITCZ, subtropical clear belts, storm tracks), drifting with
// trade winds and westerlies, reshaped by the climate factors.
vec2 clouds(float lat, float lon) {
  float alat = abs(lat);
  float itcz = exp(-pow((lat - 6.0) / 8.0, 2.0));
  float subtrop = exp(-pow((alat - 24.0) / 8.0, 2.0));
  float track = exp(-pow((alat - 56.0) / 11.0, 2.0));
  // Trade winds blow clouds west in the tropics, westerlies east at mid-latitudes
  float speed = mix(-1.4, 2.0, smoothstep(22.0, 34.0, alat));
  float l2 = lon - uTime * speed;
  vec4 b = texture2D(uNoiseB, vec2(fract(l2 / 360.0 + 0.5), lat / 180.0 + 0.5));
  float cov = 0.36 + 0.16 * itcz + 0.20 * track - 0.18 * subtrop + (b.g - 0.5) * 0.4;
  cov += (uStorm * 0.14) * (itcz + track) - (uDrought * 0.16 + uDesert * 0.10) * subtrop - uDeforest * 0.10 * itcz + uDT * 0.008;
  float n = clamp((b.r - 0.47) * 2.6 + 0.5, 0.0, 1.0) * 0.88 + noise3(dirOf(lat, l2) * 110.0) * 0.12;
  float c = pow(smoothstep(1.0 - cov, 1.0 - cov + 0.28, n), 1.3);
  return vec2(c, b.b);
}

void main() {
  float lat = (vUv.y - 0.5) * 180.0;
  float lon = (vUv.x - 0.5) * 360.0;
  float alat = abs(lat);
  vec3 P = dirOf(lat, lon);

  vec4 m = texture2D(uMask, vUv);
  float land = step(0.5, m.r) * uReady;
  float ocean = 1.0 - land;
  float elev = m.g * 255.0;
  float hasElev = step(0.5, m.b);

  vec3 col = baseColor(vUv, lat, lon);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float flooded = 0.0;
  float cloudA = 0.0;
  vec3 cloudCol = vec3(1.0);
  bool gissMode = uFlat > 0.5 && uGissOn > 0.5 && uThermal > 0.5 && uLiveOn < 0.5;

  if (gissMode) {
    // 2D thermal, styled after NASA GISS surface temperature anomaly maps: 2°×2° cells, GISS colour scale
    float cLat = (floor(lat / 2.0) + 0.5) * 2.0, cLon = (floor(lon / 2.0) + 0.5) * 2.0;
    vec2 cuv = vec2(cLon / 360.0 + 0.5, cLat / 180.0 + 0.5);
    float cLand = step(0.5, texture2D(uMask, cuv).r);
    float noiseA = (texture2D(uNoiseA, cuv).g - 0.5) * 1.6 * max(0.6, uDT * 0.45);
    float a = (uDT - 0.3) * bandRatio(cLat) * mix(1.0, 1.3, cLand) + noiseA;
    col = giss(a);
    // coastlines (black) from the NASA land mask, borders grey
    float e = 0.0;
    vec2 t = uTexel * 1.2;
    e += abs(texture2D(uMask, vUv + vec2(t.x, 0.0)).r - m.r) + abs(texture2D(uMask, vUv + vec2(0.0, t.y)).r - m.r);
    e += abs(texture2D(uMask, vUv - vec2(t.x, 0.0)).r - m.r) + abs(texture2D(uMask, vUv - vec2(0.0, t.y)).r - m.r);
    col = mix(col, vec3(0.08), clamp(e, 0.0, 1.0) * 0.85);
    col = mix(col, vec3(0.35), texture2D(uBorders, vUv).a * 0.35 * uBordersOn);
  } else if (uLiveOn < 0.5) {
    vec4 NA = texture2D(uNoiseA, vUv);
    vec4 NB = texture2D(uNoiseB, vUv);
    float n1 = NA.r, n2 = NA.g, n3 = NA.b;
    float green = clamp((col.g - max(col.r, col.b)) * 5.0, 0.0, 1.0);

    // Deforestation: tropical forest patches turn to cleared land
    float tropic = 1.0 - smoothstep(16.0, 26.0, alat);
    float defo = land * tropic * green * smoothstep(1.0 - uDeforest * 0.75, 1.08 - uDeforest * 0.75, n1);
    col = mix(col, vec3(0.56, 0.43, 0.29), defo * 0.85);

    // Desertification: subtropical dryland belts expand
    float belt = smoothstep(8.0, 16.0, alat) * (1.0 - smoothstep(40.0, 50.0, alat));
    float des = land * belt * smoothstep(0.92 - uDesert * 0.42, 1.0 - uDesert * 0.42, n2);
    col = mix(col, vec3(0.80, 0.68, 0.48), des * 0.75);

    // Drought: patchy vegetation browning across mid-latitudes
    float dr = land * (1.0 - smoothstep(58.0, 66.0, alat)) * smoothstep(0.66, 0.8, n3 + uDrought * 0.22) * uDrought;
    col = mix(col, col * vec3(1.1, 0.92, 0.66) + vec3(0.05, 0.03, 0.0), dr * 0.6);

    // Sea ice: present-day extent drawn, then retreating poleward with ice loss
    float wob = (n1 - 0.5) * 6.0 + (noise3(P * 30.0) - 0.5) * 2.0;
    float edgeN = mix(72.0, 90.5, uIce), edgeS = mix(-63.0, -72.0, uIce);
    float seaIce = ocean * (smoothstep(edgeN - 0.8, edgeN + 0.8, lat + wob) + (1.0 - smoothstep(edgeS - 0.8, edgeS + 0.8, lat + wob)));
    vec3 iceCol = mix(vec3(0.82, 0.87, 0.92), vec3(0.97, 0.98, 1.0), noise3(P * 60.0));
    col = mix(col, iceCol, clamp(seaIce, 0.0, 1.0) * 0.92);
    float bright = smoothstep(0.55, 0.75, lum);
    float sheet = land * bright * step(58.0, alat);
    float sheetMelt = sheet * smoothstep(1.0 - uIce * 0.45, 1.05 - uIce * 0.45, NA.a);
    col = mix(col, vec3(0.36, 0.33, 0.30), sheetMelt * 0.85);

    // Sea level: NASA SRTM elevation (5 m bins) below the new sea level floods
    flooded = land * hasElev * step(elev + 4.0 * noise3(P * 300.0), uSea);

    // Ocean warming & coral bleaching tint
    float warmBelt = 1.0 - smoothstep(25.0, 45.0, alat);
    col = mix(col, col * vec3(1.0, 1.08, 0.85) + vec3(0.0, 0.05, 0.03), ocean * uCoral * 0.4 * warmBelt * (1.0 - seaIce));

    // Air pollution haze
    float haze = 0.0;
    for (int i = 0; i < 7; i++) {
      vec2 d = offsetDeg(vec2(lat, lon), uAirC[i].xy);
      haze += exp(-dot(d, d) / (uAirC[i].z * uAirC[i].z));
    }
    haze *= (0.6 + 0.6 * NB.a);
    col = mix(col, vec3(0.58, 0.52, 0.42), clamp(haze * uAir * 0.75, 0.0, 0.7));

    // Wildfires: flickering hot spots and smoke in boreal, Mediterranean and savanna belts
    float zone = land * (smoothstep(47.0, 52.0, alat) * (1.0 - smoothstep(66.0, 70.0, alat))
               + smoothstep(28.0, 32.0, alat) * (1.0 - smoothstep(42.0, 46.0, alat))
               + (smoothstep(4.0, 8.0, alat) * (1.0 - smoothstep(18.0, 22.0, alat))) * 0.9) * (1.0 - des * 0.7) * (1.0 - flooded);
    float fn = noise3(P * 220.0);
    float fire = zone * smoothstep(1.0 - uFire * 0.075, 1.0 - uFire * 0.075 + 0.01, fn);
    float flick = 0.65 + 0.35 * sin(uTime * 7.0 + fn * 60.0);
    col = mix(col, vec3(0.38, 0.33, 0.30), zone * uFire * 0.22 * NB.a);
    col += vec3(1.0, 0.38, 0.06) * fire * flick * 1.6;

    // Thermal view (3D): local warming = global × NASA GISTEMP latitude pattern (land warms faster)
    if (uThermal > 0.5) {
      float local = uDT * bandRatio(lat) * mix(1.0, 1.3, land) * (0.92 + 0.16 * n2);
      col = ramp(local / 10.0) * (0.72 + 0.45 * lum);
    }

    col = mix(col, vec3(0.05, 0.42, 0.72), flooded * 0.9);

    for (int i = 0; i < 6; i++) {
      float r = length(offsetDeg(vec2(lat, lon), uReefs[i]));
      float ring = (1.0 - smoothstep(1.6, 2.2, r)) * ocean;
      col = mix(col, mix(vec3(1.0, 0.45, 0.42), vec3(0.96, 0.96, 0.92), uCoral), ring * 0.9);
    }

    // Clouds + storms
    if (uClouds > 0.5 || uStorm > 0.0) {
      vec2 cl = uClouds > 0.5 ? clouds(lat, lon) : vec2(0.0);
      float st = storms(vec2(lat, lon));
      cloudA = max(cl.x * 0.82, st * 0.95) * (uThermal > 0.5 ? 0.25 : 1.0);
      cloudCol = mix(vec3(0.80, 0.83, 0.88), vec3(1.0), clamp(cl.y * 1.4 + st * 0.5, 0.0, 1.0));
    }
    col = mix(col, col * vec3(1.08, 0.97, 0.88), uRad * 0.45);
  } else {
    // Real-time: today's NASA VIIRS imagery (gaps filled with Blue Marble) + observations
    if (uThermal > 0.5) {
      vec4 sst = texture2D(uSst, vUv), lst = texture2D(uLst, vUv);
      col = mix(col * 0.55, sst.rgb, sst.a * 0.9);
      col = mix(col, lst.rgb, lst.a * 0.9);
    }
    vec4 ae = texture2D(uAero, vUv);
    col = mix(col, ae.rgb, ae.a * 0.35 * (1.0 - uThermal));
    // VIIRS 375 m active-fire detections
    vec4 fi = texture2D(uFires, vUv);
    col = mix(col, mix(vec3(1.0, 0.25, 0.05), vec3(1.0, 0.75, 0.2), fi.a), clamp(fi.a * 0.9, 0.0, 0.85));
  }

  // Country borders (subtle)
  if (!gissMode) col = mix(col, vec3(1.0), texture2D(uBorders, vUv).a * 0.28 * uBordersOn * (1.0 - cloudA));

  // Ocean surface: animated wave normals for sun glint (3D), gentle texture (2D)
  vec3 N = normalize(vN);
  if (uFlat < 0.5) {
    vec3 L = normalize(uLight);
    vec3 V = normalize(cameraPosition - vPos);
    float w1 = noise3(P * 260.0 + vec3(uTime * 0.05, 0.0, uTime * 0.03));
    float w2 = noise3(P * 260.0 + vec3(0.37, uTime * 0.04, 0.11));
    vec3 Nw = normalize(N + (vec3(w1, w2, w1 * w2) - 0.45) * 0.18 * ocean);
    vec3 H = normalize(L + V);
    float diff = 0.62 + 0.38 * max(dot(N, L), 0.0);           // always lit: no night side
    float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    float glint = (pow(max(dot(Nw, H), 0.0), 140.0) * 0.55 + pow(max(dot(Nw, H), 0.0), 16.0) * 0.06) * ocean * (1.0 - flooded) * (1.0 - uThermal);
    vec3 surf = col * diff + vec3(1.0, 0.96, 0.88) * glint;
    surf = mix(surf, vec3(0.55, 0.72, 0.92), fres * 0.35 * ocean * (1.0 - uThermal));
    vec3 cl = cloudCol * (0.75 + 0.25 * max(dot(N, L), 0.0));
    col = mix(surf * (1.0 - cloudA * 0.25), cl, cloudA);
    col = mix(col, vec3(0.6, 0.75, 1.0), fres * 0.25);
  } else if (!gissMode) {
    col *= mix(1.0, 0.96 + 0.08 * noise3(P * 300.0 + uTime * 0.03), ocean * (1.0 - uThermal));
    col = mix(col, cloudCol, cloudA);
  }

  // Crosshair at the hovered / picked spot (mirrored in both views)
  if (uFocus.z > 0.5) {
    vec2 o = offsetDeg(vec2(lat, lon), uFocus.xy);
    float r = length(o);
    float s = uFocusScale; // shrinks as the view zooms in
    float ring = smoothstep(2.3 * s, 2.0 * s, r) * smoothstep(1.55 * s, 1.85 * s, r);
    float arm = (step(abs(o.x), 0.12 * s) + step(abs(o.y), 0.12 * s)) * step(r, 4.0 * s) * step(1.2 * s, r);
    vec3 xc = gissMode ? vec3(0.0) : vec3(1.0, 0.86, 0.55);
    col = mix(col, xc, clamp(ring + arm, 0.0, 1.0));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const ATMO_VERT = /* glsl */ `
varying vec3 vN;
void main() { vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ATMO_FRAG = /* glsl */ `
uniform float uRad;
varying vec3 vN;
void main() {
  float i = pow(0.68 - dot(vN, vec3(0.0, 0.0, 1.0)), 3.0);
  vec3 c = mix(vec3(0.35, 0.62, 1.0), vec3(1.0, 0.42, 0.18), uRad);
  gl_FragColor = vec4(c, 1.0) * i * (1.1 + uRad * 1.2);
}`;

const EVENT_COLORS = {
  wildfires: 0xff6a2b, severeStorms: 0xbfd7ff, volcanoes: 0xff3355, seaLakeIce: 0x9ff3ff,
  floods: 0x3fa9ff, drought: 0xe2b44f, dustHaze: 0xc9a46a, landslides: 0xa07850, earthquakes: 0xffffff,
};

// Tropical cyclone basins (genesis regions)
const BASINS = [
  { lat: [10, 20], lon: [-60, -25] }, { lat: [10, 16], lon: [-120, -98] }, { lat: [8, 20], lon: [128, 165] },
  { lat: [9, 18], lon: [84, 92] }, { lat: [-17, -8], lon: [55, 100] }, { lat: [-18, -10], lon: [150, 180] }, { lat: [-19, -12], lon: [108, 125] },
];

export function latLonToVec(lat, lon, r = 1) {
  const phi = (lon + 180) * Math.PI / 180, theta = (90 - lat) * Math.PI / 180;
  return new THREE.Vector3(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
}
const vecToLatLon = (v) => { const n = v.clone().normalize(); return { lat: Math.asin(n.y) * 180 / Math.PI, lon: ((Math.atan2(n.z, -n.x) * 180 / Math.PI) + 360) % 360 - 180 }; };
const uvToLatLon = (uv) => ({ lat: (uv.y - 0.5) * 180, lon: (uv.x - 0.5) * 360 });
const rand = (a, b) => a + Math.random() * (b - a);

function dotTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.35, "rgba(255,255,255,0.9)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export async function createEarth({ globeCanvas, mapCanvas, onStatus = () => {}, onHover = () => {}, onPick = () => {}, onMapZoom = () => {} }) {
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); blank.needsUpdate = true;
  const U = {
    uDay: { value: blank }, uMask: { value: blank }, uBorders: { value: blank }, uDetail: { value: blank },
    uLive: { value: blank }, uFires: { value: blank }, uAero: { value: blank }, uLst: { value: blank }, uSst: { value: blank },
    uTime: { value: 0 }, uThermal: { value: 0 }, uLiveOn: { value: 0 }, uLiveReady: { value: 0 }, uReady: { value: 0 },
    uClouds: { value: 1 }, uSeed: { value: Math.random() * 100 }, uBordersOn: { value: 1 },
    uDetailOn: { value: 0 }, uDetailLive: { value: 0 }, uDetailBox: { value: new THREE.Vector4() },
    uDT: { value: 1.45 }, uSea: { value: 0 }, uIce: { value: 0 }, uDesert: { value: 0 }, uFire: { value: 0 }, uStorm: { value: 0 },
    uDrought: { value: 0 }, uAir: { value: 0 }, uCoral: { value: 0 }, uDeforest: { value: 0 }, uRad: { value: 0 },
    uBand: { value: [2.2, 1.4, 1.15, 0.8, 0.75, 0.75, 0.7, 0.9] },
    uStorms: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 1, 0)) },
    uAirC: { value: [[32, 115, 11], [26, 80, 9], [50, 10, 7], [40, -82, 7], [9, 5, 8], [28, 45, 8], [16, 102, 6]].map((a) => new THREE.Vector3(...a)) },
    uReefs: { value: [[-18, 147], [-2, 125], [18, -76], [21, 38], [3, 73], [-17, -150]].map((a) => new THREE.Vector2(...a)) },
    uLight: { value: new THREE.Vector3(1, 0.4, 0.6).normalize() },
    uFocus: { value: new THREE.Vector3(0, 0, 0) },
    uTexel: { value: new THREE.Vector2(1 / 4096, 1 / 2048) },
  };
  // Each WebGL context gets its own baked noise textures (uNoiseA/uNoiseB)
  const globeMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...U, uFlat: { value: 0 }, uGissOn: { value: 0 }, uNoiseA: { value: blank }, uNoiseB: { value: blank }, uFocusScale: { value: 1 } } });
  const mapMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...U, uFlat: { value: 1 }, uGissOn: { value: 1 }, uNoiseA: { value: blank }, uNoiseB: { value: blank }, uFocusScale: { value: 1 } } });
  function bake(renderer, mat) {
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const bm = new THREE.ShaderMaterial({
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: BAKE_FRAG, uniforms: { uPass: { value: 0 }, uSeed: { value: U.uSeed.value } },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bm);
    scene.add(quad);
    for (const [pass, name] of [[0, "uNoiseA"], [1, "uNoiseB"]]) {
      const rt = new THREE.WebGLRenderTarget(2048, 1024, { wrapS: THREE.RepeatWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      bm.uniforms.uPass.value = pass;
      renderer.setRenderTarget(rt); renderer.render(scene, cam);
      mat.uniforms[name].value = rt.texture;
    }
    renderer.setRenderTarget(null);
    bm.dispose(); quad.geometry.dispose();
  }
  const atmoU = { uRad: { value: 0 } };

  // ---------- 3D globe ----------
  const gR = new THREE.WebGLRenderer({ canvas: globeCanvas, antialias: true });
  gR.setPixelRatio(Math.min(devicePixelRatio, 2));
  gR.setClearColor(0x050608);
  const maxAniso = gR.capabilities.getMaxAnisotropy();
  const gScene = new THREE.Scene();
  const gCam = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
  gCam.position.copy(latLonToVec(22, 20, 4.4));
  const controls = new OrbitControls(gCam, globeCanvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.06, enablePan: false, minDistance: 1.08, maxDistance: 7, rotateSpeed: 0.5, zoomSpeed: 0.8, autoRotate: true, autoRotateSpeed: 0.35 });
  controls.addEventListener("start", () => (controls.autoRotate = false));
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), globeMat);
  gScene.add(globe);
  gScene.add(new THREE.Mesh(new THREE.SphereGeometry(1.06, 96, 48),
    new THREE.ShaderMaterial({ vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, uniforms: atmoU, side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })));
  {
    const n = 2500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 40);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    gScene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, transparent: true, opacity: 0.7 })));
  }
  // Rotate controls slower when close to the surface
  controls.addEventListener("change", () => {
    const d = gCam.position.length();
    controls.rotateSpeed = Math.min(0.5, (d - 1) * 0.35 + 0.03);
    scheduleDetail("globe");
  });

  // ---------- 2D map ----------
  const mR = new THREE.WebGLRenderer({ canvas: mapCanvas, antialias: true });
  mR.setPixelRatio(Math.min(devicePixelRatio, 2));
  mR.setClearColor(0x050608);
  const mScene = new THREE.Scene();
  const mCam = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, 0.1, 10);
  mCam.position.z = 2;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 1, 1, 1), mapMat);
  mScene.add(plane);
  bake(gR, globeMat);
  bake(mR, mapMat);

  // ---------- Event markers (EONET), mirrored on both views ----------
  const dot = dotTexture();
  const markerMat = new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, map: dot, transparent: true, depthWrite: false, alphaTest: 0.05 });
  const gMarkers = new THREE.Points(new THREE.BufferGeometry(), markerMat);
  const mMarkers = new THREE.Points(new THREE.BufferGeometry(), markerMat);
  gScene.add(gMarkers); mScene.add(mMarkers);
  let events = [];
  function setEvents(list) {
    events = list;
    const gp = [], mp = [], cols = [];
    for (const e of list) {
      gp.push(...latLonToVec(e.lat, e.lon, 1.003).toArray());
      mp.push(e.lon / 180, e.lat / 180, 0.01);
      const c = new THREE.Color(EVENT_COLORS[e.category] ?? 0xffffff); cols.push(c.r, c.g, c.b);
    }
    for (const [geo, p] of [[gMarkers.geometry, gp], [mMarkers.geometry, mp]]) {
      geo.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      geo.computeBoundingSphere();
    }
  }
  function showEvents(on) { gMarkers.visible = mMarkers.visible = on; }
  showEvents(false);

  // ---------- Map pan / zoom (wheel toward cursor, drag, pinch, buttons) ----------
  const MAX_MAP_ZOOM = 40;
  let mapZoom = 1;
  const mapCenter = new THREE.Vector2(0, 0);
  function fitMap() {
    const w = mapCanvas.clientWidth || 1, h = mapCanvas.clientHeight || 1, aspect = w / h;
    let halfW, halfH;
    if (aspect > 2) { halfH = 0.5 / mapZoom; halfW = halfH * aspect; } else { halfW = 1 / mapZoom; halfH = halfW / aspect; }
    const maxX = Math.max(0, 1 - halfW), maxY = Math.max(0, 0.5 - halfH);
    mapCenter.x = Math.max(-maxX, Math.min(maxX, mapCenter.x));
    mapCenter.y = Math.max(-maxY, Math.min(maxY, mapCenter.y));
    Object.assign(mCam, { left: mapCenter.x - halfW, right: mapCenter.x + halfW, top: mapCenter.y + halfH, bottom: mapCenter.y - halfH });
    mCam.updateProjectionMatrix();
    onMapZoom(mapZoom);
    scheduleDetail("map");
  }
  function mapPoint(clientX, clientY) {
    const r = mapCanvas.getBoundingClientRect();
    return new THREE.Vector2(mCam.left + (clientX - r.left) / r.width * (mCam.right - mCam.left), mCam.top - (clientY - r.top) / r.height * (mCam.top - mCam.bottom));
  }
  function zoomMapAt(factor, clientX, clientY) {
    const before = clientX != null ? mapPoint(clientX, clientY) : mapCenter.clone();
    mapZoom = Math.max(1, Math.min(MAX_MAP_ZOOM, mapZoom * factor));
    fitMap();
    if (clientX != null) { const after = mapPoint(clientX, clientY); mapCenter.add(before.sub(after)); fitMap(); }
  }
  const pointers = new Map();
  let drag = null, pinch = null;
  mapCanvas.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    mapCanvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: mapZoom }; drag = null;
    } else drag = { x: e.clientX, y: e.clientY, cx: mapCenter.x, cy: mapCenter.y, moved: false };
  });
  mapCanvas.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const target = pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d;
      zoomMapAt(target / mapZoom, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      const scale = (mCam.right - mCam.left) / mapCanvas.clientWidth;
      mapCenter.set(drag.cx - dx * scale, drag.cy + dy * scale);
      fitMap();
    }
    hoverFrom(e, "map");
  });
  const endPointer = (e) => {
    if (drag && !drag.moved && pointers.size === 1) pickFrom(e, "map");
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    drag = null;
  };
  mapCanvas.addEventListener("pointerup", endPointer);
  mapCanvas.addEventListener("pointercancel", endPointer);
  mapCanvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomMapAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
  mapCanvas.addEventListener("dblclick", (e) => zoomMapAt(2, e.clientX, e.clientY));
  mapCanvas.addEventListener("pointerleave", leave);

  // ---------- Hover / pick ----------
  const ray = new THREE.Raycaster();
  let downAt = null, pinned = null;
  globeCanvas.addEventListener("pointerdown", (e) => (downAt = [e.clientX, e.clientY]));
  globeCanvas.addEventListener("pointerup", (e) => { if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 4) pickFrom(e, "globe"); downAt = null; });
  globeCanvas.addEventListener("pointermove", (e) => hoverFrom(e, "globe"));
  globeCanvas.addEventListener("pointerleave", leave);
  function leave() { setFocus(pinned); onHover(null); }
  function zoomedIn() { return gCam.position.length() < 1.6 || mapZoom > 6; }
  function setFocus(ll) { if (ll) U.uFocus.value.set(ll.lat, ll.lon, 1); else U.uFocus.value.z = 0; }

  function hit(e, which) {
    const canvas = which === "globe" ? globeCanvas : mapCanvas;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, which === "globe" ? gCam : mCam);
    const h = ray.intersectObject(which === "globe" ? globe : plane)[0];
    return h ? uvToLatLon(h.uv) : null;
  }
  function nearestEvent(ll) {
    if (!gMarkers.visible || !ll) return null;
    let best = null, bd = zoomedIn() ? 0.6 : 3;
    for (const ev of events) { const d = Math.hypot(ev.lat - ll.lat, (ev.lon - ll.lon) * Math.cos(ll.lat * Math.PI / 180)); if (d < bd) { bd = d; best = ev; } }
    return best;
  }
  function hoverFrom(e, which) {
    const ll = hit(e, which);
    setFocus(ll || pinned);
    onHover(ll ? { ...ll, event: nearestEvent(ll), x: e.clientX, y: e.clientY, view: which } : null);
  }
  function pickFrom(e, which) {
    const ll = hit(e, which);
    if (!ll) return;
    pinned = ll;
    setFocus(ll);
    onPick({ ...ll, event: nearestEvent(ll) });
  }
  function focus(lat, lon, { zoom } = {}) {
    controls.autoRotate = false;
    const dist = zoom ? Math.min(gCam.position.length(), 2.2) : gCam.position.length();
    const target = latLonToVec(lat, lon, dist);
    const from = gCam.position.clone(), t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 1000), s = k * k * (3 - 2 * k);
      gCam.position.copy(from.clone().lerp(target, s).setLength(from.length() + (dist - from.length()) * s));
      controls.update();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    mapCenter.set(lon / 180, lat / 180); fitMap();
    pinned = { lat, lon };
    setFocus(pinned);
  }

  // ---------- High-resolution detail patch when zoomed in ----------
  let detailTimer = null, detailSeq = 0, lastDriver = "globe";
  function visibleBox(which) {
    if (which === "map") {
      if (mapZoom < 2.5) return null;
      return { latMin: Math.max(-90, mCam.bottom * 180), latMax: Math.min(90, mCam.top * 180), lonMin: Math.max(-180, mCam.left * 180), lonMax: Math.min(180, mCam.right * 180) };
    }
    const d = gCam.position.length();
    if (d > 2.3) return null;
    const c = vecToLatLon(gCam.position);
    const half = Math.max(2.5, Math.min(45, (d - 1) * 38));
    const halfLon = Math.min(180, half / Math.max(0.15, Math.cos(c.lat * Math.PI / 180)));
    return { latMin: Math.max(-90, c.lat - half), latMax: Math.min(90, c.lat + half), lonMin: Math.max(-180, c.lon - halfLon), lonMax: Math.min(180, c.lon + halfLon) };
  }
  function scheduleDetail(which) {
    lastDriver = which;
    clearTimeout(detailTimer);
    detailTimer = setTimeout(loadDetail, 450);
  }
  function loadDetail() {
    const box = visibleBox(lastDriver);
    if (!box || box.lonMax - box.lonMin < 0.5) { if (!box) U.uDetailOn.value = 0; return; }
    const live = U.uLiveOn.value > 0.5;
    const seq = ++detailSeq;
    tex(NASA.detailMap(live, box)).then((t) => {
      if (seq !== detailSeq) { t.dispose(); return; }
      const old = U.uDetail.value;
      t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
      U.uDetail.value = t;
      U.uDetailBox.value.set(box.latMin, box.latMax, box.lonMin, box.lonMax);
      U.uDetailLive.value = live ? 1 : 0;
      U.uDetailOn.value = 1;
      if (old !== blank) old.dispose();
    }).catch(() => {});
  }

  // ---------- Storm system: random cyclones that form, track, intensify and decay ----------
  const storms = [];
  let landAt = () => false;
  function stepStorms(dt, intensity) {
    const target = Math.round(intensity * 8);
    if (storms.length < Math.min(8, target) && Math.random() < dt * (0.25 + intensity * 0.9)) {
      const b = BASINS[Math.floor(Math.random() * BASINS.length)];
      storms.push({ lat: rand(...b.lat), lon: rand(...b.lon), age: 0, life: rand(30, 60), peak: rand(0.45, 1) * Math.min(1, 0.4 + intensity), size: rand(3.6, 5.6), drift: rand(-0.3, 0.3) });
    }
    for (let i = storms.length - 1; i >= 0; i--) {
      const s = storms[i], hemi = Math.sign(s.lat) || 1;
      s.age += dt * (landAt(s.lat, s.lon) ? 3 : 1); // weaken quickly over land
      const recurve = Math.abs(s.lat) > 24;
      s.lon += dt * (recurve ? 1.3 : -0.9) * (1 + s.drift);
      s.lat += dt * hemi * (recurve ? 0.75 : 0.32 + s.drift * 0.2);
      s.lon = ((s.lon + 540) % 360) - 180;
      if (s.age > s.life || Math.abs(s.lat) > 55) storms.splice(i, 1);
    }
    const arr = U.uStorms.value;
    for (let i = 0; i < 8; i++) {
      const s = storms[i];
      if (!s) { arr[i].w = 0; continue; }
      const p = s.age / s.life, I = s.peak * Math.pow(Math.sin(Math.PI * Math.min(1, p)), 0.8);
      arr[i].set(s.lat, s.lon, s.size * (0.85 + 0.5 * I) * (Math.abs(s.lat) > 25 ? 1.3 : 1), I);
    }
  }

  // ---------- Resize & render ----------
  function size(renderer, canvas, cam) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return false;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      if (cam.isPerspectiveCamera) { cam.aspect = w / h; cam.zoom = Math.min(1, cam.aspect / (cam.aspect < 0.8 ? 0.82 : 1.25)); cam.updateProjectionMatrix(); } else fitMap();
    }
    return true;
  }
  const clock = new THREE.Clock();
  const right = new THREE.Vector3(), up = new THREE.Vector3();
  let running = true;
  function frame() {
    if (!running) return;
    const dt = Math.min(0.1, clock.getDelta());
    U.uTime.value += dt;
    stepStorms(dt, U.uLiveOn.value > 0.5 ? 0 : U.uStorm.value);
    // Light follows the camera (slightly above-left), so the visible side is always lit
    right.setFromMatrixColumn(gCam.matrixWorld, 0); up.setFromMatrixColumn(gCam.matrixWorld, 1);
    U.uLight.value.copy(gCam.position).normalize().addScaledVector(up, 0.45).addScaledVector(right, -0.35).normalize();
    globeMat.uniforms.uFocusScale.value = Math.max(0.03, Math.min(1, (gCam.position.length() - 1) * 0.45));
    mapMat.uniforms.uFocusScale.value = Math.max(0.03, 1 / mapZoom);
    if (size(gR, globeCanvas, gCam)) { controls.update(); gR.render(gScene, gCam); }
    if (size(mR, mapCanvas, mCam)) mR.render(mScene, mCam);
    requestAnimationFrame(frame);
  }
  frame();

  // ---------- Load layers ----------
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin("anonymous");
  const tex = (url) => new Promise((res, rej) => loader.load(url, (t) => { t.anisotropy = maxAniso; res(t); }, undefined, () => rej(new Error("NASA GIBS layer failed"))));

  onStatus("Loading NASA Blue Marble…");
  const dayP = tex(NASA.LAYERS.dayLow()).then((t) => {
    U.uDay.value = t;
    tex(NASA.LAYERS.day()).then((hi) => { U.uDay.value = hi; t.dispose(); }).catch(() => {});
  });
  const maskP = NASA.loadLandAndElevation(4096, 2048).then((m) => {
    const t = new THREE.DataTexture(m.data, m.width, m.height, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    U.uMask.value = t; U.uReady.value = 1;
    landAt = (lat, lon) => m.elevationAt(lat, lon).land;
    return m;
  });
  let countryAt = () => null;
  loadCountries().then((c) => {
    const t = new THREE.CanvasTexture(c.bordersCanvas);
    t.anisotropy = maxAniso;
    U.uBorders.value = t;
    countryAt = c.countryAt;
  }).catch((e) => console.warn("Country borders unavailable:", e.message));

  await dayP;
  onStatus("Decoding NASA SRTM elevation…");
  const mask = await maskP;
  onStatus(null);

  let liveLoaded = null;
  function loadLive() {
    if (liveLoaded) return liveLoaded;
    onStatus(`Loading NASA satellite imagery for ${NASA.LAYERS.liveDate()}…`);
    liveLoaded = Promise.allSettled([
      tex(NASA.LAYERS.liveTrue()).then((t) => { U.uLive.value = t; U.uLiveReady.value = 1; }),
      tex(NASA.LAYERS.liveFires()).then((t) => (U.uFires.value = t)),
      tex(NASA.LAYERS.liveAerosol()).then((t) => (U.uAero.value = t)),
      tex(NASA.LAYERS.liveLandTemp()).then((t) => (U.uLst.value = t)),
      tex(NASA.LAYERS.liveSeaTemp()).then((t) => (U.uSst.value = t)),
    ]).then(() => onStatus(null));
    return liveLoaded;
  }

  return {
    elevationAt: mask.elevationAt,
    countryAt: (lat, lon) => countryAt(lat, lon),
    setBands(b) { U.uBand.value = b; },
    update(vis) {
      U.uDT.value = vis.dT; U.uSea.value = vis.sea; U.uIce.value = vis.ice; U.uDesert.value = vis.desert;
      U.uFire.value = vis.fire; U.uStorm.value = vis.storms; U.uDrought.value = vis.drought; U.uAir.value = vis.air;
      U.uCoral.value = vis.ocean; U.uDeforest.value = vis.deforest; U.uRad.value = vis.radiation; atmoU.uRad.value = vis.radiation;
    },
    setThermal(on) { U.uThermal.value = on ? 1 : 0; },
    setClouds(on) { U.uClouds.value = on ? 1 : 0; },
    setBorders(on) { U.uBordersOn.value = on ? 1 : 0; },
    async setLive(on) {
      U.uLiveOn.value = on ? 1 : 0; showEvents(on);
      U.uDetailOn.value = 0; scheduleDetail(lastDriver);
      if (on) await loadLive();
    },
    setEvents, focus,
    unpin() { pinned = null; setFocus(null); },
    resetMap() { mapZoom = 1; mapCenter.set(0, 0); fitMap(); },
    zoomMap(f) { zoomMapAt(f); },
    zoomGlobe(f) { gCam.position.setLength(Math.max(1.08, Math.min(7, gCam.position.length() * f))); controls.update(); },
    dispose() { running = false; gR.dispose(); mR.dispose(); controls.dispose(); },
  };
}
