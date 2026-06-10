/**
 * Résout les débits EFFECTIFS (absolus, en /min) d'un nœud — source unique
 * utilisée par le rendu, le diagnostic et la connexion.
 *
 *  - nœud personnalisé (intrants/extrants surchargés) → ses débits tels quels ;
 *  - sinon → recette de la DB × nombre de machines.
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
 * Interface externe d'un calque (pour la vue repliée) : agrège les liens qui
 * TRAVERSENT la frontière du groupe. Entrées = liens venant de l'extérieur vers
 * un membre ; sorties = liens d'un membre vers l'extérieur. Les liens internes
 * (entre membres) sont ignorés.
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
