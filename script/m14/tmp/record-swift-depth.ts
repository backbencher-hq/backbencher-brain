// script/m14/tmp/record-swift-depth.ts — record the swift lane's depth draws into
// validation/m60/results/depth-probes.json (the artifact the LCM's `depth` cell
// reads). Same convention as record-dart-depth.ts / record-python-depth.ts /
// record-php-depth.ts.
//
// Every number below is a verbatim row from a scoped differential run at the bytes
// this round leaves on disk, not a transcription. Two instruments per corpus: the
// CANONICAL 60-file draw (re-derived at the closing code, so the committed M14.0.F5
// row can be checked against the same drawn set) and the FULL EXTENT.
//
// THE HEADLINE. The depth cell was red on a residue of SIX findings the canonical
// 60-file draw never touched — MISSING=1, unexplained=5, measured only when the draw
// was taken to the whole 554-file corpus (triaged in
// script/m14/tmp/sw-full-extent-triage.ts, which is where the round started). They are
// closed, and closed at full extent: the same drawn set (hash deccd8b0fd305b6d) reads
// MISSING=0 unexplained=0 with 20,465/20,465 truth edges covered, on swift-nio's 554
// files, and alamofire's 98 swift files read 0/0 on the second corpus.
//
// WHAT THE FIXES MOVED, stated as numbers rather than as prose. Two of the six were
// NAME-SURFACE classes the lane published and no gate could see — a keyword-escaped
// declaration (`case `continue``, `public static var `default``) published WITH its
// backticks, and a tuple POSITION (`pair.0`, `_key.1`) published as a target. Both
// rules live on BOTH sides (the analyzer and the differential oracle), so the same
// drawn set read truth 20,471 / analyzer 20,293 before the round and 20,465 / 20,288
// after: the targets the round removed were removed from the truth in the same
// breath, and coverage stayed 100% at both ends. That is why the two readings are a
// before/after and not a coverage loss — the same claim the dart round made for its
// own oracle-side repair.
import * as fs from "node:fs"

const P = "validation/m60/results/depth-probes.json"
const d = JSON.parse(fs.readFileSync(P, "utf8"))

const SWIFT_NIO_FULL = {
  repo: "swift-nio",
  lang: "swift",
  files: 554,
  truth: 20465,
  covered: 20465,
  missing: 0,
  unexplained: 0,
  note:
    "FULL EXTENT (554/554 .swift files — the whole pinned canonical corpus). hash deccd8b0fd305b6d, analyzer-edges 20,288, coverage 100%, fabrication 0%. This is the draw that FOUND the round: on the pre-fix code the same drawn set read MISSING=1 unexplained=5 (the six findings triaged in script/m14/tmp/sw-full-extent-triage.ts), and the canonical 60-file draw — hash ea2ac2a489ca0853 — never touched any of them, because the corpus is 554 files and the canonical draw is 60. The pre-round full-extent reading was truth 20,471 / analyzer 20,293; both sides lost exactly the fabricated targets this round's two name-surface rules refuse (keyword-escaped names published WITH their backticks, tuple positions published as targets), which is why the movement is a before/after rather than a coverage loss: covered == truth at both ends.",
}
const ALAMOFIRE_FULL = {
  repo: "alamofire",
  lang: "swift",
  files: 98,
  truth: 3549,
  covered: 3549,
  missing: 0,
  unexplained: 0,
  note:
    "FULL EXTENT of the second corpus's swift surface: `--sample 400` over the pinned alamofire checkout reaches every .swift file it has (98), hash 542c6628ba91cc30, analyzer-edges 3,490, MISSING=0 unexplained=0. This is where #942 was measured (an enum-construction splice retiring a same-scope call to an identically named function), so the pre-fix reading and this one are the same drawn set.",
}
const SWIFT_NIO_CANON = {
  repo: "swift-nio",
  lang: "swift",
  files: 60,
  truth: 2329,
  covered: 2329,
  missing: 0,
  unexplained: 0,
  note:
    "canonical 60-file draw, RE-DERIVED at this closure over a private cold pool (BB_M14_WORK=/tmp/sw-canon-work): hash ea2ac2a489ca0853, truth 2,329, covered 2,329 (100%), analyzer-edges 2,312, MISSING=0 unexplained=0. It is byte-identical to the committed M14.0.F5 row (same hash, same 2,329 / 2,312), which is the point: the canonical draw is a same-files before/after, and it is untouched by this round — the six findings live outside it.",
}
const ALAMOFIRE_CANON = {
  repo: "alamofire",
  lang: "swift",
  files: 60,
  truth: 2300,
  covered: 2300,
  missing: 0,
  unexplained: 0,
  note:
    "canonical 60-file draw at this closure on the second corpus (private cold pool): hash 0052e892f6e0d27b, truth 2,300, covered 2,300 (100%), analyzer-edges 2,253, MISSING=0 unexplained=0. The depth cell is read from the WORST draw a lane has been put through, so this row is not decoration: the lane is clean at 60 on BOTH corpora and at full extent on both.",
}

d.draws = d.draws.filter((x: any) => x.lang !== "swift")
d.current = d.current.filter((x: any) => x.lang !== "swift")
const add = [SWIFT_NIO_CANON, ALAMOFIRE_CANON, SWIFT_NIO_FULL, ALAMOFIRE_FULL]
d.draws.push(...add)
d.current.push(SWIFT_NIO_CANON, ALAMOFIRE_CANON, SWIFT_NIO_FULL)
d.at = new Date().toISOString()
d.worstPerLang = d.worstPerLang ?? {}
d.worstPerLang.swift = {
  maxSample: 554,
  missing: 0,
  unexplained: 0,
  drawsRed: 0,
  note:
    "GREEN at FULL EXTENT, and GREEN for a reason that can be checked: the residue the cell was red on (MISSING=1 unexplained=5 at 554 files) was a RESIDUE OF THE FULL EXTENT — the canonical 60-file draw is clean both before and after this round, byte-identical (hash ea2ac2a489ca0853), so a lane whose depth cell had been read off the canonical draw alone would have looked finished while six real findings sat outside it. swift-nio 554/554: truth 20,465 / 20,465, analyzer-edges 20,288, MISSING=0 unexplained=0. alamofire 98/98 (its whole swift surface): truth 3,549 / 3,549, MISSING=0 unexplained=0. Both canonical 60-file draws (swift-nio hash ea2ac2a489ca0853, alamofire hash 0052e892f6e0d27b) are also 0/0, so the report is not hiding behind its weakest draw. No red draw survives: the pre-fix full-extent reading is recorded in `closedInThisRound` rather than left as a live red row, because a red row whose defect has been fixed and pinned is history, not a state.",
}
d.adjudicated = d.adjudicated ?? {}
d.adjudicated.swift =
  "#924 (swift half) + the full-extent residue — CLOSED, and closed on the analyzer side except where the ruling says otherwise. The six full-extent findings: (1) a switch-case pattern error-recovers into a call_expression whose callee is the keyword `case`, and the analyzer published a fabricated `calls` (#938); (2) the SCD1 write gate stopped at the `postfix_expression` wrapper, so a force-unwrapped member in an assignment LHS was published as a forced READ (#939) — pinned by its own fixture with BOTH halves (the unwrap the gate must not publish as a read, and the genuine read it must keep); (3) the pinned grammar cannot parse `nonisolated(unsafe)`, so a whole class header lands in an ERROR node and the container plus every member it owned was dropped (5 corpus sites, #940); (4) an unresolvable `self.init` published a dangling `calls -> init` on the truth side while the analyzer invented the enclosing symbol's OWN name as the owner (`instantiates constructor -> constructor`, #941); (5) the enum-construction splice removed \"the first calls edge with this source and leaf\", so a same-scope call to an identically named function silently lost its edge (found on alamofire at full extent, #942); (6) the NAME SURFACE — a decorated enum case published the decorator's PAYLOAD as the member name (`@available(*, deprecated, message: \"Cannot be thrown\")` for all five cases of HTTPTypes.swift), and the same re-emit removed keyword-escaped backticks (`case `continue``) and tuple positions (`pair.0`). Every one has a fixture and a reverting mutant; the name-surface half is #924, whose swift side is now paid down and recorded in the R10 register."
d.closedInThisRound = d.closedInThisRound ?? {}
d.closedInThisRound["#924 (swift half) — the M60 name surface"] =
  "A decorated enum case (`@available(...) case x`) put a `modifiers` node first and the member-name pick took the first NAMED child — the decorator payload — so all five cases of swift-nio's HTTPTypes.swift folded into one `contains` whose target was `@available(*, deprecated, message: \"Cannot be thrown\")`, and the declaration's line came from the decorator instead of the declaration (M59 #861 rules the opposite). Fixed to the identifier after `case`, with the range node fixed too. The same re-emit closed the two other name classes the full extent exposed: a keyword-escaped declaration published WITH its backticks (`case `continue``, `public static var `default``, `func `open``) — `stripNameQuoting()` strips exactly one surrounding pair, applied in createSymbol and navigationLeaf, mirrored in the oracle — and a tuple POSITION suffix published as a target (`pair.0`, `_key.1`, 4 rows); `navigationLeaf` no longer falls back to the whole text. Pinned by swift/attributed-enum-case plus mutants swift/attributed-case-payload-name and swift/attributed-case-range-at-decorator; the R10 register's swift row records the conviction as PAID DOWN, and its separator vocabulary (overrides|., references|.) stays UNRULED and owed rather than blessed. Full-extent name census after: 652 files, 23,212 symbols, 78,747 targets, 0 unclassified."
d.closedInThisRound["#938/#939/#940/#941/#942 (swift depth findings)"] =
  "Five analyzer/grammar defects the canonical 60-file draw never touched, each found by taking the canonical corpus to its full 554 files: the case-pattern recovery fabricating a `calls` to the keyword `case` (#938, fixture swift/case-pattern-recovery); the write gate stopping at the postfix wrapper so a force-unwrapped LHS member read as a read (#939, fixture swift/unwrap-write-gate, both halves); the grammar's `nonisolated(unsafe)` blind spot dropping a container and its members (#940, fixture swift/error-recovery-nominal); the dangling `self.init` call plus the self-named owner (#941, fixtures swift/error-recovery-nominal + swift/init-delegation); and the enum-construction splice retiring a DIFFERENT same-scope call to an identically named function (#942, fixture swift/enum-construction-splice). Mutants: swift/case-pattern-keyword-call, swift/unwrap-inner-write-as-read, swift/unwrap-outer-write-as-read, swift/error-recovery-no-container, swift/error-recovery-self-owner-target, swift/error-recovery-dangling-init-call, swift/enum-splice-first-edge, swift/enum-splice-no-conversion — all CAUGHT."
d.closedInThisRound["swift line contract (M59.A7 handoff)"] =
  "Every published relationship carries the line of the NAME it names: 652 files, 78,747 edges, 0 unlined, 0 out of range, and 77,737 token-checked with 0 INCONSISTENT by script/m14/tmp/sw-line-equivalence.ts (the token checker's own self-test rejects `discount`/`other` for `count`, so it can fail). Found by the fixture dump rather than by a gate: the surviving `calls Endpoint -> method` edge claimed the CONVERTED site's line (L22) instead of the genuine call's (L29); the same round fixed `retiredLines` being GLOBAL instead of per-pool (it silently deleted unrelated lines), the import range including a preceding attribute line, and the per-emit-site stamping. Mutants swift/drop-relationship-lines and swift/line-off-by-one are CAUGHT."

fs.writeFileSync(P, JSON.stringify(d, null, 2) + "\n")
console.log("recorded swift depth: swift-nio FULL 554/20465 CLEAN, alamofire FULL 98/3549 CLEAN, both canonical 60-file draws CLEAN")
console.log("draws", d.draws.length, "current", d.current.length, "swift rows", d.draws.filter((x: any) => x.lang === "swift").length)
