// script/m14/tmp/record-groovy-depth.ts — record the groovy lane's depth evidence
// into validation/m60/results/depth-probes.json (the artifact the LCM's `depth`
// cell reads). Same convention as record-objc-depth.ts / record-dart-depth.ts.
//
// The lane's `depth` cell said "clean on 200-file draws (canonical draw is 60)"
// while the corpus was never read whole — and it could not be: the harness's
// per-lane scan carried `if (files.length > 4000) return`, so `grails-core`'s
// groovy+gradle pool was a directory-order PREFIX of the corpus (4,014 of 6,931,
// measured in script/m14/tmp/gr-scan-cap.ts) and the 2,917 hidden files carried
// 26,485 of the lane's truth edges. With DISCOVERY_CAP scaling on the draw, both
// corpora are now read WHOLE, so the `depth` question is answered at full extent
// rather than by a deeper draw:
//
//   grails-core 6,931 files (6,487 .groovy + 444 .gradle, widened universe)
//   geb           668 files (  639 .groovy +  29 .gradle)
//
// Every number below is a verbatim row from the scoped run at the bytes this
// round leaves on disk (logs: /tmp/gr-extent.log, pre-fix comparison
// /tmp/gr-full2.log on the identical capped drawn set).
import * as fs from "node:fs"

const P = "validation/m60/results/depth-probes.json"
const d = JSON.parse(fs.readFileSync(P, "utf8"))

const GRAILS_FULL = {
  repo: "grails-core",
  lang: "groovy",
  files: 6931,
  truth: 94659,
  covered: 94659,
  missing: 0,
  unexplained: 0,
  note:
    "FULL EXTENT (6,931/6,931 = every .groovy and .gradle file the router hands this lane, `.gradle` included via the M60 universe widening). hash 5c0530ca713cebeb, analyzer-edges 98,031, coverage 100%, fabrication 0%. Supersedes the 200-file draws below, which were themselves drawn from the CAPPED pool: the scan's hard 4,000-file bound made the pool a directory-order prefix (4,014 of 6,931 files, 2,917 hidden — 2,762 .groovy and 155 .gradle), so 26,485 truth edges (28% of the lane's truth) had never been compared. The cap is now `DISCOVERY_CAP = Math.max(4000, SAMPLE_PER_LANG)`; canonical 60-file draws keep the 4,000-file pool and their sampleSetHash is untouched. Pre-fix/post-fix on the identical capped drawn set (same hash 17cce86be37fb899): MISSING 2 -> 0, analyzer edges 70,798 -> 71,044, heuristic 3,024 -> 3,261 — the anonymous-body classHierarchy entry (reviews/m60-groovy-anonymous-body-override.md).",
}
const GEB_FULL = {
  repo: "geb",
  lang: "groovy",
  files: 668,
  truth: 7556,
  covered: 7556,
  missing: 0,
  unexplained: 0,
  note:
    "FULL EXTENT (668/668 = the whole pinned second corpus; never affected by the 4,000-file cap). hash 9c2299575193bf12, analyzer-edges 7,702, coverage 100%, fabrication 0%. The heuristic class (288) is the lane's DECLARED first-parent override guesses at 0.5 — reported by the differential as heuristic, never as unexplained.",
}

d.draws = d.draws.filter((x: any) => x.lang !== "groovy")
d.current = d.current.filter((x: any) => x.lang !== "groovy")
const add = [GRAILS_FULL, GEB_FULL]
d.draws.push(...add)
d.current.push(...add)
d.at = new Date().toISOString()
d.worstPerLang = d.worstPerLang ?? {}
d.worstPerLang.groovy = {
  maxSample: 6931,
  missing: 0,
  unexplained: 0,
  drawsRed: 0,
  note:
    "GREEN at FULL EXTENT on both corpora under the widened universe: grails-core 6,931/6,931 files (tree-truth 94,659 / 94,659, analyzer-edges 98,031, MISSING=0 unexplained=0) and geb 668/668 (7,556 / 7,556, 7,702 edges, 0/0). Both file counts are the WHOLE corpus, not a draw. The earlier 200-file draws are kept in `draws` as history: they were drawn from a pool the discovery cap had truncated at 4,000 files, which is why this cell read green while 28% of the lane's truth edges were outside every draw — the residue class that keeps other lanes red (findings outside a draw of a larger corpus) could not be seen here either, and was only visible once the pool itself was the corpus.",
}
d.adjudicated = d.adjudicated ?? {}
d.adjudicated.groovy =
  "M49/M37 groovy review waves + the M60 wave: the analyzer defect (an anonymous class body never entered classHierarchy, so every override inside it was silently dropped) is fixed and pinned by fixture groovy/anonymous-body-overrides + mutant groovy/drop-anonymous-body-override; the lane's M14.0.F6 red cell (uncovered: [lambda_expression]) is closed by fixture groovy/lambda-expression with a contract rather than a node census; the harness's 4,000-file discovery cap and the leaf-only coverage match are recorded with their measurements in reviews/m60-groovy-anonymous-body-override.md §2-§3."
d.closedInThisRound = d.closedInThisRound ?? {}
d.closedInThisRound["groovy: anonymous-body overrides + the 4,000-file discovery cap + F6 lambda_expression"] =
  "One analyzer defect and two measurement defects, all re-derived at the whole corpus: 0 MISSING / 0 unexplained on 6,931 + 668 files, groovy fixtures 73/73, groovy mutants 56/56 CAUGHT, F6 groovy uncovered=0 deadLiterals=0, F9 battery 36/36, and the M12 groovy artifact byte-identical (its own red is the stale hand audit, recorded and filed rather than passed)."

fs.writeFileSync(P, JSON.stringify(d, null, 2) + "\n")
console.log(`record-groovy-depth: grails-core ${GRAILS_FULL.files} files (${GRAILS_FULL.truth}/${GRAILS_FULL.covered}), geb ${GEB_FULL.files} (${GEB_FULL.truth}/${GEB_FULL.covered}) — wrote ${P}`)
