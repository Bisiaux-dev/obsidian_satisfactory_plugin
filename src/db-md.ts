/**
 * Exports the bundled game database ({@link Db}) as Markdown deposited into the
 * vault (`items.md` / `recipes.md`). Goal: make the DB **readable from the vault**
 * — by humans AND by "vault-only" AIs — whereas it otherwise lives inside the
 * bundle (`game-db.ts`), invisible.
 *
 * Generated at runtime from {@link GAME_DB} → always in sync with the bundled DB
 * (regenerated on every database update + rebuild, no static file to maintain).
 * Format = Markdown tables: readable at a glance, and parseable line by line.
 */
import type { Db, Port } from "./model/types";
import { EXTRACTORS, GENERATOR_RECIPES, MACHINE_POWER, recipePowerMW, maxSloops } from "./model/power";

/** Escapes `|` so table columns are not broken. */
function cell(s: string): string {
  return s.replace(/\|/g, "\\|");
}

/** Renders a port list as `item ×rate, item ×rate` (or `—` if empty). */
function ports(list: Port[]): string {
  if (!list.length) return "—";
  return list.map((p) => `${p.item} ×${p.debit}`).join(", ");
}

/** `items.md`: one item per row (slug, name, state, color). */
export function renderItemsMd(db: Db): string {
  const items = Object.values(db.items);
  const rows = items
    .map((it) => `| \`${it.id}\` | ${cell(it.nom)} | ${it.etat === "fluide" ? "fluid" : "solid"} | ${it.couleur} |`)
    .join("\n");
  return `# Satisfactory items — game database

> **Generated** from the plugin's bundled database — do not edit by hand (regenerated on launch and by the "Open the Satisfactory guide" command). ${items.length} items.
> The **slug** is the identifier to use in a \`satisfactory\` block (\`item\` / \`product\` fields). \`state\` drives the flow rendering (solid = solid line, fluid = dashed) and the Sink rule (solids only). \`color\` = the product's hue (edge colors).

| slug | name | state | color |
|---|---|---|---|
${rows}
`;
}

/** `recipes.md`: one recipe per row (slug, name, machine, alt, power, inputs, outputs). */
export function renderRecipesMd(db: Db): string {
  const recipes = Object.values(db.recipes);
  const power = (r: Db["recipes"][string]): string => (r.production ? `+${r.production}` : `${recipePowerMW(r) || "—"}`);
  const inputsCell = (r: Db["recipes"][string]): string => {
    if (!r.fuels) return ports(r.intrants);
    if (r.fuels.length === 0) return ports(r.intrants);
    const base = r.intrants.length ? `${ports(r.intrants)}, ` : "";
    return `${base}fuel (one of): ${r.fuels.map((f) => `${f.item} ×${f.debit}${f.optionnel ? " (optional)" : ""}`).join(" / ")}`;
  };
  const outputsCell = (r: Db["recipes"][string]): string => {
    if (!r.fuels) return ports(r.extrants);
    const wastes = r.fuels.filter((f) => f.dechet);
    if (wastes.length === 0) return ports(r.extrants);
    return wastes.map((f) => `${f.dechet!.item} ×${f.dechet!.debit} (if ${f.item})`).join(", ");
  };
  const rows = recipes
    .map(
      (r) =>
        `| \`${r.id}\` | ${cell(r.nom)} | ${cell(r.machine)} | ${r.alternative ? "⭐" : ""} | ${power(r)} | ${cell(inputsCell(r))} | ${cell(outputsCell(r))} |`,
    )
    .join("\n");
  return `# Satisfactory recipes — game database

> **Generated** from the plugin's bundled database — do not edit by hand (regenerated on launch and by the "Open the Satisfactory guide" command). ${recipes.length} recipes.
> The **slug** is the value of a node's \`recipe\` field. **Rates = per minute per machine at 100%** (a normal node multiplies them by its \`machines\` count). In \`outputs\`, the **first item is the main product**, the following ones are **by-products** (route them or they become orphans = blocked chain). ⭐ = **alternate** recipe.
> **power (MW)** = consumption per machine at 100% clock (variable-power machines shown at their **average**); a leading \`+\` means the recipe **produces** power (generator pseudo-recipes, slugs \`power-*\`, fuel burn rates from the official wiki). Full building data in \`machines.md\`.

| slug | name | machine | alt | power (MW) | inputs (item ×rate/min) | outputs (item ×rate/min) |
|---|---|---|:---:|---:|---|---|
${rows}
`;
}

/** `machines.md`: production buildings power, extractors (by purity), generators (by fuel). */
export function renderMachinesMd(db: Db): string {
  const usedBy = new Map<string, number>();
  for (const r of Object.values(db.recipes)) {
    if (r.production) continue;
    usedBy.set(r.machine, (usedBy.get(r.machine) ?? 0) + 1);
  }
  const variable: Record<string, string> = {
    "Particle Accelerator": "250–750 MW (1500 max for dark matter / Nuclear Pasta / Ficsonium — see per-recipe averages in recipes.md)",
    "Converter": "100–400 MW, average 250",
    "Quantum Encoder": "0–2000 MW, average 1000",
  };
  const prodRows = [...usedBy.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((m) => `| ${cell(m)} | ${MACHINE_POWER[m] ?? "?"} | ${variable[m] ? cell(variable[m]) : ""} | ${usedBy.get(m)} |`)
    .join("\n");
  const extRows = EXTRACTORS.map((ex) => {
    const fixed = typeof ex.fixed === "number";
    const cells = fixed
      ? `${ex.fixed} (fixed) | ${ex.fixed} | ${ex.fixed}`
      : `${ex.rates!.impure} | ${ex.rates!.normal} | ${ex.rates!.pure}`;
    return `| ${cell(ex.machine)}${ex.perSatellite ? " (per satellite)" : ""} | ${ex.power} | ${cells} | ${cell(ex.items.map((i) => db.items[i]?.nom ?? i).join(", "))} |`;
  }).join("\n");
  const genSections = Object.values(GENERATOR_RECIPES)
    .map((r) => {
      const water = r.intrants.find((p) => p.item === "water");
      const rows = (r.fuels ?? []).length === 0
        ? ["| — (no fuel) | — | — |"]
        : (r.fuels ?? []).map(
            (f) =>
              `| ${db.items[f.item]?.nom ?? f.item} ×${f.debit}/min${f.optionnel ? " (optional)" : ""} | ${water ? `${water.debit}/min` : "—"} | ${f.dechet ? `${db.items[f.dechet.item]?.nom ?? f.dechet.item} ×${f.dechet.debit}/min` : "—"} |`,
          );
      return `### ${r.machine} — ${r.production} MW (\`${r.id}\`)

| accepted fuel (burn rate at 100%) | water | waste |
|---|---|---|
${rows.join("\n")}`;
    })
    .join("\n\n");
  return `# Satisfactory machines & power — game database

> **Generated** from the plugin's bundled database — do not edit by hand (regenerated on launch and by the "Open the Satisfactory guide" command). Power values from the official wiki (satisfactory.wiki.gg, game version 1.0/1.1), at **100% clock**.
> The chain's total power is shown **bottom-right of the graph** (⚡): consumption of all machines; if the chain contains generators, the badge shows **production − consumption = net**. Variable-power machines are counted at their **average**. Extraction source nodes are counted when their \`machine\` field matches an extractor below (e.g. \`Miner Mk.2\`). Imported factories are not counted.
> **Overclocking** — \`clock\` field on a node (1–250%, default 100): item rates scale **linearly**; machine power scales as **clock^1.321928** (wiki formula — e.g. 250% ⇒ ×3.36 power, 50% ⇒ ×0.4); **generators stay fully linear** (output + fuel). On an extractor/custom source node, \`clock\` scales **both** the output rate and the power.
> **Production amplifier** — \`sloops\` field: Somersloops multiply a recipe's **output** by \`1 + sloops/max\` (×2 at full) and **power** by \`(1 + sloops/max)²\` (×4 at full). Max: Smelter/Constructor 1, Assembler/Foundry/Refinery/Converter 2, Manufacturer/Blender/Particle Accelerator/Quantum Encoder ${maxSloops("Manufacturer")}. Not allowed on extractors/generators. Inputs unchanged.

## Production machines

| machine | power (MW) | variable | recipes |
|---|---:|---|---:|
${prodRows}

## Extractors

> Add them with the **Extractor** button (or \`E\`, or right-click → *Add an extractor here…*). Pick the **node purity** (filon) in the picker — it sets the base output. Rates below are **/min at 100% clock**; overclock the node to go further: a **pure Miner Mk.3 @250% = 1200/min** (the solid belt max), Oil Extractor pure @250% = 600, Water Extractor @250% = 300. The Resource Well Pressurizer rate is **per satellite**.

| machine | power (MW) | impure | normal | pure | resources |
|---|---:|---:|---:|---:|---|
${extRows}

## Power generators

> **One node per generator** (slugs \`power-*\`). The burned fuel is detected from the incoming links (one fuel at a time; default = first row). Nuclear waste follows the connected rod and is a by-product to route. Geothermal output is the **average of a normal geyser** (impure 100 MW, pure 400 MW). The Alien Power Augmenter's matrix fuel is optional and its grid boost is not modeled, only its flat 500 MW.

${genSections}
`;
}
