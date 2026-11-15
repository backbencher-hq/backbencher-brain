/**
 * PROOF RUNNER for `script/m14/html-ruled.ts` — runs the shared arbiter against
 * this lane's ruling table WITHOUT editing the shared file.
 *
 * ## Why this exists
 *
 * `script/m14/ontology-coverage-gate.ts` is MASTER-owned and its `RULED_BY_LANG`
 * is a literal, so the table in `script/m14/html-ruled.ts` cannot be exercised by
 * running the gate as it stands. A table that has never been run is a claim. This
 * runner is the difference between the two: it copies the gate to a temp
 * directory, applies EXACTLY the patch the supervisor's permanent change needs,
 * and runs the copy. The patch is printed, so it can be applied by hand without
 * re-deriving it.
 *
 * The technique is `validation/m14/fixtures/toml/ruled-gate.ts`'s. It is a copy
 * because the one thing worse than a lane with no ruling table is a lane that
 * edits shared machinery to manufacture a passing verdict.
 *
 * ## The patch, and the one thing it must NOT include
 *
 *   1. `import { HTML_RULED } from "<abs path>"`  — the table.
 *   2. `RULED_BY_LANG = { …, html: HTML_RULED }`  — the map entry.
 *
 * There is deliberately NO third patch, and the absence is the point. The toml
 * runner had to redirect `specPath` to a temp spec, because toml's own
 * `toml-completeness.json` writes its decision text into a field the gate does
 * not read, and the gate would then report every ruled row RULED-UNJUSTIFIED —
 * a verdict about the SPEC rather than about the table. `rulingFor()` checks the
 * TABLE FIRST and only falls back to the spec, so html needs no such redirect:
 * the four rows are decided by `script/m14/html-ruled.ts` and the spec is never
 * consulted. If this runner ever needs a third patch, the table has stopped
 * being the thing under test.
 *
 * ## What the run below is and is not
 *
 * It is the gate's own corpus walk (`git ls-files` over `$BB_CORPUS_ROOT`,
 * production `parseFile` from `pool-worker`), so the EMITTED column is measured
 * and not asserted. It is instrument A and instrument B run by the gate, so a
 * probe that finds a non-zero count prints FALSIFIED. It is not a substitute for
 * registering the table: until the two lines land in the shared file,
 * `ontology-coverage-gate.ts html` still exits 2.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = resolve((import.meta as any).dirname ?? ".", "..", "..", "..", "..")
const GATE = join(ROOT, "script", "m14", "ontology-coverage-gate.ts")
const TABLE = join(ROOT, "script", "m14", "html-ruled.ts")
const LANGS_FILE = join(ROOT, "script", "m14", "differential.ts")

if (!existsSync(GATE)) { console.error(`gate not found: ${GATE}`); process.exit(2) }
if (!existsSync(TABLE)) { console.error(`table not found: ${TABLE}`); process.exit(2) }

const work = mkdtempSync(join(tmpdir(), "html-ruled-gate-"))
// The gate resolves `../../src/ast/language-detection` and `./differential`
// relative to ITSELF, so the copy must live at the same depth inside the repo or
// those imports break. A temp dir under script/m14/ keeps the relative shape and
// leaves no tracked file behind.
const staged = join(ROOT, "script", "m14", `.html-ruled-gate-copy-${process.pid}.ts`)
const stagedTable = join(ROOT, "script", "m14", `.html-ruled-table-copy-${process.pid}.ts`)

let src = readFileSync(GATE, "utf8")

const IMPORT_ANCHOR = 'import { SQL_RULED } from "./sql-ruled"\n'
if (!src.includes(IMPORT_ANCHOR)) { console.error(`anchor not found: ${IMPORT_ANCHOR.trim()}`); process.exit(2) }
src = src.replace(IMPORT_ANCHOR, `${IMPORT_ANCHOR}import { HTML_RULED as HTML_RULED_STAGED } from "./${stagedTable.slice(ROOT.length + 1).split("/").pop()}"\n`)

const MAP_ANCHOR = 'const RULED_BY_LANG: Record<string, Ruled[]> = {'
if (!src.includes(MAP_ANCHOR)) { console.error(`map anchor not found`); process.exit(2) }
src = src.replace(MAP_ANCHOR, `${MAP_ANCHOR}\n  html: HTML_RULED_STAGED as unknown as Ruled[],`)

cpSync(TABLE, stagedTable)
writeFileSync(staged, src)

console.log("=== THE PATCH THE SUPERVISOR NEEDS (2 lines in script/m14/ontology-coverage-gate.ts) ===")
console.log(`  import { HTML_RULED } from "./html-ruled"`)
console.log(`  const RULED_BY_LANG: Record<string, Ruled[]> = { …, html: HTML_RULED }`)
console.log(`\nRunning a COPY with exactly those two lines applied. The shared file is not touched.\n`)

try {
  const r = spawnSync(process.execPath, [staged, "html", ...process.argv.slice(2)], {
    encoding: "utf8", maxBuffer: 1 << 28, timeout: 3600_000, cwd: ROOT,
  })
  const out = (r.stdout || "") + (r.stderr || "")
  process.stdout.write(out.split("\n").filter((l) => !l.includes("[INFO]")).join("\n"))
  // Programme rule 1 is NO REGEX, everywhere, and this runner had one — over the
  // arbiter's own stdout. The rationale for the rule is that a regex over text
  // matches things it should not and misses things it should, and that applies to
  // a log line as much as to source: `/RULED-|EMITTED|…/` is a silent way to
  // decide what counts as a verdict, and a verdict that is filtered by a pattern
  // is a verdict whose absence reads as "no verdict". A declared list of the
  // markers the gate prints, matched with `includes`, is checkable by reading.
  const VERDICT_MARKERS = ["EMITTED", "RULED-SOUND", "RULED-UNJUSTIFIED", "FALSIFIED", "Refusing", "no RULING"]
  const verdict = out.split("\n").filter((l) => VERDICT_MARKERS.some((m) => l.includes(m)))
  console.log(`\nexit=${r.status}`)
  console.log(`verdict lines:\n${verdict.join("\n")}`)
  // Silence is guilt: a run that prints no verdict line is a run that measured
  // nothing, and reporting 0 would read as a pass.
  if (verdict.length === 0) { console.error("\nNO VERDICT LINE PRINTED — this runner measured nothing."); process.exitCode = 1 }
} finally {
  rmSync(staged, { force: true })
  rmSync(stagedTable, { force: true })
  rmSync(work, { recursive: true, force: true })
}
