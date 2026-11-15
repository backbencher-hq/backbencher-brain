// script/m14/tmp/record-objc-depth.ts — record the objc lane's depth draws into
// validation/m60/results/depth-probes.json (the artifact the LCM's `depth` cell
// reads). Same convention as record-dart-depth.ts / record-swift-depth.ts.
//
// Both corpora are small enough to be read WHOLE, so the `depth` cell's question is
// answered at full extent rather than by a deeper draw: sdwebimage is 104 .m files and
// afnetworking is 49 — the lane's ENTIRE harness corpus, drawn with no cap to hide
// behind. Every number below is a verbatim row from the scoped run at the bytes this
// round leaves on disk.
import * as fs from "node:fs"

const P = "validation/m60/results/depth-probes.json"
const d = JSON.parse(fs.readFileSync(P, "utf8"))

const SDWEBIMAGE_FULL = {
  repo: "sdwebimage",
  lang: "objc",
  files: 104,
  truth: 6052,
  covered: 6052,
  missing: 0,
  unexplained: 0,
  note:
    "FULL EXTENT (104/104 .m files — the whole pinned first corpus). hash 74f30e2d774e4d93, analyzer-edges 6,339, coverage 100%, fabrication 0%. Re-derived at this closure, on the code that carries the M59.A7 line contract AND the #D/#B fixes of this round: 21,204 edges over both corpora, 0 unlined, every claimed line re-checked against the source (21,204 token-checked, 0 INCONSISTENT, 0 exemptions used — script/m14/tmp/oc-line-equivalence.ts). Truth and analyzer moved TOGETHER by the #D fix (-38 here, -35 on afnetworking): the block-pointer parameter declaration is no longer a read on EITHER side, so coverage stayed 100%/0 while a fabrication class of 387 raw rows left the corpora.",
}
const AFNETWORKING_FULL = {
  repo: "afnetworking",
  lang: "objc",
  files: 49,
  truth: 2855,
  covered: 2855,
  missing: 0,
  unexplained: 0,
  note:
    "FULL EXTENT (49/49 .m files — the whole pinned second corpus). hash 29684f4b8391be9f, analyzer-edges 3,170, coverage 100%, fabrication 0%. The heuristic-class counts (287 and 315) are the lane's DECLARED first-parent override guesses at 0.5 — the M37.10 implicit-override model, reported by the differential as heuristic rather than as unexplained, so they are not a gap; they did not move with this round's fixes.",
}

d.draws = d.draws.filter((x: any) => x.lang !== "objc")
d.current = d.current.filter((x: any) => x.lang !== "objc")
const add = [SDWEBIMAGE_FULL, AFNETWORKING_FULL]
d.draws.push(...add)
d.current.push(...add)
d.at = new Date().toISOString()
d.worstPerLang = d.worstPerLang ?? {}
d.worstPerLang.objc = {
  maxSample: 104,
  missing: 0,
  unexplained: 0,
  drawsRed: 0,
  note:
    "GREEN at FULL EXTENT on both corpora: sdwebimage 104/104 files (tree-truth 6,052 / 6,052, analyzer-edges 6,339, MISSING=0 unexplained=0) and afnetworking 49/49 (2,855 / 2,855, analyzer-edges 3,170, 0/0). Both file counts are the WHOLE corpus, not a draw: the two repos together are 153 files, which is why this lane's depth cell has always been answered rather than sampled — the residue class that kept swift's cell red (findings outside a 60-file draw of a 554-file corpus) cannot exist here, and that is a property of the corpus, not of the lane.",
}
d.adjudicated = d.adjudicated ?? {}
d.adjudicated.objc =
  "#815 + #853 + the M12 adjudication (which found #D and #B below) — CLOSED this round. Both review waves' acceptance checklists are discharged on re-derived evidence: every claim probe-verified against the analyzer AND the oracle (reviews/objc/first-review.md, second-review.md), fixes checked against the lane's F5 lanes at full extent in this session (sdwebimage + afnetworking, 0/0 both), fixture pins + regression mutants per fix (objc fixtures 7/7 with 35 M59.A7 line pins and 11 near-miss forbids; 30/30 objc mutants CAUGHT), spec decisions recorded in script/m14/spec/objc-completeness.json (OC-B/OC-D/OC-E/OC-R1/R2 + OC-F/G/H/R3), and the lane's closure record written (reviews/objc/m60-closure.md)."
d.closedInThisRound = d.closedInThisRound ?? {}
d.closedInThisRound["#815 (objective-c first review wave) + #853 (second)"] =
  "The two acceptance checklists closed on re-derived evidence rather than on the reviews' own prose: OC-B (category exports), OC-D (C type inventory), OC-E (bare value reads), OC-R1/R2 (update operands, @synthesize/@selector), OC-F (enum cases as values), OC-G (@protocol(P) directive), OC-H (function decay) — each with its spec entry and its fixtures/mutants already in the tree, plus this round's F5 re-measurement at full extent on both corpora (0/0) and the closure record."
d.closedInThisRound["#D — objc: a block-pointer parameter DECLARATION was published as a value read"] =
  "The M12 adjudication of this round surfaced one analyzer row that was a defect rather than a fact: `uses register_block -> handler` fired from `void (^handler)(NSString *)` ALONE, with no read anywhere in the function (probe script/m14/tmp/oc-callee-uses.ts: 'decl only' -> uses handler; the C analyzer given the identical function-pointer parameter emits NOTHING, and the identical probe on C still emits only the call). That contradicts the lane's own OC-E ruling ('declaration names' are never reads) and C family parity. Root cause: the bare-read pass tested the parent node type and init_declarator chains, but a block parameter's name nests `identifier < block_pointer_declarator < parenthesized_declarator < function_declarator < parameter_declaration`, so neither test could see it. Fixed structurally in src/ast/real-objective-c-analyzer.ts (isParameterDeclaredName: climb the shared DECLARATOR_WRAPPERS set and require the node to be the enclosing parameter's own `declarator` field). The ORACLE had the same hole and was fixed in the same round (script/m14/differential.ts objcIsParameterDeclaredName) — without that, the analyzer fix would have read as MISSING at full extent (the #916 lesson). Both corpora re-measured: truth 6,090->6,052 and 2,890->2,855, analyzer 6,377->6,339 and 3,205->3,170, coverage 100%/MISSING=0/unexplained=0 on both, heuristic unchanged (287/315). 387 raw rows left the corpora, all of them declaration-site reads. Pinned by the F9 probe battery (F9-PROBE-OBJC-PARAM-DECL, analyzer AND oracle, oracleForbid on) and by a new forbid pin + mutant in objc/bare-value-reads (objc/emit-param-decl-as-bare-read; lane mutants 30/30 -> 31/31 CAUGHT)."
d.closedInThisRound["#B — production: the noise filter ate every selector target (17 of the M12 FNs)"] =
  "The other half of the M12 adjudication was not the analyzer at all. src/ast/pool-worker.ts filterNoiseRelationships computed a relationship target's 'leaf' as the LAST ':'-separated segment; an Objective-C selector ENDS in ':' because that colon IS its arity, so the leaf was empty, `leaf.length < 1` fired, and the row was dropped as noise BEFORE any consumer saw it — every `calls` to a keyword selector and every `contains` naming a parameterized method. Measured: 17 of the differential's 30 false negatives were rows the analyzer had emitted and this filter had eaten (the M14 fixture/mutant suites cannot see it: they call analyzer.analyze directly, which is why the lane's fixture suite stayed green over it). Fixed by skipping empty colon segments (the noise-blocking intent is unchanged: `:` or `` still has no leaf; period-terminated markdown prose still drops). Blast radius measured over the pinned corpora (script/m14/tmp/noise-filter-blast.ts): sdwebimage 3,641 of 17,696 relationships and afnetworking 1,724 of 8,333 were being silently dropped — 20% of sdwebimage's graph — plus Clyde 161; every other repo in the sample moved by 1-12 rows, and those are markdown/YAML heading keys whose text ends in ':' (`Breaking changes:`), the only other shape with a legitimate trailing colon. Fixture-level cross-lane check (script/m14/tmp/m12-cross-lane-filter-check.ts, all 41 languages, fix applied vs reverted on an otherwise identical tree): ONLY objective-c's differential moves (TP 72->89, FN 17->0, FP 0 in both). Pinned by the F9 probe battery (F9-PROBE-OBJC-PRODUCTION-SELECTOR runs the PRODUCTION entry over a real .m file and fails if the selector rows are dropped) and by the M12 objc differential itself (89/89, below)."
d.closedInThisRound["objective-c line contract (M59.A7 handoff)"] =
  "Before this round the objc analyzer emitted NO `line_number` at all — 0 of 21,591 edges, which is why the LCM's `lines` cell read `fail` for this lane. Now every relationship carries the line of the NAME it names, across all eight kinds the lane publishes (uses 9,669 / calls 8,033 / contains 2,192 / overrides 603 / references 515 / instantiates 507 / extends 52 / implements 20): 0 unlined, 0 out of range, and 21,591 token-checked with 0 INCONSISTENT (the probe self-tests its own boundary-aware token checker first, and needed ZERO exemptions — its two named exemption classes are declared and empty). The stamping is node-driven at every site (the text and the line come from one selection; `fullMessageSelectorNode` exists for exactly that reason), and the post-pass rows take the owning symbol's own declaration line — which is how the pins discovered that a method's owner row names its IMPLEMENTATION line, because an @interface method declaration is not symbolized in this lane (protocols excepted). Pinned by 35 line pins + 11 near-miss forbids across three fixtures and three reverting mutants (objc/drop-relationship-lines, objc/line-off-by-one, objc/contains-line-at-container), each CAUGHT by exactly the pinned fixtures."

fs.writeFileSync(P, JSON.stringify(d, null, 2) + "\n")
console.log("recorded objc depth: sdwebimage FULL 104/6052 CLEAN, afnetworking FULL 49/2855 CLEAN")
console.log("draws", d.draws.length, "current", d.current.length, "objc rows", d.draws.filter((x: any) => x.lang === "objc").length)
