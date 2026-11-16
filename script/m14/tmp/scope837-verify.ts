// #837 live probe: brain_symbol.scope_kind must now receive the analyzer's
// scope value. Real pipeline (indexProjectParallel) into a throwaway BB_DATA_DIR,
// rows read back with raw SQL. Four languages that emit `scope:`.
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "scope837-"))

const FILES: Record<string, string> = {
  "Scope.java": `package demo;\npublic class Scope {\n  private int count;\n  public int get() { return count; }\n}\n`,
  "scope.py": `class Widget:\n    def render(self):\n        return "w"\n\ndef free_function():\n    return 1\n`,
  "scope.kt": "class Repo(private val db: String) {\n    fun query(): Int = 1\n}\n",
  "t.dart": "class RepoDart {\n  int query() => 1;\n}\n",
  "package.json": `{"name": "scope837-probe", "version": "1.0.0"}\n`,
}

async function main() {
  process.env.BB_DATA_DIR = TMP
  const { indexProjectParallel, getProjectId } = await import(`${ROOT}/dist/index.js`).catch(() => ({ indexProjectParallel: null as any, getProjectId: null as any }))
  if (!indexProjectParallel || !getProjectId) throw new Error("dist not built")

  const projDir = path.join(TMP, "proj")
  fs.mkdirSync(projDir, { recursive: true })
  for (const [name, src] of Object.entries(FILES)) fs.writeFileSync(path.join(projDir, name), src)

  const projectId = getProjectId(projDir)
  const res = await indexProjectParallel(projectId, projDir)
  const dbPath = path.join(TMP, "projects")
  // locate the db the store created
  const found: string[] = []
  const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith(".db")) found.push(p) } }
  walk(dbPath)
  if (found.length === 0) throw new Error("no brain.db produced")

  const Database = (await import("better-sqlite3")).default
  const db = new Database(found[0], { readonly: true })
  const rows = db.prepare(
    `SELECT s.name, s.symbol_type, s.scope_kind, s.owner_symbol_id FROM brain_symbol s WHERE s.name IN ('Scope','Widget','Repo','RepoDart','db','query','get','render','free_function') ORDER BY s.name`,
  ).all() as Array<{ name: string; symbol_type: string; scope_kind: string | null }>

  console.log("rows:")
  for (const r of rows) console.log(`  ${r.name.padEnd(14)} type=${String(r.symbol_type).padEnd(10)} scope_kind=${JSON.stringify(r.scope_kind)}`)
  const scopeRows = rows.filter((r) => ["Repo", "RepoDart", "db", "query"].includes(r.name))
  const withScope = scopeRows.filter((r) => r.scope_kind !== null && r.scope_kind !== "")
  console.log(`\nscope-emitting rows with a non-null scope_kind: ${withScope.length}/${scopeRows.length}`)
  console.log(`verdict: ${withScope.length > 0 ? "PASS — scope values now reach the store" : "FAIL — still dropped"}`)
  fs.rmSync(TMP, { recursive: true, force: true })
}

main().catch((e) => { console.error(e); process.exit(1) })
