/**
 * Resolves a node's EFFECTIVE rates (absolute, per min) — single source of truth
 * used by rendering, diagnostics and connection.
 *
 *  - custom node (overridden intrants/extrants) → its rates as-is;
 *  - otherwise → DB recipe × machine count.
 */
import type { Db, Link, Node, Port, Recipe, Scene } from "./types";
import { isCustomNode } from "./types";
import { clockOf, sloopMult } from "./power";

export interface NodePorts {
  machine: string;
  intrants: Port[];
  extrants: Port[];
}

/**
 * A power generator's effective ports: the burned fuel is whichever accepted
 * fuel the incoming links carry (one at a time; default = first non-optional).
 * Fuel/waste scale linearly with machine count × clock.
 */
function generatorPorts(node: Node, recipe: Recipe, m: number, liens?: Link[]): NodePorts {
  const incoming = new Set((liens ?? []).filter((l) => l.vers === node.id).map((l) => l.produit));
  const fuels = recipe.fuels ?? [];
  const fuel = fuels.find((f) => incoming.has(f.item)) ?? fuels.find((f) => !f.optionnel) ?? null;
  const intrants = recipe.intrants.map((p) => ({ item: p.item, debit: p.debit * m }));
  const extrants = recipe.extrants.map((p) => ({ item: p.item, debit: p.debit * m }));
  if (fuel) {
    intrants.push({ item: fuel.item, debit: fuel.debit * m });
    if (fuel.dechet) extrants.push({ item: fuel.dechet.item, debit: fuel.dechet.debit * m });
  }
  return { machine: recipe.machine, intrants, extrants };
}

export function nodePorts(node: Node, db: Db, liens?: Link[]): NodePorts {
  const recipe = db.recipes[node.recette];

  if (isCustomNode(node)) {
    // Clock scales the absolute rates too (an overclocked extractor mines more).
    const c = clockOf(node) / 100;
    return {
      machine: node.machine ?? recipe?.machine ?? "?",
      intrants: (node.intrants ?? []).map((p) => ({ item: p.item, debit: p.debit * c })),
      extrants: (node.extrants ?? []).map((p) => ({ item: p.item, debit: p.debit * c })),
    };
  }

  if (!recipe) return { machine: node.machine ?? "?", intrants: [], extrants: [] };

  const m = (node.machines > 0 ? node.machines : 1) * (clockOf(node) / 100);
  if (recipe.fuels) return generatorPorts(node, recipe, m, liens);

  const amp = sloopMult(node, recipe);
  return {
    machine: recipe.machine,
    intrants: recipe.intrants.map((p) => ({ item: p.item, debit: p.debit * m })),
    extrants: recipe.extrants.map((p) => ({ item: p.item, debit: p.debit * m * amp })),
  };
}

/**
 * External interface of a layer (for the collapsed view): aggregates the links
 * that CROSS the group boundary. Inputs = links coming from outside to a
 * member; outputs = links from a member to the outside. Internal links
 * (between members) are ignored.
 */
export function layerAggregatePorts(scene: Scene, layerId: string): { intrants: Port[]; extrants: Port[] } {
  const members = new Set(scene.noeuds.filter((n) => n.calque === layerId).map((n) => n.id));
  const inMap = new Map<string, number>();
  const outMap = new Map<string, number>();
  for (const l of scene.liens) {
    const deIn = members.has(l.de);
    const versIn = members.has(l.vers);
    if (versIn && !deIn) inMap.set(l.produit, (inMap.get(l.produit) ?? 0) + l.debit);
    if (deIn && !versIn) outMap.set(l.produit, (outMap.get(l.produit) ?? 0) + l.debit);
  }
  return {
    intrants: [...inMap].map(([item, debit]) => ({ item, debit })),
    extrants: [...outMap].map(([item, debit]) => ({ item, debit })),
  };
}
