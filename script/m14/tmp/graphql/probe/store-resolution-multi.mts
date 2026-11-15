/**
 * Cause C at scale, through the REAL store: which unresolved `references` targets
 * are the SPECIFICATION's own vocabulary, and which are genuinely absent?
 *
 * WHY THIS FILE AND NOT `probe/external-census.mts`
 * -------------------------------------------------
 * The external census resolves a target with `names.has(target)` where `names` is
 * a set of `Symbol.name` ALONE, accumulated in a single forward pass. Production does
 * not resolve that way, so the census reports things production resolves:
 *
 *   pool-worker.ts:930
 *     qualifiedName: s.qualifiedName || s.metadata?.fqn || (s.scope ? `${s.scope}.${s.name}` : s.name)
 *   parallel-indexer.ts:4000  strategy 1  target_external = qualified_name
 *   parallel-indexer.ts:4014  strategy 2  target_external = name AND that name is UNIQUE
 *   parallel-indexer.ts:3825  strategy 3  for a dotted target, name = SUBSTR(target, INSTR(target,'.')+1)
 *   parallel-indexer.ts:3836  strategy 4  `<module>:<item>` imports, via src/ast/import-resolution.ts
 *
 * The graphql analyzer sets `scope: owner.name` on every field, so production already
 * publishes `qualified_name = "Owner.field"` — the exact string `contains` targets.
 * The census kept a set of BARE names and tested the FULL dotted string against it, so
 * `Node.id` came back "unresolved" for every one of its 512 edges when production
 * strategy 1 matches it. Measured: the census's own output put 24,719 edges in a
 * "NOT spec — residual" bucket whose top entries were all dotted (`Node.id` 512,
 * `AuditEntry.actorIp` 118). That bucket is an instrument artifact, not a finding.
 *
 * So this probe does not simulate the cascade: it indexes through the real CLI and
 * asks the DATABASE, per project, how many relationships still have a NULL id. The
 * store's own resolution order is the arbiter.
 *
 * The spec vocabulary is the GraphQL specification's own, NOT any file's:
 *   section 3.5  built-in scalars   Int Float String Boolean ID
 *   section 3.13 built-in directives @skip @include @deprecated @specifiedBy
 *   section 4    introspection      __Schema __Type __Field __InputValue ...
 *
 * Usage: npx tsx script/m14/tmp/graphql/probe/store-resolution-multi.mts <nFilesPerRepo> [repo ...]
 */
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"
import { createHash } from "crypto"
import Database from "better-sqlite3"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(process.cwd())
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const TMP_ROOT = "/tmp/opencode/m14-store-resolution-multi"
const nPerRepo = Number(process.argv[2] ?? 150)
const REPOS = process.argv.slice(3)

/** The GraphQL specification's own vocabulary — declared by the SPEC, not by any file
 *  in a corpus. A schema references these without ever declaring them, so a per-file
 *  analyzer cannot publish a symbol for them and no file in the project can bind them. */
const SPEC_SCALARS = new Set(["Int", "Float", "String", "Boolean", "ID"])
const SPEC_DIRECTIVES = new Set(["skip", "include", "deprecated", "specifiedBy"])
const SPEC_INTROSPECTION = /^(__(Schema|Type|Field|InputValue|EnumValue|Directive|TypeKind|DirectiveLocation))$/

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

/** Which bucket an unresolved TARGET falls in. Ordered: the first match wins, and the
 *  order is the order of the argument, not of the frequency. */
function bucketTarget(t: string): string {
  if (t === "") return "empty string"
  const bare = t.startsWith("@") ? t.slice(1) : t
  if (SPEC_SCALARS.has(bare)) return "spec built-in scalar"
  if (SPEC_DIRECTIVES.has(bare)) return "spec built-in directive"
  if (SPEC_INTROSPECTION.test(bare)) return "spec introspection"
  if (t.includes(".")) return "dotted"
  return "bare, not spec"
}

/** An unresolved SOURCE is only a defect if it claims to be a symbol. A source spelled
 *  as a file path is the M60/#910 `fileLevel` contract (parallel-indexer.ts:3480): the
 *  edge is module-level, so its source is the FILE and there is nothing to bind. */
function bucketSource(s: string): string {
  if (s === null || s === undefined) return "null"
  if (s === "") return "empty string"
  if (/\.(graphql|gql)$/.test(s) || s.includes("/")) return "file path (fileLevel contract)"
  if (s === "(file)") return 'literal "(file)"'
  return "symbol-shaped, unresolved"
}

const repos = REPOS.length
  ? REPOS
  : fs
      .readdirSync(CORPUS, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => {
        try {
          return collect(path.join(CORPUS, name)).length >= 20
        } catch {
          return false
        }
      })
      .sort()

const perRepo: any[] = []
const totals: Record<string, Record<string, number>> = {}
const targetBuckets = new Map<string, { edges: number; names: Set<string> }>()
const sourceBuckets = new Map<string, { edges: number; names: Set<string> }>()
let gFiles = 0
let gSym = 0
let gRel = 0
let gParsed = 0
let gSkipped = 0

const add = (m: Map<string, { edges: number; names: Set<string> }>, k: string, n: number, name: string) => {
  let e = m.get(k)
  if (!e) m.set(k, (e = { edges: 0, names: new Set() }))
  e.edges += n
  if (name) e.names.add(name)
}

for (const repo of repos) {
  const src = path.join(CORPUS, repo)
  let rels: string[]
  try {
    rels = collect(src).sort()
  } catch {
    continue
  }
  const take = rels.slice(0, nPerRepo)
  if (take.length === 0) continue

  const TMP = path.join(TMP_ROOT, repo)
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })
  for (const r of take) {
    const dst = path.join(TMP, r)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    try {
      fs.copyFileSync(path.join(src, r), dst)
    } catch {
      /* unreadable file — the indexer's own walk would skip it too */
    }
  }

  const present = fs
    .readdirSync(TMP, { recursive: true, withFileTypes: true })
    .filter(() => true).length
  void present

  try {
    execSync(`node bin/bb index ${TMP} --force`, { cwd: ROOT, stdio: "pipe" })
  } catch (e) {
    console.log(`SKIP ${repo}: index failed — ${String((e as any).message ?? e).slice(0, 160)}`)
    continue
  }
  // src/util/project-id.ts:26 — the SINGLE owner of project identity.
  // sha1 over the REALPATH, first 40 hex chars. Hashing the raw string or
  // truncating to 16 silently yields a directory that never exists, which is how
  // the first run of this probe indexed 0 repos and reported an empty census.
  const { getProjectId } = await import("../../../../../src/util/project-id")
  const sha = getProjectId(TMP)
  const dbPath = path.join(process.env.HOME ?? "", ".bb", "projects", sha, "brain.db")
  if (!fs.existsSync(dbPath)) {
    console.log(`SKIP ${repo}: no db at ${dbPath}`)
    continue
  }
  const db = new Database(dbPath, { readonly: true })
  const nSym = (db.prepare(`SELECT COUNT(*) c FROM brain_symbol`).get() as any).c as number
  const nRel = (db.prepare(`SELECT COUNT(*) c FROM brain_relationship`).get() as any).c as number
  const files = (db.prepare(`SELECT COUNT(*) c FROM brain_file`).get() as any).c as number

  gFiles += files
  gParsed += files
  gSym += nSym
  gRel += nRel
  gSkipped += take.length - files

  const byType = db
    .prepare(
      `SELECT relationship_type AS type,
              COUNT(*) n,
              SUM(CASE WHEN target_symbol_id IS NULL THEN 1 ELSE 0 END) t_un,
              SUM(CASE WHEN source_symbol_id IS NULL THEN 1 ELSE 0 END) s_un
       FROM brain_relationship GROUP BY type ORDER BY n DESC`,
    )
    .all() as any[]
  for (const r of byType) {
    totals[r.type] ??= { edges: 0, t_un: 0, s_un: 0 }
    totals[r.type].edges += r.n
    totals[r.type].t_un += r.t_un
    totals[r.type].s_un += r.s_un
  }

  const unT = db
    .prepare(
      `SELECT COALESCE(target_external,'') t, COUNT(*) n FROM brain_relationship
       WHERE target_symbol_id IS NULL GROUP BY t ORDER BY n DESC`,
    )
    .all() as any[]
  for (const r of unT) add(targetBuckets, bucketTarget(r.t), r.n, r.t)

  const unS = db
    .prepare(
      `SELECT COALESCE(source_external,'') s, COUNT(*) n FROM brain_relationship
       WHERE source_symbol_id IS NULL GROUP BY s ORDER BY n DESC`,
    )
    .all() as any[]
  for (const r of unS) add(sourceBuckets, bucketSource(r.s), r.n, r.s)

  perRepo.push({ repo, files, symbols: nSym, rel: nRel, types: byType.length })
  console.log(`  ${repo.padEnd(26)} files ${String(files).padStart(4)}  symbols ${String(nSym).padStart(6)}  rel ${String(nRel).padStart(7)}  types ${byType.length}`)
  db.close()
}

console.log(`\n=== population ===`)
console.log(`repos indexed ${perRepo.length}   files ${gFiles}   symbols ${gSym}   relationships ${gRel}`)
console.log(`per-repo file cap ${nPerRepo}; files offered but not indexed ${gSkipped}`)
console.log(`every brain_relationship row in every one of these projects — no sampling within a project`)

console.log(`\n=== per type, target resolution (the end that binds to a symbol) ===`)
console.log(`type                 edges   tgt_unres   pct      src_unres`)
let te = 0
let tu = 0
for (const [t, v] of Object.entries(totals).sort((a, b) => b[1].edges - a[1].edges)) {
  te += v.edges
  tu += v.t_un
  console.log(
    `${t.padEnd(18)} ${String(v.edges).padStart(7)} ${String(v.t_un).padStart(11)} ${((100 * (v.edges - v.t_un)) / v.edges).toFixed(2).padStart(8)}% ${String(v.s_un).padStart(11)}`,
  )
}
console.log(`${"TOTAL".padEnd(18)} ${String(te).padStart(7)} ${String(tu).padStart(11)} ${((100 * (te - tu)) / te).toFixed(2).padStart(8)}%`)

console.log(`\n=== unresolved TARGETS, classified ===`)
for (const [b, v] of [...targetBuckets.entries()].sort((a, b2) => b2[1].edges - a[1].edges)) {
  console.log(`${b.padEnd(34)} ${String(v.edges).padStart(7)} edges   ${v.names.size} distinct`)
  const top = [...v.names].sort((a, b2) => b2.localeCompare(a)).slice(0, 8)
  for (const n of top) console.log(`      ${n}`)
}

console.log(`\n=== unresolved SOURCES, classified ===`)
for (const [b, v] of [...sourceBuckets.entries()].sort((a, b2) => b2[1].edges - a[1].edges)) {
  console.log(`${b.padEnd(34)} ${String(v.edges).padStart(7)} edges   ${v.names.size} distinct`)
  const top = [...v.names].sort().slice(0, 6)
  for (const n of top) console.log(`      ${n}`)
}

fs.writeFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out", "store-resolution-multi.json"),
  JSON.stringify({ perRepo, totals, targets: [...targetBuckets], sources: [...sourceBuckets], files: gFiles, symbols: gSym, rel: gRel }, null, 2),
)