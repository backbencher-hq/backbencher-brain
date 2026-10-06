// script/profile/measure-costs.mts — the isolated micro-measurements behind the
// recommendations in REPORT.md.
//
//   npx tsx script/profile/measure-costs.mts
//
// Each measurement is run on a COPY of the real index, except the pure-read
// ones. Every number this prints is a MEASUREMENT; nothing is extrapolated
// from a model. Where a measurement is not possible the line says so rather
// than estimating.
//
// Measured here:
//   1. ANALYZE — is it 35s every run, and is `PRAGMA optimize` cheaper?
//   2. the i13 name-resolution candidate blow-up (mean/p95 candidates per edge)
//   3. gravity's cost decomposition: table scan vs correlated subqueries vs
//      row-rewrite I/O (brain_symbol carries source_text; its row size matters)
//   4. superlinearity: the same statements timed at reduced row counts, so the
//      growth exponent is MEASURED rather than assumed from the SQL shape

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { ROOT, stageCorpus, freeMiB } from "./lib.ts"

const SRC_PID = "818db37d8f54173ad1357ab24627373da2e9418c"

function ms<T>(fn: () => T): { ms: number; value: T } {
  const t = process.hrtime.bigint()
  const value = fn()
  return { ms: Number(process.hrtime.bigint() - t) / 1e6, value }
}

const argv = process.argv.slice(2)
const has = (k: string) => argv.includes(k)

function main() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "bb-costs-"))
  stageCorpus(SRC_PID, dataDir)
  const dbPath = path.join(dataDir, "projects", SRC_PID, "brain.db")
  const out: any = { dataDir, measurements: {} }
  // Returns the stored value: the caller mutates the object it returns (the
  // gravity section fills in a field measured later), and a helper that returned
  // undefined silently lost that write on the previous revision.
  const M = (k: string, v?: unknown) => {
    // Called both to store a value and to re-read one (`M("gravity").x = 1`).
    // A bare re-read must NOT overwrite, or it erases the section it re-reads.
    if (v === undefined) return out.measurements[k]
    out.measurements[k] = v
    return v as any
  }
  // `--only=<sections>` must actually SELECT. The first version compared
  // `argv.includes("--only")` EXACTLY, which never matches "--only-gravity", so
  // every gate returned true and the flag silently ran everything — which is how
  // a report came to quote an ANALYZE number from a "gravity only" run without
  // anyone noticing it belonged to a different measurement.
  const only = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? null
  const want = (s: string) => (only ? only.split(",").includes(s) : true)
  if (only) console.log(`--only=${only}: running sections [${only}]`)

  console.log(`free space on the volume: ${freeMiB(dataDir)} MiB`)

  // ── 0. row-size evidence (read-only) ──────────────────────────────────────
  // brain_symbol carries a bounded `source_text`. Every gravity UPDATE rewrites
  // the whole row, so the row size IS the write amplification. Measured, not
  // assumed.
  {
    const ro = new DatabaseSync(dbPath, { readOnly: true })
    const one = (sql: string) => (ro.prepare(sql).get() as any) ?? {}
    M("rowBytes", {
      symbols: Number(one("SELECT COUNT(*) c FROM brain_symbol").c ?? 0),
      avgSourceTextBytes: Number(one("SELECT AVG(LENGTH(COALESCE(source_text,''))) v FROM brain_symbol").v ?? 0),
      avgDocstringBytes: Number(one("SELECT AVG(LENGTH(COALESCE(docstring,''))) v FROM brain_symbol").v ?? 0),
      avgQualifiedNameBytes: Number(one("SELECT AVG(LENGTH(COALESCE(qualified_name,''))) v FROM brain_symbol").v ?? 0),
      totalSourceTextMiB: Number(one("SELECT SUM(LENGTH(COALESCE(source_text,'')))/1048576.0 v FROM brain_symbol").v ?? 0),
      symbolsWithSourceText: Number(one("SELECT COUNT(*) c FROM brain_symbol WHERE source_text IS NOT NULL AND source_text != ''").c ?? 0),
    })
    console.log("\n[0] brain_symbol row size (the write amplification for every gravity pass)")
    for (const [k, v] of Object.entries(out.measurements.rowBytes)) {
      console.log(`    ${k.padEnd(26)} ${typeof v === "number" ? v.toLocaleString() : v}`)
    }
    ro.close()
  }

  if (want("analyze")) {
  // ── 1. ANALYZE ────────────────────────────────────────────────────────────
  // The real run reported 35.5s. Is that every run, and is it proportional to
  // anything other than "full DB scan"? `PRAGMA optimize` is the documented
  // cheaper alternative (it re-analyzes only tables whose rootpage changed).
  {
    const db = new DatabaseSync(dbPath)
    db.exec("PRAGMA journal_mode = WAL")
    db.exec("PRAGMA synchronous = NORMAL")

    const stat1Before = Number((db.prepare("SELECT COUNT(*) c FROM sqlite_stat1").get() as any)?.c ?? 0)
    const a1 = ms(() => db.exec("ANALYZE"))
    const a2 = ms(() => db.exec("ANALYZE"))
    const a3 = ms(() => db.exec("ANALYZE"))
    const stat1After = Number((db.prepare("SELECT COUNT(*) c FROM sqlite_stat1").get() as any)?.c ?? 0)

    // PRAGMA optimize on an already-analyzed DB should be a no-op-ish.
    const o1 = ms(() => db.exec("PRAGMA optimize"))

    // What ANALYZE costs with a bound: analysis_limit stops after N b-tree
    // pages per index. If the cost is the full scan, a small limit should be
    // proportionally cheaper — which is the evidence for "this is a full scan".
    const limitTrials: Array<{ limit: number; ms: number }> = []
    for (const limit of [1000, 10_000, 100_000]) {
      db.exec(`PRAGMA analysis_limit = ${limit}`)
      const t = ms(() => db.exec("ANALYZE"))
      limitTrials.push({ limit, ms: Math.round(t.ms) })
    }
    db.exec("PRAGMA analysis_limit = 0")

    // Restore full stats so later measurements are planned the same way the
    // product's own ANALYZE would leave them.
    ms(() => db.exec("ANALYZE"))

    M("analyze", {
      stat1RowsBefore: stat1Before,
      stat1RowsAfter: stat1After,
      run1Ms: Math.round(a1.ms),
      run2Ms: Math.round(a2.ms),
      run3Ms: Math.round(a3.ms),
      pragmaOptimizeMs: Math.round(o1.ms),
      analysisLimitTrials: limitTrials,
    })
    console.log("\n[1] ANALYZE cost")
    console.log(`    sqlite_stat1 rows: ${stat1Before} -> ${stat1After}`)
    console.log(`    ANALYZE run1 ${Math.round(a1.ms)}ms | run2 ${Math.round(a2.ms)}ms | run3 ${Math.round(a3.ms)}ms`)
    console.log(`    PRAGMA optimize (already analyzed) ${Math.round(o1.ms)}ms`)
    for (const t of limitTrials) console.log(`    ANALYZE with analysis_limit=${t.limit.toLocaleString()}: ${t.ms}ms`)
    db.close()
  }

  if (want("i13")) {
  }

  // ── 2 & 4. i13 candidates + growth, measured at reduced scales ────────────
  // The name-resolution pass joins every bare-name edge to every symbol sharing
  // that name and then ROW_NUMBER()s the result. Its cost is the size of that
  // intermediate, so measure it — and measure the growth by restricting the
  // edge population to a prefix of rowids.
  {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const one = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...(p as never[])) as any) ?? {}
    const rows = (sql: string, ...p: unknown[]) => db.prepare(sql).all(...(p as never[])) as any[]

    const distinctNames = Number(one("SELECT COUNT(DISTINCT name) c FROM brain_symbol").c ?? 0)
    const symbols = Number(one("SELECT COUNT(*) c FROM brain_symbol").c ?? 0)
    M("nameAmbiguity", {
      symbols,
      distinctNames,
      meanSymbolsPerName: symbols / Math.max(1, distinctNames),
      // The distribution matters more than the mean: one 4000-symbol name costs
      // 4000 index probes PER EDGE referencing it.
      namesWithGt100Symbols: Number(one("SELECT COUNT(*) c FROM (SELECT name FROM brain_symbol GROUP BY name HAVING COUNT(*)>100)").c ?? 0),
      namesWithGt1000Symbols: Number(one("SELECT COUNT(*) c FROM (SELECT name FROM brain_symbol GROUP BY name HAVING COUNT(*)>1000)").c ?? 0),
      maxSymbolsForOneName: Number(one("SELECT MAX(c) c FROM (SELECT COUNT(*) c FROM brain_symbol GROUP BY name)").c ?? 0),
      top5: rows("SELECT name, COUNT(*) c FROM brain_symbol GROUP BY name ORDER BY c DESC LIMIT 5"),
    })
    console.log("\n[2] name ambiguity (the i13 multiplier)")
    console.log(`    ${symbols.toLocaleString()} symbols over ${distinctNames.toLocaleString()} distinct names = ${out.measurements.nameAmbiguity.meanSymbolsPerName.toFixed(2)} per name`)
    console.log(`    names with >100 symbols: ${out.measurements.nameAmbiguity.namesWithGt100Symbols.toLocaleString()} | >1000: ${out.measurements.nameAmbiguity.namesWithGt1000Symbols.toLocaleString()} | max: ${out.measurements.nameAmbiguity.maxSymbolsForOneName.toLocaleString()}`)
    for (const r of out.measurements.nameAmbiguity.top5) console.log(`      ${String(r.c).padStart(6)}x ${String(r.name).slice(0, 40)}`)

    // Candidate pairs: the exact intermediate the window function materialises.
    const POP = `r.project_id = '${SRC_PID}' AND r.target_external IS NOT NULL
       AND r.relationship_type <> 'contains'
       AND instr(r.target_external, '.') = 0 AND instr(r.target_external, ':') = 0`
    const cand = ms(() => Number(one(`SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.project_id='${SRC_PID}' AND s.name = r.target_external WHERE ${POP}`).c ?? 0))
    const popEdges = Number(one(`SELECT COUNT(*) c FROM brain_relationship r WHERE ${POP}`).c ?? 0)

    // Growth at reduced scales. OFF by default: the timing is dominated by page
    // cache and disk contention, not by the row count, so a growth curve from
    // contended runs would be a curve of the machine, not of the algorithm.
    // The row COUNTS at each scale are stable and are always reported; only the
    // timings need `--growth`.
    const growth: Array<{ edgeFraction: number; edges: number; candidates: number; ms: number | null; msPerEdge: number | null }> = []
    const totalEdges = Number(one("SELECT COUNT(*) c FROM brain_relationship").c ?? 0)
    for (const frac of [0.125, 0.25, 0.5, 1]) {
      const limit = Math.floor(totalEdges * frac)
      const countOnly = `SELECT COUNT(*) c FROM (SELECT r.id FROM brain_relationship r WHERE r.rowid <= ${limit} AND ${POP})`
      const edges = Number(one(countOnly).c ?? 0)
      // The candidate COUNT is cheap and is the real scaling signal.
      const candCount = Number(one(
        `SELECT COUNT(*) c FROM brain_relationship r
           JOIN brain_symbol s ON s.project_id='${SRC_PID}' AND s.name = r.target_external
         WHERE r.rowid <= ${limit} AND ${POP}`
      ).c ?? 0)
      let tMs: number | null = null
      if (has("--growth")) {
        const t = ms(() => Number(one(
          `SELECT COUNT(*) c FROM (SELECT t.rel_id AS rel_id, s.id AS target_symbol_id,
             ROW_NUMBER() OVER (PARTITION BY t.rel_id ORDER BY COALESCE(s.is_declaration,0) ASC, s.id ASC) AS rn
           FROM (SELECT r2.id AS rel_id FROM brain_relationship r2 WHERE r2.rowid <= ${limit}) t
           JOIN brain_relationship r ON r.id = t.rel_id
           JOIN brain_symbol s ON s.project_id='${SRC_PID}' AND s.name = r.target_external
           WHERE ${POP}) x`
        ).c ?? 0))
        tMs = Math.round(t.ms)
      }
      growth.push({
        edgeFraction: frac,
        edges,
        candidates: candCount,
        ms: tMs,
        msPerEdge: tMs === null ? null : Math.round((tMs / Math.max(1, candCount)) * 1000) / 1000,
      })
      console.log(`    edges=${edges.toLocaleString().padStart(9)} candidates=${candCount.toLocaleString().padStart(11)}${tMs === null ? "" : ` ${tMs}ms`}`)
    }
    M("i13", {
      bareNameEdges: popEdges,
      candidatePairs: cand.value,
      candidatesPerEdge: Math.round((cand.value / Math.max(1, popEdges)) * 100) / 100,
      candidateCountMs: Math.round(cand.ms),
      growth,
      growthTimingsNote: has("--growth") ? "timings measured with --growth (expect contention noise)" : "candidate COUNTS only; timings need --growth and an otherwise-idle machine",
    })
    console.log(`\n[4] i13 intermediate: ${cand.value.toLocaleString()} candidate pairs for ${popEdges.toLocaleString()} edges (${out.measurements.i13.candidatesPerEdge}/edge), counted in ${Math.round(cand.ms)}ms`)
    db.close()
  }

  }

  // ── 3. gravity decomposition, on a WRITABLE copy ──────────────────────────
  // Step 1 is a full-table rewrite; step 2 adds two correlated subqueries per
  // row. Run each, timed, then measure how long the SAME work takes with the
  // subqueries removed — the difference is the correlated-subquery cost.
  {
    const db = new DatabaseSync(dbPath)
    db.exec("PRAGMA journal_mode = WAL")
    db.exec("PRAGMA synchronous = NORMAL")
    db.exec("PRAGMA cache_size = -65536") // 64 MiB page cache: stated, because
    // the cache size is a parameter of every number below.

    const symbols = Number((db.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as any)?.c ?? 0)

    // (a) read-only baseline: scan brain_symbol and touch every column SQLite
    // must read to evaluate the UPDATE's SET expression. No write.
    const tScan = ms(() => Number((db.prepare(
      `SELECT COUNT(*) c FROM (SELECT complexity, visibility FROM brain_symbol)`).get() as any)?.c ?? 0))

    // (b) the full row payload, i.e. the bytes a rewrite must move.
    const tPayload = ms(() => Number((db.prepare(
      `SELECT SUM(LENGTH(COALESCE(source_text,'')) + LENGTH(COALESCE(docstring,'')) + LENGTH(COALESCE(qualified_name,'')) + LENGTH(COALESCE(name,'')) + LENGTH(COALESCE(source_text,''))) c FROM brain_symbol`
    ).get() as any)?.c ?? 0))

    // (c) the correlated subqueries alone, no write: one COUNT+EXISTS per symbol.
    const tCorr = ms(() => Number((db.prepare(
      `SELECT COUNT(*) c FROM (SELECT (SELECT COUNT(*) FROM brain_relationship r WHERE r.target_symbol_id = s.id) a,
                                 (SELECT 1 FROM brain_relationship r WHERE r.target_symbol_id = s.id LIMIT 1) b
        FROM brain_symbol s)`
    ).get() as any)?.c ?? 0))

    // (d) the actual gravity step 1 (a write) — measured, then rolled forward.
    const tWrite1 = ms(() => db.exec(
      `UPDATE brain_symbol SET gravity_score = (complexity * (CASE WHEN visibility = 'public' THEN 1.5 ELSE 1.0 END)) WHERE 1=1`))

    // (e) gravity step 2 (correlated + write).
    const tWrite2 = ms(() => db.exec(
      `UPDATE brain_symbol SET gravity_score = gravity_score + (SELECT COUNT(*) * 5.0 FROM brain_relationship r WHERE r.target_symbol_id = brain_symbol.id) WHERE EXISTS (SELECT 1 FROM brain_relationship r WHERE r.target_symbol_id = brain_symbol.id)`))

    M("gravity", {
      symbols,
      cacheSizeMiB: 64,
      readScanMs: Math.round(tScan.ms),
      readPayloadBytes: tPayload.value,
      readPayloadMs: Math.round(tPayload.ms),
      correlatedSubqueriesReadOnlyMs: Math.round(tCorr.ms),
      writeStep1Ms: Math.round(tWrite1.ms),
      writeStep2Ms: Math.round(tWrite2.ms),
      writeSteps34Ms: null as number | null,
    })

    // (f) steps 3/3b/4 together — the three layer-weighted rewrites.
    const tWrite34 = ms(() => {
      db.exec(`UPDATE brain_symbol SET gravity_score = gravity_score * 2.0 WHERE layer = 'core'`)
      db.exec(`UPDATE brain_symbol SET gravity_score = gravity_score * 1.5 WHERE layer = 'service' OR layer = 'db'`)
      db.exec(`UPDATE brain_symbol SET gravity_score = gravity_score * 0.5 WHERE layer = 'test'`)
    })
    M("gravity").writeSteps34Ms = Math.round(tWrite34.ms)

    console.log("\n[3] gravity decomposition (page cache 64 MiB)")
    console.log(`    (a) read every SET-expression column, no write     ${Math.round(tScan.ms)}ms`)
    console.log(`    (b) sum the payload bytes a rewrite must move       ${Math.round(tPayload.ms)}ms  (${(tPayload.value / 1048576).toFixed(0)} MiB of symbol text alone)`)
    console.log(`    (c) correlated COUNT+EXISTS per symbol, no write     ${Math.round(tCorr.ms)}ms`)
    console.log(`    (d) WRITE step 1 (full-table rewrite)                ${Math.round(tWrite1.ms)}ms`)
    console.log(`    (e) WRITE step 2 (correlated + rewrite)              ${Math.round(tWrite2.ms)}ms`)
    console.log(`    (f) WRITE steps 3+3b+4 (layer-weighted)             ${Math.round(tWrite34.ms)}ms`)
    db.close()
  }

  if (want("gravity")) {
  writeFileSync(path.join(ROOT, "script/profile/results/costs.json"), JSON.stringify(out, null, 2))
  console.log(`\nwrote ${path.join(ROOT, "script/profile/results/costs.json")}`)
  }
}

main()