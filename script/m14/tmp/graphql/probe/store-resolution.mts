/**
 * Does the BUG exist, or does the INSTRUMENT invent it?
 *
 * `diagnose-incoming.mts` reports 6,503 unresolved targets for graphql over 80
 * `.graphql` files and calls 8,671 edges "recoverable by fixing the name
 * function". It resolves a target with `byName.get(target)` where `byName` is
 * keyed on `Symbol.name` ALONE.
 *
 * The production store does not resolve that way:
 *
 *   src/ast/pool-worker.ts:930
 *     qualifiedName: s.qualifiedName || s.metadata?.fqn || (s.scope ? `${s.scope}.${s.name}` : s.name)
 *   src/ast/parallel-indexer.ts:4027
 *     "Strategies 1-3 match a bare `name`, a `qualified_name` (`Owner.member`), ..."
 *   src/ast/parallel-indexer.ts:3774 / 4001
 *     WHERE brain_relationship.target_external = _res_qname.qualified_name
 *
 * The graphql analyzer already sets `scope: owner.name` on every field, so
 * production ALREADY publishes `qualified_name = "Owner.field"` — the exact string
 * the `contains` edge targets. On that reading the 6,503 is a property of the
 * instrument's name-only lookup, not of the analyzer, and "fixing" it would be a
 * change to satisfy a measurement rather than to make the graph truer.
 *
 * This probe settles it end to end: it indexes REAL corpus GraphQL through the
 * real CLI (`node bin/bb index`) and then asks the DATABASE how many relationships
 * actually have `target_symbol_id IS NULL`. The store's own resolution order is
 * the arbiter; a simulation of it is not.
 *
 * Usage: npx tsx script/m14/tmp/graphql/probe/store-resolution.mts <srcDir> <nFiles>
 */
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"
import { createHash } from "crypto"
import Database from "better-sqlite3"

const ROOT = path.resolve(process.cwd())
const srcDir = process.argv[2] ?? "<corpus-root>/bb_tests/repositories/gql-gqlgen"
const nFiles = Number(process.argv[3] ?? 200)
const TMP = "/tmp/opencode/m14-store-resolution"

function collect(dir: string, base = dir, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "node_modules") continue
      collect(p, base, out)
    } else if (e.name.endsWith(".graphql") || e.name.endsWith(".gql")) out.push(path.relative(base, p))
  }
  return out
}

const rels = collect(srcDir).sort()
const take = rels.slice(0, nFiles)
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })
for (const r of take) {
  const dst = path.join(TMP, r)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(path.join(srcDir, r), dst)
}
console.log(`source ${srcDir}: ${rels.length} graphql files present, indexing ${take.length}`)

execSync(`node bin/bb index ${TMP} --force`, { cwd: ROOT, stdio: "pipe" })

const sha = createHash("sha256").update(TMP).digest("hex").slice(0, 16)
const dbPath = path.join(process.env.HOME ?? "", ".bb", "projects", sha, "brain.db")
if (!fs.existsSync(dbPath)) {
  console.error(`NO DB at ${dbPath}`)
  process.exit(1)
}
const db = new Database(dbPath, { readonly: true })

const nSym = (db.prepare(`SELECT COUNT(*) c FROM brain_symbol`).get() as any).c as number
const nRel = (db.prepare(`SELECT COUNT(*) c FROM brain_relationship`).get() as any).c as number
console.log(`store: symbols ${nSym}   relationships ${nRel}`)

// The arbiter row: did the edge bind to a symbol id?
const rows = db
  .prepare(
    `SELECT type, COUNT(*) n, SUM(CASE WHEN target_symbol_id IS NULL THEN 1 ELSE 0 END) unresolved
     FROM brain_relationship GROUP BY type ORDER BY n DESC`,
  )
  .all() as any[]
console.log(`\ntype                 edges  unresolved  rate`)
let tot = 0
let unres = 0
for (const r of rows) {
  tot += r.n
  unres += r.unresolved
  console.log(
    `${String(r.type).padEnd(18)} ${String(r.n).padStart(6)} ${String(r.unresolved).padStart(11)}  ${(
      (100 * (r.n - r.unresolved)) /
      r.n
    ).toFixed(1)}%`,
  )
}
console.log(`${"TOTAL".padEnd(18)} ${String(tot).padStart(6)} ${String(unres).padStart(11)}  ${((100 * (tot - unres)) / tot).toFixed(1)}%`)

// What happened to the exact targets diagnose-incoming called recoverable?
const dottedUnres = db
  .prepare(
    `SELECT target_external t, COUNT(*) n FROM brain_relationship
     WHERE target_symbol_id IS NULL AND target_external LIKE '%.%'
     GROUP BY t ORDER BY n DESC LIMIT 15`,
  )
  .all() as any[]
console.log(`\nunresolved targets still containing '.': (top 15)`)
for (const r of dottedUnres) console.log(`   ${String(r.n).padStart(5)}  ${r.t}`)

// And how many symbols actually carry a qualified_name?
const qn = db
  .prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE qualified_name IS NOT NULL AND qualified_name <> ''`).get() as any
const dottedNames = db
  .prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE name LIKE '%.%'`).get() as any
console.log(`\nsymbols with a qualified_name: ${qn.c}   symbols whose NAME itself is dotted: ${dottedNames.c}`)