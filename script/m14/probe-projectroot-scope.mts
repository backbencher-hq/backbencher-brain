/**
 * DOES PRODUCTION ACTUALLY PASS `projectRoot`? — the control for the fix in `pool-worker.ts`.
 *
 * THE DEFECT (found by json-lane, `6fc778018`): `contextFor(filePath)` returned the analyze context
 * ONLY when a PROJECT INDEX existed for that extension. `projectIndex` is built from an index spec
 * (`INDEX_SPECS` carries `dart` alone), so for every other language production handed the analyzer
 * NO CONTEXT AT ALL — and with it, no `projectRoot`. The scope a document identity is derived from
 * needs no index; it needs the file's path.
 *
 * CONSEQUENCE, measured by that lane on both sides: the store held json qualified names UNSCOPED
 * (`11152[3].fileSize`, and 39 symbols across 39 files all named `functions` with qualified name
 * `functions`) while the gate and every census — which pass `projectRoot` explicitly — measured them
 * SCOPED (`data.json.11152[3].fileSize`). **The two instruments were measuring different key
 * spaces**, and every cross-file collision the document scope exists to prevent was present in
 * production and absent from the model.
 *
 * WHAT THIS PROBE DOES: runs the REAL production path (`indexProjectParallel`, the same entry the
 * store-binding probes use), reads `brain_symbol.qualified_name` back, and asks the only question
 * that matters — **is the document scope present?** A qualified name that contains the project-
 * relative directory of its own file is scoped; the bare key path is not.
 *
 * WHY IT IS DECISIVE RATHER THAN SUGGESTIVE: it passes NO context of its own. `contextFor` runs
 * inside the worker, so the only way a scope can appear is if the worker now supplies a root. A
 * probe that passed `{ projectRoot }` explicitly — as the layer probes do — would test the analyzer
 * and prove nothing about this fix.
 *
 * EXITS NON-ZERO when the store is empty, because binding numbers derived from nothing are worse
 * than no numbers (hcl-lane's rule, copied from its reference tool).
 *
 *   npx tsx script/m14/probe-projectroot-scope.mts
 */
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, existsSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO = process.env.BB_PROBE_REPO ?? "duckdb"
const SUBDIR = process.env.BB_PROBE_SUBDIR ?? "data/json"
const SRC = path.join(CR, REPO)

if (!existsSync(SRC)) {
  console.error(`corpus repo not found: ${SRC}`)
  process.exit(2)
}

// COPY, never write the corpus. A handful of files is enough: the question is whether a scope
// appears at all, and one file with a known qualified name answers it.
const root = mkdtempSync(path.join(tmpdir(), "bb-probe-root-"))
const projectRoot = path.join(root, "proj")
let copied = 0
try {
  const { readdirSync } = await import("node:fs")
  const dir = path.join(SRC, SUBDIR)
  if (!existsSync(dir)) { console.error(`subdir not found: ${dir}`); process.exit(2) }
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).slice(0, 6)) {
    const dst = path.join(projectRoot, SUBDIR, f)
    mkdirSync(path.dirname(dst), { recursive: true })
    copyFileSync(path.join(dir, f), dst)
    copied++
  }
  if (copied === 0) { console.error("no files copied — refusing to measure"); process.exit(2) }

  process.env.BB_DATA_DIR = path.join(root, ".bb-data")
  const { indexProjectParallel, discoverIndexableFiles } = await import(`${REPO_ROOT}/src/ast/parallel-indexer.ts`)
  const { BrainDatabase } = await import(`${REPO_ROOT}/src/brain/database.ts`)
  const { getProjectId } = await import(`${REPO_ROOT}/src/cli/index.ts`)

  const eligible = new Set(await discoverIndexableFiles(projectRoot))
  console.log(`probe — ${REPO}/${SUBDIR}: ${copied} copied, ${eligible.size} indexer-eligible`)

  const PID = getProjectId(projectRoot)
  await indexProjectParallel(PID as any, projectRoot, {})
  const raw = await BrainDatabase.getRawInstance(PID as any)
  const rows = raw.prepare(
    "SELECT name, qualified_name FROM brain_symbol WHERE project_id = ? ORDER BY qualified_name",
  ).all(PID) as Array<{ name: string; qualified_name: string | null }>
  if (rows.length === 0) {
    console.error(`BROKEN STORE: 0 symbols for ${PID} — refusing to report a scope verdict from an empty store.`)
    process.exit(2)
  }

  // THE TEST. `data/json/11152.json` is a minified document whose keys are the corpus's own
  // duplicate-key fixtures; json-lane measured these as `11152[3].fileSize` unscoped in the store
  // and `data.json.11152[3].fileSize` scoped through the gate. A sheet of dotted key paths is what
  // BOTH spellings look like, so the discriminator is whether the FILE'S OWN directory appears.
  const scoped = rows.filter((r) => String(r.qualified_name ?? "").includes(SUBDIR.replace("/", ".")))
  const bare = rows.filter((r) => {
    const q = String(r.qualified_name ?? "")
    return q.length > 0 && !q.includes(".")
  })
  console.log(`  symbols ${rows.length}`)
  console.log(`  qualified names carrying the file's own scope (${SUBDIR.replace("/", ".")}): ${scoped.length}`)
  console.log(`  qualified names with NO dot at all: ${bare.length}`)
  for (const r of rows.slice(0, 8)) console.log(`    ${r.name}  ->  ${r.qualified_name}`)

  const verdict = scoped.length > 0 ? "SCOPED — production now passes projectRoot" : "UNSCOPED — the defect is still present"
  console.log(`\nVERDICT: ${verdict}`)
  console.log(`  A scope can only appear here if the WORKER supplied a root: this probe passes no context.`)
  process.exit(scoped.length > 0 ? 0 : 1)
} finally {
  rmSync(root, { recursive: true, force: true })
}
