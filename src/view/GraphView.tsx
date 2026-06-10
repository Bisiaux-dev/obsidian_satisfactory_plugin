import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  ConnectionMode,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import type {
  Connection,
  Edge,
  Node as RFNode,
  NodeProps,
  ReactFlowInstance,
  Viewport,
} from "@xyflow/react";
import type { Db, Diagnostic, Scene } from "../model/types";
import { SINK } from "../model/types";
import {
  addNode,
  connect,
  copyNodes,
  createLayer,
  linkKey,
  nextNodeId,
  pasteInto,
  removeLinks,
  removeNodes,
  toggleLayerCollapsed,
  toggleLinkLoop,
  updateLayer,
  updateNode,
} from "../model/edit";
import type { Clipboard, NodePatch } from "../model/edit";
import type { Node as SfyNode } from "../model/types";
import { nodePorts, layerAggregatePorts } from "../model/ports";
import { ICONS, ICON_COLORS } from "../model/game-icons";
import { autoLayout } from "../model/layout";
import { RecipeNode } from "./RecipeNode";
import { RawNode } from "./RawNode";
import { GroupNode } from "./GroupNode";
import { ModuleNode } from "./ModuleNode";
import { FlowEdge } from "./FlowEdge";
import { NodeEditor } from "./NodeEditor";
import { Optimizer } from "./Optimizer";
import { NotePicker, RecipePicker } from "./RecipePicker";
import { EditContext, LayerContext, LinkContext, SettingsContext } from "./inline";
import {
  Archive,
  BoxSelect,
  CircleHelp,
  ClipboardPaste,
  Copy,
  FileInput,
  Group,
  Keyboard,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Repeat2,
  Target,
  Trash2,
  Undo2,
  Wand2,
  X,
} from "lucide-react";

// Gabarit estimé d'un nœud (fallback si dimensions pas encore mesurées) + marges du calque.
const NODE_W = 210;
const NODE_H = 150;
const GROUP_PAD = 22;
const GROUP_HEAD = 30;

/** Nœud représentant l'AWESOME Sink (débouché terminal d'un surplus). */
function SinkNode() {
  return (
    <div className="sfy-node sfy-goal">
      <div className="sfy-title"><Archive size={15} /> AWESOME Sink</div>
      <div className="sfy-line">outlet</div>
      <Handle type="target" position={Position.Left} id="l" />
      <Handle type="target" position={Position.Bottom} id="bt" />
    </div>
  );
}

const NODE_TYPES = {
  recipe: RecipeNode,
  raw: RawNode,
  sink: SinkNode as React.FC<NodeProps>,
  calque: GroupNode,
  module: ModuleNode,
};
const EDGE_TYPES = { flow: FlowEdge };

/**
 * Viewport (caméra) persisté PAR NOTE, au niveau module — survit aux remontages
 * provoqués par le write-back (chaque écriture `.md` re-rend le bloc). On restaure
 * la caméra au lieu de refaire `fitView` → plus de saut/clignotement à chaque
 * changement. Le module du plugin reste chargé tant qu'Obsidian tourne.
 */
const viewportStore = new Map<string, Viewport>();

interface Props {
  scene: Scene;
  db: Db;
  diagnostic: Diagnostic;
  /** Chemin de la note — clé de persistance de la caméra. */
  sourcePath?: string;
  /** Incrémenté par le plugin sur édition EXTERNE du `.md` → re-synchronise
   * l'état React Flow (la racine étant persistante, il n'y a pas de remontage). */
  syncToken?: number;
  /** Appelé au drop d'un nœud avec la scène mise à jour (write-back). */
  onSceneChange?: (scene: Scene) => void;
  /** Notification utilisateur (succès/refus de connexion…). */
  onNotice?: (message: string) => void;
  /** Réglage : forcer des machines entières à l'édition. */
  wholeMachines?: boolean;
  /** Liste (async) des notes du vault importables (contenant un bloc satisfactory). */
  listImportNotes?: () => Promise<string[]>;
}

/** Renvoie une copie de la scène avec la position d'un nœud mise à jour. */
function withNodePosition(scene: Scene, id: string, x: number, y: number): Scene {
  return {
    ...scene,
    noeuds: scene.noeuds.map((n) =>
      n.id === id ? { ...n, pos: [Math.round(x), Math.round(y)] as [number, number] } : n,
    ),
  };
}

/**
 * Nœuds métier : positions ABSOLUES, librement déplaçables (comme la maquette).
 * Les calques ne sont PAS des parents ici — ils sont dérivés des positions live
 * (cf. {@link computeGroupNodes}), donc le déplacement des nœuds n'est pas contraint.
 */
function buildBusinessNodes(scene: Scene, db: Db, diag: Diagnostic, wholeMachines = false): RFNode[] {
  const nodes: RFNode[] = [];
  let maxX = 0;

  // Calques repliés : leurs membres sont masqués et remplacés par un nœud module.
  const collapsed = new Set(scene.calques.filter((c) => c.replie).map((c) => c.id));
  const memberPos = new Map<string, { x: number; y: number }[]>();

  scene.noeuds.forEach((node, i) => {
    const recipe = db.recipes[node.recette];
    const ports = nodePorts(node, db);
    const pos = node.pos ?? [40 + i * 240, 40 + (i % 3) * 170];
    maxX = Math.max(maxX, pos[0]);
    const issues = diag.issues.filter((x) => x.nodeId === node.id).map((x) => x.message);
    const status = diag.status[node.id] ?? "ok";

    // Membre d'un calque replié → masqué (mémorise sa position pour le module).
    if (node.calque && collapsed.has(node.calque)) {
      const arr = memberPos.get(node.calque) ?? [];
      arr.push({ x: pos[0], y: pos[1] });
      memberPos.set(node.calque, arr);
      return;
    }

    // Nœud ressource brute : aucun intrant.
    if (ports.intrants.length === 0) {
      const out = ports.extrants[0];
      const item = db.items[out?.item];
      nodes.push({
        id: node.id,
        type: "raw",
        position: { x: pos[0], y: pos[1] },
        data: {
          icone: item?.icone,
          iconUrl: out ? ICONS[out.item] : undefined,
          nom: item?.nom ?? out?.item ?? node.recette,
          machine: ports.machine,
          debit: out?.debit ?? 0,
          status,
          issues,
          extrants: ports.extrants,
          isImport: !!node.import,
        },
      });
      return;
    }

    const principal = ports.extrants[0];
    const item = principal ? db.items[principal.item] : undefined;
    nodes.push({
      id: node.id,
      type: "recipe",
      position: { x: pos[0], y: pos[1] },
      data: {
        icone: item?.icone,
        iconUrl: principal ? ICONS[principal.item] : undefined,
        produit: item?.nom ?? principal?.item ?? node.recette,
        recette: recipe?.nom ?? node.recette,
        alternative: recipe?.alternative,
        machine: ports.machine,
        machines: node.machines,
        debit: principal?.debit ?? 0,
        status,
        badge: status,
        issues,
        intrants: ports.intrants,
        extrants: ports.extrants,
        wholeMachines,
      },
    });
  });

  // Nœud module pour chaque calque replié (positionné au coin haut-gauche des membres).
  for (const layer of scene.calques) {
    if (!collapsed.has(layer.id)) continue;
    const ps = memberPos.get(layer.id);
    if (!ps || ps.length === 0) continue;
    const agg = layerAggregatePorts(scene, layer.id);
    nodes.push({
      id: `module-${layer.id}`,
      type: "module",
      position: { x: Math.min(...ps.map((p) => p.x)), y: Math.min(...ps.map((p) => p.y)) },
      deletable: false,
      zIndex: 10, // au-dessus des autres nœuds (le module est opaque → pas de superposition visuelle)
      data: {
        layerId: layer.id,
        nom: layer.nom,
        icone: layer.icone,
        couleur: layer.couleur,
        intrants: agg.intrants,
        extrants: agg.extrants,
        count: ps.length,
      },
    });
  }

  // Sink présent dès qu'il y a des nœuds (cible de routage d'un surplus / sous-produit).
  if (scene.noeuds.length > 0) {
    nodes.push({
      id: SINK,
      type: "sink",
      position: { x: maxX + 300, y: 60 },
      deletable: false,
      data: {},
    });
  }

  return nodes;
}

/**
 * Boîtes de calque DÉRIVÉES des positions live des nœuds membres — recalculées à
 * chaque changement (= le `redraw()` de la maquette). Non déplaçables ni
 * sélectionnables : on déplace les NŒUDS, la boîte suit. Placées en tête du
 * tableau pour rendre derrière les nœuds.
 */
function computeGroupNodes(scene: Scene, liveNodes: RFNode[]): RFNode[] {
  const byId = new Map(liveNodes.map((n) => [n.id, n]));
  const groups: RFNode[] = [];

  for (const layer of scene.calques) {
    if (layer.replie) continue; // calque replié → rendu par un nœud module, pas une boîte
    const members = scene.noeuds
      .filter((n) => n.calque === layer.id)
      .map((n) => byId.get(n.id))
      .filter((n): n is RFNode => !!n);
    if (members.length === 0) continue;

    const minX = Math.min(...members.map((m) => m.position.x));
    const minY = Math.min(...members.map((m) => m.position.y));
    const maxX = Math.max(...members.map((m) => m.position.x + (m.measured?.width ?? NODE_W)));
    const maxY = Math.max(...members.map((m) => m.position.y + (m.measured?.height ?? NODE_H)));

    groups.push({
      id: `calque-${layer.id}`,
      type: "calque",
      position: { x: minX - GROUP_PAD, y: minY - GROUP_HEAD },
      width: maxX - minX + 2 * GROUP_PAD,
      height: maxY - minY + GROUP_PAD + GROUP_HEAD,
      selectable: false,
      draggable: false,
      focusable: false,
      deletable: false,
      data: { layerId: layer.id, nom: layer.nom, icone: layer.icone, couleur: layer.couleur },
    });
  }

  return groups;
}

function buildEdges(scene: Scene, db: Db): Edge[] {
  // membre d'un calque replié → son arête est reroutée vers le nœud module.
  const collapsedOf = new Map<string, string>();
  for (const layer of scene.calques) {
    if (!layer.replie) continue;
    for (const n of scene.noeuds) if (n.calque === layer.id) collapsedOf.set(n.id, `module-${layer.id}`);
  }

  const edges: Edge[] = [];
  // Compteur de flèches parallèles (même source→cible) pour décaler leurs étiquettes.
  const pairCount = new Map<string, number>();

  scene.liens.forEach((link, i) => {
    const source = collapsedOf.get(link.de) ?? link.de;
    const target = collapsedOf.get(link.vers) ?? link.vers;
    if (source === target) return; // lien interne à un calque replié → masqué

    const item = db.items[link.produit];
    // Couleur du produit : teinte vive dérivée de l'icône (ICON_COLORS) en priorité,
    // sinon couleur de la DB, sinon gris neutre.
    const color = ICON_COLORS[link.produit] ?? item?.couleur ?? "#9ca3af";
    const rerouted = source !== link.de || target !== link.vers;
    const pairKey = `${source}->${target}`;
    const labelIndex = pairCount.get(pairKey) ?? 0;
    pairCount.set(pairKey, labelIndex + 1);

    edges.push({
      id: `e${i}-${link.de}-${link.vers}`,
      source,
      target,
      sourceHandle: rerouted ? "r" : link.boucle ? "b" : "r",
      targetHandle: rerouted ? "l" : link.boucle ? "bt" : "l",
      type: "flow",
      data: {
        color,
        fluid: item?.etat === "fluide",
        label: item?.nom ?? link.produit,
        debit: `${link.debit}/min`,
        boucle: rerouted ? false : link.boucle,
        de: link.de,
        vers: link.vers,
        produit: link.produit,
        pairKey,
        labelIndex,
      },
    });
  });
  // Renseigne le nombre total de parallèles par paire (pour centrer le décalage).
  for (const e of edges) {
    const d = e.data as { pairKey: string; labelCount?: number };
    d.labelCount = pairCount.get(d.pairKey) ?? 1;
  }
  return edges;
}

function Graph({ scene, db, diagnostic, sourcePath, syncToken, onSceneChange, onNotice, wholeMachines = false, listImportNotes }: Props) {
  const initialNodes = useMemo(() => buildBusinessNodes(scene, db, diagnostic, wholeMachines), [scene, db, diagnostic, wholeMachines]);
  const initialEdges = useMemo(() => buildEdges(scene, db), [scene, db]);

  // --- Persistance de la caméra entre remontages (anti-flicker / anti-reset) ---
  const camKey = sourcePath || "default";
  const savedViewport = viewportStore.get(camKey);
  const instRef = useRef<ReactFlowInstance | null>(null);
  const persistViewport = useCallback(() => {
    if (instRef.current) viewportStore.set(camKey, instRef.current.getViewport());
  }, [camKey]);
  // Historique pour annuler/refaire (Ctrl+Z). La source de vérité reste le `.md` ;
  // on empile les scènes précédentes (refs → survivent aux re-rendus sans remontage).
  const undoStack = useRef<Scene[]>([]);
  const redoStack = useRef<Scene[]>([]);
  const restore = useCallback(
    (s: Scene) => {
      persistViewport();
      onSceneChange?.(s);
    },
    [persistViewport, onSceneChange],
  );
  // Mutation + write-back : empile l'état courant pour l'annulation.
  const commit = useCallback(
    (next: Scene) => {
      undoStack.current.push(scene);
      redoStack.current = [];
      restore(next);
    },
    [scene, restore],
  );
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(scene);
    restore(prev);
  }, [scene, restore]);
  const redo = useCallback(() => {
    const nxt = redoStack.current.pop();
    if (!nxt) return;
    undoStack.current.push(scene);
    restore(nxt);
  }, [scene, restore]);
  const onInit = useCallback(
    (inst: ReactFlowInstance) => {
      instRef.current = inst;
      if (savedViewport) inst.setViewport(savedViewport);
    },
    [savedViewport],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Re-synchronise depuis le `.md` UNIQUEMENT sur édition externe (syncToken
  // bumpé par le plugin). On saute le 1er montage (useNodesState a déjà semé)
  // et nos propres write-backs (qui ne bumpent pas syncToken).
  const firstSync = useRef(true);
  const selectedRef = useRef<string[]>([]);
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    // Reconstruit en PRÉSERVANT la sélection (sinon le panneau d'édition se ferme
    // après chaque write-back, la reconstruction effaçant l'état `selected`).
    const sel = new Set(selectedRef.current);
    setNodes(buildBusinessNodes(scene, db, diagnostic, wholeMachines).map((n) => (sel.has(n.id) ? { ...n, selected: true } : n)));
    setEdges(buildEdges(scene, db));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncToken]);

  // Calques recalculés à chaque rendu depuis les positions live → la boîte suit les nœuds.
  const groupNodes = useMemo(() => computeGroupNodes(scene, nodes), [scene, nodes]);
  const allNodes = useMemo(() => [...groupNodes, ...nodes], [groupNodes, nodes]);

  // Write-back au DROP uniquement (pas à chaque pixel), cf. cahier des charges.
  const onNodeDragStop = useCallback(
    (_e: MouseEvent | TouchEvent, node: RFNode) => {
      if (!onSceneChange) return;

      // Déplacer un calque replié (nœud module) → décale tous ses membres.
      if (node.id.startsWith("module-")) {
        const layerId = node.id.slice("module-".length);
        const members = scene.noeuds.filter((n) => n.calque === layerId && n.pos);
        if (members.length === 0) return;
        const minX = Math.min(...members.map((n) => n.pos![0]));
        const minY = Math.min(...members.map((n) => n.pos![1]));
        const dx = Math.round(node.position.x) - minX;
        const dy = Math.round(node.position.y) - minY;
        if (dx === 0 && dy === 0) return;
        commit({
          ...scene,
          noeuds: scene.noeuds.map((n) =>
            n.calque === layerId && n.pos
              ? { ...n, pos: [n.pos[0] + dx, n.pos[1] + dy] as [number, number] }
              : n,
          ),
        });
        return;
      }

      const target = scene.noeuds.find((n) => n.id === node.id);
      if (!target) return; // nœud synthétique (calque, Sink) → pas dans la scène
      const nx = Math.round(node.position.x);
      const ny = Math.round(node.position.y);
      if (target.pos && target.pos[0] === nx && target.pos[1] === ny) return; // pas bougé
      commit(withNodePosition(scene, node.id, nx, ny));
    },
    [scene, onSceneChange, commit],
  );

  // Relier deux nœuds → nouveau lien (produit choisi automatiquement).
  // Feedback explicite : succès = quoi a été routé, refus = pourquoi.
  const onConnect = useCallback(
    (c: Connection) => {
      if (!onSceneChange) return;
      const res = connect(scene, db, c);
      if (res.ok) {
        commit(res.scene);
        const item = db.items[res.produit]?.nom ?? res.produit;
        const dest = res.vers === SINK ? "Sink" : res.vers;
        onNotice?.(`Link created: ${item} ${res.debit}/min → ${dest}`);
      } else {
        onNotice?.(res.reason);
      }
    },
    [scene, db, onSceneChange, commit, onNotice],
  );

  // Suppression (Suppr) : UN SEUL handler pour nœuds + liens → un seul write-back
  // (évite la course entre onNodesDelete et onEdgesDelete sur une scène figée).
  const onDelete = useCallback(
    ({ nodes: dn, edges: de }: { nodes: RFNode[]; edges: Edge[] }) => {
      if (!onSceneChange) return;
      let next = scene;
      const ids = new Set(dn.map((n) => n.id).filter((id) => id !== SINK));
      if (ids.size > 0) next = removeNodes(next, ids);
      const keys = new Set(
        de.map((e) => {
          const d = e.data as { de: string; vers: string; produit: string };
          return linkKey(d.de, d.vers, d.produit);
        }),
      );
      if (keys.size > 0) next = removeLinks(next, keys);
      if (next !== scene) commit(next);
    },
    [scene, onSceneChange, commit],
  );

  // --- Picker de recettes (3 contextes d'ouverture) ---
  //  - 'add'     : bouton « + Nœud » → nouveau nœud placé sous les autres ;
  //  - 'ctx-add' : clic droit sur le fond → nouveau nœud À CET ENDROIT ;
  //  - 'connect' : connexion lâchée dans le vide → recettes CONSOMMANT un produit
  //                du nœud source, nœud créé au point de drop + lien auto.
  type PickerState =
    | { mode: "add" }
    | { mode: "ctx-add"; flowPos: [number, number]; panelPos: [number, number] }
    | { mode: "connect"; sourceId: string; items: string[]; flowPos: [number, number]; panelPos: [number, number] };
  const [picker, setPicker] = useState<PickerState | null>(null);

  const onPickRecipe = useCallback(
    (recipeId: string) => {
      if (!onSceneChange || !picker) return;
      setPicker(null);
      if (picker.mode === "connect") {
        // Crée le nœud au point de drop puis route automatiquement le produit
        // (connect() choisit l'item que la nouvelle recette consomme).
        const id = nextNodeId(scene);
        const withNode: Scene = {
          ...scene,
          noeuds: [...scene.noeuds, { id, recette: recipeId, machines: 1, pos: picker.flowPos }],
        };
        const res = connect(withNode, db, { source: picker.sourceId, target: id });
        if (res.ok) {
          commit(res.scene);
          const item = db.items[res.produit]?.nom ?? res.produit;
          onNotice?.(`Node created and linked: ${item} ${res.debit}/min.`);
        } else {
          commit(withNode);
          onNotice?.(res.reason);
        }
        return;
      }
      const pos: [number, number] =
        picker.mode === "ctx-add"
          ? picker.flowPos
          : [40, scene.noeuds.reduce((m, n) => Math.max(m, n.pos?.[1] ?? 0), 0) + 190];
      commit(addNode(scene, recipeId, pos));
    },
    [scene, db, picker, onSceneChange, commit, onNotice],
  );

  // --- Import d'une autre note (usine) : sélecteur de notes du vault ---
  // null = fermé ; sinon position optionnelle (clic droit) + liste chargée async.
  const [importPicker, setImportPicker] = useState<{ flowPos?: [number, number]; panelPos?: [number, number] } | null>(null);
  const [importNotes, setImportNotes] = useState<string[] | null>(null);
  const openImportPicker = useCallback(
    (at?: { flowPos: [number, number]; panelPos: [number, number] }) => {
      if (!listImportNotes) return;
      setPicker(null);
      setImportNotes(null);
      setImportPicker(at ?? {});
      void listImportNotes().then(setImportNotes).catch(() => setImportNotes([]));
    },
    [listImportNotes],
  );
  const onPickImportNote = useCallback(
    (basename: string) => {
      if (!onSceneChange || !importPicker) return;
      const pos: [number, number] =
        importPicker.flowPos ?? [40, scene.noeuds.reduce((m, n) => Math.max(m, n.pos?.[1] ?? 0), 0) + 190];
      setImportPicker(null);
      commit({
        ...scene,
        noeuds: [...scene.noeuds, { id: nextNodeId(scene), recette: "", machines: 1, pos, import: basename }],
      });
      onNotice?.(`Production of "${basename}" imported (auto-synced).`);
    },
    [scene, importPicker, onSceneChange, commit, onNotice],
  );

  // Connexion lâchée dans le vide → picker filtré sur les consommateurs.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: { isValid: boolean | null; fromNode: { id: string } | null }) => {
      if (!onSceneChange || state.isValid || !state.fromNode) return;
      const src = scene.noeuds.find((n) => n.id === state.fromNode!.id);
      if (!src) return; // Sink / module / calque : pas de création depuis eux
      const outputs = nodePorts(src, db).extrants.map((p) => p.item);
      if (outputs.length === 0) return;
      const pt = "clientX" in event ? event : (event as TouchEvent).changedTouches[0];
      const fp = instRef.current?.screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
      if (!fp) return;
      const r = wrapperRef.current?.getBoundingClientRect();
      setPicker({
        mode: "connect",
        sourceId: src.id,
        items: outputs,
        flowPos: [Math.round(fp.x), Math.round(fp.y)],
        panelPos: [pt.clientX - (r?.left ?? 0), pt.clientY - (r?.top ?? 0)],
      });
    },
    [scene, db, onSceneChange],
  );

  // Auto-layout gauche→droite (dagre) → espace tout proprement.
  const onTidy = useCallback(() => {
    if (!onSceneChange) return;
    commit(autoLayout(scene, db));
    onNotice?.("Graph tidied.");
  }, [scene, db, onSceneChange, commit, onNotice]);

  // --- Menu contextuel (clic droit : fond / nœud / lien) ---
  // Coordonnées RELATIVES au conteneur du graphe (le menu y est positionné en absolu).
  type CtxState =
    | { kind: "pane"; x: number; y: number; flowPos: [number, number] }
    | { kind: "node"; x: number; y: number; id: string }
    | { kind: "edge"; x: number; y: number; de: string; vers: string; produit: string };
  const [ctx, setCtx] = useState<CtxState | null>(null);

  const ctxPos = useCallback((e: React.MouseEvent | MouseEvent) => {
    const r = wrapperRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  }, []);

  const onPaneContextMenu = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      e.preventDefault();
      const fp = instRef.current?.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setCtx({ kind: "pane", ...ctxPos(e), flowPos: fp ? [Math.round(fp.x), Math.round(fp.y)] : [40, 40] });
    },
    [ctxPos],
  );
  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: RFNode) => {
      e.preventDefault();
      // Menu seulement pour les nœuds de la scène (pas Sink / module / boîte de calque).
      if (!scene.noeuds.some((n) => n.id === node.id)) return;
      setCtx({ kind: "node", ...ctxPos(e), id: node.id });
    },
    [scene, ctxPos],
  );
  const onEdgeContextMenu = useCallback(
    (e: React.MouseEvent, edge: Edge) => {
      e.preventDefault();
      const d = edge.data as { de?: string; vers?: string; produit?: string };
      if (!d.de || !d.vers || !d.produit) return;
      setCtx({ kind: "edge", ...ctxPos(e), de: d.de, vers: d.vers, produit: d.produit });
    },
    [ctxPos],
  );
  // Fermeture du menu : clic n'importe où.
  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [ctx]);

  // --- Sélection multiple (Shift+glisser = boîte, Shift/Ctrl+clic = ajouter) ---
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const onSelectionChange = useCallback(
    ({ nodes: sel }: { nodes: RFNode[] }) => {
      const ids = sel.map((n) => n.id);
      selectedRef.current = ids;
      setSelectedIds(ids);
    },
    [],
  );
  const sceneSelected = selectedIds.filter((id) => scene.noeuds.some((n) => n.id === id));

  // Panneau d'édition : ouvert SEULEMENT au double-clic sur un nœud (pas au simple
  // clic, qui ne fait que sélectionner). Le double-clic sur une valeur (Inline)
  // ne remonte pas jusqu'ici (stopPropagation) → édition inline sans ouvrir le panneau.
  const [editorNodeId, setEditorNodeId] = useState<string | null>(null);
  const onNodeDoubleClick = useCallback(
    (_e: React.MouseEvent, node: RFNode) => {
      setEditorNodeId(scene.noeuds.some((n) => n.id === node.id) ? node.id : null);
    },
    [scene],
  );
  const editorNode: SfyNode | undefined = scene.noeuds.find((n) => n.id === editorNodeId);
  const onEditNode = useCallback(
    (patch: NodePatch) => {
      if (editorNodeId) commit(updateNode(scene, editorNodeId, patch));
    },
    [scene, editorNodeId, commit],
  );
  // Édition inline (double-clic sur une info du nœud) → mutation par id.
  const editById = useCallback(
    (id: string, patch: NodePatch) => commit(updateNode(scene, id, patch)),
    [scene, commit],
  );
  // Double-clic sur une flèche → bascule son bout (➤ ↔ ♻ boucle).
  const toggleLink = useCallback(
    (de: string, vers: string, produit: string) => commit(toggleLinkLoop(scene, de, vers, produit)),
    [scene, commit],
  );
  // Actions calque : replier/déplier + renommer (état d'édition du nom porté ici,
  // stable — le nœud-calque étant recalculé à chaque rendu).
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const layerActions = useMemo(
    () => ({
      toggle: (layerId: string) => commit(toggleLayerCollapsed(scene, layerId)),
      beginRename: (layerId: string) => setEditingLayerId(layerId),
      applyRename: (layerId: string, nom: string) => {
        setEditingLayerId(null);
        const current = scene.calques.find((c) => c.id === layerId)?.nom;
        if (nom && nom !== current) commit(updateLayer(scene, layerId, { nom }));
      },
      editingId: editingLayerId,
    }),
    [scene, commit, editingLayerId],
  );

  // --- Calque depuis la sélection / copier / coller ---
  const clipboard = useRef<Clipboard | null>(null);
  const onGroup = useCallback(() => {
    if (sceneSelected.length === 0) {
      onNotice?.("Select nodes (Shift+drag) to create a layer.");
      return;
    }
    commit(createLayer(scene, sceneSelected));
    onNotice?.(`Layer created (${sceneSelected.length} nodes).`);
  }, [scene, sceneSelected, commit, onNotice]);

  const onCopy = useCallback(() => {
    if (sceneSelected.length === 0) return;
    clipboard.current = copyNodes(scene, sceneSelected);
    onNotice?.(`${sceneSelected.length} node(s) copied.`);
  }, [scene, sceneSelected, onNotice]);

  const onPaste = useCallback(() => {
    if (!clipboard.current || clipboard.current.nodes.length === 0) return;
    const { scene: next, newIds } = pasteInto(scene, clipboard.current);
    commit(next);
    onNotice?.(`${newIds.length} node(s) pasted.`);
  }, [scene, commit, onNotice]);

  // Coller À UN ENDROIT (clic droit) : décale le presse-papiers pour que son coin
  // haut-gauche tombe au point cliqué.
  const onPasteAt = useCallback(
    (flowPos: [number, number]) => {
      const clip = clipboard.current;
      if (!clip || clip.nodes.length === 0) return;
      const xs = clip.nodes.map((n) => n.pos?.[0] ?? 0);
      const ys = clip.nodes.map((n) => n.pos?.[1] ?? 0);
      const { scene: next, newIds } = pasteInto(scene, clip, [
        flowPos[0] - Math.min(...xs),
        flowPos[1] - Math.min(...ys),
      ]);
      commit(next);
      onNotice?.(`${newIds.length} node(s) pasted.`);
    },
    [scene, commit, onNotice],
  );

  // Dupliquer un nœud (clic droit) : copie + colle à côté.
  const onDuplicate = useCallback(
    (id: string) => {
      const { scene: next } = pasteInto(scene, copyNodes(scene, [id]), [40, 40]);
      commit(next);
    },
    [scene, commit],
  );

  // Router le surplus d'un nœud vers le Sink (réutilise la validation de connect()).
  const onRouteToSink = useCallback(
    (id: string) => {
      const res = connect(scene, db, { source: id, target: SINK });
      if (res.ok) {
        commit(res.scene);
        onNotice?.(`${db.items[res.produit]?.nom ?? res.produit} ${res.debit}/min → Sink.`);
      } else onNotice?.(res.reason);
    },
    [scene, db, commit, onNotice],
  );

  // Tout sélectionner (Ctrl+A) — seulement les nœuds de la scène.
  const sceneIds = useMemo(() => new Set(scene.noeuds.map((n) => n.id)), [scene]);
  const onSelectAll = useCallback(() => {
    setNodes((ns) => ns.map((n) => (sceneIds.has(n.id) ? { ...n, selected: true } : n)));
  }, [setNodes, sceneIds]);

  const onFit = useCallback(() => {
    instRef.current?.fitView({ duration: 250, padding: 0.15 });
  }, []);

  // Optimiseur (aide au besoin F3) : génère une chaîne optimale dans le bloc,
  // puis recentre la vue sur la nouvelle chaîne (timer annulé au démontage).
  const [showOptimizer, setShowOptimizer] = useState(false);
  const fitTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(fitTimer.current), []);
  const onGenerateScene = useCallback(
    (next: Scene) => {
      commit(next);
      window.clearTimeout(fitTimer.current);
      fitTimer.current = window.setTimeout(() => instRef.current?.fitView({ duration: 250, padding: 0.15 }), 350);
    },
    [commit],
  );

  // --- Raccourcis clavier (actifs quand la souris survole le graphe, pour ne pas
  // voler les touches d'Obsidian ; capture pour préempter son propre undo).
  // Ignorés quand le focus est dans un champ de saisie (sauf Échap).
  const [showHelp, setShowHelp] = useState(false);
  const hovered = useRef(false);
  const keymapRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keymapRef.current = (e: KeyboardEvent) => {
    if (!hovered.current) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

    if (e.key === "Escape") {
      // Échap ferme TOUT (panneaux, picker, menu) — même depuis un champ.
      setCtx(null);
      setPicker(null);
      setImportPicker(null);
      setShowHelp(false);
      setEditorNodeId(null);
      setShowOptimizer(false);
      return;
    }
    if (typing) return;

    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      const fire = (fn: () => void) => { e.preventDefault(); e.stopPropagation(); fn(); };
      if (k === "z") fire(e.shiftKey ? redo : undo);
      else if (k === "y") fire(redo);
      else if (k === "c") fire(onCopy);
      else if (k === "v") fire(onPaste);
      else if (k === "a") fire(onSelectAll);
      return;
    }
    // Touches simples (sans modificateur).
    if (k === "n") { e.preventDefault(); setPicker({ mode: "add" }); }
    else if (k === "g") { e.preventDefault(); onGroup(); }
    else if (k === "f") { e.preventDefault(); onFit(); }
    else if (k === "o") { e.preventDefault(); setShowOptimizer((v) => !v); }
    else if (k === "r") { e.preventDefault(); onTidy(); }
    else if (e.key === "?") { e.preventDefault(); setShowHelp((v) => !v); }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keymapRef.current(e);
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const selCount = sceneSelected.length;
  return (
    <SettingsContext.Provider value={{ wholeMachines }}>
    <EditContext.Provider value={editById}>
    <LinkContext.Provider value={toggleLink}>
    <LayerContext.Provider value={layerActions}>
    <div
      ref={wrapperRef}
      className="sfy-graph-wrap"
      onMouseEnter={() => { hovered.current = true; }}
      onMouseLeave={() => { hovered.current = false; }}
    >
    <ReactFlow
      nodes={allNodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onConnect={onConnect}
      onConnectEnd={onConnectEnd}
      onDelete={onDelete}
      onInit={onInit}
      onMoveEnd={persistViewport}
      onSelectionChange={onSelectionChange}
      onNodeDoubleClick={onNodeDoubleClick}
      onPaneClick={() => { setEditorNodeId(null); setPicker(null); setImportPicker(null); setCtx(null); }}
      onPaneContextMenu={onPaneContextMenu}
      onNodeContextMenu={onNodeContextMenu}
      onEdgeContextMenu={onEdgeContextMenu}
      connectionMode={ConnectionMode.Loose}
      deleteKeyCode={["Delete", "Backspace"]}
      multiSelectionKeyCode={["Control", "Meta", "Shift"]}
      selectionKeyCode="Shift"
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      fitView={!savedViewport}
      proOptions={{ hideAttribution: true }}
      minZoom={0.2}
    >
      {onSceneChange ? (
        <Panel position="top-left" className="sfy-toolbar">
          <button onClick={(e) => { e.stopPropagation(); setPicker(picker?.mode === "add" ? null : { mode: "add" }); }} className="sfy-btn" data-action="add-node" title="Add a node (N)"><Plus size={13} /> Node</button>
          {listImportNotes ? (
            <button onClick={(e) => { e.stopPropagation(); importPicker ? setImportPicker(null) : openImportPicker(); }} className="sfy-btn2" data-action="import-note" title="Import production from another note (modular factory)"><FileInput size={13} /> Import</button>
          ) : null}
          <button onClick={() => setShowOptimizer((v) => !v)} className="sfy-btn" title="Compute the optimal chain (O)"><Target size={13} /> Optimize</button>
          <button onClick={onTidy} className="sfy-btn2" title="Tidy: left-to-right auto-layout (R)"><Wand2 size={13} /> Tidy</button>
          <button onClick={undo} className="sfy-btn2" title="Undo (Ctrl+Z)"><Undo2 size={13} /></button>
          <button onClick={redo} className="sfy-btn2" title="Redo (Ctrl+Shift+Z)"><Redo2 size={13} /></button>
          <button onClick={onGroup} className="sfy-btn2" disabled={selCount === 0} title="Create a layer from the selection (G)"><Group size={13} /> Group{selCount ? ` (${selCount})` : ""}</button>
          <button onClick={onCopy} className="sfy-btn2" disabled={selCount === 0} title="Copy selection (Ctrl+C)"><Copy size={13} /></button>
          <button onClick={onPaste} className="sfy-btn2" title="Paste (Ctrl+V)"><ClipboardPaste size={13} /></button>
          <button onClick={() => setShowHelp((v) => !v)} className="sfy-btn2" title="Keyboard and mouse shortcuts (?)"><CircleHelp size={13} /></button>
          {picker?.mode === "add" ? (
            <div className="sfy-picker-anchor">
              <RecipePicker db={db} onPick={onPickRecipe} onClose={() => setPicker(null)} />
            </div>
          ) : null}
          {importPicker && !importPicker.panelPos ? (
            <div className="sfy-picker-anchor">
              <NotePicker notes={importNotes} onPick={onPickImportNote} onClose={() => setImportPicker(null)} />
            </div>
          ) : null}
        </Panel>
      ) : null}
      {onSceneChange && showOptimizer ? (
        <Panel position="top-right">
          <Optimizer onGenerate={onGenerateScene} onClose={() => setShowOptimizer(false)} onNotice={onNotice} />
        </Panel>
      ) : null}
      {onSceneChange && editorNode && !showOptimizer ? (
        <Panel position="top-right">
          <NodeEditor
            node={editorNode}
            db={db}
            layers={scene.calques.map((c) => ({ id: c.id, nom: c.nom }))}
            wholeMachines={wholeMachines}
            onChange={onEditNode}
            onClose={() => setEditorNodeId(null)}
          />
        </Panel>
      ) : null}
      <Background color="var(--sfy-border, #2c2c2c)" gap={26} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>

    {/* Sélecteur de note flottant (Importer une usine ici…). */}
    {importPicker?.panelPos ? (
      <div
        className="sfy-float"
        style={{
          left: Math.min(importPicker.panelPos[0], (wrapperRef.current?.clientWidth ?? 600) - 290),
          top: Math.min(importPicker.panelPos[1], (wrapperRef.current?.clientHeight ?? 400) - 330),
        }}
      >
        <NotePicker notes={importNotes} onPick={onPickImportNote} onClose={() => setImportPicker(null)} />
      </div>
    ) : null}

    {/* Picker flottant : ajout au clic droit / connexion lâchée dans le vide. */}
    {picker && picker.mode !== "add" ? (
      <div
        className="sfy-float"
        style={{
          left: Math.min(picker.panelPos[0], (wrapperRef.current?.clientWidth ?? 600) - 290),
          top: Math.min(picker.panelPos[1], (wrapperRef.current?.clientHeight ?? 400) - 330),
        }}
      >
        <RecipePicker
          db={db}
          consumesOneOf={picker.mode === "connect" ? picker.items : undefined}
          placeholder={picker.mode === "connect" ? "Recipes consuming this product…" : undefined}
          onPick={onPickRecipe}
          onClose={() => setPicker(null)}
        />
      </div>
    ) : null}

    {/* Menu contextuel (clic droit). */}
    {ctx ? (
      <div
        className="sfy-ctx"
        style={{
          left: Math.min(ctx.x, (wrapperRef.current?.clientWidth ?? 600) - 230),
          top: Math.min(ctx.y, (wrapperRef.current?.clientHeight ?? 400) - 220),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {ctx.kind === "pane" ? (
          <>
            <button onClick={() => { setCtx(null); setPicker({ mode: "ctx-add", flowPos: ctx.flowPos, panelPos: [ctx.x, ctx.y] }); }}><Plus size={13} /> Add a node here…</button>
            {listImportNotes ? (
              <button onClick={() => { setCtx(null); openImportPicker({ flowPos: ctx.flowPos, panelPos: [ctx.x, ctx.y] }); }}><FileInput size={13} /> Import a factory here…</button>
            ) : null}
            <button onClick={() => { setCtx(null); onPasteAt(ctx.flowPos); }}><ClipboardPaste size={13} /> Paste here</button>
            <button onClick={() => { setCtx(null); onSelectAll(); }}><BoxSelect size={13} /> Select all</button>
            <hr />
            <button onClick={() => { setCtx(null); onTidy(); }}><Wand2 size={13} /> Tidy</button>
            <button onClick={() => { setCtx(null); onFit(); }}><MousePointer2 size={13} /> Fit view</button>
          </>
        ) : ctx.kind === "node" ? (
          <>
            <button onClick={() => { setCtx(null); setEditorNodeId(ctx.id); }}><Pencil size={13} /> Edit…</button>
            <button onClick={() => { setCtx(null); onDuplicate(ctx.id); }}><Copy size={13} /> Duplicate</button>
            <button onClick={() => { setCtx(null); onRouteToSink(ctx.id); }}><Archive size={13} /> Surplus → Sink</button>
            {selCount > 1 ? (
              <button onClick={() => { setCtx(null); onGroup(); }}><Group size={13} /> Group selection ({selCount})</button>
            ) : null}
            <hr />
            <button className="sfy-ctx-danger" onClick={() => { setCtx(null); commit(removeNodes(scene, new Set([ctx.id]))); }}><Trash2 size={13} /> Delete</button>
          </>
        ) : (
          <>
            <button onClick={() => { setCtx(null); toggleLink(ctx.de, ctx.vers, ctx.produit); }}><Repeat2 size={13} /> Toggle loop</button>
            <hr />
            <button className="sfy-ctx-danger" onClick={() => { setCtx(null); commit(removeLinks(scene, new Set([linkKey(ctx.de, ctx.vers, ctx.produit)]))); }}><Trash2 size={13} /> Delete link</button>
          </>
        )}
      </div>
    ) : null}

    {/* Aide : raccourcis clavier + gestes souris. */}
    {showHelp ? (
      <div className="sfy-help" onClick={() => setShowHelp(false)}>
        <div className="sfy-help-card" onClick={(e) => e.stopPropagation()}>
          <div className="sfy-editor-head">
            <b><Keyboard size={14} /> Shortcuts</b>
            <button className="sfy-editor-close" title="Close" onClick={() => setShowHelp(false)}><X size={13} /></button>
          </div>
          <div className="sfy-help-cols">
            <div>
              <div className="sfy-io-title">Keyboard (mouse over the graph)</div>
              <div className="sfy-help-row"><kbd>N</kbd> Add a node</div>
              <div className="sfy-help-row"><kbd>O</kbd> Optimizer</div>
              <div className="sfy-help-row"><kbd>R</kbd> Tidy (auto-layout)</div>
              <div className="sfy-help-row"><kbd>F</kbd> Fit view</div>
              <div className="sfy-help-row"><kbd>G</kbd> Group selection</div>
              <div className="sfy-help-row"><kbd>Del</kbd> Delete selection</div>
              <div className="sfy-help-row"><kbd>Ctrl+C</kbd> / <kbd>Ctrl+V</kbd> Copy / paste</div>
              <div className="sfy-help-row"><kbd>Ctrl+A</kbd> Select all</div>
              <div className="sfy-help-row"><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Shift+Z</kbd> Undo / redo</div>
              <div className="sfy-help-row"><kbd>Esc</kbd> Close panels</div>
              <div className="sfy-help-row"><kbd>?</kbd> This help</div>
            </div>
            <div>
              <div className="sfy-io-title">Mouse</div>
              <div className="sfy-help-row">Drag a node → move (writes the position)</div>
              <div className="sfy-help-row">Double-click a node → edit</div>
              <div className="sfy-help-row">Double-click a value → quick edit</div>
              <div className="sfy-help-row">Drag handle → handle: connect</div>
              <div className="sfy-help-row">Drag handle → empty: <b>create a consumer</b></div>
              <div className="sfy-help-row">Right-click (background / node / link) → menu</div>
              <div className="sfy-help-row">Shift+drag → multi-select</div>
              <div className="sfy-help-row">Double-click a link label → loop</div>
            </div>
          </div>
        </div>
      </div>
    ) : null}
    </div>
    </LayerContext.Provider>
    </LinkContext.Provider>
    </EditContext.Provider>
    </SettingsContext.Provider>
  );
}

export function GraphView(props: Props) {
  return (
    <div className="sfy-graph">
      <ReactFlowProvider>
        <Graph {...props} />
      </ReactFlowProvider>
    </div>
  );
}

export type { Props as GraphViewProps };
