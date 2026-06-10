/**
 * Optimiseur de chaîne : pour produire `target` à `rate`/min, choisit la
 * combinaison de recettes (alternatives incluses) qui MINIMISE le total de
 * ressources BRUTES (minerais + liquides), l'eau étant illimitée (coût nul).
 *
 * Programmation linéaire (javascript-lp-solver) :
 *  - variable x_r ≥ 0 = nombre de machines (continu) de la recette r ;
 *  - variable raw_i ≥ 0 = extraction brute de la ressource i ;
 *  - contrainte par item i : Σ_r x_r·(prod_i−cons_i) (+ raw_i si brut) ≥ demande_i ;
 *  - objectif : min Σ raw_i  (ressources brutes hors eau).
 */
import solver from "javascript-lp-solver";
import type { Db, Node, Scene } from "./types";
import { SINK } from "./types";
import { autoLayout } from "./layout";

export interface SolveResult {
  ok: boolean;
  error?: string;
  /** Recettes retenues avec leur nombre de machines. */
  recipes: { id: string; machines: number }[];
  /** Ressources brutes consommées (hors eau), triées par débit décroissant. */
  raw: { item: string; debit: number }[];
}

/** Ce que l'optimiseur minimise. */
export type Objective = "raw" | "machines";

export interface SolveOptions {
  /** "raw" = ressources brutes (défaut) ; "machines" = nombre total de machines. */
  objective?: Objective;
  /** false = recettes standard uniquement (pas d'alternatives). Défaut true. */
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

  // Items concernés (apparaissent dans une recette) — une contrainte de bilan chacun.
  const touched = new Set<string>([target]);
  for (const r of Object.values(db.recipes)) {
    for (const p of [...r.intrants, ...r.extrants]) touched.add(p.item);
  }
  for (const item of touched) {
    if (infinite.has(item)) continue; // eau : illimitée, pas de contrainte
    constraints[`bal_${item}`] = { min: item === target ? rate : 0 };
  }

  // Coûts selon l'objectif. L'objectif secondaire reçoit un poids epsilon :
  // il départage les solutions à objectif principal égal (et garde le rapport
  // raw/machines lisible) sans influencer le choix principal.
  const machineCost = objective === "machines" ? 1 : 1e-4;
  const rawCost = objective === "raw" ? 1 : 1e-3;

  // Variables recettes : coefficient net (prod − cons) par item.
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

  // Variables extraction brute : +1 au bilan de leur item (coût selon l'objectif, eau exclue).
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
 * Construit une Scene à partir d'une solution : un nœud par recette retenue, un
 * nœud "Extraction" (débits personnalisés) par ressource brute, et des liens
 * alloués produit par produit (allocation gloutonne producteurs→consommateurs ;
 * surplus → Sink). Auto-layout appliqué pour un placement propre.
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

  // Sources brutes (nœuds à débits personnalisés : pas d'intrant).
  for (const { item, debit } of result.raw) {
    const id = `src-${item}`;
    noeuds.push({ id, recette: "", machines: 1, machine: "Extraction", intrants: [], extrants: [{ item, debit }] });
    addProd(item, id, debit);
  }

  // Nœuds recettes.
  result.recipes.forEach((r, k) => {
    const rec = db.recipes[r.id];
    if (!rec) return;
    const id = `n${k + 1}`;
    noeuds.push({ id, recette: r.id, machines: r.machines });
    for (const p of rec.extrants) addProd(p.item, id, p.debit * r.machines);
    for (const p of rec.intrants) addCons(p.item, id, p.debit * r.machines);
  });

  // Demande finale : la cible part vers le Sink.
  addCons(target, SINK, rate);

  // Sources pour les ressources illimitées consommées (eau = pompe), dimensionnées
  // à la demande → pas de faux "sous-alimenté".
  for (const item of infiniteItems) {
    const cons = consumers.get(item);
    if (!cons || cons.length === 0) continue;
    const total = round(cons.reduce((s, c) => s + c.remaining, 0));
    const id = `src-${item}`;
    noeuds.push({ id, recette: "", machines: 1, machine: "Pump", intrants: [], extrants: [{ item, debit: total }] });
    addProd(item, id, total);
  }

  // Allocation produit par produit (glouton). Surplus producteur → Sink.
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
    // Surplus producteur → Sink, MAIS le Sink n'accepte pas les fluides.
    const sinkable = db.items[item]?.etat !== "fluide";
    for (; pi < prods.length && sinkable; pi++) {
      if (prods[pi].remaining > EPS) {
        liens.push({ de: prods[pi].nodeId, vers: SINK, produit: item, debit: round(prods[pi].remaining) });
      }
    }
  }

  return autoLayout({ noeuds, liens, calques: [] }, db);
}
