/**
 * SCSS CENSUS RUN DIFF — turns the census's run-to-run spread from a correlation into
 * arithmetic.
 *
 * ## WHY THIS EXISTS
 *
 * `scss-relationship-census.ts` samples a DETERMINISTIC file set (every admitted `.scss`
 * path, sorted, every Nth) and its EDGE COUNTS still move between runs over the same files:
 *
 *   run          degraded   contains   imports   extends
 *   committed        4        12,371    3,634     423
 *   re-run          10        12,371    3,611     423
 *   A                3        12,373    3,619     427
 *   B                7        12,374    3,619     427
 *
 * `calls`, `uses`, `references`, `exports` and `overrides` are IDENTICAL in all four, so
 * whatever moves is confined to `contains`, `imports` and `extends`.
 *
 * `scss-flaky-files.ts` bounds the spread from the other end — it takes the union of four
 * runs' failure lists and measures what those 22 files carry when parsed alone. That list
 * is a LOWER BOUND on the flaky population (it is the union of what four runs happened to
 * see, 34 failure instances drawn from 4,433 files), and the bound it produces —
 * `contains` 66, `imports` 210, `extends` 24 — is far above the observed movement of 3, 23
 * and 4. A bound above the observation cannot explain the observation, so the candidate
 * list is not sufficient and the question stays open.
 *
 * ## THE INSTRUMENT THAT SETTLES IT
 *
 * The census can write a PER-FILE sidecar (`BB_CENSUS_SIDECAR=<path>`): for every file it
 * parsed, the relationship-type counts that file contributed, keyed by corpus-relative
 * path. Two sidecars from two runs over the same file set can then be differenced file by
 * file, which is a complete account rather than a bound:
 *
 *   only in A   the file threw in B          -> B is missing it entirely
 *   only in B   the file threw in A          -> A is missing it entirely
 *   in both, DIFFERENT counts  at least one run degraded it, and the difference is exactly
 *                              the movement it contributes
 *   in both, SAME counts      stable in both, and it contributes nothing to the spread
 *
 * So the per-type movement is the sum of the per-type deltas, and every delta is attributed
 * to a named file. That is the difference between "the movement tracks the degraded list"
 * and "the movement IS these files".
 *
 * USAGE:
 *   BB_CENSUS_SIDECAR=/tmp/a.json npx tsx .../scss-relationship-census.ts 5000
 *   BB_CENSUS_SIDECAR=/tmp/b.json npx tsx .../scss-relationship-census.ts 5000
 *   npx tsx validation/m14/fixtures/scss/scss-census-run-diff.ts /tmp/a.json /tmp/b.json
 *
 * The two runs must be over the SAME sample: the script checks the admitted and sampled
 * counts and refuses to diff different populations, because a delta between two different
 * file sets is not variance.
 */
import { readFileSync } from "node:fs"

const [aPath, bPath] = process.argv.slice(2)
if (!aPath || !bPath) {
  console.error("usage: npx tsx scss-census-run-diff.ts <sidecarA.json> <sidecarB.json>")
  process.exit(2)
}

type Sidecar = {
  admitted: number
  sampled: number
  degradedFiles: string[]
  degradedFilesWithNoEdges: string[]
  edgeContributionOfDegradedFiles: Record<string, number>
  perFile: Record<string, Record<string, number>>
}
const A = JSON.parse(readFileSync(aPath, "utf8")) as Sidecar
const B = JSON.parse(readFileSync(bPath, "utf8")) as Sidecar

if (A.sampled !== B.sampled || A.admitted !== B.admitted) {
  console.error(
    `REFUSING: different populations. A admitted ${A.admitted} sampled ${A.sampled}; ` +
      `B admitted ${B.admitted} sampled ${B.sampled}. A delta across two file sets is not variance.`,
  )
  process.exit(2)
}

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const keys = new Set([...Object.keys(A.perFile), ...Object.keys(B.perFile)])

type Delta = { rel: string; kind: "only-in-A" | "only-in-B" | "differing" | "same"; delta: Record<string, number>; aDeg: boolean; bDeg: boolean }
const rows: Delta[] = []
const movement: Record<string, number> = Object.create(null)
const movementByKind: Record<string, Record<string, number>> = Object.create(null)

for (const rel of [...keys].sort()) {
  const a = A.perFile[rel]
  const b = B.perFile[rel]
  const aDeg = A.degradedFiles.includes(rel)
  const bDeg = B.degradedFiles.includes(rel)
  let kind: Delta["kind"]
  let delta: Record<string, number> = {}
  if (a && !b) kind = "only-in-A"
  else if (!a && b) kind = "only-in-B"
  else {
    const types = new Set([...Object.keys(a!), ...Object.keys(b!)])
    let diff = 0
    for (const t of types) {
      const d = (b![t] ?? 0) - (a![t] ?? 0)
      if (d !== 0) { delta[t] = d; diff += Math.abs(d) }
    }
    kind = diff === 0 ? "same" : "differing"
  }
  if (kind === "only-in-B") for (const [t, n] of Object.entries(b!)) delta[t] = n
  if (kind === "only-in-A") for (const [t, n] of Object.entries(a!)) delta[t] = -n
  rows.push({ rel, kind, delta, aDeg, bDeg })
  for (const [t, d] of Object.entries(delta)) {
    movement[t] = (movement[t] ?? 0) + d
    const byKind = (movementByKind[t] ??= Object.create(null))
    byKind[kind] = (byKind[kind] ?? 0) + d
  }
}

const differing = rows.filter((r) => r.kind === "differing")
const onlyA = rows.filter((r) => r.kind === "only-in-A")
const onlyB = rows.filter((r) => r.kind === "only-in-B")

console.log(`scss census run diff — per-file decomposition of the run-to-run spread`)
console.log(`A ${aPath}\nB ${bPath}`)
console.log(`population admitted ${A.admitted} sampled ${A.sampled} (identical in both)`)
console.log(
  `A: degraded ${A.degradedFiles.length}, of which ${A.degradedFilesWithNoEdges.length} contributed 0 edges; ` +
    `${Object.keys(A.perFile).length} files recorded`,
)
console.log(
  `B: degraded ${B.degradedFiles.length}, of which ${B.degradedFilesWithNoEdges.length} contributed 0 edges; ` +
    `${Object.keys(B.perFile).length} files recorded`,
)
console.log(`\n${rows.length} files in the union; stable in both ${rows.length - differing.length - onlyA.length - onlyB.length}`)
console.log(`differing ${differing.length}   present only in A (threw in B) ${onlyA.length}   present only in B (threw in A) ${onlyB.length}`)

console.log(`\nMOVEMENT per type — B minus A, every edge attributed to a file:`)
console.log(`${"type".padEnd(13)}${"B-A".padStart(8)}${"differing".padStart(11)}${"only-in-A".padStart(11)}${"only-in-B".padStart(11)}`)
console.log("-".repeat(54))
for (const t of ALL_TYPES) {
  const m = movement[t] ?? 0
  const k = movementByKind[t] ?? {}
  console.log(
    `${t.padEnd(13)}${(m >= 0 ? `+${m}` : `${m}`).padStart(8)}${String(k.differing ?? 0).padStart(11)}${String(k["only-in-A"] ?? 0).padStart(11)}${String(k["only-in-B"] ?? 0).padStart(11)}`,
  )
}

console.log(`\nEVERY file that moved, with its delta and whether the run saw it as degraded:`)
for (const r of [...differing, ...onlyA, ...onlyB].sort((x, y) => x.rel.localeCompare(y.rel))) {
  const shape = Object.entries(r.delta).map(([t, d]) => `${t} ${d > 0 ? "+" : ""}${d}`).join(" ")
  const deg = `${r.aDeg ? "A" : "-"}${r.bDeg ? "B" : "-"}`
  console.log(`  ${r.kind.padEnd(11)} degraded ${deg}  ${shape.padEnd(34)} ${r.rel}`)
}

console.log(
  `\nREAD: a type whose B-A movement is 0 here was IDENTICAL across these two runs, which is\n` +
    `the observation four runs already made for calls, uses, references, exports and overrides.\n` +
    `A movement of 0 does NOT mean the type is stable in general — it means this pair of runs\n` +
    `happened to degrade the same set of files for it. The stability claim needs the run count\n` +
    `with the type's movement printed beside it, not a single pair.\n` +
    `degraded-marking check: ${differing.filter((d) => !d.aDeg && !d.bDeg).length} of ${differing.length} differing files were NOT flagged degraded in either run,` +
    ` so the per-file decomposition catches movement the DEGRADED_FILES list does not name.`,
)
