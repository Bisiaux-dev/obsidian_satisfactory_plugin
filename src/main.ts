import { MarkdownRenderChild, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from "obsidian";
import type { App, MarkdownPostProcessorContext } from "obsidian";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
// CSS de React Flow embarqué comme texte (loader esbuild) puis injecté au chargement.
import xyflowCss from "@xyflow/react/dist/style.css";
// Guide utilisateur + IA embarqué dans le bundle (loader esbuild `.md`) → écrit
// dans le vault au 1er lancement. C'est la seule façon fiable de livrer la doc
// AVEC le plugin : le store communautaire n'installe que main.js/manifest/styles.
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
 * Racine React PERSISTANTE pour un bloc (clé = note + surface de rendu).
 *
 * Problème résolu : Obsidian recrée le DOM du bloc à chaque écriture `.md`
 * (write-back). Si on créait une racine React neuve à chaque fois, React
 * démonterait/remonterait → flash, nœuds qui « popent », caméra recadrée.
 * Ici on garde la racine et son conteneur vivants : à chaque re-rendu d'Obsidian
 * on DÉPLACE le même conteneur dans le nouvel élément (aucun démontage) et on
 * re-rend (React RÉCONCILIE l'arbre existant → pas de flash, l'instance React
 * Flow et la caméra sont conservées). `rev` (syncToken) signale à GraphView de
 * re-synchroniser ses nœuds/arêtes depuis la nouvelle scène.
 */
interface BlockRoot {
  container: HTMLElement;
  root: Root;
  /** Bumpé à chaque re-rendu → re-synchro de l'état React Flow dans GraphView. */
  rev: number;
  /** Contexte/élément courants (pour le write-back : getSectionInfo). */
  el: HTMLElement;
  ctx: MarkdownPostProcessorContext;
  /** Dernière scène rendue, imports RÉSOLUS (pour re-rendre au changement de réglage). */
  scene: Scene;
  /** Scène brute parsée (avant résolution des imports) — pour re-résoudre si une note importée change. */
  rawScene: Scene;
  /** Chemins des notes importées par ce bloc (pour la re-synchro à leur modification). */
  importDeps: string[];
}

/** Vault folder where the bundled docs (guide + game DB) are deposited. */
const DOC_FOLDER = "Satisfactory Chains";
const GUIDE_PATH = normalizePath(`${DOC_FOLDER}/Guide.md`);
const ITEMS_PATH = normalizePath(`${DOC_FOLDER}/items.md`);
const RECIPES_PATH = normalizePath(`${DOC_FOLDER}/recipes.md`);

interface SfySettings {
  /** Forcer un nombre de machines entier à l'édition (désactivé par défaut). */
  wholeMachines: boolean;
  /** Doc (guide + DB) déjà déposée dans le vault au moins une fois (évite de la recréer si l'utilisateur la supprime). */
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
    // Résolution des imports (lecture d'autres notes) → asynchrone.
    void this.plugin.renderBlock(this.containerEl, this.pctx, scene);
  }

  onunload(): void {
    // On NE démonte PAS : la racine est persistante (réutilisée si la note est
    // rouverte). Toutes les racines sont nettoyées au déchargement du plugin.
    // (Pas d'éviction temporisée ici : elle provoquait des démontages parasites
    // lors de re-rendus rapprochés — conteneur brièvement détaché.)
  }
}

export default class SatisfactoryPlugin extends Plugin {
  private styleEl: HTMLStyleElement | null = null;
  private readonly roots = new Map<string, BlockRoot>();
  /** Clés vues déconnectées au sweep précédent (éviction en deux temps). */
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

    // SYNC inter-notes : si une note IMPORTÉE par un bloc affiché change, on
    // re-résout et re-rend les blocs qui en dépendent (les débits importés suivent).
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
   * Dépose la doc embarquée dans le vault (dossier {@link DOC_FOLDER}) :
   *  - `Guide.md` — guide humain + IA (statique, jamais écrasé : respecte les notes de l'utilisateur) ;
   *  - `items.md` / `recipes.md` — DB **régénérée depuis {@link GAME_DB}** à chaque appel (toujours synchro).
   *
   * Appelée une fois au 1er lancement, et à la demande via la commande (qui rafraîchit alors la DB).
   * Le flag `docsInstalled` évite la recréation automatique si l'utilisateur supprime le dossier.
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

  /** Clé stable par (note, surface) : éditeur live-preview vs vue lecture. */
  private keyFor(el: HTMLElement, ctx: MarkdownPostProcessorContext): string {
    const surface = el.closest(".markdown-reading-view") ? "read" : "edit";
    return `${ctx.sourcePath}::${surface}`;
  }

  /**
   * Résout les nœuds d'`import` (boîtes noires inter-notes) puis monte/rafraîchit
   * le bloc. Asynchrone car la résolution lit d'autres notes du vault.
   */
  async renderBlock(el: HTMLElement, ctx: MarkdownPostProcessorContext, rawScene: Scene): Promise<void> {
    let scene = rawScene;
    let deps: string[] = [];
    try {
      const resolved = await this.resolveImports(rawScene, ctx.sourcePath);
      scene = resolved.scene;
      deps = resolved.deps;
    } catch {
      /* en cas d'échec, on rend la scène brute (les imports resteront vides) */
    }
    this.mountOrUpdate(el, ctx, scene, rawScene, deps);
  }

  /**
   * Remplace chaque nœud `import` par une boîte noire exposant les LIVRABLES de la
   * note référencée (× `machines`). Renvoie la scène résolue + les chemins importés.
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
          /* note importée invalide → import vide (signalé visuellement) */
        }
        return { ...n, intrants: [] as Port[], extrants, machine: file.basename };
      }),
    );
    return { scene: { ...scene, noeuds }, deps: [...deps] };
  }

  /**
   * Monte la racine si absente, sinon réattache le conteneur existant et ne
   * re-rend QUE si le contenu a changé hors de notre write-back.
   */
  mountOrUpdate(el: HTMLElement, ctx: MarkdownPostProcessorContext, scene: Scene, rawScene: Scene, importDeps: string[]): void {
    // NB : une racine par (note, surface). Limitation assumée — plusieurs blocs
    // satisfactory dans la même note+surface partageraient la racine (cas rare,
    // ce plugin = une usine par note). Pas de détection "2 blocs" : elle se
    // déclenchait à tort pendant un re-rendu (ancien + nouvel élément coexistent
    // un instant) → création d'une racine neuve = remontage = flicker.
    const key = this.keyFor(el, ctx);
    const entry = this.roots.get(key);
    const diagnostic = diagnose(scene, GAME_DB);

    if (entry) {
      // Réattache le conteneur vivant dans le nouvel élément (pas de démontage).
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
   * Notes du vault importables comme « usine » : tout `.md` (hors note courante
   * et dossier de doc) contenant un bloc ```satisfactory.
   */
  private async listImportNotes(sourcePath: string): Promise<string[]> {
    const out: string[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (f.path === sourcePath || f.path.startsWith(`${DOC_FOLDER}/`)) continue;
      try {
        if ((await this.app.vault.cachedRead(f)).includes("```satisfactory")) out.push(f.basename);
      } catch { /* note illisible → ignorée */ }
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
    // Re-rend toutes les vues avec le nouveau réglage.
    for (const [key, entry] of this.roots) {
      entry.rev += 1;
      entry.root.render(this.element(key, entry.scene, diagnose(entry.scene, GAME_DB), entry.ctx.sourcePath, entry.rev));
    }
  }

  /** Réécrit le corps du bloc ```satisfactory dans la note. */
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
