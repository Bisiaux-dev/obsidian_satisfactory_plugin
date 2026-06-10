import type { NodeProps } from "@xyflow/react";
import { ChevronDown } from "lucide-react";
import { LayerName, useLayerActions } from "./inline";

/** Données d'un calque (groupe encadrant une portion de chaîne). */
export interface GroupNodeData extends Record<string, unknown> {
  layerId: string;
  nom: string;
  icone?: string;
  couleur?: string;
}

/**
 * Calque = nœud parent React Flow. Les nœuds membres ont `parentId` pointant
 * vers lui ; déplacer le calque déplace tous ses membres. La taille est portée
 * par `node.style` (width/height), calculée depuis la boîte englobante des membres.
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
