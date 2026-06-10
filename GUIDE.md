# Satisfactory Chains — guide

An Obsidian plugin to **document, visualize, verify and optimize** [Satisfactory](https://www.satisfactorygame.com/) production chains.

> **The source of truth is this `.md` file.** A chain lives entirely inside a ` ```satisfactory ` code block (YAML). The plugin renders it as an interactive graph; every mouse action **writes the block back**. Because everything is text, **an AI can read and fix a chain without the plugin** — see [Instructions for an AI](#instructions-for-an-ai).

This guide is **self-contained**: everything needed to read and write a chain is here. The game slugs (items and recipes) are listed in `items.md` and `recipes.md` (the bundled database, exported into your vault).

---

## Contents
- [Create a chain](#create-a-chain)
- [The `satisfactory` block](#the-satisfactory-block)
- [Mouse editing](#mouse-editing)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Optimizer](#optimizer)
- [Diagnostics (node colors)](#diagnostics-node-colors)
- [Instructions for an AI](#instructions-for-an-ai)

---

## Create a chain

Three ways:
- **Ribbon icon** (factory) → creates a pre-filled note and opens it.
- **Command palette** → *New Satisfactory chain*, or *Insert Satisfactory block at cursor*.
- **By hand**: in any note, add a code block whose language is `satisfactory`.

````markdown
```satisfactory
nodes: []
```
````

An empty block shows the toolbar: click **Optimize** (generates a chain) or **+ Node** (build by hand).

---

## The `satisfactory` block

The block body is **YAML**. Three lists: `nodes`, `links`, `layers`. Everything is optional — a block may contain only `nodes`.

```satisfactory
nodes:
  - { id: ore, recipe: "", machines: 1, machine: Miner, inputs: [], outputs: [{ item: iron-ore, rate: 60 }] }
  - { id: ingot, recipe: recipe-ingotiron-c, machines: 1 }
  - { id: plate, recipe: recipe-ironplate-c, machines: 1 }
links:
  - { from: ore, to: ingot, product: iron-ore, rate: 30 }
  - { from: ingot, to: plate, product: iron-ingot, rate: 30 }
  - { from: plate, to: SINK, product: iron-plate, rate: 20 }
layers:
  - { id: smelting, name: "Smelting", icon: "🔥", color: "#f59e0b" }
```

> Backward compatibility: the original French keys (`noeuds`/`liens`/`calques`, `recette`, `intrants`/`extrants`, `debit`, `de`/`vers`/`produit`, `boucle`, `nom`/`icone`/`couleur`/`replie`) are still accepted when reading. The plugin always writes the English keys above.

### `nodes` — the machines you placed

| field | type | required | role |
|---|---|:---:|---|
| `id` | text | ✅ | unique node identifier within the scene |
| `recipe` | slug | ✅ | a DB recipe (e.g. `recipe-ironplate-c`). `""` for a custom node |
| `machines` | number | — | machine count (default `1`). Decimals allowed (= clock speed). Multiplies the recipe rates |
| `pos` | `[x, y]` | — | position; auto-placed otherwise |
| `layer` | layer id | — | attaches the node to a layer |
| `machine` | text | — | **(custom)** displayed machine name, otherwise the recipe's |
| `inputs` | `[{item, rate}]` | — | **(custom)** ABSOLUTE input rates /min — overrides the recipe |
| `outputs` | `[{item, rate}]` | — | **(custom)** ABSOLUTE output rates /min — overrides the recipe |
| `import` | note name | — | **(import)** imports the production of ANOTHER note as a black box (see below) |

> **Normal node**: `recipe` + `machines` → rates = recipe × machines (game ratios).
> **Custom node**: as soon as `inputs` **or** `outputs` is present, the node **ignores the recipe** and uses these rates as-is. Useful for an extraction source (miner, pump) or an item missing from the DB.

#### Import the production of another note (`import`)

To **reuse a factory designed elsewhere**: an `import` node references another note and exposes **its deliverables** (what it sends to `SINK`, otherwise its net surplus) as a black box you route into your chain.

```yaml
nodes:
  - { id: frames, import: "Frames", machines: 1 }        # ⇽ imports the "Frames.md" factory
  - { id: heavy, recipe: recipe-modularframeheavy-c, machines: 1 }
links:
  - { from: frames, to: heavy, product: modular-frame, rate: 10 }
```

- `import` = the **name (or path) of the source note**. `machines` = **multiplier** (import N copies of that factory).
- The node's rates are **derived** from the source note and **kept in sync**: edit "Frames" and every note importing it updates automatically. The `.md` only stores `import:` — never stale derived rates.
- Great for modularity: one note per sub-factory (ingots, plates, frames…), then an "assembly" note importing them.

### `links` — the routing (what feeds what)

| field | type | required | role |
|---|---|:---:|---|
| `from` | node id | ✅ | source node |
| `to` | node id **or** `SINK` | ✅ | destination (or the AWESOME Sink) |
| `product` | item slug | ✅ | transported item |
| `rate` | number | — | rate /min on this link (default `0`) |
| `loop` | `true` | — | reinjection upstream (rendered ♻) |

> A link encodes a **routing decision**: it's what the diagnostics read to spot by-products without an outlet. `SINK` is a terminal target (the AWESOME Sink) — **it only accepts solids**.

### `layers` — grouping (modularity)

| field | type | required | role |
|---|---|:---:|---|
| `id` | text | ✅ | identifier (referenced by `nodes[].layer`) |
| `name` | text | — | displayed title (default = `id`) |
| `icon` | text/emoji | — | header pictogram |
| `color` | hex `#rrggbb` | — | frame color |
| `collapsed` | `true` | — | rendered collapsed as a **module node** with aggregated ports |

### Slugs (items & recipes)

- **Item** = display name in kebab-case: `Iron Plate` → `iron-plate`, `Crude Oil` → `crude-oil`.
- **Recipe** = className in kebab-case: `Recipe_IronPlate_C` → `recipe-ironplate-c`.
- The authoritative list lives in **`items.md`** and **`recipes.md`** next to this guide. **Never invent a slug** — copy it from those files.

---

## Mouse editing

| Action | Gesture |
|---|---|
| Add a node | **+ Node** (or `N`) → searchable picker, grouped by machine, alternates apart |
| Add a node AT a spot | **right-click the background** → *Add a node here…* |
| Import another factory | **Import** in the toolbar (or right-click → *Import a factory here…*) → pick the note |
| **Create a consumer** | drag an output handle **into empty space** → picker filtered to recipes consuming that product → node created + linked |
| Move a node | drag (writes `pos` on drop) |
| Edit a node | **double-click** the node (or right-click → *Edit…*) |
| Edit a value | **double-click** the value (machines, rate, machine) |
| Connect two nodes | drag handle to handle (product picked automatically; message if refused) |
| Toggle a link's loop | **double-click** its label (or right-click the link) |
| Duplicate / → Sink / delete | **right-click a node** |
| Delete | **✕** on hover (node or link), or `Del` |
| Multi-select | **Shift+drag** (box) · Shift/Ctrl+click · `Ctrl+A` |
| Create a layer | selection → **Group** (or `G`) |
| Rename a layer | pencil on its header (or double-click the name) |
| Collapse / expand | chevron on the layer header |
| Copy / paste | `Ctrl+C` / `Ctrl+V` (or buttons; right-click → *Paste here*) |
| Tidy | **Tidy** (left-to-right auto-layout, or `R`) |
| Undo / redo | **Ctrl+Z** / **Ctrl+Shift+Z** |

### Keyboard shortcuts

Active while the mouse is over the graph:

| Key | Action |
|---|---|
| `N` | Add a node (picker) |
| `O` | Toggle the optimizer |
| `R` | Tidy (auto-layout) |
| `F` | Fit view |
| `G` | Group the selection into a layer |
| `Del` | Delete the selection |
| `Ctrl+C` / `Ctrl+V` | Copy / paste |
| `Ctrl+A` | Select all |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Esc` | Close panels/menus |
| `?` | In-plugin help recalling all of this |

Everything is written back to the `.md` (the camera stays stable, no flicker).

> **Setting** (*Settings → Satisfactory chains*): **Whole machines** — disabled by default (decimals allowed, useful for clock speed); enabled, machine counts are rounded to integers when editing.

---

## Optimizer

**Optimize** button (or `O`) → enter an item + a target rate, then choose:
- **the objective**: minimize **raw resources** (ores + liquids; water is free because unlimited) or **machine count**;
- whether **alternate recipes** are allowed (unchecked = standard recipes only).

- Shows the **raw total** + the **recipe list**.
- **Generate the chain** builds the full scene (nodes, links, extraction sources, auto-layout) right into the block.

It's a verifier that **assists your reasoning**, not an autopilot: you stay in charge of the chain.

---

## Diagnostics (node colors)

The diagnostics are a **pure function of `(scene + DB)`**: they can be **recomputed from the text**, identically, even without the plugin. A node's status is **the worst** of the findings below.

**Effective rates of a node** (/min, absolute):
- normal node → `nominal recipe rate × machines`;
- custom node (`inputs`/`outputs` present) → those rates as-is.

### 🔴 `bad` — blocking
- **Orphaned product / by-product**: an output with **no valid outlet**. The machine's buffer fills up → the machine stops → the whole chain stalls. **Problem #1** (typically unhandled water or silica).
- **Invalid link**: an outgoing link whose target **does not consume** that product (and isn't `SINK`) → fake outlet, doesn't count as disposal.
- **Fluid sent to the Sink**: the Sink **only accepts solids**. A `to: SINK` link carrying a fluid/gas is invalid → the output stays orphaned.
- **Unknown recipe**: the node references a recipe missing from the DB and carries no custom rates.

> **Valid outlet** to lift an orphan: a link to `SINK` (solids only), **or** to a node that **actually consumes** the item, **or** a `loop` back to an upstream consumer.

### 🟡 `warn` — keep an eye on it
- **Overproduction**: `produced rate` > `Σ outgoing links` for that item.
- **Underproduction**: `Σ downstream demand` > `produced rate` (consumers are starved).
- **Under-supplied input**: `Σ incoming links` < `recipe need` (throttled machine).

### 🟢 `ok`
Every output has a balanced outlet **and** every input is supplied.

> Rate comparisons use a tolerance of `EPS = 0.01/min` (recipe rounding).

---

## Instructions for an AI

You can read **and write** a chain as text, without the plugin. The `.md` note is the **only source of truth**.

1. **Read the DB first.** Every item/recipe fact (rates, machine, inputs/outputs, by-products, alternate recipes, solid/fluid state) comes from `items.md` and `recipes.md`. **Never invent a slug** — only use the ones from the DB.
2. **Respect the game rules:**
   - every **by-product needs an outlet** (consumed downstream / reinjected with `loop` / sent to `SINK`) — an orphan **blocks the chain**;
   - the `SINK` **only accepts solids** (a fluid/gas must be consumed, reinjected, or packaged into a solid);
   - **water is unlimited** — never treat it as a missing resource;
   - **a normal node's rate = recipe × machines** (fixed game ratios); a node with `inputs`/`outputs` uses those absolute rates as-is.
3. **Self-check before answering.** Re-derive the diagnostics (above) from your own text — orphans, over/underproduction, invalid links — and state explicitly that everything is green (or list what remains 🟡/🔴 and why).
4. **Write into a dedicated note**, never into an example fixture. Keep **one line per element** (`nodes`/`links`/`layers`) so diffs stay readable.
5. **Ask for missing constraints**: whole or decimal machine counts (overclocking)? target rate X/min? standard or alternate recipes?

**Fixing an orphan** (the most common case) = adding one `links` line. For a surplus solid:
```yaml
- { from: <node>, to: SINK, product: <item>, rate: <leftover> }
```

The plugin (visual render) and the AI (text) produce **the same diagnostics** from the same `.md` → the text stays authoritative, even with the plugin unloaded.
