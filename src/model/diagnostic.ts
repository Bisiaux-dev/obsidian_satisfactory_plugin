/**
 * Diagnostic of a production chain — PURE FUNCTION of (Scene + Db).
 *
 * Identically recomputable by the plugin (visual rendering) AND by an AI
 * (reading the `.md`): this guarantees the `.md` stays the source of truth.
 * The exact rules are documented in DIAGNOSTIC.md — keep both in sync.
 *
 * Rules (per node):
 *  - 🔴 bad  : an OUTPUT (product or by-product) with NO outgoing link → orphaned → blocks.
 *  - 🟡 warn : surplus (production not absorbed downstream — incl. links pointing at an
 *              already-saturated consumer); shortfall (demand > production);
 *              under-supplied input (incoming supply < need) → throttled machine.
 *  - 🟢 ok   : every output is balanced AND really absorbed, every input is supplied.
 */
import type { Db, Diagnostic, Issue, Scene, Status } from "./types";
import { isCustomNode, SINK } from "./types";
import { nodePorts } from "./ports";

/** Tolerance on rates (recipe rounding). */
const EPS = 0.01;

const worse = (a: Status, b: Status): Status => {
  const rank: Record<Status, number> = { ok: 0, warn: 1, bad: 2 };
  return rank[a] >= rank[b] ? a : b;
};

export function diagnose(scene: Scene, db: Db): Diagnostic {
  const issues: Issue[] = [];
  const status: Record<string, Status> = {};

  const bump = (nodeId: string, s: Status) => {
    status[nodeId] = worse(status[nodeId] ?? "ok", s);
  };

  // Effective rates (recipe × machines, or custom overrides) per node.
  const portsById = new Map(scene.noeuds.map((n) => [n.id, nodePorts(n, db, scene.liens)]));

  const isFluid = (item: string) => db.items[item]?.etat === "fluide";

  // Items consumed by each node — to validate that a link is a REAL outlet.
  // The Sink ONLY accepts solids (no fluids/gases).
  const isValidOutlet = (vers: string, produit: string): boolean =>
    vers === SINK
      ? !isFluid(produit)
      : (portsById.get(vers)?.intrants.some((i) => i.item === produit) ?? false);

  // How much of an item a target can actually absorb (1 = fully). When a consumer
  // is over-fed (incoming > need), only a fraction of each incoming link counts as
  // truly consumed → the rest is surplus on the PRODUCER side (it backs up upstream).
  const incomingByNode = new Map<string, Map<string, number>>();
  for (const l of scene.liens) {
    if (l.vers === SINK) continue;
    let mm = incomingByNode.get(l.vers);
    if (!mm) {
      mm = new Map();
      incomingByNode.set(l.vers, mm);
    }
    mm.set(l.produit, (mm.get(l.produit) ?? 0) + l.debit);
  }
  const absorption = (vers: string, item: string): number => {
    if (vers === SINK) return 1;
    const need = portsById.get(vers)?.intrants.find((i) => i.item === item)?.debit ?? 0;
    if (need <= 0) return 0;
    const supplied = incomingByNode.get(vers)?.get(item) ?? 0;
    return supplied > need + EPS ? need / supplied : 1;
  };

  for (const node of scene.noeuds) {
    status[node.id] = "ok";
    const ports = portsById.get(node.id)!;

    // A generator with no ports (e.g. geothermal) is valid; only a missing DB
    // recipe on a non-custom, non-import node is "unknown".
    if (!isCustomNode(node) && !node.import && !db.recipes[node.recette]) {
      issues.push({
        nodeId: node.id,
        severity: "bad",
        message: `Unknown recipe: ${node.recette}`,
      });
      bump(node.id, "bad");
      continue;
    }

    const outgoing = scene.liens.filter((l) => l.de === node.id);
    const incoming = scene.liens.filter((l) => l.vers === node.id);

    // --- Outputs: every output must have a VALID outlet ---
    for (const ex of ports.extrants) {
      const produced = ex.debit;
      const itemName = db.items[ex.item]?.nom ?? ex.item;
      const links = outgoing.filter((l) => l.produit === ex.item);

      // Invalid links: fake outlet (target does not consume it, or fluid → Sink).
      for (const bad of links.filter((l) => !isValidOutlet(l.vers, ex.item))) {
        const reason =
          bad.vers === SINK
            ? `${itemName}: the Sink does not accept fluids`
            : `${bad.vers} does not consume ${itemName}`;
        issues.push({ nodeId: node.id, severity: "bad", item: ex.item, message: reason });
        bump(node.id, "bad");
      }

      // Only valid links count as actual evacuation; `absorbed` further discounts
      // the part a saturated consumer cannot really take in (it backs up upstream).
      const valid = links.filter((l) => isValidOutlet(l.vers, ex.item));
      const routed = valid.reduce((sum, l) => sum + l.debit, 0);
      const absorbed = valid.reduce((sum, l) => sum + l.debit * absorption(l.vers, ex.item), 0);

      if (routed <= EPS) {
        issues.push({
          nodeId: node.id,
          severity: "bad",
          item: ex.item,
          message: `${itemName} ${produced}/min orphaned`,
        });
        bump(node.id, "bad");
      } else if (absorbed < produced - EPS) {
        issues.push({
          nodeId: node.id,
          severity: "warn",
          item: ex.item,
          message: `Surplus ${itemName} ${round(produced - absorbed)}/min (downstream can't absorb it all)`,
        });
        bump(node.id, "warn");
      } else if (routed > produced + EPS) {
        issues.push({
          nodeId: node.id,
          severity: "warn",
          item: ex.item,
          message: `Shortfall ${itemName} ${round(routed - produced)}/min`,
        });
        bump(node.id, "warn");
      }
    }

    // --- Inputs: every need must be supplied ---
    for (const inp of ports.intrants) {
      const needed = inp.debit;
      const supplied = incoming
        .filter((l) => l.produit === inp.item)
        .reduce((sum, l) => sum + l.debit, 0);
      const itemName = db.items[inp.item]?.nom ?? inp.item;

      if (supplied < needed - EPS) {
        issues.push({
          nodeId: node.id,
          severity: "warn",
          item: inp.item,
          message: `${itemName} under-supplied ${round(supplied)}/${round(needed)}`,
        });
        bump(node.id, "warn");
      }
    }
  }

  return { status, issues };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
