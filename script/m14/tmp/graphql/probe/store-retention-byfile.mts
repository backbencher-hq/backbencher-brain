/**
 * Where does the store lose symbols? Measured per FILE, because a by-name count is
 * masked whenever the same name is declared in another file.
 *
 * store-retention.mts showed brain_file rows with zero brain_symbol rows while parseFile
 * emits one for the same file. The files that lose everything are query documents, not
 * schemas, which suggests the hypothesis under test here: symbols are dropped for files
 * with no type-system DEFINITION. In GraphQL that is not a rare corner -- a query
 * document is where operations live, and an operation is what a `uses` edge is sourced
 * from, so this would explain all 399 stored edges that have no source symbol.
 *
 * The cross-tab is therefore the measurement: stored-symbol count by
 * (file has a type-system definition?, file emits n symbols). No inference needed.
 *
 * Usage: npx tsx script/m14/tmp/graphql/probe/store-retention-byfile.mts
 */
import * as fs from "fs"
import * as path from "path"
import Database from "better-sqlite3"
import { getProjectId } from "../../../../../src/util/project-id"
import { parseFile } from "../../../../../src/ast/pool-worker"

const TMP_ROOT = "/tmp/opencode/m14-store-resolution-multi"
/** a type-system definition: type|input|interface|union|enum|scalar|schema|directive */
const DEFN_RE =
  /^\s*(?:extend\s+)?(type|input|interface|union|enum|scalar|schema|directive)\s+@?([A-Za-z_][A-Za-z0-9_]*)/m

function corpusDirFor(repo: string): string | null {
  for (const c of [repo, repo.startsWith("gql-") ? repo.slice(4) : `gql-${repo}`]) {
    const d = path.join("<corpus-root>/bb_tests/repositories", c)
    if (fs.existsSync(d)) return d
  }
  return null
}

const repos = fs
  .readdirSync(TMP_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

interface Cell {
  files: number
  emitted: number
  stored: number
  filesWithZeroStored: number
}
const key = (hasDefn: boolean, n: number): string => `${hasDefn ? "with-definition" : "no-definition"}/emits-${n}`
const cells = new Map<string, Cell>()
const zeroExamples: string[] = []
let files = 0
let emittedAll = 0
let storedAll = 0

for (const repo of repos) {
  const dbPath = path.join(
    process.env.HOME ?? "",
    ".bb",
    "projects",
    getProjectId(path.join(TMP_ROOT, repo)),
    "brain.db",
  )
  const dir = corpusDirFor(repo)
  if (!fs.existsSync(dbPath) || !dir) continue
  const db = new Database(dbPath, { readonly: true })
  const rows = db.prepare(`SELECT id, relative_path FROM brain_file`).all() as any[]
  const symByFile = db.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE file_id = ?`)
  for (const f of rows) {
    const rel = String(f.relative_path)
    const abs = path.join(dir, rel)
    if (!fs.existsSync(abs)) continue
    let txt = ""
    try {
      txt = fs.readFileSync(abs, "utf8")
    } catch {
      continue
    }
    let r: any
    try {
      r = await parseFile(abs)
    } catch {
      continue
    }
    const n = ((r.symbols ?? []) as any[]).length
    const stored = (symByFile.get(String(f.id)) as any).c
    const hasDefn = DEFN_RE.test(txt)
    const k = key(hasDefn, Math.min(n, 5))
    let c = cells.get(k)
    if (!c) cells.set(k, (c = { files: 0, emitted: 0, stored: 0, filesWithZeroStored: 0 }))
    c.files++
    c.emitted += n
    c.stored += stored
    if (n > 0 && stored === 0) {
      c.filesWithZeroStored++
      if (zeroExamples.length < 20)
        zeroExamples.push(`  ${repo} ${rel}  hasDefinition=${hasDefn} emits=${n} stored=0  first 60 chars: ${JSON.stringify(txt.slice(0, 60))}`)
    }
    files++
    emittedAll += n
    storedAll += stored
  }
  db.close()
}

console.log(`${files} indexed files re-parsed with production parseFile`)
console.log(`emitted ${emittedAll} symbols; brain_symbol holds ${storedAll} rows for those same files\n`)
console.log("file class".padEnd(30) + "files".padStart(7) + "emitted".padStart(9) + "stored".padStart(9) + "files w/ 0 stored".padStart(18))
for (const [k, c] of [...cells.entries()].sort()) {
  console.log(
    `${k.padEnd(30)}${String(c.files).padStart(7)}${String(c.emitted).padStart(9)}${String(c.stored).padStart(9)}${String(c.filesWithZeroStored).padStart(18)}`,
  )
}
console.log(`\nfiles that emitted >=1 symbol and have ZERO brain_symbol rows:`)
for (const l of zeroExamples) console.log(l)