import { useMemo, useState } from "react";
import { Target, X } from "lucide-react";
import { GAME_DB, BASE_ITEMS, INFINITE_ITEMS } from "../model/game-db";
import { optimize, sceneFromSolution } from "../model/solver";
import type { Objective, SolveResult } from "../model/solver";
import type { Scene } from "../model/types";

interface Props {
  onGenerate: (scene: Scene) => void;
  onClose: () => void;
  onNotice?: (m: string) => void;
}

/**
 * Panneau « Aide au besoin » (F3) : pour un item + un débit voulu, calcule la
 * chaîne qui minimise les ressources brutes (via le solveur LP) et peut la
 * générer dans le bloc.
 */
export function Optimizer({ onGenerate, onClose, onNotice }: Props) {
  const items = useMemo(
    () => Object.values(GAME_DB.items).sort((a, b) => a.nom.localeCompare(b.nom)),
    [],
  );
  const [query, setQuery] = useState("");
  const [rate, setRate] = useState(60);
  const [objective, setObjective] = useState<Objective>("raw");
  const [allowAlt, setAllowAlt] = useState(true);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);

  const resolve = (value: string): string | null => {
    const it = items.find((i) => i.nom === value || i.id === value);
    return it ? it.id : null;
  };
  const name = (id: string) => GAME_DB.items[id]?.nom ?? id;
  const totalRaw = result?.raw.reduce((s, r) => s + r.debit, 0) ?? 0;

  const onCompute = () => {
    const id = resolve(query);
    if (!id) {
      onNotice?.("Item not found — pick one from the list.");
      return;
    }
    setTargetId(id);
    setResult(optimize(GAME_DB, id, rate, BASE_ITEMS, INFINITE_ITEMS, { objective, allowAlternates: allowAlt }));
  };

  const onGen = () => {
    if (!result?.ok || !targetId) return;
    onGenerate(sceneFromSolution(GAME_DB, result, targetId, rate, INFINITE_ITEMS));
    onNotice?.("Optimal chain generated.");
    onClose();
  };

  return (
    <div className="sfy-editor sfy-optimizer nodrag nopan">
      <div className="sfy-editor-head">
        <b><Target size={13} /> Optimize</b>
        <button className="sfy-editor-close" title="Close" onClick={onClose}><X size={13} /></button>
      </div>

      <label className="sfy-field">
        <span>I want to produce</span>
        <input
          list="sfy-item-list"
          placeholder="e.g. Reinforced Iron Plate"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onCompute(); }}
        />
        <datalist id="sfy-item-list">
          {items.map((i) => <option key={i.id} value={i.nom} />)}
        </datalist>
      </label>

      <label className="sfy-field">
        <span>Rate (/min)</span>
        <input
          type="number"
          min={0}
          step={1}
          value={rate}
          onChange={(e) => setRate(Math.max(0, Number(e.target.value) || 0))}
          onKeyDown={(e) => { if (e.key === "Enter") onCompute(); }}
        />
      </label>

      <label className="sfy-field">
        <span>Minimize</span>
        <select value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>
          <option value="raw">Raw resources</option>
          <option value="machines">Machine count</option>
        </select>
      </label>

      <label className="sfy-check">
        <input type="checkbox" checked={allowAlt} onChange={(e) => setAllowAlt(e.target.checked)} />
        <span>Allow alternate recipes</span>
      </label>

      <button className="sfy-btn" onClick={onCompute}>Compute</button>

      {result ? (
        result.ok ? (
          <div className="sfy-opt-result">
            <div className="sfy-opt-raw">
              <span className="sfy-io-title">Raw resources (total {Math.round(totalRaw * 100) / 100}/min)</span>
              {result.raw.length === 0 ? <div className="sfy-io-line">— (already raw)</div> :
                result.raw.map((r) => <div className="sfy-io-line" key={r.item}>{name(r.item)} : {r.debit}/min</div>)}
            </div>
            <div className="sfy-opt-recipes">
              <span className="sfy-io-title">{result.recipes.length} recipe(s)</span>
              {result.recipes.slice(0, 8).map((r) => (
                <div className="sfy-io-line" key={r.id}>{GAME_DB.recipes[r.id]?.nom} ×{r.machines}</div>
              ))}
              {result.recipes.length > 8 ? <div className="sfy-io-line">… +{result.recipes.length - 8}</div> : null}
            </div>
            <button className="sfy-apply" onClick={onGen}>Generate the chain</button>
          </div>
        ) : (
          <div className="sfy-io-line sfy-issue">{result.error}</div>
        )
      ) : null}
    </div>
  );
}
