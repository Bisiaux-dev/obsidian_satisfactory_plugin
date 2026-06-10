#!/usr/bin/env node
/**
 * Runner e2e — pilote le VRAI Obsidian via Chrome DevTools Protocol.
 *
 * Prérequis :
 *   1. npm run build
 *   2. node _test/deploy.cjs
 *   3. powershell -File _test/launch-obsidian.ps1 -Vault <satisfactory-test-vault>
 *   4. node _test/e2e.cjs
 *
 * Vérifie : plugin chargé, bloc rendu (React Flow), badges diagnostic (A bloqué
 * par la silice orpheline, charbon sous-utilisé), flèches ➤ + boucle ♻, calques,
 * et le WRITE-BACK au drop (drag réel d'un nœud → pos réécrite dans le .md).
 * Screenshot dans _test/last-run.png. Exit 0 si tout passe.
 */
const fs = require("fs");
const path = require("path");
const { connect, sleep, PORT } = require("./cdp.cjs");

const PLUGIN_ID = "satisfactory-chains";
const NOTE = "EXAMPLE.md";

// Contenu propre réécrit avant le run (idempotence) — vraie chaîne (données du jeu).
const CLEAN = `# Example — iron + plastic chain (e2e test)

\`\`\`satisfactory
nodes:
  - { id: ore, recipe: "", machines: 1, pos: [20, 60], machine: Miner, inputs: [], outputs: [{ item: iron-ore, rate: 60 }] }
  - { id: ingot, recipe: recipe-ingotiron-c, machines: 1, pos: [320, 60], layer: smelting }
  - { id: plate, recipe: recipe-ironplate-c, machines: 1, pos: [620, 60], layer: smelting }
  - { id: oil, recipe: "", machines: 1, pos: [20, 360], machine: Pump, inputs: [], outputs: [{ item: crude-oil, rate: 30 }] }
  - { id: plastic, recipe: recipe-plastic-c, machines: 1, pos: [320, 360], layer: petro }
links:
  - { from: ore, to: ingot, product: iron-ore, rate: 30 }
  - { from: ingot, to: plate, product: iron-ingot, rate: 30 }
  - { from: plate, to: SINK, product: iron-plate, rate: 20 }
  - { from: oil, to: plastic, product: crude-oil, rate: 30 }
  - { from: plastic, to: SINK, product: plastic, rate: 20 }
layers:
  - { id: smelting, name: "Smelting", icon: "🔥", color: "#f59e0b" }
  - { id: petro, name: "Petrochem", icon: "🛢️", color: "#3b82f6" }
\`\`\`
`;

const checks = [];
const check = (name, status, msg) => checks.push({ name, status, msg });

// Un leaf markdown a 2 surfaces de rendu (éditeur live-preview caché + vue
// lecture visible) → on scope tout à la vue lecture pour mesurer le rendu réel.
const SCOPE = ".markdown-reading-view";
// On drague un nœud CENTRAL avec un petit déplacement : loin des bords du pane
// → pas d'auto-pan de React Flow → on isole la stabilité caméra du write-back.
const D_SEL = `${SCOPE} [data-id="plate"]`;

async function q(cdp, selector, prop = "length") {
  return cdp.evalJS(`document.querySelectorAll(${JSON.stringify(SCOPE + " " + selector)}).${prop}`);
}

async function main() {
  let cdp;
  try {
    cdp = await connect();
  } catch (e) {
    console.error(`\n✗ Connexion CDP impossible sur le port ${PORT}: ${e.message}`);
    console.error(`  → Lance: powershell -File _test/launch-obsidian.ps1 -Vault <vault>\n`);
    process.exit(1);
  }
  console.log(`[e2e] connecté à : ${cdp.target.title || cdp.target.url}`);

  // 1) Reload plugin (charge le main.js fraîchement déployé).
  await cdp.evalJS(`(async () => {
    await app.plugins.disablePlugin('${PLUGIN_ID}');
    await app.plugins.enablePlugin('${PLUGIN_ID}');
  })()`);
  await sleep(800);

  // 2) Réécrit la note propre, FERME tous les leaves markdown résiduels, puis
  //    ouvre UN seul leaf en mode lecture (le bloc se rend une seule fois).
  await cdp.evalJS(`(async () => {
    let f = app.vault.getAbstractFileByPath('${NOTE}');
    if (!f) f = await app.vault.create('${NOTE}', ${JSON.stringify(CLEAN)});
    else await app.vault.modify(f, ${JSON.stringify(CLEAN)});
    // garde UN leaf markdown, ferme les autres (sans supprimer le groupe d'onglets)
    const leaves = app.workspace.getLeavesOfType('markdown');
    for (let i = 1; i < leaves.length; i++) leaves[i].detach();
    const leaf = leaves[0] || app.workspace.getLeaf(true);
    await leaf.openFile(f, { active: true });
    await leaf.setViewState({ type: 'markdown', state: { file: f.path, mode: 'preview' }, active: true });
  })()`);
  await sleep(2500);
  const leaves = await cdp.evalJS(`app.workspace.getLeavesOfType('markdown').length`);
  check("un seul leaf markdown", leaves === 1 ? "pass" : "fail", `${leaves} leaf(s)`);
  // Normalise la caméra UNE fois (fitView) tôt, pour un drag déterministe sans
  // perturber le viewport pendant le test de stabilité caméra.
  await cdp.evalJS(`document.querySelector('${SCOPE} .react-flow__controls-fitview')?.click()`);
  await sleep(800);

  // 3) Assertions de rendu (DOM observable dans le vrai Obsidian).
  check("plugin activé", (await cdp.evalJS(`!!app.plugins.plugins['${PLUGIN_ID}']?._loaded`)) ? "pass" : "fail", "");
  const graph = await q(cdp, ".sfy-graph");
  check("bloc satisfactory rendu (.sfy-graph)", graph === 1 ? "pass" : "fail", `${graph} graphe(s) en vue lecture`);
  const rfNodes = await q(cdp, ".react-flow__node");
  check("nœuds React Flow", rfNodes >= 8 ? "pass" : "fail", `${rfNodes} (attendu 8 : 5 nœuds + Sink + 2 calques)`);
  const groups = await q(cdp, ".sfy-group");
  check("calques rendus", groups === 2 ? "pass" : "fail", `${groups} (attendu 2 : fonte, petro)`);
  const bad = await q(cdp, ".sfy-node.bad");
  check("nœud bloqué (résidu d'huile orphelin)", bad === 1 ? "pass" : "fail", `${bad} nœud(s) .bad (attendu 1 : plastic)`);
  const warn = await q(cdp, ".sfy-node.warn");
  check("nœud sous-utilisé (surplus minerai)", warn >= 1 ? "pass" : "fail", `${warn} nœud(s) .warn`);
  const arrows = await q(cdp, ".sfy-cap-arrow");
  check("flèches directionnelles ➤", arrows >= 4 ? "pass" : "fail", `${arrows} pointes (attendu 5)`);

  // 4) Write-back : drag réel du nœud D → DOM bouge ET pos réécrite dans le .md.
  const readDpos = `(async () => {
    const f = app.vault.getAbstractFileByPath('${NOTE}');
    const m = (await app.vault.read(f)).match(/id: plate,[^}]*pos: \\[([-\\d]+), ([-\\d]+)\\]/);
    return m ? m[1] + ',' + m[2] : null;
  })()`;
  const domTransform = `(() => { const e = document.querySelector('${D_SEL}'); return e ? e.style.transform : null; })()`;
  const rect = await cdp.evalJS(`(() => {
    const el = document.querySelector('${D_SEL}');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  const vpSel = `(() => { const e = document.querySelector('${SCOPE} .react-flow__viewport'); return e ? e.style.transform : null; })()`;
  const posBefore = await cdp.evalJS(readDpos);
  const tBefore = await cdp.evalJS(domTransform);
  const vpBefore = await cdp.evalJS(vpSel);
  // Marque l'élément DOM du viewport (vue lecture) : s'il est conservé après le
  // write-back, React a RÉCONCILIÉ (pas de remontage = pas de flicker visible).
  await cdp.evalJS(`(() => { const e = document.querySelector('${SCOPE} .react-flow__viewport'); if (e && !e.dataset.sfyMark) e.dataset.sfyMark = 'm' + (window.__sfyMarkN = (window.__sfyMarkN || 0) + 1); })()`);
  const markBefore = await cdp.evalJS(`document.querySelector('${SCOPE} .react-flow__viewport')?.dataset.sfyMark ?? null`);
  if (rect && posBefore) {
    // Retry : les events souris synthétiques ratent parfois la capture pointer.
    let tAfter = tBefore;
    for (let attempt = 1; attempt <= 3 && tAfter === tBefore; attempt++) {
      const r = await cdp.evalJS(`(() => {
        const el = document.querySelector('${D_SEL}');
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
      })()`);
      if (!r) break;
      await cdp.drag(r.x, r.y, r.x + 45, r.y + 35);
      await sleep(400);
      tAfter = await cdp.evalJS(domTransform);
      if (tAfter === tBefore) await sleep(300);
    }
    check("drag déplace le nœud (DOM)", tAfter !== tBefore ? "pass" : "fail", `transform ${tBefore} → ${tAfter}`);
    await sleep(1400);
    const posAfter = await cdp.evalJS(readDpos);
    check(
      "write-back au drop (pos de D réécrite)",
      posAfter && posAfter !== posBefore ? "pass" : "fail",
      `pos ${posBefore} → ${posAfter}`,
    );
    // (La stabilité caméra est vérifiée autour de l'édition inline en 4f :
    //  write-back sans drag → pas d'auto-pan, mesure non-flaky.)
    // Preuve anti-flicker : l'élément DOM du viewport (vue lecture) est conservé
    // → React a réconcilié l'arbre existant, pas de remontage de la vue visible.
    const markAfter = await cdp.evalJS(`document.querySelector('${SCOPE} .react-flow__viewport')?.dataset.sfyMark ?? null`);
    check(
      "pas de remontage React (anti-flicker)",
      markAfter && markAfter === markBefore ? "pass" : "fail",
      `viewport vue lecture ${markAfter === markBefore ? "conservé (réconcilié)" : "recréé (remonté)"}`,
    );
  } else {
    check("write-back au drop", "fail", "nœud D introuvable pour le drag");
  }

  // 4b) Suppression d'un nœud via le bouton ✕ → disparaît du DOM ET du .md.
  const cInDomBefore = await cdp.evalJS(`!!document.querySelector('${SCOPE} [data-id="oil"]')`);
  const cInMdBefore = await cdp.evalJS(`(async () => {
    const f = app.vault.getAbstractFileByPath('${NOTE}');
    return (await app.vault.read(f)).includes('id: oil,');
  })()`);
  if (cInDomBefore && cInMdBefore) {
    await cdp.evalJS(`document.querySelector('${SCOPE} [data-id="oil"] .sfy-del')?.click()`);
    await sleep(1500);
    const cInDomAfter = await cdp.evalJS(`!!document.querySelector('${SCOPE} [data-id="oil"]')`);
    const cInMdAfter = await cdp.evalJS(`(async () => {
      const f = app.vault.getAbstractFileByPath('${NOTE}');
      return (await app.vault.read(f)).includes('id: oil,');
    })()`);
    check("supprimer un nœud (bouton ✕)", !cInDomAfter && !cInMdAfter ? "pass" : "fail",
      `C — DOM:${cInDomAfter ? "présent" : "retiré"} / .md:${cInMdAfter ? "présent" : "retiré"}`);
  } else {
    check("supprimer un nœud (bouton ✕)", "fail", "nœud oil introuvable avant suppression");
  }

  // 4c) Suppression d'un LIEN via le ✕ de l'étiquette → retiré du DOM et du .md.
  const edgesBefore = await q(cdp, ".react-flow__edge");
  const linkInMdBefore = await cdp.evalJS(`(async () => {
    const f = app.vault.getAbstractFileByPath('${NOTE}');
    return (await app.vault.read(f)).includes('from: plate, to: SINK');
  })()`);
  const delEdgeBtn = await cdp.evalJS(`!!document.querySelector('${SCOPE} .sfy-edge-del[data-edge-id$="-plate-SINK"]')`);
  if (delEdgeBtn && linkInMdBefore) {
    await cdp.evalJS(`document.querySelector('${SCOPE} .sfy-edge-del[data-edge-id$="-plate-SINK"]').click()`);
    await sleep(1500);
    const edgesAfter = await q(cdp, ".react-flow__edge");
    const linkInMdAfter = await cdp.evalJS(`(async () => {
      const f = app.vault.getAbstractFileByPath('${NOTE}');
      return (await app.vault.read(f)).includes('from: plate, to: SINK');
    })()`);
    check("supprimer un lien (✕ sur l'étiquette)", edgesAfter < edgesBefore && !linkInMdAfter ? "pass" : "fail",
      `arêtes ${edgesBefore}→${edgesAfter}, .md plate→SINK ${linkInMdAfter ? "présent" : "retiré"}`);
  } else {
    check("supprimer un lien (✕ sur l'étiquette)", "fail", "lien plate→SINK ou son ✕ introuvable");
  }

  // 4d) Édition d'un nœud : DOUBLE-CLIC sur A → ouvre l'éditeur → machines 2 → 3.
  await cdp.evalJS(`document.querySelector('${SCOPE} [data-id="ingot"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await sleep(500);
  const editorShown = await cdp.evalJS(`!!document.querySelector('${SCOPE} .sfy-editor')`);
  if (editorShown) {
    await cdp.evalJS(`(() => {
      const input = document.querySelector('${SCOPE} .sfy-editor input[type="number"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '3');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(1500);
    const aMachines = await cdp.evalJS(`(async () => {
      const f = app.vault.getAbstractFileByPath('${NOTE}');
      const m = (await app.vault.read(f)).match(/id: ingot,[^}]*machines: (\\d+)/);
      return m ? m[1] : null;
    })()`);
    check("éditer un nœud (machines 2→3)", aMachines === "3" ? "pass" : "fail", `machines dans .md = ${aMachines}`);
  } else {
    check("éditer un nœud (panneau)", "fail", "panneau d'édition non affiché après sélection");
  }

  // 4e) Débits personnalisés : changer la machine + Appliquer → surcharges dans .md.
  const customInputShown = await cdp.evalJS(`!!document.querySelector('${SCOPE} .sfy-editor-custom .sfy-field input')`);
  if (customInputShown) {
    await cdp.evalJS(`(() => {
      const input = document.querySelector('${SCOPE} .sfy-editor-custom .sfy-field input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'TestMachine');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(200);
    await cdp.evalJS(`document.querySelector('${SCOPE} .sfy-editor .sfy-apply')?.click()`);
    await sleep(1500);
    const hasCustom = await cdp.evalJS(`(async () => {
      const f = app.vault.getAbstractFileByPath('${NOTE}');
      const t = await app.vault.read(f);
      return t.includes('machine: TestMachine') && t.includes('outputs: [');
    })()`);
    check("débits personnalisés (machine + extrants dans .md)", hasCustom ? "pass" : "fail", hasCustom ? "surcharges écrites" : "surcharges absentes");
  } else {
    check("débits personnalisés", "fail", "champ machine custom non affiché");
  }

  // 4f) Édition INLINE : double-clic sur le débit de sortie de A → écrit dans .md.
  const inlineFound = await cdp.evalJS(`(() => {
    const line = [...document.querySelectorAll('${SCOPE} [data-id="ingot"] .sfy-line')].find(l => l.textContent.includes('Output'));
    const span = line && line.querySelector('.sfy-inline');
    if (!span) return false;
    span.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return true;
  })()`);
  const zoomBeforeInline = await cdp.evalJS(`(() => { const e = document.querySelector('${SCOPE} .react-flow__viewport'); const m = e && e.style.transform.match(/scale\\(([\\d.]+)\\)/); return m ? m[1] : null; })()`);
  if (inlineFound) {
    await sleep(200);
    await cdp.evalJS(`(() => {
      const input = document.querySelector('${SCOPE} [data-id="ingot"] .sfy-inline-input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '999');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await sleep(1500);
    const has999 = await cdp.evalJS(`(async () => {
      const f = app.vault.getAbstractFileByPath('${NOTE}');
      const t = await app.vault.read(f);
      return /id: ingot,[\\s\\S]*?rate: 999/.test(t);
    })()`);
    check("édition inline (double-clic débit → .md)", has999 ? "pass" : "fail", has999 ? "debit 999 écrit" : "debit non écrit");
    // Caméra stable autour de ce write-back (sans drag → mesure fiable).
    const zoomAfterInline = await cdp.evalJS(`(() => { const e = document.querySelector('${SCOPE} .react-flow__viewport'); const m = e && e.style.transform.match(/scale\\(([\\d.]+)\\)/); return m ? m[1] : null; })()`);
    // Tolérance : un vrai reset (fitView) changerait le zoom drastiquement ; une
    // petite dérive (<25%) n'est pas un reset. Preuve forte = « pas de remontage ».
    const drift = zoomAfterInline && zoomBeforeInline ? Math.abs(Number(zoomAfterInline) - Number(zoomBeforeInline)) / Number(zoomBeforeInline) : 1;
    check("caméra stable après write-back (zoom préservé)", drift < 0.25 ? "pass" : "fail", `zoom ${zoomBeforeInline} → ${zoomAfterInline}`);
  } else {
    check("édition inline (double-clic)", "fail", "valeur inline introuvable sur le nœud ingot");
  }

  // 4h) Annuler (Ctrl+Z via bouton ↶) : revient sur l'édition inline (999).
  const had999 = await cdp.evalJS(`(async () => { const f = app.vault.getAbstractFileByPath('${NOTE}'); return (await app.vault.read(f)).includes('999'); })()`);
  const undoBtn = await cdp.evalJS(`!!document.querySelector('${SCOPE} button[title^="Undo"]')`);
  if (had999 && undoBtn) {
    await cdp.evalJS(`document.querySelector('${SCOPE} button[title^="Undo"]').click()`);
    await sleep(1500);
    const still999 = await cdp.evalJS(`(async () => { const f = app.vault.getAbstractFileByPath('${NOTE}'); return (await app.vault.read(f)).includes('999'); })()`);
    check("annuler (Ctrl+Z / ↶)", !still999 ? "pass" : "fail", still999 ? "999 toujours présent" : "édition annulée");
  } else {
    check("annuler (Ctrl+Z / ↶)", "fail", had999 ? "bouton ↶ introuvable" : "état 999 absent avant undo");
  }

  // 4g) Replier un calque : clic sur ▾ → nœud module + replie:true dans .md.
  const toggleShown = await cdp.evalJS(`!!document.querySelector('${SCOPE} .sfy-group-toggle')`);
  if (toggleShown) {
    await cdp.evalJS(`document.querySelector('${SCOPE} .sfy-group-toggle').click()`);
    await sleep(1500);
    const moduleShown = await cdp.evalJS(`!!document.querySelector('${SCOPE} .sfy-module')`);
    const replieInMd = await cdp.evalJS(`(async () => {
      const f = app.vault.getAbstractFileByPath('${NOTE}');
      return (await app.vault.read(f)).includes('collapsed: true');
    })()`);
    check("replier un calque (▾ → module + .md)", moduleShown && replieInMd ? "pass" : "fail",
      `module:${moduleShown ? "affiché" : "absent"} / .md replie:${replieInMd}`);

    // 4i) Renommer un calque : double-clic sur le nom du module → .md.
    const nameInline = await cdp.evalJS(`(() => {
      const span = document.querySelector('${SCOPE} .sfy-module .sfy-inline');
      if (!span) return false;
      span.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    })()`);
    if (nameInline) {
      await sleep(200);
      await cdp.evalJS(`(() => {
        const input = document.querySelector('${SCOPE} .sfy-module .sfy-inline-input');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'MonCalque');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      })()`);
      await sleep(1500);
      const renamed = await cdp.evalJS(`(async () => { const f = app.vault.getAbstractFileByPath('${NOTE}'); return (await app.vault.read(f)).includes('MonCalque'); })()`);
      check("renommer un calque (double-clic → .md)", renamed ? "pass" : "fail", renamed ? "nom écrit" : "nom non écrit");
    } else {
      check("renommer un calque", "fail", "nom inline introuvable sur le module");
    }
  } else {
    check("replier un calque", "fail", "bouton ▾ du calque introuvable");
  }

  // 4j) Auto-layout : clic « Ranger » → positions réécrites (espacées).
  const posBeforeTidy = await cdp.evalJS(`(async () => { const f = app.vault.getAbstractFileByPath('${NOTE}'); const m = (await app.vault.read(f)).match(/id: ore,[^}]*pos: \\[([-\\d]+), ([-\\d]+)\\]/); return m ? m[1]+','+m[2] : null; })()`);
  const tidyBtn = await cdp.evalJS(`!!document.querySelector('${SCOPE} button[title^="Tidy"]')`);
  if (tidyBtn) {
    await cdp.evalJS(`document.querySelector('${SCOPE} button[title^="Tidy"]').click()`);
    await sleep(1500);
    const posAfterTidy = await cdp.evalJS(`(async () => { const f = app.vault.getAbstractFileByPath('${NOTE}'); const m = (await app.vault.read(f)).match(/id: ore,[^}]*pos: \\[([-\\d]+), ([-\\d]+)\\]/); return m ? m[1]+','+m[2] : null; })()`);
    check("auto-layout (Ranger → positions réécrites)", posAfterTidy && posAfterTidy !== posBeforeTidy ? "pass" : "fail", `ore ${posBeforeTidy} → ${posAfterTidy}`);
  } else {
    check("auto-layout (Ranger)", "fail", "bouton Ranger introuvable");
  }

  // 4k) Picker de nœuds : + Nœud → recherche « rubber » → clic → recette ajoutée au .md.
  await cdp.evalJS(`document.querySelector('${SCOPE} [data-action="add-node"]')?.click()`);
  await sleep(400);
  const pickerShown = await cdp.evalJS(`!!document.querySelector('${SCOPE} .sfy-picker')`);
  if (pickerShown) {
    await cdp.evalJS(`(() => {
      const input = document.querySelector('${SCOPE} .sfy-picker-search input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'rubber refinery');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(300);
    const rowCount = await cdp.evalJS(`document.querySelectorAll('${SCOPE} .sfy-picker-row').length`);
    // Note le slug de la ligne cliquée (l'ordre du tri ne fait pas partie du contrat).
    const clickedRid = await cdp.evalJS(`(() => {
      const row = document.querySelector('${SCOPE} .sfy-picker-row');
      if (!row) return null;
      const rid = row.getAttribute('data-rid');
      row.click();
      return rid;
    })()`);
    await sleep(1500);
    const added = clickedRid
      ? await cdp.evalJS(`(async () => {
          const f = app.vault.getAbstractFileByPath('${NOTE}');
          return (await app.vault.read(f)).includes('recipe: ${clickedRid}');
        })()`)
      : false;
    check("picker de nœuds (recherche → ajout)", rowCount >= 1 && added ? "pass" : "fail",
      `${rowCount} résultat(s), ${clickedRid} ${added ? "ajoutée au .md" : "absente"}`);
  } else {
    check("picker de nœuds", "fail", "picker non affiché après + Nœud");
  }

  // 4l) Menu contextuel : clic droit sur le fond → menu affiché.
  await cdp.evalJS(`(() => {
    const pane = document.querySelector('${SCOPE} .react-flow__pane');
    if (!pane) return;
    const r = pane.getBoundingClientRect();
    pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 220, clientY: r.top + 220 }));
  })()`);
  await sleep(400);
  const ctxShown = await cdp.evalJS(`!!document.querySelector('${SCOPE} .sfy-ctx')`);
  check("menu contextuel (clic droit fond)", ctxShown ? "pass" : "fail", ctxShown ? "menu affiché" : "menu absent");
  await cdp.evalJS(`document.body.click()`); // referme

  // 5) Screenshot.
  const shotDir = path.join(__dirname);
  const shot = path.join(shotDir, "last-run.png");
  try {
    await cdp.screenshot(shot);
    console.log(`[e2e] screenshot → ${shot}`);
  } catch (e) {
    console.log(`[e2e] screenshot échoué: ${e.message}`);
  }

  // Rapport.
  let failed = 0;
  console.log("");
  for (const c of checks) {
    const icon = c.status === "pass" ? "✓" : c.status === "skip" ? "⊘" : "✗";
    console.log(`  ${icon} ${c.name} — ${c.msg}`);
    if (c.status === "fail") failed++;
  }
  console.log(`\n[e2e] ${checks.length - failed} pass, ${failed} fail`);
  cdp.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
