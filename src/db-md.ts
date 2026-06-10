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

/** `recipes.md`: one recipe per row (slug, name, machine, alt, inputs, outputs). */
export function renderRecipesMd(db: Db): string {
  const recipes = Object.values(db.recipes);
  const rows = recipes
    .map(
      (r) =>
        `| \`${r.id}\` | ${cell(r.nom)} | ${cell(r.machine)} | ${r.alternative ? "⭐" : ""} | ${cell(ports(r.intrants))} | ${cell(ports(r.extrants))} |`,
    )
    .join("\n");
  return `# Satisfactory recipes — game database

> **Generated** from the plugin's bundled database — do not edit by hand (regenerated on launch and by the "Open the Satisfactory guide" command). ${recipes.length} recipes.
> The **slug** is the value of a node's \`recipe\` field. **Rates = per minute per machine at 100%** (a normal node multiplies them by its \`machines\` count). In \`outputs\`, the **first item is the main product**, the following ones are **by-products** (route them or they become orphans = blocked chain). ⭐ = **alternate** recipe.

| slug | name | machine | alt | inputs (item ×rate/min) | outputs (item ×rate/min) |
|---|---|---|:---:|---|---|
${rows}
`;
}
