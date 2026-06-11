import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { Cog, Star, TriangleAlert, Zap } from "lucide-react";
import type { Port, Status } from "../model/types";
import { MACHINE_ICONS } from "../model/machine-icons";
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
  /** Clock speed (%) and Somersloops (with the machine's max) of the node. */
  clock?: number;
  sloops?: number;
  maxSloops?: number;
  /** Flow rate of the main product (total = nominal × machines × clock × amp). */
  debit: number;
  /** Power produced (MW) for a generator node (0 otherwise). */
  prod?: number;
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
  // Editing a rate freezes the node to a custom node; the displayed values are
  // EFFECTIVE (post clock×amp), so divide by the clock factor to store the base
  // (nodePorts re-applies clock → the effective number stays what you see).
  const c = (d.clock ?? 100) / 100;
  const r2 = (x: number) => Math.round(x * 1e4) / 1e4;
  const base = (list: Port[]) => list.map((p) => ({ ...p, debit: r2(p.debit / c) }));
  const setOutDebit = (v: string) =>
    editNode?.(id, {
      machine: d.machine,
      intrants: base(d.intrants),
      extrants: base(d.extrants).map((p, i) => (i === 0 ? { ...p, debit: r2((Number(v) || 0) / c) } : p)),
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
        {MACHINE_ICONS[d.machine] ? (
          <img className="sfy-machine-ico" src={MACHINE_ICONS[d.machine]} alt="" title={d.machine} />
        ) : (
          <Cog size={11} className="sfy-line-ico" />
        )}{" "}
        <Inline value={d.machine} onCommit={(v) => editNode?.(id, { machine: v, intrants: base(d.intrants), extrants: base(d.extrants) })} />
        {" ×"}
        <Inline value={d.machines} type="number" onCommit={(v) => editNode?.(id, { machines: normMachines(v) })} />
        {" @ "}
        <Inline value={d.clock ?? 100} type="number" suffix="%" onCommit={(v) => editNode?.(id, { clock: Math.min(250, Math.max(1, Number(v) || 100)) })} />
      </div>
      {(d.maxSloops ?? 0) > 0 && (d.sloops ?? 0) > 0 ? (
        <div className="sfy-line sfy-sloop">
          <Star size={11} className="sfy-line-ico" /> {d.sloops}/{d.maxSloops} somersloop → output ×{Math.round((1 + (d.sloops ?? 0) / (d.maxSloops ?? 1)) * 100) / 100}
        </div>
      ) : null}
      {d.extrants.length > 0 ? (
        <div className="sfy-line">
          Output: <Inline value={d.debit} type="number" suffix="/min" onCommit={setOutDebit} />
        </div>
      ) : null}
      {d.prod ? (
        <div className="sfy-line sfy-power"><Zap size={11} className="sfy-line-ico" /> {Math.round(d.prod * 100) / 100} MW</div>
      ) : null}
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
