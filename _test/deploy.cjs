#!/usr/bin/env node
/**
 * Deploys the current build (main.js + manifest.json + styles.css) into the
 * test vault's plugin folder. `data.json` is never touched.
 *
 * Target vault: $SFY_TEST_VAULT, otherwise `../satisfactory-test-vault`.
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
  console.error(`[deploy] vault not found: ${VAULT}`);
  console.error(`[deploy] set SFY_TEST_VAULT to point elsewhere.`);
  process.exit(1);
}

fs.mkdirSync(DEST, { recursive: true });

for (const f of FILES) {
  const src = path.join(REPO_ROOT, f);
  if (!fs.existsSync(src)) {
    console.error(`[deploy] missing: ${src} — did you run the build?`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(DEST, f));
  console.log(`[deploy] ${f} → ${path.join(DEST, f)}`);
}
console.log(`[deploy] OK.`);
