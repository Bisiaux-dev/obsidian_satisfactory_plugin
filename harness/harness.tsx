/**
 * Banc d'essai web (hors Obsidian) : monte le VRAI GraphView + le modèle/diagnostic
 * + le sérialiseur avec la chaîne alumine, et affiche la scène `.md` sérialisée en
 * direct. onSceneChange remonte GraphView (via `key`) → reproduit fidèlement le
 * comportement du plugin (le write-back déclenche un re-render complet).
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { GraphView } from "../src/view/GraphView";
import { DEMO_DB } from "../src/model/db";
import { diagnose } from "../src/model/diagnostic";
import { serializeScene } from "../src/serialize";
import type { Scene } from "../src/model/types";
import xyflowCss from "@xyflow/react/dist/style.css";
import appCss from "../styles.css";

const style = document.createElement("style");
style.textContent = `${xyflowCss}\n${appCss}`;
document.head.appendChild(style);

const INITIAL: Scene = {
  noeuds: [
    { id: "bauxite", recette: "extraction-bauxite", machines: 1, pos: [20, 60] },
    { id: "eau", recette: "pompe-eau", machines: 1, pos: [20, 230] },
    { id: "charbon", recette: "extraction-charbon", machines: 2, pos: [20, 400] },
    { id: "A", recette: "solution-alumine", machines: 2, pos: [280, 110], calque: "lingots" },
    { id: "B", recette: "ferraille-alu", machines: 2, pos: [560, 110], calque: "lingots" },
    { id: "C", recette: "lingot-alu", machines: 2, pos: [840, 140], calque: "lingots" },
    { id: "D", recette: "plaque-alu", machines: 2, pos: [1140, 140], calque: "plaques" },
  ],
  liens: [
    { de: "bauxite", vers: "A", produit: "bauxite", debit: 120 },
    { de: "eau", vers: "A", produit: "eau", debit: 60 },
    { de: "charbon", vers: "B", produit: "charbon", debit: 120 },
    { de: "A", vers: "B", produit: "solution-alumine", debit: 240 },
    { de: "B", vers: "A", produit: "eau", debit: 120, boucle: true },
    { de: "B", vers: "C", produit: "ferraille", debit: 240 },
    { de: "C", vers: "D", produit: "lingot-alu", debit: 60 },
    { de: "D", vers: "SINK", produit: "plaque-alu", debit: 30 },
  ],
  calques: [
    { id: "lingots", nom: "Lingots d'alu", icone: "🟦", couleur: "#3b82f6" },
    { id: "plaques", nom: "Plaques", icone: "🟧", couleur: "#f59e0b" },
  ],
};

function Harness() {
  const [scene, setScene] = useState<Scene>(INITIAL);
  const [ver, setVer] = useState(0);
  const update = (s: Scene) => {
    setScene(s);
    setVer((v) => v + 1);
  };
  const diag = diagnose(scene, DEMO_DB);

  return (
    <div style={{ display: "flex", height: "100vh", gap: 8, padding: 8, boxSizing: "border-box" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <GraphView key={ver} scene={scene} db={DEMO_DB} diagnostic={diag} onSceneChange={update} />
      </div>
      <div style={{ width: 360, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button data-test="reset" onClick={() => update(INITIAL)}>Reset</button>
          <span style={{ fontSize: 12, color: "#8a8d91" }}>
            statut A : <b data-test="statusA" style={{ color: "#fff" }}>{diag.status["A"]}</b>
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
