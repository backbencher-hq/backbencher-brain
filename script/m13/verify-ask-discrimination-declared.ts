// script/m13/verify-ask-discrimination-declared.ts
//
// Reported on 0.1.8: "bb_ask results are better but still non-discriminative, with
// capped confidence and totalMatches=48 / limit 5."
//
// Two separate things were being read as one defect:
//   · `totalMatches=48` beside `limit 5` is the CANDIDATE bound, already labelled
//     `[bounds: returned=5, totalMatches=48, truncated=true]` — honest, not a bug.
//   · "non-discriminative with capped confidence" is a COVERAGE consequence: in a
//     50-dimension local space scores cluster, so the 0.05 margin swallows the
//     field. The root cause is the configured-space backfill (defects #1/#2), not
//     the margin.
//
// What this pins: the answer must EXPLAIN a non-discriminative ranking instead of
// silently capping confidence — how many competitors, the margin, the top score and
// the coverage that limits it — so the reader knows what to fix.

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
const src = readFileSync(path.join(root, "src/intelligence/search/semantic-search.ts"), "utf8")
const handler = readFileSync(path.join(root, "src/mcp/tools/bb_ask/handler.ts"), "utf8")

console.log("M13 bb_ask discrimination disclosure\n")

// ── the answer explains a non-discriminative ranking ────────────────────────
check("a non-discriminative ranking adds an unknown that says so", /The ranking is not discriminative/.test(src))
check("it names how many competitors are inside the margin", /candidate\(s\) scored within/.test(src))
check("it reports the margin used, not just a verdict", /NON_DISCRIMINATIVE_MARGIN/.test(src) && /top score/.test(src))
check("it reports the coverage that limits discrimination", /Coverage is \$\{/.test(src))
check("it points at the backfill as the remedy", /backfill is what raises it/.test(src))
check("the disclosure is conditional — a discriminative answer stays clean", /competitors > 0\s*\n?\s*\?/.test(src))

// ── totalMatches is honestly a candidate bound, not a result count ──────────
check("the bounds line labels totalMatches explicitly", /totalMatches=\$\{total\}/.test(handler))
check("it names returned separately from total", /returned=\$\{bounds\.returned\}/.test(handler))

console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "ASK DISCRIMINATION: PASS" : `ASK DISCRIMINATION: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
