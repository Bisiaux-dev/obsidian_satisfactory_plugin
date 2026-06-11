import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { FileInput, TriangleAlert } from "lucide-react";
import type { Port, Status } from "../model/types";
import { DeleteButton } from "./DeleteButton";
import { Inline, useEditNode } from "./inline";

/** Data for a raw resource node (extractor / pump: no input). */
export interface RawNodeData extends Record<string, unknown> {
  icone?: string;
  /** Image icon (data-URI) of the extracted item; takes precedence over `icone`. */
  iconUrl?: string;
  nom: string;
  machine: string;
  debit: number;
  /** Clock speed (%) — scales the displayed/effective output of an extractor. */
  clock?: number;
  status: Status;
  issues: string[];
  /** Effective flow rates (to materialize an override on inline edit). */
  extrants: Port[];
  /** true if this node imports another note's production (📥 badge). */
  isImport?: boolean;
}

export function RawNode({ id, data }: NodeProps) {
  const d = data as RawNodeData;
  const editNode = useEditNode();
  // Displayed rates are EFFECTIVE (× clock); store the base so nodePorts re-applies
  // clock and the shown number stays what you typed (WYSIWYG).
  const c = (d.clock ?? 100) / 100;
  const r2 = (x: number) => Math.round(x * 1e4) / 1e4;
  const baseExtrants = (override?: string) =>
    d.extrants.map((p, i) =>
      i === 0 && override !== undefined ? { ...p, debit: r2((Number(override) || 0) / c) } : { ...p, debit: r2(p.debit / c) },
    );
  const setDebit = (v: string) => editNode?.(id, { machine: d.machine, intrants: [], extrants: baseExtrants(v) });

  return (
    <div className={`sfy-node sfy-raw ${d.status}`}>
      <DeleteButton id={id} />
      <div className="sfy-title">
        {d.iconUrl ? <img className="sfy-icon" src={d.iconUrl} alt="" /> : d.icone ? <span>{d.icone}</span> : null}
        <span>{d.nom}</span>
      </div>
      <div className="sfy-line">
        {d.isImport ? <FileInput size={11} className="sfy-line-ico" /> : null}
        <Inline value={d.machine} onCommit={(v) => editNode?.(id, { machine: v, intrants: [], extrants: baseExtrants() })} />
        {" · "}
        <Inline value={d.debit} type="number" suffix="/min" onCommit={setDebit} />
        {!d.isImport ? (
          <span>
            {" @ "}
            <Inline value={d.clock ?? 100} type="number" suffix="%" onCommit={(v) => editNode?.(id, { clock: Math.min(250, Math.max(1, Number(v) || 100)) })} />
          </span>
        ) : null}
      </div>
      {d.issues.map((msg, i) => (
        <div key={i} className="sfy-line sfy-issue"><TriangleAlert size={11} className="sfy-line-ico" /> {msg}</div>
      ))}

      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="source" position={Position.Bottom} id="b" isConnectable={false} />
    </div>
  );
}
