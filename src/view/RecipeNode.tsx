import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { Cog, Star, TriangleAlert } from "lucide-react";
import type { Port, Status } from "../model/types";
import { DeleteButton } from "./DeleteButton";
import { Inline, useEditNode } from "./inline";

/** Data carried by a recipe node in the React Flow graph. */
export interface RecipeNodeData extends Record<string, unknown> {
  icone?: string;
  /** Image icon (data-URI) of the produced item; takes precedence over `icone`. */
  iconUrl?: string;
  produit: string;
  recette: string;
  alternative?: boolean;
  machine: string;
  machines: number;
  /** Flow rate of the main product (total = nominal × machines). */
  debit: number;
  status: Status;
  badge: string;
  /** Diagnostic messages to display in the node. */
  issues: string[];
  /** Effective flow rates (to materialize an override during an inline edit). */
  intrants: Port[];
  extrants: Port[];
  /** Setting: force a whole number of machines. */
  wholeMachines?: boolean;
}

/** Badge text; the colored dot is rendered in CSS (::before on .sfy-badge). */
const BADGE: Record<Status, string> = { ok: "OK", warn: "CHECK", bad: "BLOCKED" };

export function RecipeNode({ id, data }: NodeProps) {
  const d = data as RecipeNodeData;
  const editNode = useEditNode();
  const normMachines = (v: string) => {
    const n = Number(v) || 0;
    return d.wholeMachines ? Math.max(1, Math.round(n)) : Math.max(0, n);
  };
  // Editing a flow rate/the machine → materializes an override (absolute flow rates).
  const setOutDebit = (v: string) =>
    editNode?.(id, {
      machine: d.machine,
      intrants: d.intrants,
      extrants: d.extrants.map((p, i) => (i === 0 ? { ...p, debit: Number(v) || 0 } : p)),
    });

  return (
    <div className={`sfy-node ${d.status}`}>
      <DeleteButton id={id} />
      <span className={`sfy-badge ${d.status}`}>{BADGE[d.status]}</span>
      <div className="sfy-title">
        {d.iconUrl ? <img className="sfy-icon" src={d.iconUrl} alt="" /> : d.icone ? <span>{d.icone}</span> : null}
        <span>{d.produit}</span>
      </div>
      <div className="sfy-line">
        Recipe: {d.recette}
        {d.alternative ? <Star size={10} className="sfy-alt-star" /> : null}
      </div>
      <div className="sfy-line">
        <Cog size={11} className="sfy-line-ico" />{" "}
        <Inline value={d.machine} onCommit={(v) => editNode?.(id, { machine: v, intrants: d.intrants, extrants: d.extrants })} />
        {" ×"}
        <Inline value={d.machines} type="number" onCommit={(v) => editNode?.(id, { machines: normMachines(v) })} />
      </div>
      <div className="sfy-line">
        Output: <Inline value={d.debit} type="number" suffix="/min" onCommit={setOutDebit} />
      </div>
      {d.issues.map((msg, i) => (
        <div key={i} className="sfy-line sfy-issue"><TriangleAlert size={11} className="sfy-line-ico" /> {msg}</div>
      ))}

      <Handle type="target" position={Position.Left} id="l" />
      <Handle type="source" position={Position.Right} id="r" />
      {/* bottom handles: loop rendering only (not connectable with the mouse) */}
      <Handle type="source" position={Position.Bottom} id="b" isConnectable={false} />
      <Handle type="target" position={Position.Bottom} id="bt" isConnectable={false} />
    </div>
  );
}
