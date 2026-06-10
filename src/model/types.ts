/**
 * Modèle de données du plugin Satisfactory Chains.
 *
 * Deux univers séparés (cf. cahier des charges) :
 *  - LE SAVOIR : items + recettes du jeu (statique) → {@link Item}, {@link Recipe}, {@link Db}.
 *  - L'USINE   : la scène conçue par l'utilisateur (variable) → {@link Scene}, {@link Node}, {@link Link}, {@link Layer}.
 *
 * Le diagnostic ({@link Diagnostic}) est une fonction PURE de (Scene + Db).
 */

/** État physique d'un item — pilote le rendu du trait (plein = solide, pointillé = fluide). */
export type ItemForm = "solide" | "fluide";

/** Un item du jeu (produit, ressource, fluide). */
export interface Item {
  id: string;
  nom: string;
  /** Teinte moyenne réelle de l'item (une couleur par item) — utilisée pour la couleur des arêtes. */
  couleur: string;
  etat: ItemForm;
  /** Emoji/glyphe de substitution tant que les icônes du jeu ne sont pas intégrées. */
  icone?: string;
}

/** Un port d'une recette : un item et son débit nominal (par machine, à 100%), en /min. */
export interface Port {
  item: string;
  debit: number;
}

/** Une recette du jeu : intrants → extrants, dans une machine donnée. */
export interface Recipe {
  id: string;
  nom: string;
  /** Machine qui exécute la recette (ex. "Raffinerie", "Fonderie"). */
  machine: string;
  /** true si c'est une recette alternative (badge dans le rendu). */
  alternative?: boolean;
  intrants: Port[];
  /**
   * Extrants : le premier est le produit principal, les suivants sont des sous-produits.
   * Un sous-produit sans débouché est la cause n°1 de blocage d'une chaîne.
   */
  extrants: Port[];
}

/** La base de données du jeu, indexée par id. */
export interface Db {
  items: Record<string, Item>;
  recipes: Record<string, Recipe>;
}

/** Un nœud de la scène : une instance de recette posée par l'utilisateur. */
export interface Node {
  id: string;
  recette: string;
  /** Nombre de machines (multiplie débits intrants/extrants de la recette). Défaut : 1. */
  machines: number;
  /** Position [x, y] ; optionnelle (auto-layout différé). */
  pos?: [number, number];
  /** id du calque auquel appartient le nœud. */
  calque?: string;

  /**
   * IMPORT inter-notes : nom/chemin d'une autre note. Le nœud devient une « boîte
   * noire » exposant les LIVRABLES de cette note (ses sorties vers le Sink, sinon
   * son surplus net), multipliés par `machines`. Ses `intrants`/`extrants`/`machine`
   * sont alors DÉRIVÉS (résolus à la lecture, jamais sérialisés) et restent en sync.
   */
  import?: string;

  // --- Surcharges (débits PERSONNALISÉS, absolus) ---
  // Si `intrants` ou `extrants` est défini, le nœud n'utilise plus la recette de
  // la DB : ses débits sont ceux-ci tels quels (déjà en /min, pas × machines).
  // Permet d'éditer librement entrées/sorties tant que la DB du jeu est partielle.
  /** Machine personnalisée (sinon celle de la recette). */
  machine?: string;
  /** Intrants personnalisés (débits absolus /min). */
  intrants?: Port[];
  /** Extrants personnalisés (débits absolus /min). */
  extrants?: Port[];
}

/** Indique si un nœud porte des débits personnalisés (surcharge la recette DB). */
export function isCustomNode(n: Node): boolean {
  return n.intrants !== undefined || n.extrants !== undefined;
}

/**
 * Un lien = une décision de ROUTAGE explicite d'un produit d'un nœud vers un autre
 * (ou vers le Sink). C'est cet objet que lit le diagnostic pour repérer les orphelins.
 */
export interface Link {
  de: string;
  /** id d'un nœud destinataire, ou la chaîne littérale "SINK". */
  vers: string;
  produit: string;
  debit: number;
  /** true si le produit est réinjecté en amont (boucle / rétro-utilisation). */
  boucle?: boolean;
}

/** Cible spéciale d'un lien : l'AWESOME Sink (consomme n'importe quel surplus). */
export const SINK = "SINK";

/** Un calque : regroupe une portion de chaîne (modularité). */
export interface Layer {
  id: string;
  nom: string;
  icone?: string;
  couleur?: string;
  replie?: boolean;
}

/** La scène complète décrite par le bloc ```satisfactory. */
export interface Scene {
  noeuds: Node[];
  liens: Link[];
  calques: Layer[];
}

/** Sévérité d'un nœud (overlay couleur de la bordure). */
export type Status = "ok" | "warn" | "bad";

/** Une remarque de diagnostic rattachée à un nœud. */
export interface Issue {
  nodeId: string;
  severity: Status;
  /** Item concerné (sous-produit orphelin, surplus…). */
  item?: string;
  message: string;
}

/** Résultat du diagnostic : statut par nœud + liste détaillée des remarques. */
export interface Diagnostic {
  /** Statut agrégé (le pire) de chaque nœud. */
  status: Record<string, Status>;
  issues: Issue[];
}
