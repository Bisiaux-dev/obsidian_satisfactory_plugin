/**
 * Chain optimizer: to produce `target` at `rate`/min, picks the combination
 * of recipes (alternates included) that MINIMIZES the total of RAW resources
 * (ores + liquids), water being unlimited (zero cost).
 *
 * Linear programming (javascript-lp-solver):
 *  - variable x_r ≥ 0 = number of machines (continuous) for recipe r;
 *  - variable raw_i ≥ 0 = raw extraction of resource i;
 *  - constraint per item i: Σ_r x_r·(prod_i−cons_i) (+ raw_i if raw) ≥ demand_i;
 *  - objective: min Σ raw_i  (raw resources excluding water).
 */
import solver from "javascript-lp-solver";
import type { Db, Node, Scene } from "./types";
import { SINK } from "./types";
import { autoLayout } from "./layout";

export interface SolveResult {
  ok: boolean;
  error?: string;
  /** Selected recipes with their machine counts. */
  recipes: { id: string; machines: number }[];
  /** Raw resources consumed (excluding water), sorted by decreasing rate. */
  raw: { item: string; debit: number }[];
}

/** What the optimizer minimizes. */
export type Objective = "raw" | "machines";

export interface SolveOptions {
  /** "raw" = raw resources (default); "machines" = total machine count. */
  objective?: Objective;
  /** false = standard recipes only (no alternates). Default true. */
  allowAlternates?: boolean;
}

const EPS = 1e-4;
const round = (n: number) => Math.round(n * 1000) / 1000;

export function optimize(
  db: Db,
  target: string,
  rate: number,
  baseItems: string[],
  infiniteItems: string[],
  options: SolveOptions = {},
): SolveResult {
  const objective: Objective = options.objective ?? "raw";
  const allowAlternates = options.allowAlternates !== false;
  if (!db.items[target]) return { ok: false, error: `Unknown item: ${target}`, recipes: [], raw: [] };
  const base = new Set(baseItems);
  const infinite = new Set(infiniteItems);

  const variables: Record<string, Record<string, number>> = {};
  const constraints: Record<string, { min?: number; equal?: number }> = {};

  // Relevant items (appear in a recipe) — one balance constraint each.
  const touched = new Set<string>([target]);
  for (const r of Object.values(db.recipes)) {
    for (const p of [...r.intrants, ...r.extrants]) touched.add(p.item);
  }
  for (const item of touched) {
    if (infinite.has(item)) continue; // water: unlimited, no constraint
    constraints[`bal_${item}`] = { min: item === target ? rate : 0 };
  }

  // Costs depend on the objective. The secondary objective gets an epsilon
  // weight: it breaks ties between solutions with equal primary objective (and
  // keeps the raw/machines ratio readable) without affecting the main choice.
  const machineCost = objective === "machines" ? 1 : 1e-4;
  const rawCost = objective === "raw" ? 1 : 1e-3;

  // Recipe variables: net coefficient (prod − cons) per item.
  for (const r of Object.values(db.recipes)) {
    if (!allowAlternates && r.alternative) continue;
    const v: Record<string, number> = { cost: machineCost };
    const add = (item: string, d: number) => {
      if (infinite.has(item)) return;
      v[`bal_${item}`] = (v[`bal_${item}`] ?? 0) + d;
    };
    for (const p of r.intrants) add(p.item, -p.debit);
    for (const p of r.extrants) add(p.item, p.debit);
    if (Object.keys(v).length > 1) variables[`r:${r.id}`] = v;
  }

  // Raw extraction variables: +1 to their item's balance (cost per objective, water excluded).
  for (const item of base) {
    if (infinite.has(item)) continue;
    variables[`raw:${item}`] = { [`bal_${item}`]: 1, cost: rawCost };
  }

  const model = { optimize: "cost", opType: "min", constraints, variables };
  let res: Record<string, number> & { feasible: boolean };
  try {
    res = solver.Solve(model as never) as never;
  } catch (e) {
    return { ok: false, error: `Solver failure: ${(e as Error).message}`, recipes: [], raw: [] };
  }
  if (!res || res.feasible === false) {
    return { ok: false, error: "No possible chain (item not producible?).", recipes: [], raw: [] };
  }

  const recipes = Object.keys(res)
    .filter((k) => k.startsWith("r:") && res[k] > EPS)
    .map((k) => ({ id: k.slice(2), machines: round(res[k]) }))
    .sort((a, b) => b.machines - a.machines);

  const raw = Object.keys(res)
    .filter((k) => k.startsWith("raw:") && res[k] > EPS)
    .map((k) => ({ item: k.slice(4), debit: round(res[k]) }))
    .sort((a, b) => b.debit - a.debit);

  return { ok: true, recipes, raw };
}

/**
 * Builds a Scene from a solution: one node per selected recipe, one
 * "Extraction" node (custom rates) per raw resource, and links allocated
 * product by product (greedy producers→consumers allocation;
 * surplus → Sink). Auto-layout applied for a clean placement.
 */
export function sceneFromSolution(
  db: Db,
  result: SolveResult,
  target: string,
  rate: number,
  infiniteItems: string[] = [],
): Scene {
  const noeuds: Node[] = [];
  const producers = new Map<string, { nodeId: string; remaining: number }[]>();
  const consumers = new Map<string, { nodeId: string; remaining: number }[]>();
  const addProd = (item: string, nodeId: string, d: number) => {
    if (d <= EPS) return;
    (producers.get(item) ?? producers.set(item, []).get(item)!).push({ nodeId, remaining: d });
  };
  const addCons = (item: string, nodeId: string, d: number) => {
    if (d <= EPS) return;
    (consumers.get(item) ?? consumers.set(item, []).get(item)!).push({ nodeId, remaining: d });
  };

  // Raw sources (custom-rate nodes: no input).
  for (const { item, debit } of result.raw) {
    const id = `src-${item}`;
    noeuds.push({ id, recette: "", machines: 1, machine: "Extraction", intrants: [], extrants: [{ item, debit }] });
    addProd(item, id, debit);
  }

  // Recipe nodes.
  result.recipes.forEach((r, k) => {
    const rec = db.recipes[r.id];
    if (!rec) return;
    const id = `n${k + 1}`;
    noeuds.push({ id, recette: r.id, machines: r.machines });
    for (const p of rec.extrants) addProd(p.item, id, p.debit * r.machines);
    for (const p of rec.intrants) addCons(p.item, id, p.debit * r.machines);
  });

  // Final demand: the target flows to the Sink.
  addCons(target, SINK, rate);

  // Sources for consumed unlimited resources (water = pump), sized to the
  // demand → no false "under-supplied".
  for (const item of infiniteItems) {
    const cons = consumers.get(item);
    if (!cons || cons.length === 0) continue;
    const total = round(cons.reduce((s, c) => s + c.remaining, 0));
    const id = `src-${item}`;
    noeuds.push({ id, recette: "", machines: 1, machine: "Pump", intrants: [], extrants: [{ item, debit: total }] });
    addProd(item, id, total);
  }

  // Product-by-product allocation (greedy). Producer surplus → Sink.
  const liens: Scene["liens"] = [];
  for (const [item, prods] of producers) {
    const cons = consumers.get(item) ?? [];
    let pi = 0;
    let ci = 0;
    while (pi < prods.length && ci < cons.length) {
      const f = Math.min(prods[pi].remaining, cons[ci].remaining);
      if (f > EPS && prods[pi].nodeId !== cons[ci].nodeId) {
        liens.push({ de: prods[pi].nodeId, vers: cons[ci].nodeId, produit: item, debit: round(f) });
      }
      prods[pi].remaining -= f;
      cons[ci].remaining -= f;
      if (prods[pi].remaining <= EPS) pi++;
      if (cons[ci].remaining <= EPS) ci++;
    }
    // Producer surplus → Sink, BUT the Sink does not accept fluids.
    const sinkable = db.items[item]?.etat !== "fluide";
    for (; pi < prods.length && sinkable; pi++) {
      if (prods[pi].remaining > EPS) {
        liens.push({ de: prods[pi].nodeId, vers: SINK, produit: item, debit: round(prods[pi].remaining) });
      }
    }
  }

  return autoLayout({ noeuds, liens, calques: [] }, db);
}
