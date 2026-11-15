// script/m14/tmp/record-dart-depth.ts — record the dart lane's depth draws into
// validation/m60/results/depth-probes.json (the artifact the LCM's `depth` cell
// reads). Same convention as record-python-depth.ts / record-php-depth.ts.
//
// Every number below is a verbatim row from a scoped differential run at the
// bytes this round leaves on disk, not a transcription.
//
// THE HEADLINE, BECAUSE IT IS THE WHOLE POINT OF THIS ROUND. The requirement is
// a real corpus at FULL EXTENT. dart-http's is 335 files and was measured in one
// clean run; proxicall's is 2,211 and CANNOT be, on this box: a single
// `--sample 2300` process dies in the documented web-tree-sitter heap mode
// (parse returns EMPTY trees, so the truth derives ZERO edges over 2,211 parsed
// files — the harness's parsed-but-empty guard refuses to publish that as a
// clean row, reproduced twice, at pool rot 4 and rot 10). The extent is
// therefore measured in FIVE 500-file draws over a PRIVATE cold pool
// (BB_M14_WORK), so the draws consume disjoint fresh file sets, and every drawn
// path is printed (BB_F5_SHOW_FILES) — which is what makes the union a
// measurement instead of a claim:
//
//   corpus=2211  distinctDrawn=2211  undrawn=0   (script/m14/tmp/dt-depth-coverage.ts --logs)
//
// (The probe's own walk sees 2,212 live files; the extra one,
// integration_test/user/payment_received_push_e2e_test.dart, is UNTRACKED in the
// proxicall checkout and therefore absent from the frozen tree of the pin — it
// is not part of the corpus the harness measures, and measuring it would mean
// measuring an unpinned state.)
//
// Two of this round's fixes were found BY this draw — both ORACLE-side, both
// closed here: #937 (the truth oracle's named-ctor prescan accepted only
// `class_definition`, so an `extension type` container's constructors were
// invisible: 27 unexplained + 1 MISSING at dart-http full extent) and #936 (the
// cold pool keyed on the measured — i.e. frozen-tree — path, so every run read
// 100% fresh and the same files were re-drawn as new: the #760 sampling
// guarantee was void on exactly the corpora that need it, and the union above
// was not even computable before it was fixed).
import * as fs from "node:fs"

const P = "validation/m60/results/depth-probes.json"
const d = JSON.parse(fs.readFileSync(P, "utf8"))

const DARTHTTP_FULL = {
  repo: "dart-http",
  lang: "dart",
  files: 335,
  truth: 13654,
  covered: 13654,
  missing: 0,
  unexplained: 0,
  note:
    "FULL EXTENT (335/335 .dart files — the whole pinned second corpus). hash 2dee60fd89aee7be, analyzer-edges 12708. It is the SAME drawn set as the draw that found this round's two ORACLE-side defects, so it is a strict same-files before/after: tree-truth 13628 -> 13654 and unexplained 27 -> 0 with the analyzer's edge count UNMOVED (12708 both times) — the truth learned to explain edges the analyzer had been emitting correctly all along (27 named-constructor `instantiates` inside `extension type` containers, +1 keyword `calls -> as` removed; #937).",
}

const PROXICALL_CHUNKS = [
  { files: 500, truth: 37584, analyzer: 33826, hash: "fa4d51dff25f6af7" },
  { files: 500, truth: 35634, analyzer: 32411, hash: "91b64a06de1ca8dd" },
  { files: 500, truth: 36188, analyzer: 32561, hash: "dbb1252d0c54dabe" },
  { files: 500, truth: 35032, analyzer: 31643, hash: "c97214c6867ae3d2" },
  { files: 500, truth: 35159, analyzer: 31587, hash: "49a08d94a7375873" },
].map((c, i) => ({
  repo: "proxicall",
  lang: "dart",
  files: c.files,
  truth: c.truth,
  covered: c.truth,
  missing: 0,
  unexplained: 0,
  note:
    `chunk ${i + 1}/5 of the FULL EXTENT (2,211 pinned .dart files; corpus 2,211). hash ${c.hash}, analyzer-edges ${c.analyzer}, coverage 100%, fabrication 0%. Drawn over a PRIVATE cold pool (BB_M14_WORK=/tmp/dt-depth-work) so the chunks are DISJOINT: chunks 1-4 drew 2,000 never-sampled files, chunk 5 drew the remaining 211 + 289 warm. Every drawn path is printed under BB_F5_SHOW_FILES and the union is verified — 2,211/2,211, undrawn 0 — by script/m14/tmp/dt-depth-coverage.ts --logs. Runner: script/m14/tmp/dt-proxicall-extent.sh (it deletes the lane-journal row between chunks; --lane-batch turns the journal ON, so without that the later chunks RESUMED chunk 1 and only one chunk was ever measured — found live, in this round).`,
}))

const DART_CANON_PROXICALL = {
  repo: "proxicall",
  lang: "dart",
  files: 60,
  truth: 4408,
  covered: 4408,
  missing: 0,
  unexplained: 0,
  note:
    "canonical 60-file draw at this closure, re-derived on the final code: hash 5d521eb201148639 — IDENTICAL to the round's earlier canonical draw, so this is a strict same-files before/after. analyzer-edges 4009, MISSING=0 unexplained=0. Truth 4427 -> 4408 because the DARTD22 rule removed enum-constant declaration reads from BOTH sides at once (the analyzer stopped emitting them, the oracle's bare-uses mirror stopped deriving them), which is why the drop is not a coverage loss: covered = truth, 100%.",
}
const DART_CANON_DARTHTTP = {
  repo: "dart-http",
  lang: "dart",
  files: 60,
  truth: 1627,
  covered: 1627,
  missing: 0,
  unexplained: 0,
  note:
    "canonical 60-file draw at this closure, re-derived on the final code (fresh private pool, so a different 60 files than the round's earlier canonical draw: hash 549143339f0cfaa9, truth 1,627 vs 2,601 before). CLEAN: analyzer-edges 1497, MISSING=0, unexplained=0.",
}

d.draws = d.draws.filter((x: any) => x.lang !== "dart")
d.current = d.current.filter((x: any) => x.lang !== "dart")
const add = [DARTHTTP_FULL, ...PROXICALL_CHUNKS, DART_CANON_PROXICALL, DART_CANON_DARTHTTP]
d.draws.push(...add)
d.current.push(DARTHTTP_FULL, DART_CANON_PROXICALL, DART_CANON_DARTHTTP)
d.at = new Date().toISOString()
d.worstPerLang = d.worstPerLang ?? {}
d.worstPerLang.dart = {
  maxSample: 2211,
  missing: 0,
  unexplained: 0,
  drawsRed: 1,
  note:
    "GREEN at FULL EXTENT, measured not assumed. dart-http: the whole 335-file corpus in one run (truth 13,654/13,654, MISSING=0, unexplained=0). proxicall: the whole 2,211-file corpus across five disjoint 500-file draws, every one 0/0, union verified 2,211/2,211 from the drawn-path log — a single-process 2,211-file run is IMPOSSIBLE on this box and fails honestly (the wasm heap dies, the parser returns empty trees, and the harness's parsed-but-empty guard refuses the 0/0 row rather than publishing a fabricated pass; reproduced twice). The one red draw is that failure, attributed and disclosed, not a lane defect. The ORACLE-side red the deep draw DID find (27 unexplained + 1 MISSING at dart-http full extent) is #937, fixed this round: truth 13,628 -> 13,654 with the analyzer unmoved.",
}
d.adjudicated = d.adjudicated ?? {}
d.adjudicated.dart =
  "#937 — CLOSED: the truth oracle's named-constructor prescan accepted only `class_definition`, so a Dart 3 `extension type` container's named constructors were invisible to it; the analyzer (whose named-ctor set comes from SYMBOLS, where the extension type became an owner in DARTD21) was right. Full extent: 27 unexplained + 1 MISSING -> 0/0, truth 13,628 -> 13,654, analyzer-edges unmoved at 12,708. #936 — CLOSED: the cold pool keyed on the FROZEN-TREE path, so every run reported 100% fresh and re-drew files it had already measured (proxicall:dart: 5,942 pooled paths for a 2,211-file corpus under four freeze prefixes). Fixed by keying on the corpus-relative path; without it this round's chunked full extent would not have been a union at all."
d.closedInThisRound = d.closedInThisRound ?? {}
d.closedInThisRound["#937 (dart, ORACLE-side depth residual)"] =
  "The oracle's named-ctor prescan walked up from each constructor signature looking only for `class_definition`. The pinned FFI bindings declare their whole surface as `extension type` containers, so it registered 0 of 159 constructor signatures in native_cupertino_bindings.dart and every `Foo.named(...)` call inside such a container fell through to the keyword branch — the truth published `calls -> as` (the FFI `as` constructor's name) where the analyzer published the correct `instantiates`. Fix: accept `extension_type_declaration` as a constructor-owning container, mirroring DARTD21 and the oracle's own extension-type branch. Analyzer untouched, per the ruling."
d.closedInThisRound["#936 (cold pool keyed on the measured path)"] =
  "`coldPoolPick` recorded the absolute path it measured; for a corpus whose checkout is dirty or moved, that is a detached worktree under /tmp/m14-frozen-corpus-<hash>/, a NEW directory every run — so nothing ever looked sampled, the `[cold-pool] N/M fresh` disclosure line read 100% fresh forever, and the pool grew without bound. Fix: key on the corpus-relative path, accepting the old absolute spelling on read so in-place lanes are not reset. Found and closed by this round's full-extent work; it is lane-neutral machinery, so every lane measured on a frozen corpus was sampling blind."

fs.writeFileSync(P, JSON.stringify(d, null, 2) + "\n")
console.log("recorded dart depth: dart-http FULL 335/13654 CLEAN, proxicall FULL 2211 in 5x500 CLEAN, both canonicals CLEAN")
console.log("draws", d.draws.length, "current", d.current.length, "dart rows", d.draws.filter((x: any) => x.lang === "dart").length)
