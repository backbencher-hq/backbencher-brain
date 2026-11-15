// bb_tests/bb_patterns/probes/probe-p1-import-tail.mjs
// P1 — reproduce, byte-for-byte, the `importedPathTails` computation from
// src/intelligence/patterns/orphans.ts:207-217 and measure what it actually
// concludes on a real index.
//
// WHY IN JS AND NOT SQL: the engine's rule is
//     spec = ext.split(":")[0];  tail = spec.split("/").pop().replace(/\.[^.]+$/,"")
// which is "substring after the LAST slash" plus "strip a trailing extension".
// An SQL emulation of `split("/").pop()` is easy to get subtly wrong, and a
// wrong emulation produces findings that are defects in the measurement rather
// than in the tool. The first attempt at this file did exactly that (a
// replace-all-slashes rtrim) and reported tails like "/lib/evidence". So the
// rule is transcribed here directly from the engine source, and this file
// re-reads orphans.ts to prove the transcription is still current.

import path from "node:path"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const projectId = process.argv[2]

// ---- the rule, transcribed from orphans.ts -------------------------------
const engineSource = readFileSync(path.join(REPO, "src/intelligence/patterns/orphans.ts"), "utf8")
const ruleSnippet = engineSource.split("\n").slice(206, 218).join("\n")
console.log("=== orphans.ts:207-217 (the rule under test) ===")
console.log(ruleSnippet)
console.log()

function engineTail(ext) {
  if (!ext) return null
  const spec = ext.split(":")[0] ?? ext
  const tail = spec.split("/").pop()?.replace(/\.[^.]+$/, "") ?? spec
  return tail
}

const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", projectId, "brain.db"), { readonly: true, fileMustExist: true })

const importRows = db.prepare("SELECT target_external AS ext FROM brain_relationship WHERE relationship_type = 'imports'").all()
const tails = new Map()
for (const r of importRows) {
  const t = engineTail(r.ext)
  if (t === null) continue
  tails.set(t, (tails.get(t) ?? 0) + 1)
}
const files = db.prepare("SELECT id, relative_path AS p, line_count FROM brain_file WHERE project_id = ?").all(projectId)

function engineBasename(p) {
  return p.split("/").pop()?.replace(/\.[^.]+$/, "") ?? p
}

console.log(`import rows: ${importRows.length}   distinct tails: ${tails.size}   files: ${files.length}`)

console.log("\n--- top 20 tails the engine derives from imports ---")
for (const [t, c] of [...tails].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`   ${String(c).padStart(5)}  ${JSON.stringify(t)}`)
}

// A file is suppressed from orphaned_file purely by name collision with a tail.
const collisions = files.filter((f) => tails.has(engineBasename(f.p)))
console.log(`\n--- files whose orphan-file verdict is suppressed by NAME ONLY (${collisions.length}) ---`)
for (const f of collisions.slice(0, 30)) console.log(`   ${f.p}`)

// Which of those have a real import edge naming their path? If a collision
// suppresses a file that IS genuinely imported, the heuristic is hiding a live
// file (a false negative); if it suppresses files nobody imports, it is just
// noise, not a correctness problem.
const realImporters = new Map()
for (const r of importRows) {
  if (!r.ext) continue
  const t = engineTail(r.ext)
  if (!t) continue
  if (!realImporters.has(t)) realImporters.set(t, [])
  realImporters.get(t).push(r.ext)
}
console.log(`\n--- for each colliding file, the import specifiers that suppressed it ---`)
for (const f of collisions.slice(0, 12)) {
  const b = engineBasename(f.p)
  console.log(`   ${f.p}\n       stem=${JSON.stringify(b)} suppressing specs: ${JSON.stringify((realImporters.get(b) ?? []).slice(0, 4))}`)
}

// The third-party case: tails that name a package, not a local module.
const PACKAGE_ROOTS = new Set(["node", "react", "express", "fs", "path", "os", "crypto", "http", "url", "util", "vscode", "drizzle-orm", "web-tree-sitter", "typescript", "vitest", "commander", "d3"])
const packageTails = [...tails.keys()].filter((t) => PACKAGE_ROOTS.has(t))
console.log(`\n--- tails that are third-party/builtin package names, not local paths (${packageTails.length}) ---`)
console.log("   " + JSON.stringify(packageTails))

// How many of those actually name a file that exists here?
const stemSet = new Set(files.map((f) => engineBasename(f.p)))
const live = packageTails.filter((t) => stemSet.has(t))
console.log(`   of those, ${live.length} collide with a REAL local file stem: ${JSON.stringify(live)}`)

db.close()
