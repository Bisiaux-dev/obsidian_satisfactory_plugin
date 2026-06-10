import { createContext, useContext, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import type { NodePatch } from "../model/edit";

/** Contexte fournissant la mutation d'un nœud aux composants de nœud (édition inline). */
export const EditContext = createContext<((id: string, patch: NodePatch) => void) | null>(null);
export const useEditNode = () => useContext(EditContext);

/** Contexte pour basculer le bout d'un lien (➤ ↔ ♻) au double-clic sur la flèche. */
export const LinkContext = createContext<((de: string, vers: string, produit: string) => void) | null>(null);
export const useToggleLink = () => useContext(LinkContext);

/** Réglages du plugin exposés aux composants (ex. machines entières). */
export const SettingsContext = createContext<{ wholeMachines: boolean }>({ wholeMachines: false });
export const useSettings = () => useContext(SettingsContext);

/** Actions sur un calque, fournies aux en-têtes de groupe / nœuds module. */
export interface LayerActions {
  toggle: (layerId: string) => void;
  beginRename: (layerId: string) => void;
  applyRename: (layerId: string, nom: string) => void;
  /** id du calque en cours de renommage (état porté par GraphView, stable). */
  editingId: string | null;
}
export const LayerContext = createContext<LayerActions | null>(null);
export const useLayerActions = () => useContext(LayerContext);

/**
 * Nom de calque éditable (double-clic). L'état "en cours d'édition" vit dans
 * GraphView (via le contexte), pas localement — car le nœud-calque (boîte) est
 * recalculé à chaque rendu, ce qui effacerait un état local.
 */
export function LayerName({ layerId, nom }: { layerId: string; nom: string }) {
  const a = useLayerActions();
  if (a && a.editingId === layerId) {
    return (
      <input
        className="sfy-inline-input nodrag nopan"
        autoFocus
        defaultValue={nom}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => a.applyRename(layerId, e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") a.applyRename(layerId, (e.target as HTMLInputElement).value);
          else if (e.key === "Escape") a.applyRename(layerId, nom);
        }}
      />
    );
  }
  return (
    <span className="sfy-layername">
      <span
        className="sfy-inline nodrag"
        title="Double-click to rename"
        onDoubleClick={(e) => {
          e.stopPropagation();
          a?.beginRename(layerId);
        }}
      >
        {nom}
      </span>
      <button
        className="sfy-rename-btn nodrag"
        title="Rename layer"
        onClick={(e) => {
          e.stopPropagation();
          a?.beginRename(layerId);
        }}
      >
        <Pencil size={10} />
      </button>
    </span>
  );
}

/**
 * Valeur éditable inline : double-clic → input, Entrée/blur valide, Échap annule.
 * `nodrag`/`stopPropagation` pour ne pas déclencher le drag du nœud.
 */
export function Inline({
  value,
  type = "text",
  suffix,
  onCommit,
}: {
  value: string | number;
  type?: "text" | "number";
  suffix?: string;
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);

  if (!editing) {
    return (
      <span
        className="sfy-inline nodrag"
        title="Double-click to edit"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraft(String(value));
          setEditing(true);
        }}
      >
        {value}{suffix ?? ""}
      </span>
    );
  }

  const commit = () => {
    setEditing(false);
    if (draft !== String(value)) onCommit(draft);
  };

  return (
    <input
      ref={ref}
      autoFocus
      className="sfy-inline-input nodrag nopan"
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}
