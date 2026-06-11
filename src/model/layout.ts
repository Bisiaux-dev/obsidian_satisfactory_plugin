/**
 * Left→right auto-layout (dagre) on the VISIBLE graph: a collapsed layer is
 * treated as ONE single block (module node), with its hidden members stacked at
 * the module's location (for a clean expand). Avoids overlaps, including
 * module ↔ neighboring nodes. Returns a Scene with updated `pos`.
 */
import dagre from "@dagrejs/dagre";
import type { Db, Scene } from "./types";
import { SINK } from "./types";
import { nodePorts } from "./ports";

const SIZE_RECIPE = { w: 210, h: 150 };
const SIZE_RAW = { w: 180, h: 80 };
const SIZE_SINK = { w: 150, h: 70 };
const SIZE_MODULE = { w: 210, h: 130 };
const MEMBER_GAP = 170; // vertical spacing of members stacked under a module

export function autoLayout(scene: Scene, db: Db): Scene {
  const collapsed = new Set(scene.calques.filter((c) => c.replie).map((c) => c.id));
  const moduleOf = (nodeId: string): string | null => {
    const n = scene.noeuds.find((x) => x.id === nodeId);
    return n && n.calque && collapsed.has(n.calque) ? `module-${n.calque}` : null;
  };

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 70, ranksep: 140, marginx: 30, marginy: 30 });

  // Visible nodes: nodes outside collapsed layers + one module per collapsed layer.
  const size = new Map<string, { w: number; h: number }>();
  for (const n of scene.noeuds) {
    if (n.calque && collapsed.has(n.calque)) continue; // hidden member
    const s =
      nodePorts(n, db, scene.liens).intrants.length === 0 && !db.recipes[n.recette]?.production
        ? SIZE_RAW
        : SIZE_RECIPE;
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

  // Edges (rerouted to modules; internal links ignored).
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

  // Index of members within their collapsed layer (used to stack them).
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
