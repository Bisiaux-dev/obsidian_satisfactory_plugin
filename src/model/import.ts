/**
 * Cross-note import (modularity): a "factory" note exposes its DELIVERABLES, which
 * another note can import as a black box and route into its own chain.
 *
 * Pure (except for reading the file, done by the caller): resolution consists of
 * extracting the ```satisfactory block from the referenced note and deriving its outputs.
 */
import type { Db, Port, Scene } from "./types";
import { SINK } from "./types";
import { nodePorts } from "./ports";

const round = (n: number) => Math.round(n * 100) / 100;

/** Extracts the body of the FIRST ```satisfactory block from a Markdown text (or null). */
export function extractSatisfactoryBlock(markdown: string): string | null {
  const m = markdown.match(/```satisfactory[^\n]*\n([\s\S]*?)```/);
  return m ? m[1] : null;
}

/**
 * Deliverables of a scene = what it makes available as output:
 *  1. preferably, its explicit links to the Sink (the intended "finished products");
 *  2. otherwise, its net surplus (Σ outputs − Σ inputs, positive items).
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
    const p = nodePorts(n, db, scene.liens);
    for (const e of p.extrants) bal.set(e.item, (bal.get(e.item) ?? 0) + e.debit);
    for (const i of p.intrants) bal.set(i.item, (bal.get(i.item) ?? 0) - i.debit);
  }
  return [...bal]
    .filter(([, v]) => v > 0.01)
    .map(([item, debit]) => ({ item, debit: round(debit) }));
}
