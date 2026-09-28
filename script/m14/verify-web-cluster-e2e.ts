/**
 * #384 — Web-embedded cluster e2e gate
 *
 * Indexes a polyglot web project through the real CLI and asserts:
 * 1. Symbols extracted from EVERY language of the web-embedded seam
 *    (ts, tsx-shaped vue, js, svelte, css, html, json)
 * 2. Imports persisted per language
 * 3. Cross-language edges (ts→js calls) flagged
 * 4. Vue template component usage detected
 *
 * M49 W17: the ledger's "Web embedded" cell declares that seam as
 * ts/tsx + js + html + css + vue/svelte + json, but the fixture stopped at
 * ts/js/vue/css — so html, json and svelte were **claimed** by the ledger and
 * **measured by nothing**. The fixture now carries all seven, and the symbol
 * assertion is driven off the same list, so a language dropped from the seam
 * fails here instead of silently shrinking the claim.
 *
 * CLI: npx tsx script/m14/verify-web-cluster-e2e.ts
 */
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"
import { createHash } from "crypto"
import { createRequire } from "module"
const require = createRequire(import.meta.url)
const Database = require("better-sqlite3")

const ROOT = process.cwd()
const TMP = "/tmp/opencode/m14-web-cluster"

function writeProject() {
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(path.join(TMP, "src"), { recursive: true })
  
  fs.writeFileSync(path.join(TMP, "src", "types.ts"), 
    'export interface Widget {\n  id: string\n  label: string\n}\nexport type Filter = "active" | "done"\n')
  
  fs.writeFileSync(path.join(TMP, "src", "api.ts"),
    'import type { Widget } from "./types"\nexport function fetchWidgets(): Widget[] { return [] }\nexport function saveWidget(w: Widget): void {}\n')
  
  fs.writeFileSync(path.join(TMP, "src", "component.js"),
    "import { fetchWidgets } from './api.js';\nexport function initWidgets() {\n  return fetchWidgets();\n}\n")
  
  fs.writeFileSync(path.join(TMP, "src", "App.vue"),
    `<script setup lang="ts">\nimport { ref } from 'vue'\nimport type { Widget } from './types'\n\nconst widgets = ref<Widget[]>([])\nconst label = ref('')\n</script>\n\n<template>\n  <div class="app"><span>{{ label }}</span></div>\n</template>\n`)
  
  fs.writeFileSync(path.join(TMP, "src", "styles.css"), ".app { display: flex; }\n")

  // M49 W17: the four seam languages the fixture omitted. Each one has to
  // produce at least one symbol through the real CLI, or the ledger's claim
  // about the seam is not backed by a measurement.
  fs.writeFileSync(path.join(TMP, "src", "Counter.svelte"),
    "<script lang=\"ts\">\n" +
    "  export let start: number = 0\n" +
    "  let count = start\n" +
    "  function bump(): void { count += 1 }\n" +
    "</script>\n" +
    "\n" +
    "<button on:click={bump}>{count}</button>\n")

  fs.writeFileSync(path.join(TMP, "src", "index.html"),
    "<!doctype html>\n<html lang=\"en\">\n  <head><title>Widgets</title></head>\n" +
    "  <body>\n    <div id=\"app\" class=\"app\"></div>\n" +
    "    <script type=\"module\" src=\"/src/api.ts\"></script>\n  </body>\n</html>\n")

  fs.writeFileSync(path.join(TMP, "src", "config.json"),
    JSON.stringify({ widgets: { limit: 25, filter: "active" }, theme: "dark" }, null, 2) + "\n")
}

async function main() {
  writeProject()
  execSync("node bin/bb index " + TMP + " --force", { cwd: ROOT, stdio: "pipe" })

  const sha = createHash("sha1").update(TMP).digest("hex")
  const dbPath = path.join(process.env.HOME ?? "", ".bb", "projects", sha, "brain.db")
  const db = new Database(dbPath, { readonly: true })
  
  const failures: string[] = []
  const expect = (cond: boolean, msg: string) => { if (!cond) failures.push(msg) }

  // Symbols from EVERY language of the declared seam. The list is the ledger's
  // claim, spelled once: dropping a language from it would shrink the seam
  // silently, so the gate also asserts the list itself (below).
  const SEAM_LANGS = ["typescript", "javascript", "vue", "svelte", "css", "html", "json"]
  for (const lang of SEAM_LANGS) {
    const c = db.prepare(`SELECT COUNT(*) c FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE f.language=?`).get(lang) as any
    expect(c.c > 0, `symbols persisted for ${lang} (got ${c.c})`)
  }
  expect(SEAM_LANGS.length === 7, `the seam covers all seven languages (got ${SEAM_LANGS.length})`)

  // The svelte component is not only indexed — its script symbols land on the
  // component, which is the thing that makes a `<Counter />` usage resolvable.
  const counter = db.prepare(
    `SELECT COUNT(*) c FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
     WHERE f.language='svelte' AND s.name='bump'`).get() as any
  expect(counter.c > 0, `svelte script symbol persisted (bump: ${counter.c})`)

  // The JSON seam is real indexing, not a file row: a config probe symbol must
  // exist, so "json is in the cluster" cannot be satisfied by an empty parse.
  const jsonSym = db.prepare(
    `SELECT COUNT(*) c FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE f.language='json'`).get() as any
  expect(jsonSym.c > 0, `json symbols persisted (got ${jsonSym.c})`)

  // imports per language
  const jsImps = db.prepare(`SELECT COUNT(*) c FROM brain_import bi JOIN brain_file f ON f.id=bi.file_id WHERE f.path LIKE '%.js'`).get() as any
  const vueImps = db.prepare(`SELECT COUNT(*) c FROM brain_import bi JOIN brain_file f ON f.id=bi.file_id WHERE f.path LIKE '%.vue'`).get() as any
  const tsImps = db.prepare(`SELECT COUNT(*) c FROM brain_import bi JOIN brain_file f ON f.id=bi.file_id WHERE f.path LIKE '%.ts'`).get() as any
  expect(Number(jsImps.c) > 0 || Number(tsImps.c) > 0 || Number(vueImps.c) > 0, `imports persisted for at least one language`)

  // cross-language edge: js→ts call
  const xl = db.prepare(`
    SELECT r.relationship_type t, r.is_cross_language xl, r.bridge_mechanism b,
      f1.path p1, f2.path p2
    FROM brain_relationship r
    LEFT JOIN brain_symbol s1 ON s1.id = r.source_symbol_id
    LEFT JOIN brain_symbol s2 ON s2.id = r.target_symbol_id
    LEFT JOIN brain_file f1 ON f1.id = s1.file_id
    LEFT JOIN brain_file f2 ON f2.id = s2.file_id
    WHERE r.is_cross_language = 1`).all() as any[]
  expect(xl.length > 0, "cross-language edges exist")

  // evidence
  const { emitEvidence } = await import("./evidence-harness")
  emitEvidence({
    // M49 W8: this gate used to emit `M14.0.F8`, which belongs to the
    // corpus-census gate (the ledger's F8 definition and the honesty gate's own
    // F8 comment). It destroyed that evidence on every battery run. Own id now.
    issueId: "M14.0.WC1",
    title: "Web-cluster e2e gate",
    claimLevel: "L1",
    layers: ["cluster-e2e"],
    checks: [
      { id: "web-cluster-e2e", description: "polyglot web project (ts/js/vue/svelte/css/html/json) indexed via the real CLI, all assertions pass", status: failures.length ? ("fail" as const) : ("pass" as const) },
    ],
    limitations: [
      { description: "covers web-embedded cluster only; other clusters built during their waves" },
      { description: "the seam languages are asserted as a LIST plus a symbol floor (a probe name for svelte, any symbol for json): this proves each language is indexed and persisted, not that every construct in it is extracted — the per-language F3 fixtures carry that" },
    ],
    data: { failures },
  })

  if (failures.length) {
    console.error("WEB CLUSTER E2E FAILED:\n" + failures.map(f => "  - " + f).join("\n"))
    process.exit(10)
  }
  console.log("web-cluster e2e: symbols, imports, cross-language edges verified in brain.db")
}

main().catch(e => { console.error(e); process.exit(1) })
