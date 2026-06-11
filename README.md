# Satisfactory chains — Obsidian plugin

Plan, **visualize**, **verify** and **optimize** [Satisfactory](https://www.satisfactorygame.com/) production chains as interactive graphs — stored in **plain Markdown**. The whole chain (machines, routing, rates, layers) lives in a ` ```satisfactory ` code block: every mouse action **writes the block back**, so the note stays the single source of truth — diffable, portable, and **editable by an AI** without the plugin.

![Satisfactory chains demo](https://raw.githubusercontent.com/Bisiaux-dev/obsidian_satisfactory_plugin/main/assets/demo.gif)

> **Status:** v0.1.0, desktop only. The Satisfactory **1.0 game database is bundled** (177 items, 276 recipes including alternates, item icons) — nothing else to install. The plugin makes **no network requests** and reads no files outside your vault.

## Why

Factory plans rot in spreadsheets and external calculators, far from your notes — and a chain that "looks right" still stalls in game because one by-product has nowhere to go. Here the plan **is** the note, and the plugin is a **verifier + optimizer**, not just a generator: it tells you *why* a chain is broken (orphaned by-product, starved input, fluid sent to the Sink) before you build it.

![A production chain rendered and diagnosed in Obsidian](https://raw.githubusercontent.com/Bisiaux-dev/obsidian_satisfactory_plugin/main/assets/portal-1-graph.png)

## A chain is just Markdown

````markdown
```satisfactory
nodes:
  - { id: ore, recipe: "", machines: 1, machine: Miner, inputs: [], outputs: [{ item: iron-ore, rate: 60 }] }
  - { id: ingot, recipe: recipe-ingotiron-c, machines: 2 }
  - { id: plate, recipe: recipe-ironplate-c, machines: 1.5 }
links:
  - { from: ore, to: ingot, product: iron-ore, rate: 60 }
  - { from: ingot, to: plate, product: iron-ingot, rate: 45 }
  - { from: plate, to: SINK, product: iron-plate, rate: 30 }
```
````

Three YAML lists — `nodes`, `links`, `layers`. A node's rates = recipe × machines (decimals = clock speed); custom `inputs`/`outputs` override the recipe (extraction sources); `to: SINK` routes to the AWESOME Sink. The **full block reference** ships with the plugin: see [`GUIDE.md`](./GUIDE.md), installed into your vault as `Satisfactory Chains/Guide.md`.

## Build with the mouse

![Node picker: search, grouped by machine, alternates apart](https://raw.githubusercontent.com/Bisiaux-dev/obsidian_satisfactory_plugin/main/assets/portal-2-picker.png)

- **+ Node** (or `N` at the mouse position) → searchable picker, grouped by machine, alternate recipes apart.
- **Drag an output handle into empty space** → picker filtered to recipes consuming that product → node created **and linked** at the drop point.
- **Drag handle to handle** to connect (the product is picked automatically; invalid routes are refused with a message).
- **Double-click** a node (or any value) to edit it; **right-click** background / node / link for the context menu (add here, paste here, duplicate, surplus → Sink, loop, delete).
- **Shift+drag** to multi-select, **Group** (`G`) to wrap a selection into a collapsible layer.
- **Tidy** (`R`) auto-layouts left→right; **Ctrl+Z / Ctrl+Shift+Z** undo/redo; `?` shows the full keyboard + mouse reference.

Every gesture is written back to the `.md` — stable camera, no flicker.

## Verify: diagnostics

Node colors are computed by a **pure function** of `(scene + game DB)` — fully recomputable from the text ([`DIAGNOSTIC.md`](./DIAGNOSTIC.md)):

- 🔴 **blocked** — an output with **no valid outlet** (orphaned by-product), a link whose target doesn't consume the product, or a **fluid sent to the Sink** (it only accepts solids). In game this fills a buffer and stalls the whole chain.
- 🟡 **check** — surplus or shortfall of a product, under-supplied input.
- 🟢 **ok** — everything balanced and supplied.

## Optimize

![Optimizer: target item + rate, objective, computed plan](https://raw.githubusercontent.com/Bisiaux-dev/obsidian_satisfactory_plugin/main/assets/portal-3-optimizer.png)

**Optimize** (`O`) → target item + rate → a linear-programming solver computes the recipe mix that **minimizes raw resources or machine count** (your choice, alternates allowed or standard-only; water is free because unlimited). **Generate the chain** then builds the whole scene — nodes, links, extraction sources, auto-layout — right into the block.

## Modular factories

![Import the production of another note, kept in sync](https://raw.githubusercontent.com/Bisiaux-dev/obsidian_satisfactory_plugin/main/assets/portal-4-import.png)

One note per sub-factory, then **Import** exposes another note's deliverables as a black-box node (× a multiplier). Rates are **derived and kept in sync**: edit the imported factory and every consumer note updates — the `.md` never stores stale numbers.

## Install

**Community plugins (once published):** Settings → *Community plugins* → disable *Restricted mode* → *Browse* → search "Satisfactory chains" → Install → Enable.

**Manual:** download a [release](https://github.com/Bisiaux-dev/obsidian_satisfactory_plugin/releases) (or build with `npm install && npm run build`), copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/satisfactory-chains/`, enable the plugin in Settings → Community plugins, and restart Obsidian if needed.

> **First launch:** the plugin creates a "Satisfactory Chains" folder in your vault containing `Guide.md` (full user + AI guide) plus `items.md` / `recipes.md` (the game database as Markdown). Delete it freely — it is not recreated automatically (the *Open the Satisfactory guide* command restores it).

## For AIs

An AI can **read, diagnose and fix chains as text**, without the plugin: the bundled guide is self-contained (slugs come from `items.md`/`recipes.md`, outlet rules, self-check procedure). Plugin and AI derive the **same diagnostics** from the same `.md` — the text stays authoritative even with the plugin unloaded.

## How it works

The renderer is React Flow mounted inside Obsidian's Markdown post-processor; the model is pure TypeScript, so diagnostics and the solver run identically in and out of Obsidian.

```
src/
  ├── main.ts            → plugin entry: block processor, write-back (vault.process), docs install
  ├── schema.ts          → YAML → Scene parser (English keys; legacy French keys still read)
  ├── serialize.ts       → Scene → YAML writer (one line per element, diff-friendly)
  └── model/
        ├── game-db.ts   → generated Satisfactory 1.0 database (greeny/SatisfactoryTools)
        ├── diagnostic.ts→ pure (scene + DB) → node statuses
        ├── solver.ts    → linear programming (javascript-lp-solver)
        └── edit.ts      → connect/group/copy/paste/undo primitives
```

Game data updates: drop a fresh `data.json` into `_data/greeny.json`, then `node _data/generate.cjs && node _data/fetch-icons.cjs && npm run build`.

## Development

```bash
npm install
npm run dev      # watch build
npm run build    # production build (typecheck + bundle)
```

End-to-end tests drive the **real Obsidian** over the Chrome DevTools Protocol:

```bash
npm run deploy:test   # deploy the build into the test vault
npm run launch:test   # Obsidian in debug mode
npm run test:e2e      # 24 assertions (render, write-back, editing, picker, menu…)
```

Releases are built by CI and shipped with **build provenance attestations** (`gh attestation verify`).

## Credits & licenses

- Plugin code: [AGPL-3.0-or-later](./LICENSE) — Copyright (C) 2026 Pierre Bisiaux. Personal use and modification are free; any **redistribution** of a modified version must stay open source.
- Bundled libraries: [React Flow / @xyflow/react](https://github.com/xyflow/xyflow) (MIT), [React](https://react.dev) (MIT), [lucide-react](https://lucide.dev) (ISC), [@dagrejs/dagre](https://github.com/dagrejs/dagre) (MIT), [javascript-lp-solver](https://github.com/JWally/jsLPSolver) (Unlicense).
- Game data derived from [greeny/SatisfactoryTools](https://github.com/greeny/SatisfactoryTools) (MIT). Item icons fetched from the [official Satisfactory wiki](https://satisfactory.wiki.gg).
- **Satisfactory** is a trademark of Coffee Stain Studios AB. Game names and icons are © Coffee Stain Studios, used nominatively for documentation in this **unofficial**, free, non-commercial community tool, **not affiliated with or endorsed by Coffee Stain Studios**. Any infringing material will be removed on request.
