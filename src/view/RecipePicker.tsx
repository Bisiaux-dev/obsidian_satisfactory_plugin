import { useEffect, useMemo, useRef, useState } from "react";
import { FileInput, Search, Star, X } from "lucide-react";
import type { Db, Recipe } from "../model/types";
import { ICONS } from "../model/game-icons";
import { MACHINE_ICONS } from "../model/machine-icons";
import { EXTRACTORS, extractorRate } from "../model/power";
import type { Purity } from "../model/power";

/**
 * Recipe picker: search + groups.
 *
 * Replaces the flat 276-entry <select> (alternates drowned in alphabetical
 * order). Layout:
 *  - STANDARD recipes first, grouped by machine (Smelter, Constructor…);
 *  - ALTERNATE recipes in a dedicated section at the end (⭐ badge);
 *  - each row: icon of the produced item + name + machine.
 * Search: every typed word must appear in "name + machine" (case-insensitive).
 * Keyboard: ↑/↓ navigates, Enter picks, Esc closes.
 */
export interface RecipePickerProps {
  db: Db;
  /** Only offer recipes consuming one of these items (connection dropped into empty space). */
  consumesOneOf?: string[];
  onPick: (recipeId: string) => void;
  onClose: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}

interface Row {
  recipe: Recipe;
  /** Id of the main produced item (for the icon). */
  product: string;
}

interface Section {
  title: string;
  rows: Row[];
}

function buildSections(db: Db, consumesOneOf?: string[]): Section[] {
  const wanted = consumesOneOf ? new Set(consumesOneOf) : null;
  const all = Object.values(db.recipes).filter(
    (r) => !wanted || r.intrants.some((p) => wanted.has(p.item)) || (r.fuels ?? []).some((f) => wanted.has(f.item)),
  );
  const gens = all.filter((r) => r.production && r.machine !== "Alien Power Augmenter");
  const aug = all.filter((r) => r.production && r.machine === "Alien Power Augmenter");
  const std = all.filter((r) => !r.alternative && !r.production);
  const alt = all.filter((r) => r.alternative && !r.production);
  const genRow = (r: Recipe): Row => ({ recipe: r, product: r.fuels?.[0]?.item ?? "" });

  // Standard recipes grouped by machine (machines sorted, recipes sorted within each group).
  const byMachine = new Map<string, Row[]>();
  for (const r of std) {
    const rows = byMachine.get(r.machine) ?? [];
    rows.push({ recipe: r, product: r.extrants[0]?.item ?? "" });
    byMachine.set(r.machine, rows);
  }
  const sections: Section[] = [...byMachine.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([machine, rows]) => ({
      title: machine,
      rows: rows.sort((a, b) => a.recipe.nom.localeCompare(b.recipe.nom)),
    }));

  if (gens.length > 0) {
    sections.push({ title: "Power generators", rows: gens.map(genRow).sort((a, b) => (a.recipe.production ?? 0) - (b.recipe.production ?? 0)) });
  }
  if (aug.length > 0) {
    sections.push({ title: "Alien Power Augmenter", rows: aug.map(genRow) });
  }
  if (alt.length > 0) {
    sections.push({
      title: "Alternatives",
      rows: alt
        .map((r) => ({ recipe: r, product: r.extrants[0]?.item ?? "" }))
        .sort((a, b) => a.recipe.nom.localeCompare(b.recipe.nom)),
    });
  }
  return sections;
}

/**
 * Picker for a NOTE to import (same styles as the recipe picker):
 * filterable list of vault notes containing a ```satisfactory block.
 */
export function NotePicker({
  notes,
  onPick,
  onClose,
}: {
  /** Basenames of the importable notes; null = still loading. */
  notes: string[] | null;
  onPick: (basename: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (notes ?? []).filter((n) => tokens.every((t) => n.toLowerCase().includes(t)));
  }, [notes, query]);
  const activeName = filtered[Math.min(active, filtered.length - 1)];
  useEffect(() => setActive(0), [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (activeName) onPick(activeName); }
  };

  return (
    <div className="sfy-picker nodrag nopan" onKeyDown={onKeyDown} onClick={(e) => e.stopPropagation()}>
      <div className="sfy-picker-search">
        <Search size={13} />
        <input autoFocus placeholder="Search factories (.md notes)…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="sfy-picker-close" title="Close (Esc)" onClick={onClose}><X size={13} /></button>
      </div>
      <div className="sfy-picker-list">
        {notes === null ? <div className="sfy-picker-empty">Scanning for factories…</div> : null}
        {notes !== null && filtered.length === 0 ? (
          <div className="sfy-picker-empty">No note contains a satisfactory block.</div>
        ) : null}
        {filtered.map((n) => (
          <button
            key={n}
            className={`sfy-picker-row${n === activeName ? " active" : ""}`}
            onMouseEnter={() => setActive(filtered.indexOf(n))}
            onClick={() => onPick(n)}
          >
            <FileInput size={14} className="sfy-picker-noteico" />
            <span className="sfy-picker-name">{n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function RecipePicker({ db, consumesOneOf, onPick, onClose, placeholder, autoFocus = true }: RecipePickerProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => buildSections(db, consumesOneOf), [db, consumesOneOf]);

  // Filter: every query word must match name or machine.
  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return sections;
    return sections
      .map((s) => ({
        ...s,
        rows: s.rows.filter((row) => {
          const hay = `${row.recipe.nom} ${row.recipe.machine}`.toLowerCase();
          return tokens.every((t) => hay.includes(t));
        }),
      }))
      .filter((s) => s.rows.length > 0);
  }, [sections, query]);

  // Flattened list for keyboard navigation.
  const flat = useMemo(() => filtered.flatMap((s) => s.rows), [filtered]);
  const activeId = flat[Math.min(active, flat.length - 1)]?.recipe.id;

  useEffect(() => setActive(0), [query]);
  // Keep the active row visible while navigating with the keyboard.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-rid="${activeId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Don't let the event bubble up to graph / Obsidian shortcuts.
    e.stopPropagation();
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeId) onPick(activeId);
    }
  };

  return (
    <div className="sfy-picker nodrag nopan" onKeyDown={onKeyDown} onClick={(e) => e.stopPropagation()}>
      <div className="sfy-picker-search">
        <Search size={13} />
        <input
          autoFocus={autoFocus}
          placeholder={placeholder ?? "Search recipes…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="sfy-picker-close" title="Close (Esc)" onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      <div className="sfy-picker-list" ref={listRef}>
        {flat.length === 0 ? <div className="sfy-picker-empty">No recipe matches.</div> : null}
        {filtered.map((s) => (
          <div key={s.title}>
            <div className="sfy-picker-sec">{s.title}</div>
            {s.rows.map((row) => (
              <button
                key={row.recipe.id}
                data-rid={row.recipe.id}
                className={`sfy-picker-row${row.recipe.id === activeId ? " active" : ""}`}
                onMouseEnter={() => setActive(flat.indexOf(row))}
                onClick={() => onPick(row.recipe.id)}
              >
                {row.recipe.production && MACHINE_ICONS[row.recipe.machine] ? (
                  <img className="sfy-icon" src={MACHINE_ICONS[row.recipe.machine]} alt="" />
                ) : ICONS[row.product] ? (
                  <img className="sfy-icon" src={ICONS[row.product]} alt="" />
                ) : (
                  <span className="sfy-icon" />
                )}
                <span className="sfy-picker-name">
                  {row.recipe.nom.replace(/^Alternate:\s*/, "")}
                  {row.recipe.alternative ? <Star size={10} className="sfy-picker-star" /> : null}
                </span>
                <span className="sfy-picker-machine">{row.recipe.machine}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface ExtractorRow {
  key: string;
  machine: string;
  item: string;
  debit: number;
  nom: string;
}

const PURITIES: { id: Purity; nom: string }[] = [
  { id: "impure", nom: "Impure" },
  { id: "normal", nom: "Normal" },
  { id: "pure", nom: "Pure" },
];

/**
 * Extractor picker: choose the node PURITY (impure/normal/pure) then the
 * resource. The purity sets the base output; overclock the node to go further.
 */
export function ExtractorPicker({
  db,
  onPick,
  onClose,
}: {
  db: Db;
  onPick: (machine: string, item: string, debit: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [purity, setPurity] = useState<Purity>("normal");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(
    () =>
      EXTRACTORS.map((ex) => {
        const fixed = typeof ex.fixed === "number";
        const debit = extractorRate(ex, purity);
        return {
          title: `${ex.machine} · ${ex.power} MW${fixed ? " · fixed" : ex.perSatellite ? " · /satellite" : ""}`,
          rows: ex.items.map<ExtractorRow>((item) => ({
            key: `${ex.machine}|${item}`,
            machine: ex.machine,
            item,
            debit,
            nom: db.items[item]?.nom ?? item,
          })),
        };
      }),
    [db, purity],
  );

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return sections;
    return sections
      .map((s) => ({ ...s, rows: s.rows.filter((row) => tokens.every((t) => `${row.nom} ${row.machine}`.toLowerCase().includes(t))) }))
      .filter((s) => s.rows.length > 0);
  }, [sections, query]);

  const flat = useMemo(() => filtered.flatMap((s) => s.rows), [filtered]);
  const activeRow = flat[Math.min(active, flat.length - 1)];
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (activeRow) listRef.current?.querySelector(`[data-xid="${activeRow.key}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeRow?.key]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (activeRow) onPick(activeRow.machine, activeRow.item, activeRow.debit); }
  };

  return (
    <div className="sfy-picker nodrag nopan" onKeyDown={onKeyDown} onClick={(e) => e.stopPropagation()}>
      <div className="sfy-picker-search">
        <Search size={13} />
        <input autoFocus placeholder="Add an extractor (resource, machine)…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="sfy-picker-close" title="Close (Esc)" onClick={onClose}><X size={13} /></button>
      </div>
      <div className="sfy-purity" title="Node purity (filon). Sets the base output; overclock the node to push further (pure Mk.3 @250% = 1200/min, the solid max).">
        <span className="sfy-purity-label">Filon:</span>
        {PURITIES.map((p) => (
          <button
            key={p.id}
            className={`sfy-purity-btn${purity === p.id ? " active" : ""}`}
            onClick={(e) => { e.stopPropagation(); setPurity(p.id); }}
          >
            {p.nom}
          </button>
        ))}
      </div>
      <div className="sfy-picker-list" ref={listRef}>
        {flat.length === 0 ? <div className="sfy-picker-empty">No resource matches.</div> : null}
        {filtered.map((s) => (
          <div key={s.title}>
            <div className="sfy-picker-sec">{s.title}</div>
            {s.rows.map((row) => (
              <button
                key={row.key}
                data-xid={row.key}
                className={`sfy-picker-row${activeRow && row.key === activeRow.key ? " active" : ""}`}
                onMouseEnter={() => setActive(flat.indexOf(row))}
                onClick={() => onPick(row.machine, row.item, row.debit)}
              >
                {ICONS[row.item] ? <img className="sfy-icon" src={ICONS[row.item]} alt="" /> : <span className="sfy-icon" />}
                <span className="sfy-picker-name">{row.nom}</span>
                <span className="sfy-picker-machine">{row.debit}/min</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
