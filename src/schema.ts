/**
 * Schema & parser for the ```satisfactory code block.
 *
 * The block body is YAML (parsed with Obsidian's `parseYaml` — zero dependency).
 * This module turns the text into a normalized {@link Scene} and tolerates errors:
 * it throws a {@link SceneParseError} with a readable message that `main.ts`
 * displays inside the block instead of crashing the render.
 *
 * Grammar (see the bundled guide):
 *   nodes:  list of { id, recipe, machines?, pos?, layer?, machine?, inputs?, outputs?, import? }
 *   links:  list of { from, to, product, rate, loop? }   (to may be "SINK")
 *   layers: list of { id, name, icon?, color?, collapsed? }
 *
 * Backward compatibility: the original French keys (noeuds/liens/calques, recette,
 * calque, intrants/extrants, debit, de/vers/produit, boucle, nom/icone/couleur/replie)
 * are still accepted on read. The serializer writes the English keys.
 */
import { parseYaml } from "obsidian";
import type { Layer, Link, LinkCap, Node, Port, Scene } from "./model/types";

export class SceneParseError extends Error {}

/** Returns the first defined value among aliases (English key first). */
function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  return undefined;
}

export function parseScene(source: string): Scene {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (e) {
    throw new SceneParseError(`Invalid YAML: ${(e as Error).message}`);
  }

  // Empty block → empty scene (start from scratch: the toolbar shows up, then
  // "Optimize" or "+ Node").
  if (raw == null) return { noeuds: [], liens: [], calques: [] };
  if (typeof raw !== "object") {
    throw new SceneParseError("The block is not a valid YAML object.");
  }
  const obj = raw as Record<string, unknown>;

  return {
    noeuds: parseNodes(pick(obj, "nodes", "noeuds")),
    liens: parseLinks(pick(obj, "links", "liens")),
    calques: parseLayers(pick(obj, "layers", "calques")),
  };
}

function asArray(value: unknown, key: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new SceneParseError(`\`${key}\` must be a list.`);
  }
  return value;
}

function parseNodes(value: unknown): Node[] {
  return asArray(value, "nodes").map((entry, i) => {
    const n = entry as Record<string, unknown>;
    if (!n || typeof n.id !== "string") {
      throw new SceneParseError(`nodes[${i}]: missing \`id\` (text).`);
    }
    const recipe = pick(n, "recipe", "recette");
    const imp = n.import;
    // An import node has no recipe (its outputs come from another note).
    if (typeof imp !== "string" && typeof recipe !== "string") {
      throw new SceneParseError(`node "${n.id}": missing \`recipe\` (text).`);
    }
    const clock = pick(n, "clock", "horloge");
    return {
      id: n.id,
      recette: typeof recipe === "string" ? recipe : "",
      machines: typeof n.machines === "number" ? n.machines : 1,
      clock: typeof clock === "number" ? Math.min(250, Math.max(1, clock)) : 100,
      sloops: typeof n.sloops === "number" ? Math.max(0, Math.floor(n.sloops)) : 0,
      pos: parsePos(n.pos),
      calque: asString(pick(n, "layer", "calque")),
      import: typeof imp === "string" ? imp : undefined,
      machine: typeof n.machine === "string" ? n.machine : undefined,
      intrants: parsePorts(pick(n, "inputs", "intrants")),
      extrants: parsePorts(pick(n, "outputs", "extrants")),
    };
  });
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Parses a port list [{ item, rate }]; undefined if absent. */
function parsePorts(value: unknown): Port[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value
    .map((p) => p as Record<string, unknown>)
    .filter((p) => p && typeof p.item === "string")
    .map((p) => {
      const rate = pick(p, "rate", "debit");
      return { item: p.item as string, debit: typeof rate === "number" ? rate : 0 };
    });
}

function parsePos(value: unknown): [number, number] | undefined {
  if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "number")) {
    return [value[0] as number, value[1] as number];
  }
  return undefined;
}

function parseLinks(value: unknown): Link[] {
  return asArray(value, "links").map((entry, i) => {
    const l = entry as Record<string, unknown>;
    const from = pick(l, "from", "de");
    const to = pick(l, "to", "vers");
    if (!l || typeof from !== "string" || typeof to !== "string") {
      throw new SceneParseError(`links[${i}]: \`from\` and \`to\` (text) are required.`);
    }
    const product = pick(l, "product", "produit");
    if (typeof product !== "string") {
      throw new SceneParseError(`links[${i}] (${from}→${to}): missing \`product\`.`);
    }
    const rate = pick(l, "rate", "debit");
    const cap = parseCap(pick(l, "cap", "bout"), pick(l, "loop", "boucle") === true);
    return {
      de: from,
      vers: to,
      produit: product,
      debit: typeof rate === "number" ? rate : 0,
      boucle: cap === "boucle",
      cap,
    };
  });
}

/** End-marker state of a link (back-compat with the boolean `loop`). */
function parseCap(value: unknown, loop: boolean): LinkCap {
  if (typeof value === "string") {
    const v = value.toLowerCase();
    if (v === "none" || v === "rien") return "rien";
    if (v === "loop" || v === "boucle") return "boucle";
    if (v === "arrow" || v === "fleche") return "fleche";
  }
  return loop ? "boucle" : "fleche";
}

function parseLayers(value: unknown): Layer[] {
  return asArray(value, "layers").map((entry, i) => {
    const c = entry as Record<string, unknown>;
    if (!c || typeof c.id !== "string") {
      throw new SceneParseError(`layers[${i}]: missing \`id\` (text).`);
    }
    const name = pick(c, "name", "nom");
    return {
      id: c.id,
      nom: typeof name === "string" ? name : c.id,
      icone: asString(pick(c, "icon", "icone")),
      couleur: asString(pick(c, "color", "couleur")),
      replie: pick(c, "collapsed", "replie") === true,
    };
  });
}
