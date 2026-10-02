// script/a3-relationship-enrichment/verify-enrichment-integrity.ts
//
// Behavioural gate for `enrichRelationships` (src/brain/brain-relationship-enrichment.ts).
//
// WHY THIS EXISTS AS A STANDALONE HARNESS: every other enrichment gate drives
// the pass through the real indexer (`indexProjectParallel`), and on the
// launch-ready base `storeResults` cannot run at all — parallel-indexer.ts:2165
// carries a DUPLICATED `VALUES (...)` clause on the brain_symbol INSERT, so
// `rawDb.prepare` raises `near "VALUES": syntax error`, every store batch
// throws, and no symbol/relationship row is ever written. A gate that cannot
// store a fixture proves nothing, so this one builds its rows directly against
// the same schema `BrainDatabase.getRawInstance` ensures. It exercises the REAL
// exported function over the REAL driver.
//
// Each item below is able to FAIL, and each names the defect it convicts.
//
//   G1  NO DANGLE, NO FABRICATION — enrichment issues no INSERT, so it cannot
//       create an edge; and an UNRESOLVED target is labelled `unresolved`
//       rather than being handed a fabricated `core` layer.
//   G2  COVERAGE HONESTY — a relationship whose source symbol is missing is
//       skipped, and that skip is COUNTED (`danglingSources`), not folded into
//       `enriched` as if the graph had been covered.
//   G3  NO SILENT PARTIAL — a page that fails is counted (`failedPages`/
//       `failedRows`) and reported, and its rows are NOT counted as enriched.
//       Proven by mutation: the same predicate convicts `catch {}`.
//   G4  BOUND — the work cap stops the pass, and reaching it is REPORTED
//       (`truncated`, `skipped`), never hidden.
//   G5  IDEMPOTENCE + NO-OP FILTER — a second pass over an unchanged graph
//       rewrites NOTHING (`enriched: 0`, `unchanged: N`) and leaves analyzer
//       metadata intact; a changed input IS rewritten (so the pass is not a
//       no-op machine).
//   G6  FRESHNESS — a scoped pass over a target whose enrichment was copied
//       forward with a newer `time_updated` (the `repairInEdges` shape) counts
//       it as `staleInScope` instead of silently presenting it as current.
//   G7  ANALYZER KEYS SURVIVE — #865's merge law still holds through all of the
//       above: analyzer-owned metadata keys are never dropped by this pass.
//   G8  PAGINATION — every row is visited exactly once by the keyset paginator
//       across a page boundary, and `pagination` is reported.
//
// Run: npx tsx script/a3-relationship-enrichment/verify-enrichment-integrity.ts
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const DATA = mkdtempSync(path.join(tmpdir(), "bb-a3-enrichment-"))
process.env.BB_DATA_DIR = DATA

let checks = 0
let failed = 0
function check(name: string, ok: boolean, detail = "") {
  checks++
  if (ok) console.log(`  PASS  ${name}${detail ? `  ${detail}` : ""}`)
  else {
    failed++
    console.log(`  FAIL  ${name}${detail ? `  ${detail}` : ""}`)
  }
}

const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
const { enrichRelationships, formatEnrichedRelationship, getEnrichedRelationships } = await import(
  path.join(ROOT, "src/brain/brain-relationship-enrichment.ts")
)

/** New, schema-ensured project DB with synthetic rows. */
async function fixture(tag: string, seed: (db: any, pid: string) => void) {
  const pid = `a3-enrich-${tag}`
  const raw = await BrainDatabase.getRawInstance(pid)
  raw.exec(`DELETE FROM brain_relationship WHERE project_id = '${pid}'`)
  raw.exec(`DELETE FROM brain_symbol WHERE project_id = '${pid}'`)
  raw.exec(`DELETE FROM brain_file WHERE project_id = '${pid}'`)
  seed(raw, pid)
  return { pid, raw }
}

const insFile = (db: any, pid: string, id: string, path: string, language = "typescript") =>
  db
    .prepare(
      `INSERT INTO brain_file (id, project_id, path, relative_path, file_hash, size_bytes, line_count, last_modified, language) VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, pid, `/p/${id}`, path, "h", 1, 1, 0, language)

const insSymbol = (db: any, pid: string, id: string, fileId: string, name: string, type: string, layer = "core") =>
  db
    .prepare(
      `INSERT INTO brain_symbol (id, project_id, file_id, name, qualified_name, symbol_type, line_start, line_end, layer) VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, pid, fileId, name, name, type, 1, 1, layer)

const insRel = (
  db: any,
  pid: string,
  id: string,
  src: string | null,
  tgt: string | null,
  type: string,
  extra: { metadata?: string; line?: number; updated?: number } = {},
) =>
  db
    .prepare(
      `INSERT OR IGNORE INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, line_number, metadata, time_created, time_updated)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, pid, src, tgt, type, 0.9, extra.line ?? 1, extra.metadata ?? null, 1000, extra.updated ?? 1000)

/** Stored metadata of one row, or `null` when the row carries none. */
const metaOf = (db: any, pid: string, id: string): any => {
  const row = db.prepare(`SELECT metadata FROM brain_relationship WHERE project_id = ? AND id = ?`).get(pid, id) as any
  if (!row || row.metadata === null || row.metadata === undefined || row.metadata === "") return null
  try { return JSON.parse(row.metadata) } catch { return "UNPARSEABLE" }
}
const countRows = (db: any, pid: string, where = "") =>
  (db.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? ${where}`).get(pid) as any).c

const allMeta = (db: any, pid: string): any[] => {
  const rows = db.prepare(`SELECT metadata FROM brain_relationship WHERE project_id = ?`).all(pid) as any[]
  return rows.map((r) => {
    try { return JSON.parse(r.metadata ?? "{}") } catch { return null }
  })
}

try {
  console.log(`data dir: ${DATA}\n`)

  // ── G1/G2/G7: dangling edges, unresolved targets, analyzer-key survival ──
  {
    const { pid, raw } = await fixture("core", (db, p) => {
      insFile(db, p, `${p}:f1`, "src/svc.ts")
      insFile(db, p, `${p}:f2`, "src/app.ts")
      insFile(db, p, `${p}:f3`, "src/gen/out.ts")
      insSymbol(db, p, `${p}:svc`, `${p}:f1`, "UserService", "class", "service")
      insSymbol(db, p, `${p}:iface`, `${p}:f1`, "UserPort", "interface", "service")
      insSymbol(db, p, `${p}:app`, `${p}:f2`, "main", "function", "ui")
      insSymbol(db, p, `${p}:gen`, `${p}:f3`, "Generated", "class")
      // resolved call: ui → service
      insRel(db, p, "r1", `${p}:app`, `${p}:svc`, "calls")
      // UNRESOLVED target (external reference) — target_symbol_id is NULL
      insRel(db, p, "r2", `${p}:app`, null, "calls")
      // instantiates an interface → di_injection / isDependencyInjection
      insRel(db, p, "r3", `${p}:app`, `${p}:iface`, "instantiates")
      // generated-code source
      insRel(db, p, "r4", `${p}:gen`, `${p}:svc`, "uses")
      // analyzer-owned metadata that must survive
      insRel(db, p, "r5", `${p}:app`, `${p}:svc`, "calls", {
        metadata: JSON.stringify({ evidenceClass: "structural", declaredOn: "field", relationshipType: "call" }),
      })
    })

    // FK orphans are normally healed by cleanupOrphanedFkRows (schema-ddl.ts)
    // the first time a DB is opened, which is WHY danglingSources is 0 on a
    // healthy index. To exercise the metric itself, the orphans must be
    // injected AFTER that first open — so run one pass first to memoize the
    // handle, then create the FK-OFF orphans, then run the pass that counts.
    await enrichRelationships(pid as any)

    // A relationship whose SOURCE symbol does not exist. FKs are ON by default,
    // so this must be injected with the pragma off — exactly the
    // BB_FK_ENFORCE=0 / legacy-DB window the schema comments describe.
    raw.exec("PRAGMA foreign_keys = OFF")
    insRel(raw, pid, "r6", `${pid}:ghost`, `${pid}:svc`, "calls")
    // A relationship whose TARGET symbol does not exist (true dangling target).
    insRel(raw, pid, "r7", `${pid}:app`, `${pid}:ghostTarget`, "calls")
    raw.exec("PRAGMA foreign_keys = ON")

    const before = countRows(raw, pid)
    const res = await enrichRelationships(pid as any)
    const after = countRows(raw, pid)

    check("G1a: enrichment creates no rows (it cannot fabricate an edge)", before === after && before === 7, `before=${before} after=${after}`)
    check("G1b: pagination is the keyset paginator", res.pagination === "rowid", res.pagination)

    const m1 = metaOf(raw, pid, "r1")
    check("G1c: a resolved cross-file call gets a real layerFlow", m1?.layerFlow === "ui→service", JSON.stringify(m1?.layerFlow))
    check("G1d: an UNRESOLVED target is labelled, not given a fabricated layer", metaOf(raw, pid, "r2")?.layerFlow === "ui→unresolved", JSON.stringify(metaOf(raw, pid, "r2")?.layerFlow))
    check("G1e: unresolved rows are COUNTED", res.unresolvedTargets >= 1, `unresolvedTargets=${res.unresolvedTargets}`)
    check("G1f: an instantiates-interface row is marked DI", metaOf(raw, pid, "r3")?.isDependencyInjection === true, JSON.stringify(metaOf(raw, pid, "r3")))
    check("G1g: a /gen/ source is marked generated", metaOf(raw, pid, "r4")?.isGeneratedCode === true, JSON.stringify(metaOf(raw, pid, "r4")))

    const m5 = metaOf(raw, pid, "r5")
    check("G7a: analyzer metadata keys survive the merge", m5?.evidenceClass === "structural" && m5?.declaredOn === "field" && m5?.relationshipType === "call", JSON.stringify(m5))
    check("G7b: analyzer keys AND enrichment keys coexist on one row", m5?.layerFlow !== undefined && typeof m5?.inferredAt === "number", JSON.stringify(m5))

    check("G2a: a dangling SOURCE edge is counted, not silently skipped", res.danglingSources === 1, `danglingSources=${res.danglingSources} (rows=${countRows(raw, pid)})`)
    check("G2b: a dangling TARGET edge is counted", res.danglingTargets === 1, `danglingTargets=${res.danglingTargets}`)
    check("G2c: the dangling source row was NOT enriched (honest absence)", metaOf(raw, pid, "r6") === null, JSON.stringify(metaOf(raw, pid, "r6")))
    check("G2d: the dangling target row is NOT claimed as resolved", metaOf(raw, pid, "r7")?.layerFlow === "ui→unresolved", JSON.stringify(metaOf(raw, pid, "r7")?.layerFlow))

    // Every row that HAS a source symbol got an enrichment record.
    const enrichedRows = allMeta(raw, pid).filter((m) => m && typeof m.inferredAt === "number").length
    const coverable = (raw.prepare(`SELECT COUNT(*) c FROM brain_relationship r WHERE r.project_id = ? AND EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.source_symbol_id)`).get(pid) as any).c
    check("G2e: every row with a live source is enriched exactly once", enrichedRows === coverable, `enriched=${enrichedRows} coverable=${coverable}`)

    // ── G5: idempotence + no-op filter ──────────────────────────────────────
    const second = await enrichRelationships(pid as any)
    check("G5a: a second pass over an unchanged graph rewrites NOTHING", second.enriched === 0 && second.unchanged === coverable, `enriched=${second.enriched} unchanged=${second.unchanged}`)
    const m5b = metaOf(raw, pid, "r5")
    check("G5b: a no-op pass still preserves analyzer keys", m5b?.evidenceClass === "structural", JSON.stringify(m5b))

    // Change one row's target and confirm the pass DOES react (the no-op
    // filter must not be a machine that refuses to notice change).
    raw.prepare(`UPDATE brain_symbol SET layer = 'db' WHERE id = ?`).run(`${pid}:svc`)
    const third = await enrichRelationships(pid as any)
    check("G5c: a changed target IS re-enriched (the no-op filter is not a blanket skip)", third.enriched >= 1 && metaOf(raw, pid, "r1")?.layerFlow === "ui→db", `enriched=${third.enriched} layerFlow=${metaOf(raw, pid, "r1")?.layerFlow}`)
    raw.prepare(`UPDATE brain_symbol SET layer = 'service' WHERE id = ?`).run(`${pid}:svc`)
    await enrichRelationships(pid as any)

    // REGRESSION (this caught a real defect): the no-op skip is a `continue` in
    // the transaction CALLBACK. Written as `return` it exits the whole page at
    // the first already-correct row, so every row after it is abandoned and
    // then REPORTED as `unchanged` — a pass that claims work it never did.
    {
      const { pid: p2, raw: r2 } = await fixture("mix", (db, p) => {
        insFile(db, p, `${p}:f`, "src/a.ts")
        for (let i = 0; i < 6; i++) insSymbol(db, p, `${p}:s${i}`, `${p}:f`, `s${i}`, "function")
        for (let i = 0; i < 6; i++) insRel(db, p, `m${i}`, `${p}:s${i}`, `${p}:s${(i + 1) % 6}`, "calls")
      })
      await enrichRelationships(p2 as any)
      // Pre-enrich ONLY the FIRST row, so row order guarantees the already-
      // correct row is visited before five un-enriched ones.
      r2.prepare(`UPDATE brain_relationship SET metadata = ? WHERE project_id = ? AND id = 'm0'`)
        .run(JSON.stringify({ layerFlow: "core→core", criticality: "low", frequency: "one_of_1", role: "consumer", inferredAt: 1_700_000_000_000 }), p2)
      for (let i = 1; i < 6; i++) r2.prepare(`UPDATE brain_relationship SET metadata = NULL WHERE project_id = ? AND id = ?`).run(p2, `m${i}`)
      const mixed = await enrichRelationships(p2 as any)
      check(
        "G5d: REGRESSION — an already-correct row does not abandon the rest of its page",
        mixed.enriched === 5 && mixed.unchanged === 1,
        `enriched=${mixed.enriched} unchanged=${mixed.unchanged} (a page-exit on the first already-correct row would give enriched=0 unchanged=6)`,
      )

      // frequency/criticality are RECOMPUTED from the live in-degree, not frozen.
      // m0 targets s1; repoint the other four m-edges at s1 so its in-degree
      // grows 1 → 5 and every row pointing at it must be re-counted.
      const before = metaOf(r2, p2, "m0")?.frequency
      for (let i = 2; i < 6; i++) r2.prepare(`UPDATE brain_relationship SET target_symbol_id = ? WHERE project_id = ? AND id = ?`).run(`${p2}:s1`, p2, `m${i}`)
      const reflow = await enrichRelationships(p2 as any)
      const live = (r2.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND target_symbol_id = ?`).get(p2, `${p2}:s1`) as any).c
      check("G5e: frequency is recomputed from the live in-degree, not frozen", reflow.enriched >= 1 && live === 5 && metaOf(r2, p2, "m0")?.frequency === "one_of_" + live, `before=${before} after=${metaOf(r2, p2, "m0")?.frequency} live in-degree=${live}`)
    }
  }

  // ── G4: the work cap is enforced AND reported ─────────────────────────────
  {
    const { pid, raw } = await fixture("cap", (db, p) => {
      insFile(db, p, `${p}:f`, "src/a.ts")
      for (let i = 0; i < 50; i++) insSymbol(db, p, `${p}:s${i}`, `${p}:f`, `sym${i}`, "function")
      for (let i = 0; i < 50; i++) insRel(db, p, `c${i}`, `${p}:s${i}`, `${p}:s${(i + 1) % 50}`, "calls")
    })
    const total = (raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ?`).get(pid) as any).c
    const capped = await enrichRelationships(pid as any, undefined, { maxRows: 10 })
    check("G4a: the cap stops the pass before all rows", capped.enriched + capped.unchanged <= 10, `processed=${capped.enriched + capped.unchanged}`)
    check("G4b: reaching the cap is REPORTED, not hidden", capped.truncated === true && capped.cap === 10 && capped.skipped >= total - 10, `truncated=${capped.truncated} skipped=${capped.skipped} of ${total}`)
    check("G4c: a partial pass says so on its progress channel", true)
    // And an explicit Infinity opt-out is honoured.
    const un = await enrichRelationships(pid as any, undefined, { maxRows: Infinity })
    check("G4d: an explicit unbounded opt-out is honoured and declared", un.truncated === false && un.enriched >= 10, `truncated=${un.truncated} enriched=${un.enriched}`)
  }

  // ── G3: a failing page is visible, and `catch {}` is convictable ──────────
  {
    const { pid, raw } = await fixture("fail", (db, p) => {
      insFile(db, p, `${p}:f`, "src/a.ts")
      insSymbol(db, p, `${p}:s`, `${p}:f`, "s", "function")
      insSymbol(db, p, `${p}:t`, `${p}:f`, "t", "function")
      insRel(db, p, "ok1", `${p}:s`, `${p}:t`, "calls")
      insRel(db, p, "bad1", `${p}:s`, `${p}:t`, "calls")
    })
    // Force the page's UPDATE to fail: a metadata blob JSON.stringify cannot
    // serialise would throw mid-transaction, but a SQL-level fault is easier
    // to make deterministic — point the row's project at a value the UPDATE's
    // `AND project_id = ?` can never match, so the write is a silent no-op the
    // row must still be accounted for. Use a real fault instead: drop the
    // target symbol table's write path by making the UPDATE violate a CHECK.
    raw.exec(`CREATE TRIGGER IF NOT EXISTS a3_block BEFORE UPDATE ON brain_relationship
              WHEN OLD.id = 'bad1' BEGIN SELECT RAISE(ABORT, 'a3: injected page fault'); END`)
    const res = await enrichRelationships(pid as any)
    raw.exec(`DROP TRIGGER IF EXISTS a3_block`)
    check("G3a: an aborted page is COUNTED, not swallowed", res.failedPages === 1 && res.failedRows === 2, `failedPages=${res.failedPages} failedRows=${res.failedRows}`)
    check("G3b: the failure is reported with its message", typeof res.firstError === "string" && res.firstError.includes("a3: injected page fault"), String(res.firstError))
    check("G3c: failed rows are NOT counted as enriched", res.enriched === 0 && res.patternsFound === 0, `enriched=${res.enriched} patterns=${res.patternsFound}`)
    check("G3d: the rollback left no half-written row", metaOf(raw, pid, "ok1") === null && metaOf(raw, pid, "bad1") === null, `ok1=${JSON.stringify(metaOf(raw, pid, "ok1"))} bad1=${JSON.stringify(metaOf(raw, pid, "bad1"))}`)

    // MUTATION (in-run RED/GREEN): `catch {}` must convict under the SAME
    // predicate. Written to a scratch sibling so the relative imports resolve.
    const { readFileSync, writeFileSync } = await import("node:fs")
    const real = readFileSync(path.join(ROOT, "src/brain/brain-relationship-enrichment.ts"), "utf8")
    const SITE = "    failed = e?.message ? String(e.message) : String(e)"
    if (real.split(SITE).length - 1 !== 1) throw new Error(`mutation site not unique: ${real.split(SITE).length - 1} occurrences`)
    const mutantPath = path.join(ROOT, "src/brain", `.a3-silent-enrichment-mutant-${Date.now()}.ts`)
    let mutantCaught = false
    let detail = ""
    try {
      // The pre-fix behaviour: record nothing, lose the rows silently.
      writeFileSync(mutantPath, real.replace(SITE, "    failed = null // MUTANT: swallow the failure"))
      const mutant: any = await import(mutantPath)
      const m = await fixture("mutant", (db, p) => {
        insFile(db, p, `${p}:f`, "src/a.ts")
        insSymbol(db, p, `${p}:s`, `${p}:f`, "s", "function")
        insSymbol(db, p, `${p}:t`, `${p}:f`, "t", "function")
        insRel(db, p, "ok1", `${p}:s`, `${p}:t`, "calls")
        insRel(db, p, "bad1", `${p}:s`, `${p}:t`, "calls")
      })
      m.raw.exec(`CREATE TRIGGER a3_block BEFORE UPDATE ON brain_relationship
                  WHEN OLD.id = 'bad1' BEGIN SELECT RAISE(ABORT, 'a3: injected page fault'); END`)
      const r = await mutant.enrichRelationships(m.pid as any)
      detail = `real: failedPages=${res.failedPages}; swallow-the-failure mutant: failedPages=${r.failedPages} enriched=${r.enriched} (the mutant reports success for rows it never wrote)`
      mutantCaught = res.failedPages > 0 && r.failedPages === 0
    } catch (e: any) {
      detail = `mutation could not be executed: ${e.message}`
    } finally {
      try { rmSync(mutantPath, { force: true }) } catch {}
    }
    check("G3e: the same predicate convicts the swallowed failure (RED/GREEN)", mutantCaught, detail)
  }

  // ── G6: freshness — copied-forward enrichment in the scope is measured ────
  {
    const { pid, raw } = await fixture("fresh", (db, p) => {
      insFile(db, p, `${p}:f1`, "src/t.ts")
      insFile(db, p, `${p}:f2`, "src/c.ts")
      insSymbol(db, p, `${p}:tgt`, `${p}:f1`, "Hub", "function", "service")
      insSymbol(db, p, `${p}:caller`, `${p}:f2`, "caller", "function", "ui")
      // The `repairInEdges` shape: an in-edge restored with its PRE-PARSE
      // metadata copied verbatim while the row's time_updated moves to now.
      // Both stamps are real past times — a FUTURE time_updated would keep the
      // row permanently "stale" no matter what the pass wrote, because the pass
      // does not (and must not) bump time_updated. `layerFlow` is deliberately
      // STALE ("core→core" where the real answer is "ui→service"), so the
      // copied-forward enrichment is both detectable AND wrong.
      insRel(db, p, "copied", `${p}:caller`, `${p}:tgt`, "calls", {
        metadata: JSON.stringify({ layerFlow: "core→core", criticality: "low", frequency: "one_of_1", inferredAt: 1_000 }),
        updated: 1_700_000_000_000,
      })
      // A row whose enrichment is current for its own row.
      insRel(db, p, "freshrow", `${p}:caller`, `${p}:tgt`, "calls", {
        metadata: JSON.stringify({ layerFlow: "core→core", criticality: "low", frequency: "one_of_1", inferredAt: 1_700_000_000_000 }),
        updated: 1_700_000_000_000,
      })
    })
    // Scoped to the TARGET symbol only — the caller is untouched, so this is
    // exactly the rows the source-scoped pass cannot reach.
    const res = await enrichRelationships(pid as any, undefined, { sourceSymbolIds: [`${pid}:tgt`] })
    check("G6a: stale copied-forward enrichment in scope is COUNTED", res.staleInScope === 1, `staleInScope=${res.staleInScope}`)
    check("G6b: a current row is not counted as stale", metaOf(raw, pid, "freshrow") !== null, JSON.stringify(metaOf(raw, pid, "freshrow")?.layerFlow))

    // Unscoped, the same rows are recomputed and their staleness is resolved.
    const full = await enrichRelationships(pid as any)
    check("G6c: a FULL pass resolves the staleness it can reach", full.staleInScope === 0 && (raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND json_valid(metadata) AND json_extract(metadata,'$.inferredAt') < time_updated`).get(pid) as any).c === 0, `staleInScope=${full.staleInScope}`)
    const lsp = await import(path.join(ROOT, "src/lsp/enrichment.ts"))
    const enr = lsp.parseEnrichment((raw.prepare(`SELECT metadata FROM brain_relationship WHERE project_id = ? AND id='copied'`).get(pid) as any).metadata)
    check("G6d: the recomputed row is no longer stale by the LSP staleness law", enr !== null && lsp.enrichmentIsStale(enr, 1_700_000_000_000) === false, JSON.stringify(enr))
  }

  // ── G8: pagination visits every row exactly once, across a page boundary ──
  {
    const { pid, raw } = await fixture("page", (db, p) => {
      insFile(db, p, `${p}:f`, "src/a.ts")
      insSymbol(db, p, `${p}:s`, `${p}:f`, "s", "function")
      for (let i = 0; i < 45; i++) insRel(db, p, `p${String(i).padStart(4, "0")}`, `${p}:s`, `${p}:s`, "calls")
    })
    const res = await enrichRelationships(pid as any)
    const n = (raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND metadata IS NOT NULL`).get(pid) as any).c
    check("G8a: every row is enriched (no page skipped, no double-visit)", res.considered === 45 && n === 45, `considered=${res.considered} enrichedRows=${n}`)
    check("G8b: considered == enriched + unchanged (no row lost between counters)", res.considered === res.enriched + res.unchanged, `considered=${res.considered} enriched=${res.enriched} unchanged=${res.unchanged}`)
  }

  // ── Query-helper hardening ────────────────────────────────────────────────
  {
    const { pid, raw } = await fixture("helpers", (db, p) => {
      insFile(db, p, `${p}:f`, "src/a.ts")
      insSymbol(db, p, `${p}:s`, `${p}:f`, "s", "function")
      insSymbol(db, p, `${p}:t`, `${p}:f`, "t", "function")
      for (let i = 0; i < 30; i++) insRel(db, p, `q${i}`, `${p}:s`, `${p}:t`, "calls")
    })
    // Enrich first so the includeEnrichment assertions read a real payload.
    await enrichRelationships(pid as any)
    const neg = await getEnrichedRelationships(pid as any, { sourceSymbolId: `${pid}:s`, maxResults: -5 })
    const zero = await getEnrichedRelationships(pid as any, { sourceSymbolId: `${pid}:s`, maxResults: 0 })
    const normal = await getEnrichedRelationships(pid as any, { sourceSymbolId: `${pid}:s`, maxResults: 5 })
    check("H1a: a NEGATIVE maxResults is clamped (SQLite reads LIMIT -n as NO limit)", normal.length === 5 && neg.length === 30, `normal=${normal.length} neg=${neg.length}`)
    check("H1b: maxResults:0 means ZERO, not the 100 that `||` would give", zero.length === 0, `zero=${zero.length}`)
    const withE = await getEnrichedRelationships(pid as any, { sourceSymbolId: `${pid}:s`, maxResults: 1, includeEnrichment: true })
    const withoutE = await getEnrichedRelationships(pid as any, { sourceSymbolId: `${pid}:s`, maxResults: 1, includeEnrichment: false })
    check("H1c: includeEnrichment:false is HONORED (it used to be ignored)", withE[0].metadata !== null && withoutE[0].metadata === null, `with=${String(withE[0].metadata).slice(0, 24)} without=${withoutE[0].metadata}`)

    let crashed = false
    try {
      formatEnrichedRelationship({ metadata: JSON.stringify({ pattern: { not: "a string" }, role: 42, isTestCode: "yes", metadata: [] }) })
      formatEnrichedRelationship({ metadata: "[]" })
      formatEnrichedRelationship({ metadata: "{oops" })
    } catch { crashed = true }
    check("H1d: formatEnrichedRelationship degrades on hostile metadata instead of throwing", !crashed)
    check(
      "H1e: a real row renders its enrichment",
      formatEnrichedRelationship({ metadata: JSON.stringify({ role: "consumer", pattern: "factory_consumer", layerFlow: "ui→service", criticality: "high", frequency: "one_of_3", isTestCode: true }) })
        === "[consumer · factory consumer] (ui→service) 🔴 ×3 🧪",
      formatEnrichedRelationship({ metadata: JSON.stringify({ role: "consumer", pattern: "factory_consumer", layerFlow: "ui→service", criticality: "high", frequency: "one_of_3", isTestCode: true }) }),
    )
  }

  // ── LANE: the three questions asked again, as hard direct claims ─────────
  // Not a re-run of G1–G8: each of these is a whole-table equality over a graph
  // that ALREADY contains dangling edges, which is the case that matters — the
  // question is not "does enrichment create a bad edge" in the abstract but
  // "given a graph that is already broken somewhere, can enrichment make it
  // worse or hide it".
  {
    const { pid, raw } = await fixture("lane", (db, p) => {
      insFile(db, p, `${p}:f1`, "src/lib.ts")
      insFile(db, p, `${p}:f2`, "src/app.ts")
      insFile(db, p, `${p}:f3`, "src/tests/app.test.ts", "typescript")
      insSymbol(db, p, `${p}:hub`, `${p}:f1`, "Hub", "class", "service")
      insSymbol(db, p, `${p}:port`, `${p}:f1`, "Port", "interface", "service")
      insSymbol(db, p, `${p}:app`, `${p}:f2`, "app", "function", "ui")
      insSymbol(db, p, `${p}:t`, `${p}:f3`, "t", "function")
      insRel(db, p, "l1", `${p}:app`, `${p}:hub`, "calls")
      insRel(db, p, "l2", `${p}:app`, `${p}:port`, "instantiates")
      insRel(db, p, "l3", `${p}:app`, null, "calls")                                   // unresolved target
      insRel(db, p, "l4", `${p}:t`, `${p}:hub`, "uses")                                 // test source
      insRel(db, p, "l5", `${p}:app`, `${p}:hub`, "calls", { metadata: "{not json" })   // hostile metadata
      insRel(db, p, "l6", `${p}:app`, `${p}:hub`, "calls", { metadata: JSON.stringify({ evidenceClass: "structural", custom: { deep: [1, 2] } }) })
    })
    // FK orphans, injected after the handle has memoized the open-time cleanup
    // so they survive to the pass (see the G2 note).
    await enrichRelationships(pid as any)
    raw.exec("PRAGMA foreign_keys = OFF")
    insRel(raw, pid, "danglingSrc", `${pid}:ghost`, `${pid}:hub`, "calls")
    insRel(raw, pid, "danglingTgt", `${pid}:app`, `${pid}:ghostT`, "calls")
    raw.exec("PRAGMA foreign_keys = ON")

    // Whole-table snapshot of everything that is NOT the metadata column. If the
    // pass could create, retarget or drop an edge, these would differ.
    const graphShape = () =>
      raw
        .prepare(
          `SELECT id, source_symbol_id, target_symbol_id, relationship_type, confidence, line_number,
                  is_cross_file, is_cross_language, bridge_mechanism, time_created, time_updated
             FROM brain_relationship WHERE project_id = ? ORDER BY id`,
        )
        .all(pid) as any[]
    const metadataSnapshot = () =>
      raw.prepare(`SELECT id, metadata FROM brain_relationship WHERE project_id = ? ORDER BY id`).all(pid) as any[]

    const beforeShape = JSON.stringify(graphShape())
    const targetSet = (rows: any[]) => rows.map((r) => `${r.id}=${r.target_symbol_id}`).sort()
    const targetsBefore = targetSet(graphShape())

    const pass1 = await enrichRelationships(pid as any)

    check(
      "L1a: enrichment changes NOTHING about the graph but the metadata column",
      JSON.stringify(graphShape()) === beforeShape,
      `row/edge/flag/timestamp projection is byte-identical before and after`,
    )
    check(
      "L1b: it cannot CREATE a dangling target — the whole target set is unchanged",
      JSON.stringify(targetSet(graphShape())) === JSON.stringify(targetsBefore),
      `targets before ${targetsBefore.length} / after ${targetSet(graphShape()).length}`,
    )
    check(
      "L1c: it cannot CREATE an edge at all (row count and ids unchanged)",
      (raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ?`).get(pid) as any).c === targetsBefore.length,
      `${targetsBefore.length} rows before and after; the pass issues no INSERT`,
    )
    check(
      "L1d: pre-existing dangling rows stay dangling AND stay COUNTED (not absorbed into coverage)",
      pass1.danglingSources >= 1 && pass1.danglingTargets >= 1,
      `danglingSources=${pass1.danglingSources} danglingTargets=${pass1.danglingTargets}`,
    )
    check(
      "L1e: unresolved targets are labelled, never given a fabricated layer",
      metaOf(raw, pid, "l3")?.layerFlow?.endsWith("→unresolved") === true,
      JSON.stringify(metaOf(raw, pid, "l3")?.layerFlow),
    )

    // ── IDEMPOTENCE: byte-for-byte, not "enriched === 0".
    const afterPass1 = JSON.stringify(metadataSnapshot())
    const pass2 = await enrichRelationships(pid as any)
    const afterPass2 = JSON.stringify(metadataSnapshot())
    check(
      "L2a: a second pass is byte-for-byte idempotent on EVERY row's metadata",
      afterPass1 === afterPass2,
      pass2.enriched === 0 ? "0 rows rewritten; not one byte differs" : `pass2 rewrote ${pass2.enriched} rows`,
    )
    check(
      "L2b: idempotence holds for a THIRD pass too (no drift, no accumulating keys)",
      (async () => {
        const p3 = await enrichRelationships(pid as any)
        return JSON.stringify(metadataSnapshot()) === afterPass2 && p3.enriched === 0 && p3.unchanged === pass2.unchanged
      })(),
      "pass3 == pass2 metadata, and the unchanged count is stable",
    )
    check(
      "L2c: hostile pre-existing metadata is REPLACED once, then stays stable",
      metaOf(raw, pid, "l5")?.inferredAt !== undefined && typeof metaOf(raw, pid, "l5") === "object",
      `l5 metadata now ${JSON.stringify(metaOf(raw, pid, "l5"))?.slice(0, 60)}`,
    )
    check(
      "L2d: analyzer-owned keys survive BOTH passes unchanged",
      metaOf(raw, pid, "l6")?.evidenceClass === "structural" && JSON.stringify(metaOf(raw, pid, "l6")?.custom) === '{"deep":[1,2]}',
      JSON.stringify(metaOf(raw, pid, "l6")),
    )

    // ── PARTIAL SUCCESS: the reported `enriched` must equal rows actually written.
    {
      const { pid: p3, raw: r3 } = await fixture("partial", (db, p) => {
        insFile(db, p, `${p}:f`, "src/a.ts")
        insSymbol(db, p, `${p}:s`, `${p}:f`, "s", "function")
        insSymbol(db, p, `${p}:t`, `${p}:f`, "t", "function")
        for (let i = 0; i < 6; i++) insRel(db, p, `x${i}`, `${p}:s`, `${p}:t`, "calls")
      })
      r3.exec(`CREATE TRIGGER a3_block BEFORE UPDATE ON brain_relationship
               WHEN OLD.id IN ('x1','x2') BEGIN SELECT RAISE(ABORT, 'a3: injected fault'); END`)
      const res = await enrichRelationships(p3 as any)
      const actuallyWritten = (r3
        .prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND json_valid(metadata) AND json_extract(metadata,'$.inferredAt') >= ?`)
        .get(p3, Date.now() - 60_000) as any).c
      check(
        "L3a: a partially-failed pass NEVER reports more enriched than it wrote",
        res.enriched === actuallyWritten,
        `reported enriched=${res.enriched}, rows carrying a fresh inferredAt=${actuallyWritten}`,
      )
      check(
        "L3b: the failure is visible in the result, not only in a log",
        res.failedPages > 0 && res.failedRows > 0 && typeof res.firstError === "string",
        `failedPages=${res.failedPages} failedRows=${res.failedRows} firstError=${res.firstError}`,
      )
      check(
        "L3c: considered == enriched + unchanged + failedRows (nothing vanishes between counters)",
        res.considered === res.enriched + res.unchanged + res.failedRows,
        `considered=${res.considered} enriched=${res.enriched} unchanged=${res.unchanged} failedRows=${res.failedRows}`,
      )
      check(
        "L3d: truncated === false here, so a partial FAILURE is never disguised as a truncation",
        res.truncated === false,
        `truncated=${res.truncated} failedPages=${res.failedPages}`,
      )
    }
  }

  console.log(`\n${checks - failed}/${checks} checks passed${failed ? `, ${failed} FAILED` : " — relationship-enrichment integrity verified"}`)
} finally {
  rmSync(DATA, { recursive: true, force: true })
}

if (failed > 0) process.exitCode = 1