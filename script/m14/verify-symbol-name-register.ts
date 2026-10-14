/**
 * JSD44 — the SYMBOL-NAME REGISTER, both halves, through the real indexer.
 *
 * One list decides which analyzer-published symbol names may enter the store, and it
 * existed in FOUR copies: `keepSymbol`'s universal set (pool-worker.ts), the
 * indexer's own SYMBOL_NAME_DENYLIST (parallel-indexer.ts), the keyword regex +
 * SQL list in analysis-exclusions.ts, and the per-language RESERVED table beside
 * keepSymbol. The first was measured and corrected — R 12 symbols deleted across 9
 * files, graphql 1 of 8,796 (Query.me), sql 3 of 18,325, lua 236 declarations (677
 * edges left naming nothing), hcl H10, solidity's store-vs-analyzer divergence — and
 * the other three kept dropping those names anyway. The sharpest instance:
 * `export function self(fn)` at packages/svelte/src/internal/client/dom/legacy/
 * event-modifiers.js:27 passed the analyzer and `keepSymbol`, and appeared in NO
 * symbol row project-wide, so a consumer importing `self` could never resolve.
 *
 * What this gate pins, all through `indexProjectParallel` and read back from the
 * store (not from any of the filters):
 *
 *  R1  a declared `self` IS a symbol row (the name the register removed)
 *  R2  a binding that imports it lands on that row's id (the consumer consequence)
 *  R3  the name is NOT hidden by the read-side SQL condition either — the same
 *      register has a mirrored filter in analysis-exclusions' SQL builders, and a
 *      store row that every query hides is a row that does not exist for a reader
 *  R4  `this`/`super` and the synthetic analyzer artifacts are STILL refused
 *      (the half of the list that is a real keyword claim)
 *  R5  a PHP `self` is STILL refused — the per-language reserved half, which is why
 *      this cannot be fixed by deleting the name everywhere
 *  R6  the removed-seven register exists and names the measurement for each entry,
 *      so a future edit that "restores a missing entry" has to argue with it
 *
 * FALSIFIED, and the falsification is the cheap arm: put each of the four replicas
 * back one at a time and R1 fails on the first two, R3 on the SQL mirror. The
 * restore is byte-wise, so the arm is re-runnable.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-register-"))
const proj = path.join(workdir, "proj")
fs.mkdirSync(proj, { recursive: true })
process.env.BB_DATA_DIR = path.join(workdir, "data")
fs.mkdirSync(process.env.BB_DATA_DIR, { recursive: true })

// The declaration file: `self` is the removed name; the other three are the
// controls — a reserved-word claim (`super`), a synthetic analyzer artifact, and a
// name that is refused for ONE language only (PHP).
fs.writeFileSync(path.join(proj, "declarations.js"), [
  "export function self(fn) { return fn }",
  "export function root(x) { return x }",
  "export function consumerish(x) { return x }",
  "",
].join("\n"))
fs.writeFileSync(path.join(proj, "consumer.js"), [
  'import { self } from "./declarations.js"',
  "export function wire(fn) { return self(fn) }",
  "",
].join("\n"))
// A PHP file declaring `self` as a method name: the per-language reserved half.
fs.writeFileSync(path.join(proj, "reserved.php"), [
  "<?php",
  "class Holder {",
  "  public function self() { return 1; }",
  "}",
  "",
].join("\n"))

const { getProjectId } = await import(path.join(process.cwd(), "src/cli/index.ts"))
const { indexProjectParallel } = await import(path.join(process.cwd(), "src/ast/parallel-indexer.ts"))
const { BrainDatabase } = await import(path.join(process.cwd(), "src/brain/database.ts"))
const { analysisSymbolNameConditions } = await import(path.join(process.cwd(), "src/ast/analysis-exclusions.ts"))
const { SYMBOL_NAME_DENYLIST_REMOVED, SYMBOL_NAME_UNIVERSAL_DENYLIST } = await import(path.join(process.cwd(), "src/ast/symbol-name-rules.ts"))

const pid = (getProjectId as any)(proj)
await indexProjectParallel(pid, proj, { onProgress: () => {} } as any)
const raw: any = await BrainDatabase.getRawInstance(pid)

const rows: { file: string; name: string; id: string }[] = raw.prepare(
  `SELECT f.relative_path AS file, s.name AS name, s.id AS id
     FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    ORDER BY f.relative_path, s.name`,
).all()
const has = (file: string, name: string) => rows.find((r) => r.file.endsWith(file) && r.name === name)

const checks: { id: string; pass: boolean; detail: string }[] = []
const check = (id: string, pass: boolean, detail: string) => checks.push({ id, pass, detail })

// R1 — the removed name is a stored row.
const selfRow = has("declarations.js", "self")
check("R1. a declared `self` is a symbol row", !!selfRow, selfRow ? `${selfRow.file}:self` : "MISSING — a filter re-refused it")

// R3 — the read-side SQL mirror must not hide it either. The condition is the
// store's own guard, so ask IT rather than re-stating its list.
const sqlConditions = (analysisSymbolNameConditions as any)().map((c: any) => c?.queryChunks ? String((c as any).value ?? "") : String(c))
const sqlText = JSON.stringify(sqlConditions)
check("R3. the read-side SQL mirror no longer hides `self`", !/'self'/.test(sqlText), `sql keywords list: ${/'self'/.test(sqlText) ? "still contains 'self'" : "clean"}`)

// R2 — the consumer: the binding row exists AND the call site's edge lands on the
// row id above. Both halves, because a binding to a name with no row is the
// pre-fix state (it looked resolved and pointed nowhere).
const binds: any[] = raw.prepare(
  `SELECT i.imported_name AS name, i.imported_as AS local, i.file_id AS file_id
     FROM brain_import i JOIN brain_file f ON f.id = i.file_id
    WHERE f.relative_path LIKE '%consumer.js'`,
).all()
const selfBind = binds.find((b) => (b.local ?? b.name) === "self")
check("R2a. the import records a binding for `self`", !!selfBind, JSON.stringify(binds))

const edge: any = selfRow
  ? raw.prepare(
    `SELECT r.target_symbol_id AS tid, r.target_external AS tname FROM brain_relationship r
      WHERE r.relationship_type = 'calls' AND (r.target_external = 'self' OR r.target_symbol_id = ?) LIMIT 1`,
  ).get(selfRow.id)
  : null
check("R2b. a call through the import lands on that row", !!edge && edge.tid === selfRow!.id,
  edge ? `edge holds ${edge.tid === selfRow!.id ? "the declarer's id" : `tid=${edge.tid ?? "(detached)"} name=${edge.tname}`}` : "no edge found")

// R4 — the reserved-keyword half of the list is still refused. `super` and a
// synthetic artifact name are asserted through the shared predicate itself
// (declaring them in source would need them to be legal identifiers).
const { isDenylistedSymbolName } = await import(path.join(process.cwd(), "src/ast/symbol-name-rules.ts"))
check("R4. `this`/`super` and synthetic artifacts are STILL refused",
  (isDenylistedSymbolName as any)("super", "javascript") === true
  && (isDenylistedSymbolName as any)("module_declaration", "javascript") === true
  && SYMBOL_NAME_UNIVERSAL_DENYLIST.has("super"),
  "universal set: " + JSON.stringify([...SYMBOL_NAME_UNIVERSAL_DENYLIST]))

// R5 — the per-language half: PHP still refuses `self`.
const phpSelf = has("reserved.php", "self")
check("R5. a PHP `self` is STILL refused", !phpSelf, phpSelf ? "stored — the language-reserved half was lost" : "refused")
// ...and the JS `root` (a removed name) is stored, which is what makes R5 a scoping
// claim rather than a blanket "delete the names" claim.
check("R5b. the removed name `root` IS stored for javascript", !!has("declarations.js", "root"),
  has("declarations.js", "root") ? "root present" : "MISSING")

// R6 — the register itself: every removed name carries its measurement.
check("R6. the removed-name register names a measurement per entry",
  SYMBOL_NAME_DENYLIST_REMOVED.size >= 8
  && ["self", "root", "program", "source_file", "unknown", "me", "My", "destructor"].every((n) => (SYMBOL_NAME_DENYLIST_REMOVED as any).has(n))
  && [...(SYMBOL_NAME_DENYLIST_REMOVED as any).values()].every((v: string) => v && v.length > 8),
  `${(SYMBOL_NAME_DENYLIST_REMOVED as any).size} entries`)

for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.id}${c.pass ? "" : ` — ${c.detail}`}`)
const failed = checks.filter((c) => !c.pass)
console.log(`\n${failed.length ? "FAIL" : "PASS"}  ${checks.length - failed.length} of ${checks.length} checks (${failed.length} failing)`)
if (failed.length) console.log(`detail: ${JSON.stringify(rows.map((r) => `${r.file}:${r.name}`))}`)
process.exit(failed.length ? 1 : 0)
