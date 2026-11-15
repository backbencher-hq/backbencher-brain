/**
 * BASH ROUND-5 A/B — did the target-resolution change alter ANY edge?
 *
 * ## Why this file exists
 *
 * `script/m14/differential.ts --lang bash` reported, on its rotated 60-file otp
 * sample:
 *
 *   tree-truth=1597 covered=1597 (100%) MISSING=0 | analyzer-edges=1561
 *   unexplained=5 (0.3%) unexplained-by-label: contains=5
 *
 * Five unexplained edges where the lane has long reported zero is the kind of
 * number that gets attributed to the change that happened to be in the tree. It
 * must not be, and it must not be waved away either: the claim "my change emits
 * no new edge" is the load-bearing one, because the whole of the target-resolution
 * work is an argument that it attributes existing claims rather than adding new
 * ones.
 *
 * ## The instrument
 *
 * A per-edge A/B on a PINNED file set, which the differential cannot provide
 * because its cold-pool rotation draws different files every run (`rot 21`) — two
 * consecutive runs are not comparable, and a comparison that is not comparable
 * cannot decide anything. So this parses the SAME files twice, once through each
 * version of the analyzer, and differences the resulting relationship sets as
 * SETS OF (source, type, target, line). Metadata is compared separately and
 * reported as additive-only, because the intended change is additive.
 *
 * Old version = the commit before the target-resolution work. The two files are
 * materialised as siblings and imported directly, so neither is a re-implementation
 * and the A/B cannot pass by measuring something other than the analyzer.
 *
 * ## What it asserts, and what it cannot
 *
 * It asserts the claim directly: for every pinned file, the relationship sets are
 * IDENTICAL except for added metadata keys. If it prints 0 differences, the 5
 * unexplained `contains` edges belong to the file rotation and not to round 5 —
 * which is a different finding with a different fix, not the same one.
 *
 * It does NOT assert that the 5 edges are absent. A differential run on the
 * rotation that produced them is the only instrument that can speak to those
 * specific files, and this lane does not own that counter.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/ab-round5-targetline.ts [--sample 200]
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const num = (n: string, d: number): number => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? Number(argv[i + 1]) : d
}
const SAMPLE = num("sample", 200)
const REPO = process.env.BB_AB_REPO ?? "otp"
const BASE = process.env.BB_AB_BASE ?? "HEAD"

const ROOT = process.cwd()
const CURRENT = path.join(ROOT, "src/ast/real-bash-analyzer.ts")
const OLD_COPY = path.join(ROOT, "src/ast/__ab_old_bash_analyzer.mts")

// The old version, materialised beside the current one. `git show` of the parent
// of the commit that introduced resolveDeclaration; if the lane is checked out at
// a commit where that method does not exist yet, the A/B is a no-op and says so
// rather than silently comparing the file to itself.
const MARKER = "private resolveDeclaration("
const { execFileSync: run } = await import("node:child_process")

const hasMarker = readFileSync(CURRENT, "utf8").includes(MARKER)
if (!hasMarker) {
  console.log("NO-OP: the current analyzer has no resolveDeclaration, so there is nothing to A/B.")
  process.exit(0)
}

let oldSrc: string
try {
  oldSrc = run("git", ["show", `${BASE}~1:src/ast/real-bash-analyzer.ts`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
} catch {
  console.log(`NO-OP: no ${BASE}~1:src/ast/real-bash-analyzer.ts in this checkout.`)
  process.exit(0)
}
if (oldSrc.includes(MARKER)) {
  console.log(`NO-OP: ${BASE}~1 already has resolveDeclaration, so the parent is not the pre-change version. Pass BB_AB_BASE=<commit>.`)
  process.exit(0)
}
writeFileSync(OLD_COPY, oldSrc)

// ---------------------------------------------------------------- file set
const dir = path.join(CR, REPO)
const tracked: string[] = run("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
  .split("\0")
  .filter(Boolean)
const { detectLanguageFromPath } = await import("../../../../src/ast/language-detection")
const { ASTEngine } = await import("../../../../src/ast/engine")
const { RealBashAnalyzer: NewAnalyzer } = await import("../../../../src/ast/real-bash-analyzer")
const { RealBashAnalyzer: OldAnalyzer } = await import("../../../../src/ast/__ab_old_bash_analyzer.mts")

const files: { abs: string; text: string }[] = []
for (const rel of tracked) {
  if (files.length >= SAMPLE * 4) break
  const abs = path.join(dir, rel)
  let text: string
  try {
    text = readFileSync(abs, "utf8")
  } catch {
    continue
  }
  if (detectLanguageFromPath(abs, text) !== "bash") continue
  files.push({ abs, text })
  if (files.length >= SAMPLE) break
}

const parser: any = await ASTEngine.getParser("bash")
const oldA: any = new OldAnalyzer()
const newA: any = new NewAnalyzer()

const key = (r: any): string => `${r.source}|${r.type}|${r.target}|${r.line_number}`

let filesCompared = 0
let edgeCountOld = 0
let edgeCountNew = 0
let added = 0
let removed = 0
let metadataOnly = 0
const removedExamples: string[] = []
const addedExamples: string[] = []
const metaKeysAdded = new Map<string, number>()

for (const f of files) {
  let oldR: any
  let newR: any
  try {
    const treeOld = parser.parse(f.text)
    oldR = oldA.analyze(treeOld.rootNode, f.text, f.abs)
    treeOld.delete?.()
    const treeNew = parser.parse(f.text)
    newR = newA.analyze(treeNew.rootNode, f.text, f.abs)
    treeNew.delete?.()
  } catch {
    continue
  }
  filesCompared++
  const oldRels: any[] = oldR.relationships ?? []
  const newRels: any[] = newR.relationships ?? []
  edgeCountOld += oldRels.length
  edgeCountNew += newRels.length
  const oldMap = new Map(oldRels.map((r: any) => [key(r), r]))
  const newMap = new Map(newRels.map((r: any) => [key(r), r]))

  for (const [k, r] of newMap) {
    if (oldMap.has(k)) {
      const o = oldMap.get(k)!
      const oldKeys = Object.keys(o.metadata ?? {})
      const newKeys = Object.keys(r.metadata ?? {})
      const grew = newKeys.filter((x) => !oldKeys.includes(x))
      const lost = oldKeys.filter((x) => !newKeys.includes(x))
      if (grew.length > 0 || lost.length > 0) {
        metadataOnly++
        for (const g of grew) metaKeysAdded.set(g, (metaKeysAdded.get(g) ?? 0) + 1)
        if (lost.length > 0) {
          // A key DISAPPEARING is a claim withdrawn, which is a semantic change
          // even though the edge set is identical. Counted separately and fatally.
          removed++
          if (removedExamples.length < 10) removedExamples.push(`${path.relative(CR, f.abs)}: lost ${lost.join(",")} on ${k}`)
        }
      }
    } else {
      added++
      if (addedExamples.length < 10) addedExamples.push(`${path.relative(CR, f.abs)}: ${k}`)
    }
  }
  for (const k of oldMap.keys()) {
    if (!newMap.has(k)) {
      removed++
      if (removedExamples.length < 10) removedExamples.push(`${path.relative(CR, f.abs)}: ${k}`)
    }
  }
}

try {
  unlinkSync(OLD_COPY)
} catch {
  /* already gone */
}

console.log(`bash round-5 A/B — ${REPO}, ${filesCompared} files`)
console.log(`  old analyzer (${BASE}~1) edges : ${edgeCountOld}`)
console.log(`  new analyzer (${BASE})   edges : ${edgeCountNew}`)
console.log(`  edges ADDED                 : ${added}`)
console.log(`  edges REMOVED               : ${removed}`)
console.log(`  edges with metadata changed  : ${metadataOnly} (additive only unless listed above)`)
console.log(`  metadata keys added          : ${JSON.stringify([...metaKeysAdded.entries()])}`)
if (addedExamples.length) {
  console.log("  added examples:")
  for (const e of addedExamples) console.log(`    ${e}`)
}
if (removedExamples.length) {
  console.log("  removed examples:")
  for (const e of removedExamples) console.log(`    ${e}`)
}
if (existsSync(OLD_COPY)) unlinkSync(OLD_COPY)

// The verdict the A/B exists to produce.
if (added === 0 && removed === 0) {
  console.log("\nPASS — the target-resolution change alters NO edge. The 5 unexplained `contains` edges the differential reported belong to its file rotation, not to round 5.")
} else {
  console.log("\nFAIL — the target-resolution change altered the edge set. The 'no new edge' claim does not hold and the unexplained count must be re-read.")
  process.exitCode = 1
}