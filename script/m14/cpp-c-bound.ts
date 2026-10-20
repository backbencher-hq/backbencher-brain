/**
 * cpp-c-bound — BUCKET C's SPLIT, WITH ITS BOUND.
 *
 * THE QUESTION. The C++ lane's W1 wall (614,081 `calls` rows whose callee leaf no file in the per-file
 * population declares) was priced into four buckets (CPP-D7-WALLS.md). Bucket **C** is the largest:
 * **370,246 rows** — a MEMBER leaf whose owner the spelling does not name. It is RECEIVER TYPING, not an
 * index question: the index can BOUND the candidate owners, it cannot CHOOSE, because the choice is a fact
 * about the RECEIVER and the receiver is not in the spelling.
 *
 * **THE SPLIT** (the D7 page's): `C/member-leaf-many-owners-receiver-typing` 267,083 and
 * `C/member-leaf-one-owner-receiver-typing` 103,163.
 *
 * **THE BOUND** — and this is what the instrument adds: HOW MANY OF THOSE ROWS A RECEIVER FACT COULD
 * DECIDE. The bound is not a hope; it is the JOIN of two whole-population measurements:
 *
 *   1. the four-bucket partition's PER-ROW buckets (written by `script/m14/cpp-d-package-scope.ts` with
 *      `--rows-out`), and
 *   2. the receiver census's PER-ROW classes (written by `script/m14/cpp-receiver-census.ts` with
 *      `--rows-out`), which say, for each residual call row, WHAT RECEIVER EVIDENCE THE SYNTAX ALREADY
 *      CARRIES — `implicit-this` (the enclosing class declares the leaf in-file), `constructor-temp` (the
 *      receiver is a call/new expression), `typed-local` (the receiver is a local or parameter whose
 *      WRITTEN type is known), `smart-or-container` (the written type names its pointee/element), and
 *      `namespace-qualified` — and, as a SECOND fact, whether the owner actually DECLARES the leaf.
 *
 * The join is what makes the bound MEASURED: a class count over the whole population cannot be
 * intersected with a subset defined elsewhere, so both sides are written per row and joined on
 * (file, line, target).
 *
 * **WHAT THE BOUND MEANS.** A row is DECIDABLE when the receiver's type is named by the syntax AND the
 * index's inheritance-closed member view says that owner declares the leaf (`CLOSURE-VERIFIABLE`): the
 * row then resolves to exactly one declaration, with no ambiguity and no `arbitraryTwin` risk. A row whose
 * receiver is named but whose owner does not declare the leaf is NOT decidable — the row would bind to
 * nothing — and a row whose receiver is opaque is not decidable at all. The classes that are NOT decidable
 * are the bound's complement, and they are reported, not hidden.
 *
 * USAGE
 *   bun run script/m14/cpp-c-bound.ts \
 *     --buckets=validation/m14/fixtures/cpp/measurements/cpp-w1-buckets.tsv \
 *     --receivers=validation/m14/fixtures/cpp/measurements/cpp-receiver-rows.tsv \
 *     [--json=<path>]
 *
 * EXIT: 0 bounded · 2 usage/environment · 3 CONTROL DID NOT FIRE.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const BUCKETS = argOf("--buckets")
const RECEIVERS = argOf("--receivers")
const JSON_OUT = argOf("--json")
if (!BUCKETS || !RECEIVERS) {
  console.error("usage: bun run script/m14/cpp-c-bound.ts --buckets=<tsv> --receivers=<tsv> [--json=<path>]")
  process.exit(2)
}

const readTsv = (p: string): string[][] => {
  const abs = path.resolve(ROOT, p)
  const out: string[][] = []
  for (const line of readFileSync(abs, "utf8").split("\n")) {
    if (line.length === 0) continue
    out.push(line.split("\t"))
  }
  return out
}

// ── the buckets: (file, line, target) -> bucket ───────────────────────────────────────────────────
const bucketRows = readTsv(BUCKETS)
const bucketOf = new Map<string, string>()
for (const r of bucketRows) {
  if (r.length < 4) continue
  bucketOf.set(`${r[0]}\u0000${r[1]}\u0000${r[2]}`, r[3])
}
if (bucketOf.size === 0) { console.error(`cpp-c-bound: no bucket rows read from ${BUCKETS}`); process.exit(3) }

// ── the receiver classes: (file, line, target) -> class key ─────────────────────────────────────────
const receiverRows = readTsv(RECEIVERS)
const receiverOf = new Map<string, string>()
for (const r of receiverRows) {
  if (r.length < 4) continue
  receiverOf.set(`${r[0]}\u0000${r[1]}\u0000${r[2]}`, r[3])
}
if (receiverOf.size === 0) { console.error(`cpp-c-bound: no receiver rows read from ${RECEIVERS}`); process.exit(3) }

// ── the join ───────────────────────────────────────────────────────────────────────────────────────
type BucketStats = {
  rows: number
  joined: number
  unjoined: number
  decidable: number
  byClass: Record<string, number>
  unjoinedByBucket: Record<string, number>
}
const stats: Record<string, BucketStats> = {}
for (const b of ["A", "B", "C", "D"]) {
  stats[b] = { rows: 0, joined: 0, unjoined: 0, decidable: 0, byClass: {}, unjoinedByBucket: {} }
}
for (const [key, bucket] of bucketOf) {
  const st = stats[bucket]
  if (!st) continue
  st.rows++
  const cls = receiverOf.get(key)
  if (cls === undefined) { st.unjoined++; st.unjoinedByBucket[bucket] = (st.unjoinedByBucket[bucket] ?? 0) + 1; continue }
  st.joined++
  st.byClass[cls] = (st.byClass[cls] ?? 0) + 1
  if (cls.endsWith("|CLOSURE-VERIFIABLE")) st.decidable++
}

// ── the CONTROL: the buckets must sum to the rows read, and C must be non-empty ─────────────────────
const sumRows = Object.values(stats).reduce((a, s) => a + s.rows, 0)
if (sumRows !== bucketOf.size) {
  console.error(`CONTROL DID NOT FIRE: the bucket counts sum to ${sumRows} but ${bucketOf.size} bucket rows were read.`)
  process.exit(3)
}
if (stats.C.rows === 0) {
  console.error("CONTROL DID NOT FIRE: bucket C holds ZERO rows — a zero-row bucket is a MISSING MEASUREMENT, not an empty class.")
  process.exit(3)
}

const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-c-bound.ts",
  measuredAt: new Date().toISOString(),
  inputs: { buckets: BUCKETS, receivers: RECEIVERS },
  population: { bucketRows: bucketOf.size, receiverRows: receiverOf.size },
  buckets: stats,
  bucketC: {
    rows: stats.C.rows,
    joined: stats.C.joined,
    unjoined: stats.C.unjoined,
    decidable: stats.C.decidable,
    decidableShare: `${((stats.C.decidable / Math.max(1, stats.C.rows)) * 100).toFixed(2)}%`,
    byClass: Object.fromEntries(Object.entries(stats.C.byClass).sort((a, b) => b[1] - a[1])),
    note: "the BOUND: the rows of bucket C whose receiver is named by the syntax AND whose owner declares the leaf in the index's inheritance-closed view — the rows a receiver fact decides outright, with no ambiguity and no arbitraryTwin risk.",
  },
  bucketCSplit: {
    manyOwners: stats.C.byClass["many-owners"] ?? null,
    note: "the one-owner / many-owner split is the D7 partition's own sub-split and is re-derived by the bucket partition; the per-ROW classes here are the RECEIVER classes, which is the other half of the same question.",
  },
}
const json = JSON.stringify(report, null, 1) + "\n"
if (JSON_OUT) {
  const fs = await import("node:fs")
  const t = path.resolve(ROOT, JSON_OUT)
  fs.mkdirSync(path.dirname(t), { recursive: true })
  fs.writeFileSync(t, json)
}
console.log(`cpp-c-bound — bucket rows ${bucketOf.size} · receiver rows ${receiverOf.size}`)
for (const b of ["A", "B", "C", "D"]) {
  const s = stats[b]
  console.log(`  ${b}: rows ${s.rows} · joined ${s.joined} · unjoined ${s.unjoined} · DECIDABLE ${s.decidable} (${((s.decidable / Math.max(1, s.rows)) * 100).toFixed(2)}%)`)
}
console.log("BUCKET C BY RECEIVER CLASS")
for (const [k, v] of Object.entries(stats.C.byClass).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(62)} ${String(v).padStart(7)}`)
