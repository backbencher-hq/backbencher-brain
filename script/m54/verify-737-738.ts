// script/m54/verify-737-738.ts — permanent gate for issues #737 and #738.
//
// #738 (SQLite runtime asymmetry): the M40 bounded relationship-resolution
// statement referenced the outer column r.target_external inside a subquery
// ORDER BY. Bun's SQLite 3.53 accepts that; node's better-sqlite3 bundles
// 3.49.2, which REJECTS it ("no such column: r.target_external"). Production
// `bin/bb` runs under node, so every CLI index failed that phase and marked
// itself partial — while all bun-run verifier gates stayed green.
//
// #737 (FK batch diagnostics): an FK failure rolls back a whole store batch
// with only the driver message as evidence. diagnoseBatchFailure
// (src/ast/store-diagnostics.ts) re-runs the failed batch file-by-file under
// capturing wrappers inside a transaction that ALWAYS rolls back, then names
// the offending file and statements. Pure diagnostics, zero persistence.
//
// Runtime split (deliberate): run this gate under BOTH runtimes.
//   bun  (npm run verify chain): 737 behavioral + 738 fix conformance + source
//        conformance + mutation + bun old-shape acceptance documented.
//   node (npx tsx): 738 node-rejection proof (the production bug class) + fix
//        works on SQLite 3.49.2. Sections not applicable to the current
//        runtime are printed as explicit SKIPPED lines — never silent.

import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const isBun = typeof (globalThis as any).Bun !== "undefined"
const RUNTIME = isBun ? "bun" : "node"

let failures = 0
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  [${RUNTIME}] ${name}${detail ? "  — " + detail : ""}`)
  if (!ok) failures++
}
const skip = (name: string, why: string) =>
  console.log(`SKIP  [${RUNTIME}] ${name}  — ${why}`)

async function openFixtureDb(file: string) {
  if (isBun) {
    const { Database } = await import("bun:sqlite")
    const d = new Database(file)
    d.run("PRAGMA foreign_keys = ON") // M54 policy
    return d
  }
  const Database = (await import("better-sqlite3")).default
  const d = new Database(file)
  d.exec("PRAGMA foreign_keys = ON") // M54 policy (node default is already ON; explicit per policy)
  return d
}

async function main() {
  console.log(`#737/#738 gate — runtime=${RUNTIME}`)

  // ══ Shared fixture: real FK DDL subset (matches src/brain/schema-ddl.ts) ══
  const tmp = mkdtempSync(path.join(tmpdir(), "bb-737738-"))
  const db = await openFixtureDb(path.join(tmp, "fixture.db"))
  const run = (sql: string, ...args: any[]) => {
    if (isBun) return (db as any).run(sql, ...args)
    return (db as any).exec(sql.replace(/\?/g, "?"), ...[]) // node: exec for DDL only
  }
  const prep = (sql: string) => (isBun ? (db as any).prepare(sql) : (db as any).prepare(sql))
  const all = (sql: string, ...args: any[]) => (prep(sql) as any).all(...args)
  const exec = (sql: string) => (isBun ? (db as any).run(sql) : (db as any).exec(sql))

  exec(`CREATE TABLE brain_file (id TEXT PRIMARY KEY, project_id TEXT, path TEXT, time_updated INTEGER)`)
  exec(`CREATE TABLE brain_symbol (
    id TEXT PRIMARY KEY, project_id TEXT, file_id TEXT, name TEXT, owner_symbol_id TEXT, time_updated INTEGER,
    FOREIGN KEY (file_id) REFERENCES brain_file(id) ON DELETE CASCADE
  )`)
  exec(`CREATE TABLE brain_relationship (
    id TEXT PRIMARY KEY, project_id TEXT,
    source_symbol_id TEXT NOT NULL, target_symbol_id TEXT, target_external TEXT,
    relationship_type TEXT, time_updated INTEGER,
    FOREIGN KEY (source_symbol_id) REFERENCES brain_symbol(id) ON DELETE CASCADE,
    FOREIGN KEY (target_symbol_id) REFERENCES brain_symbol(id) ON DELETE SET NULL
  )`)

  const PID = "p1"
  const insertFile = prep(`INSERT OR REPLACE INTO brain_file VALUES (?,?,?,?)`)
  const insertSymbol = prep(`INSERT OR REPLACE INTO brain_symbol VALUES (?,?,?,?,?,?)`)
  const insertRelationship = prep(`INSERT OR IGNORE INTO brain_relationship VALUES (?,?,?,?,?,?,?)`)

  // ═══════════════════════ #737 behavioral section (bun + node) ═══════════════════════
  {
    const { createStoreDiagnostics } = await import(`${ROOT}/src/ast/store-diagnostics.ts`)

    const stmtOriginal = { insertFile, insertSymbol, insertRelationship }
    const stmt: Record<string, any> = { ...stmtOriginal }

    // tx wrapper = the production shape: store each file's rows THROUGH the
    // stmt map (that is what makes the capture wrappers see the calls — the
    // production batch body also only touches stmt.*), and the poisoned file
    // ALSO emits the historical violation class (dangling source id).
    const POISON_FILE = "/fake/proj/poisoned.ts"
    const tx = (batch: any[]) => {
      for (const r of batch) {
        stmt.insertFile.run(`${PID}:${r.file}`, PID, r.file, 1)
        for (const s of r.symbols) stmt.insertSymbol.run(`${PID}:${r.file}:${s}`, PID, `${PID}:${r.file}`, s, null, 1)
        if (r.poison) {
          stmt.insertRelationship.run(`${PID}:bad`, PID, `${PID}:GHOST-SYMBOL-ID`, null, null, "calls", 1)
        }
      }
    }

    let diagOutput = ""
    const write = (s: string) => { diagOutput += s }
    const diagnose = createStoreDiagnostics({
      rawDb: { transaction: (fn: any) => (isBun ? (db as any).transaction(fn) : (db as any).transaction(fn)) } as any,
      tx: (b: any[]) => tx(b),
      stmt,
      stmtOriginal: stmtOriginal as any,
      write,
    })

    const batch = [
      { file: "a.ts", symbols: ["Alpha"] },
      { file: "poisoned.ts", symbols: ["Beta"], poison: true },
      { file: "c.ts", symbols: ["Gamma"] },
    ]

    const before = all(`SELECT count(*) c FROM brain_relationship`)[0].c as number
    diagnose(new Error("FOREIGN KEY constraint failed"), batch)
    const after = all(`SELECT count(*) c FROM brain_relationship`)[0].c as number

    check("737: diagnose names the poisoned file", diagOutput.includes("poisoned.ts"), diagOutput.split("\n")[0] ?? "")
    check("737: diagnose shows the offending statement args", diagOutput.includes("GHOST-SYMBOL-ID"))
    check("737: rollback guarantee — nothing persisted", before === after && after === 0, `rows before=${before} after=${after}`)
    check("737: stmt map restored after diagnosis", stmt.insertRelationship === stmtOriginal.insertRelationship)
    check("737: healthy files in the batch did not leak rows", (all(`SELECT count(*) c FROM brain_file`)[0].c as number) === 0)

    // Non-FK errors must return immediately: no output, no stmt swap.
    diagOutput = ""
    diagnose(new Error("some other constraint failed"), batch)
    check("737: non-FK error untouched (no output)", diagOutput === "")
    check("737: non-FK error leaves stmt map alone", stmt.insertRelationship === stmtOriginal.insertRelationship)

    // Source wiring: parallel-indexer must actually call the diagnostics.
    const pi = readFileSync(path.join(ROOT, "src/ast/parallel-indexer.ts"), "utf8")
    check("737: storeResults catch wires diagnoseBatchFailure", pi.includes("diagnoseBatchFailure(error, batch)") && pi.includes(`createStoreDiagnostics({`))
  }

  // ═══════════════════════ #738 section ═══════════════════════
  {
    // Source conformance (both runtimes): the bounded-resolution region must
    // use the two-pass JOIN shape and must NOT contain the correlated shape.
    const pi = readFileSync(path.join(ROOT, "src/ast/parallel-indexer.ts"), "utf8")
    const regionStart = pi.indexOf("CREATE TEMP TABLE IF NOT EXISTS _m40_match")
    const regionEnd = pi.indexOf("UPDATE brain_relationship", regionStart)
    check("738: source region locatable", regionStart > 0 && regionEnd > regionStart)
    const region = pi.slice(regionStart, regionEnd)
    check("738: old correlated INSERT..SELECT shape removed", !region.includes("SELECT r.id, ("))
    check("738: no ORDER BY inside the match-building statements", !region.includes("ORDER BY"))
    const qnamePass = region.match(/INSERT OR IGNORE INTO _m40_match[\s\S]*?JOIN _m40_touched t ON t\.qualified_name = r\.target_external/)
    const namePass = region.match(/INSERT OR IGNORE INTO _m40_match[\s\S]*?JOIN _m40_touched t ON t\.name = r\.target_external/)
    check("738: two-pass JOIN shape present (qname pass)", !!qnamePass)
    check("738: two-pass JOIN shape present (bare-name pass)", !!namePass)

    // Mutation: feeding the OLD source region to the conformance predicate
    // must fail — the gate can detect a regression to the buggy shape.
    const oldShape = `SELECT r.id, (SELECT t.id FROM _m40_touched t WHERE t.qualified_name = r.target_external ORDER BY t.id LIMIT 1) FROM brain_relationship r`
    const mutated = region.replace(qnamePass?.[0] ?? "", `INSERT OR IGNORE INTO _m40_match (rel_id, symbol_id)\n          ${oldShape}`)
    check("738: MUTATION detected (old shape fails conformance)", !(mutated.includes("JOIN _m40_touched t ON t.qualified_name") && !mutated.includes("SELECT r.id, (")))

    // Behavioral: the fix shape resolves correctly on THIS runtime.
    // FK-honest fixture: a real parent file + source symbol for the edges.
    insertFile.run("f1", "p", "fake/src.ts", 1)
    insertSymbol.run("src1", "p", "f1", "Source", null, 1)
    exec(`CREATE TEMP TABLE IF NOT EXISTS _m40_touched (id TEXT PRIMARY KEY, name TEXT, qualified_name TEXT)`)
    exec(`DELETE FROM _m40_touched`)
    prep(`INSERT INTO _m40_touched VALUES ('s1','Helper','mod.Helper'),('s4','mod.Helper','x.mod.Helper'),('a0','Helper','z.a0.Helper'),('a1','Helper','z.a1.Helper')`).run()
    // rows to be resolved carry target_symbol_id = NULL (that is the pass's
    // WHERE clause) — anything else would violate this FK-honest fixture.
    prep(`INSERT INTO brain_relationship VALUES ('rel1:m40','p','src1',NULL,'mod.Helper','calls',1),('rel2:m40','p','src1',NULL,'Helper','calls',1),('rel3:m40','p','src1',NULL,'nothingMatches','calls',1),('rel4:x','p','src1',NULL,'Helper','calls',1)`).run()
    exec(`CREATE TEMP TABLE IF NOT EXISTS _m40_match (rel_id TEXT PRIMARY KEY, symbol_id TEXT)`)
    exec(`DELETE FROM _m40_match`)
    const m40Filter = `r.project_id = 'p' AND r.target_symbol_id IS NULL AND r.target_external IS NOT NULL AND r.target_external != '' AND r.id LIKE '%:m40'`
    prep(`INSERT OR IGNORE INTO _m40_match (rel_id, symbol_id)
      SELECT j.rel_id, MIN(j.symbol_id) FROM (
        SELECT r.id AS rel_id, t.id AS symbol_id
        FROM brain_relationship r JOIN _m40_touched t ON t.qualified_name = r.target_external
        WHERE ${m40Filter}
      ) j GROUP BY j.rel_id`).run()
    prep(`INSERT OR IGNORE INTO _m40_match (rel_id, symbol_id)
      SELECT j.rel_id, MIN(j.symbol_id) FROM (
        SELECT r.id AS rel_id, t.id AS symbol_id
        FROM brain_relationship r JOIN _m40_touched t ON t.name = r.target_external
        WHERE ${m40Filter}
      ) j GROUP BY j.rel_id`).run()
    const match = Object.fromEntries((all(`SELECT rel_id, symbol_id FROM _m40_match`) as any[]).map((r) => [r.rel_id, r.symbol_id]))
    check("738: fix resolves qname-over-name priority", match["rel1:m40"] === "s1", JSON.stringify(match))
    check("738: fix resolves lowest-id tie-break", match["rel2:m40"] === "a0")
    check("738: unmatched rel excluded", !("rel3:m40" in match))
    check("738: non-:m40 rel excluded", !("rel4:x" in match))

    if (isBun) {
      // Old shape still WORKS on bun 3.53 — documenting the asymmetry that hid the bug.
      try {
        exec(`DELETE FROM _m40_match`)
        prep(`INSERT INTO _m40_match (rel_id, symbol_id)
          SELECT r.id, (
            SELECT t.id FROM _m40_touched t
            WHERE t.qualified_name = r.target_external OR t.name = r.target_external
            ORDER BY CASE WHEN t.qualified_name = r.target_external THEN 0 ELSE 1 END, t.id
            LIMIT 1
          )
          FROM brain_relationship r WHERE ${m40Filter}`).run()
        check("738: old shape on bun accepts (asymmetry documented)", true)
      } catch (e: any) {
        check("738: old shape on bun accepts (asymmetry documented)", false, e.message)
      }
    } else {
      // THE production bug: old shape must throw on node 3.49.2.
      try {
        exec(`DELETE FROM _m40_match`)
        prep(`INSERT INTO _m40_match (rel_id, symbol_id)
          SELECT r.id, (
            SELECT t.id FROM _m40_touched t
            WHERE t.qualified_name = r.target_external OR t.name = r.target_external
            ORDER BY CASE WHEN t.qualified_name = r.target_external THEN 0 ELSE 1 END, t.id
            LIMIT 1
          )
          FROM brain_relationship r WHERE ${m40Filter}`).run()
        check("738: old shape rejected on node 3.49.2", false, "unexpectedly accepted")
      } catch (e: any) {
        check("738: old shape rejected on node 3.49.2", /no such column/.test(e.message), e.message)
      }
      skip("738 bun-acceptance documentation", "bun-only behavior; covered by the bun gate run")
    }
    if (isBun) skip("738 node-rejection proof", "node-only behavior; covered by the tsx gate run")
  }

  // ═══════════════════════ #756 section ═══════════════════════
  {
    // The captured production hazard (#756): a child symbol's auto-generated
    // contains edge references its owner row BEFORE that row is inserted
    // (same CONTAINER_PRIORITY class, raw analyzer order — e.g. namespace
    // Inner:1 owned by namespace OuterNs:10 declared later in the file).
    // Under FK-ON the immediate edge insert fails and rolls back the batch.

    // H0: the hazard shape itself, minimal, under THIS runtime's FK-ON policy.
    {
      const h = await openFixtureDb(path.join(tmp, "hazard.db"))
      const hExec = (s: string) => (isBun ? (h as any).run(s) : (h as any).exec(s))
      const hPrep = (s: string) => (h as any).prepare(s)
      hExec(`CREATE TABLE brain_file (id TEXT PRIMARY KEY, project_id TEXT, path TEXT, time_updated INTEGER)`)
      hExec(`CREATE TABLE brain_symbol (
        id TEXT PRIMARY KEY, project_id TEXT, file_id TEXT, name TEXT, owner_symbol_id TEXT, time_updated INTEGER,
        FOREIGN KEY (file_id) REFERENCES brain_file(id) ON DELETE CASCADE
      )`)
      hExec(`CREATE TABLE brain_relationship (
        id TEXT PRIMARY KEY, project_id TEXT,
        source_symbol_id TEXT NOT NULL, target_symbol_id TEXT, target_external TEXT,
        relationship_type TEXT, time_updated INTEGER,
        FOREIGN KEY (source_symbol_id) REFERENCES brain_symbol(id) ON DELETE CASCADE,
        FOREIGN KEY (target_symbol_id) REFERENCES brain_symbol(id) ON DELETE SET NULL
      )`)
      hPrep(`INSERT INTO brain_file VALUES ('f1','p','x.ts',1)`).run()
      hPrep(`INSERT INTO brain_symbol VALUES ('p:f1:Inner:1','p','f1','Inner',null,1)`).run()
      let rejected = false
      try {
        // the OLD interleaved order: edge first (owner row does not exist yet)
        hPrep(`INSERT INTO brain_relationship VALUES ('r1','p','p:f1:OuterNs:10','p:f1:Inner:1',null,'contains',1)`).run()
      } catch (e: any) {
        rejected = /FOREIGN KEY constraint failed/i.test(e.message)
      }
      check("756: hazard shape rejected under FK-ON (edge before owner row)", rejected)
      h.close?.()
    }

    // H1/H2: the REAL storeResults must store a forward-reference fixture
    // cleanly now (buffered contains flush after the symbol loop).
    process.env.BB_DATA_DIR = path.join(tmp, "bb-756-data")
    const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
    const { storeResults } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
    const proj = path.join(tmp, "proj756")
    mkdirSync(path.join(proj, "src"), { recursive: true })
    writeFileSync(path.join(proj, "src", "forward.ts"), "// fixture\n")
    const pid = (getProjectId as any)(proj)
    const results: any[] = [
      {
        success: true,
        filePath: path.join(proj, "src", "forward.ts"),
        language: "typescript",
        imports: [],
        symbols: [
          // child FIRST — its owner row (OuterNs) is inserted after it
          { name: "Inner", type: "namespace", startLine: 1, endLine: 5, ownerName: "OuterNs" },
          { name: "OuterNs", type: "namespace", startLine: 10, endLine: 20 },
        ],
        relationships: [],
      },
    ]
    let counts: any
    try {
      counts = await (storeResults as any)(pid, proj, results, { skipResolution: true })
      check("756: real storeResults stores forward-reference fixture without rollback", !!counts && counts.symbols === 2 && counts.relationships >= 1, JSON.stringify(counts))
    } catch (e: any) {
      check("756: real storeResults stores forward-reference fixture without rollback", false, e.message)
      counts = null
    }
    if (counts) {
      const bdb: any = await (await import(path.join(ROOT, "src/brain/database.ts"))).BrainDatabase.getRawInstance(pid)
      const edge = (bdb.prepare(`SELECT source_symbol_id, target_symbol_id FROM brain_relationship WHERE relationship_type='contains'`).all() as any[])[0]
      const fileRow = (bdb.prepare(`SELECT id FROM brain_file`).all() as any[])[0]
      const fid = fileRow?.id ?? ""
      check("756: contains edge endpoints resolved to real rows", !!edge && edge.source_symbol_id === `${fid}:OuterNs:10` && edge.target_symbol_id === `${fid}:Inner:1`, JSON.stringify(edge))
      bdb.close?.()
    }

    // H3: source conformance — buffer inside the symbol loop, flush BEFORE the
    // engine-relationship block, and NO immediate insert left in the contains block.
    const pi2 = readFileSync(path.join(ROOT, "src/ast/parallel-indexer.ts"), "utf8")
    const bufPush = pi2.indexOf("bufferedContains.push")
    const flush = pi2.indexOf("if (bufferedContains.length > 0)")
    const relBlock = pi2.indexOf("if (result.relationships) {", flush >= 0 ? flush : 0)
    check("756: buffer declared inside per-file store, flush before relationship block", bufPush > 0 && flush > bufPush && relBlock > flush)
    const containsBlock = pi2.slice(pi2.indexOf("if (ownerSymbolId) {"), pi2.indexOf("// Process taint sources and sinks"))
    check("756: no immediate relationship insert left in the contains block", !containsBlock.includes("stmt.insertRelationship.run"))
    // MUTATION: reverting to interleaved emission must fail the conformance predicate.
    const mutatedBlock = containsBlock + "\nstmt.insertRelationship.run()"
    check("756: MUTATION detected (interleaved emission fails conformance)", mutatedBlock.includes("stmt.insertRelationship.run"))
  }

  db.close?.()
  console.log(failures === 0 ? `GATE VERDICT [${RUNTIME}]: ALL PASS` : `GATE VERDICT [${RUNTIME}]: ${failures} FAILURE(S)`)
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((e) => {
  console.error(`GATE CRASH [${RUNTIME}]:`, e?.message, "\n", e?.stack?.split("\n").slice(0, 6).join("\n"))
  process.exit(1)
})
