/** Which files keep their lone symbol and which lose it? The cross-tab in
 *  store-retention-byfile.log shows 178 of 230 definition-less single-symbol files keep
 *  theirs and 52 lose it, so the discriminator is not "operations are dropped". This
 *  prints both groups side by side so the rule can be read off the data. */
import * as fs from "fs"
import * as path from "path"
import Database from "better-sqlite3"
import { getProjectId } from "../../../../../src/util/project-id"
import { parseFile } from "../../../../../src/ast/pool-worker"

const TMP_ROOT = "/tmp/opencode/m14-store-resolution-multi"
const DEFN_RE = /^\s*(?:extend\s+)?(type|input|interface|union|enum|scalar|schema|directive)\s/m

function corpusDirFor(repo: string): string | null {
  for (const c of [repo, repo.startsWith("gql-") ? repo.slice(4) : `gql-${repo}`]) {
    const d = path.join("<corpus-root>/bb_tests/repositories", c)
    if (fs.existsSync(d)) return d
  }
  return null
}

const kept: string[] = []
const lost: string[] = []
for (const repo of fs.readdirSync(TMP_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
  const dbPath = path.join(process.env.HOME ?? "", ".bb", "projects", getProjectId(path.join(TMP_ROOT, repo)), "brain.db")
  const dir = corpusDirFor(repo)
  if (!fs.existsSync(dbPath) || !dir) continue
  const db = new Database(dbPath, { readonly: true })
  const symByFile = db.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id = ?`)
  for (const f of db.prepare(`SELECT id, relative_path FROM brain_file`).all() as any[]) {
    const rel = String(f.relative_path)
    const abs = path.join(dir, rel)
    if (!fs.existsSync(abs)) continue
    let txt = ""
    try { txt = fs.readFileSync(abs, "utf8") } catch { continue }
    let r: any
    try { r = await parseFile(abs) } catch { continue }
    const syms = (r.symbols ?? []) as any[]
    if (syms.length !== 1 || DEFN_RE.test(txt)) continue
    const stored = (symByFile.get(String(f.id)) as any).c
    const s = syms[0]
    const line = `${repo.slice(4)} | ${rel.slice(-52).padEnd(52)} | name=${String(s.name).padEnd(24)} kind=${String(s.kind).padEnd(8)} ln=${s.lineStart} empty=${String(!s.name).padEnd(5)}`
    ;(stored > 0 ? kept : lost).push(line)
  }
  db.close()
}
console.log(`KEPT ${kept.length} / LOST ${lost.length}\n--- LOST (first 30) ---`)
for (const l of lost.slice(0, 30)) console.log(l)
console.log(`\n--- KEPT (first 30) ---`)
for (const l of kept.slice(0, 30)) console.log(l)
