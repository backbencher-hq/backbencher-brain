/**
 * Does parseFile's output survive the store?
 *
 * 399 stored edges have neither a source nor a target symbol. The analyzer is not the
 * cause: parseFile on a real hasura-engine introspection request emits
 *   source: "IntrospectArticlesBooleanExpression", target: "kind", evidenceClass structural
 * and the store holds 0 rows for that name. So either the store drops symbols the
 * analyzer emitted, or the file was never indexed. Both are decidable here: for every
 * file brain_file claims to have indexed, re-run production parseFile and compare the
 * symbol count with the count the store kept.
 *
 * This is shared machinery (parallel-indexer / storeResults), so it is a REPORT to the
 * supervisor, not a fix here. What makes the report worth acting on is the size of the
 * gap, so the gap is the number this probe exists to produce.
 *
 * Usage: npx tsx script/m14/tmp/graphql/probe/store-retention.mts [repo]
 */
import * as fs from "fs"
import * as path from "path"
import Database from "better-sqlite3"
import { getProjectId } from "../../../../../src/util/project-id"
import { parseFile } from "../../../../../src/ast/pool-worker"

const TMP_ROOT = "/tmp/opencode/m14-store-resolution-multi"
const only = process.argv[2]

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
  .filter((r) => !only || r.includes(only))

let files = 0
let parseFailed = 0
let emitted = 0
let kept = 0
const worst: string[] = []

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
  const rels = (db.prepare(`SELECT relative_path FROM brain_file`).all() as any[]).map((r) =>
    String(r.relative_path),
  )
  let rEmitted = 0
  let rKept = 0
  let rFiles = 0
  for (const rel of rels) {
    const abs = path.join(dir, rel)
    if (!fs.existsSync(abs)) continue
    let r: any
    try {
      r = await parseFile(abs)
    } catch {
      parseFailed++
      continue
    }
    const syms = (r.symbols ?? []) as any[]
    const relsOut = (r.relationships ?? []) as any[]
    const names = new Set<string>()
    for (const s of syms) {
      if (s.name) names.add(String(s.name))
    }
    const relNames = new Set<string>()
    for (const e of relsOut) if (e.source) relNames.add(String(e.source))
    // one parameter per NAME, so this is a lookup per name -- `.all(...names)` binds
    // the spread as parameters to a single `?` and throws "too few parameter values".
    const byName = db.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE name = ?`)
    let stored = 0
    for (const nm of names) stored += (byName.get(nm) as any).c
    rFiles++
    rEmitted += syms.length
    rKept += stored
    files++
    emitted += syms.length
    kept += stored
    if (stored < names.size && worst.length < 25)
      worst.push(
        `  ${repo} ${rel}  emitted ${syms.length} symbols (${names.size} distinct names), store holds ${stored}`,
      )
  }
  db.close()
  console.log(
    `${repo.padEnd(24)} files ${String(rFiles).padStart(4)}  emitted ${String(rEmitted).padStart(6)} symbols  store keeps ${String(rKept).padStart(6)}`,
  )
}

console.log(`\nTOTAL ${files} indexed files re-parsed: parseFile emitted ${emitted} symbols; the store holds ${kept} of them by name`)
console.log(`parse failures: ${parseFailed}`)
console.log(`\nfiles where the store holds fewer symbols than the analyzer emitted:`)
for (const l of worst) console.log(l)