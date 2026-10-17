# cpp `.h` routing — the lane's population omits the headers production gives it, and that is 83% of the `calls` residual

**Author:** Muhammad Ishaq Khan · **branch:** `analyzers/ontology-laptop-b` · **date:** 2026-10-17
**Status:** PROPOSAL — the files to change are outside this lane's write scope (`script/m14/**` is
Lead-owned; `src/ast/*` outside the analyzer is not this lane's). Nothing in this document has been
landed. Every number below was measured on this working tree on 2026-10-17; commands are quoted so
they can be re-run.

## 1 · The number this is about

`validation/m14/verification/CPP-RESIDUAL.md` §1 (whole population, 1,185,775 edges, run 2026-10-16):

```
unresolved 339,896 · residual 67.0% · collRes 104,069 · extFAIL 0
calls 268,986   imports 45,091   uses 19,643   overrides 1,875   instantiates 1,688
```

`calls` + `imports` = 92.4% of the unresolved mass. §2(a) then measured, order-correctly, on `fmt`'s
whole cpp population: of **6,227 unresolved `calls`**, **3,040 (49%) name a macro `#define`d in a
`.h`** and **2,090 (34%) name a function DEFINED in a `.h`** — **83% is one boundary**, not a
detection defect. `EXPECT_EQ` is the canonical case: defined at
`fmt/test/gtest/gtest/gtest.h:11947`, called 1,919× from `.cc` files.

## 2 · What the boundary actually is (correcting the working assumption)

The task brief said the fix lives in `src/ast/language-detection.ts`. **It does not, and that file
needs no change.** Measured on this tree:

1. `detectLanguageFromPath(filePath, content?)` (`language-detection.ts:374`) already has the
   content-aware `.h` disambiguation at `:402-439`: Objective-C markers → `objective-c`;
   `namespace`/`template`/`class … {`/access sections/`virtual|override|constexpr|explicit`/
   `std::`/C++ standard headers → `cpp`; otherwise `c`.
2. **Production uses it for the analyzer decision.** `pool-worker.parseFile` reads the file, then
   calls `engine.parseFile(filePath, content, context)` (`pool-worker.ts` ~1120), and
   `engine.parseFile` re-detects with content (`engine.ts:1763`) and selects the analyzer from THAT
   language (`engine.ts:1830` `getAnalyzer(language)`). The path-only detection at
   `pool-worker.ts:1079` feeds logging and the fallback result's `language` field, not the analyzer.
   So **a `.h` carrying C++ markers is parsed by `RealCppAnalyzer` in production today**, and since
   D9 the analyzer mints a symbol for every `#define` (`real-cpp-analyzer.ts:2569`,
   `SymbolKind.Macro`/`Constant`, measured there at +2,999 symbols on six corpora).
3. **The M14 instrument's discovery does not.** `script/m14/incoming-gate.ts:314`
   `admitByExtension(rel, exts, lang)` admits a file when its extension is in the lane's `ext`
   argument **or** its basename equals one; the cpp invocation's `exts` is derived from
   `EXTENSION_LANGUAGE`, where `.h` maps to `c` — so a cpp run's file list contains **zero `.h`
   files**. The per-project key space, and `projectIndexesFor(lang, files)`
   (`incoming-gate.ts:701`), are built from that same list. The declarations exist, the caller
   exists, and the run is scoped so the two cannot meet.

So the residual for `calls` is **an instrument-population boundary**, not a production routing
defect. That matters for the price tag: the change is in the gate's discovery, and production
already behaves the way the definition of done wants.

## 3 · The measured population the cpp lane is missing

Corpus: `$BB_CORPUS_ROOT/repositories` (default `$HOME/fixtures/repositories`), every
tracked file of every real git checkout, read this session:

| population | files |
|---|---|
| tracked files with cpp's own extensions (`.cc .cpp .cxx .c++ .hpp .hxx .ipp .inl .cu`) | **8,720** across 31 repos |
| what the gate actually admits from those (1 MB cap, absent files) | **6,641** across 30 repos |
| `.h` files ≤ 1 MB (all sizes: 17,709) | **15,141** across 43 repos |
| `.h` whose CONTENT routes to **cpp** (`detectLanguageFromPath(rel, head)`) | **3,095** |
| `.h` whose content routes to **c** | 11,787 |
| `.h` whose content routes to **objective-c** | 259 |
| **`#define`s inside those 3,095 cpp-routed headers** | **87,181** (63,718 function-like · 23,463 object-like, 3,046 files) |

Cpp-routed headers by repository (top): zig 1,578 · dart-sdk 448 · r-Rcpp 323 · pb-reference 285 ·
duckdb 145 · flutter-packages 110 · otp 104 · fmt 24 · nlohmann-json 16.

Under the router's own assignment the cpp lane's population is therefore **11,815 files** (8,720 own
+ 3,095 headers), and the gate measures **6,641 of them — 56.2%**. If only the headers are added to
the gate's current admitted set the run grows from 6,641 to **9,736 (+46.6%)**.

## 4 · The exact change (for the Lead; three files, one behaviour)

### 4a · `script/m14/incoming-gate.ts` — content-decide the `.h` admission (the load-bearing line)

`admitByExtension` is extension-only, which is correct for every extension whose language is
decided by its spelling. `.h` is the one extension in this corpus whose language is decided by
CONTENT. Change it to consult the router with the same bounded head the router already expects:

```ts
// current: incoming-gate.ts:314
function admitByExtension(rel: string, exts: string[], lang: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}

// proposed: the `.h` decision is content-dependent, so ask the router the question it answers
function admitByExtension(rel: string, exts: string[], lang: string, abs?: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  const byExt = exts.some((e) => low.endsWith(`.${e}`))
  if (byExt || exts.some((e) => base === e)) {
    if (!low.endsWith(".h")) return byExt || detectLanguageFromPath(rel) === lang
    let head = ""
    try { head = readFileSync(abs ?? rel, { encoding: "utf8" }).slice(0, 65536) } catch { return false }
    return detectLanguageFromPath(rel, head) === lang
  }
  return false
}
```

and add `h` to the cpp lane's admitted extension set (the invocation is
`residual-gate.ts:152` `derivedExts("cpp")` → `incoming-gate.ts cpp <exts> 0`; the minimal form is
`cc,cpp,cxx,c++,hpp,hxx,ipp,inl,cu,h` for cpp, and the c invocation keeps `h` but its admission then
content-filters the ones the router sends to cpp). One file belongs to exactly one lane. The 259
Objective-C headers are already excluded from both by the existing `objective-c` branch — no change
needed there.

`projectIndexesFor(lang, files)` then needs no change **if** the headers are in `files`: it already
groups by repository and indexes what it is given. If the Lead prefers to keep the lane's emitted
edge table unchanged and only repair resolution, the alternative is to pass
`discoverFiles(...).admitted + content-routed .h` to `projectIndexesFor` while leaving the parse
loop alone — but then the `.h` declarations' own edges are emitted by no lane's table, which is
worse for the "whole-population run shows edges" half of the bar. **Recommendation: admit them.**

**Note:** cpp has **no `INDEX_SPECS` entry** (`incoming-gate.ts:683-695` lists dart, protobuf, scss,
java only), so `--index` for cpp is currently a no-op regardless of population. If the Lead wants
the index channel as well as in-run resolution, add
`cpp: { spec: async () => (await import("../../src/ast/project-index")).SOLIDITY_DECLARATION_SPEC, wasm: "tree-sitter-cpp.wasm" }`
— but the in-run per-project key space is what the residual table measures, and 4a alone supplies it.

### 4b · `src/ast/pool-worker.ts:1079` — one consistency fix, no behaviour change

`const language = detectLanguageFromPath(filePath) ?? "unknown"` is path-only and now describes a
different language than the analyzer that ran (for a content-routed header: `c` in
`result.language`, cpp edges in the payload). Either pass the already-read `content`, or state in
the comment that the field is the PATH's language and that the analyzer decision is
`engine.ts:1763`. This is a correctness-of-reporting change, not a routing one.

### 4c · The c lane's mirror (owned by the c lane)

The c lane's run currently admits all 15,141 `.h` files, and `engine.parseFile` silently hands the
3,095 C++ ones to `RealCppAnalyzer`. That is why the c lane's own tables carry cpp-shaped edges. It
should adopt the same content filter so its population is the 11,787 it actually analyzes with
`RealCAnalyzer`.

## 5 · What it buys, and the two axes it must be judged on

- **`calls` unresolved: up to ≈223k of 268,986** (83%, the fmt measurement) is the size of the
  declaration set this closes. The remaining ≈46k are in-file call-shaped names (the C6 bucket).
- **`calls` resolved** must rise, not just `amb`: a `.h` declaration that a `.cc` call names is one
  symbol with one name in the project's key space — unlike `overrides`, the leaf is not
  necessarily ambiguous.
- **`collRes` must NOT rise.** This is the one real risk: the 87,181 new `#define` symbols add
  names, and `contains` edges (`global -> NAME`, one per minted symbol) are resolved by the
  own-file rule. A header and a source declaring the same name in different files is exactly the
  collision class collRes measures. **The change must be accepted on a before/after collRes column,
  not on the unresolved column alone.** Measuring that is the Lead's to run; this lane can re-run
  and read it if the change is landed.
- **`arbitraryTwin` must NOT rise** (the same axis rule every lane is held to).

## 6 · Why this was not done here

`script/m14/**` is explicitly the Lead's and the analyzer's write scope excludes `src/ast` outside
`real-cpp-analyzer.ts`. The lane's in-scope causes (the dotted `overrides` target, `imports`,
`uses`, in-file `calls`) are being worked in `validation/m14/verification/CPP-STATE.md`; see I1
there (restores the `a29357562` leaf+owner spelling that the `0b597d2e4` take-main merge dropped:
1,875 `overrides` of 1,875 unresolved → 0, with 7 baseline fixture failures closed).

## 7 · Re-running the measurements in this document

```bash
# population and routing split (this proposal's §3 table)
bun -e '...'   # loop reproduced in CPP-STATE.md §I1 evidence; or:
# count .h under the router, per corpus:
git -C "$repo" ls-files -z | tr "\0" "\n" | grep "\.h$"
# the gate's own population line, from a cpp run:
npx tsx script/m14/incoming-gate.ts cpp cc,cpp,cxx,c++,hpp,hxx,ipp,inl,cu 0 | grep POPULATION
# with the proposed extension set (after 4a lands), the same line must read 9,736
npx tsx script/m14/incoming-gate.ts cpp cc,cpp,cxx,c++,hpp,hxx,ipp,inl,cu,h 0 | grep POPULATION
```
