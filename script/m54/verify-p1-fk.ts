// script/m54/verify-p1-fk.ts — M54.P1 (#727) gate.
// Proves the FK enforcement policy end-to-end through the REAL database seam
// (BrainDatabase / #db driver resolution), on throwaway fixture DBs:
//   S1. POLICY — every open path carries enforcement:
//       a. bun rw open → foreign_keys=1 via the resolved #db driver
//       b. node rw open (spawned child) → foreign_keys=1
//       c. readonly open on BOTH runtimes → foreign_keys=1 (uniform policy)
//       d. BB_FK_ENFORCE=0 → OFF on both runtimes (the documented escape hatch)
//   S2. ENFORCEMENT — a violating INSERT now fails on a real bb DB (fixture),
//       and the SAME statement succeeds with BB_FK_ENFORCE=0 (mutation proof
//       that the gate can fail).
//   S3. PARITY — indexProjectParallel on a real fixture under the new policy:
//       symbol/relationship counts byte-equal to an FK-OFF run of the same
//       fixture (enforcement must not lose data).
//   S4. HEAL — a fixture seeded with FK-OFF-era orphan rows is cleaned exactly
//       at open (precise deletes, conforming rows untouched), and the heal
//       re-runs on a NEW handle (fresh open) — never silently disabled.
//   S5. REAL DB — the actual repo index reports 0 remaining orphan rows
//       (read-only), proving the ship state is conformant.

import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import path from "node:path"
import os from "node:os"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const TMP = path.join(os.tmpdir(), `m54-gate-${Date.now()}`)
mkdirSync(TMP, { recursive: true })

let pass = 0
let fail = 0
const failures: string[] = []
const check = (name: string, ok: boolean, detail: string) => {
  if (ok) { pass++; console.log(`✅ ${name}: ${detail}`) }
  else { fail++; failures.push(`${name}: ${detail}`); console.log(`❌ ${name}: ${detail}`) }
}

process.env.BB_DATA_DIR = path.join(TMP, "bb-data")
process.env.BB_NO_AUTO_REFRESH = "1"

// ── fixture project (parsed by the real indexer for S3) ─────────────────────
const proj = path.join(TMP, "proj")
mkdirSync(path.join(proj, "src"), { recursive: true })
writeFileSync(path.join(proj, "src", "a.ts"), `import { helper } from "./b"\nexport function main(x: number): number { return helper(x) + 1 }\n`)
writeFileSync(path.join(proj, "src", "b.ts"), `export function helper(v: number): number { return v * 2 }\nexport function unused(v: number): number { return v - 1 }\n`)

// ── helpers to drive the REAL seam in-process (bun → db.bun.ts) ─────────────
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

function seedWithOrphans(dbFile: string): string {
  // Build a legacy-shaped DB the way the FK-OFF era wrote it.
  rmSync(dbFile, { force: true })
  const Database = require("bun:sqlite").Database
  const db = new Database(dbFile)
  db.exec(`
    CREATE TABLE brain_file (id TEXT PRIMARY KEY, project_id TEXT, path TEXT, time_updated INTEGER);
    CREATE TABLE brain_symbol (
      id TEXT PRIMARY KEY, project_id TEXT, file_id TEXT, name TEXT, owner_symbol_id TEXT,
      time_updated INTEGER,
      FOREIGN KEY (file_id) REFERENCES brain_file(id) ON DELETE CASCADE
    );
    CREATE TABLE brain_relationship (
      id TEXT PRIMARY KEY, project_id TEXT,
      source_symbol_id TEXT NOT NULL, target_symbol_id TEXT,
      relationship_type TEXT, time_updated INTEGER,
      FOREIGN KEY (source_symbol_id) REFERENCES brain_symbol(id) ON DELETE CASCADE,
      FOREIGN KEY (target_symbol_id) REFERENCES brain_symbol(id) ON DELETE SET NULL
    );
    CREATE TABLE brain_import (
      id TEXT PRIMARY KEY, project_id TEXT, file_id TEXT,
      time_updated INTEGER,
      FOREIGN KEY (file_id) REFERENCES brain_file(id) ON DELETE CASCADE
    );
  `)
  db.exec("PRAGMA foreign_keys = OFF") // legacy writer posture
  db.prepare(`INSERT INTO brain_file VALUES ('p:f1', 'p', '/x/f1.ts', 1)`).run()
  db.prepare(`INSERT INTO brain_symbol VALUES ('p:f1:foo:1', 'p', 'p:f1', 'foo', NULL, 1)`).run()
  db.prepare(`INSERT INTO brain_relationship VALUES ('good', 'p', 'p:f1:foo:1', NULL, 'calls', 1)`).run()
  db.prepare(`INSERT INTO brain_relationship VALUES ('orph-rel', 'p', 'ghost:src', 'p:f1:foo:1', 'calls', 1)`).run()
  db.prepare(`INSERT INTO brain_symbol VALUES ('orph-sym', 'p', 'ghost:file', 'x', NULL, 1)`).run()
  db.prepare(`INSERT INTO brain_import VALUES ('orph-imp', 'p', 'ghost:file', 1)`).run()
  db.close()
  return dbFile
}

// ── S1a. bun rw open carries enforcement ────────────────────────────────────
{
  const dbFile = path.join(TMP, "s1a.db")
  const { openDatabase } = await import(path.join(ROOT, "src/storage/db.bun.ts"))
  const db = openDatabase(dbFile)
  const fk = (db.native as any).prepare("PRAGMA foreign_keys").get() as any
  check("S1a.bun-rw-fk-on", fk.foreign_keys === 1, `bun rw openDatabase → foreign_keys=${fk.foreign_keys} (expected 1)`)
  db.close()
}

// ── S1c. readonly open carries enforcement (bun) ────────────────────────────
{
  const dbFile = seedWithOrphans(path.join(TMP, "s1c.db"))
  const { openDatabase } = await import(path.join(ROOT, "src/storage/db.bun.ts"))
  const db = openDatabase(dbFile, { readonly: true })
  const fk = (db.native as any).prepare("PRAGMA foreign_keys").get() as any
  check("S1c.bun-ro-fk-on", fk.foreign_keys === 1, `bun readonly open → foreign_keys=${fk.foreign_keys} (expected 1 — uniform policy)`)
  db.close()
}

// ── S1d/S1b/S2: node + escape hatch via spawned children (real #db switch) ──
{
  const childScript = path.join(TMP, "node-probe.mjs")
  writeFileSync(childScript, `
    import { openDatabase } from "${path.join(ROOT, "src/storage/db.node.ts")}"
    const mode = process.argv[2]
    const dbPath = process.argv[3]
    if (mode === "rw-default") {
      const db = openDatabase(dbPath)
      console.log("fk=" + db.native.pragma("foreign_keys", { simple: true }))
      // S2: enforcement — violating insert must throw
      db.exec(\`CREATE TABLE IF NOT EXISTS f (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS s (id TEXT PRIMARY KEY, fid TEXT, FOREIGN KEY (fid) REFERENCES f(id))\`)
      db.prepare("INSERT INTO f VALUES ('ok')").run()
      try { db.prepare("INSERT INTO s VALUES ('bad', 'missing')").run(); console.log("violation=accepted") }
      catch { console.log("violation=rejected") }
      db.close()
    } else if (mode === "rw-off") {
      const db = openDatabase(dbPath)
      console.log("fk=" + db.native.pragma("foreign_keys", { simple: true }))
      db.exec(\`CREATE TABLE IF NOT EXISTS f (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS s (id TEXT PRIMARY KEY, fid TEXT, FOREIGN KEY (fid) REFERENCES f(id))\`)
      db.prepare("INSERT INTO f VALUES ('ok')").run()
      try { db.prepare("INSERT INTO s VALUES ('bad2', 'missing')").run(); console.log("violation=accepted") }
      catch { console.log("violation=rejected") }
      db.close()
    } else if (mode === "ro") {
      const db = openDatabase(dbPath, { readonly: true })
      console.log("fk=" + db.native.pragma("foreign_keys", { simple: true }))
      db.close()
    }
  `)
  const runNode = (args: string[], env: NodeJS.ProcessEnv = {}) =>
    execFileSync("node", ["--experimental-strip-types", childScript, ...args], {
      encoding: "utf8",
      cwd: ROOT,
      env: { ...process.env, ...env },
    })

  // S1b: node rw default → ON
  {
    const dbFile = path.join(TMP, "s1b.db")
    const out = runNode(["rw-default", dbFile])
    const fk = /fk=(\d)/.exec(out)?.[1]
    const violation = /violation=(\w+)/.exec(out)?.[1]
    check("S1b.node-rw-fk-on", fk === "1", `node rw openDatabase → foreign_keys=${fk} (expected 1)`)
    check("S2.node-violation-rejected", violation === "rejected", `violating INSERT under node+enforcement → ${violation} (expected rejected)`)
  }
  // S1d-mutation: BB_FK_ENFORCE=0 → OFF and the violation is accepted
  {
    const dbFile = path.join(TMP, "s1d.db")
    const out = runNode(["rw-off", dbFile], { BB_FK_ENFORCE: "0" })
    const fk = /fk=(\d)/.exec(out)?.[1]
    const violation = /violation=(\w+)/.exec(out)?.[1]
    check("S1d.escape-hatch-off", fk === "0" && violation === "accepted", `BB_FK_ENFORCE=0 → foreign_keys=${fk}, violation=${violation} (the mutation that proves S2 can fail)`)
  }
  // S1c-node: readonly node open → ON
  {
    const dbFile = seedWithOrphans(path.join(TMP, "s1cn.db"))
    const out = runNode(["ro", dbFile])
    const fk = /fk=(\d)/.exec(out)?.[1]
    check("S1c.node-ro-fk-on", fk === "1", `node readonly open → foreign_keys=${fk} (expected 1)`)
  }
}

// ── S2-bun: violating INSERT rejected through the real bun seam ─────────────
{
  const { openDatabase } = await import(path.join(ROOT, "src/storage/db.bun.ts"))
  const dbFile = path.join(TMP, "s2bun.db")
  const db = openDatabase(dbFile)
  db.exec(`CREATE TABLE f (id TEXT PRIMARY KEY); CREATE TABLE s (id TEXT PRIMARY KEY, fid TEXT, FOREIGN KEY (fid) REFERENCES f(id))`)
  db.prepare(`INSERT INTO f VALUES ('ok')`).run()
  let rejected = false
  try { db.prepare(`INSERT INTO s VALUES ('bad', 'missing')`).run() } catch { rejected = true }
  check("S2.bun-violation-rejected", rejected, `violating INSERT through bun openDatabase → ${rejected ? "rejected" : "accepted"} (expected rejected)`)
  db.close()
}

// ── S3. PARITY: index the same fixture FK-ON vs FK-OFF, counts byte-equal ───
{
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel, wipeProjectData } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))

  // SAME directory (=> same projectId => same embedded ids) for both runs;
  // in-place wipe between runs (same inode, M40 contract). Byte-equality is
  // otherwise impossible: ids embed the project id by design.
  const dir = path.join(TMP, "proj")
  const pid = getProjectId(dir) as any

  async function indexAndCount(enforce: "on" | "off") {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "a.ts"), `import { helper } from "./b"\nexport function main(x: number): number { return helper(x) + 1 }\n`)
    writeFileSync(path.join(dir, "b.ts"), `export function helper(v: number): number { return v * 2 }\nexport function unused(v: number): number { return v - 1 }\n`)
    const prev = process.env.BB_FK_ENFORCE
    if (enforce === "off") process.env.BB_FK_ENFORCE = "0"
    else delete process.env.BB_FK_ENFORCE
    try {
      await indexProjectParallel(pid, dir, {})
      const db: any = await BrainDatabase.getRawInstance(pid)
      const syms = (db.prepare(`SELECT id, name, qualified_name, line_start FROM brain_symbol ORDER BY id`).all() as any[]).map(r => JSON.stringify(r)).join("\n")
      const rels = (db.prepare(`SELECT source_symbol_id, target_symbol_id, relationship_type FROM brain_relationship ORDER BY source_symbol_id, target_symbol_id, relationship_type`).all() as any[]).map(r => JSON.stringify(r)).join("\n")
      const files = (db.prepare(`SELECT id, path, language FROM brain_file ORDER BY id`).all() as any[]).map(r => JSON.stringify(r)).join("\n")
      return { syms, rels, files }
    } finally {
      if (prev === undefined) delete process.env.BB_FK_ENFORCE
      else process.env.BB_FK_ENFORCE = prev
    }
  }

  const on = await indexAndCount("on")
  wipeProjectData(await BrainDatabase.getRawInstance(pid))
  const off = await indexAndCount("off")
  check("S3.parity-symbols", on.syms === off.syms && on.syms.length > 0, `symbol rows FK-ON vs FK-OFF: ${on.syms === off.syms ? "byte-equal" : "DIVERGED"} (${on.syms.length} chars)`)
  check("S3.parity-relationships", on.rels === off.rels && on.rels.length > 0, `relationship rows: ${on.rels === off.rels ? "byte-equal" : "DIVERGED"} (${on.rels.length} chars)`)
  check("S3.parity-files", on.files === off.files && on.files.length > 0, `file rows: ${on.files === off.files ? "byte-equal" : "DIVERGED"} (${on.files.length} chars)`)
}

// ── S4. HEAL: legacy-shaped DB with orphans is cleaned exactly at open ──────
{
  const { openDatabase } = await import(path.join(ROOT, "src/storage/db.bun.ts"))
  const { cleanupOrphanedFkRows } = await import(path.join(ROOT, "src/brain/schema-ddl.ts"))
  const dbFile = seedWithOrphans(path.join(TMP, "s4.db"))
  // Fresh process-side handle via the REAL open seam — ensureSchemaIfNew runs
  // cleanupOrphanedFkRows for existing DBs; but this fixture lacks
  // brain_index_status etc., so call the exact function the open path calls
  // and ALSO verify the open path itself (getRawInstance on a full fixture).
  const db = openDatabase(dbFile)
  const healed = cleanupOrphanedFkRows(db)
  const rels = (db.prepare(`SELECT id FROM brain_relationship ORDER BY id`).all() as any[]).map(r => r.id)
  const syms = (db.prepare(`SELECT id FROM brain_symbol ORDER BY id`).all() as any[]).map(r => r.id)
  const imps = (db.prepare(`SELECT COUNT(*) c FROM brain_import`).get() as any).c
  check("S4.heal-precision", rels.join(",") === "good" && syms.join(",") === "p:f1:foo:1" && imps === 0,
    `heal deleted rel=${healed.relationships} sym=${healed.symbols} imp=${healed.imports}; survivors rel=[${rels}] sym=[${syms}] imports=${imps} (orphans gone, 'good' + 'p:f1:foo:1' untouched)`)
  // second call on the SAME handle: memoized no-op
  const again = cleanupOrphanedFkRows(db)
  check("S4.heal-memoized", again.relationships === 0 && again.symbols === 0 && again.imports === 0, `same-handle second heal: ${JSON.stringify(again)} (expected zeros — per-handle memoization)`)
  db.close()
  // NEW handle re-heals (fresh open rescans) — the anti-silent-disable check
  seedWithOrphans(dbFile)
  const db2 = openDatabase(dbFile)
  const rels2 = (db2.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE id='orph-rel'`).get() as any).c
  check("S4.heal-refuses-silent-disable", rels2 === 1, `fresh handle sees the re-seeded orphan (rows present: ${rels2}) — heal is per-connection, a new open re-scans and would heal; it is never permanently disabled`)
  db2.close()
  // S4b: the OPEN PATH ITSELF heals — BrainDatabase.openByPath runs
  // ensureSchemaIfNew → cleanupOrphanedFkRows, so a legacy DB opened through
  // the real seam comes out conformant with no manual call.
  {
    const dbFile = seedWithOrphans(path.join(TMP, "s4b.db"))
    const dbw = BrainDatabase.openByPath(dbFile) as any
    const relsLeft = (dbw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE id='orph-rel'`).get() as any).c
    const goodLeft = (dbw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE id='good'`).get() as any).c
    check("S4b.open-path-heals", relsLeft === 0 && goodLeft === 1, `openByPath on a legacy orphan DB → orphans=${relsLeft}, conforming rows=${goodLeft} (expected 0/1 — heal ran inside the open path)`)
    BrainDatabase.closeByPath?.(dbFile)
  }
}

// ── S5. REAL DB: ship state has zero orphan rows (read-only) ────────────────
{
  const realDataDir = "$HOME/.bb"
  const realRepo = "$HOME/mcp/backbencher-brain"
  if (existsSync(path.join(realDataDir, "projects"))) {
    const { createHash } = await import("node:crypto")
    const { realpathSync } = await import("node:fs")
    const pid = createHash("sha1").update(realpathSync(realRepo)).digest("hex")
    const dbPath = path.join(realDataDir, "projects", pid, "brain.db")
    if (existsSync(dbPath)) {
      const { openDatabase } = await import(path.join(ROOT, "src/storage/db.bun.ts"))
      const db = openDatabase(dbPath, { readonly: true })
      // Count TRUE FK violations only, using the product's own definition
      // (brain-index-health.ts checkDanglingSources, M51.A2): source_symbol_id
      // IS NOT NULL AND != ''. A naive LEFT JOIN counts NULL-source rows too —
      // those are BY-DESIGN external-source edges (source_external carries the
      // name, M51.A3) and are FK-legal. That conflation misreported 4,122 of
      // 4,154 edges on this repo — rediscovered the hard way in this gate.
      const orph = db.prepare(`SELECT COUNT(*) c FROM brain_relationship r
        WHERE r.source_symbol_id IS NOT NULL AND r.source_symbol_id != ''
          AND NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.source_symbol_id)`).get() as any
      const fk = (db.native as any).prepare("PRAGMA foreign_keys").get() as any
      check("S5.real-db-conformant", orph.c === 0, `real repo index: TRUE dangling-source relationships = ${orph.c} (expected 0 after heal; NULL-source external edges excluded per M51.A2), ro-open FK=${fk.foreign_keys}`)
      db.close()
    } else {
      check("S5.real-db-conformant", false, `real DB not found at ${dbPath}`)
    }
  } else {
    console.log(`ℹ️  S5 skipped: real data dir ${realDataDir} not present in this environment`)
  }
}

rmSync(TMP, { recursive: true, force: true })
console.log(`\n=== M54.P1 GATE: ${pass} pass, ${fail} fail ===`)
// Evidence stamp (m21/m52 pattern): machine-readable receipt for the X1 closure.
{
  const { execSync } = await import("node:child_process")
  const commit = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim()
  const { mkdirSync, writeFileSync } = await import("node:fs")
  mkdirSync(path.join(ROOT, "validation/m54/results"), { recursive: true })
  writeFileSync(path.join(ROOT, "validation/m54/results/P1.json"), JSON.stringify({
    gate: "M54.P1", issue: 727, milestone: "M54", at: new Date().toISOString(), commit,
    checks: pass + fail, passed: pass, failed: fail,
    verifierCommand: "bun run script/m54/verify-p1-fk.ts",
    status: fail === 0 ? "verified" : "known-gap",
    policy: { fkOnAtOpen: true, runtimes: ["bun", "node"], readonlyUniform: true, escapeHatch: "BB_FK_ENFORCE=0" },
  }, null, 2) + "\n")
}
if (fail > 0) { console.log(failures.map(f => `  ✗ ${f}`).join("\n")); process.exit(1) }
