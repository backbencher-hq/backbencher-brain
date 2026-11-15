// record-fn-family-depth.ts — the five FUNCTIONAL/BEAM-family lanes that had a
// pinned corpus and an F5 row but no deeper-than-canonical draw: clojure, elixir,
// erlang, haskell, zig. Same convention as record-go-depth.ts /
// record-rust-depth.ts: every number below is a verbatim `[repo] lang:` line from
// a run (`bun script/m14/differential.ts --repo X --sample 200 --no-batch`), and
// every row carries its own sample-set HASH because the 200-file draws ROTATE.
//
// The canonical draw is 60 files/lane. These are 200-file draws on the PRIMARY
// corpus and on the SECOND corpus (M37.16's second-opinion hardening), so each
// lane is measured on two independent codebases' dialects.
//
// ONE RED DRAW was found, and it is the reason this round went past recording:
//
//   [hledger] haskell: files=186 tree-truth=6107 covered=6106 MISSING=1
//     MISSING hledger-lib/Hledger/Write/Html/HtmlCommon.hs :: extends Lines -> Spr.Lines
//
// `class (Spr.Lines border) => Lines border where`. The cause was NOT the
// qualifier and not the tuple: #872's haskell ANALYZER half had never landed at
// all. The review (reviews/m49-hs1-superclass-constraint-tree.md) records
// `processClass` as fixed, the differential ORACLE carries the constraint-tree
// walk with a comment saying it is done "exactly as the analyzer now does", no
// commit has touched real-haskell-analyzer.ts since 2026-09-14, and the two
// mutants minted to guard it were recorded by F4 as `0 -> 0` — they could not
// fail, because the fixture pinned neither a tuple superclass nor the `Applied`
// class one of them names. Fixed in this round (analyzer walks the tree; fixture
// pins all four shapes; a third mutant covers the qualified head). The PRE-fix
// red row is kept below with `supersededBy` rather than deleted, per the method
// note at the top of the artifact.
import * as fs from "fs"

const P = "validation/m60/results/depth-probes.json"
const d = JSON.parse(fs.readFileSync(P, "utf8"))

const LANGS = ["clojure", "elixir", "erlang", "haskell", "zig"]

type Row = {
  repo: string; lang: string; files: number; truth: number; covered: number
  missing: number; unexplained: number; note: string; supersededBy?: string
}

const DRAWS: Row[] = [
  // ---------------------------------------------------------------- clojure
  {
    repo: "clojure", lang: "clojure", files: 142, truth: 5916, covered: 5916, missing: 0, unexplained: 0,
    note: "PRIMARY corpus at FULL EXTENT — clojure/clojure carries 142 .clj/.cljc/.cljs files, so the 200-file cap is the whole corpus, not a sample (the `[cold-pool] clojure:clojure: 142/142 fresh (rot 1, corpus 142)` line). analyzer-edges 3584, heuristic 0, hash 95a43f7f2c4cf5f4. CLEAN. Also measured on that checkout: java 190 files, tree-truth 4219, MISSING 0 (same run).",
  },
  {
    repo: "clj-kondo", lang: "clojure", files: 200, truth: 5024, covered: 5024, missing: 0, unexplained: 0,
    note: "SECOND corpus (M37.16) — clj-kondo is a second, independent clojure codebase. analyzer-edges 2630, heuristic 0, hash bc2700cfffc85a67. CLEAN.",
  },
  // ---------------------------------------------------------------- elixir
  {
    repo: "elixir", lang: "elixir", files: 200, truth: 8163, covered: 8163, missing: 0, unexplained: 0,
    note: "PRIMARY corpus, 200 of 567 files. analyzer-edges 5771, heuristic 0, hash 25c9bbbe428df233. CLEAN. Same run measured erlang 45 files (tree-truth 2439) clean — the elixir checkout carries .erl sources too.",
  },
  {
    repo: "phoenix", lang: "elixir", files: 200, truth: 4744, covered: 4744, missing: 0, unexplained: 0,
    note: "SECOND corpus (M37.16), the framework dialect the primary does not carry. analyzer-edges 3728, heuristic 0, hash 52b073c862a255db. CLEAN. The same run's javascript row was RED (see `adjudicated` note).",
  },
  // ---------------------------------------------------------------- erlang
  {
    repo: "rebar3", lang: "erlang", files: 200, truth: 10692, covered: 10692, missing: 0, unexplained: 0,
    note: "PRIMARY corpus. analyzer-edges 5630, heuristic 0, hash 63df4a1a38b47185. CLEAN — and this is the finding worth naming: erlang's fixture lane is 0/9 RED (arity identity, line base, dedup semantics) while its differential is 0/0 on 200 files of rebar3 and 200 files of otp. The two gates disagree because they measure different things: the fixture pins SHAPES (pick/0 vs pick/1, four call sites on four lines) that these corpora exercise rarely, and the differential compares against tree-derived truth on real code. A lane is not clean because one of its gates is.",
  },
  {
    repo: "otp", lang: "erlang", files: 200, truth: 15219, covered: 15219, missing: 0, unexplained: 0,
    note: "SECOND corpus (M37.16) — the OTP tree itself. analyzer-edges 7407, heuristic 0, hash 561d4ea73c74a4b7. CLEAN.",
  },
  // ---------------------------------------------------------------- haskell
  {
    repo: "cabal", lang: "haskell", files: 200, truth: 2730, covered: 2730, missing: 0, unexplained: 0,
    note: "PRIMARY corpus, rotation 1 (the canonical 60-file draw is a subset family of this). analyzer-edges 1594, heuristic 0, hash d0bce2779de89ff9. CLEAN before AND after the #872 fix — the canonical draw never sampled a list-context superclass, which is why the lane read clean while the defect was live.",
  },
  {
    repo: "cabal", lang: "haskell", files: 200, truth: 2222, covered: 2222, missing: 0, unexplained: 0,
    note: "PRIMARY corpus, a DIFFERENT 200-file rotation (truth 2222 vs 2730 — why every row records its hash), re-measured after the fix. analyzer-edges 1333, heuristic 0, hash 2b092576e28185af. CLEAN.",
  },
  {
    repo: "hledger", lang: "haskell", files: 186, truth: 6107, covered: 6106, missing: 1, unexplained: 0,
    supersededBy: "the same draw re-measured after the #872 analyzer fix (below)",
    note: "THE RED DRAW. FULL EXTENT — hledger carries 186 .hs files, so the cap is the whole corpus (`186/186 fresh, rot 1, corpus 186`). analyzer-edges 3422, hash db22c7f9c7941008. MISSING 1, named: `hledger-lib/Hledger/Write/Html/HtmlCommon.hs :: extends Lines -> Spr.Lines` — `class (Spr.Lines border) => Lines border where`. Every list-context and every qualified superclass was dropped by the analyzer (#872's analyzer half never landed); the oracle derived it, which is what made it visible. PRE-FIX state, kept for the record.",
  },
  {
    repo: "hledger", lang: "haskell", files: 186, truth: 6107, covered: 6107, missing: 0, unexplained: 0,
    note: "SAME FILE SET as the red draw above (hash db22c7f9c7941008, identical to the row it supersedes) re-measured after the fix: evaluator-edges 3423, i.e. exactly +1 edge, MISSING 1 -> 0, unexplained 0, heuristic 0. A before/after on an identical sample set with the same hash — the strongest form this evidence takes, which is why the hash is recorded per row.",
  },
  // ---------------------------------------------------------------- zig
  {
    repo: "zig", lang: "zig", files: 200, truth: 5895, covered: 5895, missing: 0, unexplained: 0,
    note: "PRIMARY corpus, 200 of 2947 files. analyzer-edges 5874, heuristic 0, hash 8a3d98623d9488c1. CLEAN.",
  },
  {
    repo: "zls", lang: "zig", files: 89, truth: 6154, covered: 6154, missing: 0, unexplained: 0,
    note: "SECOND corpus (M37.16) — the Zig language server. FULL EXTENT (89/89). analyzer-edges 6107, heuristic 0, hash 4036eddb894d1c1e. CLEAN.",
  },
]

d.draws = (d.draws ?? []).filter((x: any) => !LANGS.includes(x.lang))
d.current = (d.current ?? []).filter((x: any) => !LANGS.includes(x.lang))
d.draws.push(...DRAWS)
d.current.push(...DRAWS.filter((r) => !r.supersededBy))
d.at = new Date().toISOString()
d.worstPerLang = d.worstPerLang ?? {}
d.worstPerLang.clojure = { maxSample: 200, missing: 0, unexplained: 0, drawsRed: 0, note: "two corpora (clojure primary at FULL EXTENT 142 files + clj-kondo 200)" }
d.worstPerLang.elixir = { maxSample: 200, missing: 0, unexplained: 0, drawsRed: 0, note: "two corpora (elixir 200/567 + phoenix 200)" }
d.worstPerLang.erlang = { maxSample: 200, missing: 0, unexplained: 0, drawsRed: 0, note: "two corpora (rebar3 200 + otp 200); the lane's 0/9 fixture red is a DIFFERENT gate measuring shapes these corpora rarely carry" }
d.worstPerLang.haskell = { maxSample: 200, missing: 0, unexplained: 0, drawsRed: 0, note: "three rows, all post-fix clean: cabal rotation 1, a second cabal rotation, and hledger at FULL EXTENT 186 files; the hledger row's PRE-fix state was MISSING=1 (extends Lines -> Spr.Lines) and is kept superseded above" }
d.worstPerLang.zig = { maxSample: 200, missing: 0, unexplained: 0, drawsRed: 0, note: "two corpora (zig 200/2947 + zls at FULL EXTENT 89 files)" }

d.adjudicated = d.adjudicated ?? {}
d.adjudicated.clojure = "CLEAN at depth on two corpora. The canonical 60-file draw was already clean; the deeper draws ask whether 60 files hid anything, and neither 142 files of clojure/clojure (full extent) nor 200 of clj-kondo did."
d.adjudicated.elixir = "CLEAN at depth on two corpora, including phoenix (the framework dialect the primary corpus does not carry)."
d.adjudicated.erlang = "CLEAN at depth on two corpora (rebar3 200, otp 200) — and this does NOT clear the lane: erlang's fixture lane is 0/9 red, and the two gates measure different things. Named rather than averaged away."
d.adjudicated.haskell = "#872's haskell analyzer half had never landed. Found by the hledger full-extent draw (`extends Lines -> Spr.Lines` MISSING), root-caused to `processClass` still being the flat-list walk the review itself calls the PRE-fix state, fixed in this round against the oracle's own rule (constraint-tree walk, left-spine class, qualified head verbatim), and pinned by four new fixture extends plus a third mutant. cabal was clean before and after — the canonical draw never sampled the shape, which is exactly why this needed depth to see."
d.adjudicated.zig = "CLEAN at depth on two corpora (zig 200/2947 + zls at full extent)."

d.closedInThisRound = d.closedInThisRound ?? {}
d.closedInThisRound["the five depth `n/a` cells with a corpus (clojure, elixir, erlang, haskell, zig)"] =
  "These five were the only lanes with a pinned corpus and an F5 row but no deeper draw — the measurable half of the matrix's 22 `depth: n/a` cells. Measured on the primary corpus and the second corpus each. Four are clean on both corpora; haskell found a live defect on the second corpus and it is fixed + pinned in this round."
d.closedInThisRound["#872 (haskell analyzer half)"] =
  "Recorded as FIXED + GATED in reviews/m49-hs1-superclass-constraint-tree.md, but the analyzer change was never in the tree: no commit has touched real-haskell-analyzer.ts since 2026-09-14, the oracle's own comment asserts lockstep it does not have, and both guarding mutants recorded `0 -> 0` in F4. The fixture pinned neither a tuple superclass nor the `Applied` class one mutant names. Now: analyzer walks the constraint tree, four shapes pinned (tuple, qualified, tuple-with-qualified, applied head), mutants CAUGHT, F4 survivors 8 -> 6 (all six remaining are erlang's known fixture red)."

fs.writeFileSync(P, JSON.stringify(d, null, 2) + "\n")
const rows = d.draws.filter((x: any) => LANGS.includes(x.lang))
console.log(`recorded ${rows.length} depth row(s) for ${LANGS.join(", ")}`)
for (const r of rows) console.log(`  ${r.lang.padEnd(8)} ${r.repo.padEnd(9)} ${String(r.files).padStart(4)}f truth=${r.truth} missing=${r.missing} unexp=${r.unexplained}${r.supersededBy ? " (superseded)" : ""}`)
console.log(`draws ${d.draws.length} | current ${d.current.length} | worstPerLang ${Object.keys(d.worstPerLang).length}`)
