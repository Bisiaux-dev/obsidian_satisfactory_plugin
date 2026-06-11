/**
 * Web test bench (outside Obsidian): mounts the REAL GraphView + the model/diagnostic
 * + the serializer with the bundled game database (iron + plastic chain, same as
 * EXAMPLE.md), and displays the serialized `.md` scene live. onSceneChange remounts
 * GraphView (via `key`) → faithfully reproduces the plugin's behavior (the
 * write-back triggers a full re-render).
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { GraphView } from "../src/view/GraphView";
import { GAME_DB } from "../src/model/game-db";
import { diagnose } from "../src/model/diagnostic";
import { serializeScene } from "../src/serialize";
import type { Scene } from "../src/model/types";
import xyflowCss from "@xyflow/react/dist/style.css";
import appCss from "../styles.css";

const style = document.createElement("style");
style.textContent = `${xyflowCss}\n${appCss}`;
document.head.appendChild(style);

// Same scene as EXAMPLE.md: heavy oil residue is orphaned (expected 🔴),
// the ore miner overproduces (expected 🟡).
const INITIAL: Scene = {
  noeuds: [
    { id: "ore", recette: "", machines: 1, pos: [20, 60], machine: "Miner", intrants: [], extrants: [{ item: "iron-ore", debit: 60 }] },
    { id: "ingot", recette: "recipe-ingotiron-c", machines: 1, pos: [320, 60], calque: "smelting" },
    { id: "plate", recette: "recipe-ironplate-c", machines: 1, pos: [620, 60], calque: "smelting" },
    { id: "oil", recette: "", machines: 1, pos: [20, 360], machine: "Pump", intrants: [], extrants: [{ item: "crude-oil", debit: 30 }] },
    { id: "plastic", recette: "recipe-plastic-c", machines: 1, pos: [320, 360], calque: "petro" },
  ],
  liens: [
    { de: "ore", vers: "ingot", produit: "iron-ore", debit: 30 },
    { de: "ingot", vers: "plate", produit: "iron-ingot", debit: 30 },
    { de: "plate", vers: "SINK", produit: "iron-plate", debit: 20 },
    { de: "oil", vers: "plastic", produit: "crude-oil", debit: 30 },
    { de: "plastic", vers: "SINK", produit: "plastic", debit: 20 },
  ],
  calques: [
    { id: "smelting", nom: "Smelting", icone: "🔥", couleur: "#f59e0b" },
    { id: "petro", nom: "Petrochem", icone: "🛢️", couleur: "#3b82f6" },
  ],
};

function Harness() {
  const [scene, setScene] = useState<Scene>(INITIAL);
  const [ver, setVer] = useState(0);
  const update = (s: Scene) => {
    setScene(s);
    setVer((v) => v + 1);
  };
  const diag = diagnose(scene, GAME_DB);

  return (
    <div style={{ display: "flex", height: "100vh", gap: 8, padding: 8, boxSizing: "border-box" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <GraphView key={ver} scene={scene} db={GAME_DB} diagnostic={diag} onSceneChange={update} />
      </div>
      <div style={{ width: 360, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button data-test="reset" onClick={() => update(INITIAL)}>Reset</button>
          <span style={{ fontSize: 12, color: "#8a8d91" }}>
            status plastic: <b data-test="statusPlastic" style={{ color: "#fff" }}>{diag.status["plastic"]}</b>
          </span>
        </div>
        <pre
          data-test="serialized"
          style={{
            flex: 1, margin: 0, overflow: "auto", background: "#111", color: "#7CFC00",
            fontSize: 11, lineHeight: 1.4, padding: 8, borderRadius: 6, whiteSpace: "pre-wrap",
          }}
        >
          {serializeScene(scene)}
        </pre>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
