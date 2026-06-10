#!/usr/bin/env node
/**
 * Génère src/model/game-db.ts depuis le data.json de greeny/SatisfactoryTools
 * (déjà parsé, propre, 1.0+ : noms corrects, couleurs de fluides, tier endgame).
 *
 * Source : _data/greeny.json
 *   → https://raw.githubusercontent.com/greeny/SatisfactoryTools/dev/data/data.json
 *   (non versionné ici : le retélécharger pour régénérer.)
 *
 * Pourquoi pas le Docs.json brut (dmryabov) : son format « alternatif » corrompt
 * ~35 % des mDisplayName de recettes (« Fuel » sur l'acide sulfurique…) et reste
 * bloqué en Update 8. greeny est parsé depuis le Docs.json officiel 1.0+.
 *
 *  - items   : id = kebab(nom) [convention conservée], nom, état (liquid→fluide),
 *              couleur (fluidColor RGB pour les fluides, sinon teinte dérivée du slug)
 *  - recipes : recettes produites en machine (inMachine && !forBuilding) ; débit /min
 *              = amount × 60 / time (greeny normalise déjà les unités, fluides en m³)
 *  - BASE_ITEMS : ressources brutes (g.resources) ; INFINITE_ITEMS : eau
 *
 * Slugs : item = kebab(nom d'affichage) ; recette = greeny.slug (= className en kebab,
 * identique à l'ancienne convention → compat des chaînes existantes).
 */
const fs = require("fs");
const path = require("path");

const g = JSON.parse(fs.readFileSync(path.join(__dirname, "greeny.json"), "utf8"));
const round = (n) => Math.round(n * 1000) / 1000;

const slugify = (s) =>
  String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}
function solidColor(slug) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) % 360;
  return hslToHex(h, 42, 62);
}
const hex2 = (x) => Math.max(0, Math.min(255, x | 0)).toString(16).padStart(2, "0");

// --- Items ---
const items = {};
const classToSlug = {}; // className (Desc_*) -> slug
for (const it of Object.values(g.items)) {
  const slug = slugify(it.name);
  if (!slug) continue;
  const fluid = !!it.liquid;
  const fc = it.fluidColor;
  const couleur =
    fluid && fc && (fc.r || fc.g || fc.b) ? `#${hex2(fc.r)}${hex2(fc.g)}${hex2(fc.b)}` : solidColor(slug);
  classToSlug[it.className] = slug;
  if (!items[slug]) items[slug] = { id: slug, nom: it.name, couleur, etat: fluid ? "fluide" : "solide" };
}

// --- Recettes produites en machine ---
const buildings = g.buildings || {};
const recipes = {};
const missingItems = new Set();
const port = (p, time) => {
  const slug = classToSlug[p.item];
  if (!slug) missingItems.add(p.item);
  return { item: slug || slugify(p.item), debit: round((p.amount * 60) / time) };
};
for (const r of Object.values(g.recipes)) {
  if (!r.inMachine || r.forBuilding) continue;
  if (!r.time || r.time <= 0) continue;
  const machineClass = (r.producedIn || []).find((c) => buildings[c]);
  if (!machineClass) continue; // pas une vraie machine de production
  recipes[r.slug] = {
    id: r.slug,
    nom: r.name,
    machine: buildings[machineClass].name,
    ...(r.alternate ? { alternative: true } : {}),
    intrants: (r.ingredients || []).map((p) => port(p, r.time)),
    extrants: (r.products || []).map((p) => port(p, r.time)),
  };
}

// --- Ressources brutes / illimitées ---
const baseSlugs = new Set();
for (const res of Object.values(g.resources || {})) {
  const slug = classToSlug[res.item];
  if (slug) baseSlugs.add(slug);
}
const baseItems = [...baseSlugs];
const infinite = ["water"];

const out = `// GÉNÉRÉ par _data/generate.cjs depuis greeny/SatisfactoryTools data.json (1.0+) — ne pas éditer à la main.
import type { Db } from "./types";

export const GAME_DB: Db = ${JSON.stringify({ items, recipes })};

/** Ressources brutes (minerais + liquides) extraites du jeu. */
export const BASE_ITEMS: string[] = ${JSON.stringify(baseItems)};

/** Ressources illimitées → coût nul pour l'optimiseur (eau). */
export const INFINITE_ITEMS: string[] = ${JSON.stringify(infinite)};
`;

fs.writeFileSync(path.join(__dirname, "..", "src", "model", "game-db.ts"), out);
console.log(`[gen] ${Object.keys(items).length} items, ${Object.keys(recipes).length} recettes machine, ${baseItems.length} ressources brutes`);
const alts = Object.values(recipes).filter((r) => r.alternative).length;
console.log(`[gen] dont ${alts} alternatives, ${Object.keys(recipes).length - alts} de base`);
if (missingItems.size) console.warn(`[gen] ⚠️ ${missingItems.size} items référencés absents de g.items :`, [...missingItems].slice(0, 10).join(", "));
