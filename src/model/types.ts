/**
 * Data model of the Satisfactory Chains plugin.
 *
 * Two separate worlds (cf. the spec):
 *  - KNOWLEDGE   : the game's items + recipes (static) → {@link Item}, {@link Recipe}, {@link Db}.
 *  - THE FACTORY : the scene designed by the user (variable) → {@link Scene}, {@link Node}, {@link Link}, {@link Layer}.
 *
 * The diagnostic ({@link Diagnostic}) is a PURE function of (Scene + Db).
 */

/** Physical state of an item — drives the stroke rendering (solid stroke = solid, dashed = fluid). */
export type ItemForm = "solide" | "fluide";

/** A game item (product, resource, fluid). */
export interface Item {
  id: string;
  nom: string;
  /** Actual average hue of the item (one color per item) — used for edge colors. */
  couleur: string;
  etat: ItemForm;
  /** Placeholder emoji/glyph until the game icons are integrated. */
  icone?: string;
}

/** A recipe port: an item and its nominal rate (per machine, at 100%), in /min. */
export interface Port {
  item: string;
  debit: number;
}

/**
 * One accepted fuel of a power generator. `debit` = burn rate /min at 100% for
 * the generator's nominal output. `dechet` = waste by-product produced when this
 * fuel is burned (e.g. nuclear waste). `optionnel` = the generator runs without it.
 */
export interface GenFuel {
  item: string;
  debit: number;
  dechet?: Port;
  optionnel?: boolean;
}

/** A game recipe: inputs (intrants) → outputs (extrants), in a given machine. */
export interface Recipe {
  id: string;
  nom: string;
  /** Machine that runs the recipe (e.g. "Raffinerie", "Fonderie"). */
  machine: string;
  /** true if this is an alternate recipe (badge in the rendering). */
  alternative?: boolean;
  intrants: Port[];
  /**
   * Outputs: the first one is the main product, the rest are byproducts.
   * A byproduct with no outlet is the #1 cause of a chain getting blocked.
   */
  extrants: Port[];
  /**
   * Power GENERATORS only (slugs `power-*`): nominal power OUTPUT in MW at 100%.
   * When set, the recipe produces power (scales linearly with clock) instead of
   * consuming it, and `fuels` lists the accepted fuels (one burned at a time).
   */
  production?: number;
  /** Power generators: accepted fuels (the burned one is detected from the links). */
  fuels?: GenFuel[];
}

/** The game database, indexed by id. */
export interface Db {
  items: Record<string, Item>;
  recipes: Record<string, Recipe>;
}

/** A scene node: a recipe instance placed by the user. */
export interface Node {
  id: string;
  recette: string;
  /** Number of machines (multiplies the recipe's input/output rates). Default: 1. */
  machines: number;
  /**
   * Clock speed in % (1–250, default 100). Item rates scale LINEARLY with it;
   * machine power scales as (clock/100)^1.321928 (generators stay linear). On a
   * custom/extractor node it scales both the absolute rates and the power.
   */
  clock?: number;
  /**
   * Somersloops inserted (production amplifier), 0..max (max depends on the
   * machine). Output ×(1+sloops/max) (up to ×2), power ×(1+sloops/max)² (up to
   * ×4). Inputs unchanged. Not allowed on extractors/generators.
   */
  sloops?: number;
  /** Position [x, y]; optional (auto-layout deferred). */
  pos?: [number, number];
  /** id of the layer this node belongs to. */
  calque?: string;

  /**
   * Cross-note IMPORT: name/path of another note. The node becomes a "black
   * box" exposing that note's DELIVERABLES (its outputs to the Sink, otherwise
   * its net surplus), multiplied by `machines`. Its `intrants`/`extrants`/`machine`
   * are then DERIVED (resolved at read time, never serialized) and stay in sync.
   */
  import?: string;

  // --- Overrides (CUSTOM rates, absolute) ---
  // If `intrants` or `extrants` is set, the node no longer uses the DB recipe:
  // its rates are these values as-is (already in /min, not × machines).
  // Allows freely editing inputs/outputs while the game DB is still partial.
  /** Custom machine (otherwise the recipe's). */
  machine?: string;
  /** Custom inputs (absolute rates, /min). */
  intrants?: Port[];
  /** Custom outputs (absolute rates, /min). */
  extrants?: Port[];
}

/** Whether a node carries custom rates (overriding the DB recipe). */
export function isCustomNode(n: Node): boolean {
  return n.intrants !== undefined || n.extrants !== undefined;
}

/**
 * A link = an explicit ROUTING decision for a product from one node to another
 * (or to the Sink). This is the object the diagnostic reads to spot orphans.
 */
/** End-marker of a link: arrow (default), loop ♻ (reinjection), or none (hidden). */
export type LinkCap = "fleche" | "boucle" | "rien";

export interface Link {
  de: string;
  /** id of a destination node, or the literal string "SINK". */
  vers: string;
  produit: string;
  debit: number;
  /** true if the product is fed back upstream (loop / reuse). Kept in sync with `cap`. */
  boucle?: boolean;
  /** End-marker state: arrow / loop / none (purely visual; `boucle` mirrors "boucle"). */
  cap?: LinkCap;
}

/** Special link target: the AWESOME Sink (consumes any surplus). */
export const SINK = "SINK";

/** A layer: groups a portion of the chain (modularity). */
export interface Layer {
  id: string;
  nom: string;
  icone?: string;
  couleur?: string;
  replie?: boolean;
}

/** The full scene described by the ```satisfactory block. */
export interface Scene {
  noeuds: Node[];
  liens: Link[];
  calques: Layer[];
}

/** Node severity (border color overlay). */
export type Status = "ok" | "warn" | "bad";

/** A diagnostic remark attached to a node. */
export interface Issue {
  nodeId: string;
  severity: Status;
  /** Item involved (orphan byproduct, surplus…). */
  item?: string;
  message: string;
}

/** Diagnostic result: per-node status + detailed list of remarks. */
export interface Diagnostic {
  /** Aggregated (worst) status of each node. */
  status: Record<string, Status>;
  issues: Issue[];
}
