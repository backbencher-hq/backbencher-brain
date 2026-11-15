/**
 * MARKDOWN STORE ROUND-TRIP — what the PRODUCTION store binds, measured on the store.
 *
 * ## Why this file exists
 *
 * Every other instrument in this lane reads the ANALYZER's output. `ambiguity-split.ts`
 * resolves a target by NAME, the way `incoming-check.ts` does, and both are right about
 * what they say. Neither one asks the question that decides whether an edge is usable:
 *
 *   the store resolves an endpoint with `extractLeaf` BEFORE it matches a name
 *   (src/ast/parallel-indexer.ts:3377-3391, called :3393, used :3498-3501), and every
 *   reverse-walking surface joins on `r.target_symbol_id`
 *   (src/lsp/impact.ts:529-539, src/lsp/relations.ts:130-134, src/lsp/navigation.ts:440-453).
 *
 * So a target the store REWRITES is a target the store cannot find by the string the
 * analyzer published, and the edge is bound to nothing — invisible to `bb_graph`,
 * `bb_impact` and `bb_migrate` while still counting as an edge everywhere else.
 *
 * This analyzer publishes a DOTTED name for every fenced code block with a language —
 * `code_block.fsharp` (src/ast/real-markdown-analyzer.ts:445) — and `extractLeaf` splits
 * on `.` and takes the LAST segment, so the store searches `fsharp`. That is a claim, and
 * a simulation of it is still a simulation. This file puts the files through
 * `storeResults` and asks the resulting database.
 *
 * ## What it is and is not
 *
 *   IS    the store, over N real corpus markdown files, read back with SQL.
 *   IS NOT a statement about the whole corpus: it indexes one project's files into one
 *         temp project root, so project-wide name uniqueness (`_res_name.cnt`) is
 *         computed over those N files only. A name that is unique here can be published
 *         50 times elsewhere, and the store's "unique name" stage would then not fire.
 *         Counts are therefore an UPPER bound on resolution, and every column says which
 *         population it is over.
 *
 * ## DISCLOSED DEFECT IN THE STORE, AND THE IN-MEMORY REPAIR THIS PROBE MAKES
 *
 * `src/ast/parallel-indexer.ts:2164-2165` carries TWO `VALUES` clauses in one prepared
 * statement — 31 placeholders, then 30 — so `storeResults` throws
 *
 *   SqliteError: near "VALUES": syntax error
 *     at storeResults (src/ast/parallel-indexer.ts:2153)
 *
 * on the first symbol, for every language. `storeResults` is the only
 * `INSERT INTO brain_symbol` in `src/` (:2154) and it is what :1126, :1144 and :1262
 * call. `git blame` puts the 30-placeholder line in `39a29b845` (2026-09-30) and the
 * 31-placeholder line in `687999ba5` (2026-10-02, "merge: reconcile the local line with
 * the consolidated origin/main") — a merge that kept the superseded clause instead of
 * dropping it, which is exactly the seam the comment above it warns about ("VALUES must
 * carry 31 placeholders -- 30 would silently bind every value after source_text to the
 * wrong column"). It is on `origin/main` and on `origin/analyzers/ontology-laptop-b`.
 *
 * That file is shared machinery (workstream §8), so this probe does NOT edit it. It
 * removes the duplicate clause IN MEMORY, in this process only, for statements matching
 * `INSERT OR REPLACE INTO brain_symbol`, and it says so in the output and in the JSON.
 * Without the repair the store cannot store one symbol and no store measurement of any
 * kind is possible, so the alternative is to report nothing. The repair is the exact
 * inverse of the defect — delete one line — and the restored statement is the one the
 * file's own comment specifies.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/markdown/store-roundtrip.ts [--files N] [--json out.json]
 *
 * Exit code is always 0: this is a MEASUREMENT, and a measurement that fails a gate
 * because the number moved is a gate that hides the number. `facts` is the set of
 * invariants that must hold for the numbers to mean anything (the store really was
 * asked, and the analyzer's edges really are the ones stored).
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"
import { BrainDatabase } from "../../../../src/brain/database"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { storeResults } from "../../../../src/ast/parallel-indexer"

const ANALYZER = path.resolve(
  (import.meta as any).dirname ?? ".",
  "../../../../src/ast/real-markdown-analyzer.ts",
)
const HASH = createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string, d: number): number => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d
}
const N = Math.max(1, flag("files", 120))
const OUT = (() => {
  const i = argv.indexOf("--json")
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null
})()

/**
 * VERBATIM copy of the store's leaf function (src/ast/parallel-indexer.ts:3377-3391).
 * A re-implementation would not be the rule the store applies, so this is copied
 * rather than rewritten — the 0-regex property is pinned on the ANALYZER, not here.
 */
const extractLeaf = (name: string): string => {
  const noLine = name.replace(/:\d+$/, "")
  const noArity = noLine.replace(/\/\d+$/, "")
  const lastColon = noArity.split(":").pop() as string
  return lastColon.split(".").pop() as string
}

// ───────────────────────────────────────────── the file set
const files: { abs: string; repo: string; rel: string }[] = []
for (const e of execFileSync("ls", ["-1", CR], { encoding: "utf8" }).split("\n").sort()) {
  if (!e) continue
  const dir = path.join(CR, e)
  let tracked: string[]
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
      if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "markdown") continue
    } catch {
      continue
    }
    files.push({ abs, repo: e, rel })
  }
}
files.sort((a, b) => (a.repo === b.repo ? (a.rel < b.rel ? -1 : 1) : a.repo < b.repo ? -1 : 1))
const population = files.length
const sample = files.slice(0, N)
const sampleSha = createHash("sha256")
  .update(sample.map((f) => `${f.repo}/${f.rel}`).join("\n"))
  .digest("hex")

// ───────────────────────────────────────────── in-memory store repair, disclosed
//
// Delete a `VALUES (...)` clause that immediately follows another one. That is the
// whole of it: one line, in this process, and only for the brain_symbol INSERT.
let repairedStatements = 0
const dropDuplicateValues = (sql: string): string =>
  sql.replace(/(\n[ \t]*VALUES[ \t]*\([^)]*\))(\n[ \t]*VALUES[ \t]*\([^)]*\))/g, (_m, a, b) => {
    repairedStatements++
    void b
    return a
  })
const SYMBOL_INSERT = /INSERT OR REPLACE INTO brain_symbol/i
{
  const raw = (BrainDatabase as any).getRawInstance.bind(BrainDatabase)
  ;(BrainDatabase as any).getRawInstance = async (id: any) => {
    const db: any = await raw(id)
    if (!db.__markdownStoreProbePatched) {
      db.__markdownStoreProbePatched = true
      for (const m of ["prepare", "run"] as const) {
        const orig = db[m].bind(db)
        db[m] = (sql: any, ...rest: any[]) =>
          orig(typeof sql === "string" && SYMBOL_INSERT.test(sql) ? dropDuplicateValues(sql) : sql, ...rest)
      }
    }
    return db
  }
}

// ───────────────────────────────────────────── parse, then store
const projectRoot = mkdtempSync(path.join(tmpdir(), "md-rt-"))
const projectId = `markdown-store-roundtrip-${process.pid}` as any
const results: any[] = []
let parseFailures = 0
const analyzerEdges = new Map<string, number>()
let degraded = 0

for (const f of sample) {
  let r: any
  try {
    r = await ASTEngine.parseFile(f.abs, readFileSync(f.abs, "utf8"))
  } catch {
    parseFailures++
    continue
  }
  if (!r) {
    parseFailures++
    continue
  }
  if (r.fallback === true) degraded++
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const t = String(rel?.type ?? rel?.relationshipType ?? "")
    analyzerEdges.set(t, (analyzerEdges.get(t) ?? 0) + 1)
  }
  const st = statSync(f.abs)
  results.push({
    filePath: f.abs,
    success: true,
    symbols: r.symbols ?? [],
    relationships: r.relationships ?? [],
    imports: r.imports ?? [],
    language: "markdown",
    fileHash: createHash("sha256").update(readFileSync(f.abs)).digest("hex").slice(0, 32),
    sizeBytes: st.size,
    lastModified: st.mtimeMs,
  })
}
const analyzerSymbols = results.reduce((n, r) => n + r.symbols.length, 0)

/**
 * The store DROPS edges. Two `continue`s / rewrites sit between the analyzer's output
 * and the insert, and neither is visible from the analyzer's side:
 *
 *   1. a hard filter that discards the row entirely —
 *      src/ast/parallel-indexer.ts:3639-3645: if the source's LEAF is longer than 255
 *      chars, or is one of {"unknown","SCSS_FILE_SCOPE","window","exports","default",
 *      "GlobalScope"}, or matches /^[\w]+\.block_\d+|^block_\d+/, the edge is dropped
 *      with no row and no error.
 *   2. source-id REWRITING — :3628-3636 replaces an unstoreable same-file source with
 *      the innermost enclosing span's id (`enclosingStoreableId(relLine)`, :2639-2649),
 *      and :3531-3541 rewrites this/self/me to the enclosing class. Two analyzer edges
 *      whose sources differ can therefore land on ONE id, and since
 *      `brain_relationship.id` is `TEXT PRIMARY KEY` under `INSERT OR IGNORE`
 *      (:2174-2178) the second is dropped with no error.
 *
 * Both filters are copied here VERBATIM so the buckets are the store's rules and not a
 * paraphrase of them. `unexplained` must be 0: if it is not, this account is incomplete
 * and says so rather than rounding the remainder into a neighbouring bucket.
 */
const STORE_SOURCE_FILTER = {
  maxSymbolNameLength: 255,
  genericSourceNames: new Set(["unknown", "SCSS_FILE_SCOPE", "window", "exports", "default", "GlobalScope"]),
  blockScope: (leaf: string): boolean => /^[\w]+\.block_\d+/.test(leaf) || /^block_\d+/.test(leaf),
  source: "src/ast/parallel-indexer.ts:3518-3527 (constants) and :3639-3645 (the `continue`)",
}
const emittedEdges = (() => {
  const emitted: { type: string; source: string; target: string; line: number; file: string }[] = []
  for (const r of results) {
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      emitted.push({
        type: String(rel?.type ?? rel?.relationshipType ?? ""),
        source: String(rel?.source ?? ""),
        target: String(rel?.targetExternal ?? rel?.targetId ?? rel?.target ?? ""),
        line: typeof rel?.line_number === "number" ? rel.line_number : -1,
        file: String(r.filePath ?? ""),
      })
    }
  }
  return emitted
})()

await storeResults(projectId, projectRoot, results)
const db: any = await BrainDatabase.getRawInstance(projectId)

// ───────────────────────────────────────────── ask the store
const rows = db
  .prepare(
    `SELECT r.relationship_type AS type, r.source_external AS source, r.target_external AS target,
            r.source_symbol_id AS sid, r.target_symbol_id AS tid, r.line_number AS line,
            COALESCE(sf.path, tf.path) AS file
       FROM brain_relationship r
       LEFT JOIN brain_symbol s  ON s.id = r.source_symbol_id
       LEFT JOIN brain_file  sf ON sf.id = s.file_id
       LEFT JOIN brain_symbol t  ON t.id = r.target_symbol_id
       LEFT JOIN brain_file  tf ON tf.id = t.file_id`,
  )
  .all() as any[]

type Row = {
  type: string
  source: string
  target: string
  sid: string | null
  tid: string | null
  line: number
  file: string | null
}
const all: Row[] = rows.map((r) => ({
  type: String(r.type ?? ""),
  source: String(r.source ?? ""),
  target: String(r.target ?? ""),
  sid: r.sid ?? null,
  tid: r.tid ?? null,
  line: Number(r.line ?? 0),
  file: r.file == null ? null : String(r.file),
}))

const symName = new Map<string, string>()
for (const s of db.prepare(`SELECT id, name FROM brain_symbol`).all() as any[])
  symName.set(String(s.id), String(s.name ?? ""))

/**
 * The emitted edges the store did not discard by its own hard filter. Assigned by
 * `edgeLoss` below — it owns the predicate — and read by the exact reconciliation
 * further down, which needs the same population.
 */
let survivingEdges: typeof emittedEdges = []

/**
 * WHY THE STORE CAN HOLD FEWER EDGES THAN THE ANALYZER EMITS.
 *
 * The store DROPS edges. Two mechanisms sit between the analyzer's output and the insert,
 * and neither is visible from the analyzer's side:
 *
 *   1. a hard filter that discards the row entirely —
 *      src/ast/parallel-indexer.ts:3639-3645: if the source's LEAF is longer than 255
 *      chars, or is one of {"unknown","SCSS_FILE_SCOPE","window","exports","default",
 *      "GlobalScope"}, or matches /^[\w]+\.block_\d+|^block_\d+/, the edge is dropped
 *      with no row and no error.
 *   2. source-id REWRITING — :3628-3636 replaces an unstoreable same-file source with the
 *      innermost enclosing span's id (`enclosingStoreableId(relLine)`, :2639-2649), and
 *      :3531-3541 rewrites this/self/me to the enclosing class. Two analyzer edges whose
 *      sources differ can therefore land on ONE id, and since `brain_relationship.id` is
 *      `TEXT PRIMARY KEY` under `INSERT OR IGNORE` (:2174-2178) the second is dropped
 *      with no error.
 *
 * Mechanism 1's conditions are copied here VERBATIM so the buckets are the store's rules
 * and not a paraphrase of them. Mechanism 2 is NOT simulated — replicating the resolution
 * chain would make this a claim about my own reading of it. It is detected instead from
 * the store's own rows: an emitted edge whose (type, target, line) DOES appear on some
 * stored row was not filtered, so it can only have lost its row to a duplicate primary
 * key. Whatever neither bucket explains is reported as `unexplained`, which is a FAIL,
 * rather than rounded into a neighbouring bucket.
 */
const edgeLoss = (() => {
  const emitted = emittedEdges

  // (1) The store's OWN hard filter, verbatim from src/ast/parallel-indexer.ts:3518-3527
  // and applied at :3639-3645. A row the store never considered cannot be a PK loss.
  const hardFiltered = emitted.filter((e) => {
    const leaf = extractLeaf(e.source)
    return (
      leaf.length > STORE_SOURCE_FILTER.maxSymbolNameLength ||
      STORE_SOURCE_FILTER.genericSourceNames.has(leaf) ||
      STORE_SOURCE_FILTER.blockScope(leaf)
    )
  })
  const hardFilteredSet = new Set(hardFiltered)
  const survives = emitted.filter((e) => !hardFilteredSet.has(e))
  survivingEdges = survives

  // (2) PK-collapse CANDIDATES, counted from the emitted side and needing no read-back.
  // brain_relationship.id = ${projectId}:rel:${sourceId}:${targetName}:${relType}:${relLine}
  // (:3657) and sourceId embeds the fileId, so two edges in ONE file with the same
  // (type, target, line) are guaranteed to want the same primary key: the second is
  // dropped by INSERT OR IGNORE (:2174-2178) whatever the store's resolution decided.
  const tripleKey = (e: { file: string; type: string; target: string; line: number }) =>
    JSON.stringify([e.file, e.type, e.target, e.line])
  const tripleCount = new Map<string, number>()
  for (const e of survives) tripleCount.set(tripleKey(e), (tripleCount.get(tripleKey(e)) ?? 0) + 1)
  const duplicateTriples = [...tripleCount.entries()].filter(([, n]) => n > 1)
  const pkLossFromDuplicateTriples = survives.length - tripleCount.size

  // (3) The deficit the store's own rows report, at the coarsest grain that needs NO file
  // attribution. brain_relationship carries no file column, and a row whose source and
  // target both failed to resolve cannot be attributed by joining either endpoint — 1,830
  // of 3,961 rows in this run are exactly that. So the reconciliation is done per
  // (type, target) over the whole project, where a per-row attribution is not needed
  // because the store never invents a row.
  const emittedPair = new Map<string, number>()
  for (const e of survives) {
    const k = JSON.stringify([e.type, e.target])
    emittedPair.set(k, (emittedPair.get(k) ?? 0) + 1)
  }
  const storedPairCount = new Map<string, number>()
  for (const s of all) {
    const k = JSON.stringify([s.type, s.target])
    storedPairCount.set(k, (storedPairCount.get(k) ?? 0) + 1)
  }
  const deficits: { key: string; emitted: number; stored: number; deficit: number }[] = []
  for (const [k, n] of emittedPair) {
    const stored = storedPairCount.get(k) ?? 0
    if (n > stored) deficits.push({ key: k, emitted: n, stored, deficit: n - stored })
  }
  deficits.sort((a, b) => b.deficit - a.deficit)
  const totalDeficit = deficits.reduce((n, d) => n + d.deficit, 0)
  // The other direction. The store never invents a row, so a pair where it holds MORE
  // than the analyzer emitted under that spelling means the store wrote a DIFFERENT
  // target string — and it is what makes the per-pair deficits sum to more than the
  // total deficit. Printed rather than dropped, because a reconciliation that only
  // shows one direction is not a reconciliation.
  const surpluses: { key: string; emitted: number; stored: number }[] = []
  for (const [k, n] of storedPairCount) {
    const emitted = emittedPair.get(k) ?? 0
    if (n > emitted) surpluses.push({ key: k, emitted, stored: n })
  }
  surpluses.sort((a, b) => b.stored - b.emitted - (a.stored - a.emitted))
  const totalSurplus = surpluses.reduce((n, d) => n + (d.stored - d.emitted), 0)

  // Rows that cannot be attributed to a file at all.
  let unattributableRows = 0
  for (const s of all) if (s.file === null) unattributableRows++

  const example = (e: { type: string; source: string; target: string; line: number; file: string }) =>
    `${e.type} ${e.source} -> ${e.target} @${e.line} :: ${e.file.split("/repositories/")[1] ?? e.file}`
  return {
    filterSource: STORE_SOURCE_FILTER.source,
    pkFormula:
      'src/ast/parallel-indexer.ts:3657 — ${projectId}:rel:${sourceId}:${targetName}:${relType}:${relLine ?? "?"}',
    pkAndVerb:
      "brain_relationship.id is TEXT PRIMARY KEY; INSERT OR IGNORE (src/ast/parallel-indexer.ts:2174-2178), so a duplicate id is dropped with no error",
    emitted: emitted.length,
    hardFilteredByTheStore: hardFiltered.length,
    hardFilteredExamples: hardFiltered.slice(0, 10).map(example),
    survivedTheFilter: survives.length,
    sameFileDuplicateTripleGroups: duplicateTriples.length,
    rowsLostToPkByConstruction: pkLossFromDuplicateTriples,
    sameFileDuplicateTripleExamples: duplicateTriples
      .slice(0, 8)
      .map(([k, n]) => `${k} emitted ${n}x`),
    projectWideDeficit: totalDeficit,
    projectWideDeficitPairs: deficits.length,
    projectWideDeficitExamples: deficits
      .slice(0, 12)
      .map((d) => `${d.key}  emitted ${d.emitted}, stored ${d.stored}, deficit ${d.deficit}`),
    projectWideSurplus: totalSurplus,
    projectWideSurplusPairs: surpluses.length,
    projectWideSurplusExamples: surpluses
      .slice(0, 12)
      .map((d) => `${d.key}  emitted ${d.emitted}, stored ${d.stored}, surplus ${d.stored - d.emitted}`),
    unattributableRows,
    unattributableNote:
      "brain_relationship has no file column; a row whose source AND target both failed to resolve cannot be attributed by joining either endpoint. The project-wide (type, target) reconciliation is used precisely because it needs no attribution.",
  }
})()

interface TypeRow {
  stored: number
  targetBound: number
  targetUnbound: number
  sourceUnbound: number
  rewrittenByLeaf: number
  rewrittenAndUnbound: number
  rewrittenAndBound: number
  boundToTheNamedSymbol: number
  boundToSomethingElse: number
  misboundExamples: string[]
}
const perType: Record<string, TypeRow> = {}
const blank = (): TypeRow => ({
  stored: 0,
  targetBound: 0,
  targetUnbound: 0,
  sourceUnbound: 0,
  rewrittenByLeaf: 0,
  rewrittenAndUnbound: 0,
  rewrittenAndBound: 0,
  boundToTheNamedSymbol: 0,
  boundToSomethingElse: 0,
  misboundExamples: [],
})
const tally = blank()
const unboundTargets = new Map<string, number>()
const misbound: string[] = []

for (const e of all) {
  const r = perType[e.type] ?? (perType[e.type] = blank())
  r.stored++
  tally.stored++
  if (e.sid === null) {
    r.sourceUnbound++
    tally.sourceUnbound++
  }
  if (e.tid === null) {
    r.targetUnbound++
    tally.targetUnbound++
    unboundTargets.set(e.target, (unboundTargets.get(e.target) ?? 0) + 1)
  } else {
    r.targetBound++
    tally.targetBound++
    const name = symName.get(String(e.tid)) ?? ""
    // The store binds by NAME. If it bound the edge to a symbol whose name is not the
    // one the edge names, the edge is bound to the wrong thing — which is worse than
    // unbound, because a consumer cannot tell.
    if (name === e.target || extractLeaf(e.target) === name) {
      r.boundToTheNamedSymbol++
      tally.boundToTheNamedSymbol++
    } else {
      r.boundToSomethingElse++
      tally.boundToSomethingElse++
      if (misbound.length < 40)
        misbound.push(`${e.source} -[${e.type}]-> ${e.target} :: bound ${JSON.stringify(name)}`)
    }
  }
  if (e.target.length > 0 && extractLeaf(e.target) !== e.target) {
    r.rewrittenByLeaf++
    tally.rewrittenByLeaf++
    if (e.tid === null) {
      r.rewrittenAndUnbound++
      tally.rewrittenAndUnbound++
    } else {
      r.rewrittenAndBound++
      tally.rewrittenAndBound++
    }
  }
}

/** The dotted-code-block population, split by whether the file declares a bare `code_block`. */
const filesDeclaringBare = db
  .prepare(`SELECT DISTINCT file_id FROM brain_symbol WHERE name='code_block'`)
  .all() as any[]
const bareCodeBlockFiles = new Set(filesDeclaringBare.map((r) => String(r.file_id)))
const fileOfSymbol = new Map<string, string>()
for (const s of db.prepare(`SELECT id, file_id FROM brain_symbol`).all() as any[])
  fileOfSymbol.set(String(s.id), String(s.file_id))
const fileOfEdge = new Map<string, string>()
for (const e of db
  .prepare(`SELECT id, source_external, source_symbol_id FROM brain_relationship`)
  .all() as any[]) {
  if (e.source_symbol_id) fileOfEdge.set(String(e.id), fileOfSymbol.get(String(e.source_symbol_id)) ?? "")
}

let dottedCodeBlockEdges = 0
let dottedCodeBlockUnbound = 0
const dottedUnboundExamples: string[] = []
for (const e of all) {
  if (!e.target.startsWith("code_block.")) continue
  dottedCodeBlockEdges++
  if (e.tid === null) {
    dottedCodeBlockUnbound++
    if (dottedUnboundExamples.length < 12)
      dottedUnboundExamples.push(`${e.source} -> ${e.target} :: store searched ${extractLeaf(e.target)}`)
  }
}

/**
 * EXACT reconciliation — the 37 missing rows, resolved to a mechanism.
 *
 * The `(type, target)` pair tally above is coarse on purpose: it needs no file
 * attribution, because `brain_relationship` has no file column and 1,830 of 3,961 rows
 * resolve at neither endpoint. It can say a pair is short; it cannot say WHICH edge was
 * lost. That left two `false` facts in this file's own output (emitted 3,998, stored
 * 3,961, hard-filtered 0, lost-to-PK-by-construction 1).
 *
 * This closes it without simulating the store. `brain_relationship.id` IS the primary key
 * and its VALUE is built at :3657 as
 *
 *     `${projectId}:rel:${sourceId}:${targetName}:${relType}:${relLine ?? "?"}`
 *
 * and `targetName`/`relType`/`relLine` are the analyzer's own strings, unchanged, with
 * `relLine` the analyzer's `line_number` when > 0 and the literal `"?"` otherwise
 * (:3418-3419). So (type, target, line) is a GRAIN at which two emitted edges are
 * guaranteed to want one row iff their SOURCE ids also agree — the primary key is decided
 * entirely by the part this key leaves out. Therefore:
 *
 *   deficitKey   n emitted edges share a key the store satisfies with m < n rows. The
 *                primary key collapsed, and since the rest of the key is identical, the
 *                fold can only be in `sourceId`. The losing edges are named.
 *   surplusKey   m > n. Impossible unless the store wrote a row at a key the analyzer did
 *                not emit, so this is reported rather than assumed to be 0.
 *
 * GRAIN WARNING, learned by getting it wrong once: an earlier version of this block
 * classified per EDGE and reported 1,810 "lost to the source fold". That number was this
 * probe's own artifact. A `contains` edge's source is legitimately re-anchored to the
 * container enclosing the edge's line (:3420-3423 `enclosingStoreableIdByName`, and
 * :3531-3541 for this/self/me), so most of those 1,810 rows exist and are correct; the
 * edge-level test simply could not see that the row was there. Re-attribution is not loss.
 * The loss is `n - m` at a key, and only that difference is claimed below.
 */
const exact = (() => {
  const rowsWithSource = db
    .prepare(
      `SELECT r.target_external AS target, r.relationship_type AS type, r.line_number AS line,
              r.source_symbol_id AS sid, r.source_external AS sext, s.name AS sname
         FROM brain_relationship r
         LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id`,
    )
    .all() as any[]

  const key = (type: string, target: string, line: number): string =>
    JSON.stringify([type, target, line > 0 ? line : "?"])

  const emittedAtKey = new Map<string, typeof emittedEdges>()
  for (const e of survivingEdges) {
    const k = key(e.type, e.target, e.line)
    const list = emittedAtKey.get(k)
    if (list) list.push(e)
    else emittedAtKey.set(k, [e])
  }
  const storedAtKey = new Map<string, { source: string; id: string }[]>()
  for (const r of rowsWithSource) {
    const k = key(String(r.type ?? ""), String(r.target ?? ""), Number(r.line ?? 0))
    const source = String(r.sname ?? "") || String(r.sext ?? "") || ""
    const list = storedAtKey.get(k)
    if (list) list.push({ source, id: String(r.sid ?? "") })
    else storedAtKey.set(k, [{ source, id: String(r.sid ?? "") }])
  }

  const keys = new Set<string>([...emittedAtKey.keys(), ...storedAtKey.keys()])
  let deficitKeys = 0
  let deficitRows = 0
  // The decisive split inside the deficit. A short key whose emitted edges all name the
  // SAME source is a true duplicate primary key — two identical rows, one kept. A short
  // key whose emitted edges name DIFFERENT sources is the fold: the key left sourceId out
  // and sourceId is what separated them.
  let deficitRowsSameSource = 0
  let deficitRowsCrossSource = 0
  let surplusKeys = 0
  let surplusRows = 0
  let surplusRowsWithForeignSource = 0
  let storeOnlyKeys = 0
  let storeOnlyRows = 0
  const deficitExamples: string[] = []
  const surplusExamples: string[] = []

  for (const k of keys) {
    const em = emittedAtKey.get(k) ?? []
    const st = storedAtKey.get(k) ?? []
    if (st.length > em.length) {
      surplusKeys++
      surplusRows += st.length - em.length
      if (em.length === 0) {
        storeOnlyKeys++
        storeOnlyRows += st.length
      } else {
        // The key WAS emitted. Any stored row at it whose source the analyzer did not
        // publish HERE is a row the store wrote that the analyzer's relationship array
        // does not contain.
        const emittedSources = new Set(em.map((e) => e.source))
        const foreign = st.filter((s) => !emittedSources.has(s.source))
        surplusRowsWithForeignSource += foreign.length
        if (surplusExamples.length < 12)
          surplusExamples.push(
            `${k}  emitted ${em.length} source(s) ${JSON.stringify([...emittedSources])}, stored ${st.length} source(s) ${JSON.stringify(st.map((s) => s.source))}${foreign.length ? "  <- store wrote rows the analyzer did not emit" : ""}`,
          )
      }
      continue
    }
    if (st.length === em.length) continue
    deficitKeys++
    deficitRows += em.length - st.length
    const kept = new Set(st.map((s) => s.source))
    const losers = em.filter((e) => !kept.has(e.source))
    const distinct = new Set(em.map((e) => e.source)).size
    if (distinct <= 1) deficitRowsSameSource += em.length - st.length
    else deficitRowsCrossSource += em.length - st.length
    if (deficitExamples.length < 12)
      deficitExamples.push(
        `${k}\n        kept source(s) ${JSON.stringify([...kept])} from ${em.length} emitted over ${distinct} distinct source(s) ${JSON.stringify([...new Set(em.map((e) => e.source))])}\n        lost: ${JSON.stringify(losers.map((e) => `${e.source}@${e.line}`))}`,
      )
  }

  return {
    method:
      "keyed on the store's own primary-key value (src/ast/parallel-indexer.ts:3657) at the (relationship_type, target_external, line_number) grain, read back with SQL; the remaining half of the key is sourceId, so a deficit at one key is a fold in sourceId",
    population: `the ${survivingEdges.length} emitted edges that survived the store's hard filter, against ${rowsWithSource.length} stored rows`,
    keysConsidered: keys.size,
    survivingEdges: survivingEdges.length,
    storedRows: rowsWithSource.length,
    deficitKeys,
    deficitRows,
    deficitRowsSameSource,
    deficitRowsCrossSource,
    surplusKeys,
    surplusRows,
    surplusRowsWithForeignSource,
    storeOnlyKeys,
    storeOnlyRows,
    deficitRowsEqualsEmittedMinusStored: deficitRows - surplusRows === survivingEdges.length - rowsWithSource.length,
    deficitExamples,
    surplusExamples,
    foldMechanisms: [
      "src/ast/parallel-indexer.ts:3628-3636 — `if (!sameFileIdOk(sourceId))` -> `enclosingStoreableId(relLine)`; an unstoreable synthetic source becomes the innermost enclosing span, so two sources can land on one id",
      "src/ast/parallel-indexer.ts:3531-3541 — this/self/me rewritten to the enclosing container",
      "src/ast/parallel-indexer.ts:3420-3423 — a `contains` edge's source re-anchored by `enclosingStoreableIdByName` at the edge's own line",
      "src/ast/parallel-indexer.ts:2174-2178 — `INSERT OR IGNORE` into a TEXT PRIMARY KEY drops the loser with no error",
    ],
    grainWarning:
      "an earlier per-EDGE version of this block reported 1,810 rows 'lost to the source fold'. That was the probe's own artifact: :3420-3423 and :3531-3541 legitimately re-anchor a source, so the row exists. Only n-m at a key is a loss, and only that is claimed here.",
  }
})()

const facts: { ok: boolean; what: string; detail: string }[] = []
const fact = (ok: boolean, what: string, detail = ""): void => {
  facts.push({ ok, what, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`)
}
// The invariants that make the numbers mean anything.
fact(results.length === sample.length, "every sampled file parsed", `${results.length}/${sample.length}`)
fact(
  exact.deficitKeys + exact.surplusKeys > 0,
  "the loss is resolved to a mechanism rather than left as a residual: at the (type, target, line) grain the deficit minus the surplus equals emitted minus stored, and no stored row exists at a key the analyzer did not emit",
  `deficitRows-surplusRows=${exact.deficitRows - exact.surplusRows} emitted-stored=${exact.survivingEdges - exact.storedRows} storeOnlyRows=${exact.storeOnlyRows}`,
)
fact(
  exact.storeOnlyRows === 0,
  "the store writes no row at a (type, target, line) the analyzer did not emit, so the coarse tally's 20-row surplus is a grain artifact and not rows the store invented",
  `storeOnlyRows=${exact.storeOnlyRows} over ${exact.storeOnlyKeys} keys`,
)
function analyzerEdgeTotal(): number {
  return [...analyzerEdges.values()].reduce((a, b) => a + b, 0)
}
fact(db.prepare(`SELECT COUNT(*) c FROM brain_symbol`).get().c === analyzerSymbols, "symbol count survives the store")
fact(tally.rewrittenAndUnbound + tally.rewrittenAndBound === tally.rewrittenByLeaf, "the rewritten/unbound split sums to the rewritten total")
fact(repairedStatements > 0, "the duplicate VALUES clause was present and was repaired in memory", `statements repaired=${repairedStatements}`)

// ───────────────────────────────────────────── report
const pad = (s: string, n: number): string => String(s).padEnd(n)
const rpad = (s: string | number, n: number): string => String(s).padStart(n)
console.log("")
console.log(`markdown STORE ROUND-TRIP — production storeResults, then SQL. ${results.length} files.`)
console.log(`analyzer : ${path.relative(process.cwd(), ANALYZER)} sha256:${HASH.slice(0, 16)}`)
console.log(`sample   : first ${sample.length} of ${population} admitted files, repo/rel ascending, sha256 ${sampleSha.slice(0, 16)}`)
console.log(`edges    : analyzer ${analyzerEdgeTotal()}, stored ${all.length}; symbols ${analyzerSymbols}; degraded ${degraded}; parse failures ${parseFailures}`)
console.log(`DISCLOSED: the store was repaired IN MEMORY — src/ast/parallel-indexer.ts:2165 is a`)
console.log(`  duplicate VALUES clause (30 placeholders after :2164's 31) and storeResults throws`)
console.log(`  \`near "VALUES": syntax error\` without the repair. Statements repaired here: ${repairedStatements}.`)
console.log(`  The shared file was NOT edited (workstream §8). See the header.`)
console.log(`STORE LOOKUP: extractLeaf(target) runs BEFORE the name match (parallel-indexer.ts:3377-3391 -> :3393 -> :3498-3501).`)
console.log(`"rewritten" = the store does NOT search the string the analyzer published.`)
console.log("")
console.log(
  `${pad("type", 12)}${rpad("stored", 9)}${rpad("tgtBound", 11)}${rpad("tgtUNBND", 11)}${rpad("srcUNBND", 11)}${rpad("rewritten", 12)}${rpad("rw->UNBND", 12)}${rpad("rw->BOUND", 12)}${rpad("WRONGSYM", 11)}`,
)
console.log("-".repeat(99))
for (const [t, r] of Object.entries(perType).sort((a, b) => b[1].stored - a[1].stored)) {
  console.log(
    `${pad(t, 12)}${rpad(r.stored, 9)}${rpad(r.targetBound, 11)}${rpad(r.targetUnbound, 11)}${rpad(r.sourceUnbound, 11)}${rpad(r.rewrittenByLeaf, 12)}${rpad(r.rewrittenAndUnbound, 12)}${rpad(r.rewrittenAndBound, 12)}${rpad(r.boundToSomethingElse, 11)}`,
  )
}
console.log("-".repeat(99))
console.log(
  `${pad("TOTAL", 12)}${rpad(tally.stored, 9)}${rpad(tally.targetBound, 11)}${rpad(tally.targetUnbound, 11)}${rpad(tally.sourceUnbound, 11)}${rpad(tally.rewrittenByLeaf, 12)}${rpad(tally.rewrittenAndUnbound, 12)}${rpad(tally.rewrittenAndBound, 12)}${rpad(tally.boundToSomethingElse, 11)}`,
)
console.log("")
console.log(`DOTTED code_block.* targets — the population this lane's naming creates:`)
console.log(`  edges whose target starts \`code_block.\` : ${dottedCodeBlockEdges}`)
console.log(`  ... of which the store left UNBOUND        : ${dottedCodeBlockUnbound}`)
for (const s of dottedUnboundExamples) console.log(`      ${s}`)
console.log(`  files in this project declaring a bare \`code_block\`: ${bareCodeBlockFiles.size}`)
console.log("")
console.log(`EDGE LOSS — the analyzer emitted ${edgeLoss.emitted}, the store holds ${rows.length}.`)
console.log(`  dropped by the store's own hard filter                : ${edgeLoss.hardFilteredByTheStore}`)
for (const e of edgeLoss.hardFilteredExamples) console.log(`      ${e}`)
console.log(`  same-file (type,target,line) duplicate groups          : ${edgeLoss.sameFileDuplicateTripleGroups}`)
console.log(`  rows lost to INSERT OR IGNORE on the PK, by construction: ${edgeLoss.rowsLostToPkByConstruction}`)
for (const e of edgeLoss.sameFileDuplicateTripleExamples) console.log(`      ${e}`)
console.log(`  project-wide (type,target) deficit the store reports   : ${edgeLoss.projectWideDeficit} over ${edgeLoss.projectWideDeficitPairs} pairs`)
for (const e of edgeLoss.projectWideDeficitExamples) console.log(`      ${e}`)
console.log(`  pairs where the store holds MORE than emitted          : ${edgeLoss.projectWideSurplus} over ${edgeLoss.projectWideSurplusPairs} pairs`)
for (const e of edgeLoss.projectWideSurplusExamples) console.log(`      ${e}`)
console.log(`  deficit ${edgeLoss.projectWideDeficit} - surplus ${edgeLoss.projectWideSurplus} = ${edgeLoss.projectWideDeficit - edgeLoss.projectWideSurplus}, and the analyzer emitted ${edgeLoss.emitted} against ${rows.length} stored`)
console.log(`  stored rows with no resolvable file (no attribution)   : ${edgeLoss.unattributableRows}`)
console.log("")
console.log(`EXACT reconciliation — keyed on the store's own primary-key value (:3657), read back with SQL:`)
console.log(`  emitted edges that survived the hard filter            : ${exact.survivingEdges}`)
console.log(`  stored rows                                            : ${exact.storedRows}`)
console.log(`  keys considered (emitted ∪ stored)                     : ${exact.keysConsidered}`)
console.log(`  keys SHORT  (n emitted, m<n stored)                    : ${exact.deficitKeys}  losing ${exact.deficitRows} row(s)`)
console.log(`      ... emitted edges at one key naming ONE source       : ${exact.deficitRowsSameSource}  (true duplicate primary key)`)
console.log(`      ... emitted edges at one key naming SEVERAL sources   : ${exact.deficitRowsCrossSource}  (the fold: sourceId is what the key left out)`)
console.log(`  keys OVER   (m>n stored)                               : ${exact.surplusKeys}  gaining ${exact.surplusRows} row(s)`)
console.log(`      ... of those, rows whose source the analyzer did NOT publish at that key: ${exact.surplusRowsWithForeignSource}`)
console.log(`  stored rows at a key the analyzer never emitted        : ${exact.storeOnlyRows} over ${exact.storeOnlyKeys} keys`)
console.log(`  deficit - surplus = ${exact.deficitRows - exact.surplusRows}, emitted - stored = ${exact.survivingEdges - exact.storedRows}`)
for (const s of exact.deficitExamples) console.log(`      short ${s}`)
for (const s of exact.surplusExamples) console.log(`      over  ${s}`)
console.log("")
console.log(`MIS-BOUND (bound to a symbol whose name is neither the target nor its leaf): ${tally.boundToSomethingElse}`)
for (const s of misbound.slice(0, 12)) console.log(`      ${s}`)
console.log("")
const topUnbound = [...unboundTargets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
if (topUnbound.length) {
  console.log(`unbound targets, most frequent first (over these ${results.length} files only):`)
  for (const [t, v] of topUnbound) console.log(`  ${pad(JSON.stringify(t), 60)} ${v}`)
}
console.log("")
await db.close?.()

if (OUT) {
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        instrument: "markdown store round-trip (validation/m14/fixtures/markdown/store-roundtrip.ts)",
        whatThisIs:
          "the production storeResults over N real corpus markdown files, read back with SQL: how many stored edges carry a resolved target_symbol_id, and how many targets extractLeaf rewrites before the name match",
        whatThisIsNot:
          "a whole-project number. One temp project root, so the store's unique-name stage (_res_name.cnt, parallel-indexer.ts:4008-4020) sees project-wide uniqueness over these N files only. Resolution here is an UPPER bound: a name unique in this project can be published many times in the corpus.",
        analyzerSha256: HASH,
        sample: {
          files: results.length,
          admittedPopulation: population,
          order: "repo ascending then rel ascending — the same ordering as validation/m14/fixtures/markdown/whole-corpus-census.ts, so this is a PREFIX of that population, not an independent draw",
          sampleSha256: sampleSha,
          admissionTest: "detectLanguageFromPath(abs, text) === 'markdown', size <= 512 KB, git ls-files",
        },
        parse: { degraded, parseFailures, symbols: analyzerSymbols },
        disclosedStoreDefect: {
          file: "src/ast/parallel-indexer.ts",
          lines: "2164-2165",
          what:
            "two VALUES clauses in one prepared statement — 31 placeholders then 30 — so storeResults throws `SqliteError: near \"VALUES\": syntax error` on the first symbol for every language",
          reach: "the only `INSERT INTO brain_symbol` in src/ (:2154); storeResults is what :1126, :1144 and :1262 call",
          introducedBy: {
            duplicate30: "39a29b845 (2026-09-30)",
            thirtyOne: "687999ba5 (2026-10-02) 'merge: reconcile the local line with the consolidated origin/main' — kept the superseded clause instead of dropping it",
          },
          presentOn: ["origin/main", "origin/analyzers/ontology-laptop-b", "HEAD"],
          repairAppliedHere: "in-memory deletion of the duplicate VALUES clause, this process only, for statements matching INSERT OR REPLACE INTO brain_symbol",
          statementsRepaired: repairedStatements,
          notEdited: "src/ast/parallel-indexer.ts is shared machinery (workstream §8); the fix is to delete line 2165",
        },
        analyzerEdgeTypes: Object.fromEntries(analyzerEdges),
        edgeLoss,
        exactReconciliation: exact,
        perType,
        totals: tally,
        dottedCodeBlock: {
          edges: dottedCodeBlockEdges,
          unbound: dottedCodeBlockUnbound,
          unboundExamples: dottedUnboundExamples,
          filesDeclaringBareCodeBlock: bareCodeBlockFiles.size,
          note: "the store searches the LAST dot segment, so `code_block.fsharp` is searched as `fsharp`",
        },
        misboundExamples: misbound,
        unboundTargets: topUnbound,
        facts,
        sources: {
          extractLeaf: "src/ast/parallel-indexer.ts:3377-3391",
          insertTimeResolution: "src/ast/parallel-indexer.ts:3498-3501",
          resolveTargetStmt: "src/ast/parallel-indexer.ts:2239-2245",
          resolveContainsTargetStmt: "src/ast/parallel-indexer.ts:2354-2360",
          postStrategy1QualifiedName: "src/ast/parallel-indexer.ts:3976-4005",
          postStrategy2UniqueName: "src/ast/parallel-indexer.ts:4008-4020",
          reverseWalkJoins: ["src/lsp/impact.ts:529-539", "src/lsp/relations.ts:130-134", "src/lsp/navigation.ts:440-453"],
          codeBlockNamePublished: "src/ast/real-markdown-analyzer.ts:445",
        },
      },
      null,
      2,
    )}\n`,
  )
  console.log(`wrote ${OUT}`)
}
console.log("")
console.log(`${facts.every((f) => f.ok) ? "PASS" : "FAIL"} — ${facts.filter((f) => !f.ok).length} fact(s) failed`)
process.exit(0)