# Diagnostic rules — shared spec (plugin ↔ AI)

The diagnostics are a **pure function** of `(scene + database)`. The plugin applies it to color the nodes; an AI can **recompute it from the `.md`** and get exactly the same result (the `.md` stays the source of truth, even without the plugin). This document is the contract. Reference implementation: [`src/model/diagnostic.ts`](./src/model/diagnostic.ts).

## Inputs

- **Scene**: `nodes`, `links` (explicit routing of a product from one node to another or to `SINK`), `layers`.
- **DB**: for each recipe, its `inputs` and `outputs` with a **nominal per-machine rate** (at 100%, per minute). The first output is the main product, the following ones are **by-products**.

**Effective rates of a node** (absolute, /min):
- normal node → `nominal recipe rate × machine count`;
- custom node (`inputs` or `outputs` present on the node) → those rates **as-is** (the recipe is ignored).

## Node status

The displayed status is **the worst** of the findings below (`bad` > `warn` > `ok`).

### 🔴 `bad` — blocking

- **Orphaned product / by-product**: an output with **no valid outlet**. The machine's buffer fills up → the machine stops → the whole chain stalls. This is problem #1 (typically unhandled water or silica).
- **Invalid link**: an outgoing link whose **target does not consume** that product (and is not `SINK`) → fake outlet. It **does not count** as disposal.
- **Fluid sent to the Sink**: the AWESOME Sink **only accepts solids**. A `to: SINK` link carrying a fluid/gas is invalid → the output stays orphaned (a fluid must be consumed, reinjected, or packaged into a solid).
- **Unknown recipe**: the node references a recipe missing from the DB and carries no custom rates.

> A **valid outlet** that lifts an orphan: a link to `SINK` (solids only), **or** to a node that **actually consumes** the item (it appears in its effective inputs). A `loop` back to an upstream consumer also counts.

### 🟡 `warn` — keep an eye on it

- **Overproduction**: `produced rate` > `Σ outgoing link rates` for that item (partially routed surplus).
- **Underproduction**: `Σ downstream demanded rates` > `produced rate` (consumers are starved).
- **Under-supplied input**: `Σ incoming links` < `recipe need` → throttled / under-used machine.

### 🟢 `ok`

Every output has a balanced outlet **and** every input is supplied.

## Rate comparisons

Equality checks use a tolerance of `EPS = 0.01/min` (recipe rounding).

## Out of scope (future work)

- Actual throughput capped by the most constrained link (upstream→downstream propagation).
- **Automatic** pruning of links that became invalid after a recipe change (they are detected and flagged 🔴, but not removed automatically).
