import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { ChevronRight } from "lucide-react";
import type { Port } from "../model/types";
import { LayerName, useLayerActions } from "./inline";

/** Données d'un calque REPLIÉ (vue module à ports agrégés). */
export interface ModuleNodeData extends Record<string, unknown> {
  layerId: string;
  nom: string;
  icone?: string;
  couleur?: string;
  /** Items consommés depuis l'extérieur. */
  intrants: Port[];
  /** Items fournis à l'extérieur. */
  extrants: Port[];
  /** Nombre de nœuds repliés. */
  count: number;
}

const fmt = (p: Port, name: (id: string) => string) => `${name(p.item)} ${Math.round(p.debit * 100) / 100}`;

export function ModuleNode({ data }: NodeProps) {
  const d = data as ModuleNodeData;
  const color = d.couleur ?? "#7c3aed";
  const layer = useLayerActions();
  const name = (id: string) => id; // affichage par id (le nom complet vit côté items)

  return (
    <div className="sfy-module" style={{ borderColor: color }}>
      <div className="sfy-module-head" style={{ color }}>
        <button
          className="sfy-group-toggle"
          title="Expand layer"
          style={{ color }}
          onClick={(e) => {
            e.stopPropagation();
            layer?.toggle(d.layerId);
          }}
        >
          <ChevronRight size={12} />
        </button>
        {d.icone ? `${d.icone} ` : ""}
        <LayerName layerId={d.layerId} nom={d.nom} />
        <span className="sfy-module-count">{d.count} nodes</span>
      </div>
      <div className="sfy-module-io">
        <div className="sfy-io-col">
          <span className="sfy-io-title">Inputs</span>
          {d.intrants.length === 0 ? <div className="sfy-io-line">—</div> :
            d.intrants.map((p) => <div className="sfy-io-line" key={p.item}>{fmt(p, name)}</div>)}
        </div>
        <div className="sfy-io-col">
          <span className="sfy-io-title">Outputs</span>
          {d.extrants.length === 0 ? <div className="sfy-io-line">—</div> :
            d.extrants.map((p) => <div className="sfy-io-line" key={p.item}>{fmt(p, name)}</div>)}
        </div>
      </div>

      <Handle type="target" position={Position.Left} id="l" />
      <Handle type="source" position={Position.Right} id="r" />
    </div>
  );
}
