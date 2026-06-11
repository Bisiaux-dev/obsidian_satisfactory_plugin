/**
 * Power & extraction data (official wiki, game 1.0/1.1) + the energy model.
 *
 * Kept OUT of the generated `game-db.ts`/`game-icons.ts`. The power-generator
 * pseudo-recipes (slugs `power-*`) are merged into `GAME_DB.recipes` as a
 * side-effect of importing this module, so they show up in the picker and in
 * `nodePorts` like any other recipe.
 *
 * Overclock (wiki): item rates scale LINEARLY with clock; machine power scales
 * as `(clock/100)^1.321928`. Generators are the exception — fully linear (output
 * AND fuel burn). Production amplifier (Somersloops): output ×(1+sloops/max),
 * power ×(1+sloops/max)².
 */
import { GAME_DB } from "./game-db";
import { isCustomNode, type Db, type Node, type Recipe, type Scene } from "./types";

/** Wiki exponent for overclock power consumption. */
export const POWER_EXPONENT = 1.321928;

/** Fixed power draw (MW at 100% clock) per production/extraction building. */
export const MACHINE_POWER: Record<string, number> = {
  "Smelter": 4,
  "Constructor": 4,
  "Assembler": 15,
  "Foundry": 16,
  "Manufacturer": 55,
  "Refinery": 30,
  "Packager": 10,
  "Blender": 75,
  "Particle Accelerator": 500,
  "Converter": 250,
  "Quantum Encoder": 1000,
  "Miner Mk.1": 5,
  "Miner Mk.2": 15,
  "Miner Mk.3": 45,
  "Water Extractor": 20,
  "Oil Extractor": 40,
  "Resource Well Pressurizer": 150,
};

/** Per-recipe average MW override for variable-power buildings (dark matter etc.). */
// EVERY recipe of a variable-power building, with its wiki AVERAGE MW (the wiki
// gives a min–max range that ramps over the cycle; the average is the midpoint).
// Particle Accelerator varies per recipe (Diamonds/Plutonium 250–750 → avg 500;
// Dark Matter / Nuclear Pasta / Ficsonium 500–1500 → avg 1000). Converter is
// uniform (100–400 → avg 250) and Quantum Encoder uniform (0–2000 → avg 1000),
// listed explicitly so each craft carries its own verified value.
export const RECIPE_POWER: Record<string, number> = {
  // --- Particle Accelerator: 500 MW avg ---
  "recipe-diamond-c": 500,
  "recipe-alternate-diamond-turbo-c": 500,
  "recipe-alternate-diamond-petroleum-c": 500,
  "recipe-alternate-diamond-oilbased-c": 500,
  "recipe-alternate-diamond-cloudy-c": 500,
  "recipe-plutonium-c": 500,
  "recipe-alternate-instantplutoniumcell-c": 500,
  // --- Particle Accelerator: 1000 MW avg ---
  "recipe-darkmatter-c": 1000,
  "recipe-alternate-darkmatter-trap-c": 1000,
  "recipe-alternate-darkmatter-crystallization-c": 1000,
  "recipe-spaceelevatorpart-9-c": 1000,
  "recipe-ficsonium-c": 1000,
  // --- Converter: 250 MW avg (uniform) ---
  "recipe-alternate-ionizedfuel-dark-c": 250,
  "recipe-darkenergy-c": 250,
  "recipe-quantumenergy-c": 250,
  "recipe-ficsiteingot-iron-c": 250,
  "recipe-timecrystal-c": 250,
  "recipe-ficsiteingot-al-c": 250,
  "recipe-ficsiteingot-cat-c": 250,
  "recipe-bauxite-caterium-c": 250,
  "recipe-bauxite-copper-c": 250,
  "recipe-caterium-copper-c": 250,
  "recipe-caterium-quartz-c": 250,
  "recipe-coal-iron-c": 250,
  "recipe-coal-limestone-c": 250,
  "recipe-copper-quartz-c": 250,
  "recipe-copper-sulfur-c": 250,
  "recipe-iron-limestone-c": 250,
  "recipe-limestone-sulfur-c": 250,
  "recipe-nitrogen-bauxite-c": 250,
  "recipe-nitrogen-caterium-c": 250,
  "recipe-quartz-bauxite-c": 250,
  "recipe-quartz-coal-c": 250,
  "recipe-sulfur-coal-c": 250,
  "recipe-sulfur-iron-c": 250,
  "recipe-uranium-bauxite-c": 250,
  "recipe-alternate-diamond-pink-c": 250,
  // --- Quantum Encoder: 1000 MW avg (uniform) ---
  "recipe-superpositionoscillator-c": 1000,
  "recipe-temporalprocessor-c": 1000,
  "recipe-spaceelevatorpart-12-c": 1000,
  "recipe-ficsoniumfuelrod-c": 1000,
  "recipe-alienpowerfuel-c": 1000,
  "recipe-syntheticpowershard-c": 1000,
};

/** Max Somersloops per machine type (production amplifier). 0 = not amplifiable. */
export const SLOOP_MAX: Record<string, number> = {
  "Smelter": 1,
  "Constructor": 1,
  "Assembler": 2,
  "Foundry": 2,
  "Refinery": 2,
  "Converter": 2,
  "Manufacturer": 4,
  "Blender": 4,
  "Particle Accelerator": 4,
  "Quantum Encoder": 4,
};

/** Solid resources extractable by Miners. */
export const EXTRACTOR_SOLIDS = [
  "iron-ore", "copper-ore", "limestone", "coal", "caterium-ore",
  "raw-quartz", "sulfur", "bauxite", "uranium", "sam",
];

export type Purity = "impure" | "normal" | "pure";

export interface ExtractorDef {
  machine: string;
  power: number;
  /** Per-purity output (/min at 100%). */
  rates?: { impure: number; normal: number; pure: number };
  /** Fixed output (no purity), e.g. the Water Extractor. */
  fixed?: number;
  /** Resource Well: the rate is per satellite. */
  perSatellite?: boolean;
  items: string[];
}

export const EXTRACTORS: ExtractorDef[] = [
  { machine: "Miner Mk.1", power: 5, rates: { impure: 30, normal: 60, pure: 120 }, items: EXTRACTOR_SOLIDS },
  { machine: "Miner Mk.2", power: 15, rates: { impure: 60, normal: 120, pure: 240 }, items: EXTRACTOR_SOLIDS },
  { machine: "Miner Mk.3", power: 45, rates: { impure: 120, normal: 240, pure: 480 }, items: EXTRACTOR_SOLIDS },
  { machine: "Water Extractor", power: 20, fixed: 120, items: ["water"] },
  { machine: "Oil Extractor", power: 40, rates: { impure: 60, normal: 120, pure: 240 }, items: ["crude-oil"] },
  { machine: "Resource Well Pressurizer", power: 150, rates: { impure: 30, normal: 60, pure: 120 }, perSatellite: true, items: ["water", "crude-oil", "nitrogen-gas"] },
];

/** Output rate (/min at 100%) of an extractor for a given node purity. */
export function extractorRate(ex: ExtractorDef, purity: Purity): number {
  if (typeof ex.fixed === "number") return ex.fixed;
  return ex.rates ? ex.rates[purity] : 0;
}

/**
 * Power-generator pseudo-recipes (slugs `power-*`). `production` = MW output at
 * 100%; `fuels` = accepted fuels (the burned one is detected from the incoming
 * links, one at a time). `dechet` = waste by-product for that fuel (nuclear).
 */
export const GENERATOR_RECIPES: Record<string, Recipe> = {
  "power-biomass-burner": { id: "power-biomass-burner", nom: "Biomass Burner", machine: "Biomass Burner", production: 30, intrants: [], extrants: [], fuels: [
    { item: "biomass", debit: 10 }, { item: "solid-biofuel", debit: 4 }, { item: "leaves", debit: 120 }, { item: "wood", debit: 18 }, { item: "mycelia", debit: 90 },
    { item: "hog-remains", debit: 7.2 }, { item: "hatcher-remains", debit: 7.2 }, { item: "stinger-remains", debit: 7.2 }, { item: "spitter-remains", debit: 7.2 }, { item: "packaged-liquid-biofuel", debit: 2.4 },
  ] },
  "power-coal-generator": { id: "power-coal-generator", nom: "Coal-Powered Generator", machine: "Coal-Powered Generator", production: 75, intrants: [{ item: "water", debit: 45 }], extrants: [], fuels: [
    { item: "coal", debit: 15 }, { item: "compacted-coal", debit: 7.143 }, { item: "petroleum-coke", debit: 25 },
  ] },
  "power-fuel-generator": { id: "power-fuel-generator", nom: "Fuel-Powered Generator", machine: "Fuel-Powered Generator", production: 250, intrants: [], extrants: [], fuels: [
    { item: "fuel", debit: 20 }, { item: "liquid-biofuel", debit: 20 }, { item: "turbofuel", debit: 7.5 }, { item: "rocket-fuel", debit: 4.167 }, { item: "ionized-fuel", debit: 3 },
  ] },
  "power-nuclear-plant": { id: "power-nuclear-plant", nom: "Nuclear Power Plant", machine: "Nuclear Power Plant", production: 2500, intrants: [{ item: "water", debit: 240 }], extrants: [], fuels: [
    { item: "uranium-fuel-rod", debit: 0.2, dechet: { item: "uranium-waste", debit: 10 } },
    { item: "plutonium-fuel-rod", debit: 0.1, dechet: { item: "plutonium-waste", debit: 1 } },
    { item: "ficsonium-fuel-rod", debit: 1 },
  ] },
  "power-geothermal-generator": { id: "power-geothermal-generator", nom: "Geothermal Generator (Normal geyser)", machine: "Geothermal Generator", production: 200, intrants: [], extrants: [], fuels: [] },
  "power-alien-augmenter": { id: "power-alien-augmenter", nom: "Alien Power Augmenter", machine: "Alien Power Augmenter", production: 500, intrants: [], extrants: [], fuels: [{ item: "alien-power-matrix", debit: 5, optionnel: true }] },
};

// Merge generators into the game DB so they behave like any other recipe.
for (const k of Object.keys(GENERATOR_RECIPES)) GAME_DB.recipes[k] = GENERATOR_RECIPES[k];

// Dataset fix: "Pure Aluminum Ingot" is a Hard-Drive ALTERNATE (the standard
// Aluminum Ingot is the Foundry recipe with silica), but the generated DB does
// not flag it — so it was missing its ⭐ and sat in the Smelter section.
const pureAl = GAME_DB.recipes["recipe-purealuminumingot-c"];
if (pureAl) pureAl.alternative = true;

/** Clamped clock speed (%) of a node (1–250, default 100). */
export function clockOf(node: Node): number {
  return typeof node.clock === "number" ? Math.min(250, Math.max(1, node.clock)) : 100;
}

/** Max Somersloops accepted by a machine (0 if not amplifiable). */
export function maxSloops(machine: string): number {
  return SLOOP_MAX[machine] ?? 0;
}

/** Output multiplier from the node's Somersloops (1 = none; generators/extractors excluded). */
export function sloopMult(node: Node, recipe: Recipe | undefined): number {
  if (!recipe || recipe.production) return 1;
  const max = maxSloops(recipe.machine);
  if (max <= 0) return 1;
  const s = typeof node.sloops === "number" ? Math.max(0, Math.min(max, Math.floor(node.sloops))) : 0;
  return 1 + s / max;
}

/** Per-machine consumption (MW at 100%) of a recipe; 0 for generators (they produce). */
export function recipePowerMW(recipe: Recipe | undefined): number {
  if (!recipe || recipe.production) return 0;
  return RECIPE_POWER[recipe.id] ?? MACHINE_POWER[recipe.machine] ?? 0;
}

export interface NodePower {
  prod: number;
  conso: number;
}

/** Power produced / consumed by a node (MW), overclock + Somersloop applied. */
export function nodePower(node: Node, db: Db): NodePower {
  const m = node.machines > 0 ? node.machines : 1;
  const c = clockOf(node) / 100;
  if (node.import) return { prod: 0, conso: 0 };
  const recipe = db.recipes[node.recette];
  if (!isCustomNode(node) && recipe) {
    if (recipe.production) return { prod: recipe.production * m * c, conso: 0 };
    const amp = sloopMult(node, recipe);
    return { prod: 0, conso: recipePowerMW(recipe) * m * amp * amp * Math.pow(c, POWER_EXPONENT) };
  }
  return { prod: 0, conso: (MACHINE_POWER[node.machine ?? ""] ?? 0) * m * Math.pow(c, POWER_EXPONENT) };
}

export interface ScenePower {
  prod: number;
  conso: number;
  net: number;
}

/** Total chain power: production, consumption, and net (prod − conso). */
export function scenePower(scene: Scene, db: Db): ScenePower {
  let prod = 0;
  let conso = 0;
  for (const n of scene.noeuds) {
    const p = nodePower(n, db);
    prod += p.prod;
    conso += p.conso;
  }
  const r = (x: number) => Math.round(x * 100) / 100;
  return { prod: r(prod), conso: r(conso), net: r(prod - conso) };
}
