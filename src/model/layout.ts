/**
 * Auto-layout gauche→droite (dagre) sur le graphe VISIBLE : un calque replié est
 * traité comme UN seul bloc (nœud module), ses membres cachés étant empilés à
 * l'emplacement du module (pour un dépliage propre). Évite les superpositions,
 * y compris module ↔ nœuds voisins. Renvoie une Scene avec les `pos` à jour.
 */
import dagre from "@dagrejs/dagre";
import type { Db, Scene } from "./types";
import { SINK } from "./types";
import { nodePorts } from "./ports";

const SIZE_RECIPE = { w: 210, h: 150 };
const SIZE_RAW = { w: 180, h: 80 };
const SIZE_SINK = { w: 150, h: 70 };
const SIZE_MODULE = { w: 210, h: 130 };
const MEMBER_GAP = 170; // espacement vertical des membres empilés sous un module

export function autoLayout(scene: Scene, db: Db): Scene {
  const collapsed = new Set(scene.calques.filter((c) => c.replie).map((c) => c.id));
  const moduleOf = (nodeId: string): string | null => {
    const n = scene.noeuds.find((x) => x.id === nodeId);
    return n && n.calque && collapsed.has(n.calque) ? `module-${n.calque}` : null;
  };

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 70, ranksep: 140, marginx: 30, marginy: 30 });

  // Nœuds visibles : nœuds hors calque replié + un module par calque replié.
  const size = new Map<string, { w: number; h: number }>();
  for (const n of scene.noeuds) {
    if (n.calque && collapsed.has(n.calque)) continue; // membre masqué
    const s = nodePorts(n, db).intrants.length === 0 ? SIZE_RAW : SIZE_RECIPE;
    size.set(n.id, s);
    g.setNode(n.id, { width: s.w, height: s.h });
  }
  for (const layer of scene.calques) {
    if (!collapsed.has(layer.id)) continue;
    if (!scene.noeuds.some((n) => n.calque === layer.id)) continue;
    const id = `module-${layer.id}`;
    size.set(id, SIZE_MODULE);
    g.setNode(id, { width: SIZE_MODULE.w, height: SIZE_MODULE.h });
  }
  if (scene.liens.some((l) => l.vers === SINK)) {
    size.set(SINK, SIZE_SINK);
    g.setNode(SINK, { width: SIZE_SINK.w, height: SIZE_SINK.h });
  }

  // Arêtes (reroutées vers les modules ; liens internes ignorés).
  for (const l of scene.liens) {
    const a = moduleOf(l.de) ?? l.de;
    const b = moduleOf(l.vers) ?? l.vers;
    if (a !== b && g.hasNode(a) && g.hasNode(b)) g.setEdge(a, b);
  }

  dagre.layout(g);

  const topLeft = (id: string) => {
    const p = g.node(id);
    const s = size.get(id)!;
    return p ? { x: Math.round(p.x - s.w / 2), y: Math.round(p.y - s.h / 2) } : null;
  };

  // Index des membres au sein de leur calque replié (pour les empiler).
  const memberIdx = new Map<string, number>();
  for (const layer of scene.calques) {
    if (!collapsed.has(layer.id)) continue;
    scene.noeuds.filter((n) => n.calque === layer.id).forEach((n, i) => memberIdx.set(n.id, i));
  }

  return {
    ...scene,
    noeuds: scene.noeuds.map((n) => {
      if (n.calque && collapsed.has(n.calque)) {
        const m = topLeft(`module-${n.calque}`);
        if (!m) return n;
        const i = memberIdx.get(n.id) ?? 0;
        return { ...n, pos: [m.x, m.y + i * MEMBER_GAP] as [number, number] };
      }
      const tl = topLeft(n.id);
      return tl ? { ...n, pos: [tl.x, tl.y] as [number, number] } : n;
    }),
  };
}
