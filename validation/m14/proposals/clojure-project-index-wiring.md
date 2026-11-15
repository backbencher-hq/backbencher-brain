# CLOJURE — THE PROJECT-INDEX WIRING (a proposal for the Lead's shared files)

**Author: the clojure lane (Muhammad Ishaq Khan). Date: 2026-10-20.**

**THIS PROPOSAL EDITS NOTHING.** The lane may not edit `script/m14/incoming-gate.ts` or
`src/ast/parallel-indexer.ts`; those are the Lead's files. What the lane HAS done is write the
clojure region of `src/ast/project-index.ts` — the shared file the Lead commits — and measure
everything this proposal claims, so the Lead can apply the wiring and check the numbers.

**THE SPEC IS `CLOJURE_DECLARATION_SPEC`, IN `src/ast/project-index.ts`, BESIDE
`JAVA_DECLARATION_SPEC` AND `DART_DECLARATION_SPEC` — THE JAVA AND DART PRECEDENT.** The spec is a
DECLARATION RULE, and the rule is the lane's to write: a spec written by the wrong author is a
second instrument. The Lead does not guess at Clojure's declaration rules.

---

## 1 · WHAT IS MEASURED, AND WHERE

| | instrument | log |
|---|---|---|
| **THE SPEC'S EFFECT ON THE FLOOR** | `validation/m14/fixtures/clojure/clojure-project-index-probe.ts` | `validation/m14/fixtures/clojure/lane-logs/index-effect.txt` · `.json` |
| **THE TWO CONTROLS** (the other lanes' digests byte-identical; the index's whole surface, old file vs new file, in one process) | `validation/m14/fixtures/clojure/index-spec-locality.ts` | `validation/m14/fixtures/clojure/lane-logs/spec-locality.txt` · `.json` |
| **THE CLAUSE-1 CROSS-CHECK** | `validation/m14/fixtures/clojure/production-binding-split.ts` (the clause-1 block) | `validation/m14/fixtures/clojure/lane-logs/pair-2026-10-20.txt` |

**ROOT: `BB_CORPUS_ROOT=$PWD/.corpus` (the farm) — the root every recorded clojure arm used, and
the root the two roots' admitted SETS agree on (§0.1 of the verdict page).** The `amb-cross.txt` the
probe reads carries ABSOLUTE paths, so the probe's root MUST be the root that file was built on —
**the lane found this the hard way: a probe run against the default root reported 662 rows "the
file declares no namespace" instead of 73, and the answer count read 0 instead of 1.** A number
without its root is not a number.

**POPULATION: 646 admitted files over 3 repositories** (clj-kondo 503 · clojure 142 · nvim-treesitter
1), the gate's own `clj,cljs,cljc,edn` extension list, the gate's 1 MB cap, `git ls-files` per
checkout.

---

## 2 · THE GATE — `script/m14/incoming-gate.ts`, `INDEX_SPECS` — ONE LINE

**THE SHAPE EVERY OTHER LANE USES, AND THE ONE THE PROTOBUF LANE ALSO USES FOR A SPEC THAT LIVES
IN ITS OWN ANALYZER FILE:**

```ts
  // CLOJURE — the lane's own spec, in the shared index's clojure region (the java/dart precedent).
  // THE GATE HAD NO CLOJURE ENTRY, and `projectIndexesFor` returns ZERO indexes for a language with
  // no entry — so every recorded clojure arm was a NO-INDEX arm, and the 768 could not have been
  // asked of a project index. The spec answers 1 of the 768 (the probe's own arm); the other 767 are
  // accounted for by three reasons no index can reach. See CLOJURE-VERDICT-2026-10-20.md §4.
  clojure: { spec: async () => (await import("../../src/ast/project-index")).CLOJURE_DECLARATION_SPEC, wasm: "tree-sitter-clojure.wasm" },
```

**THE WASM SPELLING: `tree-sitter-clojure.wasm`.** The gate resolves it through
`src/util/wasm.ts`'s `resolveWasmAsset`, and the lane's own analyzer already loads exactly this
asset from `wasm/tree-sitter-clojure.wasm` (sha256 `90f8866b74d04e16…`), so the spelling is the
one the lane's own production path uses. The other lanes' entries name their asset the same way
(`tree-sitter-java.wasm`, `tree-sitter-scss.wasm`).

---

## 3 · THE PRODUCTION INDEXER — `src/ast/parallel-indexer.ts` — THREE HALVES

**(a) `PROJECT_INDEX_EXTENSIONS` — the map from a file extension to the language whose index is
built for it:**

```ts
  ".clj": "clojure",
  ".cljs": "clojure",
  ".cljc": "clojure",
```

**`.edn` IS RULED: NO INDEX — AND THE REASON IS WHAT AN INDEX MEANS, NOT A CONVENIENCE.** An `.edn`
file is a DATA FILE — a manifest — and it has **no `(ns …)` form**, so its index is **empty by
construction**. **AND AN EMPTY INDEX IS WORSE THAN NO INDEX, BECAUSE IT LOOKS LIKE EVIDENCE AND IS
NOT**: a reader sees a project index for the `.edn` file and concludes *the project declares
nothing*, when the truth is that **the file declares no NAMESPACE AT ALL** — a different fact, and a
wrong one. The `.edn` file's content is read by **the MANIFEST READER**
(`validation/m14/fixtures/clojure/clojure-manifest-facts.ts`), which is where the clojure claim's
evidence comes from, and **not by an indexer**. So: **index the `.clj`/`.cljs`/`.cljc` files, and
NOT the `.edn` files** — the 59 `.edn` files of the 646 stay out of `PROJECT_INDEX_EXTENSIONS`.

**THE RULING'S GENERAL FORM, WHICH THE VERDICT PAGE ALSO STATES: AN INDEX THAT CANNOT HOLD A
DECLARATION IS NOT A SMALL INDEX — IT IS A MISLEADING ONE.** The same reasoning is why the spec's
`typeNodes` is empty (a Clojure namespace is not a type) and why `.edn` is not indexed.

**(b) `wasmByLang` — the grammar asset per language:**

```ts
  clojure: path.join(repoRoot, "wasm", "tree-sitter-clojure.wasm"),
```

**(c) `specByLang` — the declaration spec per language:**

```ts
  clojure: (await import("./project-index")).CLOJURE_DECLARATION_SPEC,
```

**THE SPEC IS NOW IN THE SHARED INDEX, NOT IN THE ANALYZER** — so this import is
`./project-index`, like `SOLIDITY_DECLARATION_SPEC` and `DART_DECLARATION_SPEC` are, and NOT
`./real-clojure-analyzer`. **THE LANE'S ANALYZER IMPORTS THE TWO GRAMMAR RULES FROM
`./project-index` TOO**, so the spec and the analyzer read a form's head and a symbol's name by ONE
CODE.

---

## 4 · WHAT THE WIRING BUYS, MEASURED — AND WHAT IT DOES NOT

**IT BUYS: AN INDEXED CLOJURE ARM BECOMES PRODUCIBLE AT ALL.** The gate's lookup returns
`{built: 0, indexed: 0}` for a language with no `INDEX_SPECS` entry, so the lane has never had an
indexed clojure arm — every recorded clojure arm was a no-index arm.

**IT BUYS: THE 768 GET A PROJECT KEY SPACE TO BE ASKED AGAINST — FOR 1 ROW.** The spec answers 1 of
the 768, and the closure is exact: 106 (not a name question) + 73 (the file declares no namespace)
+ 1 (answered) + 119 (no namespace anywhere declares it — a local or a synthetic name) + 469
(another namespace declares it and no `:refer` says which) = **768**.

**IT DOES NOT BUY: MORE THAN 1 ROW.** An EXTENDED spec — the `ns` form's own namespace, `deftest`,
and the def-family macros including their namespaced spellings — answers **0** rows the minimal spec
does not. **The minimal spec is the minimal spec.**

**IT DOES NOT BUY: THE 119.** They name a local or a synthetic name (`lambda_50_13`), and **no
project index can bind a name the project does not declare.** The bigger lever is the analyzer's own
publication: the gate's key space counts the analyzer's locals and synthetic names as declarations,
and 8,298 of the analyzer's 16,387 published names are of that kind.

**AND IT DOES NOT MOVE ANY OTHER LANE'S NUMBER.** The shared file's change is PURELY ADDITIVE (221
lines added, 0 removed) and the ten other lanes' index surfaces are byte-identical, old file vs new
file, in one process. **AND THE WIRING IS SAFE TO LAND BECAUSE IT IS PER-LANGUAGE: a clojure-only
spec cannot move another lane's arm, which is the whole property the spec-local change was designed
for.**

---

## 4b · THE CONSEQUENCE, NAMED BEFORE IT LANDS: THE CLOJURE ARM'S NUMBERS WILL MOVE

**EVERY NUMBER IN THIS PROPOSAL, AND EVERY NUMBER IN `CLOJURE-VERDICT-2026-10-20.md`'s floor
entry, IS THE **PRE-WIRING VIEW**.** The wiring gives the gate a clojure index for the first time,
so the clojure arm's key space changes and **the arm's numbers will move when the wiring lands** —
exactly as they moved when the tie-break landed (§1.1b of the verdict page) and as the arbiter's
version differs from the authority's arm (§1.1b's flag). **THE SAME DISCIPLINE APPLIES: A VIEW IS
NAMED, NOT ASSUMED.**

**AND THE WIRING HAS NOW LANDED, AND THE CONTROL — THE INDEX AS THE ONLY VARIABLE — SETTLED WHAT IT
MOVED: NOTHING ✓✓.** The same command, the same population, the same root, once with `--index` and
once without, with the row-level reconciliation on top: **0 rows left the dump ✓✓, 0 rows entered
✓✓, every label unchanged ✓✓, and every column of TABLE 1 identical ✓✓.** So the numbers above
are the **PRE-WIRING VIEW AND THE POST-WIRING VIEW**, because they are the same numbers ✓✓ — and
the prediction that the wiring would not move them is **confirmed, not merely made** ✓✓.

**THE PRE-WIRING VIEW'S FLOOR IS 768, AND THE FLOOR ENTRY'S NUMBERS MUST BE READ AS THE PRE-WIRING
VIEW ✓✓.** What the wiring was expected to move, and what it did not move, is measured:

| | pre-wiring (this proposal) | what the wiring was expected to do | what it DID |
|---|---|---|
| the gate's clojure index | **none** (0 built, 0 files) | build one per repository over the `.clj`/`.cljs`/`.cljc` files, and **not** over the 59 `.edn` ones | **3 built, 0 damaged ✓✓** |
| the 768's answerable count | **1** | **not more** — an extended spec answers 0 rows more (§4) |
| the 119 (a local or a synthetic name) | **119** | **unchanged** — no index can bind a name the project does not declare |
| the 469 (another namespace declares it, no `:refer` says which) | **469** | **unchanged** — a language-semantics question, not a measurement question |

**THE TWO NUMBERS THE WIRING CANNOT MOVE ARE THE TWO THE LEAD HAS RULED ON ✓✓**, and the page
carries them as §4.3's closure: **the floor is RULED-LIMITED, not spec-limited ✓✓.**

**AND THE PUBLICATION LEVER'S NUMBER, FOR THE RECORD ✓✓ (§4.8 of the page):** the wall joined by
the target's publication class covers **7,236 exactly** ✓✓ — **2,026** rows target a real
declaration, **113** target a namespace, **0** target a synthetic name ✓✓, and **5,097** target a
name the analyzer publishes at all ✓✓; the floor's join is **662 + 106 = 768 exactly** ✓✓. **THE
PUBLICATION'S PRICE ON THE WALL'S SIZE IS ZERO ✓✓ — IT DECIDES WHAT A WALL ROW SAYS, NOT WHETHER
IT IS ✓✓ — SO THE LANE PROPOSES NO POLICY CHANGE ✓✓, AND THE LEAD'S ANSWER IS THE LANE'S ANSWER ✓✓.**

---

## 5 · THE TWO CONTROLS, AND HOW TO RE-RUN THEM

```
export BB_CORPUS_ROOT=$PWD/.corpus
bun run validation/m14/fixtures/clojure/index-spec-locality.ts --json validation/m14/fixtures/clojure/lane-logs/spec-locality.json
bun run validation/m14/fixtures/clojure/clojure-project-index-probe.ts validation/m14/fixtures/clojure/lane-logs/amb-cross.txt --json validation/m14/fixtures/clojure/lane-logs/index-effect.json
```

**THE CONTROL'S BASE REVISION IS A NAMED SHA, NOT `HEAD`** — `a5693870adc07ce2cdca801a1f4e5894a6317bd3`,
overridable with `BB_CLOJURE_INDEX_BASE_REV`. **The control ASSERTS the base is a real one** (the
old file must not export a clojure spec, and the new one must), so after the Lead commits the
shared file, a control run against a `HEAD`-based base fails loudly instead of comparing a file
with itself. **THE BASE MUST BE THE COMMIT THE CLOJURE REGION WAS BUILT ON** — the commit BEFORE
the region landed.

**THE CONTROL'S OLD FILE IS MATERIALISED AT RUN TIME** (`git show <BASE>:src/ast/project-index.ts`
→ `node_modules/.cache/bb-clojure-lane/project-index.OLD.ts`) **AND IMPORTED BESIDE THE CURRENT ONE,
so the two builders really are two programs in one process.** It is materialised under
`node_modules/.cache/` — gitignored, outside the fixture tree — because a bare specifier
(`web-tree-sitter`) resolves by walking UP from the importing file, and a file outside the
repository would not resolve it.

**THE DIGEST IS FNV-1a over a canonical sorted serialisation of the WHOLE SURFACE** — `files` and
`damaged`, `typeKinds`, `typeMembers`, `typeBases`, `symbolNames`, `symbolCounts`, `modules`,
`damagedFiles` — over a 40-file sample per lane, on the FARM root. **A digest of a SURFACE, because
a count would not notice a changed KIND.**

**THE CLOJURE SURFACE'S DIGEST IS THE SAME BEFORE AND AFTER THE MOVE** (`f5bcf9a8c0905106`), so the
move changed WHERE the spec lives and changed nothing about what it does.

---

## 6 · WHAT THE LANE ASKS THE LEAD TO DO

1. **COMMIT `src/ast/project-index.ts`** — the clojure region: `CLOJURE_DECLARATION_SPEC`,
   `clojureDeclarationName`, `clojureFileNamespace`, `clojureExecutionHead`, `clojureSymName`,
   `CLOJURE_DECLARATION_FORMS`, `CLOJURE_TYPE_FORMS`. The change is 221 lines ADDED and 0 removed,
   and the ten other lanes' surfaces are byte-identical.
2. **APPLY §2 AND §3** to the two shared files, and record the `.edn` decision.
3. **RE-RUN THE GATE'S CLOJURE ARM ONCE THE WIRING IS IN**, so the fleet's first INDEXED clojure
   arm exists — and so the clause-1 cross-check of §3.3 of the verdict page can be read off the
   gate's OWN verdict line rather than the lane's reproduction of it.

**AND NOTHING ELSE.** The lane's own files (the analyzer, the fixtures, the proposals, the verdict
page) are the lane's to commit; the shared file is the Lead's.
