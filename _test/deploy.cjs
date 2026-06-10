#!/usr/bin/env node
/**
 * Déploie le build courant (main.js + manifest.json + styles.css) dans le
 * dossier plugin du vault de test. `data.json` n'est jamais touché.
 *
 * Vault cible : $SFY_TEST_VAULT, sinon `../satisfactory-test-vault`.
 */
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const VAULT =
  process.env.SFY_TEST_VAULT || path.resolve(REPO_ROOT, "..", "satisfactory-test-vault");
const PLUGIN_ID = "satisfactory-chains";
const DEST = path.join(VAULT, ".obsidian", "plugins", PLUGIN_ID);
const FILES = ["main.js", "manifest.json", "styles.css"];

if (!fs.existsSync(VAULT)) {
  console.error(`[deploy] vault introuvable: ${VAULT}`);
  console.error(`[deploy] définis SFY_TEST_VAULT pour pointer ailleurs.`);
  process.exit(1);
}

fs.mkdirSync(DEST, { recursive: true });

for (const f of FILES) {
  const src = path.join(REPO_ROOT, f);
  if (!fs.existsSync(src)) {
    console.error(`[deploy] manquant: ${src} — as-tu lancé le build ?`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(DEST, f));
  console.log(`[deploy] ${f} → ${path.join(DEST, f)}`);
}
console.log(`[deploy] OK.`);
