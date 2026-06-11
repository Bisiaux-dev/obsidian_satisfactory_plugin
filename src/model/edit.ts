/**
 * PURE mutations of the scene (F7 editing). Each function returns a new
 * Scene; the write-back takes care of rewriting it into the `.md`.
 */
import type { Db, Layer, Link, LinkCap, Node, Scene } from "./types";
import { isCustomNode, SINK } from "./types";
import { nodePorts } from "./ports";

const LAYER_COLORS = ["#3b82f6", "#f59e0b", "#22c55e", "#ef4444", "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];

/** First free layer id `cN`. */
function nextLayerId(scene: Scene): string {
  const ids = new Set(scene.calques.map((c) => c.id));
  let i = 1;
  while (ids.has(`c${i}`)) i++;
  return `c${i}`;
}

/** Allocates `n` free node ids `nN` (no collisions within the batch). */
function allocNodeIds(scene: Scene, n: number): string[] {
  const ids = new Set(scene.noeuds.map((x) => x.id));
  const out: string[] = [];
  let i = 1;
  while (out.length < n) {
    const id = `n${i++}`;
    if (!ids.has(id)) { ids.add(id); out.push(id); }
  }
  return out;
}

/** Creates a layer grouping the selected nodes. */
export function createLayer(scene: Scene, ids: string[], opts: { nom?: string } = {}): Scene {
  if (ids.length === 0) return scene;
  const id = nextLayerId(scene);
  const idx = scene.calques.length;
  const layer: Layer = {
    id,
    nom: opts.nom ?? `Layer ${idx + 1}`,
    icone: "📦",
    couleur: LAYER_COLORS[idx % LAYER_COLORS.length],
  };
  const set = new Set(ids);
  return {
    ...scene,
    calques: [...scene.calques, layer],
    noeuds: scene.noeuds.map((n) => (set.has(n.id) ? { ...n, calque: id } : n)),
  };
}

/** Collapses / expands a layer (module view with aggregated ports). */
export function toggleLayerCollapsed(scene: Scene, layerId: string): Scene {
  return {
    ...scene,
    calques: scene.calques.map((c) => (c.id === layerId ? { ...c, replie: !c.replie } : c)),
  };
}

/** Updates a layer's fields (name, icon, color…). */
export function updateLayer(scene: Scene, layerId: string, patch: Partial<Layer>): Scene {
  return {
    ...scene,
    calques: scene.calques.map((c) => (c.id === layerId ? { ...c, ...patch } : c)),
  };
}

/** Clipboard: copied nodes + internal links. */
export interface Clipboard {
  nodes: Node[];
  liens: Link[];
}

/** Builds a clipboard from a selection (internal links only). */
export function copyNodes(scene: Scene, ids: string[]): Clipboard {
  const set = new Set(ids);
  return {
    nodes: scene.noeuds.filter((n) => set.has(n.id)).map((n) => ({ ...n })),
    liens: scene.liens.filter((l) => set.has(l.de) && set.has(l.vers)).map((l) => ({ ...l })),
  };
}

/** Pastes a clipboard (new ids, offset position). Returns the created ids. */
export function pasteInto(
  scene: Scene,
  clip: Clipboard,
  offset: [number, number] = [40, 40],
): { scene: Scene; newIds: string[] } {
  if (clip.nodes.length === 0) return { scene, newIds: [] };
  const newIds = allocNodeIds(scene, clip.nodes.length);
  const map = new Map(clip.nodes.map((nd, i) => [nd.id, newIds[i]]));
  const noeuds = clip.nodes.map((nd) => ({
    ...nd,
    id: map.get(nd.id)!,
    calque: undefined,
    pos: nd.pos ? ([nd.pos[0] + offset[0], nd.pos[1] + offset[1]] as [number, number]) : undefined,
  }));
  const liens = clip.liens.map((l) => ({ ...l, de: map.get(l.de)!, vers: map.get(l.vers)! }));
  return {
    scene: { ...scene, noeuds: [...scene.noeuds, ...noeuds], liens: [...scene.liens, ...liens] },
    newIds,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** First free node id `nN`. */
export function nextNodeId(scene: Scene): string {
  const ids = new Set(scene.noeuds.map((n) => n.id));
  let i = 1;
  while (ids.has(`n${i}`)) i++;
  return `n${i}`;
}

/** Node fields editable through the editor. */
export type NodePatch = Partial<
  Pick<Node, "recette" | "machines" | "clock" | "sloops" | "calque" | "machine" | "intrants" | "extrants">
>;

/** Updates a node's editable fields. A key set to `undefined` removes it. */
export function updateNode(scene: Scene, id: string, patch: NodePatch): Scene {
  return {
    ...scene,
    noeuds: scene.noeuds.map((n) => {
      if (n.id !== id) return n;
      const next = { ...n, ...patch };
      // Clean up overrides set to undefined (revert to the DB recipe).
      if ("intrants" in patch && patch.intrants === undefined) delete next.intrants;
      if ("extrants" in patch && patch.extrants === undefined) delete next.extrants;
      if ("machine" in patch && patch.machine === undefined) delete next.machine;
      return next;
    }),
  };
}

/** Adds a node for a given recipe at the given position. */
export function addNode(scene: Scene, recetteId: string, pos: [number, number]): Scene {
  const id = nextNodeId(scene);
  return {
    ...scene,
    noeuds: [...scene.noeuds, { id, recette: recetteId, machines: 1, pos }],
  };
}

/** Adds a resource extractor (custom source node) at the given position. */
export function addExtractor(
  scene: Scene,
  machine: string,
  item: string,
  debit: number,
  pos: [number, number],
): Scene {
  const ids = new Set(scene.noeuds.map((x) => x.id));
  let id = `src-${item}`;
  let i = 2;
  while (ids.has(id)) id = `src-${item}-${i++}`;
  return {
    ...scene,
    noeuds: [...scene.noeuds, { id, recette: "", machines: 1, pos, machine, intrants: [], extrants: [{ item, debit }] }],
  };
}

/** Removes nodes and every link touching them. */
export function removeNodes(scene: Scene, ids: Set<string>): Scene {
  return {
    ...scene,
    noeuds: scene.noeuds.filter((n) => !ids.has(n.id)),
    liens: scene.liens.filter((l) => !ids.has(l.de) && !ids.has(l.vers)),
  };
}

/** Identity key of a link (used for deletion). */
export const linkKey = (de: string, vers: string, produit: string) => `${de}|${vers}|${produit}`;

/** Cycle order of a link's end marker. */
const CAP_CYCLE: Record<LinkCap, LinkCap> = { rien: "fleche", fleche: "boucle", boucle: "rien" };

/** Sets a link's end marker (arrow / loop / none); keeps `boucle` in sync. */
export function setLinkCap(scene: Scene, de: string, vers: string, produit: string, cap: LinkCap): Scene {
  return {
    ...scene,
    liens: scene.liens.map((l) =>
      l.de === de && l.vers === vers && l.produit === produit ? { ...l, cap, boucle: cap === "boucle" } : l,
    ),
  };
}

/** Cycles a link's end marker: arrow ➤ → loop ♻ → none. */
export function cycleLinkCap(scene: Scene, de: string, vers: string, produit: string): Scene {
  const cur = scene.liens.find((l) => l.de === de && l.vers === vers && l.produit === produit);
  if (!cur) return scene;
  const next = CAP_CYCLE[cur.cap ?? (cur.boucle ? "boucle" : "fleche")] ?? "fleche";
  return setLinkCap(scene, de, vers, produit, next);
}

/** Sets a link's routed rate (drives the diagnostic, not just the label). */
export function setLinkRate(scene: Scene, de: string, vers: string, produit: string, debit: number): Scene {
  const d = Math.max(0, round(Number(debit) || 0));
  return {
    ...scene,
    liens: scene.liens.map((l) =>
      l.de === de && l.vers === vers && l.produit === produit ? { ...l, debit: d } : l,
    ),
  };
}

/** Removes the links whose key is in `keys`. */
export function removeLinks(scene: Scene, keys: Set<string>): Scene {
  return {
    ...scene,
    liens: scene.liens.filter((l) => !keys.has(linkKey(l.de, l.vers, l.produit))),
  };
}

export interface ConnectParams {
  source: string | null;
  target: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** Explicit result of a connection attempt (with the refusal reason). */
export type ConnectResult =
  | { ok: true; scene: Scene; produit: string; debit: number; vers: string }
  | { ok: false; reason: string };

/**
 * Creates a link from a mouse connection. ONLY creates valid links:
 *  - to the Sink → routes the largest surplus / orphan by-product (clears the blockage);
 *  - to a node → only a product the target CONSUMES (no fake outlet).
 * Returns a human-readable reason on refusal (shown to the user).
 */
export function connect(scene: Scene, db: Db, c: ConnectParams): ConnectResult {
  if (!c.source || !c.target || c.source === c.target) {
    return { ok: false, reason: "Invalid connection (a node cannot link to itself)." };
  }
  const src = scene.noeuds.find((n) => n.id === c.source);
  if (!src) return { ok: false, reason: "Source node not found." };
  const srcPorts = nodePorts(src, db, scene.liens);
  if (srcPorts.extrants.length === 0) {
    return { ok: false, reason: `${src.id} produces nothing to route.` };
  }

  const tgt = scene.noeuds.find((n) => n.id === c.target);
  const tgtName = c.target === SINK ? "the Sink" : (db.recipes[tgt?.recette ?? ""]?.nom ?? c.target);
  const tgtConsumes = new Set(tgt ? nodePorts(tgt, db, scene.liens).intrants.map((i) => i.item) : []);
  // A generator also accepts any of its alternative fuels (not just the active one).
  const tgtFuels = tgt && !isCustomNode(tgt) ? db.recipes[tgt.recette]?.fuels : undefined;
  if (tgtFuels) for (const f of tgtFuels) tgtConsumes.add(f.item);
  const toSink = c.target === SINK;
  const itemName = (id: string) => db.items[id]?.nom ?? id;

  // The Sink only accepts solids.
  const isFluid = (item: string) => db.items[item]?.etat === "fluide";

  const candidates = srcPorts.extrants
    .map((ex) => {
      const produced = ex.debit;
      const routed = scene.liens
        .filter((l) => l.de === src.id && l.produit === ex.item)
        .reduce((s, l) => s + l.debit, 0);
      return { item: ex.item, remaining: produced - routed, produced };
    })
    .filter((k) => (toSink ? !isFluid(k.item) : tgtConsumes.has(k.item)));

  if (candidates.length === 0) {
    if (toSink && srcPorts.extrants.some((e) => isFluid(e.item))) {
      return { ok: false, reason: "The Sink does not accept fluids/gases (solids only)." };
    }
    const prods = srcPorts.extrants.map((e) => itemName(e.item)).join(", ");
    return {
      ok: false,
      reason: `${tgtName} does not consume any product of this node (${prods}). No valid outlet.`,
    };
  }

  const chosen =
    candidates.filter((k) => k.remaining > 0.01).sort((a, b) => b.remaining - a.remaining)[0] ||
    candidates.sort((a, b) => b.remaining - a.remaining)[0];

  const produit = chosen.item;
  if (scene.liens.some((l) => l.de === c.source && l.vers === c.target && l.produit === produit)) {
    return { ok: false, reason: `Link already exists: ${itemName(produit)} → ${tgtName}.` };
  }

  const debit = chosen.remaining > 0.01 ? round(chosen.remaining) : chosen.produced;
  return {
    ok: true,
    produit,
    debit,
    vers: c.target,
    scene: { ...scene, liens: [...scene.liens, { de: c.source, vers: c.target, produit, debit }] },
  };
}
