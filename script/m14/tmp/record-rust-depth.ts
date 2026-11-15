// script/m14/tmp/record-rust-depth.ts — record the rust lane's depth draws into
// validation/m60/results/depth-probes.json (the artifact the LCM reads for the
// `depth` cell). Same convention as record-csharp-depth.ts.
//
// Every number below is a verbatim line from a SCOPED differential run at the
// bytes this round leaves on disk (`--repo X --sample N --no-batch`, which
// prints and writes no evidence), not a transcription.
//
// ROUND 2 (2026-09-24, #798). The first three rust draws (truth 4156 / 5559 /
// 3777) were measured while `uses` and `references` were OUTSIDE the rust F5
// comparison — see spec R13/R16. This round put both labels in the rust
// allowlist (independent oracles `deriveRustBareUses` / `deriveRustDeclaredTypeRefs`)
// and fixed R14/R15/R16, so those rows describe a lane that no longer exists —
// and, fatally for a kept-history artifact, they carry the SAME sample-set hash
// as a draw that now reads different numbers (`781671e47d4a8a2d` was truth 4156,
// is truth 6309). A hash that names two different measurements is worse than no
// hash, so the three rows are REPLACED rather than appended to.
import * as fs from "fs"

const P = "validation/m60/results/depth-probes.json"
const d = JSON.parse(fs.readFileSync(P, "utf8"))

const DRAWS = [
  {
    repo: "ripgrep",
    lang: "rust",
    files: 110,
    truth: 6309,
    covered: 6309,
    missing: 0,
    unexplained: 0,
    note:
      "FULL EXTENT (110/110 .rs — the whole pinned primary corpus; a 200 cap cannot exceed it). `uses` + `references` now COMPARED (both were outside the allowlist before #798), so truth reads 6309 vs the pre-round 4156 for the same hash. analyzer-edges 6115, heuristic 0, hash 781671e47d4a8a2d.",
  },
  {
    repo: "cargo",
    lang: "rust",
    files: 200,
    truth: 7607,
    covered: 7607,
    missing: 0,
    unexplained: 0,
    note:
      "draw (200 files, 3.3x the canonical 60) on the second pinned corpus. analyzer-edges 7518, heuristic 0, hash ffd275520ae61071.",
  },
  {
    repo: "cargo",
    lang: "rust",
    files: 200,
    truth: 6315,
    covered: 6315,
    missing: 0,
    unexplained: 0,
    note:
      "draw on a DIFFERENT rotation (truth 6315 vs 7607 — why every row records its hash). analyzer-edges 6198, heuristic 0, hash 69b8d81d7c4de43b.",
  },
]

// Replace (never append) this lane's rows in both the history and the current set.
d.draws = d.draws.filter((x: any) => x.lang !== "rust")
d.current = d.current.filter((x: any) => x.lang !== "rust")
d.draws.push(...DRAWS)
d.current.push(...DRAWS)
d.at = new Date().toISOString()
d.worstPerLang = d.worstPerLang ?? {}
d.worstPerLang.rust = { maxSample: 200, missing: 0, unexplained: 0, drawsRed: 0 }
d.adjudicated = d.adjudicated ?? {}
d.adjudicated.rust =
  "#798 — CLEAN at depth, and the depth rows were re-measured the moment the comparison changed: `uses` and `references` were outside the rust allowlist before this round, so the first three draws measured a smaller surface (truth 4156 on the ripgrep hash that now reads 6309). All three final-bytes draws are 100% covered, MISSING=0, unexplained=0, heuristic=0."
d.closedInThisRound = d.closedInThisRound ?? {}
d.closedInThisRound["#798 (rust depth)"] =
  "rust's first depth evidence, and its re-measurement after the read/declared-type labels joined the comparison — 110-file full extent + two rotating 200-file cargo draws, all 0/0 (plus full-extent full-lane enumerators at 0/0 on both corpora)."
fs.writeFileSync(P, JSON.stringify(d, null, 2) + "\n")
console.log("recorded rust depth (round 2): ripgrep FULL 110/6309, cargo 200/7607, cargo 200 rot2/6315 — all 0/0")
console.log("draws", d.draws.length, "current", d.current.length, "rust rows", d.draws.filter((x: any) => x.lang === "rust").length)
