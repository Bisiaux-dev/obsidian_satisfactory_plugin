import { MarkdownRenderChild, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from "obsidian";
import type { App, MarkdownPostProcessorContext } from "obsidian";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
// React Flow CSS embedded as text (esbuild loader) then injected on load.
import xyflowCss from "@xyflow/react/dist/style.css";
// User + AI guide embedded in the bundle (esbuild `.md` loader) → written
// to the vault on first launch. This is the only reliable way to ship the docs
// WITH the plugin: the community store only installs main.js/manifest/styles.
import guideMd from "../GUIDE.md";
import { parseScene, SceneParseError } from "./schema";
import { serializeScene } from "./serialize";
import { GAME_DB } from "./model/game-db";
import { renderItemsMd, renderRecipesMd } from "./db-md";
import { diagnose } from "./model/diagnostic";
import { extractSatisfactoryBlock, sceneExports } from "./model/import";
import type { Port, Scene } from "./model/types";
import { GraphView } from "./view/GraphView";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Ready-to-use empty satisfactory block (toolbar shows up, empty scene). */
const SFY_BLOCK = "```satisfactory\nnodes: []\n```";

/** Note template created by the "New Satisfactory chain" command. */
const CHAIN_TEMPLATE = `# New Satisfactory chain

> Click **Optimize** to generate a resource-optimal chain, or **+ Node** to build by hand. Everything is editable here and written back as Markdown.

${SFY_BLOCK}
`;

/**
 * PERSISTENT React root for a block (key = note + render surface).
 *
 * Problem solved: Obsidian recreates the block's DOM on every `.md` write
 * (write-back). If we created a fresh React root each time, React would
 * unmount/remount → flash, nodes "popping", camera reset.
 * Here we keep the root and its container alive: on every Obsidian re-render
 * we MOVE the same container into the new element (no unmount) and re-render
 * (React RECONCILES the existing tree → no flash, the React Flow instance
 * and the camera are preserved). `rev` (syncToken) tells GraphView to
 * re-sync its nodes/edges from the new scene.
 */
interface BlockRoot {
  container: HTMLElement;
  root: Root;
  /** Bumped on every re-render → re-syncs the React Flow state in GraphView. */
  rev: number;
  /** Current context/element (for write-back: getSectionInfo). */
  el: HTMLElement;
  ctx: MarkdownPostProcessorContext;
  /** Last rendered scene, imports RESOLVED (to re-render on a settings change). */
  scene: Scene;
  /** Raw parsed scene (before import resolution) — to re-resolve if an imported note changes. */
  rawScene: Scene;
  /** Paths of the notes imported by this block (to re-sync when they are modified). */
  importDeps: string[];
}

/** Vault folder where the bundled docs (guide + game DB) are deposited. */
const DOC_FOLDER = "Satisfactory Chains";
const GUIDE_PATH = normalizePath(`${DOC_FOLDER}/Guide.md`);
const ITEMS_PATH = normalizePath(`${DOC_FOLDER}/items.md`);
const RECIPES_PATH = normalizePath(`${DOC_FOLDER}/recipes.md`);

interface SfySettings {
  /** Force whole machine counts when editing (disabled by default). */
  wholeMachines: boolean;
  /** Docs (guide + DB) already deposited in the vault at least once (avoids recreating them if the user deletes them). */
  docsInstalled: boolean;
}
const DEFAULT_SETTINGS: SfySettings = { wholeMachines: false, docsInstalled: false };

class SatisfactoryRenderChild extends MarkdownRenderChild {
  constructor(
    private readonly plugin: SatisfactoryPlugin,
    el: HTMLElement,
    private readonly pctx: MarkdownPostProcessorContext,
    private readonly source: string,
  ) {
    super(el);
  }

  onload(): void {
    let scene: Scene;
    try {
      scene = parseScene(this.source);
    } catch (e) {
      const msg = e instanceof SceneParseError ? e.message : `Unexpected error: ${(e as Error).message}`;
      this.containerEl.empty();
      this.containerEl.createDiv({ cls: "sfy-error", text: `Invalid satisfactory block\n${msg}` });
      return;
    }
    // Import resolution (reads other notes) → asynchronous.
    void this.plugin.renderBlock(this.containerEl, this.pctx, scene);
  }

  onunload(): void {
    // We do NOT unmount: the root is persistent (reused if the note is
    // reopened). All roots are cleaned up when the plugin unloads.
    // (No timed eviction here: it caused spurious unmounts during
    // back-to-back re-renders — container briefly detached.)
  }
}

export default class SatisfactoryPlugin extends Plugin {
  private styleEl: HTMLStyleElement | null = null;
  private readonly roots = new Map<string, BlockRoot>();
  /** Keys seen disconnected at the previous sweep (two-step eviction). */
  private readonly detachedRoots = new Set<string>();
  settings: SfySettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
    this.addSettingTab(new SfySettingTab(this.app, this));

    this.styleEl = document.head.createEl("style", { attr: { id: "sfy-xyflow-css" } });
    this.styleEl.textContent = xyflowCss;

    this.registerMarkdownCodeBlockProcessor("satisfactory", (source, el, ctx) => {
      ctx.addChild(new SatisfactoryRenderChild(this, el, ctx, source));
    });

    // Cross-note SYNC: if a note IMPORTED by a displayed block changes, we
    // re-resolve and re-render the blocks that depend on it (imported rates follow).
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) return;
        for (const entry of this.roots.values()) {
          if (entry.importDeps.includes(file.path)) {
            void this.renderBlock(entry.el, entry.ctx, entry.rawScene);
          }
        }
      }),
    );

    // Create a new chain note (ready-to-use template): command + ribbon.
    this.addCommand({
      id: "new-chain",
      name: "New Satisfactory chain",
      callback: () => void this.createChainNote(),
    });
    this.addRibbonIcon("factory", "New Satisfactory chain", () => void this.createChainNote());

    // Insert a block into the current note (at cursor).
    this.addCommand({
      id: "insert-block",
      name: "Insert Satisfactory block at cursor",
      editorCallback: (editor) => editor.replaceSelection(SFY_BLOCK + "\n"),
    });

    // Open the guide: (re)creates the docs if missing AND regenerates the exported
    // game DB (useful after a database update), then opens the guide.
    this.addCommand({
      id: "open-guide",
      name: "Open the Satisfactory guide",
      callback: () => void this.installDocs(true),
    });

    // Deposit the docs (guide + DB) into the vault on the very first launch (once).
    this.app.workspace.onLayoutReady(() => {
      if (!this.settings.docsInstalled) void this.installDocs(false);
    });

    // Evict React roots of blocks whose note has been closed: the roots are kept
    // alive across re-renders (anti-flicker), so without this sweep every visited
    // note would retain a mounted root + a document-level keydown listener until
    // the plugin unloads. Two-strike check (~60s) so quick re-renders never evict.
    this.registerInterval(
      window.setInterval(() => this.sweepDetachedRoots(), 30_000),
    );
  }

  /** Unmounts and forgets roots whose container has been out of the DOM for 2 sweeps. */
  private sweepDetachedRoots(): void {
    for (const [key, entry] of this.roots) {
      if (entry.container.isConnected) {
        this.detachedRoots.delete(key);
        continue;
      }
      if (this.detachedRoots.has(key)) {
        entry.root.unmount();
        this.roots.delete(key);
        this.detachedRoots.delete(key);
      } else {
        this.detachedRoots.add(key);
      }
    }
  }

  /** Creates the file if missing, otherwise rewrites its content (regenerated DB). */
  private async upsert(path: string, content: string, overwrite: boolean): Promise<TFile> {
    const existing = this.app.vault.getFileByPath(path);
    if (existing) {
      if (overwrite) await this.app.vault.process(existing, () => content);
      return existing;
    }
    return this.app.vault.create(path, content);
  }

  /**
   * Deposits the bundled docs into the vault (folder {@link DOC_FOLDER}):
   *  - `Guide.md` — human + AI guide (static, never overwritten: respects the user's notes);
   *  - `items.md` / `recipes.md` — DB **regenerated from {@link GAME_DB}** on every call (always in sync).
   *
   * Called once on first launch, and on demand via the command (which then refreshes the DB).
   * The `docsInstalled` flag prevents automatic recreation if the user deletes the folder.
   */
  private async installDocs(open: boolean): Promise<void> {
    if (!(this.app.vault.getAbstractFileByPath(DOC_FOLDER))) {
      await this.app.vault.createFolder(DOC_FOLDER);
    }
    const guide = await this.upsert(GUIDE_PATH, guideMd, false);
    await this.upsert(ITEMS_PATH, renderItemsMd(GAME_DB), true);
    await this.upsert(RECIPES_PATH, renderRecipesMd(GAME_DB), true);

    if (!this.settings.docsInstalled) {
      this.settings.docsInstalled = true;
      await this.saveData(this.settings);
      if (!open) new Notice(`Satisfactory docs added to your vault (folder "${DOC_FOLDER}").`, 5000);
    }
    if (open) await this.app.workspace.getLeaf(true).openFile(guide);
  }

  /** Creates a pre-filled chain note and opens it. */
  private async createChainNote(): Promise<void> {
    const folder = this.app.workspace.getActiveFile()?.parent?.path ?? "";
    const base = "New chain";
    let path = normalizePath(folder ? `${folder}/${base}.md` : `${base}.md`);
    let i = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(folder ? `${folder}/${base} ${i}.md` : `${base} ${i}.md`);
      i++;
    }
    const file = await this.app.vault.create(path, CHAIN_TEMPLATE);
    await this.app.workspace.getLeaf(true).openFile(file);
    new Notice("New chain created — click Optimize or + Node.");
  }

  /** Stable key per (note, surface): live-preview editor vs reading view. */
  private keyFor(el: HTMLElement, ctx: MarkdownPostProcessorContext): string {
    const surface = el.closest(".markdown-reading-view") ? "read" : "edit";
    return `${ctx.sourcePath}::${surface}`;
  }

  /**
   * Resolves `import` nodes (cross-note black boxes) then mounts/refreshes
   * the block. Asynchronous because resolution reads other vault notes.
   */
  async renderBlock(el: HTMLElement, ctx: MarkdownPostProcessorContext, rawScene: Scene): Promise<void> {
    let scene = rawScene;
    let deps: string[] = [];
    try {
      const resolved = await this.resolveImports(rawScene, ctx.sourcePath);
      scene = resolved.scene;
      deps = resolved.deps;
    } catch {
      /* on failure, render the raw scene (imports will stay empty) */
    }
    this.mountOrUpdate(el, ctx, scene, rawScene, deps);
  }

  /**
   * Replaces each `import` node with a black box exposing the DELIVERABLES of the
   * referenced note (× `machines`). Returns the resolved scene + the imported paths.
   */
  private async resolveImports(scene: Scene, sourcePath: string): Promise<{ scene: Scene; deps: string[] }> {
    if (!scene.noeuds.some((n) => n.import)) return { scene, deps: [] };
    const deps = new Set<string>();
    const noeuds = await Promise.all(
      scene.noeuds.map(async (n) => {
        if (!n.import) return n;
        const ref = n.import.replace(/\.md$/, "");
        const file = this.app.metadataCache.getFirstLinkpathDest(ref, sourcePath);
        if (!(file instanceof TFile) || file.path === sourcePath) {
          return { ...n, intrants: [], extrants: [] as Port[], machine: `${n.import} (not found)` };
        }
        deps.add(file.path);
        const m = n.machines > 0 ? n.machines : 1;
        let extrants: Port[] = [];
        try {
          const body = extractSatisfactoryBlock(await this.app.vault.cachedRead(file));
          if (body) {
            extrants = sceneExports(parseScene(body), GAME_DB).map((e) => ({ item: e.item, debit: round2(e.debit * m) }));
          }
        } catch {
          /* invalid imported note → empty import (flagged visually) */
        }
        return { ...n, intrants: [] as Port[], extrants, machine: file.basename };
      }),
    );
    return { scene: { ...scene, noeuds }, deps: [...deps] };
  }

  /**
   * Mounts the root if absent, otherwise reattaches the existing container and
   * only re-renders IF the content changed outside our write-back.
   */
  mountOrUpdate(el: HTMLElement, ctx: MarkdownPostProcessorContext, scene: Scene, rawScene: Scene, importDeps: string[]): void {
    // NB: one root per (note, surface). Accepted limitation — multiple
    // satisfactory blocks in the same note+surface would share the root (rare
    // case, this plugin = one factory per note). No "2 blocks" detection: it
    // fired incorrectly during a re-render (old + new element coexist for a
    // moment) → creating a fresh root = remount = flicker.
    const key = this.keyFor(el, ctx);
    const entry = this.roots.get(key);
    const diagnostic = diagnose(scene, GAME_DB);

    if (entry) {
      // Reattach the live container into the new element (no unmount).
      if (entry.container.parentElement !== el) el.appendChild(entry.container);
      entry.el = el;
      entry.ctx = ctx;
      entry.scene = scene;
      entry.rawScene = rawScene;
      entry.importDeps = importDeps;
      entry.rev += 1;
      entry.root.render(this.element(key, scene, diagnostic, ctx.sourcePath, entry.rev));
      return;
    }

    const container = el.createDiv({ cls: "sfy-root" });
    const root = createRoot(container);
    const created: BlockRoot = { container, root, rev: 0, el, ctx, scene, rawScene, importDeps };
    this.roots.set(key, created);
    root.render(this.element(key, scene, diagnostic, ctx.sourcePath, 0));
  }

  /**
   * Vault notes importable as a "factory": any `.md` (excluding the current note
   * and the docs folder) containing a ```satisfactory block.
   */
  private async listImportNotes(sourcePath: string): Promise<string[]> {
    const out: string[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (f.path === sourcePath || f.path.startsWith(`${DOC_FOLDER}/`)) continue;
      try {
        if ((await this.app.vault.cachedRead(f)).includes("```satisfactory")) out.push(f.basename);
      } catch { /* unreadable note → ignored */ }
    }
    return out.sort((a, b) => a.localeCompare(b));
  }

  private element(key: string, scene: Scene, diagnostic: ReturnType<typeof diagnose>, sourcePath: string, syncToken: number) {
    return createElement(GraphView, {
      scene,
      db: GAME_DB,
      diagnostic,
      sourcePath,
      syncToken,
      wholeMachines: this.settings.wholeMachines,
      onSceneChange: (s: Scene) => void this.writeBack(key, s),
      onNotice: (m: string) => new Notice(m, 4000),
      listImportNotes: () => this.listImportNotes(sourcePath),
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // Re-render all views with the new setting.
    for (const [key, entry] of this.roots) {
      entry.rev += 1;
      entry.root.render(this.element(key, entry.scene, diagnose(entry.scene, GAME_DB), entry.ctx.sourcePath, entry.rev));
    }
  }

  /** Rewrites the body of the ```satisfactory block in the note. */
  private async writeBack(key: string, scene: Scene): Promise<void> {
    const entry = this.roots.get(key);
    if (!entry) return;
    const info = entry.ctx.getSectionInfo(entry.el);
    if (!info) return;
    const file = this.app.vault.getFileByPath(entry.ctx.sourcePath);
    if (!file) return;

    const body = serializeScene(scene);
    await this.app.vault.process(file, (data) => {
      const lines = data.split("\n");
      const before = lines.slice(0, info.lineStart + 1);
      const after = lines.slice(info.lineEnd);
      return [...before, body, ...after].join("\n");
    });
  }

  onunload(): void {
    for (const entry of this.roots.values()) entry.root.unmount();
    this.roots.clear();
    this.styleEl?.remove();
    this.styleEl = null;
  }
}

class SfySettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: SatisfactoryPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Whole machines")
      .setDesc(
        "Round machine counts to whole numbers when editing. Disabled: decimals allowed (useful for clock speed/overclocking).",
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.wholeMachines).onChange(async (v) => {
          this.plugin.settings.wholeMachines = v;
          await this.plugin.saveSettings();
        }),
      );
  }
}
