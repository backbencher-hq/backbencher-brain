# c → Lead: the `.h` boundary, MEASURED (the C side of the c/cpp routing decision)

**Author: Muhammad Ishaq Khan · lane `c` · 2026-10-17 · branch `analyzers/ontology-laptop-b`**
Instrument: `validation/m14/fixtures/c/probe-h-boundary.ts` (corpus walk, production router as the
instrument). Artifacts: [`probe-h-boundary.txt`](../fixtures/c/measurements/probe-h-boundary.txt) and
[`probe-h-boundary.tsv`](../fixtures/c/measurements/probe-h-boundary.tsv) (2,936 rows, one per
genuine-C++ header, so every total below is checkable row by row).

**I did not change the routing.** `src/ast/language-detection.ts`, `engine.ts` and `pool-worker.ts`
are outside this lane's write scope. This is the measurement and the priced options; the decision is
the Lead's, read together with the cpp agent's proposal.

---

## 1 · Method — the router is the instrument, and there are TWO routers

`detectLanguageFromPath` is called from two places that disagree about what they pass:

| path | call | content passed? | `.h` outcome |
|---|---|---|---|
| **PRODUCTION indexing** | `src/ast/pool-worker.ts:1079` (the path `parallel-indexer.ts:1264` uses) | **NO** | `.h` → **c`, always** (extension-table entry `language-detection.ts:102`) |
| **ENGINE / GATES** | `src/ast/engine.ts:1772` `parseFile(filePath, content)` → `detectLanguage(filePath, content)` | **YES** | content sniff at `language-detection.ts:402`: ObjC markers → objective-c, 9 C++ markers → cpp, else c |

So the content-aware disambiguation **exists and is used by every gate**, and **is never reached by
the production indexer**. Any routing proposal that changes only the extension table will be
overridden at the next property of the two-route split; the production call site has to change too.

Evidence is measured on **comment/string-stripped code** (prose about C++ is not C++; the router
already convicted that false-positive class). The four markers the task names — `class`,
`namespace`, `template<`, `::` — are used as stated, with `::` **partitioned by cause**: C spells
`::` without a scope operator in inline asm (`asm ("" ::: "memory")`, `:: "r"(x)`) and in C23
attributes (`[[clang::no_sanitize]]`). Counting those as C++ would overstate. Measured on this
corpus: **86,071** `::` are scope operators, **180** are asm colons, **1,907** are C23 attribute
namespaces; **64** c-routed headers have only the last two and are correctly **not** counted as C++.
`@class` is excluded from the `class` marker for the same reason (it is Objective-C).

Population: every **tracked** `.h` in the corpus, discovered with `git ls-files` per repository —
the same discovery rule as `script/m14/incoming-gate.ts`. Absent/over-cap/empty files are counted,
not silently dropped.

## 2 · The numbers

```
tracked .h                                 17,709
  measured (present, readable, ≤1 MB)      15,098
  absent from working tree                  2,558
  over the 1 MB cap                            10
  empty (0 bytes/whitespace)                   43

PRODUCTION route (no content):              c 15,098 (100%)
GATE route (with content):                  c 11,744 (77.79%)
                                            cpp 3,095 (20.50%)
                                            objective-c 259 (1.72%)
  DIVERGENCE between the two predicates     3,354 .h files (22.21%)

C++ evidence among all 15,098 measurable .h:
  strong marker (class|namespace|template<) 2,792 (18.49%)
  genuine C++ (strong marker OR real ::)    2,936 (19.45%)  = 2,668 C++-only + 268 dual (__cplusplus)
  plain C (no genuine evidence)            12,162 (80.55%)

Residue the C analyzer receives when the sniff runs:
  genuine C++ still routed to c                92 (0.78% of its .h feed) = 70 C++-only + 22 dual
why the sniff missed those 92:
  class evidence but not the router's body-required `class X … {`    8
  namespace evidence but not `namespace X {`                        5
  evidence only beyond the router's 64 KiB head                     5
  `::`-only (the router has NO `::` marker)                        79
  (`using namespace` also present in one of them)
```

**Answer to the task's question: the C lane receives 15,098 `.h` files in production, and 2,936 of
them (19.45%) carry genuine C++ evidence — 2,668 are C++-only headers with no `__cplusplus` guard.**
(The brief's 15,078 differs from the measured 15,098 by 20; the corpus is a moving checkout and I
can only report the number my run saw. `CPP-RESIDUAL.md`'s 15,078 is this same file set.)

## 3 · The second finding: the gate and production do not measure the same population

`CPP-RESIDUAL.md` states ".h → c" and prices cpp's missing-header cause at 83% of its unresolved
`calls`. That is right about **production** and wrong about **what the gates show**: the incoming
gate parses with `engine.parseFile`, which sniffs, so 3,095 `.h` files already come back as **cpp**
edges in a `.c,h` gate run (C-FIX measured `extends 150 / implements 3` in that run — edges the C
grammar cannot produce). Conversely the gate reports 11,744 c-routed headers where production
indexes 15,098.

**A routing decision must name which population it is fixing.** Changing the extension table fixes
production and the gates at once; changing only the sniff changes the gates and leaves production
blind, because `pool-worker.ts` never passes content.

## 4 · Priced options for the Lead

| option | what cpp gains | what cpp's feed becomes | c's feed | verdict |
|---|---|---|---|---|
| **A. `.h` → cpp by extension (no sniff)** | 2,936 genuine-C++ headers | **12,162 plain-C headers (80.55%)** mis-modelled by cpp | 0 `.h` (loses 11,744 headers it models today) | **REJECT** — trades a small wrong-grammar class for a 4× larger one |
| **B. Production content-aware: pass content in `pool-worker.ts:1079`, keep the sniff and table** | 3,095 headers (2,936 genuine + 159 routed by the broader marker set) | 3,095 headers, all with at least one marker | 11,744 (92 genuine-C++ residue) | **RECOMMENDED** — the sniff already exists and is already the gate's predicate; this makes production match it |
| **C. B + add a `::` scope-operator marker + body-less `class X;`/`namespace X;`** | +79 headers (`::`-only) + 13 (8 class, 5 namespace) | same, residue → ~0–5 (the 64 asm/attribute-only headers stay C, correctly) | keeps 11,744 − ~92 genuine-C++ | **RECOMMENDED as a follow-up**, *only* with the asm/attribute exclusions in §1 — a bare `::` test would send 64 plain-C headers to cpp |
| D. cpp gets a project-level declaration index that includes repo headers | resolves cpp's calls into headers without changing routing | unchanged | unchanged | orthogonal to this file; note that production **already** puts every header's symbols in the project index — extracted by the **C** grammar, which is the defect B/C fix |

**The one-line request:** if `.h` is going to cpp, the change must be the **content sniff made
reachable from production** (`pool-worker.ts` reads the file's first 64 KiB and passes it), not an
extension-table flip. With B the cpp residue is 92 headers, not 15,078.

## 5 · What this does NOT claim

* "Genuine C++" is a **marker bound**, not a parse: a header with one `#ifdef __cplusplus` block and
  500 lines of C counts once. The 268 dual-language headers are disclosed separately for that
  reason — the C grammar models their C parts, and only the guarded C++ declarations are lost.
* The 2,558 absent files are counted, not measured; some are certainly C++.
* The 159 non-genuine headers among the 3,095 sniff-routed cpp are headers the router sends to cpp
  on `virtual`/`constexpr`/`explicit`/`std::`/C++ include evidence that my four-marker test does not
  cover; they are not claimed as C.
* Per-repo distribution is in the TSV; I did not run a per-repo boundary table here.
* I did not measure cpp's symbols from these headers or the resolution delta B would produce — that
  is the cpp agent's side, and the two proposals should be read together.

## 6 · Reproduce

```
bun run validation/m14/fixtures/c/probe-h-boundary.ts     # foreground, ~2 min, corpus walk
```
Exit 0. It prints the counts above and rewrites the two artifacts. The router import is
`src/ast/language-detection.ts`'s `detectLanguageFromPath` — the probe never re-implements it.
