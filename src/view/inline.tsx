import { createContext, useContext, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import type { NodePatch } from "../model/edit";
import type { LinkCap } from "../model/types";

/** Context providing the node mutation to node components (inline editing). */
export const EditContext = createContext<((id: string, patch: NodePatch) => void) | null>(null);
export const useEditNode = () => useContext(EditContext);

/** Actions on a link, provided to edges: end-marker (arrow/loop/none), rate, menu. */
export interface LinkActions {
  /** Cycle the end marker: arrow ➤ → loop ♻ → none. */
  cycle: (de: string, vers: string, produit: string) => void;
  /** Set the end marker directly. */
  setCap: (de: string, vers: string, produit: string, cap: LinkCap) => void;
  /** Set the routed rate (drives the diagnostic). */
  setRate: (de: string, vers: string, produit: string, v: number) => void;
  /** Open the link context menu at client coordinates (right-click). */
  openMenu: (de: string, vers: string, produit: string, clientX: number, clientY: number) => void;
}
export const LinkContext = createContext<LinkActions | null>(null);
export const useLinkActions = () => useContext(LinkContext);

/** Plugin settings exposed to components (e.g. whole machines). */
export const SettingsContext = createContext<{ wholeMachines: boolean }>({ wholeMachines: false });
export const useSettings = () => useContext(SettingsContext);

/** Actions on a layer, provided to group headers / module nodes. */
export interface LayerActions {
  toggle: (layerId: string) => void;
  beginRename: (layerId: string) => void;
  applyRename: (layerId: string, nom: string) => void;
  /** id of the layer being renamed (state held by GraphView, stable). */
  editingId: string | null;
}
export const LayerContext = createContext<LayerActions | null>(null);
export const useLayerActions = () => useContext(LayerContext);

/**
 * Editable layer name (double-click). The "currently editing" state lives in
 * GraphView (via the context), not locally — because the layer node (box) is
 * recomputed on every render, which would wipe out local state.
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
 * Inline editable value: double-click → input, Enter/blur commits, Escape cancels.
 * `nodrag`/`stopPropagation` so as not to trigger the node drag.
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
