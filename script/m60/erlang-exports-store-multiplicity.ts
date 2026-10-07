/**
 * ERLANG — does the `exports` ARITY identity survive the STORE?
 *
 *   bun script/m60/erlang-exports-store-multiplicity.ts [--out path]
 *
 * ## Why this probe exists
 *
 * ER-D43 widened the analyzer's in-memory edge key so that `-export([start/0, start/1])`
 * on ONE line publishes two `exports` rows instead of one. The oracle census counts the
 * difference over the same 3,939-file corpus: **57,819 `exports` rows before the fix,
 * 64,354 after** (both reproduced by swapping `src/ast/real-erlang-analyzer.ts` for its
 * parent revision and re-running `erlang-ontology-census.ts`).
 *
 * Every one of those numbers is a `parseFile` number. The row a consumer reads comes from
 * `brain_relationship`, and what counts as a duplicate there is decided in
 * `src/ast/parallel-indexer.ts`:
 *
 *     const relId = `${projectId}:rel:${sourceId}:${targetName}:${relType}:${relLine ?? "?"}`
 *     INSERT OR IGNORE INTO brain_relationship
 *
 * That key carries the target NAME, the type and the LINE. An `exports` edge publishes
 * `name/arity` with the arity in `metadata.arity`, and `start/0` and `start/1` sit on the
 * same line — same key, and `INSERT OR IGNORE` keeps one. So the file this lane owns and
 * the file that writes the store disagree about how many rows a module's public surface
 * is, and only the second one is what `bb_graph` reads.
 *
 * The alternative reading — "the metadata is part of the key somewhere downstream" — is
 * exactly the kind of claim that survives because nobody read the WRITE path. So this
 * probe measures it, on three shapes that separate the two hypotheses:
 *
 *   A  `-export([start/0, start/1])` L2      same name, SAME line, two arities
 *   B  `-export([other/0])` L3, `[other/1]` L4   same name, TWO lines, two arities
 *   C  `-export([alpha/0, beta/1])` L5      two names, one line — the control
 *
 *   store dedupes on (source, target, type, line)  ->  A=1  B=2  C=2   STORE COLLAPSES
 *   store carries the arity                        ->  A=2  B=2  C=2   STORE CARRIES
 *
 * ## CHECK 0 — the store path does not run at HEAD, for a reason outside this lane
 *
 * `parallel-indexer.ts:2164-2165` prepares `insertSymbol` with TWO consecutive `VALUES`
 * clauses — 31 placeholders, then 30, from merge `687999ba5` (2026-10-02). That is not
 * valid SQL: `storeResults` reports `near "VALUES": syntax error`, and the run then aborts
 * in post-processing with "no index for project". It is on `origin/main`, it is not
 * ERLANG-specific, and it is not fixed here.
 *
 * It is measured anyway, because a probe that could only report "the store is broken"
 * would leave its own question unanswered. The shim removes that ONE statement defect at
 * RUNTIME, in this process, and touches no repository file: the `relId`, the
 * `INSERT OR IGNORE`, the resolution pass and the analyzer all run exactly as at HEAD.
 * The shim is reported in the output with the number of statements it repaired, so a
 * reader can see exactly one statement was touched.
 *
 * ## The verdict
 *
 *   STORE COLLAPSES  the analyzer's multiplicity does not reach `brain_relationship`
 *   STORE CARRIES    it does
 *
 * `real-erlang-analyzer.ts` is NOT reverted over a STORE COLLAPSES: the parse-level rows
 * are strictly more faithful than the rows they replaced and every consumer that reads
 * `parseFile` sees them. The key is `parallel-indexer.ts`'s to change and widening it for
 * every language is a store-visible decision this lane does not make.
 *
 * READ-ONLY apart from a temp project and a temp `BB_DATA_DIR`.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : undefined

const SRC = `-module(multi).
-export([start/0, start/1]).
-export([other/0]).
-export([other/1]).
-export([alpha/0, beta/1]).

start() -> ok.
start(_) -> ok.
other() -> ok.
other(_) -> ok.
alpha() -> ok.
beta(_) -> ok.
`

interface Shape {
  label: string
  parse: number
  stored: number
}

async function main(): Promise<void> {
  // ---- what the analyzer publishes: every ER-D43 number is measured here
  const emitted: any[] = []
  {
    const { parseFile } = (await import(path.join(ROOT, "src/ast/pool-worker.ts"))) as any
    const dir = mkdtempSync(path.join(tmpdir(), "erlang-mult-emit-"))
    const f = path.join(dir, "multi.erl")
    writeFileSync(f, SRC)
    const r = await parseFile(f, dir)
    for (const x of r.relationships ?? []) if (x.type === "exports") emitted.push(x)
  }

  // ---- what the store keeps: this is what bb_graph reads
  const data = mkdtempSync(path.join(tmpdir(), "erlang-mult-data-"))
  process.env.BB_DATA_DIR = data
  const project = mkdtempSync(path.join(tmpdir(), "erlang-mult-proj-"))
  mkdirSync(path.join(project, "src"), { recursive: true })
  writeFileSync(path.join(project, "src", "multi.erl"), SRC)

  const { getProjectId } = (await import(path.join(ROOT, "src/cli/index.ts"))) as any
  const { indexProjectParallel } = (await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))) as any
  const { BrainDatabase } = (await import(path.join(ROOT, "src/brain/database.ts"))) as any
  const pid = getProjectId(project) as any

  let storeRunsAtHead = true
  let headStoreError = ""
  try {
    await indexProjectParallel(pid, project, {})
  } catch (e) {
    storeRunsAtHead = false
    headStoreError = e instanceof Error ? e.message.split("\n")[0]! : String(e)
  }

  let rawDb: any
  let statementsShimmed = 0
  let finalPid = pid
  if (!storeRunsAtHead) {
    rawDb = await BrainDatabase.getRawInstance(pid)
    const realPrepare = rawDb.prepare.bind(rawDb)
    rawDb.prepare = (sql: string, ...rest: any[]) => {
      const out: string[] = []
      for (const line of sql.split("\n")) {
        // drop a SECOND consecutive VALUES clause, whatever its width. The two at
        // parallel-indexer.ts:2164-2165 are not the same width — 31 placeholders then
        // 30 — so an "identical line" test misses it and the statement stays invalid.
        if (/^\s*VALUES\s*\(/.test(line) && out.length > 0 && /^\s*VALUES\s*\(/.test(out[out.length - 1]!)) {
          statementsShimmed++
          continue
        }
        out.push(line)
      }
      return realPrepare(out.join("\n"), ...rest)
    }
    await indexProjectParallel(pid, project, {})
    rawDb = await BrainDatabase.getRawInstance(pid)
  }

  const rows = rawDb
    .prepare(
      `SELECT r.id, r.line_number, r.target_external, r.metadata, s.name AS source_name
         FROM brain_relationship r
         LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
        WHERE r.project_id = ? AND r.relationship_type = 'exports'`,
    )
    .all(finalPid) as any[]
  const storedSymbols = (
    rawDb.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?`).get(finalPid) as any
  )?.c as number

  const arity = (r: any): unknown => {
    try { return (JSON.parse(r.metadata ?? "{}") ?? {}).arity } catch { return undefined }
  }
  const sameNameSameLine = (list: any[], name: string) => list.filter((r) => r.target === name || r.target_external === name).length
  const lineOf = (r: any) => r.line_number

  const shapes: Shape[] = [
    { label: "A same name, SAME line, two arities (start/0, start/1 on L2)", parse: emitted.filter((x) => x.target === "start" && lineOf(x) === 2).length, stored: rows.filter((r) => r.target_external === "start" && lineOf(r) === 2).length },
    { label: "B same name, TWO lines, two arities (other/0 L3, other/1 L4)", parse: emitted.filter((x) => x.target === "other").length, stored: rows.filter((r) => r.target_external === "other").length },
    { label: "C two names, one line (alpha/0, beta/1 on L5) — control", parse: emitted.filter((x) => lineOf(x) === 5).length, stored: rows.filter((r) => lineOf(r) === 5).length },
  ]
  const identity = (list: any[], nameKey: (r: any) => string) => new Set(list.map(nameKey)).size
  const parseIdentities = identity(emitted, (x: any) => `${x.target}/${(x.metadata ?? {}).arity}`)
  const storedIdentities = identity(rows, (r: any) => `${r.target_external}/${arity(r)}`)

  console.log("=".repeat(96))
  console.log("ERLANG exports MULTIPLICITY — parseFile vs brain_relationship")
  console.log("=".repeat(96))
  console.log(`store key: projectId:rel:sourceId:targetName:relType:relLine   (parallel-indexer.ts, INSERT OR IGNORE)`)
  console.log(`CHECK 0  store runs at HEAD: ${storeRunsAtHead ? "yes" : `NO — ${headStoreError}`}`)
  if (!storeRunsAtHead) {
    console.log(`         insertSymbol carries TWO consecutive VALUES clauses (31 placeholders then 30) at`)
    console.log(`         parallel-indexer.ts:2164-2165 — master-owned, on origin/main, not fixed here.`)
    console.log(`         runtime shim repaired ${statementsShimmed} statement(s); no repository file touched.`)
  }
  console.log(`         brain_symbol rows stored: ${storedSymbols}`)
  console.log("")
  for (const s of shapes) {
    const verdict = s.parse > s.stored ? "COLLAPSED" : "carried"
    console.log(`  ${s.label.padEnd(58)} parseFile ${String(s.parse).padStart(2)}   stored ${String(s.stored).padStart(2)}   ${verdict}`)
  }
  console.log(`  ${"distinct name/arity identities".padEnd(58)} parseFile ${String(parseIdentities).padStart(2)}   stored ${String(storedIdentities).padStart(2)}`)
  console.log(`  ${"exports rows, all".padEnd(58)} parseFile ${String(emitted.length).padStart(2)}   stored ${String(rows.length).padStart(2)}`)
  console.log("")
  for (const r of rows) {
    console.log(`  stored: ${r.source_name} -> ${r.target_external} @${r.line_number}  arity=${arity(r) ?? "(absent)"}  id=…${String(r.id).slice(-34)}`)
  }
  for (const x of emitted) {
    console.log(`  emitted: ${x.source} -> ${x.target} @${x.line_number}  arity=${(x.metadata ?? {}).arity}`)
  }

  const collapses = shapes[0]!.parse > shapes[0]!.stored
  console.log("")
  console.log(`verdict: ${collapses ? "STORE COLLAPSES" : "STORE CARRIES"}`)
  if (collapses) {
    console.log(`  ${shapes[0]!.parse} arity-distinct \`exports\` rows leave parseFile for one name on one line; ${shapes[0]!.stored} is stored.`)
    console.log(`  metadata.arity is in the analyzer's key and NOT in the store's, so ER-D43's +6,535 corpus rows`)
    console.log(`  are not +6,535 graph rows. Shape B (two lines) and C (two names) are unaffected, which is`)
    console.log(`  what makes this a key defect rather than a general exports collapse.`)
  }

  const artifact = {
    at: new Date().toISOString(),
    script: "erlang-exports-store-multiplicity",
    productionEntry: "src/ast/pool-worker.parseFile, and src/ast/parallel-indexer.indexProjectParallel for the store side",
    storeKey: "${projectId}:rel:${sourceId}:${targetName}:${relType}:${relLine ?? '?'} — INSERT OR IGNORE INTO brain_relationship",
    fixture: SRC,
    check0StoreRunsAtHead: storeRunsAtHead,
    check0Error: headStoreError || null,
    check0Cause: "src/ast/parallel-indexer.ts:2164-2165 prepares insertSymbol with two consecutive VALUES clauses (31 placeholders then 30); not valid SQL; on origin/main via merge 687999ba5",
    runtimeStatementsShimmed: statementsShimmed,
    brainSymbolRowsStored: storedSymbols,
    shapes,
    parseFileExportsRows: emitted.length,
    storedExportsRows: rows.length,
    parseFileDistinctNameArityIdentities: parseIdentities,
    storedDistinctNameArityIdentities: storedIdentities,
    verdict: collapses ? "STORE COLLAPSES" : "STORE CARRIES",
    consequence:
      collapses
        ? "The arity identity ER-D43 added to real-erlang-analyzer.ts is not in the store key, so the recovered multiplicity is invisible to every store-reading consumer (bb_graph, bb_impact). Master-owned fix: parallel-indexer.ts's relId, or an exports target that carries the arity."
        : "The store keeps every arity-distinct exports row the analyzer publishes.",
    storedRows: rows.map((r) => ({ id: r.id, source: r.source_name, target: r.target_external, line: r.line_number, arity: arity(r) ?? null })),
    emittedRows: emitted.map((x) => ({ source: x.source, target: x.target, line: x.line_number, arity: (x.metadata ?? {}).arity ?? null })),
  }
  if (OUT) {
    const { writeFileSync } = await import("node:fs")
    writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`)
    console.log(`\nartifact: ${OUT}`)
  }
  console.log(`data dir: ${data}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
