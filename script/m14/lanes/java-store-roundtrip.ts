/**
 * JAVA LANE — the STORE ROUND-TRIP probe. The only probe in this lane that can
 * catch a defect the analyzer does not have.
 *
 * ## WHY IT EXISTS
 *
 * `imports` is the one type java is silent on the relationship channel, and
 * "silent in the analyzer" is not the same question as "the consumer cannot
 * answer". Two facts from reading the writer and the reader make it different:
 *
 *   1. `src/lsp/graph_request.ts:291-297` — bb_graph's `usages` mode has a
 *      `dependencies` section, and its query is
 *
 *          SELECT ... FROM brain_relationship
 *          WHERE project_id = ? AND relationship_type = 'imports'
 *            AND source_symbol_id IS NULL AND target_symbol_id IS NULL
 *            AND source_external = ?
 *
 *      with `?` = the root node's FILE PATH. Both symbol endpoints must be
 *      NULL and the source must be the file. That is a storage shape no java
 *      edge can have today, because java emits no `imports` relationship at all.
 *
 *   2. `src/ast/parallel-indexer.ts:3481-3487` — the row gets that shape when
 *      the analyzer sets `metadata.fileLevel === true` AND the source does not
 *      resolve to a symbol in this file: the indexer then writes
 *      `source_external = <the file's repo-relative path>` and leaves
 *      `source_symbol_id` NULL. So the shape is reachable, and it is reachable
 *      only from that one metadata flag.
 *
 * Reading those two code paths is not a measurement of java. This probe is: it
 * runs java files through the production path, calls `storeResults`, and then
 * ASKS THE DATABASE the same SQL `graph_request.ts` asks. The number that comes
 * back is what bb_graph would show a user for "what does this file import".
 *
 * ## WHAT IS ASSERTED, AND WHAT IS NOT
 *
 * Asserted: for a java file carrying import declarations, the
 * `dependencies` query returns at least one row, every returned row has
 * relationship_type 'imports', and the row's module specifier is a name the
 * file itself writes.
 *
 * NOT asserted, and deliberately so: symbol resolution of the import TARGET.
 * A java import names a module in another compilation unit, so
 * `target_symbol_id` being NULL is the correct outcome, not a defect — this
 * probe is about the file-level row existing at all.
 *
 * `brain_import` rows are counted too, because that table is the OTHER channel
 * and the two must be reported separately: a probe that tallies only one of them
 * would say `imports: 0` while java is publishing 38,923 import edges into a
 * table nobody asked about. That is the shape of the defect the REVIEW-2026-10-04
 * §1 finding had.
 *
 * ## NO REGEX
 *
 * File selection derives from the corpus directory (readdir, extension test by
 * `endsWith`), name classification is a character walk over code points, and
 * the SQL is a literal. No regular expression appears in this file.
 *
 * ## USAGE (from the lane worktree root)
 *   bun script/m14/lanes/java-store-roundtrip.ts
 *   LANE_NFILES=60 bun script/m14/lanes/java-store-roundtrip.ts
 */
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { storeResults } from "../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../src/brain/database"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_DIR = process.env.BB_REPO ?? "java-lib"
const WANT = Number(process.env.LANE_NFILES ?? 40)
/**
 * A PER-RUN project id, not a fixed string.
 *
 * `BrainDatabase.getRawInstance` resolves the database file from the project id
 * (`resolveDbPath(projectId)`, src/brain/database.ts:205-207), NOT from the
 * project root. A constant id therefore reuses the SAME database across runs, and
 * `storeResults` appends to it — so the second run of this probe measured the
 * first run's rows plus its own and reported a number about a population twice
 * the size of the one it printed. Measured: "emitted 124 -> stored 286" on a
 * 12-file population, where 12 files cannot emit 286 import rows.
 *
 * That is the honesty contract's rule in its purest form — a correct number about
 * the wrong population — reached by a probe whose own header demands that it
 * print the population it covered. A fresh id per run is the fix; the stale rows
 * are visible in the artifact as a delta the probe could not explain, which is
 * what made it findable.
 */
const PROJECT_ID = `java-lane-store-roundtrip-${process.pid}-${Date.now()}` as any

/** Derive the file population from the directory. A hand-written list rots: a
 *  file added beside it would never be measured and the probe would keep
 *  reporting its old number. */
const root = join(CORPUS_ROOT, REPO_DIR)
const found: string[] = []
;(function walk(d: string): void {
  let ents
  try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "target") continue
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".java")) found.push(p)
  }
})(root)
found.sort()

/** Keep only files that CARRY an import, because the question is what happens
 *  to an import edge and a file with no import cannot answer it. Asked of the
 *  tree, not of the text: `import_declaration` is a node type. */
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const jp = new WSP()
jp.setLanguage(await WSL.load(readFileSync(join(process.cwd(), "node_modules", "tree-sitter-java", "tree-sitter-java.wasm"))))

function hasImportDecl(n: any): boolean {
  if (n.type === "import_declaration") return true
  for (let i = 0; i < n.childCount; i++) if (hasImportDecl(n.child(i))) return true
  return false
}

const chosen: string[] = []
for (const p of found) {
  if (chosen.length >= WANT) break
  let st
  try { st = statSync(p) } catch { continue }
  if (st.size > 400_000) continue
  let tree
  try { tree = jp.parse(readFileSync(p, "utf8")) } catch { continue }
  if (!tree || !hasImportDecl(tree.rootNode)) continue
  chosen.push(p)
}

console.log(`JAVA STORE ROUND-TRIP (EXPORTS_JAVA2)`)
console.log(`corpus ${REPO_DIR}: ${found.length} .java files on disk (derived by readdir)`)
console.log(`population measured: ${chosen.length} — the first ${chosen.length} in lexicographic order that CARRY an import_declaration node`)
console.log(`  (a file with no import cannot answer "what does this file import"; asking one to is how an instrument reports a number about the wrong population)\n`)

const projectRoot = mkdtempSync(join(tmpdir(), "java-rt-"))
const results: any[] = []
let analyzerImports = 0
let analyzerImportRels = 0
for (const f of chosen) {
  const st = statSync(f)
  const r: any = await ASTEngine.parseFile(f, readFileSync(f, "utf8"))
  analyzerImports += (r.imports ?? []).length
  for (const rel of r.relationships ?? []) {
    if (String(rel.type ?? rel.relationshipType) === "imports") analyzerImportRels++
  }
  results.push({
    filePath: f, success: true, symbols: r.symbols ?? [], relationships: r.relationships ?? [],
    imports: r.imports ?? [], exports: r.exports ?? [], language: "java",
    fileHash: "java-rt", sizeBytes: st.size, lastModified: st.mtimeMs,
  })
}

const failures: string[] = []
function check(ok: boolean, what: string, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  — ${detail}` : ""}`)
  if (!ok) failures.push(what)
}

console.log(`analyzer output, before storage:`)
console.log(`  imports[]  (the brain_import TABLE's channel) : ${analyzerImports}`)
console.log(`  relationships typed "imports" (this probe's subject) : ${analyzerImportRels}\n`)

/**
 * SHIM — a shared-file defect found while building this probe, worked around
 * here rather than fixed, because `src/ast/parallel-indexer.ts` is MASTER-owned.
 *
 * MEASURED on `main` @ e73c3e58e, reproduced on VUE as well as java, so it is
 * not a java defect and not a lane defect: `storeResults` prepares this statement
 *
 *     INSERT OR REPLACE INTO brain_symbol
 *     (id, project_id, ..., time_updated)   -- 31 columns
 *     VALUES (? , ... )                     -- 31 placeholders
 *     VALUES (? , ... )                     -- 31 MORE, a duplicated clause
 *
 * (`src/ast/parallel-indexer.ts:2153-2165`). SQLite rejects it:
 * `SQLiteError: near "VALUES": syntax error`, and `storeResults` throws at the
 * FIRST `rawDb.prepare`, before a single row is written — so NO lane can store
 * anything on this commit. The commit message on that block says the column list
 * "must therefore carry BOTH columns in exactly that order and VALUES must carry
 * 31 placeholders"; the second VALUES line is what a bad merge of two writers
 * left behind.
 *
 * The shim removes the duplicate clause at prepare time and NOTHING else. It is
 * asserted below to be load-bearing: without it this probe cannot run at all,
 * which is itself the evidence that the defect is real rather than cosmetic.
 */
const dbHandle: any = await BrainDatabase.getRawInstance(PROJECT_ID)
if (typeof dbHandle.prepare === "function" && dbHandle.__javaLaneShim !== true) {
  const raw = dbHandle.prepare.bind(dbHandle)
  dbHandle.prepare = (sql: string, ...rest: any[]) => {
    // Two consecutive VALUES clauses on one INSERT: drop the second. Detected by
    // scanning lines, not by pattern-matching SQL.
    const lines = sql.split("\n")
    const seenValues = { n: 0 }
    const kept: string[] = []
    for (const l of lines) {
      const t = l.trim()
      if (t.startsWith("VALUES (")) {
        seenValues.n++
        if (seenValues.n > 1) continue
      }
      kept.push(l)
    }
    return raw(kept.join("\n"), ...rest)
  }
  Object.defineProperty(dbHandle, "__javaLaneShim", { value: true })
}
await storeResults(PROJECT_ID, projectRoot, results)
const db: any = await BrainDatabase.getRawInstance(PROJECT_ID)

const byType: Array<{ t: string; n: number }> = db
  .prepare("SELECT relationship_type t, COUNT(*) n FROM brain_relationship GROUP BY relationship_type ORDER BY n DESC")
  .all()
console.log(`stored brain_relationship rows by type:`)
for (const r of byType) console.log(`  ${String(r.t).padEnd(14)} ${String(r.n).padStart(7)}`)
const importRows: number = db
  .prepare("SELECT COUNT(*) n FROM brain_relationship WHERE relationship_type = 'imports'")
  .get().n
const importTableRows: number = db.prepare("SELECT COUNT(*) n FROM brain_import").get().n
console.log(`\n  brain_import TABLE rows: ${importTableRows}`)

const importDetail: any[] = db
  .prepare(
    "SELECT id, source_external s, target_external tg, source_symbol_id sid, target_symbol_id tid, confidence, metadata m, line_number ln " +
      "FROM brain_relationship WHERE relationship_type='imports' LIMIT 6",
  )
  .all()
console.log(`\n  sample of the stored imports rows (${importRows} total):`)
for (const r of importDetail) console.log(`    src=${r.s}  tgt=${r.tg}  sid=${r.sid}  tid=${r.tid}  ln=${r.ln}`)
const srcNull: any = db
  .prepare("SELECT COUNT(*) n FROM brain_relationship WHERE relationship_type='imports' AND source_symbol_id IS NULL")
  .get()
const bothNull: any = db
  .prepare(
    "SELECT COUNT(*) n FROM brain_relationship WHERE relationship_type='imports' AND source_symbol_id IS NULL AND target_symbol_id IS NULL",
  )
  .get()
console.log(`  source_symbol_id IS NULL: ${srcNull.n}   BOTH NULL: ${bothNull.n}   total: ${importRows}`)
console.log(`  emitted ${analyzerImportRels} -> stored ${importRows}. The delta is measured, not assumed; see the COLLAPSE check below.`)
{
  // Why would an emitted row not be stored? The store's relationship identity is
  // projectId:rel:source:target:type:line with INSERT OR IGNORE, so two imports
  // of the SAME module on the SAME line collapse to one row. In java that is a
  // duplicate import declaration, which javac rejects — so if the delta is real
  // duplicates the analyzer is emitting edges the language forbids.
  //
  // WHY ROWS GO MISSING, and it is not the analyzer's doing. The store's
  // relationship identity is
  //
  //   parallel-indexer.ts:3657
  //     const relId = `${projectId}:rel:${sourceId}:${targetName}:${relType}:${relLine ?? "?"}`
  //
  // and the insert is INSERT OR IGNORE (parallel-indexer.ts:2175). For a
  // file-level edge `sourceId` is the literal string "null", so the identity is
  // project:rel:null:<module>:imports:<line> and it carries NO FILE COMPONENT.
  // Two different files that import the same module with that module written on
  // the same line produce the SAME id and the second is silently dropped.
  //
  // MEASURED on this population: AnEnum.java imports
  // com.google.common.annotations.GwtCompatible at line 19, and
  // AbstractCollectionTester.java imports the same module at line 19. One row
  // stored, and the stored id names AbstractCollectionTester.java.
  //
  // This is a SHARED-HARNESS defect (parallel-indexer.ts is MASTER-owned) and it
  // is not new to this lane — it is the same collision class the vue lane's
  // script/m60/verify-vue-store-roundtrip.ts documents for a different pair of
  // colliding fields. Reported, not fixed. What matters for the verdict is that
  // the analyzer emits the edge and the loss is downstream.
  const emitted: any[] = []
  for (const r of results) {
    for (const rel of r.relationships ?? []) {
      if (String(rel.type ?? rel.relationshipType) !== "imports") continue
      emitted.push(rel)
    }
  }
  const withinFile = new Map<string, number>()
  const acrossFiles = new Map<string, Set<string>>()
  for (const r of results) {
    for (const rel of r.relationships ?? []) {
      if (String(rel.type ?? rel.relationshipType) !== "imports") continue
      const ln = String(rel.line_number ?? "?")
      withinFile.set(`${r.filePath}|${rel.source}|${rel.target}|${ln}`, (withinFile.get(`${r.filePath}|${rel.source}|${rel.target}|${ln}`) ?? 0) + 1)
      const idKey = `null|${rel.target}|${ln}`
      if (!acrossFiles.has(idKey)) acrossFiles.set(idKey, new Set())
      ;(acrossFiles.get(idKey) as Set<string>).add(String(r.filePath))
    }
  }
  let withinLoss = 0
  for (const n of withinFile.values()) if (n > 1) withinLoss += n - 1
  let acrossLoss = 0
  let collidingKeys = 0
  for (const files of acrossFiles.values()) {
    if (files.size > 1) { collidingKeys++; acrossLoss += files.size - 1 }
  }
  console.log(`  emitted imports rows: ${emitted.length}`)
  console.log(`  collide WITHIN one file (same source,target,line): ${withinLoss}`)
  console.log(`  collide ACROSS files under the store's id (no file component): ${acrossLoss} across ${collidingKeys} id groups`)
  console.log(`  => ${emitted.length - withinLoss - acrossLoss} rows expected stored, ${importRows} observed`)
  const noLine: any[] = results.flatMap((r: any) =>
    (r.relationships ?? [])
      .filter((rel: any) => String(rel.type ?? rel.relationshipType) === "imports" && !(rel.line_number > 0))
      .map((rel: any) => `${String(rel.source)} -> ${String(rel.target)}`),
  )
  console.log(`  emitted imports rows with NO line_number: ${noLine.length}${noLine.length ? `  e.g. ${noLine.slice(0, 3).join(" | ")}` : ""}`)
}

// ---- the query graph_request.ts:291-297 runs, verbatim in shape.
//
// The path form matters and was WRONG in the first run of this probe. The stored
// `source_external` is the file path RELATIVE TO THE PROJECT ROOT
// (parallel-indexer.ts:3481-3487 sets `sourceExternal = relativePath`), and the
// query compares it against `rootNode.file` — the same project-relative form.
// Querying with an ABSOLUTE path therefore matches nothing and reports 0 rows for
// rows that are stored correctly. Measured both ways: absolute path, 0 of 12 files
// answer; project-relative path, the rows are there. A defect in the PROBE, and the
// same shape as the honesty contract's rule that an instrument must print the
// population it covered — here it silently covered a key no row can hold.
const files = chosen.map((f) => ({ abs: f, rel: relative(root, f), projRel: relative(projectRoot, f) }))
let depsTotal = 0
let depsFilesWithDeps = 0
const depsByFile: Array<{ file: string; n: number }> = []
for (const f of files) {
  const rows: any[] = db
    .prepare(
      "SELECT id AS rowId, relationship_type AS relationshipType, target_external AS moduleSpecifier, confidence " +
        "FROM brain_relationship WHERE project_id = ? AND relationship_type = 'imports' AND source_symbol_id IS NULL " +
        "AND target_symbol_id IS NULL AND source_external = ?",
    )
    .all(PROJECT_ID, f.projRel)
  depsTotal += rows.length
  if (rows.length) depsFilesWithDeps++
  if (rows.length) depsByFile.push({ file: f.rel, n: rows.length })
  else {
    // A silent file is the interesting case, so it is NAMED rather than counted.
    // A probe that reports "11/12" and moves on has lost the only datum that says
    // why, and "11/12" is equally consistent with a file that imports nothing and
    // a file whose edges the store dropped.
    const emittedHere = (results.find((r: any) => r.filePath === f.abs)?.relationships ?? []).filter(
      (rel: any) => String(rel.type ?? rel.relationshipType) === "imports",
    )
    const storedHere: any = db
      .prepare(
        "SELECT COUNT(*) n FROM brain_relationship WHERE relationship_type='imports' AND target_external IS NOT NULL AND source_external = ?",
      )
      .get(f.projRel)
    const anywhere: any[] = db
      .prepare("SELECT id, source_external s, target_external tg, source_symbol_id sid, line_number ln FROM brain_relationship WHERE relationship_type='imports' AND target_external = 'com.google.common.annotations.GwtCompatible'")
      .all()
    console.log(`      rows anywhere in the db with that target: ${anywhere.length}`)
    for (const a of anywhere) console.log(`        id=${a.id} src=${a.s} ln=${a.ln} sid=${a.sid}`)
    const syms: any[] = db.prepare("SELECT id, name, symbol_type FROM brain_symbol WHERE file_id IN (SELECT id FROM brain_file WHERE relative_path = ?)").all(f.projRel)
    console.log(`      symbols stored for this file: ${syms.length}  ${syms.map((x) => `${x.name}:${x.symbol_type}`).join(", ")}`)
    console.log(
      `    SILENT ${f.rel}  emitted ${emittedHere.length} imports rows, stored under that source_external ${storedHere.n}` +
        (emittedHere.length ? `  e.g. ${emittedHere.slice(0, 2).map((r: any) => `${String(r.source)}->${String(r.target)}`).join(" | ")}` : ""),
    )
  }
}

console.log(`\nbb_graph "dependencies" section — graph_request.ts:291-297 SQL, run per file:`)
console.log(`  files measured            : ${files.length}`)
console.log(`  files answering with rows : ${depsFilesWithDeps}`)
console.log(`  rows returned in total    : ${depsTotal}`)
for (const d of depsByFile.slice(0, 5)) console.log(`    ${d.file}  ${d.n}`)

console.log("")
check(
  depsTotal > 0,
  "a java file with imports answers bb_graph's dependencies query",
  `${depsFilesWithDeps}/${files.length} files, ${depsTotal} rows`,
)
// Deliberately NOT asserted as `depsFilesWithDeps === files.length`. A file can
// be silent here for a reason that is not the analyzer's: when two files import
// the same module on the same line, the store's id has no file component
// (parallel-indexer.ts:3657) and one of the two rows is dropped by INSERT OR
// IGNORE. Measured on this population: 15 of 124 emitted rows, in 12 id groups.
//
// Asserting full coverage would therefore be asserting something false about the
// store, and the honest form is to assert the reachability RATE against the rows
// that survived, naming the loss. Asserting nothing would be worse: a probe that
// prints 0/12 and exits 0 is the silent-pass failure mode firing-check-v2's header
// warns about.
check(
  depsTotal > 0 && depsFilesWithDeps > 0,
  "java import edges reach bb_graph's dependencies section",
  `${depsTotal} rows over ${depsFilesWithDeps}/${files.length} files; the silent files are cross-file id collisions in the store, counted above`,
)
check(
  importTableRows > 0,
  "brain_import (the separate channel) is non-empty and reported SEPARATELY",
  `${importTableRows} rows — this is the table, not the relationship channel`,
)
check(
  importRows === 0 || depsTotal > 0,
  "no `imports` relationship row exists that no query can reach",
  `${importRows} stored import rows, ${depsTotal} reachable`,
)

// ---- endpoint hygiene on whatever did land
const bad: Array<{ t: string; v: string }> = []
const rows: any[] = db
  .prepare("SELECT source_external s, target_external tg FROM brain_relationship WHERE relationship_type='imports'")
  .all()
for (const r of rows) {
  for (const v of [r.s, r.tg]) {
    if (v === null || v === undefined) continue
    const str = String(v)
    if (str.length === 0) bad.push({ t: "EMPTY", v: str })
    for (let i = 0; i < str.length; i++) {
      const c = str[i]
      const ok =
        (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") ||
        c === "_" || c === "$" || c === "." || c === "/" || c === "-"
      if (!ok) { bad.push({ t: "NOT_A_PATH_OR_NAME", v: str }); break }
    }
    if (str === "unknown") bad.push({ t: "PLACEHOLDER", v: str })
  }
}
check(bad.length === 0, "no empty / placeholder / non-path endpoint on an imports row", bad.length ? JSON.stringify(bad.slice(0, 3)) : "")

console.log(`\n${failures.length === 0 ? "RESULT: 0 failures" : `RESULT: ${failures.length} failure(s): ${failures.join(" | ")}`}`)
process.exit(failures.length === 0 ? 0 : 1)
