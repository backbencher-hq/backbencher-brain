// script/m13/verify-skip-vs-unchanged.ts
//
// `skippedFiles` answered TWO questions. The incremental discovery pass incremented
// it for deliberate rule skips (a file over the 5 MB size tier) AND for unchanged
// files that were already indexed. On a 1,973-file incremental run the health
// warning then read:
//
//   "skippedFiles=1973 ... 1 file(s) were deliberately SKIPPED ... or an unchanged
//    file on an incremental run"
//
// — one number for two different facts, and the honest count (1 oversize file)
// buried inside it. This gate pins the split at the source: the two buckets are
// separate counters, and health reads them separately.

import { readFileSync } from "node:fs"
import * as path from "node:path"

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const root = path.resolve(import.meta.dirname, "../..")
const indexer = readFileSync(path.join(root, "src/ast/parallel-indexer.ts"), "utf8")
const health = readFileSync(path.join(root, "src/intelligence/health/health-provider.ts"), "utf8")

console.log("M13 skip-vs-unchanged accounting\n")

// ── the counters exist and are separate ──────────────────────────────────────
check("the stats type carries a distinct unchangedFiles counter", /unchangedFiles: number/.test(indexer))
check(
  "the unchanged branch increments unchangedFiles, not skippedFiles",
  /stats\.unchangedFiles\+\+/.test(indexer) && !/existing\.size === fileStat\.size\) \{\s*\n\s*stats\.skippedFiles\+\+/.test(indexer),
)
check("the oversize branch still counts as a real skip", /skipping file over 5MB[\s\S]{0,200}stats\.skippedFiles\+\+/.test(indexer))

// ── totals include both buckets, so neither vanishes from the denominator ────
check("totalFiles counts parsed + skipped + unchanged", /stats\.totalFiles = files\.length \+ stats\.skippedFiles \+ stats\.unchangedFiles/.test(indexer))
check("processedFiles counts both non-parsed buckets", /processedFiles = processed \+ stats\.skippedFiles \+ stats\.unchangedFiles/.test(indexer))

// ── the recorded run carries both, so health can distinguish them ────────────
check("the persisted run counts carry unchangedFiles", /unchangedFiles: stats\.unchangedFiles/.test(indexer))
check("health reads unchangedFiles separately from skippedFiles", /runUnchangedFiles/.test(health) && /perfCounters\?\.unchangedFiles/.test(health))

// ── the message no longer calls unchanged files 'skipped' ────────────────────
const skippedWarning = health.match(/code: "SKIPPED_FILES"[\s\S]{0,2000}?severity: "warning"/)?.[0] ?? ""
check("the SKIPPED_FILES warning exists", skippedWarning.length > 0)
check(
  "the warning names UNCHANGED as a separate, covered bucket",
  /UNCHANGED/.test(skippedWarning) && /covered, not missing/.test(skippedWarning),
  skippedWarning.slice(0, 160),
)
check(
  "the warning no longer offers 'or an unchanged file' as a SKIP reason",
  !/deliberately SKIPPED by indexing rules[\s\S]{0,200}or an unchanged file on an incremental run/.test(skippedWarning),
)

console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "SKIP ACCOUNTING: PASS" : `SKIP ACCOUNTING: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
