/**
 * Base de données DÉMO (en dur) — chaîne de l'aluminium, reprise de la maquette v4.
 *
 * ⚠️ Provisoire : sera remplacée en v0.2 par une génération depuis le `data.json`
 * de SatisfactoryTools (tous les crafts du jeu). Les débits ci-dessous sont
 * illustratifs et choisis pour produire un scénario de diagnostic lisible
 * (silice orpheline → bloqué ; surplus de charbon → sous-utilisé).
 *
 * Convention : les débits des recettes sont NOMINAUX par machine (à 100%), en /min.
 * Le débit réel d'un nœud = débit nominal × nombre de machines.
 * Une recette sans intrant représente une ressource brute (extracteur / pompe).
 */
import type { Db } from "./types";

export const DEMO_DB: Db = {
  items: {
    bauxite: { id: "bauxite", nom: "Minerai de bauxite", couleur: "#b5651d", etat: "solide", icone: "🟫" },
    eau: { id: "eau", nom: "Eau", couleur: "#2f80ed", etat: "fluide", icone: "💧" },
    charbon: { id: "charbon", nom: "Charbon", couleur: "#6b7280", etat: "solide", icone: "⬛" },
    "solution-alumine": { id: "solution-alumine", nom: "Solution d'alumine", couleur: "#e09b8a", etat: "fluide", icone: "🧪" },
    silice: { id: "silice", nom: "Silice", couleur: "#ddd0a7", etat: "solide", icone: "⬜" },
    ferraille: { id: "ferraille", nom: "Ferraille d'alu", couleur: "#9ca3af", etat: "solide", icone: "🔩" },
    "lingot-alu": { id: "lingot-alu", nom: "Lingot d'alu", couleur: "#d1d5db", etat: "solide", icone: "🟦" },
    "plaque-alu": { id: "plaque-alu", nom: "Plaque d'alu", couleur: "#e5e7eb", etat: "solide", icone: "▭" },
  },
  recipes: {
    // --- Ressources brutes (pas d'intrant) ---
    "extraction-bauxite": {
      id: "extraction-bauxite", nom: "Extraction de bauxite", machine: "Foreuse",
      intrants: [], extrants: [{ item: "bauxite", debit: 120 }],
    },
    "pompe-eau": {
      id: "pompe-eau", nom: "Pompe à eau", machine: "Pompe",
      intrants: [], extrants: [{ item: "eau", debit: 60 }],
    },
    "extraction-charbon": {
      id: "extraction-charbon", nom: "Extraction de charbon", machine: "Foreuse",
      intrants: [], extrants: [{ item: "charbon", debit: 80 }],
    },

    // --- Recettes de transformation ---
    "solution-alumine": {
      id: "solution-alumine", nom: "Solution d'alumine", machine: "Raffinerie",
      intrants: [{ item: "bauxite", debit: 60 }, { item: "eau", debit: 90 }],
      // produit principal + SOUS-PRODUIT silice (cause du blocage si non évacué)
      extrants: [{ item: "solution-alumine", debit: 120 }, { item: "silice", debit: 25 }],
    },
    "ferraille-alu": {
      id: "ferraille-alu", nom: "Ferraille d'alu", machine: "Raffinerie",
      intrants: [{ item: "solution-alumine", debit: 120 }, { item: "charbon", debit: 60 }],
      // ferraille + eau réinjectable en amont
      extrants: [{ item: "ferraille", debit: 120 }, { item: "eau", debit: 60 }],
    },
    "lingot-alu": {
      id: "lingot-alu", nom: "Lingot d'alu", machine: "Fonderie",
      intrants: [{ item: "ferraille", debit: 120 }],
      extrants: [{ item: "lingot-alu", debit: 30 }],
    },
    "plaque-alu": {
      id: "plaque-alu", nom: "Plaque d'alu", machine: "Constructeur",
      intrants: [{ item: "lingot-alu", debit: 30 }],
      extrants: [{ item: "plaque-alu", debit: 15 }],
    },
  },
};
