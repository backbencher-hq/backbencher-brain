// script/m14/tmp/record-csharp-depth.ts — append the csharp lane's depth draws
// to validation/m60/results/depth-probes.json (the artifact the LCM reads for
// the `depth` cell). History is KEPT: the red draw stays, marked superseded.
import * as fs from "fs"

const P = "validation/m60/results/depth-probes.json"
const d = JSON.parse(fs.readFileSync(P, "utf8"))

const DRAW_200 = {
  repo: "powershell",
  lang: "csharp",
  files: 200,
  truth: 4508,
  covered: 4508,
  missing: 0,
  unexplained: 0,
  note:
    "draw 1 (200 files, 3.3x the canonical 60) with the M59.A7 (#825) line round and the target-canonicalisation live. hash 7b60fe3198c44b83.",
}
const DRAW_FULL = {
  repo: "fsharp",
  lang: "csharp",
  files: 243,
  truth: 4679,
  covered: 4679,
  missing: 0,
  unexplained: 0,
  note:
    "FULL EXTENT (243/243 .cs files, whole second pinned corpus). hash 4d0e5ba230a7b27f — IDENTICAL to the pre-round measurement of the same sample, so this is a same-files before/after: the line round and the canonicalisation changed no edge.",
}
const DRAW_900_RED = {
  repo: "powershell",
  lang: "csharp",
  files: 900,
  truth: 25078,
  covered: 25078,
  missing: 0,
  unexplained: 1,
  note:
    "draw 2 (900 files, 15x canonical) — THE DRAW THAT FOUND THE LITERAL-CALLEE FABRICATION: `calls StartSSHProcess -> false` at engine/remoting/common/RunspaceConnectionInfo.cs:2331, where one missing semicolon makes the grammar's error recovery parse a boolean_literal as the callee. hash c155451109f66434. Fixed (a call's callee must be a naming node) and pinned by csharp/literal-callee-recovery.",
  supersededBy: "powershell:csharp post-fix 900-file draw (2026-09-22)",
}
const DRAW_900_FIXED = {
  repo: "powershell",
  lang: "csharp",
  files: 900,
  truth: 25113,
  covered: 25113,
  missing: 0,
  unexplained: 0,
  note:
    "draw 3 (900 files, fresh rotation — a DIFFERENT sample than draw 2: truth 25,113 vs 25,078). Post-fix: MISSING=0, unexplained=0. hash 002a48bf5eb5d1ac.",
}

d.draws.push(DRAW_200, DRAW_FULL, DRAW_900_RED, DRAW_900_FIXED)
d.current.push(DRAW_200, DRAW_FULL, DRAW_900_FIXED)
d.worstPerLang = d.worstPerLang ?? {}
d.worstPerLang.csharp = {
  maxSample: 900,
  missing: 0,
  unexplained: 0,
  drawsRed: 1,
  issue: "#825 (csharp lane)",
  note:
    "The one red draw (900 files) is superseded: its single unexplained edge was the literal-callee fabrication, fixed and fixture-pinned. powershell's FULL extent (1,275 .cs files) exceeds what one harness invocation can finish at ~0.4s/file (measured: killed at 592s, twice), so the lane's deepest recorded draws are 900 files on powershell and FULL EXTENT on fsharp.",
}
d.closedInThisRound = d.closedInThisRound ?? {}
d.closedInThisRound["#825 (csharp lane) — line round + the literal-callee fabrication"] =
  "Every csharp relationship now carries the line of the node that NAMES its target (12 emit sites), pinned by csharp/callsite-lines-825 and four reverting mutants; the M59 oracle reads 23,924 relationships with 0 INCONSISTENT on a 200-file draw. The round's own measurement exposed two further classes, both fixed: (1) a `contains` edge claiming the DECLARATION's start line, which for an attributed or wrapped declaration is a line the member's name is not written on (653 of 23,924 on the draw, 100% of the round's inconsistent set) — now stamped from the name node, with a synthesised name (a constructor named `constructor`, a destructor named `Finalize`) taking NO line; (2) a wrapped qualified name carrying its LAYOUT into the target and claiming the name's first line — the ruby D3 class, found here by probing the shape (script/m14/tmp/cs-wrapped-qualified.ts). Separately, the 900-file depth draw found the literal-callee fabrication (`calls … -> false`), fixed structurally and pinned by csharp/literal-callee-recovery."

fs.writeFileSync(P, JSON.stringify(d, null, 1) + "\n")
console.log("draws:", d.draws.length, "current:", d.current.length)
console.log("csharp worst:", JSON.stringify(d.worstPerLang.csharp).slice(0, 120))
