/**
 * Resolves a node's EFFECTIVE rates (absolute, per min) — single source of truth
 * used by rendering, diagnostics and connection.
 *
 *  - custom node (overridden intrants/extrants) → its rates as-is;
 *  - otherwise → DB recipe × machine count.
 */
import type { Db, Node, Port, Scene } from "./types";
import { isCustomNode } from "./types";

export interface NodePorts {
  machine: string;
  intrants: Port[];
  extrants: Port[];
}

export function nodePorts(node: Node, db: Db): NodePorts {
  const recipe = db.recipes[node.recette];

  if (isCustomNode(node)) {
    return {
      machine: node.machine ?? recipe?.machine ?? "?",
      intrants: node.intrants ?? [],
      extrants: node.extrants ?? [],
    };
  }

  if (!recipe) return { machine: node.machine ?? "?", intrants: [], extrants: [] };

  const m = node.machines > 0 ? node.machines : 1;
  return {
    machine: recipe.machine,
    intrants: recipe.intrants.map((p) => ({ item: p.item, debit: p.debit * m })),
    extrants: recipe.extrants.map((p) => ({ item: p.item, debit: p.debit * m })),
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
