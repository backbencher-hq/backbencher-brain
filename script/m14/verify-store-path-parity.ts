#!/usr/bin/env bun
/**
 * JAVASCRIPT lane — STORE PATH PARITY: a full index and an incremental re-index
 * of the SAME source must leave the SAME stored graph.
 *
 * ## Why this exists
 *
 * `indexProjectParallel` resolves relationships through `resolveRelationships`,
 * which is where every closure in this lane lives (the name pass, the binding
 * pass, the `module:item` settlement, the `is_cross_file` closure). An
 * incremental run — LSP `didSave`, MCP `bb_index mode=file`, `bb_edit` — goes
 * through `reindexFilesParallel`, which calls `indexProjectParallel` in a BOUNDED
 * mode: `runBoundedPostProcessing` runs a SCOPED relationship pass
 * (`O(touched)`), not `resolveRelationships`. So a consumer's graph can depend on
 * HOW the code got indexed rather than on the code, which is the same class of
 * defect as the run-to-run spreads this lane already closed — one axis over.
 *
 * The measurement is direct and needs no new machinery: index the draw, snapshot
 * every row's stored payload, re-index EVERY file through the production
 * incremental entry point, snapshot again, compare. Rows are matched by id (the
 * id is a function of the file, the target's spelling, the type and the line, so
 * it is stable across a re-index), and the payload compared is exactly what a
 * consumer reads: `target_symbol_id`, `is_cross_file`, `is_cross_language`,
 * `bridge_mechanism`.
 *
 * ## Usage
 *
 *   bun run script/m14/verify-store-path-parity.ts [--corpus=<dir>] [--files=120] [--json=<out>]
 *
 * Exits non-zero while any row's stored payload differs between the two paths.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const FILES = Number(arg("files") ?? "120")
const CORPUS = arg("corpus") ?? "$HOME/fixtures/repositories/svelte"
const JSON_OUT = arg("json")

const JS_EXTS = /\.(js|mjs|cjs)$/

/** git-tracked js-family files under one corpus, size-capped, sorted (deterministic). */
function admitted(): string[] {
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", CORPUS, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
      .split("\0").filter(Boolean)
  } catch {
    console.error(`not a git checkout: ${CORPUS}`)
    process.exit(1)
  }
  const out: string[] = []
  for (const rel of tracked.sort()) {
    if (!JS_EXTS.test(rel)) continue
    const abs = path.join(CORPUS, rel)
    try { if (fs.statSync(abs).size > 512 * 1024) continue } catch { continue }
    out.push(abs)
  }
  return out
}

type Payload = {
  id: string
  type: string
  target: string | null
  xfile: number
  xlang: number
  bridge: string
  src: string | null
  /** The RESOLVED source symbol — the row's actor. Kept because the source is the
   *  other half of "does this edge point where it says": the target is what the
   *  edge names, the source is who names it, and a consumer reading `bb_graph`
   *  upstream is wrong if a re-index re-attributes the source. */
  ssym: string | null
  /** `target_external` and `line_number` — the two fields that decide the id's tail,
   *  kept so a row that changed SPELLING can be told from a row that is GONE. */
  tgt: string | null
  line: number | null
}

/** Identity of an edge apart from its id: the same edge re-spelled keeps these. */
const edgeKey = (r: Payload, pid: string) =>
  JSON.stringify([norm(r.src, pid), r.tgt, r.type, r.line])

const norm = (v: string | null, pid: string) => (v == null ? null : String(v).split(pid).join("P"))

async function main() {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-js-parity-"))
  const projDir = path.join(workdir, "proj")
  fs.mkdirSync(projDir, { recursive: true })
  const taken = admitted().slice(0, FILES)
  if (taken.length === 0) { console.error(`no js files under ${CORPUS}`); process.exit(1) }
  const copied: string[] = []
  for (const f of taken) {
    const rel = path.relative(CORPUS, f)
    const dest = path.join(projDir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, fs.readFileSync(f))
    copied.push(dest)
  }
  const dataDir = path.join(workdir, "data")
  fs.mkdirSync(dataDir, { recursive: true })
  process.env.BB_DATA_DIR = dataDir

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel, reindexFilesParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(projDir) as any

  console.log(`store path parity: full index vs incremental re-index of the same source`)
  console.log(`corpus:        ${CORPUS}`)
  console.log(`files indexed: ${copied.length} (deterministic FIRST of the sorted admitted list)`)
  console.log(`project dir:   ${projDir}\n`)

  const raw: any = await BrainDatabase.getRawInstance(pid)
  const q = (sql: string, ...a: any[]) => raw.prepare(sql).all(...a) as any[]

  const snapshot = (): Payload[] =>
    (q(`SELECT r.id AS id, r.relationship_type AS t, r.target_symbol_id AS target,
                COALESCE(r.is_cross_file, -1) AS xfile, COALESCE(r.is_cross_language, -1) AS xlang,
                COALESCE(r.bridge_mechanism, '') AS bridge, r.source_external AS src,
                r.source_symbol_id AS ssym, r.target_external AS tgt, r.line_number AS line
           FROM brain_relationship r WHERE r.project_id = ?`, pid) as any[]).map((r) => ({
      id: String(r.id),
      type: String(r.t),
      target: r.target ?? null,
      xfile: Number(r.xfile ?? -1),
      xlang: Number(r.xlang ?? -1),
      bridge: String(r.bridge ?? ""),
      src: r.src ?? null,
      ssym: r.ssym ?? null,
      tgt: r.tgt ?? null,
      line: r.line === null || r.line === undefined ? null : Number(r.line),
    }))
  const symbolIds = (): string[] =>
    (q(`SELECT id FROM brain_symbol WHERE project_id = ?`, pid) as any[]).map((r) => String(r.id))

  const t0 = Date.now()
  await indexProjectParallel(pid, projDir, { onProgress: () => {} })
  const fullMs = Date.now() - t0
  const before = snapshot()
  const symBefore = symbolIds()
  console.log(`full index: ${before.length} relationships, ${symBefore.length} symbols in ${fullMs} ms`)

  // THE INCREMENTAL PATH, exactly as an editor uses it: every file marked
  // modified, through `reindexFilesParallel` — the function LSP `didSave`, MCP
  // `bb_index mode=file` and `bb_edit` all call. A quiet logger is passed because
  // the default one writes to stdout (the M25.E5 framing bug), and its output is
  // not this instrument's subject.
  const t1 = Date.now()
  const rr = await reindexFilesParallel(pid, projDir, copied.map((p) => ({ path: p, type: "modified" as const })), {
    logger: { log: () => {}, write: () => {} },
  })
  const incMs = Date.now() - t1
  const after = snapshot()
  const symAfter = symbolIds()
  console.log(`incremental: ${rr.indexed} files re-indexed (${rr.errors} errors) in ${incMs} ms; stored ${after.length} relationships, ${symAfter.length} symbols\n`)

  const checks: { name: string; ok: boolean; detail: string }[] = []
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })

  // 1. The re-index must actually have happened, or the comparison is vacuous.
  check(
    "the incremental run re-indexed the files it was given",
    rr.indexed > 0 && after.length > 0,
    `${rr.indexed} files, ${rr.errors} errors, ${after.length} rows stored`,
  )

  // 2. Same rows, same symbols.
  const byBefore = new Map(before.map((r) => [norm(r.id, pid)!, r]))
  const byAfter = new Map(after.map((r) => [norm(r.id, pid)!, r]))
  const onlyBefore = [...byBefore.keys()].filter((k) => !byAfter.has(k))
  const onlyAfter = [...byAfter.keys()].filter((k) => !byBefore.has(k))
  check(
    "the row identity sets are equal after a re-index",
    onlyBefore.length === 0 && onlyAfter.length === 0,
    `before=${before.length} after=${after.length} only-before=${onlyBefore.length} only-after=${onlyAfter.length}`,
  )
  // A row that disappears (or is re-spelled) after a save is a consumer's edge
  // gone, so the shapes are printed rather than counted: by type, and by whether
  // the id's own file anchor is one of the files this run re-indexed (it always
  // is here — every file was marked modified — so that column is a self-check
  // that the ids are the same SPELLING of the same row).
  const missingByType: Record<string, number> = {}
  const extraByType: Record<string, number> = {}
  let identityChurn: Record<string, unknown> | null = null
  for (const id of onlyBefore) missingByType[byBefore.get(id)!.type] = (missingByType[byBefore.get(id)!.type] ?? 0) + 1
  for (const id of onlyAfter) extraByType[byAfter.get(id)!.type] = (extraByType[byAfter.get(id)!.type] ?? 0) + 1
  if (onlyBefore.length || onlyAfter.length) {
    console.log(`row identity churn after the re-index: ${onlyBefore.length} rows gone, ${onlyAfter.length} rows new`)
    console.log(`  gone by type: ${JSON.stringify(missingByType)}`)
    console.log(`  new  by type: ${JSON.stringify(extraByType)}`)
    // LOST or RE-SPELLED? A gone id whose EDGE (source spelling, target spelling,
    // type, line) still exists under another id is a row the re-index renamed; a
    // gone id whose edge exists nowhere is an edge a consumer had and no longer
    // has. The difference is a bug in the id spelling versus a hole in the graph,
    // so it is measured rather than described.
    const edgesAfter = new Map<string, number>()
    for (const r of after) {
      const k = edgeKey(r, pid)
      edgesAfter.set(k, (edgesAfter.get(k) ?? 0) + 1)
    }
    const edgesBefore = new Map<string, number>()
    for (const r of before) {
      const k = edgeKey(r, pid)
      edgesBefore.set(k, (edgesBefore.get(k) ?? 0) + 1)
    }
    let respelled = 0
    const lostExamples: string[] = []
    for (const id of onlyBefore) {
      const r = byBefore.get(id)!
      if (edgesAfter.has(edgeKey(r, pid))) respelled++
      else if (lostExamples.length < 10) lostExamples.push(`${r.type} ${r.src ?? "-"} -> ${r.tgt ?? "-"} line=${r.line ?? "?"}`)
    }
    const lost = onlyBefore.length - respelled
    const added = onlyAfter.filter((id) => !edgesBefore.has(edgeKey(byAfter.get(id)!, pid))).length
    identityChurn = { gone: onlyBefore.length, added: onlyAfter.length, respelled, lost, addedEdges: added, lostExamples, goneByType: missingByType, addedByType: extraByType }
    console.log(`  of the ${onlyBefore.length} gone ids: ${respelled} are the SAME EDGE re-spelled, ${lost} are edges that exist nowhere after the re-index`)
    console.log(`  of the ${onlyAfter.length} new ids: ${added} are edges that existed nowhere before (the rest are re-spellings)`)
    for (const l of lostExamples) console.log(`    LOST: ${l}`)
    for (const id of onlyBefore.slice(0, 3)) {
      const r = byBefore.get(id)!
      console.log(`    gone: ${r.type} ${id.slice(id.indexOf(":rel:") + 5, id.indexOf(":rel:") + 90)} target=${r.target ? "set" : "NULL"}`)
    }
    for (const id of onlyAfter.slice(0, 3)) {
      const r = byAfter.get(id)!
      console.log(`    new : ${r.type} ${id.slice(id.indexOf(":rel:") + 5, id.indexOf(":rel:") + 90)} target=${r.target ? "set" : "NULL"}`)
    }
  }
  const symSetBefore = new Set(symBefore.map((s) => norm(s, pid)))
  const symSetAfter = new Set(symAfter.map((s) => norm(s, pid)))
  const symOnly = [...symSetBefore].filter((s) => !symSetAfter.has(s)).length + [...symSetAfter].filter((s) => !symSetBefore.has(s)).length
  check(
    "the symbol identity sets are equal after a re-index",
    symOnly === 0,
    `before=${symBefore.length} after=${symAfter.length} symmetric difference=${symOnly}`,
  )

  // 3a. THE DERIVED FLAGS — the fields only the closures decide, which must not
  // be able to disagree between the two paths at all. This is the check that
  // found the five-writer `is_cross_file`; it now also covers the incremental
  // path, because the SAME closure runs in both (scoped in the bounded pass).
  const flagDivergent = [...byBefore.entries()].filter(([id, b]) => {
    const a = byAfter.get(id)
    if (!a) return false
    return b.xfile !== a.xfile || b.xlang !== a.xlang || b.bridge !== a.bridge
  })
  // The flags are a FUNCTION of the target (`is_cross_file` is decided from the
  // resolved target's file), so a flag difference on a row whose target did NOT
  // move would be a second, independent defect — a different rule writing the
  // same column. Asserted as a subset relation rather than as equality: equality
  // cannot hold while the target itself differs on 70 rows, and counting the two
  // together is what let the older form of this gate report 68 "flag" rows and
  // hide that they are downstream of 70 "target" rows.
  const flagIds = new Set(flagDivergent.map(([id]) => id))
  const targetIds = new Set(
    [...byBefore.entries()]
      .filter(([id, b]) => {
        const a = byAfter.get(id)
        return !!a && norm(b.target, pid) !== norm(a.target, pid)
      })
      .map(([id]) => id),
  )
  const flagNotExplained = [...flagIds].filter((id) => !targetIds.has(id))
  check(
    "every derived-flag difference belongs to a row whose target also differs (no second rule writes the flag)",
    flagNotExplained.length === 0,
    flagNotExplained.length === 0
      ? `${flagDivergent.length} of ${before.length} rows differ, all of them rows in the target residue`
      : `${flagNotExplained.length} flag difference(s) on rows whose target is unchanged: ${flagNotExplained.slice(0, 5).join(", ")}`,
  )

  // 3a-bis. THE SOURCE ENDPOINT. This gate compared the target and every derived
  // flag and never `source_symbol_id`, so a row whose attributed SOURCE moved
  // through a re-index was invisible here — the outgoing half of the question
  // this file exists to ask. It is its own check rather than one more field: the
  // target is what an edge NAMES, the source is WHO names it, and the two are
  // decided by different code, so agreement on one says nothing about the other.
  // The three directions are three different defects, so they are counted apart:
  // a source that DISAPPEARS is the re-index losing the actor of an edge the full
  // index had; one that APPEARS is the two paths disagreeing about whether the
  // file declares an actor at all; and one that CHANGES SYMBOL is two deciders
  // answering one question differently — J12's shape, on the other endpoint.
  const sourceDivergent = [...byBefore.entries()].filter(([id, b]) => {
    const a = byAfter.get(id)
    if (!a) return false
    return (b.ssym ?? null) !== (a.ssym ?? null)
  })
  const srcToNull = sourceDivergent.filter(([id, b]) => b.ssym && !byAfter.get(id)!.ssym).length
  const srcFromNull = sourceDivergent.filter(([id, b]) => !b.ssym && byAfter.get(id)!.ssym).length
  const srcChanged = sourceDivergent.filter(([id, b]) => b.ssym && byAfter.get(id)!.ssym && b.ssym !== byAfter.get(id)!.ssym).length
  check(
    "every row stores the same SOURCE symbol after a re-index",
    sourceDivergent.length === 0,
    sourceDivergent.length === 0
      ? `0 of ${before.length} rows differ on source_symbol_id`
      : `${sourceDivergent.length} of ${before.length} rows differ (${srcToNull} bound -> NULL, ${srcFromNull} NULL -> bound, ${srcChanged} bound -> a DIFFERENT symbol)`,
  )
  if (sourceDivergent.length) {
    for (const [id, b] of sourceDivergent.slice(0, 8)) {
      console.log(`    source moved: ${b.type} ${String(b.src ?? "-")}  ${b.ssym ?? "NULL"} -> ${byAfter.get(id)!.ssym ?? "NULL"}`)
    }
  }

  // 3b. THE RESOLVED TARGET — and where the two paths still disagree, WHICH
  // disagreement it is. A row whose target the FULL pass left NULL and the
  // re-index filled in is not a flag bug: it is the insert path's fast resolver
  // (`resolveTargetStmt`) binding a bare name by proximity, while the resolution
  // pass refuses that same name unless it is unique in the project. The gate
  // measures the ambiguity from the database rather than asserting it, so the
  // residue is attributed and never merely counted.
  const ambiguous = new Set(
    (q(`SELECT name FROM brain_symbol WHERE project_id = ? GROUP BY name HAVING COUNT(*) > 1`, pid) as any[])
      .map((r) => String(r.name)),
  )
  const targetRows = [...byBefore.entries()].filter(([id, b]) => {
    const a = byAfter.get(id)
    return !!a && norm(b.target, pid) !== norm(a.target, pid)
  })
  const attributed = targetRows.map(([id, b]) => {
    const a = byAfter.get(id)!
    const leaf = (a.target ?? "").split(":rel:").length > 1 ? "" : String(a.target ?? "").split(":").slice(-2, -1)[0] ?? ""
    return { id, type: b.type, before: b.target, after: a.target, afterLeaf: leaf, ambiguous: ambiguous.has(leaf) }
  })
  const explained = attributed.filter((r) => r.before === null && r.after !== null).length
  // The residue splits in TWO, and only one of them is benign. A row the full
  // pass left NULL and the re-index bound is the insert path's proximity rule
  // disagreeing with the resolution pass's uniqueness rule — a decision
  // difference, and the next item (see docs). A row that WAS resolved and comes
  // back changed or unresolved is not a decision difference at all: it is the
  // re-index rewriting a graph edge the full index had, the exact shape this
  // gate exists to catch. They are counted apart so the benign class can never
  // hide the other one.
  const lost = attributed.filter((r) => r.before !== null && r.after === null)
  const rebound = attributed.filter((r) => r.before !== null && r.after !== null)
  // Two assertions, because the residue has two very different halves and one
  // number for both would hide the one that matters.
  //
  // (1) THE INVARIANT. No row may LOSE its resolution through a re-index. A row
  //     that was resolved and comes back NULL is the re-index rewriting a graph
  //     edge the full index had — not a decision difference, a loss.
  // (2) The residue's SHAPE. Every remaining difference must be a row the
  //     resolution pass cannot decide by itself: its name is ambiguous in the
  //     project, or the full pass left it NULL for that reason. Then the two
  //     writers each pick a candidate and they disagree — measured here as 63
  //     NULL→bound and 2 bound→a different symbol, ALL of them names the
  //     resolution pass refuses to guess (45 of the 65 are ambiguous in the
  //     project by name count). A difference on a row whose name IS unique, with
  //     both sides resolved, is a genuine contradiction between two deciders and
  //     fails: nothing about ambiguity explains it.
  //     Both writers resolved, to DIFFERENT symbols, on a name that is UNIQUE
  //     in the project: nothing about ambiguity explains that, so it fails.
  const unexplained = attributed.filter((r) => r.before !== null && r.after !== null && !r.ambiguous)
  check(
    "no row LOSES its resolved target through a re-index",
    lost.length === 0,
    lost.length === 0 ? `0 of ${before.length} rows went resolved -> NULL` : `${lost.length} rows lost their target`,
  )
  check(
    "every remaining `target` difference is the two-writer disagreement on a name the resolution pass cannot decide",
    unexplained.length === 0,
    attributed.length === 0
      ? `0 of ${before.length} rows differ`
      : `${attributed.length} rows: ${explained} full-pass-NULL -> re-index-bound, ${rebound.length} bound -> a DIFFERENT symbol (${attributed.filter((r) => r.ambiguous).length} of all ${attributed.length} carry an ambiguous name), ${unexplained.length} on a unique name (NOT attributable)`,
  )
  if (unexplained.length) {
    console.log(`rows whose target difference ambiguity does NOT explain (${unexplained.length}):`)
    for (const r of unexplained.slice(0, 20)) {
      console.log(`  ${r.type} ${r.id.slice(r.id.indexOf(":rel:") + 5, r.id.indexOf(":rel:") + 90)}`)
      console.log(`    before: ${r.before ?? "NULL"}`)
      console.log(`    after : ${r.after ?? "NULL"}`)
    }
  }

  const divergent: { id: string; type: string; before: Payload; after: Payload; fields: string[] }[] = []
  for (const [id, b] of byBefore) {
    const a = byAfter.get(id)
    if (!a) continue
    const fields: string[] = []
    if (norm(b.target, pid) !== norm(a.target, pid)) fields.push("target")
    if (b.xfile !== a.xfile) fields.push("is_cross_file")
    if (b.xlang !== a.xlang) fields.push("is_cross_language")
    if (b.bridge !== a.bridge) fields.push("bridge_mechanism")
    if (fields.length) divergent.push({ id, type: b.type, before: b, after: a, fields })
  }
  const targetOnly = divergent.length > 0 && divergent.every((d) => d.fields.length === 1 && d.fields[0] === "target")
  check(
    "every row stores the same payload after a re-index (target + derived flags)",
    divergent.length === 0,
    divergent.length === 0
      ? `0 of ${before.length} rows differ`
      : `${divergent.length} of ${before.length} rows differ` +
        (targetOnly ? ` — all of them \`target\` only, all attributed above (the full pass leaves the name unresolved; the re-index's insert-time resolver binds it by proximity)` : ""),
  )

  if (divergent.length) {
    const byField: Record<string, number> = {}
    const byType: Record<string, number> = {}
    const shapes: Record<string, number> = {}
    for (const d of divergent) {
      for (const f of d.fields) byField[f] = (byField[f] ?? 0) + 1
      byType[d.type] = (byType[d.type] ?? 0) + 1
      const key = `${d.type} ${d.fields.join("+")} ${d.before.xfile}->${d.after.xfile}`
      shapes[key] = (shapes[key] ?? 0) + 1
    }
    console.log(`divergent rows: ${divergent.length} of ${before.length}`)
    console.log(`  by field: ${JSON.stringify(byField)}`)
    console.log(`  by type : ${JSON.stringify(byType)}`)
    console.log(`  shapes  : ${JSON.stringify(shapes, null, 2)}`)
    if (attributed.length) {
      const amb = attributed.filter((r) => r.ambiguous).length
      console.log(`  target residue attribution: ${attributed.length} rows; the re-index's target name is ambiguous in the project on ${amb} of them`)
      console.log(`    (the insert path binds by proximity; the resolution pass refuses a non-unique name — the next item, see docs/analyzers/real-javascript-analyzer.md §12)`)
    }
    console.log(`  first examples:`)
    for (const d of divergent.slice(0, 8)) {
      console.log(`    ${d.type} ${d.id.slice(d.id.indexOf(":rel:") + 5, d.id.indexOf(":rel:") + 80)}`)
      console.log(`      before: target=${d.before.target ?? "NULL"} xfile=${d.before.xfile} xlang=${d.before.xlang} bridge=${d.before.bridge || "(null)"}`)
      console.log(`      after : target=${d.after.target ?? "NULL"} xfile=${d.after.xfile} xlang=${d.after.xlang} bridge=${d.after.bridge || "(null)"}`)
    }
  }

  console.log("")
  let failed = 0
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name} — ${c.detail}`)
    if (!c.ok) failed++
  }
  console.log(`store-path-parity: ${checks.length} checks, ${checks.length - failed} pass, ${failed} fail`)
  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({
      corpus: CORPUS, files: copied.length,
      rows: { full: before.length, incremental: after.length },
      symbols: { full: symBefore.length, incremental: symAfter.length },
      incremental: { indexed: rr.indexed, errors: rr.errors, ms: incMs },
      fullIndexMs: fullMs,
      rowIdentityChurn: identityChurn ?? { gone: onlyBefore.length, added: onlyAfter.length },
      goneIds: onlyBefore.slice(0, 60),
      addedIds: onlyAfter.slice(0, 60),
      divergentCount: divergent.length,
      flagDivergentCount: flagDivergent.length,
      sourceResidue: {
        count: sourceDivergent.length,
        toNull: srcToNull,
        fromNull: srcFromNull,
        changedSymbol: srcChanged,
        rows: sourceDivergent.slice(0, 200).map(([id, b]) => ({
          id, type: b.type, src: b.src,
          before: b.ssym ?? null, after: byAfter.get(id)!.ssym ?? null,
        })),
      },
      targetResidue: {
        count: attributed.length,
        explainedByTwoWriterDisagreement: explained,
        unexplained,
        ambiguousTargetNames: attributed.filter((r) => r.ambiguous).length,
        rows: attributed.slice(0, 200),
      },
      divergent: divergent.slice(0, 200).map((d) => ({
        id: d.id, type: d.type, fields: d.fields,
        before: { target: d.before.target, xfile: d.before.xfile, xlang: d.before.xlang, bridge: d.before.bridge },
        after: { target: d.after.target, xfile: d.after.xfile, xlang: d.after.xlang, bridge: d.after.bridge },
      })),
      checks,
      verdict: failed === 0 ? "PASS" : "FAIL",
    }, null, 2) + "\n")
    console.log(`wrote ${JSON_OUT}`)
  }
  process.exit(failed === 0 ? 0 : 1)
}

await main()
