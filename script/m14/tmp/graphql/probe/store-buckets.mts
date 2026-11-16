/**
 * Follow-up on out/store-resolution-multi.log: WHY the three non-spec buckets fail.
 *
 *   imports          66 edges, 0.00% target-resolved  -- total failure
 *   dotted         1922 edges, 1302 distinct          -- strategy 3 SHOULD match the suffix
 *   bare, not spec 3634 edges, 1122 distinct          -- window effect, or genuinely absent?
 *
 * Reads the SAME 8 project databases the multi probe wrote. No re-index: the
 * project_id of each TMP dir is the sha1 of its realpath (src/util/project-id.ts:26).
 *
 * The three questions are DECIDED here, not argued:
 *
 *  - dotted: is the final segment published as a brain_symbol.name in that project?
 *    If yes, the store's strategy-3 suffix match had a target to find and did not
 *    take it -> the format mismatch is still live at the store. If no, there was
 *    nothing in the window to find and the edge is a window artifact.
 *
 *  - bare, not spec: the probe holds a 150-file CAP per repo, so a target absent
 *    from the project may simply be declared in file 151. Each name is looked up
 *    in the WHOLE corpus of its repo by a one-pass declaration index, so the
 *    window effect and a genuinely-missing declaration are two populations, not
 *    one. (The first draft re-read every corpus file per name; that is quadratic
 *    and was replaced.)
 *
 *  - imports: every row, with the metadata the analyzer attached, and the shape of
 *    the target string.
 *
 * Usage: npx tsx script/m14/tmp/graphql/probe/store-buckets.mts
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

const bare = (t: string): string => (t.startsWith("@") ? t.slice(1) : t)
const isSpec = (t: string): boolean => {
  const b = bare(t)
  return SPEC_SCALARS.has(b) || SPEC_DIRECTIVES.has(b) || SPEC_INTROSPECTION.test(b)
}
const isBareName = (t: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(bare(t))

/** Whole-corpus declaration index, built in ONE pass per repo.
 *  A declaration is a whole-line anchored `type|input|interface|union|enum|scalar|
 *  schema|directive NAME` — a mention on a field's type line is a USE, not a
 *  declaration, so this deliberately does not count it. */
const DECL_RE = /^\s*(?:extend\s+)?(type|input|interface|union|enum|scalar|schema|directive)\s+@?([A-Za-z_][A-Za-z0-9_]*)/

const repos = fs
  .readdirSync(TMP_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

console.log(`project dbs: ${repos.length}`)

const declared = new Map<string, Set<string>>()
const corpusFiles = new Map<string, number>()
for (const r of repos) {
  const names = r.startsWith("gql-") ? r.slice(4) : r
  const dir = path.join(CORPUS, names)
  if (!fs.existsSync(dir)) {
    console.log(`  ${names.padEnd(24)} NOT IN CORPUS (tmp dir name: ${r})`)
    continue
  }
  const rels = collect(dir)
  corpusFiles.set(names, rels.length)
  for (const rel of rels) {
    let txt: string
    try {
      txt = fs.readFileSync(path.join(dir, rel), "utf8")
    } catch {
      continue
    }
    for (const line of txt.split("\n")) {
      const m = DECL_RE.exec(line)
      if (!m) continue
      const key = m[2]
      let set = declared.get(key)
      if (!set) declared.set(key, (set = new Set()))
      set.add(`${names}/${rel}`)
    }
  }
}
console.log(`declaration index: ${declared.size} distinct declared names over ${corpusFiles.size} repos`)
for (const [k, v] of corpusFiles) console.log(`  ${k.padEnd(24)} ${String(v).padStart(5)} .graphql/.gql files in corpus`)

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
let unresolvedTargets = 0
const byType = new Map<string, { n: number; un: number }>()

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
      `SELECT relationship_type rt, COUNT(*) n, SUM(CASE WHEN target_symbol_id IS NULL THEN 1 ELSE 0 END) un
       FROM brain_relationship GROUP BY relationship_type`,
    )
    .all() as any[]) {
    const cur = byType.get(r.rt) ?? { n: 0, un: 0 }
    cur.n += r.n
    cur.un += r.un ?? 0
    byType.set(r.rt, cur)
    edges += r.n
    unresolvedTargets += r.un ?? 0
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
       GROUP BY target_external ORDER BY n DESC LIMIT 60`,
    )
    .all() as any[]) dottedRows.push({ repo, ...r })

  for (const r of db
    .prepare(
      `SELECT source_external s, target_external t, COUNT(*) n FROM brain_relationship
       WHERE target_symbol_id IS NULL AND target_external NOT LIKE '%.%'
       GROUP BY target_external ORDER BY n DESC LIMIT 200`,
    )
    .all() as any[]) {
    if (isSpec(r.t)) continue
    if (!isBareName(r.t)) shapeRows.push({ repo, ...r })
    else bareRows.push({ repo, ...r })
  }

  db.close()
}

console.log(`\n=== population: ${edges} relationships, ${unresolvedTargets} target-unresolved ===`)
for (const [t, v] of [...byType.entries()].sort((a, b) => b[1].n - a[1].n))
  console.log(`  ${t.padEnd(12)} ${String(v.n).padStart(6)} edges  ${String(v.un).padStart(6)} target-unresolved`)

// ---------------------------------------------------------------- imports
console.log(`\n=== imports: ${impRows.length} edges ===`)
const tgtShapes = new Map<string, number>()
for (const r of impRows) {
  const k = String(r.t ?? "").replace(/[^:/]/g, "")
  tgtShapes.set(k, (tgtShapes.get(k) ?? 0) + 1)
}
console.log(`  target shapes (non-alnum stripped): ${JSON.stringify([...tgtShapes.entries()])}`)
const isPath = (s: string | null): boolean => !!s && /[/.]/.test(s) && !s.includes(" ")
console.log(`  sources that look like FILE PATHS: ${impRows.filter((r) => isPath(r.s)).length}/${impRows.length}`)
console.log(`  targets that look like FILE PATHS: ${impRows.filter((r) => isPath(r.t)).length}/${impRows.length}`)
console.log(`  repos carrying imports edges: ${JSON.stringify([...new Set(impRows.map((r) => r.repo))])}`)
for (const r of impRows.slice(0, 12))
  console.log(`  ${r.repo.padEnd(22)} ${String(r.s).slice(0, 40).padEnd(42)} -> ${String(r.t).slice(0, 40).padEnd(42)} ln ${r.ln} meta ${String(r.meta ?? "").slice(0, 80)}`)

// ---------------------------------------------------------------- dotted
// Decide it: does the final segment exist as a published brain_symbol.name in that
// project? If it does, the store had a target to match and left it unresolved.
console.log(`\n=== dotted targets: ${dottedRows.length} distinct (top 60 by edges) ===`)
let dottedSuffixPublished = 0
let dottedSuffixAbsent = 0
let dottedWholePublished = 0
const dottedSamples: string[] = []
for (const r of dottedRows) {
  const t = String(r.t)
  const suffix = t.split(".").slice(1).join(".")
  const dbPath = path.join(
    process.env.HOME ?? "",
    ".bb",
    "projects",
    getProjectId(path.join(TMP_ROOT, r.repo)),
    "brain.db",
  )
  const db = new Database(dbPath, { readonly: true })
  const pub = db.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE name = ?`).get(suffix) as any
  const pubWhole = db.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE name = ?`).get(t) as any
  db.close()
  if (pub.c > 0) dottedSuffixPublished += r.n
  else dottedSuffixAbsent += r.n
  if (pubWhole.c > 0) dottedWholePublished += r.n
  if (dottedSamples.length < 30)
    dottedSamples.push(
      `  ${r.repo.padEnd(22)} ${t.padEnd(48)} n=${String(r.n).padStart(4)}  suffix ${suffix.padEnd(28)} published ${pub.c > 0 ? `YES(${pub.c})` : "no"}`,
    )
}
console.log(dottedSamples.join("\n"))
console.log(`  edges on a dotted target whose FINAL SEGMENT is published in that project: ${dottedSuffixPublished}`)
console.log(`  edges on a dotted target whose final segment is NOT published:            ${dottedSuffixAbsent}`)
console.log(`  edges on a dotted target whose WHOLE string is published:                  ${dottedWholePublished}`)

// ---------------------------------------------------------------- bare, not spec
console.log(`\n=== bare, not spec: ${bareRows.length} distinct targets ===`)
const bucket = { declaredSomewhere: 0, nowhere: 0 }
const nowhere: string[] = []
for (const r of bareRows) {
  const hit = declared.get(bare(String(r.t)))
  if (hit && hit.size > 0) bucket.declaredSomewhere += r.n
  else {
    bucket.nowhere += r.n
    nowhere.push(`${r.repo.padEnd(22)} ${String(r.t).padEnd(30)} n=${r.n}`)
  }
}
console.log(`  edges whose target IS declared in the whole repo (outside the 150-file window): ${bucket.declaredSomewhere}`)
console.log(`  edges whose target is declared NOWHERE in the whole repo:                          ${bucket.nowhere}`)
console.log("  targets declared nowhere, by edge count:")
for (const l of nowhere.sort((a, b) => Number(b.match(/n=(\d+)/)?.[1] ?? 0) - Number(a.match(/n=(\d+)/)?.[1] ?? 0)).slice(0, 30))
  console.log(`    ${l}`)

// ---------------------------------------------------------------- other shapes
console.log(`\n=== neither spec nor a bare type name: ${shapeRows.length} distinct targets ===`)
for (const r of shapeRows.slice(0, 25)) console.log(`  ${r.repo.padEnd(22)} ${String(r.t).padEnd(46)} n=${r.n}`)