import { useEffect, useState } from "react";
import { ChevronDown, Plus, RotateCcw, X } from "lucide-react";
import type { Db, Node, Port } from "../model/types";
import { isCustomNode } from "../model/types";
import { nodePorts } from "../model/ports";
import type { NodePatch } from "../model/edit";
import { RecipePicker } from "./RecipePicker";

interface Props {
  node: Node;
  db: Db;
  layers: { id: string; nom: string }[];
  wholeMachines: boolean;
  onChange: (patch: NodePatch) => void;
  onClose: () => void;
}

/**
 * Node editing panel.
 *  - Recipe + Machines: structured mode (rates = recipe × machines).
 *  - Custom rates: machine + hand-editable inputs/outputs
 *    (absolute rates /min) → overrides the recipe. "Apply" writes it all.
 */
export function NodeEditor({ node, db, layers, wholeMachines, onChange, onClose }: Props) {
  const custom = isCustomNode(node);
  const [pickingRecipe, setPickingRecipe] = useState(false);

  // Local draft of the rates (avoids writing the .md on every keystroke).
  const eff = nodePorts(node, db);
  const [machine, setMachine] = useState(eff.machine);
  const [intrants, setIntrants] = useState<Port[]>(eff.intrants);
  const [extrants, setExtrants] = useState<Port[]>(eff.extrants);

  // Draft: mirrors the effective rates while the node follows a recipe
  // (recipe/machines drive it), and freezes once it is customized (typing
  // must not be overwritten). Signature → reset when the node or recipe/machines change.
  const sig = custom ? `custom:${node.id}` : `recipe:${node.id}:${JSON.stringify(eff)}`;
  useEffect(() => {
    const p = nodePorts(node, db);
    setMachine(p.machine);
    setIntrants(p.intrants);
    setExtrants(p.extrants);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const applyPorts = () => onChange({ machine, intrants, extrants });
  const resetToRecipe = () => onChange({ machine: undefined, intrants: undefined, extrants: undefined });

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
          <input
            type="number"
            min={wholeMachines ? 1 : 0}
            step={wholeMachines ? 1 : 0.5}
            value={node.machines > 0 ? node.machines : 1}
            onChange={(e) => {
              const n = Number(e.target.value) || 0;
              onChange({ machines: wholeMachines ? Math.max(1, Math.round(n)) : Math.max(0, n) });
            }}
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
          <input
            type="number"
            min={wholeMachines ? 1 : 0}
            step={wholeMachines ? 1 : 0.5}
            value={node.machines > 0 ? node.machines : 1}
            onChange={(e) => {
              const n = Number(e.target.value) || 0;
              onChange({ machines: wholeMachines ? Math.max(1, Math.round(n)) : Math.max(0, n) });
            }}
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
