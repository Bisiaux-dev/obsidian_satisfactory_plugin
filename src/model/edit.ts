/**
 * Mutations PURES de la scène (édition F7). Chaque fonction renvoie une nouvelle
 * Scene ; le write-back se charge de la réécrire dans le `.md`.
 */
import type { Db, Layer, Link, Node, Scene } from "./types";
import { SINK } from "./types";
import { nodePorts } from "./ports";

const LAYER_COLORS = ["#3b82f6", "#f59e0b", "#22c55e", "#ef4444", "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];

/** Premier identifiant de calque `cN` libre. */
function nextLayerId(scene: Scene): string {
  const ids = new Set(scene.calques.map((c) => c.id));
  let i = 1;
  while (ids.has(`c${i}`)) i++;
  return `c${i}`;
}

/** Alloue `n` identifiants de nœud `nN` libres (sans collision dans le lot). */
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

/** Crée un calque regroupant les nœuds sélectionnés. */
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

/** Replie / déplie un calque (vue module à ports agrégés). */
export function toggleLayerCollapsed(scene: Scene, layerId: string): Scene {
  return {
    ...scene,
    calques: scene.calques.map((c) => (c.id === layerId ? { ...c, replie: !c.replie } : c)),
  };
}

/** Met à jour les champs d'un calque (nom, icône, couleur…). */
export function updateLayer(scene: Scene, layerId: string, patch: Partial<Layer>): Scene {
  return {
    ...scene,
    calques: scene.calques.map((c) => (c.id === layerId ? { ...c, ...patch } : c)),
  };
}

/** Presse-papiers : nœuds + liens internes copiés. */
export interface Clipboard {
  nodes: Node[];
  liens: Link[];
}

/** Construit un presse-papiers depuis une sélection (liens internes seulement). */
export function copyNodes(scene: Scene, ids: string[]): Clipboard {
  const set = new Set(ids);
  return {
    nodes: scene.noeuds.filter((n) => set.has(n.id)).map((n) => ({ ...n })),
    liens: scene.liens.filter((l) => set.has(l.de) && set.has(l.vers)).map((l) => ({ ...l })),
  };
}

/** Colle un presse-papiers (nouveaux ids, position décalée). Renvoie les ids créés. */
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

/** Premier identifiant `nN` libre. */
export function nextNodeId(scene: Scene): string {
  const ids = new Set(scene.noeuds.map((n) => n.id));
  let i = 1;
  while (ids.has(`n${i}`)) i++;
  return `n${i}`;
}

/** Champs d'un nœud modifiables via l'éditeur. */
export type NodePatch = Partial<
  Pick<Node, "recette" | "machines" | "calque" | "machine" | "intrants" | "extrants">
>;

/** Met à jour les champs éditables d'un nœud. Une clé à `undefined` la retire. */
export function updateNode(scene: Scene, id: string, patch: NodePatch): Scene {
  return {
    ...scene,
    noeuds: scene.noeuds.map((n) => {
      if (n.id !== id) return n;
      const next = { ...n, ...patch };
      // Nettoie les surcharges mises à undefined (retour à la recette DB).
      if ("intrants" in patch && patch.intrants === undefined) delete next.intrants;
      if ("extrants" in patch && patch.extrants === undefined) delete next.extrants;
      if ("machine" in patch && patch.machine === undefined) delete next.machine;
      return next;
    }),
  };
}

/** Ajoute un nœud d'une recette donnée à la position indiquée. */
export function addNode(scene: Scene, recetteId: string, pos: [number, number]): Scene {
  const id = nextNodeId(scene);
  return {
    ...scene,
    noeuds: [...scene.noeuds, { id, recette: recetteId, machines: 1, pos }],
  };
}

/** Supprime des nœuds et tous les liens qui les touchent. */
export function removeNodes(scene: Scene, ids: Set<string>): Scene {
  return {
    ...scene,
    noeuds: scene.noeuds.filter((n) => !ids.has(n.id)),
    liens: scene.liens.filter((l) => !ids.has(l.de) && !ids.has(l.vers)),
  };
}

/** Clé d'identité d'un lien (pour suppression). */
export const linkKey = (de: string, vers: string, produit: string) => `${de}|${vers}|${produit}`;

/** Bascule le bout d'un lien : flèche normale ➤ ↔ boucle ♻ (réinjection). */
export function toggleLinkLoop(scene: Scene, de: string, vers: string, produit: string): Scene {
  return {
    ...scene,
    liens: scene.liens.map((l) =>
      l.de === de && l.vers === vers && l.produit === produit ? { ...l, boucle: !l.boucle } : l,
    ),
  };
}

/** Supprime les liens dont la clé figure dans `keys`. */
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

/** Résultat explicite d'une tentative de connexion (avec raison du refus). */
export type ConnectResult =
  | { ok: true; scene: Scene; produit: string; debit: number; vers: string }
  | { ok: false; reason: string };

/**
 * Crée un lien à partir d'une connexion souris. Ne crée QUE des liens valides :
 *  - vers le Sink → route le plus gros surplus / sous-produit orphelin (lève le blocage) ;
 *  - vers un nœud → uniquement un produit que la cible CONSOMME (pas de faux débouché).
 * Renvoie une raison lisible en cas de refus (affichée à l'utilisateur).
 */
export function connect(scene: Scene, db: Db, c: ConnectParams): ConnectResult {
  if (!c.source || !c.target || c.source === c.target) {
    return { ok: false, reason: "Invalid connection (a node cannot link to itself)." };
  }
  const src = scene.noeuds.find((n) => n.id === c.source);
  if (!src) return { ok: false, reason: "Source node not found." };
  const srcPorts = nodePorts(src, db);
  if (srcPorts.extrants.length === 0) {
    return { ok: false, reason: `${src.id} produces nothing to route.` };
  }

  const tgt = scene.noeuds.find((n) => n.id === c.target);
  const tgtName = c.target === SINK ? "the Sink" : (db.recipes[tgt?.recette ?? ""]?.nom ?? c.target);
  const tgtConsumes = new Set(tgt ? nodePorts(tgt, db).intrants.map((i) => i.item) : []);
  const toSink = c.target === SINK;
  const itemName = (id: string) => db.items[id]?.nom ?? id;

  // Le Sink n'accepte que les solides.
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
