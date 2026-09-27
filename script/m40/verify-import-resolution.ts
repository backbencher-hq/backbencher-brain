// script/m40/verify-import-resolution.ts — M60 / review JD2
// Behavioral gate for the `<module>:<item>` import-target resolution contract.
//
// THE DEFECT. Every analyzer that emits the `module:item` convention —
// javascript, typescript, python, dart, plus vue and svelte by delegation —
// produced import edges that no resolution strategy could ever match. The three
// strategies in `resolveRelationships` match a bare `name`, a `qualified_name`
// (`Owner.member`), or, for a dotted target, everything after the first `.`.
// `./util.js:helper` satisfies none of them. Measured end to end on a 2-file
// project before the fix: 4 of 4 `imports` edges UNRESOLVED, while `exports`
// edges (a bare name) and cross-file `calls` / `instantiates` all resolved. The
// `path:item` FORM was what failed, not the targets — so a module's import
// surface was invisible to bb_graph, bb_impact and hover in every one of those
// lanes.
//
// THE CONTRACT this gate holds, in both directions:
//
//   1. A named, unaliased import of an internal module to a unique target file,
//      where the item names one exported symbol, DOES resolve.
//   2. A namespace import (`import * as ns`) does NOT — it has no single target.
//   3. An ALIASED import (`import { draw as render }`) resolves to the DECLARED
//      name `draw` — reached without changing either pinned string, because the
//      analyzer records the declared name as additive relationship metadata
//      (JD2b). Before that it could not resolve at all, and a name-only match
//      attached it to an unrelated method that shared the local binding.
//   3b. A DEFAULT import resolves through the target module's default export, and
//      is REFUSED when the module has none.
//   4. AMBIGUITY refuses. A specifier naming two files resolves to neither.
//   5. The gate that makes 1 safe: a target must be in the importing module's
//      EXPORT SURFACE. Without it the first end-to-end run produced a
//      confidently WRONG edge — `import { draw as render }` attached to the
//      unrelated METHOD `Widget.render` that happened to share the local name.
//      An unresolved edge is honest; a confidently-wrong one is a lie that three
//      product surfaces repeat. Negative case asserted below.
//
// Run: npx tsx script/m40/verify-import-resolution.ts

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "../..")
const MUTATE = process.env.BB_M40_MUTATE_IMPORT_RES === "1"

process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "m40-importres-data-"))

let passed = 0
let failed = 0
let negatives = 0
function check(name: string, ok: boolean, detail = "", isNegative = false) {
  if (isNegative) { negatives++; if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name} :: ${detail}`) } return }
  if (ok) { passed++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`) }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` :: ${detail}` : ""}`) }
}

const proj = mkdtempSync(path.join(tmpdir(), "m40-importres-proj-"))
mkdirSync(path.join(proj, "src"), { recursive: true })
writeFileSync(path.join(proj, "bb.json"), JSON.stringify({ project: { name: "importres", embedding: { provider: "none" } } }))

// lib.js publishes `draw` and a real default export; the decoy `render` is a
// METHOD on the class and is NOT exported. app.js imports `draw` under the local
// name `render` — the exact shape that made the first implementation attach the
// edge to the decoy. nodefault.js has NO default export, so a default import of
// it must still be refused.
writeFileSync(path.join(proj, "src/lib.js"), `export function draw() { return 1 }
export class Widget { render() { return 2 } }
export default class Main { go() { return 3 } }
`)
writeFileSync(path.join(proj, "src/nodefault.js"), `export function only() { return 4 }
`)
writeFileSync(path.join(proj, "src/extra.js"), `export function helper() { return 3 }
`)
writeFileSync(path.join(proj, "src/app.js"), `import { draw as render } from "./lib.js"
import { helper } from "./extra.js"
import * as everything from "./extra.js"
import Def from "./lib.js"
import NoDefault from "./nodefault.js"
render()
helper()
everything.helper()
Def()
NoDefault()
`)

const cli: any = await import(path.join(ROOT, "src/cli/index"))
await cli.runCli(["index", proj])

const Database = (await import("better-sqlite3")).default
const { bbProjectsDir } = await import(path.join(ROOT, "src/util/bb-data-dir"))

// find the project dir the CLI just wrote
const projectsRoot = bbProjectsDir()
const dirs = readdirSync(projectsRoot)
let db: any = null
for (const d of dirs) {
  const candidate = path.join(projectsRoot, d, "brain.db")
  if (!existsSync(candidate)) continue
  const probe = new Database(candidate, { readonly: true })
  const n = probe.prepare(`SELECT count(*) c FROM brain_file WHERE relative_path LIKE '%app.js'`).get() as any
  if (n?.c > 0) { db = probe; break }
  probe.close()
}
if (!db) {
  console.log("  FAIL could not open the indexed project")
  process.exit(1)
}

const imports = db.prepare(
  `SELECT r.target_external AS tgt, t.name AS name, tf.relative_path AS inFile
     FROM brain_relationship r
     LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id
     LEFT JOIN brain_file tf ON tf.id = t.file_id
    WHERE r.relationship_type = 'imports'`,
).all() as any[]
const byTarget = new Map(imports.map((r) => [r.tgt, r]))

console.log(`\nimport edges after resolution (${imports.length}):`)
for (const r of imports) console.log(`   ${r.tgt.padEnd(28)} -> ${r.name ?? "(unresolved)"}${r.inFile ? "  in " + r.inFile : ""}`)

console.log("")
// 1. the positive case
const helper = byTarget.get("./extra.js:helper")
check("JD2.1 a named unaliased import of an internal module RESOLVES",
  helper?.name === "helper" && helper?.inFile === "src/extra.js",
  `got ${helper?.name ?? "unresolved"}`)

// 2. namespace
const ns = byTarget.get("./extra.js:*")
check("JD2.2 a namespace import does NOT resolve (no single target symbol)",
  !ns?.name, `got ${ns?.name ?? "unresolved"}`)

// 3. ALIASED (JD2b): the edge spells the LOCAL binding `render`, but the module
//    declares `draw`. The analyzer records the declared name as additive
//    metadata, so the edge resolves to `draw` — neither the local binding nor
//    the decoy method that shares it.
const aliased = byTarget.get("./lib.js:render")
check("JD2.3 an ALIASED import resolves to the DECLARED name, not the local binding",
  aliased?.name === "draw" && aliased?.inFile === "src/lib.js", `got ${aliased?.name ?? "unresolved"}`)
check("JD2.5 NEGATIVE: never attached to the same-named non-exported METHOD",
  aliased?.name !== "render", `attached to ${aliased?.name}`)

// 4. DEFAULT (JD2b): `import Def from "./lib.js"` where lib.js does
//    `export default class Main`. The edge spells the local binding `Def` and
//    the published symbol is `Main`, so the only honest route is the default
//    export's own flag. And a module with NO default export must still refuse.
const def = byTarget.get("./lib.js:Def")
check("JD2.4 a DEFAULT import resolves through the module's default export",
  def?.name === "Main" && def?.inFile === "src/lib.js", `got ${def?.name ?? "unresolved"}`)
const noDefault = byTarget.get("./nodefault.js:NoDefault")
check("JD2.7 NEGATIVE: a default import of a module with no default export is REFUSED",
  !noDefault?.name, `attached to ${noDefault?.name}`)

// 6. no import edge may point at a symbol its target file does not export
{
  const exportNames = new Set(
    (db.prepare(
      `SELECT DISTINCT target_external AS n FROM brain_relationship WHERE relationship_type='exports'`,
    ).all() as any[]).map((r) => r.n),
  )
  const bad = imports.filter((r) => r.name && r.tgt.includes(":") && !exportNames.has(r.name))
  check("JD2.6 no import edge resolves to a name the target module never exported",
    bad.length === 0, bad.map((b) => `${b.tgt} -> ${b.name}`).join(", "))
}

// 7. the mutation arm: with the gate stubbed off the decoy MUST reappear,
//    which is what proves the gate is load-bearing rather than decorative.
if (MUTATE) {
  check("MUTATION ARM: the export-surface gate was stubbed off — the decoy returns",
    aliased?.name === "render", `expected the decoy, got ${aliased?.name ?? "unresolved"}`, true)
}

db.close()
rmSync(proj, { recursive: true, force: true })
rmSync(process.env.BB_DATA_DIR!, { recursive: true, force: true })

console.log(`\n${failed === 0 ? `IMPORT RESOLUTION GATE: PASS` : `IMPORT RESOLUTION GATE: FAIL`} — ${passed} passed, ${failed} failed${negatives ? `, ${negatives} negative` : ""}`)
if (failed > 0) process.exit(1)
