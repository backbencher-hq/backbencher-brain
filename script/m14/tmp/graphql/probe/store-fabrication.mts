/**
 * Fabrication audit at the STORE, over the whole population.
 *
 * The 3,060 edges store-partition.mts classified `absent` are the only unresolved
 * targets with no explanation left. An edge is honest if the file it comes from
 * actually writes the target name; it is FABRICATED if the analyzer named a target
 * the source file never mentions. That is decidable from the file text, so it is
 * decided here rather than argued, and it covers all 18,789 target-unresolved edges
 * rather than a sample.
 *
 * The source file is recovered from the symbol key, whose shape is
 * `<projectHash>:<relative_path>:<SymbolName>:<line>` (observed in the store dump).
 * `.gql` is read as well as `.graphql`: an earlier draft grepped only `.graphql` and
 * so reported "not in file" for names that live in `.gql`.
 *
 * Name forms compared, all after stripping a leading @:
 *   bare        `Picture`            -> /\bPicture\b/ anywhere in the file
 *   dotted      `Picture.width`      -> the file must contain BOTH `Picture` and
 *                                      `width`; a dotted target whose owner never
 *                                      appears is a different defect from one whose
 *                                      field does not, and the two are counted apart
 *
 * Usage: npx tsx script/m14/tmp/graphql/probe/store-fabrication.mts
 */
import * as fs from "fs"
import * as path from "path"
import Database from "better-sqlite3"
import { getProjectId } from "../../../../../src/util/project-id"

const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const TMP_ROOT = "/tmp/opencode/m14-store-resolution-multi"

function corpusDirFor(repo: string): string | null {
  for (const c of [repo, repo.startsWith("gql-") ? repo.slice(4) : `gql-${repo}`]) {
    const d = path.join(CORPUS, c)
    if (fs.existsSync(d)) return d
  }
  return null
}

const textCache = new Map<string, string | null>()
function fileText(repo: string, rel: string): string | null {
  const k = `${repo}${rel}`
  const hit = textCache.get(k)
  if (hit !== undefined) return hit
  const dir = corpusDirFor(repo)
  let txt: string | null = null
  if (dir) {
    try {
      txt = fs.readFileSync(path.join(dir, rel), "utf8")
    } catch {
      txt = null
    }
  }
  textCache.set(k, txt)
  return txt
}

const bare = (t: string): string => (t.startsWith("@") ? t.slice(1) : t)
const word = (n: string): RegExp => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)

interface Bucket {
  dotted: { ownerMissing: number; fieldMissing: number; both: number }
  bare: { present: number; missing: number }
  other: number
}
const buckets = new Map<string, Bucket>()
const misses: string[] = []

/** Adds the ROW'S EDGE COUNT, not 1. The first draft incremented by one per
 *  (relationship_type, source_symbol_id, target_external) group, so the buckets came
 *  to 14,938 while the audited population was 18,390 -- the totals did not reconcile
 *  and the audit did not bind the population it claimed to cover. */
function bump(b: Bucket, kind: "dotted" | "bare" | "other", sub: string, n: number): void {
  const slot = b[kind] as Record<string, number>
  slot[sub] = (slot[sub] ?? 0) + n
}

const repos = fs
  .readdirSync(TMP_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

let audited = 0
let noFile = 0
let noSource = 0
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

  const rows = db
    .prepare(
      `SELECT relationship_type rt, source_symbol_id sid, target_external t, COUNT(*) n
       FROM brain_relationship WHERE target_symbol_id IS NULL AND source_symbol_id IS NOT NULL
       GROUP BY relationship_type, source_symbol_id, target_external`,
    )
    .all() as any[]

  for (const r of rows) {
    // `<projectHash>:<relative_path>:<SymbolName>:<line>` -- the relative path is the
    // only segment that can contain a '/', so take it by scanning for the first ':'
    // after the hash and the last ':' pair.
    const key = String(r.sid)
    const firstColon = key.indexOf(":")
    const rest = key.slice(firstColon + 1)
    const lastColon = rest.lastIndexOf(":")
    const beforeLast = rest.slice(0, lastColon)
    const secondColon = beforeLast.indexOf(":")
    const rel = secondColon === -1 ? beforeLast : beforeLast.slice(0, secondColon)
    const srcName = secondColon === -1 ? beforeLast : beforeLast.slice(secondColon + 1)

    const t = String(r.t ?? "")
    const b = bare(t)
    const txt = fileText(repo, rel)
    if (txt === null) {
      noFile += r.n
      continue
    }
    audited += r.n
    let bk = buckets.get(r.rt)
    if (!bk) buckets.set(r.rt, (bk = { dotted: { ownerMissing: 0, fieldMissing: 0, both: 0 }, bare: { present: 0, missing: 0 }, other: 0 }))

    if (t.includes(".")) {
      const owner = b.split(".")[0]
      const field = b.split(".").slice(1).join(".")
      const ownerHit = word(owner).test(txt)
      const fieldHit = word(field).test(txt)
      if (!ownerHit && !fieldHit) {
        bump(bk, "dotted", "both", r.n)
        if (misses.length < 40) misses.push(`DOTTED-BOTH ${repo} ${rel} ${srcName} -> ${t} n=${r.n}`)
      } else if (!ownerHit) {
        bump(bk, "dotted", "ownerMissing", r.n)
        if (misses.length < 40) misses.push(`DOTTED-OWNER ${repo} ${rel} ${srcName} -> ${t} n=${r.n}`)
      } else if (!fieldHit) {
        bump(bk, "dotted", "fieldMissing", r.n)
        if (misses.length < 40) misses.push(`DOTTED-FIELD ${repo} ${rel} ${srcName} -> ${t} n=${r.n}`)
      } else bump(bk, "dotted", "both", r.n)
    } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(b)) {
      if (word(b).test(txt)) bump(bk, "bare", "present", r.n)
      else {
        bump(bk, "bare", "missing", r.n)
        if (misses.length < 40) misses.push(`BARE-MISSING ${repo} ${rel} ${srcName} -> ${t} n=${r.n}`)
      }
    } else bump(bk, "other", "x", r.n)
  }
  db.close()
}

console.log(`audited ${audited} target-unresolved edges whose SOURCE FILE was readable`)
console.log(`skipped: ${noFile} edges whose source file was not found in the corpus, ${noSource} with no source symbol\n`)
for (const [rt, b] of [...buckets.entries()].sort()) {
  console.log(`${rt}`)
  console.log(`  dotted  both segments in file ${b.dotted.both}   owner missing ${b.dotted.ownerMissing}   field missing ${b.dotted.fieldMissing}`)
  console.log(`  bare    present ${b.bare.present}   MISSING ${b.bare.missing}`)
  console.log(`  other   ${b.other}`)
}
console.log(`\nsamples of a target absent from its own source file:`)
for (const l of misses) console.log(`  ${l}`)