import { useEffect, useState } from "react";
import { ChevronDown, Plus, RotateCcw, X } from "lucide-react";
import type { Db, Link, Node, Port } from "../model/types";
import { isCustomNode } from "../model/types";
import { nodePorts } from "../model/ports";
import { clockOf, maxSloops } from "../model/power";
import type { NodePatch } from "../model/edit";
import { RecipePicker } from "./RecipePicker";

interface Props {
  node: Node;
  db: Db;
  /** Scene links — needed to resolve a generator's active fuel for its ports. */
  liens?: Link[];
  layers: { id: string; nom: string }[];
  wholeMachines: boolean;
  onChange: (patch: NodePatch) => void;
  onClose: () => void;
}

/**
 * Number field with a LOCAL draft: commits on blur / Enter (Escape cancels), so
 * the whole scene is not recomputed on every keystroke (unlike a controlled
 * input bound straight to the scene).
 */
function DraftNumber({
  value,
  min,
  max,
  step,
  onCommit,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    let n = Number(draft);
    if (!isFinite(n)) n = value;
    if (typeof min === "number") n = Math.max(min, n);
    if (typeof max === "number") n = Math.min(max, n);
    setDraft(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        else if (e.key === "Escape") { setDraft(String(value)); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
}

/**
 * Node editing panel.
 *  - Recipe + Machines: structured mode (rates = recipe × machines).
 *  - Custom rates: machine + hand-editable inputs/outputs
 *    (absolute rates /min) → overrides the recipe. "Apply" writes it all.
 */
export function NodeEditor({ node, db, liens, layers, wholeMachines, onChange, onClose }: Props) {
  const custom = isCustomNode(node);
  const [pickingRecipe, setPickingRecipe] = useState(false);

  // Local draft of the rates (avoids writing the .md on every keystroke).
  const eff = nodePorts(node, db, liens);
  const [machine, setMachine] = useState(eff.machine);
  const [intrants, setIntrants] = useState<Port[]>(eff.intrants);
  const [extrants, setExtrants] = useState<Port[]>(eff.extrants);

  // Draft: mirrors the effective rates while the node follows a recipe
  // (recipe/machines drive it), and freezes once it is customized (typing
  // must not be overwritten). Signature → reset when the node or recipe/machines change.
  const sig = custom ? `custom:${node.id}` : `recipe:${node.id}:${JSON.stringify(eff)}`;
  useEffect(() => {
    const p = nodePorts(node, db, liens);
    setMachine(p.machine);
    setIntrants(p.intrants);
    setExtrants(p.extrants);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Displayed rates are EFFECTIVE (× clock); store the base on apply so nodePorts
  // re-applies the clock factor (no double-scaling).
  const c = clockOf(node) / 100;
  const toBase = (list: Port[]) => list.map((p) => ({ ...p, debit: Math.round((p.debit / c) * 1e4) / 1e4 }));
  const applyPorts = () => onChange({ machine, intrants: toBase(intrants), extrants: toBase(extrants) });
  const resetToRecipe = () => onChange({ machine: undefined, intrants: undefined, extrants: undefined });
  const recForSloop = !custom ? db.recipes[node.recette] : undefined;
  const maxS = recForSloop && !recForSloop.production ? maxSloops(recForSloop.machine) : 0;

  const editRow = (
    list: Port[],
    set: (p: Port[]) => void,
    i: number,
    field: "item" | "debit",
    value: string,
  ) => {
    const next = list.map((p, j) =>
      j === i ? { ...p, [field]: field === "debit" ? Number(value) || 0 : value } : p,
    );
    set(next);
  };

  // Function (NOT a component) → inputs are not remounted on every keystroke.
  const portList = (title: string, list: Port[], set: (p: Port[]) => void) => (
    <div className="sfy-ports">
      <div className="sfy-ports-head">
        <span>{title}</span>
        <button className="sfy-mini" title="Add" onClick={() => set([...list, { item: "", debit: 0 }])}><Plus size={11} /></button>
      </div>
      {list.map((p, i) => (
        <div className="sfy-port-row" key={i}>
          <input
            className="sfy-port-item"
            placeholder="item"
            value={p.item}
            onChange={(e) => editRow(list, set, i, "item", e.target.value)}
          />
          <input
            className="sfy-port-debit"
            type="number"
            value={p.debit}
            onChange={(e) => editRow(list, set, i, "debit", e.target.value)}
          />
          <button className="sfy-mini" title="Remove" onClick={() => set(list.filter((_, j) => j !== i))}><X size={11} /></button>
        </div>
      ))}
    </div>
  );

  // IMPORT node (black box of another note): recipe and rates are derived
  // from the imported note → only the multiplier and the layer are editable.
  if (node.import) {
    return (
      <div className="sfy-editor nodrag nopan">
        <div className="sfy-editor-head">
          <b>Edit · {node.id}</b>
          <button className="sfy-editor-close" title="Close" onClick={onClose}><X size={13} /></button>
        </div>
        <div className="sfy-field">
          <span>Imports the production of</span>
          <div className="sfy-import-ref">{node.import}</div>
        </div>
        <label className="sfy-field">
          <span>Multiplier (× factories)</span>
          <DraftNumber
            min={wholeMachines ? 1 : 0}
            step={wholeMachines ? 1 : 0.5}
            value={node.machines > 0 ? node.machines : 1}
            onCommit={(n) => onChange({ machines: wholeMachines ? Math.max(1, Math.round(n)) : Math.max(0, n) })}
          />
        </label>
        <label className="sfy-field">
          <span>Layer</span>
          <select value={node.calque ?? ""} onChange={(e) => onChange({ calque: e.target.value || undefined })}>
            <option value="">(none)</option>
            {layers.map((l) => (
              <option key={l.id} value={l.id}>{l.nom}</option>
            ))}
          </select>
        </label>
        <div className="sfy-io-line">Rates derived from the imported note (auto-synced).</div>
      </div>
    );
  }

  const current = db.recipes[node.recette];
  return (
    <div className="sfy-editor nodrag nopan">
      <div className="sfy-editor-head">
        <b>Edit · {node.id}</b>
        <button className="sfy-editor-close" title="Close" onClick={onClose}><X size={13} /></button>
      </div>

      <label className="sfy-field">
        <span>Recipe</span>
        <button className="sfy-recipe-btn" onClick={() => setPickingRecipe((v) => !v)}>
          <span className="sfy-recipe-btn-label">
            {current ? `${current.nom} · ${current.machine}` : node.recette || "(pick…)"}
          </span>
          <ChevronDown size={12} />
        </button>
      </label>
      {pickingRecipe ? (
        <RecipePicker
          db={db}
          onPick={(id) => {
            setPickingRecipe(false);
            onChange({ recette: id, machine: undefined, intrants: undefined, extrants: undefined });
          }}
          onClose={() => setPickingRecipe(false)}
        />
      ) : null}

      {!custom ? (
        <label className="sfy-field">
          <span>Machines{wholeMachines ? " (whole)" : ""}</span>
          <DraftNumber
            min={wholeMachines ? 1 : 0}
            step={wholeMachines ? 1 : 0.5}
            value={node.machines > 0 ? node.machines : 1}
            onCommit={(n) => onChange({ machines: wholeMachines ? Math.max(1, Math.round(n)) : Math.max(0, n) })}
          />
        </label>
      ) : null}

      <label className="sfy-field" title="1–250%. Recipe rates scale linearly. Machine power scales as clock^1.321928; generators stay linear. On an extractor/custom source node it scales both the output rate and the power.">
        <span>Clock speed (%)</span>
        <DraftNumber
          min={1}
          max={250}
          step={5}
          value={node.clock ?? 100}
          onCommit={(n) => onChange({ clock: Math.min(250, Math.max(1, Math.round(n * 100) / 100)) })}
        />
      </label>

      {maxS > 0 ? (
        <label className="sfy-field" title="Somersloops inserted (production amplifier). Output ×(1+sloops/max) up to ×2; power ×(1+sloops/max)² up to ×4. Not for extractors/generators.">
          <span>Somersloops (0–{maxS})</span>
          <DraftNumber
            min={0}
            max={maxS}
            step={1}
            value={node.sloops ?? 0}
            onCommit={(n) => onChange({ sloops: Math.max(0, Math.min(maxS, Math.round(n))) })}
          />
        </label>
      ) : null}

      <label className="sfy-field">
        <span>Layer</span>
        <select value={node.calque ?? ""} onChange={(e) => onChange({ calque: e.target.value || undefined })}>
          <option value="">(none)</option>
          {layers.map((l) => (
            <option key={l.id} value={l.id}>{l.nom}</option>
          ))}
        </select>
      </label>

      <div className="sfy-editor-custom">
        <div className="sfy-custom-head">
          <span>{custom ? "Custom rates" : "Rates (× machines)"}</span>
          {custom ? (
            <button className="sfy-mini" title="Back to the recipe" onClick={resetToRecipe}><RotateCcw size={11} /></button>
          ) : null}
        </div>
        <label className="sfy-field">
          <span>Machine</span>
          <input value={machine} onChange={(e) => setMachine(e.target.value)} />
        </label>
        {portList("Inputs /min", intrants, setIntrants)}
        {portList("Outputs /min", extrants, setExtrants)}
        <button className="sfy-apply" onClick={applyPorts}>Apply rates</button>
      </div>
    </div>
  );
}
