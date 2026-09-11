// script/m54/probe-738-sqlite.ts — #738 root-cause + fix-equivalence probe.
//
// PART 1 (root cause): the M40 bounded-resolution statement shape
// (parallel-indexer.ts ~4035) references outer-query column r.target_external
// inside the subquery's ORDER BY. Node's better-sqlite3 bundles SQLite 3.49.2,
// which REJECTS that reference ("no such column: r.target_external"); bun's
// 3.53.0 accepts it. Production `bin/bb` runs under node -> every real CLI
// index failed the bounded relationship-resolution phase (index "partial").
// All prior verifier gates ran under bun, which is how this survived.
//
// PART 2 (fix equivalence): the replacement — two-pass JOIN + INSERT OR IGNORE,
// no correlated subquery — must produce IDENTICAL _m40_match rows on BOTH
// runtimes, including qname-priority-over-name and lowest-t.id tie-break cases.
//
// Run under BOTH runtimes:  npx tsx script/m54/probe-738-sqlite.ts   (node 3.49.2)
//                           bun run script/m54/probe-738-sqlite.ts   (bun 3.53.0)

export {}

async function main() {
  const isBun = typeof (globalThis as any).Bun !== "undefined"
  let version = ""
  const db = isBun
    ? await (async () => {
        const { Database } = await import("bun:sqlite")
        const d = new Database(":memory:")
        version = d.query("select sqlite_version() v").get().v
        return { run: (s: string) => d.run(s), prepare: (s: string) => d.prepare(s) }
      })()
    : await (async () => {
        const Database = (await import("better-sqlite3")).default
        const d = new Database(":memory:")
        version = d.prepare("select sqlite_version() v").get().v
        return { run: (s: string) => d.exec(s), prepare: (s: string) => d.prepare(s) }
      })()

  console.log(`runtime=${isBun ? "bun" : "node"} sqlite=${version}`)
  let failures = 0
  const check = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`)
    if (!ok) failures++
  }

  db.run(`CREATE TABLE brain_relationship (
    id TEXT PRIMARY KEY, project_id TEXT, target_symbol_id TEXT, target_external TEXT, relationship_type TEXT
  )`)
  db.run(`CREATE TEMP TABLE _m40_touched (id TEXT PRIMARY KEY, name TEXT, qualified_name TEXT)`)
  db.run(`CREATE TEMP TABLE _m40_match (rel_id TEXT PRIMARY KEY, symbol_id TEXT)`)

  // rel1: qname match AND a name match exist -> qname must win (s1, not s4)
  // rel2: two bare-name candidates -> lowest t.id must win (a0, not a1)
  // rel3: no match anywhere -> must stay absent from _m40_match
  // rel4: matches, but id lacks the :m40 suffix -> must be excluded
  db.prepare(`INSERT INTO brain_relationship VALUES
    ('rel1:m40','p',NULL,'mod.Helper','calls'),
    ('rel2:m40','p',NULL,'Helper','calls'),
    ('rel3:m40','p',NULL,'nothingMatchesThis','calls'),
    ('rel4:x','p',NULL,'Helper','calls')`).run()
  db.prepare(`INSERT INTO _m40_touched VALUES
    ('s1','Helper','mod.Helper'),
    ('s4','mod.Helper','x.mod.Helper'),
    ('a0','Helper','z.a0.Helper'),
    ('a1','Helper','z.a1.Helper')`).run()

  // Expected resolution (old-shape semantics): qname priority, then lowest t.id.
  const expected = { "rel1:m40": "s1", "rel2:m40": "a0" }

  const m40Where = `FROM brain_relationship r
    WHERE r.project_id = 'p' AND r.target_symbol_id IS NULL
      AND r.target_external IS NOT NULL AND r.target_external != '' AND r.id LIKE '%:m40'`

  // === PART 1: the shipped M40 shape (runtime-aware expectation) ===
  // node 3.49.2: MUST throw "no such column" (the production bug being proven)
  // bun 3.53.0:  MUST resolve {rel1→s1, rel2→a0} — but also inserts a NULL row
  //              for unmatched rel3 (harmless downstream: the UPDATE guards
  //              symbol_id IS NOT NULL; the fix simply omits it — cleaner).
  let oldRows: Record<string, string> | null = null
  try {
    db.run(`DELETE FROM _m40_match`)
    ;(db.prepare(`
      INSERT INTO _m40_match (rel_id, symbol_id)
      SELECT r.id, (
        SELECT t.id FROM _m40_touched t
        WHERE t.qualified_name = r.target_external OR t.name = r.target_external
        ORDER BY CASE WHEN t.qualified_name = r.target_external THEN 0 ELSE 1 END, t.id
        LIMIT 1
      )
      ${m40Where}
    `) as any).run()
    oldRows = Object.fromEntries(((db.prepare(`SELECT rel_id, symbol_id FROM _m40_match`) as any).all() as any[]).map((r) => [r.rel_id, r.symbol_id]))
    const effective = Object.fromEntries(Object.entries(oldRows).filter(([, v]) => v !== null))
    if (isBun) {
      check("M40 shipped shape (bun): effective resolution", JSON.stringify(effective) === JSON.stringify(expected), JSON.stringify(oldRows))
    } else {
      check("M40 shipped shape (node): resolves WITHOUT error", false, `unexpected success: ${JSON.stringify(oldRows)}`)
    }
  } catch (e: any) {
    if (isBun) {
      check("M40 shipped shape (bun): resolves without error", false, e.message)
    } else {
      check("M40 shipped shape (node): throws 'no such column'", /no such column/.test(e.message), e.message)
    }
  }
  const oldEffective = oldRows ? Object.fromEntries(Object.entries(oldRows).filter(([, v]) => v !== null)) : null

  // === PART 2: the fix shape (two-pass JOIN + INSERT OR IGNORE) ===
  const runFix = (): Record<string, string> => {
    db.run(`DELETE FROM _m40_match`)
    const passA = `SELECT r.id AS rel_id, t.id AS symbol_id FROM brain_relationship r
      JOIN _m40_touched t ON t.qualified_name = r.target_external
      WHERE r.project_id = 'p' AND r.target_symbol_id IS NULL
        AND r.target_external IS NOT NULL AND r.target_external != '' AND r.id LIKE '%:m40'`
    const passB = passA.replace("t.qualified_name = r.target_external", "t.name = r.target_external")
    ;(db.prepare(`INSERT OR IGNORE INTO _m40_match (rel_id, symbol_id)
      SELECT j.rel_id, MIN(j.symbol_id) FROM (${passA}) j GROUP BY j.rel_id`) as any).run()
    ;(db.prepare(`INSERT OR IGNORE INTO _m40_match (rel_id, symbol_id)
      SELECT j.rel_id, MIN(j.symbol_id) FROM (${passB}) j GROUP BY j.rel_id`) as any).run()
    return Object.fromEntries(((db.prepare(`SELECT rel_id, symbol_id FROM _m40_match`) as any).all() as any[]).map((r) => [r.rel_id, r.symbol_id]))
  }
  let fixRows: Record<string, string>
  try {
    fixRows = runFix()
    check("FIX shape: executes", JSON.stringify(fixRows) === JSON.stringify(expected), JSON.stringify(fixRows))
  } catch (e: any) {
    check("FIX shape: executes", false, e.message)
    fixRows = {}
  }

  // Equivalence: on bun (where the old shape works), the fix's EFFECTIVE map
  // (non-null entries — what actually reaches target_symbol_id) must equal the
  // old shape's effective map.
  if (isBun && oldEffective) {
    const fixEffective = Object.fromEntries(Object.entries(fixRows).filter(([, v]) => v !== null))
    check("bun equivalence: fix == old (effective)", JSON.stringify(fixEffective) === JSON.stringify(oldEffective))
  }
  // On node, the fix must produce exactly the rows bun's old shape produces
  // (verified across the two runs by comparing against the same `expected`).

  console.log(failures === 0 ? "PROBE VERDICT: ALL PASS" : `PROBE VERDICT: ${failures} FAILURE(S)`)
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((e) => { console.error("PROBE CRASH:", e?.message); process.exit(1) })
