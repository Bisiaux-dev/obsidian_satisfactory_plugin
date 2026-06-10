import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position, useReactFlow } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { Play, Repeat2, X } from "lucide-react";
import { useToggleLink } from "./inline";

/** Données portées par une arête : la matière transportée et son flux. */
export interface FlowEdgeData extends Record<string, unknown> {
  /** Couleur = le produit (teinte de l'item). */
  color: string;
  /** true = liquide/gaz → trait pointillé ; false = solide → trait plein. */
  fluid: boolean;
  /** Étiquette : nom du produit. */
  label: string;
  /** Sous-étiquette : débit. */
  debit: string;
  /** true si réinjection (boucle) → bout ♻ au lieu de ➤. */
  boucle?: boolean;
  /** Position de l'étiquette parmi les flèches parallèles (même source→cible). */
  labelIndex?: number;
  labelCount?: number;
  /** Identité du lien (pour basculer son bout au double-clic). */
  de?: string;
  vers?: string;
  produit?: string;
}

/** Orientation de la pointe selon le côté d'arrivée (handles alignés sur les axes). */
function capAngle(target: Position): number {
  switch (target) {
    case Position.Right: return 180;
    case Position.Top: return 90;
    case Position.Bottom: return -90;
    default: return 0; // Left → flux vers la droite
  }
}

export function FlowEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const d = data as FlowEdgeData;
  const { deleteElements } = useReactFlow();
  const toggleLink = useToggleLink();

  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });

  // Léger décalage du bout vers l'extérieur du nœud pour qu'il reste visible.
  const off = 7;
  const ox = targetPosition === Position.Left ? -off : targetPosition === Position.Right ? off : 0;
  const oy = targetPosition === Position.Top ? -off : targetPosition === Position.Bottom ? off : 0;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: d.color,
          strokeWidth: 3,
          strokeDasharray: d.fluid ? "8 5" : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="sfy-edge-label nodrag nopan"
          title="Double-click: toggle loop (reinjection)"
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (d.de && d.vers && d.produit) toggleLink?.(d.de, d.vers, d.produit);
          }}
          style={{
            position: "absolute",
            // décale verticalement les étiquettes des flèches parallèles pour éviter
            // qu'elles se superposent (cas des calques repliés → même cible).
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + ((d.labelIndex ?? 0) - (((d.labelCount ?? 1) - 1) / 2)) * 40}px)`,
            pointerEvents: "all",
            cursor: "pointer",
          }}
        >
          <button
            className="sfy-edge-del nodrag nopan"
            title="Delete this link"
            data-edge-id={id}
            onClick={(e) => {
              e.stopPropagation();
              void deleteElements({ edges: [{ id }] });
            }}
          >
            <X size={10} />
          </button>
          {d.label}
          <small>{d.debit}</small>
        </div>

        {/* Bout = sens du flux, toujours visible (➤) ou réinjection (♻). */}
        <div
          className="sfy-edge-cap"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${targetX + ox}px, ${targetY + oy}px)`,
          }}
        >
          {d.boucle ? (
            <span className="sfy-cap-loop" style={{ borderColor: d.color, color: d.color }}>
              <Repeat2 size={12} />
            </span>
          ) : (
            <span
              className="sfy-cap-arrow"
              style={{ color: d.color, transform: `rotate(${capAngle(targetPosition)}deg)` }}
            >
              <Play size={13} fill="currentColor" strokeWidth={0} />
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
