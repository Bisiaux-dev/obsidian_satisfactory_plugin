/**
 * Diagnostic d'une chaîne de production — FONCTION PURE de (Scene + Db).
 *
 * Recalculable à l'identique par le plugin (rendu visuel) ET par une IA (lecture
 * du `.md`) : c'est la garantie que le `.md` reste la source de vérité. Les règles
 * exactes sont documentées dans DIAGNOSTIC.md — garder les deux synchronisés.
 *
 * Règles (par nœud) :
 *  - 🔴 bad  : un EXTRANT (produit ou sous-produit) sans AUCUN lien sortant → orphelin → bloque.
 *  - 🟡 warn : surplus (production > demande routée) ; déficit (demande > production) ;
 *              intrant sous-alimenté (apport entrant < besoin) → machine bridée.
 *  - 🟢 ok   : tous les extrants ont un débouché équilibré et tous les intrants sont fournis.
 */
import type { Db, Diagnostic, Issue, Scene, Status } from "./types";
import { SINK } from "./types";
import { nodePorts } from "./ports";

/** Tolérance sur les débits (arrondis de recettes). */
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

  // Débits effectifs (recette × machines, ou surcharges custom) par nœud.
  const portsById = new Map(scene.noeuds.map((n) => [n.id, nodePorts(n, db)]));

  const isFluid = (item: string) => db.items[item]?.etat === "fluide";

  // Items consommés par chaque nœud — pour valider qu'un lien est un VRAI débouché.
  // Le Sink n'accepte QUE les solides (pas les fluides/gaz).
  const isValidOutlet = (vers: string, produit: string): boolean =>
    vers === SINK
      ? !isFluid(produit)
      : (portsById.get(vers)?.intrants.some((i) => i.item === produit) ?? false);

  for (const node of scene.noeuds) {
    status[node.id] = "ok";
    const ports = portsById.get(node.id)!;

    if (ports.intrants.length === 0 && ports.extrants.length === 0) {
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

    // --- Extrants : chaque sortie doit avoir un débouché VALIDE ---
    for (const ex of ports.extrants) {
      const produced = ex.debit;
      const itemName = db.items[ex.item]?.nom ?? ex.item;
      const links = outgoing.filter((l) => l.produit === ex.item);

      // Liens invalides : faux débouché (cible ne consomme pas, ou fluide → Sink).
      for (const bad of links.filter((l) => !isValidOutlet(l.vers, ex.item))) {
        const reason =
          bad.vers === SINK
            ? `${itemName}: the Sink does not accept fluids`
            : `${bad.vers} does not consume ${itemName}`;
        issues.push({ nodeId: node.id, severity: "bad", item: ex.item, message: reason });
        bump(node.id, "bad");
      }

      // Seuls les liens valides comptent comme évacuation réelle.
      const routed = links
        .filter((l) => isValidOutlet(l.vers, ex.item))
        .reduce((sum, l) => sum + l.debit, 0);

      if (routed <= EPS) {
        issues.push({
          nodeId: node.id,
          severity: "bad",
          item: ex.item,
          message: `${itemName} ${produced}/min orphaned`,
        });
        bump(node.id, "bad");
      } else if (routed < produced - EPS) {
        issues.push({
          nodeId: node.id,
          severity: "warn",
          item: ex.item,
          message: `Surplus ${itemName} ${round(produced - routed)}/min`,
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

    // --- Intrants : chaque besoin doit être alimenté ---
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
          message: `${itemName} under-supplied ${supplied}/${needed}`,
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
