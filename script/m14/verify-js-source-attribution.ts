#!/usr/bin/env bun
/**
 * JAVASCRIPT — THE OUTGOING CLASSIFICATION, ASSERTED ON A FIXTURE (JSD48).
 *
 * ## What this is for
 *
 * `script/m14/javascript-store-resolution.mts` classifies every NULL-source row on a 250-file
 * DRAW and prints the classes with the two that must be empty (`own-store`, `own-analyzer`)
 * named as such. A draw can measure; it cannot ASSERT, and the difference matters here: the
 * draw reads 0 for both classes, and on a draw a 0 and a rule that stopped being evaluated
 * look identical (the reason both instruments print their zero-valued classes explicitly).
 *
 * This gate builds a project whose answer is known BEFORE the run — one file that declares the
 * name a row's source spells, one file whose LOCAL binding collides with a name a stranger
 * file declares — and then asserts the classification of every row through the REAL indexer
 * and the ONE shared rule (`js-ontology/js-source-classification.ts`).
 *
 * ## The three shapes, and what each one proves
 *
 *   DECLARED (positive control)  a file declares `caller`, and a row sits inside it. The
 *     store resolves a source by a SAME-FILE NAME LOOKUP at insert time
 *     (`parallel-indexer.ts`), so this row's source MUST resolve. If a regression broke that
 *     lookup the row would be NULL while the store still holds `caller` for that file — which
 *     is EXACTLY the `own-store` class, so this control is what makes that class a check
 *     rather than a decoration.
 *
 *   COLLISION  a file whose local `const write = …` is the actor of some rows, while `write`
 *     is declared by a DIFFERENT file. The store has no `write` for the row's own file, the
 *     name pass has a candidate in a file the row has nothing to do with, and the honest
 *     answer is NULL. Attaching it would be the wrong-file lie the lane refuses.
 *
 *   FILE-LEVEL  the file's own `imports` row, whose actor is the FILE: `metadata.fileLevel`
 *     makes the store rewrite `source_external` to the project-relative path (M60/#910). The
 *     classification must call that row attributed — and the raw sentinel `(file)` must not
 *     survive into the store, which is the check that the branch fired at all.
 *
 * ## Falsification
 *
 * Both zeros are assertable, so both must be shown to FAIL when the behaviour they describe
 * is removed — see the LANE RECORD in `docs/analyzers/real-javascript-analyzer.md` §Outgoing
 * for the arm (the insert-time lookup neutralised, reading N of M with A2 and A7 failing, and
 * the file restored byte-identically by sha256).
 *
 * Usage:  bun run script/m14/verify-js-source-attribution.ts
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import {
  classifyNullSourceRow,
  ecmaStdlibNames,
  ownFileOf,
  type NameLookupsByFile,
  type NullSourceClass,
} from "./js-ontology/js-source-classification"

let failed = 0
// The count is TAKEN from the checks that run, never typed. The lane has already shipped a
// gate whose summary line read a hardcoded total while a different number of checks executed
// (the binding gate read `32 of 32` with 33 running), and a summary that counts itself is the
// one part of a gate nothing else can verify.
let checksRun = 0
const check = (label: string, got: unknown, want: unknown) => {
  checksRun++
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`)
}

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-src-attr-"))
const projDir = path.join(workdir, "proj")
const dataDir = path.join(workdir, "data")
fs.mkdirSync(path.join(projDir, "lib"), { recursive: true })
fs.mkdirSync(dataDir, { recursive: true })
process.env.BB_DATA_DIR = dataDir

// ── THE DECLARING FILE (the positive control) ────────────────────────────────────────────
// `helper` is declared AND called from a second top-level function, so the call row's source
// is `caller` — a name this same file declares. The insert-time lookup must resolve it.
fs.writeFileSync(path.join(projDir, "lib", "declares.js"), [
  "export function helper(value) { return value }",
  "export function caller() { return helper(1) }",
  "",
].join("\n"))

// ── THE STRANGER (the colliding candidate) ───────────────────────────────────────────────
// A different file that declares `write`. It is what the name pass can reach and must not use.
fs.writeFileSync(path.join(projDir, "lib", "stranger.js"), [
  "export function write(target, value) { return target + value }",
  "",
].join("\n"))

// ── THE COLLISION ────────────────────────────────────────────────────────────────────────
// The actor of the rows inside `generate` is the LOCAL `const write = …`, a binding this
// language does not publish and this analyzer does not publish either (measured: the file's
// analyzer output holds no symbol of that name). So the rows carry `write` as their source
// spelling, their own file declares nothing called `write`, and `lib/stranger.js` does.
fs.writeFileSync(path.join(projDir, "collision.js"), [
  "import * as fs from 'node:fs'",
  "",
  "export function generate(target, value) {",
  "  const write = (text) => {",
  "    fs.appendFileSync(target, text + '\\n')",
  "    console.log(text)",
  "  }",
  "  write(value)",
  "  return value",
  "}",
  "",
].join("\n"))

const { getProjectId } = await import(path.join(process.cwd(), "src/cli/index.ts"))
const { indexProjectParallel } = await import(path.join(process.cwd(), "src/ast/parallel-indexer.ts"))
const { BrainDatabase } = await import(path.join(process.cwd(), "src/brain/database.ts"))
const { parseFile } = await import(path.join(process.cwd(), "src/ast/pool-worker.ts"))
const pid = (getProjectId as any)(projDir)
await indexProjectParallel(pid, projDir, { onProgress: () => {} } as any)
const raw: any = await (BrainDatabase as any).getRawInstance(pid)

// ── THE EVIDENCE, read back the way the instrument reads it ──────────────────────────────
const symRows = raw.prepare(
  `SELECT s.name AS name, f.relative_path AS file
     FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ?`,
).all(pid) as any[]

const storedNamesByFile = new Map<string, Set<string>>()
const storedNamesAnywhere = new Map<string, number>()
for (const s of symRows) {
  const file = String(s.file ?? "")
  const name = String(s.name ?? "")
  if (!file || !name) continue
  let names = storedNamesByFile.get(file)
  if (!names) storedNamesByFile.set(file, (names = new Set()))
  names.add(name)
  storedNamesAnywhere.set(name, (storedNamesAnywhere.get(name) ?? 0) + 1)
}

const relFiles = (raw.prepare(
  `SELECT relative_path FROM brain_file WHERE project_id = ?`,
).all(pid) as any[]).map((f) => String(f.relative_path))
const samplePaths = new Set(relFiles)

// The ANALYZER's own view of each file, through the real parser — the neighbouring evidence
// the `own-analyzer` class needs and the store cannot supply.
const analyzerNamesByFile = new Map<string, Map<string, Set<number>>>()
for (const rel of relFiles) {
  const abs = path.join(projDir, rel)
  let r: any
  try { r = await parseFile(abs, rel, undefined as any) } catch { continue }
  let perFile = analyzerNamesByFile.get(rel)
  if (!perFile) analyzerNamesByFile.set(rel, (perFile = new Map()))
  for (const s of r?.symbols ?? []) {
    const nm = String(s.name ?? "")
    if (!nm) continue
    let lines = perFile.get(nm)
    if (!lines) perFile.set(nm, (lines = new Set()))
    lines.add(s.range?.startLine ?? 0)
  }
}

const rows = raw.prepare(
  `SELECT r.id AS id, r.relationship_type AS t, r.source_external AS src,
          r.target_external AS tgt, r.source_symbol_id AS sid, r.target_symbol_id AS tid,
          r.line_number AS line, r.metadata AS md
     FROM brain_relationship r WHERE r.project_id = ?`,
).all(pid) as any[]

const stdlib = ecmaStdlibNames()
const classes: Array<{ row: any; cls: NullSourceClass; ownFile: string }> = []
const nullRows = rows.filter((r) => r.sid == null)
for (const r of nullRows) {
  const v = classifyNullSourceRow({
    source: String(r.src ?? ""),
    id: String(r.id ?? ""),
    samplePaths,
    storedNamesByFile: storedNamesByFile as unknown as NameLookupsByFile,
    analyzerNamesByFile: analyzerNamesByFile as unknown as NameLookupsByFile,
    storedNamesAnywhere,
    stdlib,
  })
  classes.push({ row: r, cls: v.cls, ownFile: v.ownFile })
}
const byClass = (c: NullSourceClass) => classes.filter((x) => x.cls === c)

// ── PREMISES: a fixture that stopped reproducing the shape must fail, not pass quietly ───
const collisionRows = classes.filter(
  (x) => String(x.row.src) === "write" && x.ownFile === "collision.js",
)
check("A1. PREMISE — the local actor's rows EXIST (the collision shape is in the fixture)",
  collisionRows.length > 0, true)
check("A2. PREMISE — a CANDIDATE exists: the store declares `write` for lib/stranger.js",
  storedNamesByFile.get("lib/stranger.js")?.has("write") ?? false, true)
check("A3. PREMISE — collision.js does NOT declare `write` (in the store, or in the analyzer's output)",
  [storedNamesByFile.get("collision.js")?.has("write") ?? false,
   analyzerNamesByFile.get("collision.js")?.has("write") ?? false],
  [false, false])

// ── THE ASSERTIONS ──────────────────────────────────────────────────────────────────────
check("B1. the local actor's rows carry the name and NO source symbol (the honest refusal)",
  collisionRows.map((x) => x.row.sid), collisionRows.map(() => null))
check("B2. … and classify as OTHER-FILES (a collision with an unrelated symbol)",
  [...new Set(collisionRows.map((x) => x.cls))], ["other-files"])
check("B3. the row's OWN file is recoverable from the id (the `file:` anchor)",
  [...new Set(collisionRows.map((x) => x.ownFile))], ["collision.js"])
check("B4. own-store — the row's own file declares the name in the STORE — is 0 rows",
  byClass("own-store").length, 0)
check("B5. own-analyzer — declared for the row's own file by the ANALYZER only — is 0 rows",
  byClass("own-analyzer").length, 0)
check("B6. every NULL-source row is classified (no remainder)",
  byClass("file-level").length + byClass("sentinel").length
    + classes.filter((x) => x.cls !== "file-level" && x.cls !== "sentinel").length,
  nullRows.length)
check("B7. the FILE-LEVEL row's source IS its own file path (the M60/#910 branch fired)",
  byClass("file-level").length > 0
    && byClass("file-level").every((x) => String(x.row.src) === x.ownFile && x.ownFile !== ""),
  true)
check("B8. no raw `(file)` sentinel survived into the store",
  byClass("sentinel").length, 0)
const callerRow = rows.find((r) => String(r.t) === "calls" && String(r.tgt) === "helper")
check("B9. CONTROL — a same-file declaration IS used: the `helper` call's source resolved to `caller`",
  callerRow == null ? null : raw.prepare(`SELECT name FROM brain_symbol WHERE id = ?`).get(callerRow.sid)?.name ?? null,
  "caller")

console.log(`\nNULL-source rows ${nullRows.length} · by class ` +
  ["file-level", "sentinel", "keyword", "own-store", "own-analyzer", "other-files", "stdlib", "neither"]
    .map((c) => `${c} ${byClass(c as NullSourceClass).length}`).join(" · "))
console.log(`\n${failed === 0 ? "PASS" : "FAIL"}  ${checksRun - failed} of ${checksRun} checks (${failed} failing)`)
console.log(`temp project: ${projDir}`)
process.exit(failed === 0 ? 0 : 1)
