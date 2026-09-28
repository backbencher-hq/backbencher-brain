// verify-core.ts — Phase 1 acceptance test.
// Proves brain-core opens real brain databases (opencode-indexed) and runs
// real queries under BOTH runtimes (bun:sqlite and better-sqlite3).
//
//   bun run script/verify-core.ts     # via bun:sqlite
//   node script/verify-core.ts        # via better-sqlite3
import { BrainDatabase } from "../src/brain/database"

const EXISTING_DB = process.env.BB_VERIFY_DB || "$HOME/.local/share/opencode/brain/4b0ea68d7af9a6031a7ffda7ad66e0cb83315750/brain.db"
const PROJECT_ID = process.env.BB_VERIFY_PID || "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

let failures = 0
function check(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label} ${detail}`)
  }
}

console.log(`runtime: ${process.version} (${typeof Bun !== "undefined" ? "bun" : "node"})`)
console.log(`driver:  ${typeof Bun !== "undefined" ? "bun:sqlite" : "better-sqlite3"}`)

// 1. open existing opencode-indexed DB read-only
const db = BrainDatabase.openByPath(EXISTING_DB, { readonly: true })

// 2. schema presence
const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'brain_%'").all() as any[]).map((t) => t.name)
for (const t of ["brain_file", "brain_symbol", "brain_relationship", "brain_import", "brain_semantic_embedding"]) {
  check(`schema table ${t}`, tables.includes(t))
}

// 3. counts
const files = (db.prepare("SELECT COUNT(*) as c FROM brain_file").get() as any).c
const symbols = (db.prepare("SELECT COUNT(*) as c FROM brain_symbol").get() as any).c
const rels = (db.prepare("SELECT COUNT(*) as c FROM brain_relationship").get() as any).c
check("brain_file count > 0", files > 1000, `got ${files}`)
check("brain_symbol count > 0", symbols > 10000, `got ${symbols}`)
check("brain_relationship count > 0", rels > 0, `got ${rels}`)
console.log(`  counts: files=${files} symbols=${symbols} rels=${rels}`)

// 4. a real search-shaped query (the phased exact-match shape used by bb_search)
const exact = db
  .prepare(
    `SELECT s.name, s.symbol_type, s.line_start, f.relative_path
     FROM brain_symbol s JOIN brain_file f ON s.file_id = f.id
     WHERE s.project_id = ? AND s.name = ? AND COALESCE(s.line_start,0) > 0
     LIMIT 5`,
  )
  .all(PROJECT_ID, "quickAnswer") as any[]
check("exact search finds quickAnswer", exact.length >= 1, `got ${exact.length}`)
if (exact.length) check("exact search row sane", exact[0].line_start > 0 && exact[0].relative_path.includes("tools.ts"))

// 5. noise query (junk symbols must be identifiable so filters can drop them)
const noise = (db.prepare("SELECT COUNT(*) as c FROM brain_symbol WHERE project_id = ? AND name = 'this'").get(PROJECT_ID) as any).c
console.log(`  (index noise check: 'this' rows = ${noise} — filters must exclude these)`)

// 6. fresh write round-trip in a temp DB (proves exec + transactions on the driver)
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
const tmp = mkdtempSync(path.join(tmpdir(), "brain-core-verify-"))
const fresh = BrainDatabase.openByPath(path.join(tmp, "test.db"))
fresh.exec("CREATE TABLE IF NOT EXISTS t (id TEXT PRIMARY KEY, v INTEGER)")
const tx = fresh.transaction(() => {
  fresh.prepare("INSERT INTO t VALUES (?, ?)").run("a", 1)
  fresh.prepare("INSERT INTO t VALUES (?, ?)").run("b", 2)
})
tx()
const rows = fresh.prepare("SELECT * FROM t ORDER BY id").all() as any[]
check("fresh DB write round-trip", rows.length === 2 && rows[1].v === 2, JSON.stringify(rows))
fresh.close()
rmSync(tmp, { recursive: true, force: true })

// 7. standalone path convention
check("standalone path under ~/.bb", BrainDatabase.getDbPath(PROJECT_ID).includes(".bb/projects"))
check("standalone dir computed", BrainDatabase.getDbDirectory(PROJECT_ID).endsWith("brain.db") === false)

console.log(failures === 0 ? "\nCORE VERIFY: ALL PASS" : `\nCORE VERIFY: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
