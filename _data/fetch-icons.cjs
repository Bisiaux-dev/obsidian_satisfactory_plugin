#!/usr/bin/env node
/**
 * Fetches item icons from the official wiki (satisfactory.wiki.gg) and
 * generates src/model/game-icons.ts: { slug → base64 data-URI } embedded in the bundle.
 *
 * Why embedded base64: Obsidian's community store only installs
 * main.js/manifest/styles → a folder of images would not ship with the plugin.
 *
 * Mapping: item display name → File:{Name_with_underscores}.png on the wiki.
 * 64 px thumbnails via the MediaWiki API (imageinfo + iiurlwidth) → no post-processing.
 * Items without a wiki file are simply omitted (the UI falls back to text).
 *
 * Usage: node _data/fetch-icons.cjs   (after regenerating game-db.ts)
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { PNG } = require("pngjs");

const WIKI = "satisfactory.wiki.gg";
const WIDTH = 64;

// --- Item color derived from its icon -------------------------------------
// One color per item, used for edges (per the spec: "one color per item",
// hue extracted from the icon). Principle: keep the icon's REAL HUE
// (colors resemble the items), BOOST the saturation (colorful items
// stand out; greys keep their slight tint — e.g. screws = bluish grey), and
// clamp lightness into a readable band so that DARK items
// (oil, coal) stay visible on Obsidian's black background.
// No invented hue: a grey item stays grey (honest, even if less
// distinguishable). Tweak these 3 constants to push the rendering.
const SAT_BOOST = 1.5;       // saturation multiplier (colorful items)
const SAT_BOOST_GREY = 5.08; // greys/whites/blacks (s < GREY_S): strong boost to bring out their slight tint
const GREY_S = 0.16;         // real-saturation threshold below which the item counts as "grey"
const LUM_MIN = 0.42;  // lightness floor (dark items → visible)
const LUM_MAX = 0.62;  // lightness ceiling (light items → not washed out)
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}
/** Refines an RGB color → hue preserved, saturation boosted, lightness clamped. */
function refine(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  const boost = s < GREY_S ? SAT_BOOST_GREY : SAT_BOOST; // grey → stronger boost
  return hslToHex(h, clamp(s * boost, 0, 1), clamp(l, LUM_MIN, LUM_MAX));
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Item color from the (alpha-weighted) average of its PNG icon. */
function iconColor(buf) {
  let png;
  try { png = PNG.sync.read(buf); } catch { return null; }
  let R = 0, G = 0, B = 0, A = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3];
    if (a < 40) continue; // skip (nearly) transparent pixels
    R += png.data[i] * a; G += png.data[i + 1] * a; B += png.data[i + 2] * a; A += a;
  }
  if (A === 0) return null;
  return refine(R / A, G / A, B / A);
}

/**
 * FLUIDS: the game's official fluid color (game-db) takes precedence over the icon —
 * many liquid icons are grey droplets (e.g. water) with no usable hue.
 * The official color goes through the same pipeline (boost + clamping).
 */
function applyFluidOverride(colors) {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "model", "game-db.ts"), "utf8");
  const db = JSON.parse(src.slice(src.indexOf('{"items"'), src.lastIndexOf("}") + 1));
  let n = 0;
  for (const it of Object.values(db.items)) {
    if (it.etat === "fluide" && typeof it.couleur === "string" && it.couleur[0] === "#") {
      colors[it.id] = refine(...hexToRgb(it.couleur));
      n++;
    }
  }
  return n;
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "satisfactory-chains/0.1 (icon fetch)" } }, (res) => {
      let s = "";
      res.on("data", (d) => (s += d));
      res.on("end", () => {
        try { resolve(JSON.parse(s)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}
function getBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "satisfactory-chains/0.1 (icon fetch)" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(getBuffer(res.headers.location));
      }
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "model", "game-db.ts"), "utf8");
  const db = JSON.parse(src.slice(src.indexOf('{"items"'), src.lastIndexOf("}") + 1));
  const items = Object.values(db.items);
  console.log(`[icons] ${items.length} items to process`);

  // 1) Resolve thumbnail URLs in batches (MediaWiki API, 50 titles max).
  // NB: MediaWiki returns titles with SPACES (not underscores) → we index
  // and compare using spaces.
  const fileToSlug = {}; // "Iron Plate.png" -> slug
  const titleOf = (it) => `File:${it.nom.replace(/ /g, "_")}.png`;
  for (const it of items) fileToSlug[`${it.nom}.png`] = it.id;

  const thumbBySlug = {};
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const titles = batch.map(titleOf).map(encodeURIComponent).join("|");
    const url = `https://${WIKI}/api.php?action=query&format=json&prop=imageinfo&iiprop=url&iiurlwidth=${WIDTH}&titles=${titles}`;
    const data = await getJSON(url);
    const pages = data?.query?.pages || {};
    for (const p of Object.values(pages)) {
      if (!p.imageinfo || !p.title) continue;
      const file = p.title.replace(/^File:/, "").replace(/_/g, " ");
      const slug = fileToSlug[file];
      if (slug) thumbBySlug[slug] = p.imageinfo[0].thumburl;
    }
    process.stdout.write(`\r[icons] resolved ${Object.keys(thumbBySlug).length}/${items.length}`);
    await sleep(200);
  }
  console.log("");

  // 2) Download + base64 + color derived from the icon.
  const icons = {};
  const colors = {};
  let done = 0, bytes = 0;
  for (const it of items) {
    const url = thumbBySlug[it.id];
    if (!url) continue;
    try {
      const buf = await getBuffer(url);
      if (!buf.length) continue;
      icons[it.id] = `data:image/png;base64,${buf.toString("base64")}`;
      const col = iconColor(buf);
      if (col) colors[it.id] = col;
      bytes += buf.length;
      done++;
      process.stdout.write(`\r[icons] downloaded ${done}`);
      await sleep(80);
    } catch { /* ignore, text fallback */ }
  }
  console.log("");

  const missing = items.filter((it) => !icons[it.id]).map((it) => it.id);
  applyFluidOverride(colors);
  writeIcons(icons, colors);
  console.log(`[icons] ${done}/${items.length} icons, ${(bytes / 1024 / 1024).toFixed(2)} MB raw (base64 ~+33%)`);
  if (missing.length) console.log(`[icons] no icon (${missing.length}):`, missing.slice(0, 20).join(", ") + (missing.length > 20 ? " …" : ""));
}

const GAME_ICONS = path.join(__dirname, "..", "src", "model", "game-icons.ts");
function writeIcons(icons, colors) {
  fs.writeFileSync(GAME_ICONS, `// GENERATED by _data/fetch-icons.cjs from satisfactory.wiki.gg — do not edit by hand.
// Item icons (${WIDTH}px thumbnails) as base64 data-URIs, indexed by slug.
export const ICONS: Record<string, string> = ${JSON.stringify(icons)};

// Color of each item, derived from its icon (real hue + saturation) — used for edges.
export const ICON_COLORS: Record<string, string> = ${JSON.stringify(colors)};
`);
}

/** Recomputes ICON_COLORS from the ALREADY embedded icons (no network): `node fetch-icons.cjs --recolor`. */
function recolor() {
  const m = fs.readFileSync(GAME_ICONS, "utf8");
  const icons = JSON.parse(m.slice(m.indexOf("{"), m.indexOf("};") + 1));
  const colors = {};
  for (const [slug, uri] of Object.entries(icons)) {
    const col = iconColor(Buffer.from(uri.split(",")[1], "base64"));
    if (col) colors[slug] = col;
  }
  const nf = applyFluidOverride(colors);
  writeIcons(icons, colors);
  console.log(`[recolor] ${Object.keys(colors).length} colors recomputed (offline), including ${nf} fluids from the official color.`);
}

if (process.argv.includes("--recolor")) recolor();
else main().catch((e) => { console.error(e); process.exit(1); });
