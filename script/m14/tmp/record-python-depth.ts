// script/m14/tmp/record-python-depth.ts — record the python lane's depth draws into
// validation/m60/results/depth-probes.json (the artifact the LCM reads for the
// `depth` cell). Same convention as record-rust-depth.ts / record-php-depth.ts.
//
// Every number below is a verbatim line from a SCOPED differential run at the
// bytes this round leaves on disk (`--repo cython --sample N`, which prints and
// writes no evidence), not a transcription.
//
// BEFORE this round the lane's depth cell was red: the full extent read
// unexplained=10 (#928, ORACLE-side — the override oracle registered only `def`s
// as class members, so a subclass `def` redefining a base class-ATTRIBUTE was
// invisible to it while the analyzer was right). #928 is fixed in 5043a3cb: the
// oracle now registers every name of a chained class-level assignment, and the
// same-files reading at the identical corpus hash went truth 16208 -> 16218 and
// unexplained 10 -> 0. Both draws are CLEAN, which is what makes the cell green —
// by re-derivation, not by editing the row.
//
// The 200-file draw has ROTATED since this round's first reading, and that is
// disclosed rather than papered over: the round's first 200-file draw
// (hash 486ebb45a96e61ca, truth 6138) was clean, and this one (rot 6,
// hash 08f3b66b57991f0e — drawn after two full-extent runs exhausted the cold
// pool) is a different 200 files and is clean too. The 475-file draw IS the full
// extent of the pinned primary corpus (cython, 475 .py files), so it cannot
// rotate: it is the deepest draw the lane can have and a strict same-files
// before/after against every earlier reading at hash 8e2340b6bbdeb581.
import * as fs from "fs"

const P = "validation/m60/results/depth-probes.json"
const d = JSON.parse(fs.readFileSync(P, "utf8"))

const CYTHON_200 = {
  repo: "cython",
  lang: "python",
  files: 200,
  truth: 6164,
  covered: 6164,
  missing: 0,
  unexplained: 0,
  note:
    "3.3x the canonical 60-file draw, on the pinned primary corpus. analyzer-edges 7155, heuristic-class 835, hash 08f3b66b57991f0e (rot 6: drawn AFTER the round's two full-extent runs had emptied the cold pool, so it is a different 200 files than this round's first 200-file reading at hash 486ebb45a96e61ca / truth 6138 — that draw was clean as well). CLEAN.",
}
const CYTHON_FULL = {
  repo: "cython",
  lang: "python",
  files: 475,
  truth: 16218,
  covered: 16218,
  missing: 0,
  unexplained: 0,
  note:
    "FULL EXTENT (475/475 .py — the whole pinned primary corpus, not a sample). hash 8e2340b6bbdeb581, analyzer-edges 20085, heuristic-class 3339. CLEAN, and the same-files record of this lane's whole round: the identical hash read 20093 analyzer edges / 15 unexplained at 0b348cd4 (the #902 round's 4 fabricated `calls` + 1 fabricated `extends`, split out as #927), then 20085 / 10 with those removed and #928's ten override edges still Unexplained, and now 20085 / 0 with #928 fixed ORACLE-side — the analyzer's edge count never moved for #928, only the truth's ability to explain it (truth 16208 -> 16218, exactly the ten chained class-attribute members of PyrexTypes.py 457-460).",
}

d.draws = d.draws.filter((x: any) => x.lang !== "python")
d.current = d.current.filter((x: any) => x.lang !== "python")
d.draws.push(CYTHON_200, CYTHON_FULL)
d.current.push(CYTHON_200, CYTHON_FULL)
d.at = new Date().toISOString()
d.worstPerLang = d.worstPerLang ?? {}
d.worstPerLang.python = {
  maxSample: 475,
  missing: 0,
  unexplained: 0,
  drawsRed: 0,
  note:
    "GREEN by re-derivation. The lane's most recent draw was red and is now clean at every depth: 200 files (rot 6) MISSING=0 unexplained=0, and the FULL EXTENT 475/475 MISSING=0 unexplained=0. The red was #928, ORACLE-side, and the fix moved the truth (16208 -> 16218) rather than the analyzer (20085 both before and after) — the depth cell was citing a defect the lane did not have, which is why it was recorded and attributed instead of absorbed.",
}
d.adjudicated = d.adjudicated ?? {}
d.adjudicated.python =
  "#902/#927 — CLOSED at depth: the conditional-callee `calls` edge and the factory-function `extends` edge the deeper draws found are gone, held by python/callee-shapes and python/base-shapes with two CAUGHT reverting mutants. #928 — CLOSED: the depth cell's last red, resolved ORACLE-side (5043a3cb), which cleared the full extent (unexplained 10 -> 0) and turned this cell green. Python has no open depth residual."
d.closedInThisRound = d.closedInThisRound ?? {}
d.closedInThisRound["#928 (python, ORACLE-side depth residual)"] =
  "The override oracle registered only `def`s as class members, so a subclass `def` redefining a base class-ATTRIBUTE (PyrexType's chained `get_xdecref_code = ...` assignments, PyrexTypes.py 457-460) was invisible to it while the analyzer's ten `overrides` edges were correct. The oracle now registers every name of a chained class assignment at every nesting level of the right-nested chain; the analyzer was NOT touched, per the ruling. Same-files at hash 8e2340b6bbdeb581: truth 16208 -> 16218, unexplained 10 -> 0, analyzer-edges 20085 unmoved. requests is unaffected (37 files, truth 1216, analyzer 1336, 0/0)."

fs.writeFileSync(P, JSON.stringify(d, null, 2) + "\n")
console.log("recorded python depth: cython 200/6164 CLEAN, cython FULL 475/16218 CLEAN")
console.log("draws", d.draws.length, "current", d.current.length, "python rows", d.draws.filter((x: any) => x.lang === "python").length)
