/**
 * ZIG OWNER-PATH PROBE (C7) — is a relationship's SOURCE a published name, and
 * does the edge read as the walk the graph performs?
 *
 * ## The defect it measures
 *
 * `real-zig-analyzer.ts` published a container member's `scope`/`ownerName` as
 * the container's BARE name, while the shared projection spells a symbol
 * `scope ? scope + "." + name : name` (pool-worker.ts:930). A container
 * therefore published its ABSOLUTE name and its members published a RELATIVE
 * one, so the two halves of ONE nesting landed in two coordinate systems:
 *
 * ```zig
 * pub const IOSurface = struct {      // ghostty/pkg/macos/iosurface/iosurface.zig:10
 *     pub const Error = error{         // container -> qn `IOSurface.Error`
 *         InvalidOperation,            // member    -> qn `Error.InvalidOperation`
 * ```
 *
 * The member is then unreachable from the only spelling that identifies its
 * container, and the `contains` edge's source is not a published qualified name
 * at all.
 *
 * ## Why this is a SEPARATE instrument from the census merge
 *
 * `shard-merge.py` resolves an endpoint against the name SETS, and the choice
 * of set is a choice the instrument makes. These two questions do not depend on
 * it:
 *
 *   1. `sourceIsPublishedQName` — the edge's source is a published
 *      `qualifiedName` in the file. A graph that binds endpoints by qualified
 *      name reaches the declaration; one that binds by bare name may not.
 *   2. `compositionResolvable` — `source + "." + target` is itself a published
 *      `qualifiedName`. This IS the member's published spelling, so it is the
 *      walk from container to member, read off the published shape alone.
 *
 * Both are computed per type and per file, and a zero over a non-empty
 * population is refused rather than printed as a pass.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/owner-path-probe.ts <sharddir>
 *   where <sharddir> holds raw-N.json from ontology-census.ts --raw
 */
import { readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"

const MARKERS = new Set(["(global)", "(file)", "(declared-type)", "(module)", "(package)"])
const shardDir = process.argv[2]
if (!shardDir) {
  console.error("usage: owner-path-probe.ts <sharddir with raw-N.json>")
  process.exit(2)
}
const dumps = readdirSync(shardDir)
  .filter((f) => f.startsWith("raw-") && f.endsWith(".json"))
  .sort()
if (dumps.length === 0) {
  console.error(`REFUSING: no raw-N.json in ${shardDir}. Point it at the --raw dumps.`)
  process.exit(2)
}

interface Row {
  count: number
  marker: number
  srcQName: number
  srcBareOnly: number
  srcDangling: number
  comp: number
}
const byType = new Map<string, Row>()
const failing = new Map<string, { count: number; files: Set<string>; example: string }>()
let files = 0
let edges = 0

const row = (t: string): Row => {
  let r = byType.get(t)
  if (!r) {
    r = { count: 0, marker: 0, srcQName: 0, srcBareOnly: 0, srcDangling: 0, comp: 0 }
    byType.set(t, r)
  }
  return r
}

for (const d of dumps) {
  const raw = JSON.parse(readFileSync(path.join(shardDir, d), "utf8")) as {
    drawFiles: string[]
    fileNames: Record<string, string[]>
    fileQNames: Record<string, string[]>
    edges: { t: string; src: string; tgt: string; file: number }[]
  }
  if (!raw.fileQNames) {
    console.error(`REFUSING: ${d} carries no fileQNames. Re-run the census with the current instrument.`)
    process.exit(2)
  }
  const keys = raw.drawFiles
  const names = new Map<string, Set<string>>()
  const qnames = new Map<string, Set<string>>()
  for (const [i, v] of Object.entries(raw.fileNames)) names.set(keys[Number(i)], new Set(v))
  for (const [i, v] of Object.entries(raw.fileQNames)) qnames.set(keys[Number(i)], new Set(v))
  files += keys.length
  for (const e of raw.edges) {
    edges++
    const r = row(e.t)
    r.count++
    const f = keys[e.file]
    const qn = qnames.get(f) ?? new Set<string>()
    const nm = names.get(f) ?? new Set<string>()
    if (MARKERS.has(e.src)) {
      r.marker++
      continue
    }
const srcQ = qn.has(e.src)
    if (srcQ) r.srcQName++
    else if (nm.has(e.src)) r.srcBareOnly++
    else r.srcDangling++
    // Composition is an invariant of OWNERSHIP edges ONLY. For `contains` the
    // source IS the container and `source.target` is the member's published
    // spelling, so the test is the walk from container to member. For `uses`,
    // `calls` and `instantiates` the source is the enclosing function and the
    // target is an unrelated declaration, so `source.target` is a category error
    // and is NOT counted — publishing it as a failure set would report 155k
    // "defects" that are the shape of the language working.
    if (e.t === "contains") {
      if (srcQ && qn.has(`${e.src}.${e.tgt}`)) r.comp++
      if (!srcQ || !qn.has(`${e.src}.${e.tgt}`)) {
        const shape = !srcQ
          ? nm.has(e.src)
            ? "source-not-a-published-qualified-name"
            : "source-published-nowhere-in-file"
          : "member-not-spelled-under-source"
        const rec = failing.get(shape) ?? { count: 0, files: new Set<string>, example: "" }
        rec.count++
        rec.files.add(f)
        if (!rec.example) rec.example = `${f}: ${e.t} ${e.src} -> ${e.tgt}`
        failing.set(shape, rec)
      }
    }
  }
}

const pct = (a: number, b: number): string => (b === 0 ? "  n/a" : `${((a / b) * 100).toFixed(2)}%`)
console.log(`population ${files} files · ${edges} edges · ${dumps.length} shard dump(s)`)
console.log()
console.log(
  "type".padEnd(16) +
    "count".padStart(9) +
    "marker".padStart(9) +
    "srcQName".padStart(10) +
    "srcBare".padStart(9) +
    "srcDangl".padStart(9) +
    "composOK".padStart(10),
)
for (const [t, r] of [...byType].sort((a, b) => b[1].count - a[1].count)) {
  console.log(
    t.padEnd(16) +
      String(r.count).padStart(9) +
      String(r.marker).padStart(9) +
      pct(r.srcQName, r.count).padStart(10) +
      pct(r.srcBareOnly, r.count).padStart(9) +
      pct(r.srcDangling, r.count).padStart(9) +
      pct(r.comp, r.count).padStart(10),
  )
}
console.log()
console.log("`contains` EDGES FAILING EITHER TEST, BY SHAPE")
for (const [shape, rec] of [...failing].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${shape.padEnd(42)} ${String(rec.count).padStart(7)}  ${String(rec.files.size).padStart(4)} files`)
  console.log(`      e.g. ${rec.example}`)
}
if (edges === 0) {
  console.error("REFUSING: 0 edges read. An empty result over a non-empty population is not a pass.")
  process.exit(1)
}
