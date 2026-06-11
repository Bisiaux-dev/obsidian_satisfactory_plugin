import type { NodeProps } from "@xyflow/react";
import { ChevronDown } from "lucide-react";
import { LayerName, useLayerActions } from "./inline";

/** Data for a layer (group framing a portion of the chain). */
export interface GroupNodeData extends Record<string, unknown> {
  layerId: string;
  nom: string;
  icone?: string;
  couleur?: string;
}

/**
 * Layer = React Flow parent node. Member nodes have `parentId` pointing
 * to it; moving the layer moves all its members. The size is carried by
 * `node.style` (width/height), computed from the members' bounding box.
 */
export function GroupNode({ data }: NodeProps) {
  const d = data as GroupNodeData;
  const color = d.couleur ?? "#7c3aed";
  const layer = useLayerActions();
  return (
    <div
      className="sfy-group"
      style={{ borderColor: `${color}88`, background: `${color}14` }}
    >
      <div className="sfy-group-head" style={{ color, borderColor: `${color}88` }}>
        <button
          className="sfy-group-toggle"
          title="Collapse layer"
          style={{ color }}
          onClick={(e) => {
            e.stopPropagation();
            layer?.toggle(d.layerId);
          }}
        >
          <ChevronDown size={12} />
        </button>
        {d.icone ? `${d.icone} ` : ""}
        <LayerName layerId={d.layerId} nom={d.nom} />
      </div>
    </div>
  );
}
