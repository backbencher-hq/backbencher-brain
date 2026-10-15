// script/m65/verify-refresh-resolution.ts — bb_graph review D2, as a gate.
//
// THE CLAIM THIS GATE PINS DOWN
// A routine incremental refresh — the production entry point `reindexFilesParallel`
// (`bb index --changed`, LSP didSave, MCP `bb_index mode=file`, and the inline
// auto-refresh a read tool performs when it notices stale files) — must leave the
// store in the SAME edge state as a full index of the same source. Not "close";
// the same. Because every graph read answers from the store: if a refresh leaves a
// re-stored file's cross-file call row with `target_symbol_id IS NULL`, then
// `bb_graph`, `bb_analyze`, `bb_impact` and `bb_visualize` answer
// `callers: 0 / truncated: false` about a symbol that has callers. That is a
// false statement, not a missing feature.
//
// MEASURED BEFORE THE FIX (this gate's predecessor,
// `script/m65/probe-refresh-resolution.ts`): a two-file TypeScript fixture whose
// second file calls a function declared in the first answered
//     fresh full index  : 1 bound `calls` row to the target
//     after a refresh   : 2 rows to the target, BOTH unresolved, 0 bound
// so the same question went 1 caller -> 0 callers with `truncated: false`.
// The cause was a missing decider, not a wrong one: the store's insert path
// decides only what a row's own file proves (J12) and defers cross-file names to
// the passes that read the COMPLETE tables; the full index runs those passes, and
// the bounded incremental pass ran none of them.
//
// THE FIX THIS GATE VERIFIES (src/ast/parallel-indexer.ts, phase 2b)
// The bounded pass now CALLS the shared deciders for the rows it re-stored,
// scoped to the files it touched: `resolveNameTargets(sourceFileIds)` (own-file
// qualified name -> own-file name -> project qualified name -> project unique
// name — the full pass's four arms, in its order) and
// `resolveImportTargets(onlySourceFileIds)` for the `<module>:<item>` import
// form. Reads are project-wide, so the decision is the full pass's; only the
// UPDATEs are bounded, which is what keeps a `--changed` run out of files it
// never touched.
//
// WHY THE PARITY ASSERTION AND NOT A COUNT
// A "resolved >= 1" check would pass for a pass that binds the WRONG symbol. The
// gate therefore compares the two worlds' whole edge state, keyed by identities
// that are stable across projects (relative file + symbol name + line), and
// names every differing row when they disagree. It is the same question
// `script/m14/verify-store-path-parity.ts` asks of one JavaScript draw, asked
// here of EIGHT languages — the analyzers are 48 lanes, so a seam fix that only
// holds for the one language it was written against is not a fix.
//
// LANGUAGES, AND WHAT "NOT EXERCISED" MEANS
// A fixture only tests the seam if its analyzer actually emits a cross-file
// `calls` row for the shape. Each language is therefore declared in one of two
// sets: `EXERCISED` (the gate FAILS if a fixture stops producing a resolved
// cross-file call — that is a regression in this gate's own reach) or
// `NOT_EXERCISED` (named with the reason, and reported, never silently skipped).
// Before the fix every EXERCISED language failed the parity assertion with the
// target row missing from the refreshed store.
//
// THE DETECTOR'S OWN TEST
// Parity is a predicate over rows. A mutation step detaches one bound target in
// the refreshed world and asserts the predicate REPORTS the difference before it
// is restored — so a green run cannot be green because the predicate is
// vacuous.

import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"
import { LANE_CORPUS_DIR, LANE_FIXTURES, type LangFixture } from "./lane-fixtures"

const EMPTY = mkdtempSync(path.join(tmpdir(), "m65-refresh-resolution-"))
process.env.BB_DATA_DIR = EMPTY
// Auto-refresh off for this gate: the gate drives the production incremental
// entry point itself and must not have a read path refresh underneath it.
process.env.BB_NO_AUTO_REFRESH = "1"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const EVIDENCE = path.join(ROOT, "validation/m65/results/refresh-resolution.json")

type Check = { name: string; passed: boolean; detail: string; negative?: boolean }
const checks: Check[] = []
const check = (name: string, passed: boolean, detail: string, negative = false) => {
  checks.push({ name, passed, detail, negative })
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}  ${detail}`)
}

/**
 * THE CORPUS — 48 lanes, one per analyzer — lives in `script/m65/lane-fixtures.ts`, and the lane
 * SET is read from the fleet (`src/ast/real-*-analyzer.ts`) rather than typed here. Two failure
 * modes are therefore impossible: a lane quietly dropped to make the gate green, and a 49th
 * analyzer arriving with no fixture and no declaration. Both directions are asserted below.
 */
const fixtures: LangFixture[] = LANE_FIXTURES

/** The corpus root, for the lane->directory check below. */
const CORPUS_FIXTURES = path.join(ROOT, "validation", "m14", "fixtures")

/** The fleet, as on disk. `FLEET-48.md` §1 established this as the scope: the 23-lane `LANES_B`
 *  set was a split of these 48 across two machines, and the split is gone. */
const FLEET_LANES: string[] = readdirSync(path.join(ROOT, "src/ast"))
  .filter((f) => f.startsWith("real-") && f.endsWith("-analyzer.ts"))
  .map((f) => f.slice("real-".length, -"-analyzer.ts".length))
  .sort()

/**
 * Lanes whose analyzer declares no symbol for this fixture shape, with the reason. Measured, not
 * assumed: the gate prints the symbol count it saw, so an entry here cannot outlive the measurement
 * that justified it.
 */
const NO_SYMBOL_LANES: Record<string, string> = {}

/**
 * Languages whose fixture must produce a BOUND cross-file `calls` row before the
 * edit — the review's D2 population, over which the caller-visibility assertion
 * runs. A language that stops being reached FAILS: that is this gate losing its
 * reach, and a green run over a shrunken set would be the dishonest kind.
 */
const EXERCISED_CALLS = new Set([
  "bash", "c", "clojure", "cpp", "csharp", "dart", "elixir", "erlang", "fsharp", "groovy", "java",
  "javascript", "julia", "kotlin", "lua", "nim", "objective-c", "perl", "php", "powershell", "python",
  "r", "ruby", "rust", "scala", "solidity", "sql", "swift", "typescript", "zig",
])

/**
 * Languages whose fixture must produce FILE-LEVEL rows for the edited file
 * (`exports`, file-level `uses`/`calls`) that are BOUND after the refresh. This is
 * the population the first version of this gate could not own at all: the store
 * writes `source_symbol_id = NULL` for those rows and no column said which file
 * they belonged to, so the refreshed store held them unresolved while a full
 * index bound every one. The set is MEASURED from the reference world (a full
 * index of the edited source) and enforced in both directions: declared here but
 * not measured fails, measured but not declared fails.
 */
const EXERCISED_FILE_LEVEL = new Set([
  "fsharp", "graphql", "java", "javascript", "lua", "r", "ruby", "rust", "scala", "typescript", "vb", "zig",
])

/** Languages whose analyzer emits nothing this gate can exercise for the shape;
 *  kept in the run so the gap is named instead of implied away. A language listed
 *  here that BECOMES exercised is reported too (the list is a measurement). */
const NO_CALL_ROWS: Record<string, string> = {
  // A LANE'S ONTOLOGY, NOT THIS GATE'S SEAM. Each of these stores a shape for the fixture and
  // binds its own edges, but stores NO `calls` row for a cross-file call: the analyzer models
  // the reference as `contains`/`uses`/`imports`/`instantiates`/`references` (or, for go, as an
  // attributed `exports` row), so there is no call row for the seam to bind. The gate asserts
  // the store's own census next to each entry, so the claim is checkable at a glance.
  clean: "the analyzer emits `contains`/`exports`/`imports`/`references` for this shape and no `calls` row (clean is a pure functional language: a cross-module reference is not a call row in this ontology)",
  css: "the analyzer emits an `imports` row for `@import` and no `calls` row",
  go: "the analyzer emits attributed `exports` rows but no `calls` row for a package-level call",
  graphql: "the analyzer emits `contains`/`exports`/`references` for a type reference and no `calls` row",
  haskell: "the analyzer emits `contains`/`imports` for the module reference and no `calls` row",
  hcl: "the analyzer emits `contains`/`exports`/`references` for a resource reference and no `calls` row",
  html: "the analyzer emits `contains`/`uses` for an embedded document and no `calls` row",
  json: "the analyzer emits `contains`/`imports`/`references` for a `$ref` and no `calls` row",
  makefile: "the analyzer emits `contains`/`imports` for an `include` and no `calls` row",
  markdown: "the analyzer emits `uses` for a link and no `calls` row",
  protobuf: "the analyzer emits `contains`/`imports`/`uses` for a message reference and no `calls` row",
  scss: "the analyzer emits `references` for `@use` and no `calls` row",
  svelte: "the analyzer emits `instantiates`/`uses`/`imports` for a component reference and no `calls` row",
  toml: "the analyzer emits `contains` for table membership and no `calls` row",
  vb: "the analyzer emits `contains`/`exports`/`references`/`uses` for this shape and no `calls` row",
  vue: "the analyzer emits `instantiates`/`uses`/`imports` for a component reference and no `calls` row",
  xml: "the analyzer emits `contains` for element nesting and no `calls` row",
  yaml: "the analyzer emits `contains` for key nesting and no `calls` row",
}

type Row = {
  type: string
  source: string
  target: string
  crossFile: number
  line: number | null
}

/** Every stored relationship as a project-independent identity: a bound side is
 *  named by (relative file, symbol name, line) — the project id prefix is dropped
 *  so the same source indexed twice compares equal — and an unbound side by its
 *  external spelling. */
function edgeState(db: any, projectId: string): Row[] {
  return (db
    .prepare(
      `SELECT r.relationship_type AS type,
              r.is_cross_file AS crossFile,
              r.line_number AS line,
              COALESCE(sf.relative_path || ':' || ss.name || ':' || ss.line_start, r.source_external, '') AS source,
              COALESCE(tf.relative_path || ':' || ts.name || ':' || ts.line_start, r.target_external, '') AS target
         FROM brain_relationship r
         LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
         LEFT JOIN brain_file sf ON sf.id = ss.file_id
         LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
         LEFT JOIN brain_file tf ON tf.id = ts.file_id
        WHERE r.project_id = ?`,
    )
    .all(projectId) as any[]).map((r) => ({
    type: String(r.type),
    source: String(r.source ?? ""),
    target: String(r.target ?? ""),
    crossFile: Number(r.crossFile ?? 0),
    line: r.line === null || r.line === undefined ? null : Number(r.line),
  }))
}

function edgeKey(r: Row): string {
  return `${r.type}|${r.source}|${r.target}|${r.crossFile}|${r.line ?? "null"}`
}

function multisetDiff(a: Row[], b: Row[]): { onlyA: string[]; onlyB: string[] } {
  const count = (rows: Row[]) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(edgeKey(r), (m.get(edgeKey(r)) ?? 0) + 1)
    return m
  }
  const ca = count(a)
  const cb = count(b)
  const onlyA: string[] = []
  const onlyB: string[] = []
  for (const [k, n] of ca) {
    const d = n - (cb.get(k) ?? 0)
    for (let i = 0; i < d; i++) onlyA.push(k)
  }
  for (const [k, n] of cb) {
    const d = n - (ca.get(k) ?? 0)
    for (let i = 0; i < d; i++) onlyB.push(k)
  }
  return { onlyA, onlyB }
}

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel, reindexFilesParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))

  const quiet = { log: () => {}, write: () => {} } as any
  const reached: string[] = []
  const unreached: string[] = []
  const fileLevelReached: string[] = []
  /** One measurement record per lane: what was indexed, what the store held, what parity said. */
  const laneReports: Array<Record<string, unknown>> = []

  // `--only=a,b` runs a subset while the corpus is being written. A subset run writes its own
  // evidence file and declares itself partial in the record, so a filtered green can never be
  // mistaken for the whole-fleet verdict.
  const onlyArg = process.argv.find((a) => a.startsWith("--only="))
  const only = onlyArg === undefined ? "" : onlyArg.slice("--only=".length)
  const selected =
    only === "" ? fixtures : fixtures.filter((f) => only.split(",").includes(f.language))
  const PARTIAL = only !== ""
  if (PARTIAL) {
    console.log(`--only=${only}: ${selected.length} of ${fixtures.length} lanes; the declared-set checks do NOT run in a partial run`)
  }

  for (const fx of selected) {
    console.log(`\n── ${fx.language} ──`)
    const dirA = path.join(EMPTY, fx.language, "incremental")
    const dirB = path.join(EMPTY, fx.language, "full")
    for (const dir of [dirA, dirB]) {
      for (const [rel, content] of Object.entries(fx.files)) {
        const abs = path.join(dir, rel)
        mkdirSync(path.dirname(abs), { recursive: true })
        writeFileSync(abs, content)
      }
    }
    // World B is the same source with the edit ALREADY in it: the full pass
    // indexed it once, which is the state the incremental world must match.
    const editedAbsB = path.join(dirB, fx.editedPath)
    mkdirSync(path.dirname(editedAbsB), { recursive: true })
    writeFileSync(editedAbsB, fx.editedContent)

    const pidA = getProjectId(dirA) as any
    const pidB = getProjectId(dirB) as any
    const consoleLog = console.log
    console.log = () => {}
    try {
      await indexProjectParallel(pidA, dirA, { logger: quiet })
      await indexProjectParallel(pidB, dirB, { logger: quiet })
    } finally {
      console.log = consoleLog
    }

    const raw = await BrainDatabase.getRawInstance(pidA)
    const rawB = await BrainDatabase.getRawInstance(pidB)

    // ── baseline: is this language exercised at all? ────────────────────────
    // The row lookups use the STORE's spelling of the declaration (`targetSymbolName` when a
    // lane declares one — Objective-C's selector), the traversal uses the door's
    // (`targetName`). A lane that changes either fails `fixture-declares-the-target`.
    const symbolName = fx.targetSymbolName ?? fx.targetName
    const targetA = raw
      .prepare(`SELECT id FROM brain_symbol WHERE project_id = ? AND name = ? LIMIT 1`)
      .get(pidA, symbolName) as any
    const boundBefore = targetA
      ? ((raw
          .prepare(
            `SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND relationship_type = 'calls' AND target_symbol_id = ?`,
          )
          .get(pidA, targetA.id) as any).c as number)
      : 0
    // A lane whose ontology has no callable declaration (`targetName === ""`) has no
    // symbol to ask about: the traversal would throw on the empty name, which is the
    // door's declared error rather than a finding about the store.
    const callersBefore =
      fx.targetName === ""
        ? null
        : (await graphTraversal(pidA, fx.targetName, { direction: "callers", maxDepth: 2 })).callers.length

    // ── fixture fidelity: did the analyzer even SEE this shape? ──────────────
    const symbolsA = (raw
      .prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?`)
      .get(pidA) as any).c as number
    const rowTypesA = (raw
      .prepare(
        `SELECT relationship_type AS t, COUNT(*) c FROM brain_relationship WHERE project_id = ? GROUP BY relationship_type ORDER BY t`,
      )
      .all(pidA) as any[]).map((r) => `${r.t}=${r.c}`)
    // A fixture that the analyzer reads as empty proves nothing, and a missing declaration would
    // make a MISSING CALL look like an ontology gap when it is really a broken fixture. Both are
    // called out as themselves, before the call row is judged.
    check(
      `fixture-is-not-empty: ${fx.language}`,
      symbolsA >= 1 || NO_SYMBOL_LANES[fx.language] !== undefined,
      symbolsA >= 1
        ? `${symbolsA} symbol(s) indexed from ${Object.keys(fx.files).length} file(s); rows: ${rowTypesA.join(" ") || "(none)"}`
        : NO_SYMBOL_LANES[fx.language] !== undefined
          ? `no symbol — declared: ${NO_SYMBOL_LANES[fx.language]}`
          : `the analyzer stored NO symbol for this fixture (rows: ${rowTypesA.join(" ") || "(none)"}) — the fixture does not exercise this lane, so any "no call row" reading below is the fixture's, not the lane's`,
    )
    if (fx.targetName !== "") {
      check(
        `fixture-declares-the-target: ${fx.language}`,
        !!targetA,
        !!targetA
          ? `symbol ${fx.targetName} indexed`
          : `the fixture's declaration ${fx.targetName} is not a symbol in the store — the caller assertion below cannot run, and a missing call row here is a FIXTURE defect, not a lane gap`,
      )
    }

    if (boundBefore === 0) {
      unreached.push(fx.language)
    } else {
      reached.push(fx.language)
    }

    // ── the routine edit, then the production incremental entry point ───────
    const editedAbsA = path.join(dirA, fx.editedPath)
    writeFileSync(editedAbsA, fx.editedContent)
    const rt = await reindexFilesParallel(pidA, dirA, [{ path: editedAbsA, type: "modified" }], { logger: quiet })
    check(
      `refresh-ran: ${fx.language}`,
      rt.indexed === 1 && rt.errors === 0 && (rt as any).derived?.pass === "bounded",
      `indexed=${rt.indexed} errors=${rt.errors} derived=${JSON.stringify((rt as any).derived ?? null)}`,
    )

    // ── parity: the refreshed store vs a full index of the same source ──────
    const stateA = edgeState(raw, pidA)
    const stateB = edgeState(rawB, pidB)
    const diff = multisetDiff(stateA, stateB)
    const describe = (rows: string[]) => rows.slice(0, 4).map((k) => k).join(" ; ")
    check(
      `refresh-parity: ${fx.language}`,
      diff.onlyA.length === 0 && diff.onlyB.length === 0,
      diff.onlyA.length + diff.onlyB.length === 0
        ? `${stateA.length} edge(s) identical to a full index of the same source`
        : `refreshed-only ${diff.onlyA.length}: [${describe(diff.onlyA)}] · full-only ${diff.onlyB.length}: [${describe(diff.onlyB)}]`,
    )

    const undeclared = (raw
      .prepare(
        `SELECT COUNT(*) c FROM brain_relationship
          WHERE project_id = ? AND target_symbol_id IS NULL AND target_external IS NOT NULL
            AND target_external IN (SELECT name FROM brain_symbol WHERE project_id = ?)`,
      )
      .get(pidA, pidA) as any).c as number
    check(
      `no-decidable-row-left-unresolved: ${fx.language}`,
      undeclared === 0,
      `${undeclared} row(s) name a symbol this project holds yet carry no target`,
    )

    // ── the unattributed population: measured from the REFERENCE world ──────
    // A language exercises this population only if a full index stores an
    // unattributed row (`source_symbol_id IS NULL`, no source symbol to attribute
    // the row to) targeting a symbol declared in the edited file. The reference
    // world's count is the truth the refreshed world must match, so the check is a
    // comparison rather than a guess about which analyzers emit what.
    const unattributedQuery = `SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol t ON t.id = r.target_symbol_id
           JOIN brain_file f ON f.id = t.file_id
          WHERE r.project_id = ? AND r.source_symbol_id IS NULL AND f.relative_path = ?`
    const fileLevelInB = (rawB.prepare(unattributedQuery).get(pidB, fx.editedPath) as any).c as number
    const fileLevelBound = (raw.prepare(unattributedQuery).get(pidA, fx.editedPath) as any).c as number
    if (fileLevelInB > 0) {
      fileLevelReached.push(fx.language)
      check(
        `unattributed-rows-bound: ${fx.language}`,
        fileLevelBound === fileLevelInB,
        `${fileLevelBound} unattributed row(s) targeting the edited file carry a target after the refresh; a full index holds ${fileLevelInB}`, 
      )
    } else {
      check(
        `unattributed-population-not-exercised: ${fx.language}`,
        !EXERCISED_FILE_LEVEL.has(fx.language),
        `a full index stores no unattributed row targeting the edited file, so this population is not exercised here`,
        true,
      )
    }

    if (boundBefore > 0) {
      // ── the tool's own answer: both call sites, not one ───────────────────
      const boundAfter = (raw
        .prepare(
          `SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND relationship_type = 'calls' AND target_symbol_id = ?`,
        )
        .get(pidA, targetA!.id) as any).c as number
      const graph = await graphTraversal(pidA, fx.targetName, { direction: "callers", maxDepth: 2 })
      check(
        `graph-shows-both-call-sites: ${fx.language}`,
        boundAfter === boundBefore + 1 && graph.callers.length >= callersBefore + 1,
        `bound rows ${boundBefore} -> ${boundAfter}, bb_graph callers ${callersBefore} -> ${graph.callers.length} (expected one more stored row; the traversal may also gain the new caller's own edges)`,
      )

      // ── the detector's own test: a detached target must be REPORTED ───────
      if (fx.language === "typescript") {
        raw.run(`UPDATE brain_relationship SET target_symbol_id = NULL WHERE id IN (
                   SELECT id FROM brain_relationship WHERE project_id = ? AND relationship_type = 'calls' AND target_symbol_id = ? LIMIT 1
                 )`, [pidA, targetA!.id])
        const mutated = multisetDiff(edgeState(raw, pidA), stateB)
        check(
          `mutation-detected: ${fx.language}`,
          mutated.onlyA.length + mutated.onlyB.length > 0,
          `with one target detached the parity predicate reports ${mutated.onlyA.length + mutated.onlyB.length} differing row(s) — it is not vacuous`,
          true,
        )
        // restore, so the evidence record describes the fixed state
        raw.run(`UPDATE brain_relationship SET target_symbol_id = ? WHERE project_id = ? AND relationship_type = 'calls' AND target_symbol_id IS NULL AND target_external = ?`, [targetA!.id, pidA, fx.targetName])
      }
    } else {
      check(
        `no-call-rows-is-declared: ${fx.language}`,
        !!NO_CALL_ROWS[fx.language],
        NO_CALL_ROWS[fx.language]
          ? `no bound cross-file \`calls\` row for this shape — declared: ${NO_CALL_ROWS[fx.language]} · measured census: ${rowTypesA.join(" ") || "(no rows at all)"}`
          : `no bound cross-file \`calls\` row for this shape and no declaration — an undeclared blind spot · measured census: ${rowTypesA.join(" ") || "(no rows at all)"}`,
        true,
      )
    }

    laneReports.push({
      lane: fx.language,
      symbols: symbolsA,
      targetName: fx.targetName,
      targetSymbolName: symbolName,
      targetIsSymbol: fx.targetName === "" ? null : !!targetA,
      boundCallRowsBefore: boundBefore,
      callersBefore,
      rowTypes: rowTypesA,
      boundCallRowsAfter: !targetA ? null : ((raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND relationship_type = 'calls' AND target_symbol_id = ?`).get(pidA, targetA.id) as any).c as number),
      parity: diff.onlyA.length + diff.onlyB.length === 0,
      undeclaredDecidableRows: undeclared,
      unattributedRowsOnEditedFile: fileLevelBound,
      classified: boundBefore > 0 ? "cross-file call bound" : "no bound cross-file call for this shape",
    })
  }

  // ── the lane set: the fleet, exactly ─────────────────────────────────────
  // Both directions. A lane of the fleet with no fixture would mean the fleet's cross-file seam is
  // verified on 47 of 48 lanes and reported as 48; a fixture for a lane that no longer exists would
  // mean this file kept asserting a shape nothing parses. Neither can pass silently.
  const fixtureLanes = fixtures.map((f) => f.language)
  for (const lane of FLEET_LANES) {
    check(
      `fleet-lane-has-a-fixture: ${lane}`,
      fixtureLanes.includes(lane),
      fixtureLanes.includes(lane)
        ? `declared`
        : `no fixture for this analyzer — the gate would be green over ${fixtures.length} of ${FLEET_LANES.length} lanes`,
    )
  }
  for (const lane of fixtureLanes) {
    check(
      `fixture-lane-is-in-the-fleet: ${lane}`,
      FLEET_LANES.includes(lane),
      FLEET_LANES.includes(lane)
        ? `declared`
        : `this fixture names a lane with no analyzer file (src/ast/real-${lane}-analyzer.ts) — a stale fixture asserting a shape nothing parses`,
      !FLEET_LANES.includes(lane),
    )
  }
  check(
    "lane-set-is-exactly-the-fleet",
    FLEET_LANES.length === fixtureLanes.length && FLEET_LANES.every((l) => fixtureLanes.includes(l)),
    `${FLEET_LANES.length} analyzer(s) on disk, ${fixtureLanes.length} fixture lane(s) — FLEET-48.md §1's scope, read from src/ast/real-*-analyzer.ts`,
  )
  for (const [lane, dir] of Object.entries(LANE_CORPUS_DIR)) {
    check(
      `lane-corpus-dir-exists: ${lane}`,
      existsSync(path.join(CORPUS_FIXTURES, dir)),
      `validation/m14/fixtures/${dir}`,
    )
  }

  // ── the declared sets, enforced in both directions ───────────────────────
  if (PARTIAL) {
    console.log("\npartial run (--only): the declared-set checks and the lane-set checks above are the whole-fleet ones.")
  }
  for (const lang of PARTIAL ? [] : reached) {
    check(
      `calls-set-is-current: ${lang}`,
      EXERCISED_CALLS.has(lang),
      EXERCISED_CALLS.has(lang)
        ? `declared`
        : `this lane binds a cross-file call and is not in EXERCISED_CALLS — declare it so its callers are asserted`,
      !EXERCISED_CALLS.has(lang),
    )
  }
  for (const lang of PARTIAL ? [] : EXERCISED_CALLS) {
    check(
      `exercised-calls-set-is-honest: ${lang}`,
      reached.includes(lang),
      reached.includes(lang)
        ? `reached`
        : `declared EXERCISED_CALLS but the fixture produced no bound cross-file call — this gate lost its reach`,
    )
  }
  for (const lang of PARTIAL ? [] : Object.keys(NO_CALL_ROWS)) {
    check(
      `no-call-rows-set-is-current: ${lang}`,
      unreached.includes(lang),
      unreached.includes(lang)
        ? `still emits no bound cross-file call (declared: ${NO_CALL_ROWS[lang]})`
        : `now emits a bound cross-file call — move it to EXERCISED_CALLS so its callers are asserted`,
      true,
    )
  }
  for (const lang of PARTIAL ? [] : EXERCISED_FILE_LEVEL) {
    check(
      `exercised-file-level-set-is-honest: ${lang}`,
      fileLevelReached.includes(lang),
      fileLevelReached.includes(lang)
        ? `reached (a full index stores unattributed rows targeting its edited file)`
        : `declared EXERCISED_FILE_LEVEL but a full index stores no unattributed row targeting its edited file`, 
    )
  }
  for (const lang of PARTIAL ? [] : fileLevelReached) {
    check(
      `file-level-set-is-current: ${lang}`,
      EXERCISED_FILE_LEVEL.has(lang),
      EXERCISED_FILE_LEVEL.has(lang)
        ? `declared`
        : `exercises the unattributed population but is not in EXERCISED_FILE_LEVEL — declare it`,
      !EXERCISED_FILE_LEVEL.has(lang),
    )
  }

  const failed = checks.filter((c) => !c.passed)
  const negatives = checks.filter((c) => c.negative).length
  const evidencePath = PARTIAL ? EVIDENCE.replace(/\.json$/, ".partial.json") : EVIDENCE
  mkdirSync(path.dirname(evidencePath), { recursive: true })
  const { writeSealed } = await import(path.join(ROOT, "script/lib/evidence.ts"))
  writeSealed(evidencePath, {
    partial: PARTIAL,
    fleetLanes: FLEET_LANES,
    lanesRun: selected.map((f) => f.language),
    laneReports,
    gate: "M65.refresh-resolution",
    at: new Date().toISOString(),
    atCommit: execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim(),
    command: "bun run script/m65/verify-refresh-resolution.ts",
    status: failed.length === 0 ? "pass" : "fail",
    checks,
    negativeCases: negatives,
    languagesReached: reached.sort(),
    languagesWithNoCallRows: unreached.sort(),
    languagesExercisingUnattributedRows: fileLevelReached.sort(),
    contract:
      "a production incremental refresh (reindexFilesParallel / auto-refresh) leaves every stored edge as a full index of the same source would: the re-stored file's cross-file targets are resolved by the shared deciders, scoped to the files this run owns",
    note: `store: ${EMPTY}`,
    before:
      "measured before the fix: a two-file TypeScript fixture's cross-file call read 1 bound row -> 2 unresolved rows after the refresh, and bb_graph answered 1 caller -> 0 callers with truncated: false",
  })
  console.log(`\nevidence: ${evidencePath}`)
  console.log(`languages with bound cross-file call rows: ${reached.join(", ") || "(none)"}`)
  console.log(`languages with no bound cross-file call for this shape: ${unreached.join(", ") || "(none)"}`)
  console.log(`\nper-lane measurements (${laneReports.length}):`)
  for (const r of laneReports) {
    console.log(
      `  ${String(r.lane).padEnd(14)} symbols=${String(r.symbols).padEnd(4)} target=${r.targetIsSymbol === null ? "n/a" : r.targetIsSymbol ? "yes" : "NO"} boundCalls=${String(r.boundCallRowsBefore).padEnd(3)} -> ${String(r.boundCallRowsAfter).padEnd(4)} parity=${r.parity ? "yes" : "NO"} rows[${(r.rowTypes as string[]).join(" ") || "-"}]`,
    )
  }
  if (failed.length > 0) {
    console.log(`\n${failed.length} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log("\nAll checks passed — a refresh now stores the same edges as a full index, in every exercised language.")
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
