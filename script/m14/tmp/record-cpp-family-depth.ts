// record-cpp-family-depth.ts — the M37.19 (#612) family deep differential for cpp.
//
// Same convention as record-go-depth.ts / record-fn-family-depth.ts: every number
// below is a verbatim `[repo] cpp:` line from
// `bun script/m14/differential.ts --repo X --sample 100000 --no-batch` (an
// effectively-full-extent request: both corpora are smaller than the cap, and each
// run prints `N/N fresh (rot R, corpus N)`), and each row carries its sample-set
// HASH because draws rotate — the hashes below are identical to the pre-fix runs,
// which is what makes every before/after comparison in them a controlled one.
import * as fs from "fs"
import * as path from "path"

const P = "validation/m60/results/depth-probes.json"
const d = JSON.parse(fs.readFileSync(P, "utf8"))

type Row = {
  repo: string; lang: string; files: number; truth: number; covered: number
  missing: number; unexplained: number; note: string; supersededBy?: string; issue?: string
}

const DRAWS: Row[] = [
  {
    repo: "fmt", lang: "cpp", files: 73, truth: 5328, covered: 5328, missing: 0, unexplained: 0,
    note: "PRIMARY corpus at FULL EXTENT (`73/73 fresh`, hash 7721a6a798592379) under the corrected universe — fmt carries 73 files there (47 .cc + 26 .h; it has no .cpp/.hpp, so the universe correction does not change its file set, which is why its hash is identical before and after and every number here is a controlled comparison). FINAL: analyzed-edges 5117, uncovered 0, unexplained 0. Two defects were found and closed by this draw: (1) the lane's ORACLE derived 7 false `uses` (one per explicit specialization, `template <> constexpr auto num_bits<native_int128>() -> int` reading its own declared name — format.h num_bits/digits10, printf.h find, gtest.h GenerateNamesRecursively, one-arg.cc from_repr, fuzzer-common.h assign_from_buf, format-impl-test.cc run_double_tests); the analyzer emitted the matching 7 by the same rule gap, so the two sides agreed on a wrong answer and the row read 100%/0/0 over them. Truth 5335 -> 5328 and analyzer-edges 5123 -> 5117 as both sides stopped reading declared names. (2) the same round's wrapped-declarator fix added one covered edge (5116 -> 5117).",
  },
  {
    repo: "nlohmann-json", lang: "cpp", files: 17, truth: 1001, covered: 1001, missing: 0, unexplained: 0,
    supersededBy: "the same repo at FULL EXTENT under the corrected sampling universe (below)",
    note: "THE PRE-FIX SECOND CORPUS, kept as the evidence for the universe correction. Under the old ext string (\"cc,h\") this repo exposed 17 files — its .h headers — and `--repo nlohmann-json --sample 200` drew ALL 17, reporting a vacuous 100%/0/0. The 423 .cpp and 57 .hpp files carrying the library's code and test suite were not in the universe at all, so this lane's deepest measurement was fmt's 73 and the family's own 200-file floor was unreachable for cpp through no fault of the analyzer.",
  },
  {
    repo: "nlohmann-json", lang: "cpp", files: 496, truth: 6887, covered: 6887, missing: 0, unexplained: 0,
    note: "SECOND corpus at FULL EXTENT under the corrected universe (423 .cpp + 57 .hpp + 17 .h = 497; 496 drawn — the one .h file the old universe already measured is the overlap), `279/496 fresh`, hash 25cb8fe94f2edef7. FINAL: analyzer-edges 6622, uncovered 0, unexplained 0. This is the draw that found the lane's real defects, and it took the FULL extent to do it: a 200-file draw of this same corpus reads 0/0. PRE-fix, at the same hash: MISSING=1 (`tests/thirdparty/Fuzzer/FuzzerUtilDarwin.cpp :: uses (expr) -> environ` — the declared name was read off a pointer local's INITIALIZER, binding the local as `environ` and shadowing the real read) and unexplained=1 (`tests/abi/include/nlohmann/json_v3_10_5.hpp :: uses binary_reader -> strict @8299` — a `JSON_HEDLEY_NON_NULL(3)` between the return type and the name makes the grammar wrap the whole declarator in a `parenthesized_declarator`, so the method's symbol AND its scope were never created and the parameter's read escaped to the namespace-scope enumerator 8k lines away; that one header alone had lost 14 method symbols). Both closed; the two false reads that the shared template rule had left are gone with them (uses 691 -> 686 on that header, contains 1092 -> 1106).",
  },
]

d.draws = (d.draws ?? []).filter((x: any) => x.lang !== "cpp")
d.current = (d.current ?? []).filter((x: any) => x.lang !== "cpp")
d.draws.push(...DRAWS)
d.current.push(...DRAWS.filter((r) => !r.supersededBy))
d.at = new Date().toISOString()
d.worstPerLang = d.worstPerLang ?? {}
d.worstPerLang.cpp = {
  maxSample: 496,
  missing: 0,
  unexplained: 0,
  drawsRed: 0,
  note: "two corpora, both at FULL EXTENT under the corrected .cpp-inclusive universe (fmt 73 + nlohmann-json 496), both 100%/0/0 at the end of the round — but only because the first .cpp-inclusive draw was RED on both counts: MISSING=1 (the declarator-name-from-initializer defect) and unexplained=1 (the wrapped-declarator scope loss). Before this round the lane's cell read `clean @73 files`, not because it was clean but because 423 of the second corpus's files were invisible to the sampler.",
}

d.adjudicated = d.adjudicated ?? {}
d.adjudicated.cpp =
  "#612's own bar for the family is a 200+-file deep differential per language. cpp could not meet it: its F5 sampling universe was `ext: \"cc,h\"` while three other declarations in this repo (the product's indexer, the M12 census, the fixture harness) treat .cpp/.hpp as C++. Corrected, the second corpus went 17 -> 496 drawable files, and at full extent the lane was NOT clean — one MISSING (environ, fixed and pinned this round) and one unexplained (the wrapped-declarator scope loss, fixed and pinned this round). Both are now closed: fmt 73 files 5328/5328, nlohmann-json 496 files 6887/6887, 0/0 on both, at hashes identical to the red runs. The depth cell reads pass because the red draws were fixed, not because the sampler was narrowed."

d.closedInThisRound = d.closedInThisRound ?? {}
d.closedInThisRound["cpp's F5 sampling universe (`ext` \"cc,h\" -> \"cc,cpp,cxx,h,hpp\")"] =
  "The lane's drawable second corpus goes 17 -> 496 files, which is what #612's 200-file floor requires; the canonical F5 row recorded at fdbf069f was drawn under the old string and is not comparable to a re-run in the .cpp-inclusive universe."
d.closedInThisRound["cpp declarator-chain name extraction (CPPD12)"] =
  "The declared name was read with a shallow, document-order lookup whose first identifier on an init_declarator is the INITIALIZER. Three defects from one rule: a local bound as the initializer (shadowing the real global's reads — the corpus MISSING edge), no symbol at all for `**p`/arrays, and `backing` published as the name of `int &alias = backing;`. Pinned by cpp/wrapped-declarator-names-612, three mutants CAUGHT."
d.closedInThisRound["cpp template-wrapped declarator names read as uses (CPPD15/CPPD16)"] =
  "`template <> constexpr auto num_bits<native_int128>() -> int` puts the declared name inside `template_function`, so the leftmost-declarator rule (which gates on the direct parent) read the declared entity as a use of itself — on BOTH sides, which is why no fixture, mutant or draw had ever seen it: the analyzer and the oracle agreed on a wrong answer and the counts cancelled. 7 such pairs at the fmt full extent. One shared rule now (`templateWrappedDeclaratorName`, exported by the analyzer and imported by the oracle), pinned by cpp/template-declarator-name-612, one mutant, and F9-PROBE-CPP-TEMPLATE-DECL-NAME which asserts the absence on both sides with `oracleForbid`."
d.closedInThisRound["cpp wrapped function declarators losing the method symbol and its scope (CPPD17/CPPD18)"] =
  "Two spellings wrap the declarator — a parenthesized NAME (`bool (acceptParenthesized)(…)`) and a macro between the return type and the name (`JSON_HEDLEY_NON_NULL(3)` + a multi-line parameter list, which the grammar recovers as `parenthesized_declarator[ERROR, function_declarator]`). The declared-name lookup scanned the function_declarator's DIRECT children, so neither was found: no method symbol, and because the caller pushes the function scope out of that same result, no scope — so parameters never bound and their reads resolved outward (the lane's last unexplained edge, `uses binary_reader -> strict @8299`; 14 method symbols lost in that one header). Pinned by cpp/wrapped-declarator-names-612 (both spellings; the macro one carries the ERROR exactly as the corpus does) and F9-PROBE-CPP-WRAPPED-DECLARATOR-SCOPE; the macro spelling cannot live in a probe because the battery refuses snippets whose tree has errors. One mutant CAUGHT."
d.closedInThisRound["cpp fabricated `uses` duplicates for template-wrapped member calls (CPPD14)"] =
  "Three `uses <owner> -> get_ref` edges the oracle does not derive, which HEAD hid behind the declarator bug (the wrong local binding happened to be named `get_ref`). Suppressed through the member-leaf rule's template climbing plus a narrow declaration-name guard; the corpus reads unobstructed (0/0) with the suppression in place, and cpp/wrapped-declarator-names-612 pins the declaration-name half."
d.closedInThisRound["the F9 battery's oracle loader kept a second copy of the wasm table"] =
  "`oracleFor` loaded the grammar from a hand-kept 8-language map that duplicated LANGS verbatim and had no `cpp` entry — so a cpp probe that pins an ORACLE contract (the only kind that catches collusion, which is exactly what the template-declaration class was) could not be written at all. It now reads LANGS, the F5 sweep's own table. Found by trying to write the probe, which is the same way the lane's other instrument gaps were found."

fs.writeFileSync(P, JSON.stringify(d, null, 2) + "\n")
const rows = d.draws.filter((x: any) => x.lang === "cpp")
console.log(`recorded ${rows.length} cpp depth row(s) -> ${path.resolve(P)}`)
for (const r of rows) {
  console.log(`  ${r.repo.padEnd(14)} ${String(r.files).padStart(4)}f truth=${r.truth} covered=${r.covered} missing=${r.missing} unexp=${r.unexplained}${r.supersededBy ? " (superseded)" : ""}`)
}
console.log(`draws ${d.draws.length} | current ${d.current.length} | worstPerLang lanes ${Object.keys(d.worstPerLang).length}`)
