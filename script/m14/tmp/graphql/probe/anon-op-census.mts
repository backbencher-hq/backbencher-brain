/**
 * BEFORE/AFTER census for the anonymous-operation identity.
 *
 * Why this exists: `src/ast/analysis-exclusions.ts:171` drops any symbol whose name
 * matches /^(anonymous|anon|unnamed)[_-]/i, and the analyzer names an unnamed
 * operation `anonymous_operation_<startIndex>`. So every one of those symbols is
 * discarded at store time BY DESIGN -- measured: 0 rows for `anonymous_operation_%`
 * across 8 projects, 56 of 750 indexed files emitting >=1 symbol and holding 0
 * brain_symbol rows. 336 stored `uses` edges have no source symbol as a consequence.
 *
 * `anonymous_operation_<startIndex>` is also not unique across files (the offset is
 * per file), and it names an identity GraphQL does not have.
 *
 * This census is the number the fix has to move, over the SAME 750 files before and
 * after, split into symbols and edges so a fix that drops edges to gain symbols is
 * visible as such.
 *
 * Usage: npx tsx script/m14/tmp/graphql/probe/anon-op-census.mts <label>
 */
import * as fs from "fs"
import * as path from "path"
import Database from "better-sqlite3"
import { getProjectId } from "../../../../../src/util/project-id"
import { parseFile } from "../../../../../src/ast/pool-worker"

const TMP_ROOT = "/tmp/opencode/m14-store-resolution-multi"
const label = process.argv[2] ?? "run"

function corpusDirFor(repo: string): string | null {
  for (const c of [repo, repo.startsWith("gql-") ? repo.slice(4) : `gql-${repo}`]) {
    const d = path.join("/home/ishaq2321/bb_tests/repositories", c)
    if (fs.existsSync(d)) return d
  }
  return null
}

const repos = fs
  .readdirSync(TMP_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

let files = 0
let symbolsTotal = 0
let anonSymbols = 0
let edgesTotal = 0
let anonSourcedEdges = 0
const anonEdgeTypes = new Map<string, number>()
const allEdgeTypes = new Map<string, number>()
const nameUse = new Map<string, number>()
const dupNames = new Map<string, number>()
let anonNamesWithCollision = 0

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
  const fileIds: string[] = (db.prepare(`SELECT id FROM brain_file`).all() as any[]).map((r) => String(r.id))
  for (const fid of fileIds) {
    const rel = String(fid).slice(String(fid).indexOf(":") + 1)
    const abs = path.join(dir, rel)
    if (!fs.existsSync(abs)) continue
    let r: any
    try {
      r = await parseFile(abs)
    } catch {
      continue
    }
    const syms = (r.symbols ?? []) as any[]
    const rels = (r.relationships ?? []) as any[]
    files++
    symbolsTotal += syms.length
    const perFileAnon = new Set<string>()
    for (const s of syms) {
      const nm = String(s.name ?? "")
      nameUse.set(nm, (nameUse.get(nm) ?? 0) + 1)
      if (/^(anonymous|anon|unnamed)[_-]/i.test(nm)) {
        anonSymbols++
        perFileAnon.add(nm)
        anonNamesWithCollision += perFileAnon.has(nm) && (nameUse.get(nm) ?? 0) > 1 ? 0 : 0
      }
    }
    for (const e of rels) {
      edgesTotal++
      const t = String(e.type)
      allEdgeTypes.set(t, (allEdgeTypes.get(t) ?? 0) + 1)
      const src = String(e.source ?? "")
      if (perFileAnon.has(src)) {
        anonSourcedEdges++
        anonEdgeTypes.set(t, (anonEdgeTypes.get(t) ?? 0) + 1)
      }
    }
  }
  db.close()
}

// a name that appears in more than one file is not an identity
const seen = new Set<string>()
for (const [nm, n] of nameUse) {
  if (n > 1) dupNames.set(nm, n)
}

console.log(`=== anonymous-operation census [${label}] ===`)
console.log(`files ${files}   symbols ${symbolsTotal}   relationships ${edgesTotal}`)
console.log(`symbols the store discards by design (/^(anonymous|anon|unnamed)[_-]/): ${anonSymbols}`)
console.log(`relationships sourced from one of them: ${anonSourcedEdges}`)
console.log(`  by type: ${JSON.stringify(Object.fromEntries([...anonEdgeTypes.entries()].sort()))}`)
console.log(`all relationship types: ${JSON.stringify(Object.fromEntries([...allEdgeTypes.entries()].sort()))}`)
console.log(`distinct symbol names ${nameUse.size}; names appearing in >1 emission ${dupNames.size}`)
const worst = [...dupNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
for (const [nm, n] of worst) console.log(`  ${nm} x${n}`)
void anonNamesWithCollision