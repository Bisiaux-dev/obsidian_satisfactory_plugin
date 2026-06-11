/**
 * Scene → ```satisfactory block body serializer.
 *
 * Produces the same compact inline style you would write by hand (one element
 * per line), so the `.md` stays readable by humans AND by an AI after a
 * write-back. This is the "write" half of the "`.md` = source of truth" loop
 * (the "read" half lives in schema.ts).
 *
 * Always writes the English keys (nodes/links/layers, recipe, rate, from/to…).
 * The parser still accepts the legacy French keys on read.
 *
 * ⚠️ Rewrites the whole block: comments inside the block are lost (accepted
 * trade-off of the write-back, see the design doc).
 */
import type { Layer, Link, Node, Port, Scene } from "./model/types";
import { isCustomNode } from "./model/types";

/** Escapes a text value as a double-quoted YAML string. */
function q(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** id/slug: safe unquoted if it only contains [A-Za-z0-9_-]. */
function slug(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : q(value);
}

function serializePorts(ports: Port[]): string {
  return `[${ports.map((p) => `{ item: ${slug(p.item)}, rate: ${p.debit} }`).join(", ")}]`;
}

function serializeNode(n: Node): string {
  // Import node: only `import` is written; its rates/machine are DERIVED from
  // the referenced note (resolved on read) → never serialized.
  if (n.import) {
    const parts = [`id: ${slug(n.id)}`, `import: ${slug(n.import)}`, `machines: ${n.machines}`];
    if (n.pos) parts.push(`pos: [${Math.round(n.pos[0])}, ${Math.round(n.pos[1])}]`);
    if (n.calque) parts.push(`layer: ${slug(n.calque)}`);
    return `  - { ${parts.join(", ")} }`;
  }
  const parts = [`id: ${slug(n.id)}`, `recipe: ${slug(n.recette)}`, `machines: ${n.machines}`];
  if (typeof n.clock === "number" && n.clock !== 100) parts.push(`clock: ${n.clock}`);
  if (typeof n.sloops === "number" && n.sloops > 0 && !isCustomNode(n)) parts.push(`sloops: ${n.sloops}`);
  if (n.pos) parts.push(`pos: [${Math.round(n.pos[0])}, ${Math.round(n.pos[1])}]`);
  if (n.calque) parts.push(`layer: ${slug(n.calque)}`);
  // Custom overrides (absolute rates) when present.
  if (n.machine) parts.push(`machine: ${slug(n.machine)}`);
  if (n.intrants) parts.push(`inputs: ${serializePorts(n.intrants)}`);
  if (n.extrants) parts.push(`outputs: ${serializePorts(n.extrants)}`);
  return `  - { ${parts.join(", ")} }`;
}

function serializeLink(l: Link): string {
  const parts = [
    `from: ${slug(l.de)}`,
    `to: ${slug(l.vers)}`,
    `product: ${slug(l.produit)}`,
    `rate: ${l.debit}`,
  ];
  const cap = l.cap ?? (l.boucle ? "boucle" : "fleche");
  if (cap === "boucle") parts.push(`loop: true`);
  else if (cap === "rien") parts.push(`cap: none`);
  return `  - { ${parts.join(", ")} }`;
}

function serializeLayer(c: Layer): string {
  const parts = [`id: ${slug(c.id)}`, `name: ${q(c.nom)}`];
  if (c.icone) parts.push(`icon: ${q(c.icone)}`);
  if (c.couleur) parts.push(`color: ${q(c.couleur)}`);
  if (c.replie) parts.push(`collapsed: true`);
  return `  - { ${parts.join(", ")} }`;
}

export function serializeScene(scene: Scene): string {
  const lines: string[] = [];
  lines.push("nodes:");
  scene.noeuds.forEach((n) => lines.push(serializeNode(n)));
  if (scene.liens.length > 0) {
    lines.push("links:");
    scene.liens.forEach((l) => lines.push(serializeLink(l)));
  }
  if (scene.calques.length > 0) {
    lines.push("layers:");
    scene.calques.forEach((c) => lines.push(serializeLayer(c)));
  }
  return lines.join("\n");
}
