/**
 * The resolution decomposition, as a PARTITION. The three earlier probes each answered
 * one question; this one answers the only question the report needs, which is how the
 * 18,789 target-unresolved edges divide up. Categories are disjoint by construction,
 * so the column sums to the population and a bucket cannot hide inside another.
 *
 * Order matters: the first matching category wins, and each category's test excludes
 * the ones before it.
 *
 *   file-level        endpoint is a path matching an indexed brain_file row
 *                     (the M60/#910 contract: exports' 3,307 sources)
 *   imports-path      relationship_type='imports' and the target file EXISTS in the
 *                     repo's full corpus -- true, but outside the 150-file window
 *   imports-nonpath   relationship_type='imports' and the target is not a path at all
 *   spec-builtin      Int Float String Boolean ID, skip include deprecated specifiedBy,
 *                     or an introspection TYPE name. No corpus file can declare these.
 *   spec-introspection absent from the repo AND a field name of the spec's built-in
 *                     introspection schema. Disjoint from `absent` by the absent test,
 *                     so nothing is counted twice.
 *   directive-undeclared  absent from the repo, written with a leading @ -- a
 *                     federation/mesh directive the spec defines but this repo omits
 *   window            declared in the repo's FULL corpus, therefore simply not in the
 *                     150-file window this project holds
 *   absent            occurs NOWHERE in the repo's full corpus
 *   other-shape       anything else (e.g. a leading $)
 *
 * Usage: npx tsx script/m14/tmp/graphql/probe/store-partition.mts
 */
import * as fs from "fs"
import * as path from "path"
import Database from "better-sqlite3"
import { getProjectId } from "../../../../../src/util/project-id"

const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const TMP_ROOT = "/tmp/opencode/m14-store-resolution-multi"

const SPEC_SCALARS = new Set(["Int", "Float", "String", "Boolean", "ID"])
const SPEC_DIRECTIVES = new Set(["skip", "include", "deprecated", "specifiedBy"])
const SPEC_INTROSPECTION_TYPES = new Set([
  "__Schema",
  "__Type",
  "__Field",
  "__InputValue",
  "__EnumValue",
  "__Directive",
  "__TypeKind",
  "__DirectiveLocation",
])
/** field names of the spec's built-in introspection schema, plus __typename which is
 *  legal on every object type. Used ONLY for names already proven absent from the
 *  repo, so it can never absorb a corpus-declared field. */
const SPEC_INTROSPECTION_FIELDS = new Set([
  "kind",
  "name",
  "description",
  "specifiedByURL",
  "fields",
  "interfaces",
  "possibleTypes",
  "enumValues",
  "inputFields",
  "ofType",
  "args",
  "type",
  "isDeprecated",
  "deprecationReason",
  "defaultValue",
  "locations",
  "isRepeatable",
  "types",
  "queryType",
  "mutationType",
  "subscriptionType",
  "directives",
  "includeDeprecated",
  "__typename",
])

const bare = (t: string): string => (t.startsWith("@") ? t.slice(1) : t)
const STRONG_RE =
  /^\s*(?:extend\s+)?(type|input|interface|union|enum|scalar|schema|directive)\s+@?([A-Za-z_][A-Za-z0-9_]*)/
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

function corpusDirFor(repo: string): string | null {
  for (const c of [repo, repo.startsWith("gql-") ? repo.slice(4) : `gql-${repo}`]) {
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

const repos = fs
  .readdirSync(TMP_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

const indexes = new Map<string, RepoIndex>()
for (const repo of repos) {
  const dir = corpusDirFor(repo)
  if (!dir) continue
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
}

const CATS = [
  "file-level",
  "imports-path",
  "imports-nonpath",
  "spec-builtin",
  "spec-introspection",
  "directive-undeclared",
  "window",
  "absent",
  "other-shape",
] as const
type Cat = (typeof CATS)[number]

const grid = new Map<string, Map<Cat, number>>()
const examples = new Map<string, string[]>()
/** Map.set returns the Map, not the value -- `(m.set(k, v)).push(...)` is a TypeError
 *  that cost this probe two runs. One helper, so the mistake cannot recur. */
function note(map: Map<string, string[]>, key: string, line: string, cap = 6): void {
  let arr = map.get(key)
  if (!arr) map.set(key, (arr = []))
  if (arr.length < cap) arr.push(line)
}
let totalEdges = 0
let targetUn = 0
let sourceUn = 0

for (const repo of repos) {
  const dbPath = path.join(
    process.env.HOME ?? "",
    ".bb",
    "projects",
    getProjectId(path.join(TMP_ROOT, repo)),
    "brain.db",
  )
  if (!fs.existsSync(dbPath)) continue
  const db = new Database(dbPath, { readonly: true })
  const ix = indexes.get(repo)

  totalEdges += (db.prepare(`SELECT COUNT(*) c FROM brain_relationship`).get() as any).c
  sourceUn += (
    db.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE source_symbol_id IS NULL`).get() as any
  ).c

  const rows = db
    .prepare(
      `SELECT relationship_type rt, source_external s, target_external t, COUNT(*) n
       FROM brain_relationship WHERE target_symbol_id IS NULL
       GROUP BY relationship_type, source_external, target_external`,
    )
    .all() as any[]
  targetUn += rows.reduce((a, r) => a + r.n, 0)

  for (const r of rows) {
    const t = String(r.t ?? "")
    const b = bare(t)
    let cat: Cat
    if (r.rt === "imports") {
      cat = /[/.]/.test(t) ? "imports-path" : "imports-nonpath"
    } else if (db.prepare(`SELECT 1 FROM brain_file WHERE relative_path = ?`).get(t) || db.prepare(`SELECT 1 FROM brain_file WHERE relative_path = ?`).get(String(r.s ?? ""))) {
      cat = "file-level"
    } else if (SPEC_SCALARS.has(b) || SPEC_DIRECTIVES.has(b) || SPEC_INTROSPECTION_TYPES.has(b)) {
      cat = "spec-builtin"
    } else {
      const absentFromRepo = !ix || !ix.present.has(b)
      if (absentFromRepo && SPEC_INTROSPECTION_FIELDS.has(b)) cat = "spec-introspection"
      else if (absentFromRepo && t.startsWith("@")) cat = "directive-undeclared"
      else if (ix && (ix.strong.has(b) || ix.fieldish.has(b) || ix.present.has(b))) cat = "window"
      else if (t.startsWith("$")) cat = "other-shape"
      else cat = "absent"
    }
    let g = grid.get(r.rt)
    if (!g) grid.set(r.rt, (g = new Map()))
    g.set(cat, (g.get(cat) ?? 0) + r.n)
    note(examples, `${r.rt}/${cat}`, `${repo} ${t} n=${r.n}`)
  }

  // imports-path is only a claim if the file exists; check it against the full corpus
  const impPaths = db
    .prepare(
      `SELECT source_external s, target_external t, COUNT(*) n FROM brain_relationship
       WHERE relationship_type='imports' AND target_symbol_id IS NULL GROUP BY target_external`,
    )
    .all() as any[]
  for (const r of impPaths) {
    if (!ix || !ix.baseNames.has(path.basename(String(r.t)))) {
      note(examples, "imports/imports-path-nonexistent", `${repo} ${String(r.s)} -> ${String(r.t)} n=${r.n}`, 8)
    }
  }

  db.close()
}

console.log(`population: ${totalEdges} relationships, ${targetUn} target-unresolved, ${sourceUn} source-unresolved`)
console.log(`\nper relationship_type, the partition of its TARGET-UNRESOLVED edges:\n`)
const header = ["type".padEnd(12), ...CATS.map((c) => c.slice(0, 13).padStart(14)), "TOTAL".padStart(8)]
console.log(header.join(""))
const colTotal = new Map<Cat, number>()
let grand = 0
for (const [rt, g] of [...grid.entries()].sort()) {
  const sum = [...g.values()].reduce((a, b) => a + b, 0)
  grand += sum
  for (const [c, v] of g) colTotal.set(c, (colTotal.get(c) ?? 0) + v)
  console.log(
    [rt.padEnd(12), ...CATS.map((c) => String(g.get(c) ?? 0).padStart(14)), String(sum).padStart(8)].join(""),
  )
}
console.log(
  ["ALL".padEnd(12), ...CATS.map((c) => String(colTotal.get(c) ?? 0).padStart(14)), String(grand).padStart(8)].join(""),
)
console.log(`\nsum of categories ${grand} vs target-unresolved ${targetUn}: ${grand === targetUn ? "EXACT" : `MISMATCH by ${targetUn - grand}`}`)

console.log(`\nsource-unresolved, by type:`)
for (const [rt, v] of [...colTotal.entries()].sort()) void v
const srcGrid = new Map<string, number>()
for (const repo of repos) {
  const dbPath = path.join(
    process.env.HOME ?? "",
    ".bb",
    "projects",
    getProjectId(path.join(TMP_ROOT, repo)),
    "brain.db",
  )
  if (!fs.existsSync(dbPath)) continue
  const db = new Database(dbPath, { readonly: true })
  for (const r of db
    .prepare(
      `SELECT relationship_type rt, COUNT(*) n FROM brain_relationship
       WHERE source_symbol_id IS NULL GROUP BY relationship_type`,
    )
    .all() as any[])
    srcGrid.set(r.rt, (srcGrid.get(r.rt) ?? 0) + r.n)
  db.close()
}
for (const [rt, n] of [...srcGrid.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${rt.padEnd(12)} ${String(n).padStart(6)}`)

console.log(`\nexamples per category:`)
for (const [k, ex] of [...examples.entries()].sort()) {
  console.log(`  ${k}`)
  for (const l of ex) console.log(`    ${l}`)
}