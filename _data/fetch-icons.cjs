#!/usr/bin/env node
/**
 * Récupère les icônes des items depuis le wiki officiel (satisfactory.wiki.gg) et
 * génère src/model/game-icons.ts : { slug → data-URI base64 } embarqué dans le bundle.
 *
 * Pourquoi base64 embarqué : le store communautaire d'Obsidian n'installe que
 * main.js/manifest/styles → un dossier d'images ne voyagerait pas avec le plugin.
 *
 * Mapping : nom d'affichage de l'item → File:{Nom_avec_underscores}.png sur le wiki.
 * Vignettes 64 px via l'API MediaWiki (imageinfo + iiurlwidth) → pas de retraitement.
 * Les items sans fichier wiki sont simplement omis (l'UI retombe sur le texte).
 *
 * Usage : node _data/fetch-icons.cjs   (après une régénération de game-db.ts)
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { PNG } = require("pngjs");

const WIKI = "satisfactory.wiki.gg";
const WIDTH = 64;

// --- Couleur d'item dérivée de son icône ---------------------------------
// Une couleur par item, pour les arêtes (cf. cahier : « une couleur par item »,
// teinte extraite de l'icône). Principe : on garde la TEINTE RÉELLE de l'icône
// (les couleurs ressemblent aux items), on BOOSTE la saturation (les colorés
// ressortent ; les gris gardent leur léger ton — ex. les vis = gris bleuté), et
// on ramène la luminosité dans une bande lisible pour que les items SOMBRES
// (huile, charbon) restent visibles sur le fond noir d'Obsidian.
// Pas de teinte inventée : un item gris reste gris (honnête, quitte à être moins
// différentiable). Ajuster ces 3 constantes pour pousser le rendu.
const SAT_BOOST = 1.5;       // multiplicateur de saturation (items colorés)
const SAT_BOOST_GREY = 5.08; // gris/blancs/noirs (s < GREY_S) : boost fort pour faire ressortir leur léger ton
const GREY_S = 0.16;         // seuil de saturation réelle en-dessous duquel l'item est « gris »
const LUM_MIN = 0.42;  // luminosité plancher (items sombres → visibles)
const LUM_MAX = 0.62;  // luminosité plafond (items clairs → pas délavés)
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
/** Affine une couleur RGB → teinte conservée, saturation boostée, luminosité bornée. */
function refine(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  const boost = s < GREY_S ? SAT_BOOST_GREY : SAT_BOOST; // gris → boost plus fort
  return hslToHex(h, clamp(s * boost, 0, 1), clamp(l, LUM_MIN, LUM_MAX));
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Couleur d'un item à partir de la moyenne (pondérée alpha) de son icône PNG. */
function iconColor(buf) {
  let png;
  try { png = PNG.sync.read(buf); } catch { return null; }
  let R = 0, G = 0, B = 0, A = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3];
    if (a < 40) continue; // ignore les pixels (quasi) transparents
    R += png.data[i] * a; G += png.data[i + 1] * a; B += png.data[i + 2] * a; A += a;
  }
  if (A === 0) return null;
  return refine(R / A, G / A, B / A);
}

/**
 * FLUIDES : la couleur de fluide officielle du jeu (game-db) prime sur l'icône —
 * beaucoup d'icônes de liquides sont des gouttes grises (ex. l'eau) sans teinte
 * exploitable. On passe la couleur officielle dans le même pipeline (boost + bornes).
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
  console.log(`[icons] ${items.length} items à traiter`);

  // 1) Résoudre les URLs de vignettes par lots (API MediaWiki, 50 titres max).
  // NB : MediaWiki renvoie les titres avec ESPACES (pas underscores) → on indexe
  // et compare en espaces.
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
    process.stdout.write(`\r[icons] résolu ${Object.keys(thumbBySlug).length}/${items.length}`);
    await sleep(200);
  }
  console.log("");

  // 2) Télécharger + base64 + couleur dérivée de l'icône.
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
      process.stdout.write(`\r[icons] téléchargé ${done}`);
      await sleep(80);
    } catch { /* ignore, fallback texte */ }
  }
  console.log("");

  const missing = items.filter((it) => !icons[it.id]).map((it) => it.id);
  applyFluidOverride(colors);
  writeIcons(icons, colors);
  console.log(`[icons] ${done}/${items.length} icônes, ${(bytes / 1024 / 1024).toFixed(2)} Mo bruts (base64 ~+33%)`);
  if (missing.length) console.log(`[icons] sans icône (${missing.length}) :`, missing.slice(0, 20).join(", ") + (missing.length > 20 ? " …" : ""));
}

const GAME_ICONS = path.join(__dirname, "..", "src", "model", "game-icons.ts");
function writeIcons(icons, colors) {
  fs.writeFileSync(GAME_ICONS, `// GÉNÉRÉ par _data/fetch-icons.cjs depuis satisfactory.wiki.gg — ne pas éditer à la main.
// Icônes des items (vignettes ${WIDTH}px) en data-URI base64, indexées par slug.
export const ICONS: Record<string, string> = ${JSON.stringify(icons)};

// Couleur de chaque item, dérivée de son icône (teinte réelle + saturation) — pour les arêtes.
export const ICON_COLORS: Record<string, string> = ${JSON.stringify(colors)};
`);
}

/** Recalcule ICON_COLORS depuis les icônes DÉJÀ embarquées (pas de réseau) : `node fetch-icons.cjs --recolor`. */
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
  console.log(`[recolor] ${Object.keys(colors).length} couleurs recalculées (offline), dont ${nf} fluides depuis la couleur officielle.`);
}

if (process.argv.includes("--recolor")) recolor();
else main().catch((e) => { console.error(e); process.exit(1); });
