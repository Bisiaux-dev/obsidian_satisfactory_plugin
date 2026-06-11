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
  addExtractor,
  addNode,
  connect,
  copyNodes,
  createLayer,
  cycleLinkCap,
  linkKey,
  nextNodeId,
  pasteInto,
  removeLinks,
  removeNodes,
  setLinkCap,
  setLinkRate,
  toggleLayerCollapsed,
  updateLayer,
  updateNode,
} from "../model/edit";
import type { Clipboard, NodePatch } from "../model/edit";
import type { LinkCap, Node as SfyNode } from "../model/types";
import { nodePorts, layerAggregatePorts } from "../model/ports";
import { ICONS, ICON_COLORS } from "../model/game-icons";
import { MACHINE_ICONS } from "../model/machine-icons";
import { maxSloops, scenePower } from "../model/power";
import type { Purity } from "../model/power";
import { autoLayout } from "../model/layout";
import { RecipeNode } from "./RecipeNode";
import { RawNode } from "./RawNode";
import { GroupNode } from "./GroupNode";
import { ModuleNode } from "./ModuleNode";
import { FlowEdge } from "./FlowEdge";
import { NodeEditor } from "./NodeEditor";
import { Optimizer } from "./Optimizer";
import { ExtractorPicker, NotePicker, RecipePicker } from "./RecipePicker";
import { EditContext, LayerContext, LinkContext, SettingsContext } from "./inline";
import type { LinkActions } from "./inline";
import {
  Archive,
  Ban,
  BoxSelect,
  CircleHelp,
  ClipboardPaste,
  Copy,
  FileInput,
  Group,
  Keyboard,
  MousePointer2,
  Pencil,
  Pickaxe,
  Play,
  Plus,
  Redo2,
  Repeat2,
  Target,
  Trash2,
  Undo2,
  Wand2,
  X,
  Zap,
} from "lucide-react";

// Estimated node footprint (fallback when dimensions are not yet measured) + layer margins.
const NODE_W = 210;
const NODE_H = 150;
const GROUP_PAD = 22;
const GROUP_HEAD = 30;

/** Node representing the AWESOME Sink (terminal outlet for a surplus). */
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
 * Viewport (camera) persisted PER NOTE, at module level — survives the remounts
 * caused by the write-back (every `.md` write re-renders the block). We restore
 * the camera instead of re-running `fitView` → no more jump/flicker on every
 * change. The plugin module stays loaded as long as Obsidian is running.
 */
const viewportStore = new Map<string, Viewport>();

interface Props {
  scene: Scene;
  db: Db;
  diagnostic: Diagnostic;
  /** Path of the note — persistence key for the camera. */
  sourcePath?: string;
  /** Incremented by the plugin on EXTERNAL edits of the `.md` → re-syncs the
   * React Flow state (the root being persistent, there is no remount). */
  syncToken?: number;
  /** Called on node drop with the updated scene (write-back). */
  onSceneChange?: (scene: Scene) => void;
  /** User notification (connection success/refusal…). */
  onNotice?: (message: string) => void;
  /** Setting: force whole machine counts when editing. */
  wholeMachines?: boolean;
  /** (Async) list of importable vault notes (containing a satisfactory block). */
  listImportNotes?: () => Promise<string[]>;
}

/** Returns a copy of the scene with one node's position updated. */
function withNodePosition(scene: Scene, id: string, x: number, y: number): Scene {
  return {
    ...scene,
    noeuds: scene.noeuds.map((n) =>
      n.id === id ? { ...n, pos: [Math.round(x), Math.round(y)] as [number, number] } : n,
    ),
  };
}

/**
 * Business nodes: ABSOLUTE positions, freely movable (like the mockup).
 * Layers are NOT parents here — they are derived from the live positions
 * (cf. {@link computeGroupNodes}), so node movement is unconstrained.
 */
function buildBusinessNodes(scene: Scene, db: Db, diag: Diagnostic, wholeMachines = false): RFNode[] {
  const nodes: RFNode[] = [];
  let maxX = 0;

  // Collapsed layers: their members are hidden and replaced by a module node.
  const collapsed = new Set(scene.calques.filter((c) => c.replie).map((c) => c.id));
  const memberPos = new Map<string, { x: number; y: number }[]>();

  scene.noeuds.forEach((node, i) => {
    const recipe = db.recipes[node.recette];
    const ports = nodePorts(node, db, scene.liens);
    const pos = node.pos ?? [40 + i * 240, 40 + (i % 3) * 170];
    maxX = Math.max(maxX, pos[0]);
    const issues = diag.issues.filter((x) => x.nodeId === node.id).map((x) => x.message);
    const status = diag.status[node.id] ?? "ok";

    // Member of a collapsed layer → hidden (remember its position for the module).
    if (node.calque && collapsed.has(node.calque)) {
      const arr = memberPos.get(node.calque) ?? [];
      arr.push({ x: pos[0], y: pos[1] });
      memberPos.set(node.calque, arr);
      return;
    }

    // Raw resource / extractor node: no inputs (generators are NOT raw — they
    // are recipe nodes that display their building icon + MW output).
    if (ports.intrants.length === 0 && !recipe?.production) {
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
          clock: node.clock ?? 100,
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
    const m = node.machines > 0 ? node.machines : 1;
    nodes.push({
      id: node.id,
      type: "recipe",
      position: { x: pos[0], y: pos[1] },
      data: {
        icone: item?.icone,
        iconUrl: recipe?.production ? MACHINE_ICONS[ports.machine] : principal ? ICONS[principal.item] : undefined,
        produit: recipe?.production ? recipe.nom : (item?.nom ?? principal?.item ?? recipe?.nom ?? node.recette),
        recette: recipe?.nom ?? node.recette,
        alternative: recipe?.alternative,
        machine: ports.machine,
        machines: node.machines,
        clock: node.clock ?? 100,
        sloops: node.sloops ?? 0,
        maxSloops: recipe && !recipe.production ? maxSloops(recipe.machine) : 0,
        debit: principal?.debit ?? 0,
        prod: (recipe?.production ?? 0) * m * ((node.clock ?? 100) / 100),
        status,
        badge: status,
        issues,
        intrants: ports.intrants,
        extrants: ports.extrants,
        wholeMachines,
      },
    });
  });

  // Module node for each collapsed layer (positioned at the members' top-left corner).
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
      zIndex: 10, // above the other nodes (the module is opaque → no visual overlap)
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

  // Sink is present as soon as there are nodes (routing target for a surplus / by-product).
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
 * Layer boxes DERIVED from the live positions of member nodes — recomputed on
 * every change (= the mockup's `redraw()`). Not movable nor selectable: you
 * move the NODES, the box follows. Placed at the head of the array so they
 * render behind the nodes.
 */
function computeGroupNodes(scene: Scene, liveNodes: RFNode[]): RFNode[] {
  const byId = new Map(liveNodes.map((n) => [n.id, n]));
  const groups: RFNode[] = [];

  for (const layer of scene.calques) {
    if (layer.replie) continue; // collapsed layer → rendered as a module node, not a box
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
  // member of a collapsed layer → its edge is rerouted to the module node.
  const collapsedOf = new Map<string, string>();
  for (const layer of scene.calques) {
    if (!layer.replie) continue;
    for (const n of scene.noeuds) if (n.calque === layer.id) collapsedOf.set(n.id, `module-${layer.id}`);
  }

  const edges: Edge[] = [];
  // Counter of parallel arrows (same source→target) to offset their labels.
  const pairCount = new Map<string, number>();

  scene.liens.forEach((link, i) => {
    const source = collapsedOf.get(link.de) ?? link.de;
    const target = collapsedOf.get(link.vers) ?? link.vers;
    if (source === target) return; // link internal to a collapsed layer → hidden

    const item = db.items[link.produit];
    // Product color: vivid hue derived from the icon (ICON_COLORS) first,
    // else the DB color, else neutral gray.
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
        debitNum: link.debit,
        boucle: rerouted ? false : link.boucle,
        cap: rerouted ? "fleche" : (link.cap ?? (link.boucle ? "boucle" : "fleche")),
        de: link.de,
        vers: link.vers,
        produit: link.produit,
        pairKey,
        labelIndex,
      },
    });
  });
  // Fill in the total number of parallels per pair (to center the offset).
  for (const e of edges) {
    const d = e.data as { pairKey: string; labelCount?: number };
    d.labelCount = pairCount.get(d.pairKey) ?? 1;
  }
  return edges;
}

function Graph({ scene, db, diagnostic, sourcePath, syncToken, onSceneChange, onNotice, wholeMachines = false, listImportNotes }: Props) {
  const initialNodes = useMemo(() => buildBusinessNodes(scene, db, diagnostic, wholeMachines), [scene, db, diagnostic, wholeMachines]);
  const initialEdges = useMemo(() => buildEdges(scene, db), [scene, db]);

  // --- Camera persistence across remounts (anti-flicker / anti-reset) ---
  const camKey = sourcePath || "default";
  const savedViewport = viewportStore.get(camKey);
  const instRef = useRef<ReactFlowInstance | null>(null);
  const persistViewport = useCallback(() => {
    if (instRef.current) viewportStore.set(camKey, instRef.current.getViewport());
  }, [camKey]);
  // Undo/redo history (Ctrl+Z). The source of truth remains the `.md`;
  // we stack the previous scenes (refs → survive re-renders without remounting).
  const undoStack = useRef<Scene[]>([]);
  const redoStack = useRef<Scene[]>([]);
  const restore = useCallback(
    (s: Scene) => {
      persistViewport();
      onSceneChange?.(s);
    },
    [persistViewport, onSceneChange],
  );
  // Mutation + write-back: pushes the current state for undo.
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

  // Re-syncs from the `.md` ONLY on external edits (syncToken bumped by the
  // plugin). We skip the first mount (useNodesState already seeded) and our
  // own write-backs (which do not bump syncToken).
  const firstSync = useRef(true);
  const selectedRef = useRef<string[]>([]);
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    // Rebuild while PRESERVING the selection (otherwise the edit panel closes
    // after every write-back, the rebuild wiping the `selected` state).
    const sel = new Set(selectedRef.current);
    setNodes(buildBusinessNodes(scene, db, diagnostic, wholeMachines).map((n) => (sel.has(n.id) ? { ...n, selected: true } : n)));
    setEdges(buildEdges(scene, db));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncToken]);

  // Layers recomputed on every render from the live positions → the box follows the nodes.
  const groupNodes = useMemo(() => computeGroupNodes(scene, nodes), [scene, nodes]);
  const allNodes = useMemo(() => [...groupNodes, ...nodes], [groupNodes, nodes]);
  // Total chain power (overclock + Somersloop applied; generators add production).
  const power = useMemo(() => scenePower(scene, db), [scene, db]);
  const powerTitle =
    "Chain power. Consumption = base MW × machines × (1+sloops/max)² × (clock/100)^1.321928 " +
    "(overclock + Somersloop amplification; variable-power machines at their average; extractors counted " +
    "when the machine is recognized: Miner Mk.1/2/3, Water/Oil Extractor, Resource Well Pressurizer). " +
    "Generators are linear and add production; with generators the badge shows production − consumption = net. " +
    "Imported factories are not counted.";

  // Write-back on DROP only (not on every pixel), per the spec. xyflow passes the
  // FULL set of dragged nodes as the 3rd arg → a multi-selection drag persists
  // every node's new position in a SINGLE commit (one undo step), not just the
  // node under the cursor (the previous bug).
  const onNodeDragStop = useCallback(
    (_e: MouseEvent | TouchEvent, node: RFNode, draggedNodes?: RFNode[]) => {
      if (!onSceneChange) return;
      const moved = draggedNodes && draggedNodes.length > 0 ? draggedNodes : [node];
      let next = scene;
      let changed = false;
      for (const nd of moved) {
        // Moving a collapsed layer (module node) → shifts all of its members.
        if (nd.id.startsWith("module-")) {
          const layerId = nd.id.slice("module-".length);
          const members = next.noeuds.filter((n) => n.calque === layerId && n.pos);
          if (members.length === 0) continue;
          const minX = Math.min(...members.map((n) => n.pos![0]));
          const minY = Math.min(...members.map((n) => n.pos![1]));
          const dx = Math.round(nd.position.x) - minX;
          const dy = Math.round(nd.position.y) - minY;
          if (dx === 0 && dy === 0) continue;
          next = {
            ...next,
            noeuds: next.noeuds.map((n) =>
              n.calque === layerId && n.pos
                ? { ...n, pos: [n.pos[0] + dx, n.pos[1] + dy] as [number, number] }
                : n,
            ),
          };
          changed = true;
          continue;
        }
        const target = next.noeuds.find((n) => n.id === nd.id);
        if (!target) continue; // synthetic node (layer, Sink) → not in the scene
        const nx = Math.round(nd.position.x);
        const ny = Math.round(nd.position.y);
        if (target.pos && target.pos[0] === nx && target.pos[1] === ny) continue; // did not move
        next = withNodePosition(next, nd.id, nx, ny);
        changed = true;
      }
      if (changed) commit(next);
    },
    [scene, onSceneChange, commit],
  );

  // Connecting two nodes → new link (product chosen automatically).
  // Explicit feedback: success = what was routed, refusal = why.
  // Did the current connection drag actually create a link? Reset on drag start,
  // set in onConnect; onConnectEnd opens the "create a consumer" picker when it
  // stayed false (dropped in the void OR onto a node that can't consume the
  // product) — so you no longer have to release far away from every node.
  const connectedRef = useRef(false);
  const onConnectStart = useCallback(() => { connectedRef.current = false; }, []);
  const onConnect = useCallback(
    (c: Connection) => {
      if (!onSceneChange) return;
      const res = connect(scene, db, c);
      if (res.ok) {
        connectedRef.current = true;
        commit(res.scene);
        const item = db.items[res.produit]?.nom ?? res.produit;
        const dest = res.vers === SINK ? "Sink" : res.vers;
        onNotice?.(`Link created: ${item} ${res.debit}/min → ${dest}`);
      } else {
        // Snapped onto a node that can't consume it → no link; the picker opens
        // in onConnectEnd (more useful than a refusal toast).
        connectedRef.current = false;
      }
    },
    [scene, db, onSceneChange, commit, onNotice],
  );

  // Deletion (Del): ONE single handler for nodes + links → a single write-back
  // (avoids the race between onNodesDelete and onEdgesDelete on a frozen scene).
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

  // --- Recipe picker (3 opening contexts) ---
  //  - 'add'     : "+ Node" button → new node placed below the others;
  //  - 'ctx-add' : right-click on the background → new node AT THAT SPOT;
  //  - 'connect' : connection dropped in the void → recipes CONSUMING a product
  //                of the source node, node created at the drop point + auto link.
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
        // Creates the node at the drop point then routes the product automatically
        // (connect() picks the item the new recipe consumes).
        const id = nextNodeId(scene);
        const withNode: Scene = {
          ...scene,
          noeuds: [...scene.noeuds, { id, recette: recipeId, machines: 1, pos: picker.flowPos }],
        };
        const res = connect(withNode, db, { source: picker.sourceId, target: id });
        if (res.ok) {
          // Size the new node so it absorbs the routed flow (stays green).
          const rec = db.recipes[recipeId];
          const per = rec?.intrants.find((p) => p.item === res.produit)?.debit ?? rec?.fuels?.find((f) => f.item === res.produit)?.debit ?? 0;
          let mc = per > 0 && res.debit > 0 ? res.debit / per : 1;
          mc = wholeMachines ? Math.max(1, Math.round(mc)) : Math.max(0.01, Math.round(mc * 100) / 100);
          commit(mc !== 1 ? updateNode(res.scene, id, { machines: mc }) : res.scene);
          const item = db.items[res.produit]?.nom ?? res.produit;
          onNotice?.(`Node created and linked: ${item} ${res.debit}/min (×${mc} machine${mc > 1 ? "s" : ""}).`);
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
    [scene, db, picker, onSceneChange, commit, onNotice, wholeMachines],
  );

  // --- Importing another note (factory): vault note picker ---
  // null = closed; otherwise optional position (right-click) + list loaded async.
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

  // --- Extractor picker (resource source nodes): node-purity selector inside it ---
  const [extPicker, setExtPicker] = useState<{ flowPos?: [number, number]; panelPos?: [number, number] } | null>(null);
  const onPickExtractor = useCallback(
    (machine: string, item: string, debit: number) => {
      if (!onSceneChange || !extPicker) return;
      const pos: [number, number] =
        extPicker.flowPos ?? [40, scene.noeuds.reduce((m, n) => Math.max(m, n.pos?.[1] ?? 0), 0) + 190];
      setExtPicker(null);
      commit(addExtractor(scene, machine, item, debit, pos));
      onNotice?.(`${machine} added: ${db.items[item]?.nom ?? item} ${debit}/min.`);
    },
    [scene, db, extPicker, onSceneChange, commit, onNotice],
  );

  // Connection dropped in the void → picker filtered to consumers.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: { isValid: boolean | null; fromNode: { id: string } | null }) => {
      const created = connectedRef.current;
      connectedRef.current = false;
      // Open the picker whenever NO link was created (void drop or snapped onto a
      // non-consuming node), not only on a strictly "far" release.
      if (!onSceneChange || created || !state.fromNode) return;
      const src = scene.noeuds.find((n) => n.id === state.fromNode!.id);
      if (!src) return; // Sink / module / layer: no creation from those
      const outputs = nodePorts(src, db, scene.liens).extrants.map((p) => p.item);
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

  // Left→right auto-layout (dagre) → spaces everything out cleanly.
  const onTidy = useCallback(() => {
    if (!onSceneChange) return;
    commit(autoLayout(scene, db));
    onNotice?.("Graph tidied.");
  }, [scene, db, onSceneChange, commit, onNotice]);

  // --- Context menu (right-click: background / node / link) ---
  // Coordinates RELATIVE to the graph container (the menu is absolutely positioned in it).
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
      // Menu only for scene nodes (not Sink / module / layer box).
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
  // Closing the menu: click anywhere.
  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [ctx]);

  // --- Multi-selection (Shift+drag = box, Shift/Ctrl+click = add) ---
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

  // Edit panel: opened ONLY on node double-click (not on single click, which
  // only selects). A double-click on a value (Inline) does not bubble up here
  // (stopPropagation) → inline editing without opening the panel.
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
  // Inline editing (double-click on a node info) → mutation by id.
  const editById = useCallback(
    (id: string, patch: NodePatch) => commit(updateNode(scene, id, patch)),
    [scene, commit],
  );
  // Link actions: end-marker (right-click cycles/sets it), editable rate, menu.
  const linkActions = useMemo<LinkActions>(
    () => ({
      cycle: (de, vers, produit) => commit(cycleLinkCap(scene, de, vers, produit)),
      setCap: (de, vers, produit, cap) => commit(setLinkCap(scene, de, vers, produit, cap)),
      setRate: (de, vers, produit, v) => commit(setLinkRate(scene, de, vers, produit, v)),
      openMenu: (de, vers, produit, clientX, clientY) => {
        const r = wrapperRef.current?.getBoundingClientRect();
        setCtx({ kind: "edge", x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0), de, vers, produit });
      },
    }),
    [scene, commit],
  );
  // Layer actions: collapse/expand + rename (name editing state held here,
  // stable — the layer node being recomputed on every render).
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

  // --- Layer from selection / copy / paste ---
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

  // Paste AT A SPOT (right-click): offsets the clipboard so that its top-left
  // corner lands on the clicked point.
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

  // Duplicate a node (right-click): copy + paste next to it.
  const onDuplicate = useCallback(
    (id: string) => {
      const { scene: next } = pasteInto(scene, copyNodes(scene, [id]), [40, 40]);
      commit(next);
    },
    [scene, commit],
  );

  // Route a node's surplus to the Sink (reuses connect() validation).
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

  // Select all (Ctrl+A) — scene nodes only.
  const sceneIds = useMemo(() => new Set(scene.noeuds.map((n) => n.id)), [scene]);
  const onSelectAll = useCallback(() => {
    setNodes((ns) => ns.map((n) => (sceneIds.has(n.id) ? { ...n, selected: true } : n)));
  }, [setNodes, sceneIds]);

  const onFit = useCallback(() => {
    instRef.current?.fitView({ duration: 250, padding: 0.15 });
  }, []);

  // Optimizer (helper for need F3): generates an optimal chain in the block,
  // then re-centers the view on the new chain (timer cleared on unmount).
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

  // --- Keyboard shortcuts (active while the mouse hovers the graph, so as not
  // to steal Obsidian's keys; capture phase to preempt its own undo).
  // Ignored when focus is in an input field (except Escape).
  const [showHelp, setShowHelp] = useState(false);
  const hovered = useRef(false);
  // Last mouse position over the graph (client coords) — N creates the node there.
  const mousePos = useRef<{ x: number; y: number } | null>(null);
  // N opens the picker AT the mouse position (same behavior as right-click →
  // "Add a node here…"); falls back to the toolbar placement when unavailable.
  const openPickerAtMouse = useCallback(() => {
    const pt = mousePos.current;
    const fp = pt ? instRef.current?.screenToFlowPosition({ x: pt.x, y: pt.y }) : null;
    const r = wrapperRef.current?.getBoundingClientRect();
    if (!pt || !fp || !r) {
      setPicker({ mode: "add" });
      return;
    }
    setPicker({
      mode: "ctx-add",
      flowPos: [Math.round(fp.x), Math.round(fp.y)],
      panelPos: [pt.x - r.left, pt.y - r.top],
    });
  }, []);
  const openExtractorAtMouse = useCallback(() => {
    const pt = mousePos.current;
    const fp = pt ? instRef.current?.screenToFlowPosition({ x: pt.x, y: pt.y }) : null;
    const r = wrapperRef.current?.getBoundingClientRect();
    if (!pt || !fp || !r) { setExtPicker({}); return; }
    setExtPicker({ flowPos: [Math.round(fp.x), Math.round(fp.y)], panelPos: [pt.x - r.left, pt.y - r.top] });
  }, []);
  const keymapRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keymapRef.current = (e: KeyboardEvent) => {
    if (!hovered.current) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

    if (e.key === "Escape") {
      // Escape closes EVERYTHING (panels, picker, menu) — even from a field.
      setCtx(null);
      setPicker(null);
      setImportPicker(null);
      setExtPicker(null);
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
    // Plain keys (no modifier).
    if (k === "n") { e.preventDefault(); openPickerAtMouse(); }
    else if (k === "e") { e.preventDefault(); openExtractorAtMouse(); }
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
    <LinkContext.Provider value={linkActions}>
    <LayerContext.Provider value={layerActions}>
    <div
      ref={wrapperRef}
      className="sfy-graph-wrap"
      onMouseEnter={() => { hovered.current = true; }}
      onMouseLeave={() => { hovered.current = false; mousePos.current = null; }}
      onMouseMove={(e) => { mousePos.current = { x: e.clientX, y: e.clientY }; }}
    >
    <ReactFlow
      nodes={allNodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onConnect={onConnect}
      onConnectStart={onConnectStart}
      onConnectEnd={onConnectEnd}
      onDelete={onDelete}
      onInit={onInit}
      onMoveEnd={persistViewport}
      onSelectionChange={onSelectionChange}
      onNodeDoubleClick={onNodeDoubleClick}
      onPaneClick={() => { setEditorNodeId(null); setPicker(null); setImportPicker(null); setExtPicker(null); setCtx(null); }}
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
      // Low floor so fit-view can frame very large generated factories (50+ nodes).
      minZoom={0.05}
    >
      {onSceneChange ? (
        <Panel position="top-left" className="sfy-toolbar">
          <button onClick={(e) => { e.stopPropagation(); setPicker(picker?.mode === "add" ? null : { mode: "add" }); }} className="sfy-btn" data-action="add-node" title="Add a node (N)"><Plus size={13} /> Node</button>
          <button onClick={(e) => { e.stopPropagation(); extPicker && !extPicker.panelPos ? setExtPicker(null) : setExtPicker({}); }} className="sfy-btn2" data-action="add-extractor" title="Add a resource extractor (E)"><Pickaxe size={13} /> Extractor</button>
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
          {extPicker && !extPicker.panelPos ? (
            <div className="sfy-picker-anchor">
              <ExtractorPicker db={db} onPick={onPickExtractor} onClose={() => setExtPicker(null)} />
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
            liens={scene.liens}
            layers={scene.calques.map((c) => ({ id: c.id, nom: c.nom }))}
            wholeMachines={wholeMachines}
            onChange={onEditNode}
            onClose={() => setEditorNodeId(null)}
          />
        </Panel>
      ) : null}
      {scene.noeuds.length > 0 ? (
        <Panel position="bottom-right" className="sfy-energy-panel">
          <div className={`sfy-energy${power.prod > 0 ? (power.net >= 0 ? " ok" : " bad") : ""}`} title={powerTitle}>
            <Zap size={12} />
            {power.prod > 0 ? (
              <span>{power.prod} − {power.conso} = <b>{power.net} MW</b></span>
            ) : (
              <span>{power.conso} MW</span>
            )}
          </div>
        </Panel>
      ) : null}
      <Background color="var(--sfy-border, #2c2c2c)" gap={26} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>

    {/* Floating note picker (Import a factory here…). */}
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

    {/* Floating extractor picker (right-click → Add an extractor here…). */}
    {extPicker?.panelPos ? (
      <div
        className="sfy-float"
        style={{
          left: Math.min(extPicker.panelPos[0], (wrapperRef.current?.clientWidth ?? 600) - 290),
          top: Math.min(extPicker.panelPos[1], (wrapperRef.current?.clientHeight ?? 400) - 330),
        }}
      >
        <ExtractorPicker db={db} onPick={onPickExtractor} onClose={() => setExtPicker(null)} />
      </div>
    ) : null}

    {/* Floating picker: right-click add / connection dropped in the void. */}
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

    {/* Context menu (right-click). */}
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
            <button onClick={() => { setCtx(null); setExtPicker({ flowPos: ctx.flowPos, panelPos: [ctx.x, ctx.y] }); }}><Pickaxe size={13} /> Add an extractor here…</button>
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
            <button onClick={() => { setCtx(null); linkActions.setCap(ctx.de, ctx.vers, ctx.produit, "fleche"); }}><Play size={13} /> Arrow</button>
            <button onClick={() => { setCtx(null); linkActions.setCap(ctx.de, ctx.vers, ctx.produit, "boucle"); }}><Repeat2 size={13} /> Loop (reinjection)</button>
            <button onClick={() => { setCtx(null); linkActions.setCap(ctx.de, ctx.vers, ctx.produit, "rien"); }}><Ban size={13} /> No marker</button>
            <hr />
            <button className="sfy-ctx-danger" onClick={() => { setCtx(null); commit(removeLinks(scene, new Set([linkKey(ctx.de, ctx.vers, ctx.produit)]))); }}><Trash2 size={13} /> Delete link</button>
          </>
        )}
      </div>
    ) : null}

    {/* Help: keyboard shortcuts + mouse gestures. */}
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
              <div className="sfy-help-row"><kbd>N</kbd> Add a node at the mouse position</div>
              <div className="sfy-help-row"><kbd>E</kbd> Add a resource extractor</div>
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
              <div className="sfy-help-row">Right-click a link → arrow / loop / none</div>
              <div className="sfy-help-row">Double-click a link rate → edit the flow</div>
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
