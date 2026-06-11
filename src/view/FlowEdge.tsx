import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position, useReactFlow } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import { Play, Repeat2, X } from "lucide-react";
import type { LinkCap } from "../model/types";
import { Inline, useLinkActions } from "./inline";

/** Data carried by an edge: the transported material and its flow. */
export interface FlowEdgeData extends Record<string, unknown> {
  /** Color = the product (item's hue). */
  color: string;
  /** true = liquid/gas → dashed stroke; false = solid → plain stroke. */
  fluid: boolean;
  /** Label: product name. */
  label: string;
  /** Sub-label: flow rate (display string). */
  debit: string;
  /** Numeric flow rate (editable). */
  debitNum?: number;
  /** true if reinjection (loop) → ♻ cap instead of ➤. */
  boucle?: boolean;
  /** End marker state: arrow / loop / none. */
  cap?: LinkCap;
  /** Label position among parallel arrows (same source→target). */
  labelIndex?: number;
  labelCount?: number;
  /** Link identity (cap / rate / menu). */
  de?: string;
  vers?: string;
  produit?: string;
}

/** Arrowhead orientation based on the arrival side (handles aligned on the axes). */
function capAngle(target: Position): number {
  switch (target) {
    case Position.Right: return 180;
    case Position.Top: return 90;
    case Position.Bottom: return -90;
    default: return 0; // Left → flow to the right
  }
}

export function FlowEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const d = data as FlowEdgeData;
  const { deleteElements } = useReactFlow();
  const linkActions = useLinkActions();
  const cap: LinkCap = d.cap ?? (d.boucle ? "boucle" : "fleche");
  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (d.de && d.vers && d.produit) linkActions?.openMenu(d.de, d.vers, d.produit, e.clientX, e.clientY);
  };

  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });

  // Slight offset of the cap toward the outside of the node so it stays visible.
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
          title="Right-click: arrow / loop / none · Double-click the rate to edit it"
          onContextMenu={menu}
          style={{
            position: "absolute",
            // vertically offsets the labels of parallel arrows so they
            // don't overlap (case of collapsed layers → same target).
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
          <small>
            <Inline
              value={d.debitNum ?? 0}
              type="number"
              onCommit={(v) => {
                if (d.de && d.vers && d.produit) linkActions?.setRate(d.de, d.vers, d.produit, Number(v) || 0);
              }}
            />
            /min
          </small>
        </div>

        {/* Cap = flow direction: arrow (➤), reinjection (♻) or none. */}
        <div
          className="sfy-edge-cap nodrag nopan"
          title="Right-click: arrow / loop / none"
          onContextMenu={menu}
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${targetX + ox}px, ${targetY + oy}px)`,
            pointerEvents: "all",
            cursor: "pointer",
          }}
        >
          {cap === "boucle" ? (
            <span className="sfy-cap-loop" style={{ borderColor: d.color, color: d.color }}>
              <Repeat2 size={12} />
            </span>
          ) : cap === "rien" ? (
            <span className="sfy-cap-none" style={{ borderColor: d.color, background: d.color }} />
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
