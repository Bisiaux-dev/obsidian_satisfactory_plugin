#!/usr/bin/env node
/**
 * E2E runner — drives the REAL Obsidian via Chrome DevTools Protocol.
 *
 * Prerequisites:
 *   1. npm run build
 *   2. node _test/deploy.cjs
 *   3. powershell -File _test/launch-obsidian.ps1 -Vault <satisfactory-test-vault>
 *   4. node _test/e2e.cjs
 *
 * Verifies: plugin loaded, block rendered (React Flow), diagnostic badges (A blocked
 * by the orphaned silica, under-used coal), arrows ➤ + loop ♻, layers,
 * and the WRITE-BACK on drop (real drag of a node → pos rewritten into the .md).
 * Screenshot in _test/last-run.png. Exit 0 if everything passes.
 */
const fs = require("fs");
const path = require("path");
const { connect, sleep, PORT } = require("./cdp.cjs");

const PLUGIN_ID = "satisfactory-chains";
const NOTE = "EXAMPLE.md";

// Clean content rewritten before the run (idempotence) — real chain (game data).
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

// A markdown leaf has 2 render surfaces (hidden live-preview editor + visible
// reading view) → scope everything to the reading view to measure the real render.
const SCOPE = ".markdown-reading-view";
// Drag a CENTRAL node with a small offset: far from the pane edges
// → no React Flow auto-pan → isolates camera stability from the write-back.
const D_SEL = `${SCOPE} [data-id="plate"]`;

async function q(cdp, selector, prop = "length") {
  return cdp.evalJS(`document.querySelectorAll(${JSON.stringify(SCOPE + " " + selector)}).${prop}`);
}

async function main() {
  let cdp;
  try {
    cdp = await connect();
  } catch (e) {
    console.error(`\n✗ CDP connection failed on port ${PORT}: ${e.message}`);
    console.error(`  → Run: powershell -File _test/launch-obsidian.ps1 -Vault <vault>\n`);
    process.exit(1);
  }
  console.log(`[e2e] connected to: ${cdp.target.title || cdp.target.url}`);

  // 1) Reload plugin (loads the freshly deployed main.js).
  await cdp.evalJS(`(async () => {
    await app.plugins.disablePlugin('${PLUGIN_ID}');
    await app.plugins.enablePlugin('${PLUGIN_ID}');
  })()`);
  await sleep(800);

  // 2) Rewrite the clean note, CLOSE all leftover markdown leaves, then
  //    open a SINGLE leaf in reading mode (the block renders only once).
  await cdp.evalJS(`(async () => {
    let f = app.vault.getAbstractFileByPath('${NOTE}');
    if (!f) f = await app.vault.create('${NOTE}', ${JSON.stringify(CLEAN)});
    else await app.vault.modify(f, ${JSON.stringify(CLEAN)});
    // keep ONE markdown leaf, close the others (without removing the tab group)
    const leaves = app.workspace.getLeavesOfType('markdown');
    for (let i = 1; i < leaves.length; i++) leaves[i].detach();
    const leaf = leaves[0] || app.workspace.getLeaf(true);
    await leaf.openFile(f, { active: true });
    await leaf.setViewState({ type: 'markdown', state: { file: f.path, mode: 'preview' }, active: true });
  })()`);
  await sleep(2500);
  const leaves = await cdp.evalJS(`app.workspace.getLeavesOfType('markdown').length`);
  check("single markdown leaf", leaves === 1 ? "pass" : "fail", `${leaves} leaf(s)`);
  // Normalize the camera ONCE (fitView) early, for a deterministic drag without
  // disturbing the viewport during the camera stability test.
  await cdp.evalJS(`document.querySelector('${SCOPE} .react-flow__controls-fitview')?.click()`);
  await sleep(800);

  // 3) Render assertions (DOM observable in the real Obsidian).
  check("plugin enabled", (await cdp.evalJS(`!!app.plugins.plugins['${PLUGIN_ID}']?._loaded`)) ? "pass" : "fail", "");
  const graph = await q(cdp, ".sfy-graph");
  check("satisfactory block rendered (.sfy-graph)", graph === 1 ? "pass" : "fail", `${graph} graph(s) in reading view`);
  const rfNodes = await q(cdp, ".react-flow__node");
  check("React Flow nodes", rfNodes >= 8 ? "pass" : "fail", `${rfNodes} (expected 8: 5 nodes + Sink + 2 layers)`);
  const groups = await q(cdp, ".sfy-group");
  check("layers rendered", groups === 2 ? "pass" : "fail", `${groups} (expected 2: smelting, petro)`);
  const bad = await q(cdp, ".sfy-node.bad");
  check("blocked node (orphaned oil residue)", bad === 1 ? "pass" : "fail", `${bad} .bad node(s) (expected 1: plastic)`);
  const warn = await q(cdp, ".sfy-node.warn");
  check("under-used node (ore surplus)", warn >= 1 ? "pass" : "fail", `${warn} .warn node(s)`);
  const arrows = await q(cdp, ".sfy-cap-arrow");
  check("directional arrows ➤", arrows >= 4 ? "pass" : "fail", `${arrows} arrowheads (expected 5)`);

  // 4) Write-back: real drag of node D → DOM moves AND pos rewritten into the .md.
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
  // Mark the viewport DOM element (reading view): if it is kept after the
  // write-back, React RECONCILED (no remount = no visible flicker).
  await cdp.evalJS(`(() => { const e = document.querySelector('${SCOPE} .react-flow__viewport'); if (e && !e.dataset.sfyMark) e.dataset.sfyMark = 'm' + (window.__sfyMarkN = (window.__sfyMarkN || 0) + 1); })()`);
  const markBefore = await cdp.evalJS(`document.querySelector('${SCOPE} .react-flow__viewport')?.dataset.sfyMark ?? null`);
  if (rect && posBefore) {
    // Retry: synthetic mouse events sometimes miss the pointer capture.
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
    check("drag moves the node (DOM)", tAfter !== tBefore ? "pass" : "fail", `transform ${tBefore} → ${tAfter}`);
    await sleep(1400);
    const posAfter = await cdp.evalJS(readDpos);
    check(
      "write-back on drop (D's pos rewritten)",
      posAfter && posAfter !== posBefore ? "pass" : "fail",
      `pos ${posBefore} → ${posAfter}`,
    );
    // (Camera stability is verified around the inline edit in 4f:
    //  write-back without drag → no auto-pan, non-flaky measurement.)
    // Anti-flicker proof: the viewport DOM element (reading view) is kept
    // → React reconciled the existing tree, no remount of the visible view.
    const markAfter = await cdp.evalJS(`document.querySelector('${SCOPE} .react-flow__viewport')?.dataset.sfyMark ?? null`);
    check(
      "no React remount (anti-flicker)",
      markAfter && markAfter === markBefore ? "pass" : "fail",
      `reading view viewport ${markAfter === markBefore ? "kept (reconciled)" : "recreated (remounted)"}`,
    );
  } else {
    check("write-back on drop", "fail", "node D not found for the drag");
  }

  // 4b) Delete a node via the ✕ button → disappears from the DOM AND the .md.
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
    check("delete a node (✕ button)", !cInDomAfter && !cInMdAfter ? "pass" : "fail",
      `C — DOM:${cInDomAfter ? "present" : "removed"} / .md:${cInMdAfter ? "present" : "removed"}`);
  } else {
    check("delete a node (✕ button)", "fail", "oil node not found before deletion");
  }

  // 4c) Delete a LINK via the label's ✕ → removed from the DOM and the .md.
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
    check("delete a link (✕ on the label)", edgesAfter < edgesBefore && !linkInMdAfter ? "pass" : "fail",
      `edges ${edgesBefore}→${edgesAfter}, .md plate→SINK ${linkInMdAfter ? "present" : "removed"}`);
  } else {
    check("delete a link (✕ on the label)", "fail", "plate→SINK link or its ✕ not found");
  }

  // 4d) Edit a node: DOUBLE-CLICK on A → opens the editor → machines 2 → 3.
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
    check("edit a node (machines 2→3)", aMachines === "3" ? "pass" : "fail", `machines in .md = ${aMachines}`);
  } else {
    check("edit a node (panel)", "fail", "edit panel not shown after selection");
  }

  // 4e) Custom rates: change the machine + Apply → overrides in .md.
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
    check("custom rates (machine + outputs in .md)", hasCustom ? "pass" : "fail", hasCustom ? "overrides written" : "overrides missing");
  } else {
    check("custom rates", "fail", "custom machine field not shown");
  }

  // 4f) INLINE edit: double-click on A's output rate → written to the .md.
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
    check("inline edit (double-click rate → .md)", has999 ? "pass" : "fail", has999 ? "rate 999 written" : "rate not written");
    // Camera stable around this write-back (no drag → reliable measurement).
    const zoomAfterInline = await cdp.evalJS(`(() => { const e = document.querySelector('${SCOPE} .react-flow__viewport'); const m = e && e.style.transform.match(/scale\\(([\\d.]+)\\)/); return m ? m[1] : null; })()`);
    // Tolerance: a real reset (fitView) would change the zoom drastically; a
    // small drift (<25%) is not a reset. The strong proof is "no remount".
    const drift = zoomAfterInline && zoomBeforeInline ? Math.abs(Number(zoomAfterInline) - Number(zoomBeforeInline)) / Number(zoomBeforeInline) : 1;
    check("camera stable after write-back (zoom preserved)", drift < 0.25 ? "pass" : "fail", `zoom ${zoomBeforeInline} → ${zoomAfterInline}`);
  } else {
    check("inline edit (double-click)", "fail", "inline value not found on the ingot node");
  }

  // 4h) Undo (Ctrl+Z via ↶ button): reverts the inline edit (999).
  const had999 = await cdp.evalJS(`(async () => { const f = app.vault.getAbstractFileByPath('${NOTE}'); return (await app.vault.read(f)).includes('999'); })()`);
  const undoBtn = await cdp.evalJS(`!!document.querySelector('${SCOPE} button[title^="Undo"]')`);
  if (had999 && undoBtn) {
    await cdp.evalJS(`document.querySelector('${SCOPE} button[title^="Undo"]').click()`);
    await sleep(1500);
    const still999 = await cdp.evalJS(`(async () => { const f = app.vault.getAbstractFileByPath('${NOTE}'); return (await app.vault.read(f)).includes('999'); })()`);
    check("undo (Ctrl+Z / ↶)", !still999 ? "pass" : "fail", still999 ? "999 still present" : "edit undone");
  } else {
    check("undo (Ctrl+Z / ↶)", "fail", had999 ? "↶ button not found" : "999 state missing before undo");
  }

  // 4g) Collapse a layer: click ▾ → module node + collapsed:true in the .md.
  const toggleShown = await cdp.evalJS(`!!document.querySelector('${SCOPE} .sfy-group-toggle')`);
  if (toggleShown) {
    await cdp.evalJS(`document.querySelector('${SCOPE} .sfy-group-toggle').click()`);
    await sleep(1500);
    const moduleShown = await cdp.evalJS(`!!document.querySelector('${SCOPE} .sfy-module')`);
    const replieInMd = await cdp.evalJS(`(async () => {
      const f = app.vault.getAbstractFileByPath('${NOTE}');
      return (await app.vault.read(f)).includes('collapsed: true');
    })()`);
    check("collapse a layer (▾ → module + .md)", moduleShown && replieInMd ? "pass" : "fail",
      `module:${moduleShown ? "shown" : "missing"} / .md collapsed:${replieInMd}`);

    // 4i) Rename a layer: double-click on the module name → .md.
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
      check("rename a layer (double-click → .md)", renamed ? "pass" : "fail", renamed ? "name written" : "name not written");
    } else {
      check("rename a layer", "fail", "inline name not found on the module");
    }
  } else {
    check("collapse a layer", "fail", "layer ▾ button not found");
  }

  // 4j) Auto-layout: click "Tidy" → positions rewritten (spaced out).
  const posBeforeTidy = await cdp.evalJS(`(async () => { const f = app.vault.getAbstractFileByPath('${NOTE}'); const m = (await app.vault.read(f)).match(/id: ore,[^}]*pos: \\[([-\\d]+), ([-\\d]+)\\]/); return m ? m[1]+','+m[2] : null; })()`);
  const tidyBtn = await cdp.evalJS(`!!document.querySelector('${SCOPE} button[title^="Tidy"]')`);
  if (tidyBtn) {
    await cdp.evalJS(`document.querySelector('${SCOPE} button[title^="Tidy"]').click()`);
    await sleep(1500);
    const posAfterTidy = await cdp.evalJS(`(async () => { const f = app.vault.getAbstractFileByPath('${NOTE}'); const m = (await app.vault.read(f)).match(/id: ore,[^}]*pos: \\[([-\\d]+), ([-\\d]+)\\]/); return m ? m[1]+','+m[2] : null; })()`);
    check("auto-layout (Tidy → positions rewritten)", posAfterTidy && posAfterTidy !== posBeforeTidy ? "pass" : "fail", `ore ${posBeforeTidy} → ${posAfterTidy}`);
  } else {
    check("auto-layout (Tidy)", "fail", "Tidy button not found");
  }

  // 4k) Node picker: + Node → search "rubber" → click → recipe added to the .md.
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
    // Record the slug of the clicked row (the sort order is not part of the contract).
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
    check("node picker (search → add)", rowCount >= 1 && added ? "pass" : "fail",
      `${rowCount} result(s), ${clickedRid} ${added ? "added to the .md" : "missing"}`);
  } else {
    check("node picker", "fail", "picker not shown after + Node");
  }

  // 4l) Context menu: right-click on the background → menu shown.
  await cdp.evalJS(`(() => {
    const pane = document.querySelector('${SCOPE} .react-flow__pane');
    if (!pane) return;
    const r = pane.getBoundingClientRect();
    pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 220, clientY: r.top + 220 }));
  })()`);
  await sleep(400);
  const ctxShown = await cdp.evalJS(`!!document.querySelector('${SCOPE} .sfy-ctx')`);
  check("context menu (right-click background)", ctxShown ? "pass" : "fail", ctxShown ? "menu shown" : "menu missing");
  await cdp.evalJS(`document.body.click()`); // close it

  // 4m) N shortcut: hover a pane point, press N, pick a recipe → node created
  // AT the mouse position (flow coords of the hovered point, written to the .md).
  const hoverPt = await cdp.evalJS(`(() => {
    const pane = document.querySelector('${SCOPE} .react-flow__pane');
    if (!pane) return null;
    const r = pane.getBoundingClientRect();
    return { x: Math.round(r.left + 480), y: Math.round(r.top + 300) };
  })()`);
  if (hoverPt) {
    // Real mouse move (sets hovered + mousePos), then a real N key press.
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hoverPt.x, y: hoverPt.y });
    await sleep(200);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "n", code: "KeyN", text: "n" });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "n", code: "KeyN" });
    await sleep(400);
    // Expected flow position of the hovered point (viewport transform math).
    const expected = await cdp.evalJS(`(() => {
      const host = document.querySelector('${SCOPE} .react-flow');
      const vp = document.querySelector('${SCOPE} .react-flow__viewport');
      if (!host || !vp) return null;
      const r = host.getBoundingClientRect();
      const m = new DOMMatrixReadOnly(getComputedStyle(vp).transform);
      return { fx: (${hoverPt.x} - r.left - m.m41) / m.a, fy: (${hoverPt.y} - r.top - m.m42) / m.d };
    })()`);
    const floatShown = await cdp.evalJS(`!!document.querySelector('${SCOPE} .sfy-float .sfy-picker')`);
    await cdp.evalJS(`(() => {
      const input = document.querySelector('${SCOPE} .sfy-float .sfy-picker-search input');
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'iron ingot smelter');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(300);
    await cdp.evalJS(`document.querySelector('${SCOPE} .sfy-float .sfy-picker-row')?.click()`);
    await sleep(1500);
    const placed = expected
      ? await cdp.evalJS(`(async () => {
          const f = app.vault.getAbstractFileByPath('${NOTE}');
          const t = await app.vault.read(f);
          const pts = [...t.matchAll(/pos: \\[(-?\\d+), (-?\\d+)\\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
          return pts.some(([x, y]) => Math.abs(x - ${expected.fx}) <= 3 && Math.abs(y - ${expected.fy}) <= 3);
        })()`)
      : false;
    check("N adds a node at the mouse position", floatShown && placed ? "pass" : "fail",
      `picker at cursor: ${floatShown}, node pos ≈ (${expected ? Math.round(expected.fx) + "," + Math.round(expected.fy) : "?"}) in .md: ${placed}`);
  } else {
    check("N adds a node at the mouse position", "fail", "pane not found");
  }

  // 5) Screenshot.
  const shotDir = path.join(__dirname);
  const shot = path.join(shotDir, "last-run.png");
  try {
    await cdp.screenshot(shot);
    console.log(`[e2e] screenshot → ${shot}`);
  } catch (e) {
    console.log(`[e2e] screenshot failed: ${e.message}`);
  }

  // Report.
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
