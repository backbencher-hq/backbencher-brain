# EXPORTS_JAVA2 — ontology census, running ledger

Branch `analyzer/EXPORTS_JAVA2`. Corpus `<corpus-root>/java-lib`
(Guava, **3,275 `.java` files**, all measured — not a sample). Every number below
is produced by `script/m14/lanes/java-ontology-census.ts` on the **production
path** (`getParser` → `parse` → `RealJavaAnalyzer.analyze`), or by
`script/m14/firing-check-v2.mjs` where noted.

No regular expression is used in any instrument in this lane. Sampling, name
classification and every count are tree walks or character walks.

Whole-corpus run: 3,275 files in 127,265 ms, 0 parse/analyze failures,
87,050 symbols, 634,873 relationships.

---

## 0. Instruments, and one thing the fleet brief gets wrong about my lane name

`firing-check-v2.mjs` is the arbiter the brief names. The brief's command line is:

    cd $HOME/backbencher-brain && NFILES=200 bun script/m14/firing-check-v2.mjs EXPORTS_JAVA2

**Measured 2026-10-05: that command exits 2 and prints no measurement.**

    FIRING-CHECK v2: no lane matches "EXPORTS_JAVA2".
    Known lanes: RUST GO TYPESCRIPT JAVA KOTLIN SCALA GROOVY HASKELL SWIFT CLOJURE VB RUBY ERLANG ELIXIR C CPP OBJ_C JAVASCRIPT VUE SVELTE HTML

`resolveLane()` (script/m14/firing-check-v2.mjs:180-205) tries, in order: exact
lane key, an explicit alias from any underscore-delimited token, a token of ≥3
chars that PREFIXES a lane key, and a lane key the whole name starts with.
`EXPORTS_JAVA2` normalises to `EXPORTSJAVA2`; its tokens are `EXPORTS` (prefixes
no lane key) and `JAVA2` (prefixes nothing, because the key is `JAVA`). The
programme's current lane-name shape is `<WORKSTREAM>_<LANG>[_<n>]`, and step 4
only accepts `<LANG>_<SUFFIX>`. The working invocation for this lane is the bare
lane key, and that is what every number below labelled firing-check used:

    NFILES=200 bun script/m14/firing-check-v2.mjs JAVA

Reported to MASTER as a shared-harness defect; **not fixed here** (script/m14/**
is MASTER-owned). The script fails loudly — exit 2 with "This is NOT a pass" —
so this is a usability defect, not a silent-pass defect.

---

## 1. Baseline: firing-check-v2, NFILES=200, before any change

    production vocabulary (10): calls extends implements uses imports exports contains references overrides instantiates
    JAVA  8/10  200/200 parsed  imports[] 2089
    silent: imports exports
    fired:  calls extends implements uses contains references overrides instantiates
    counts: calls:8272  references:7482  contains:2257  uses:653  overrides:489  instantiates:430  extends:178  implements:66

Handover said "JAVA is 8/10, silent on imports and exports". **Measured,
confirmed 8/10 on the relationship channel.**

**Sample size moves this score, and I measured that rather than assuming it:**

| NFILES | lane | fired | silent |
| --- | --- | --- | --- |
| 200 | JAVA (java-lib) | 8/10 | imports, exports |

The first 200 lexicographic `.java` files of java-lib are all under
`android/guava-testlib/` — one subproject, test-suite code. The whole-corpus
numbers below are the ones I rest the verdict on, and they agree: the same 8/10,
with the same two silent types, at 3,275 files instead of 200.

---

## 2. ParseResult carries THREE channels; firing-check tallies one

| channel | field | whole java-lib corpus (3,275 files) | persisted by |
| --- | --- | --- | --- |
| relationship | `relationships[]` | 634,873 edges, 8 distinct types | `brain_relationship` rows |
| import | `imports[]` | **38,923** in 3,245 files | the `brain_import` TABLE |
| export | `exports[]` | **3,289** in 3,227 files | **nothing** |

The third row is measured, not inferred. `grep -rn "result\.exports\|res\.exports" src/`
finds exactly one reader — `engine.ts:1801`, which copies `result.exports` into
the returned `ParseResult` — and **no read at all in `parallel-indexer.ts`**,
which is the only writer of `brain_relationship`. So a lane can carry a
perfectly good export surface in the channel no consumer reads and still read
"silent" on the relationship channel. That is what java does.

A fourth measured consistency fact, because it matters for the `imports` verdict:
`references` carries `evidenceClass: "import_based"` on **38,923** edges — exactly
the `imports[]` total. Every java import produces exactly one import-derived
`references` edge, with nothing double-counted and nothing dropped.

---

## 3. Per-type verdict table — all ten, whole corpus

Confidence and evidenceClass distributions are in §4. Endpoint resolution is in §5.

| # | type | verdict | count (3,275 files) | where it came from |
| --- | --- | --- | --- | --- |
| 1 | `calls` | **EMITTED** | 262,870 | every file; `method_invocation` → leaf name |
| 2 | `extends` | **EMITTED** | 4,248 | every file with a `superclass` |
| 3 | `implements` | **EMITTED** | 1,940 | `super_interfaces` / `extends_interfaces` |
| 4 | `uses` | **EMITTED** | 19,691 | field reads, JPA/Spring mappings |
| 5 | `contains` | **EMITTED** | 83,761 | owner → member |
| 6 | `references` | **EMITTED** | 221,127 | imports (38,923) + type references |
| 7 | `overrides` | **EMITTED** | 19,909 | 4-tier resolver |
| 8 | `instantiates` | **EMITTED** | 21,327 | `object_creation_expression` |
| 9 | `imports` | **EMITTED** on `imports[]`; **not emitted** on the relationship channel (0 edges) | 38,923 / 0 | 3,245 of 3,275 files |
| 10 | `exports` | **GAP → implemented** | 0 relationship / 3,289 array | §6 |

Nothing here is RULED. Every type java emits has a count, and the two that were
silent both have the construct present in the corpus.

---

## 4. Confidence and evidenceClass, per type (Part 1 q6)

The honesty contract's threshold: below 0.7 is declared suspicion, not a fact.

| type | confidence distribution | evidenceClass distribution | verdict on confidence |
| --- | --- | --- | --- |
| `calls` | 0.7: 260,628 · 1.0: 1,217 · 0.8: 1,025 | `usage_contextual` 262,870 | 99.1% sit exactly ON 0.7, none below. Honest: a call edge's callee is a leaf name leaf-resolved in another file, and `isJavaBuiltin` excludes the JDK. |
| `extends` | 1.0: 4,248 | `structural` 4,248 | correct — `extends A` is written in the source. |
| `implements` | 1.0: 1,940 | `structural` 1,940 | correct, same reason. |
| `uses` | 0.6: 13,497 · 1.0: 6,194 | `usage_contextual` 19,691 | **0.6 is below the 0.7 fabrication threshold and carries no `reasonCode`.** §7 finding. |
| `contains` | 1.0: 83,761 | `structural` 83,761 | correct. |
| `references` | 0.95: 181,112 · 0.9: 40,015 | `reference_qualified` 182,204 · `import_based` 38,923 | correct: a written import path is a fact about the file, 0.9, and the import channel carries it independently. |
| `overrides` | 0.5: 17,452 · 1.0: 2,244 · 0.9: 213 | `inferred` 17,452 · `structural` 2,244 · `usage_contextual` 213 | correct by design: the 0.5 tier is the first-parent guess and is deliberately below 0.7 so it cannot reach pattern analysis. `reasonCode` present. |
| `instantiates` | 0.95: 21,327 | `structural` 21,327 | correct — `new X()` is written. |
| `exports` | see §6 | see §6 | — |
| `imports` | — | — | — |

---

## 5. Endpoint resolution, per type (Part 1 q5)

Measured with a three-way classifier, not a curated list, because a literal list
that convicts `value`, `constructor` or `unknown` reports noise as debt:

- **RESOLVES** — a plain-name endpoint that binds to a symbol THIS file declares.
- **NOT_AN_IDENTIFIER** — the endpoint cannot be a Java name at all.
- **PLACEHOLDER_LITERAL** — a syntactically valid identifier standing in for an
  absent name.

| type | plain-name endpoints | resolve in-file | NOT_AN_IDENTIFIER | placeholder |
| --- | --- | --- | --- | --- |
| `calls` | 525,740 | **60.5%** | 0 | 0 |
| `extends` | 8,490 | 61.7% | **6** | 0 |
| `implements` | 3,880 | 54.5% | 0 | 0 |
| `uses` | 39,382 | **76.7%** | 0 | 0 |
| `contains` | 167,518 | **100.0%** | 0 | 4 |
| `references` | 442,100 | 53.1% | **154** | 0 |
| `overrides` | 39,818 | **100.0%** | 0 | 0 |
| `instantiates` | 42,654 | 63.4% | 0 | 0 |

**The sub-100% figures are the analyzer's declared per-file boundary, not a
defect.** Analyzers emit edges from the file being analyzed; resolving who points
AT you — and resolving a target declared in a sibling file — is the incoming
resolution subsystem, which is not built. `contains` and `overrides` resolve at
100% precisely because both endpoints are, by construction, in the same file;
`calls`/`references`/`instantiates`/`extends`/`implements` targets are usually in
another file. Stating this as a caveat rather than as a percentage is the honest
form: **the resolution numbers above measure in-file binding, not
index-wide binding.**

**The two non-zero hygiene cells are real and are §7 findings:**

- `extends`: 6 endpoints carry unresolved generic type arguments, e.g.
  `AbstractMultiset<E>.EntrySet` and `Red<B>.Orange` — a `<` is not a character
  any Java declaration's name can contain.
- `references`: 154 endpoints are not names, in two distinct shapes:
  `newArrayList(v3(), v4())` (raw invocation text as a target) and
  `LinkedHashMultimap<String, Integer>.ValueSet` (the same unstripped-generic
  defect as `extends`).
- `contains`: 4 endpoints flagged `unknown`. **All four are false positives of
  the probe, and I checked rather than assumed**: `guava-tests/.../ArrayBasedCharEscaperTest.java:89`
  writes `private final char[] unknown = new char[] {'?'};`. `unknown` is an
  ordinary Java field name in that file, so the edge names a real symbol. The
  probe is wrong here, not the analyzer — registered in §7.

---

## 6. `exports` — the GAP, and the two decisions behind it

`exports` is **constructible** in this analyzer (one emission site,
`real-java-analyzer.ts:679`, the Spring-MVC route branch) and it **fires zero
times** on java-lib, because Guava is a library with no Spring MVC. A branch that
never matches on the corpus is dead code as far as the corpus is concerned.

Meanwhile the export surface java *does* compute is real and measured: **3,289
entries across 3,227 of 3,275 files**, in the `exports[]` channel, which nothing
persists.

### Decision 6a — the export surface becomes `exports` relationships

Measured before deciding anything:

- export-set visibility on java-lib: **`public` 2,565 · no visibility modifier 718
  · `private` 6** (3,289 total).
- 0 of 3,227 files with an export set declare no package, so a package-scoped
  source is available for every one of them.

An `exports` edge asserts **importability**, and Java's rule for a top-level type
is `public` (JLS 6.5.5.1 / 7.6): a package-private top-level type is bindable
only inside its own package. So 718 of 3,289 entries — 21.8% — must not be
published as a 1.0 export. They are measured, not estimated, so this is not a
dead branch: the distinction is live on this corpus.

### Decision 6b — module-info is NOT out of scope, and here is the measurement

`script/m14/spec/java-completeness.json` decision **G5** ruled
`module-info.java` out of scope (owner approval 2026-08-26) on the grounds that
"module-info is rare, low-value for AI code understanding". That is a prose
justification, and the workstream's own contract is explicit that prose is not
sufficient. Measured on the corpus:

| construct | occurrences | files |
| --- | --- | --- |
| `module-info.java` | 3 | 3 |
| `module_declaration` | 3 | 3 |
| **`exports_module_directive`** | **24** | **3** |
| `requires_module_directive` | 12 | 2 |
| `opens_module_directive` | 0 | 0 |
| `uses_module_directive` | 0 | 0 |
| `provides_module_directive` | 0 | 0 |

Instrument A (grammar inventory over 222 distinct node types) finds
`exports_module_directive` **PRESENT, 24 occurrences**. Under the ontology gate's
own rule — "a ruled type whose construct probe finds a non-zero count is
FALSIFIED" — the *absence* half of G5 does not survive. G5's frequency claim is
right (3 of 3,275 files = 0.09%); its exclusion claim is not supportable on
evidence, so the construct is read.

What G5 named as its alternative — option (b), "emit requires/exports/opens/uses/
provides targets as References/imports (dependency edges)" — is what is
implemented, and the reason is a storage contract, not taste:

- A JPMS directive names a **package**, not a symbol.
- `exports` in this family is a symbol-target kind: the harness-global F3
  invariant (`script/m14/run-fixtures.ts:1363-1400`) requires every export name
  to resolve to a **top-level importable unit**. A package resolves to nothing.
- `parallel-indexer.ts:3462-3467` drops any `exports` row whose source or target
  is path-shaped (lower-case initial plus a `.`, `:` or `/`) — which every Java
  package name is. An `exports`-labelled JPMS edge would be produced, counted by
  every census, and **never stored**.
- `references` has no such filter, and java's import edges already persist as
  `references` with a dotted package target (38,923 measured in §2).

So: `exports` carries the **public top-level type** surface; the JPMS package
directives ride `references` as file-to-package dependencies. Both are real; they
are different questions and they are named differently.