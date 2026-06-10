/**
 * Import inter-notes (modularité) : une note « usine » expose ses LIVRABLES, qu'une
 * autre note peut importer comme une boîte noire et router dans sa propre chaîne.
 *
 * Pur (sauf la lecture du fichier, faite par l'appelant) : la résolution consiste à
 * extraire le bloc ```satisfactory de la note référencée et à en déduire ses sorties.
 */
import type { Db, Port, Scene } from "./types";
import { SINK } from "./types";
import { nodePorts } from "./ports";

const round = (n: number) => Math.round(n * 100) / 100;

/** Extrait le corps du PREMIER bloc ```satisfactory d'un texte Markdown (ou null). */
export function extractSatisfactoryBlock(markdown: string): string | null {
  const m = markdown.match(/```satisfactory[^\n]*\n([\s\S]*?)```/);
  return m ? m[1] : null;
}

/**
 * Livrables d'une scène = ce qu'elle met à disposition en sortie :
 *  1. en priorité, ses liens explicites vers le Sink (les « produits finis » voulus) ;
 *  2. sinon, son surplus net (Σ extrants − Σ intrants, items positifs).
 */
export function sceneExports(scene: Scene, db: Db): Port[] {
  const sink = new Map<string, number>();
  for (const l of scene.liens) {
    if (l.vers === SINK) sink.set(l.produit, (sink.get(l.produit) ?? 0) + l.debit);
  }
  if (sink.size > 0) {
    return [...sink].map(([item, debit]) => ({ item, debit: round(debit) }));
  }
  const bal = new Map<string, number>();
  for (const n of scene.noeuds) {
    const p = nodePorts(n, db);
    for (const e of p.extrants) bal.set(e.item, (bal.get(e.item) ?? 0) + e.debit);
    for (const i of p.intrants) bal.set(i.item, (bal.get(i.item) ?? 0) - i.debit);
  }
  return [...bal]
    .filter(([, v]) => v > 0.01)
    .map(([item, debit]) => ({ item, debit: round(debit) }));
}
