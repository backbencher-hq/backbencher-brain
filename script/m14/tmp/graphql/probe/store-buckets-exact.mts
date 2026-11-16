/**
 * store-buckets.mts, exact pass. The first draft capped each bucket at 200 distinct
 * targets per repo, so its bare-bucket numbers were a LOWER BOUND and its dotted
 * sample only covered 759 of 1,922 edges. Both are computed over the FULL distinct
 * target set here, and the classification is two-sided instead of one-sided:
 *
 *   strong   a type-level declaration line names it  (`type X`, `enum X`, ...)
 *   fieldish an INDENTED bare identifier names it -- a field declaration or an enum
 *           value. Deliberately an upper bound: an indented bare name can also be a
 *           continuation line, so "fieldish, not strong" is NOT asserted as a
 *           declaration. It is reported as its own population.
 *   absent   the name occurs nowhere in the whole repo's text
 *
 * `imports` (66/66 target-unresolved) has FILE PATHS at both ends, exactly like
 * `exports` (3,307 source-unresolved). That is the M60/#910 fileLevel contract
 * (parallel-indexer.ts:3480), so the question is decidable against brain_file and is
 * decided here rather than asserted.
 *
 * Usage: npx tsx script/m14/tmp/graphql/probe/store-buckets-exact.mts
 */
import * as fs from "fs"
import * as path from "path"
import Database from "better-sqlite3"
import { getProjectId } from "../../../../../src/util/project-id"

const CORPUS = "<corpus-root>/bb_tests/repositories"
const TMP_ROOT = "/tmp/opencode/m14-store-resolution-multi"

const SPEC_SCALARS = new Set(["Int", "Float", "String", "Boolean", "ID"])
const SPEC_DIRECTIVES = new Set(["skip", "include", "deprecated", "specifiedBy"])
const SPEC_INTROSPECTION =
  /^(__(Schema|Type|Field|InputValue|EnumValue|Directive|TypeKind|DirectiveLocation))$/

const bare = (t: string): string => (t.startsWith("@") ? t.slice(1) : t)
const isSpec = (t: string): boolean => {
  const b = bare(t)
  return SPEC_SCALARS.has(b) || SPEC_DIRECTIVES.has(b) || SPEC_INTROSPECTION.test(b)
}
const isBareName = (t: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(bare(t))

/** type-level: `type|input|interface|union|enum|scalar|schema|directive NAME`
 *  fieldish:    an INDENTED bare identifier, optionally followed by `:` or `(`
 *               -- a field declaration, an enum value, or an argument name. */
const STRONG_RE = /^\s*(?:extend\s+)?(type|input|interface|union|enum|scalar|schema|directive)\s+@?([A-Za-z_][A-Za-z0-9_]*)/
const FIELDISH_RE = /^\s+@?([A-Za-z_][A-Za-z0-9_]*)\s*(\(|:|$)/

function collect(dir: string, base = dir, out: string[] = []): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "node_modules") continue
      collect(p, base, out)
    } else if (e.name.endsWith(".graphql") || e.name.endsWith(".gql")) out.push(path.relative(base, p))
  }
  return out
}

const repos = fs
  .readdirSync(TMP_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

/** repo dir name -> corpus dir. The multi probe named its tmp dirs `gql-<repo>`, but
 *  four of them are plain subdirectories of one repo, so both spellings are tried. */
function corpusDirFor(repo: string): string | null {
  const cands = [repo, repo.startsWith("gql-") ? repo.slice(4) : `gql-${repo}`]
  for (const c of cands) {
    const d = path.join(CORPUS, c)
    if (fs.existsSync(d) && collect(d).length > 0) return d
  }
  return null
}

interface RepoIndex {
  files: number
  strong: Set<string>
  fieldish: Set<string>
  present: Set<string>
  paths: Set<string>
  baseNames: Set<string>
}

const indexes = new Map<string, RepoIndex>()
for (const repo of repos) {
  const dir = corpusDirFor(repo)
  if (!dir) {
    console.log(`  ${repo.padEnd(24)} no corpus dir`)
    continue
  }
  const rels = collect(dir)
  const ix: RepoIndex = {
    files: rels.length,
    strong: new Set(),
    fieldish: new Set(),
    present: new Set(),
    paths: new Set(rels),
    baseNames: new Set(rels.map((r) => path.basename(r))),
  }
  for (const rel of rels) {
    let txt: string
    try {
      txt = fs.readFileSync(path.join(dir, rel), "utf8")
    } catch {
      continue
    }
    for (const line of txt.split("\n")) {
      const s = STRONG_RE.exec(line)
      if (s) ix.strong.add(s[2])
      const f = FIELDISH_RE.exec(line)
      if (f) ix.fieldish.add(f[1])
      for (const w of line.split(/[^A-Za-z_][A-Za-z0-9_]*/g)) ix.present.add(w)
    }
  }
  indexes.set(repo, ix)
  console.log(`  ${repo.padEnd(24)} ${String(ix.files).padStart(4)} corpus files  strong ${ix.strong.size}  fieldish ${ix.fieldish.size}`)
}

interface Row {
  repo: string
  s: string | null
  t: string | null
  n: number
}

const impRows: (Row & { ln: number | null; meta: string | null })[] = []
const dottedRows: Row[] = []
const bareRows: Row[] = []
const shapeRows: Row[] = []

let edges = 0
let targetUn = 0
let sourceUn = 0
let fileLevelResolved = 0
let fileLevelUn = 0
const byType = new Map<string, { n: number; tun: number; sun: number }>()

for (const repo of repos) {
  const dbPath = path.join(
    process.env.HOME ?? "",
    ".bb",
    "projects",
    getProjectId(path.join(TMP_ROOT, repo)),
    "brain.db",
  )
  if (!fs.existsSync(dbPath)) {
    console.log(`NO DB ${repo}`)
    continue
  }
  const db = new Database(dbPath, { readonly: true })

  for (const r of db
    .prepare(
      `SELECT relationship_type rt, COUNT(*) n,
              SUM(CASE WHEN target_symbol_id IS NULL THEN 1 ELSE 0 END) tun,
              SUM(CASE WHEN source_symbol_id IS NULL THEN 1 ELSE 0 END) sun
       FROM brain_relationship GROUP BY relationship_type`,
    )
    .all() as any[]) {
    const cur = byType.get(r.rt) ?? { n: 0, tun: 0, sun: 0 }
    cur.n += r.n
    cur.tun += r.tun ?? 0
    cur.sun += r.sun ?? 0
    byType.set(r.rt, cur)
    edges += r.n
    targetUn += r.tun ?? 0
    sourceUn += r.sun ?? 0
  }

  for (const r of db
    .prepare(
      `SELECT source_external s, target_external t, line_number ln, metadata meta
       FROM brain_relationship WHERE relationship_type='imports' ORDER BY target_external`,
    )
    .all() as any[]) impRows.push({ repo, ...r })

  for (const r of db
    .prepare(
      `SELECT source_external s, target_external t, COUNT(*) n FROM brain_relationship
       WHERE target_symbol_id IS NULL AND target_external LIKE '%.%'
       GROUP BY target_external`,
    )
    .all() as any[]) dottedRows.push({ repo, ...r })

  for (const r of db
    .prepare(
      `SELECT source_external s, target_external t, COUNT(*) n FROM brain_relationship
       WHERE target_symbol_id IS NULL AND target_external NOT LIKE '%.%'
       GROUP BY target_external`,
    )
    .all() as any[]) {
    if (isSpec(r.t)) continue
    if (!isBareName(r.t)) shapeRows.push({ repo, ...r })
    else bareRows.push({ repo, ...r })
  }

  // Is an unresolved endpoint a FILE the project indexed? That is the #910 contract.
  for (const r of db
    .prepare(
      `SELECT source_external s, target_external t FROM brain_relationship
       WHERE source_symbol_id IS NULL OR target_symbol_id IS NULL`,
    )
    .all() as any[]) {
    const src = r.s ?? ""
    const tgt = r.t ?? ""
    if (db.prepare(`SELECT 1 FROM brain_file WHERE relative_path = ?`).get(src) || db.prepare(`SELECT 1 FROM brain_file WHERE relative_path = ?`).get(src.split("/").pop() ?? ""))
      fileLevelResolved++
    else fileLevelUn++
    void tgt
  }

  db.close()
}

console.log(`\n=== population: ${edges} relationships, ${targetUn} target-unresolved, ${sourceUn} source-unresolved ===`)
for (const [t, v] of [...byType.entries()].sort((a, b) => b[1].n - a[1].n))
  console.log(`  ${t.padEnd(12)} ${String(v.n).padStart(6)} edges  target-un ${String(v.tun).padStart(6)}  source-un ${String(v.sun).padStart(6)}`)
console.log(`\n=== do unresolved endpoints resolve against brain_file (the #910 fileLevel contract)? ===`)
console.log(`  unresolved endpoints matching an indexed file: ${fileLevelResolved}`)
console.log(`  unresolved endpoints matching no indexed file: ${fileLevelUn}`)

// ---------------------------------------------------------------- imports
console.log(`\n=== imports: ${impRows.length} edges, targets ${JSON.stringify([...new Set(impRows.map((r) => String(r.t)))].slice(0, 6))} ... ===`)
const shapes = new Map<string, number>()
for (const r of impRows) {
  const k = String(r.t ?? "").replace(/[^:/]/g, "")
  shapes.set(k, (shapes.get(k) ?? 0) + 1)
}
console.log(`  target shapes (non-alnum stripped): ${JSON.stringify([...shapes.entries()])}`)

/** `#import "./x.gql"` is relative to the IMPORTING file, so the only join that can
 *  bind it is dirname(source_external) + target, normalised. brain_file stores
 *  relative_path, so that joined path is what must appear there. Both the raw target
 *  and the basename are also tried, because a store may have normalised the other
 *  way -- and the point of the probe is to tell which. */
let impRaw = 0
let impJoined = 0
let impBase = 0
let impSrcRaw = 0
const impMisses: string[] = []
for (const r of impRows) {
  const db = new Database(
    path.join(process.env.HOME ?? "", ".bb", "projects", getProjectId(path.join(TMP_ROOT, r.repo)), "brain.db"),
    { readonly: true },
  )
  const t = String(r.t)
  const src = String(r.s ?? "")
  const has = (p: string): boolean => !!db.prepare(`SELECT 1 FROM brain_file WHERE relative_path = ?`).get(p)
  if (has(t)) impRaw++
  if (has(path.basename(t))) impBase++
  const joined = path.normalize(path.join(path.dirname(src), t))
  if (has(joined)) {
    impJoined++
  } else if (impMisses.length < 12) impMisses.push(`  ${r.repo.padEnd(22)} ${src.padEnd(34)} -> ${t.padEnd(34)} joined ${joined}`)
  if (has(src)) impSrcRaw++
  db.close()
}
console.log(`  imports SOURCE present in brain_file as relative_path: ${impSrcRaw}/${impRows.length}`)
console.log(`  imports TARGET present in brain_file raw:               ${impRaw}/${impRows.length}`)
console.log(`  imports TARGET present in brain_file as basename:       ${impBase}/${impRows.length}`)
console.log(`  imports TARGET present after dirname(src)+target:      ${impJoined}/${impRows.length}`)

/** The window cannot answer whether an imports target is real: the probe offered 150
 *  files per repo, so an imported file outside that set is absent from brain_file
 *  whether or not it exists. The FULL corpus of the repo CAN answer it, so that is
 *  the decidable question and it is the one the analyzer's correctness rests on --
 *  an imports edge asserts "this file imports that file". */
let impCorpusByBase = 0
let impCorpusByJoin = 0
const impCorpusMiss: string[] = []
for (const r of impRows) {
  const ix = indexes.get(r.repo)
  const t = String(r.t)
  const joined = path.normalize(path.join(path.dirname(String(r.s ?? "")), t))
  const byBase = ix ? ix.baseNames.has(path.basename(t)) : false
  const byJoin = ix ? ix.paths.has(joined) : false
  if (byBase) impCorpusByBase++
  if (byJoin) impCorpusByJoin++
  if (!byBase && impCorpusMiss.length < 15)
    impCorpusMiss.push(`  ${r.repo.padEnd(22)} ${String(r.s).padEnd(34)} -> ${t.padEnd(34)} joined ${joined}`)
}
console.log(`\n  imports TARGET exists in the repo's FULL corpus by basename: ${impCorpusByBase}/${impRows.length}`)
console.log(`  imports TARGET exists in the repo's FULL corpus by dirname(src)+target: ${impCorpusByJoin}/${impRows.length}`)
if (impCorpusMiss.length > 0) {
  console.log("  targets absent from the full corpus by basename (these would be FABRICATED paths):")
  for (const l of impCorpusMiss) console.log(l)
}
if (impMisses.length > 0) {
  console.log("  joined misses (target, and the joined path that was not in brain_file):")
  for (const l of impMisses) console.log(l)
}

/** classify one distinct target against the repo's whole-corpus index */
function classify(repo: string, t: string): "strong" | "fieldish" | "text" | "absent" {
  const ix = indexes.get(repo)
  const b = bare(t)
  if (!ix) return "absent"
  if (ix.strong.has(b)) return "strong"
  if (ix.fieldish.has(b)) return "fieldish"
  if (ix.present.has(b)) return "text"
  return "absent"
}

// ---------------------------------------------------------------- dotted
console.log(`\n=== dotted unresolved targets: ${dottedRows.length} distinct ===`)
const dBuckets = new Map<string, number>()
const dSamples = new Map<string, string[]>()
let dSuffixPublished = 0
for (const r of dottedRows) {
  const t = String(r.t)
  const suffix = bare(t.split(".").slice(1).join("."))
  const dbPath = path.join(
    process.env.HOME ?? "",
    ".bb",
    "projects",
    getProjectId(path.join(TMP_ROOT, r.repo)),
    "brain.db",
  )
  const db = new Database(dbPath, { readonly: true })
  const pub = (db.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE name = ?`).get(suffix) as any).c
  db.close()
  if (pub > 0) dSuffixPublished += r.n

  // classify the FINAL SEGMENT, not the whole dotted target: isBareName("Query.me") is
// false, so classifying the whole string put all 1,922 edges in one bucket. That was
// this probe's own bug, not a property of the corpus.
const k = isBareName(suffix) ? classify(r.repo, suffix) : "absent"
  dBuckets.set(k, (dBuckets.get(k) ?? 0) + r.n)
  let arr = dSamples.get(k)
  if (!arr) dSamples.set(k, (arr = []))
  if (arr.length < 12)
    arr.push(
      `  ${r.repo.padEnd(22)} ${t.padEnd(46)} n=${String(r.n).padStart(4)} suffix published in project: ${pub > 0 ? `YES(${pub})` : "no"}`,
    )
}
for (const [k, v] of [...dBuckets.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  final segment ${k.padEnd(10)} ${String(v).padStart(6)} edges`)
  for (const l of dSamples.get(k) ?? []) console.log(l)
}
console.log(`  edges whose dotted final segment IS published in that project: ${dSuffixPublished}`)
let dWhole = 0
for (const r of dottedRows) {
  const db = new Database(
    path.join(process.env.HOME ?? "", ".bb", "projects", getProjectId(path.join(TMP_ROOT, r.repo)), "brain.db"),
    { readonly: true },
  )
  const c = (db.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE name = ?`).get(String(r.t)) as any).c
  db.close()
  if (c > 0) dWhole += r.n
}
console.log(`  edges whose dotted whole string is published: ${dWhole}`)

// ---------------------------------------------------------------- bare, not spec
console.log(`\n=== bare, not spec, unresolved: ${bareRows.length} distinct targets, ${bareRows.reduce((a, r) => a + r.n, 0)} edges ===`)
const bBuckets = new Map<string, number>()
const bSamples = new Map<string, string[]>()
for (const r of bareRows) {
  const k = classify(r.repo, String(r.t))
  bBuckets.set(k, (bBuckets.get(k) ?? 0) + r.n)
  let arr = bSamples.get(k)
  if (!arr) bSamples.set(k, (arr = []))
  if (arr.length < 14) arr.push(`  ${r.repo.padEnd(22)} ${String(r.t).padEnd(30)} n=${String(r.n).padStart(4)}`)
}
for (const [k, v] of [...bBuckets.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${String(v).padStart(6)} edges`)
  for (const l of bSamples.get(k) ?? []) console.log(l)
}

// ---------------------------------------------------------------- other shapes
console.log(`\n=== neither spec nor a bare type name: ${shapeRows.length} distinct targets, ${shapeRows.reduce((a, r) => a + r.n, 0)} edges ===`)
for (const r of shapeRows.slice(0, 30)) console.log(`  ${r.repo.padEnd(22)} ${String(r.t).padEnd(46)} n=${r.n}`)