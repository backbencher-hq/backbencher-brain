# AMBIGUITY_SWEEP — per-type verdicts, one commit per verdict

The `implements` / `overrides` / `instantiates` verdict problem on this lane was
never a language problem. It was that the two TypeScript corpora on disk cannot
contain the construct, and a verdict taken on either of them would have been the
corpus-not-the-language mistake wearing a measurement's clothes.

## Construct census first, because it decides which corpus is admissible

`construct-probe.ts` counts the construct on the parse tree (`node.type` via a
cursor walk; no regex, no text matching). Run over all three TypeScript corpora:

| corpus | files admitted | candidates examined | source bytes | AST nodes | `class_declaration` | `implements_clause` | `extends_clause` (class) | `extends_type_clause` (iface) | `new_expression` | `export_statement` | `call_expression` | `override` modifier |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| element-plus | 200 | 242 | 645,513 | 191,457 | 1 | **0** | 1 | 7 | 65 | 670 | 8,084 | 0 |
| typescript | 45 | 127 | 993,314 | 176,710 | 14 | **0** | 7 | 54 | 149 | 67 | 4,148 | 0 |
| vuejs | 400 | 405 | 3,718,038 | 995,313 | 28 | **4** | 8 | 135 | 748 | 1,520 | 43,523 | 0 |

Admissibility follows directly from that table:

- **element-plus** is a Vue *component* library: 1 `class_declaration` in 200
  files. It cannot answer `implements`. `firing-check-v2` scored it silent on
  `implements` and `overrides`, and the sample is the reason, not the analyzer.
- **typescript** is 115/126 `.d.ts` — TypeScript's own bundled lib files.
  `firing-check-v2`'s first version scored TypeScript 3/10 with 0 imports and 0
  calls on it, which is *correct* for that corpus.
- **vuejs** is the only one of the three that contains the construct.

Note the `override` MODIFIER is 0 in all three corpora. TypeScript 4.3 made it
optional (required only under `noImplicitOverride`), so the keyword arm of the
analyzer is a minority path **by construction, and measurably so across 645
files of three corpora**. The structural arms are what carry this lane.

## `firing-check-v2` — the instrument, and what its number depends on

`NFILES=200 bun script/m14/firing-check-v2.mjs TYPESCRIPT`, corpus
`element-plus`, sampling `code-bearing`:

```
selected lane(s): TYPESCRIPT  (from TYPESCRIPT)
production vocabulary (10): calls extends implements uses imports exports contains references overrides instantiates
types.ts vocabulary (10):     calls extends implements uses imports exports contains references overrides instantiates
in types.ts but NOT produced: (none)      produced but NOT in types.ts: (none)

[1/1] TYPESCRIPT    8/10  200/200 parsed  imports[] 1144  silent: implements overrides
   e.g. typings/global.d.ts  typings/env.d.ts
   counts: calls:7853  imports:1588  references:1203  exports:494  contains:481  uses:60  extends:9  instantiates:2
```

**8/10.** The two silent types are `implements` and `overrides`, and the
construct census in the section above is why that is a fact about the corpus
rather than about the analyzer: element-plus has 0 `implements_clause` nodes and
0 `override` modifiers in the 200 files sampled, so both arms are correct to
abstain. `imports` is 1,588 on the relationship channel and 1,144 on
`res.imports[]` (181 files) — the two channels are reported separately by design
and are not expected to agree.

### The score moves with the sample, measured not asserted

The same analyzer, the same corpus, three file counts:

| NFILES | parsed | fired | silent | score |
| --- | --- | --- | --- | --- |
| 25 | 25/25 | calls, uses, imports, exports, contains, references, extends | implements, overrides, **instantiates** | **7/10** |
| 200 | 200/200 | + instantiates | implements, overrides | **8/10** |
| 400 | 400/400 | + instantiates | implements, overrides | **8/10** |

A one-point swing from a file-count knob, on the run the brief names as the
reportable number. The 25-file draw lands on `typings/*.d.ts` — element-plus
ships its type declarations as ambient `.d.ts` bundles, which declare types and
instantiate nothing. So **the score at NFILES=25 is a correct number about a
population that cannot contain the construct**, which is the same defect the
whole workstream exists to catch, one level up. 8/10 is the reported number and
it is stated with its sample: 200 files, 200 parsed, of the code-bearing
`.ts`/`.tsx` files under `fixtures/repositories/element-plus`.

### Two harness defects this lane hit while running it

1. **The lane name does not resolve.** `firing-check-v2.mjs AMBIGUITY_SWEEP`
   prints `no lane matches "AMBIGUITY_SWEEP"` and exits 2. `resolveLane` matches
   a lane KEY, a token in `ALIAS`, a token prefixing a key, or a name that
   *extends* a key — and `AMBIGUITY_SWEEP` extends none of the twenty language
   keys, because `AMBIGUITY_SWEEP` is a WORKSTREAM name, not a language name.
   Every AMBIGUITY_* lane hits this. The instrument is right to shout rather
   than print an empty table; it needs a workstream-name → language-key table.
   Reported to master; not fixed here (script/m14 is master-owned).
2. **The instrument reads the MAIN checkout.** `const REPO =
   "$HOME/backbencher-brain"` is not overridable, so firing-check-v2
   measures main's copy of the analyzer, not this worktree's. Measured
   byte-identical at the time of the run (`diff` on the two files, no output), so
   the number above is a number about this lane's code — but any analyzer edit
   made after that check silently stops being measured by this instrument.
   `BB_REPO` env support is the same reported need.

## DERIVATION — AMBIGUITY_SWEEP emits 8 audited types and 2 unaudited

`bun script/m60/rel-type-coverage-gate.ts --langs=typescript`, which EVALUATES
`differential.ts`'s own compared-label filter rather than restating it:

```
CHECK 1 — DERIVATION: every emitted type has an oracle derivation
  typescript   2 un-audited: ["exports","imports"]
  audited: ["calls","contains","extends","implements","instantiates","overrides","references","uses"]

REGRESSIONS (not in the recorded debt):
  DERIVATION|typescript|emits `exports` but the differential audits [...] — the type is stored and compared against nothing
  DERIVATION|typescript|emits `imports` but the differential audits [...] — the type is stored and compared against nothing
```

So the answer to "is AMBIGUITY_SWEEP among the 100 DERIVATION findings" is
**yes, twice**: `exports` and `imports` are emitted, stored, and compared
against nothing by the differential.

The header of `script/m14/ts-deriv-oracle-audit.ts` claims FOUR such types
(`exports`, `imports`, `references`, `uses`). That is stale: `differential.ts`
later admitted typescript to the `references` and `uses` sets, and
`deriveTypeScriptContainsTruth` put `contains` in the audited set. The gate
above is the authority because it reads the filter rather than the note.

## Question 3 — CORRECT: the two DERIVATION types, audited

`script/m14/ts-deriv-oracle-audit.ts` imports the differential's OWN truth
builders and allowlist expression and applies the differential's OWN matching
rule, so a number it prints is the number the differential would print once the
label is admitted. element-plus@3e07b0c677, 200 files admitted, 200 parsed:

```
corpus element-plus@3e07b0c677  admitted 200  parsed 200  failed 0
labels additionally admitted by --admit: imports exports

label         truth    covered  MISSING  cov%    analyzer  unexpl  unexp%  files
calls         1240     1240     0        100.0%  1240      0       0.0%    129
contains      332      332      0        100.0%  318       0       0.0%    38
exports       357      357      0        100.0%  357       0       0.0%    120
extends       5        5        0        100.0%  5         0       0.0%    4
implements    0        0        0        -       0         0       -       0
imports       1125     1125     0        100.0%  1125      0       0.0%    186
instantiates  12       12       0        100.0%  6         0       0.0%    5
overrides     0        0        0        -       0         0       -       0
references    677      543      134      80.2%   469       75      16.0%   118
uses          359      138      221      38.4%   98        43      43.9%   62
```

`exports` 357/357 covered, 0 unexplained, 120 files. `imports` 1125/1125, 0
unexplained, 186 files. Both DERIVATION types agree with an oracle that shares
no code with the analyzer.

**What this does not establish.** The oracle is a second walker over the *same*
tree-sitter-typescript 0.23.2 grammar, so a grammar bug shared by both paths is
invisible to this check — the harness's declared limitation, restated here
rather than papered over. And `instantiates` shows the shape of a real limit:
12 truth edges covered, 6 analyzer edges, both non-zero, 0 unexplained, so the
analyzer is a strict subset on this corpus and the oracle is finding sites the
analyzer does not emit. That is a gap to account for, not a clean bill.

## RESOLVED 2026-10-09 — the two DERIVATION types are compared, and wiring them found an oracle defect

Question 3's two un-audited types are now audited BY THE DIFFERENTIAL. The oracle
had existed since `5f7ccab16` and `differential.ts` had never called it —
`grep -c typescript-imports-exports script/m14/differential.ts` was 0 — so
`exports` and `imports` were emitted and stored by this lane and compared against
nothing. It is the same DERIVATION finding `java`, `kotlin`, `ruby`, `swift`,
`scala`, `objc`, `groovy`, `erlang`, `clojure` and `cpp` each carry in their own
lanes; this is the typescript repair.

**The change.** Four sites: the oracle import and its truth push in
`differential.ts` (the push uses the SAME `moduleLeaf` expression the audit uses —
`path.basename(relPath, path.extname(relPath))`, not this file's regex-strip
idiom used for the html/toml leaves, so the row pushed is the row the audit
counted), the `imports`/`exports` admission for `lang === "typescript"` in the
allowlist, and one fix inside the oracle itself (below). Truth and allowance land
together: truth alone is the #910 shape where a new oracle's rows read as MISSING,
and an allowance alone reports every emitted edge as fabrication (the G7 shape).

### The controlled comparison — same corpus, same files, same matching rule

`bun script/m14/ts-deriv-oracle-audit.ts`, whose allowlist is EXTRACTED from
`differential.ts`, so no `--admit` is needed any more (it prints
`labels additionally admitted by --admit: (none)`). Corpus
`typescript@50d70a3f5f`, 12 admitted, 12 parsed, 0 failed:

| label | truth | covered | MISSING | cov% | analyzer | unexplained |
| --- | --- | --- | --- | --- | --- | --- |
| `exports` | 65 | 65 | 0 | 100.0% | 65 | 0 |
| `imports`, first wired run | 108 | 106 | **2** | 98.1% | 106 | 0 |
| `imports`, after the oracle fix | 106 | 106 | 0 | **100.0%** | 106 | 0 |

Every other label is byte-identical between the two runs (`calls` 574/574,
`contains` 393/393, `extends` 10/10, `instantiates` 34/34, `overrides` 28/28,
`references` 816/750, `uses` 1331/941) — the only movement is the two rows.

### The 2 MISSING were an oracle defect in BOTH directions

The two rows the oracle derived and the analyzer refused were a computed module
path each:

```
tools/scripts/tsc/generate-enums.ts :: generate-enums -> data:text/javascript;charset=utf-8,${encodeURIComponent(enumSource)}:*
tsc/internal/stringutil/_scripts/generate-unicode-data.mts :: generate-unicode-data -> ${PACKAGE}/${property}/code-points.js:*
```

Neither is a module any injector can serve, and the analyzer refuses them by a
ruled rule (`real-typescript-analyzer.ts`, `literalModulePath`: "a specifier is a
plain `string`, or a `template_string` with no substitution in it ... a computed
module path is not an edge target"). The oracle's own comment claimed the same
rule (`specifierOf`: "a template specifier with no substitution IS a literal
path") and its implementation was wrong twice over. Measured against
tree-sitter-typescript 0.23.2 with an 8-case probe, because the predicate was a
child-TYPE test and guessing it wrong is how this survived:

```
static plain               clean           string{string_fragment}
static template plain      HAS_ERROR_NODE  template_string{string_fragment}
static template subst      HAS_ERROR_NODE  template_string{string_fragment,template_substitution}
require plain string       clean           string{string_fragment}
require template plain     clean           template_string{string_fragment}
require template subst     clean           template_string{string_fragment,template_substitution}
import() template subst    clean           template_string{string_fragment,template_substitution}
import() template plain    clean           template_string{string_fragment}
```

- `specifierOf` refused even LITERAL templates: its test was
  `x.type !== "string"`, which is true of `string_fragment`, the only named child
  a literal template has. Harmless in practice (a template in `import ... from`
  position is a parse error — row 2 of the probe) and wrong as a rule.
- The dynamic `import()`/`require()` branch accepted ANY `template_string`, so it
  derived the two rows above. That branch is where the finding landed.

Both sites now share one predicate, `isStaticSpecifier`: a `string`, or a
`template_string` with no `template_substitution` child. The rows vanish at the
source of the rule rather than by copying the analyzer's rulings, so the oracle
still reasons in the language's terms.

### The gate, and the fleet run it is not

- `bun script/m60/rel-type-coverage-gate.ts --langs=typescript`: **CHECK 1 clean**,
  and the baseline line reads `5 recorded, 0 NEW, 5 repaid` — all five recorded
  typescript DERIVATION findings (`contains`, `exports`, `imports`, `references`,
  `uses`) repaid, none new.
- The FULL fleet run of that gate exits 1 with `91 NEW, 69 repaid` at this
  commit. This is pre-existing and not this lane's: at HEAD, in a clean worktree,
  the same run reads `93 NEW, 69 repaid`, and the committed artifact itself
  recorded `81 NEW` at 2026-10-07. 93 - 91 = the two typescript regressions this
  change repays, and nothing else moves. The remaining debt is the other lanes'
  in-flight work (the `DERIV_EXPORTS_*` worktrees), which the gate keeps visible
  on purpose: a baseline that absorbs it silently is the defect the gate exists
  to prevent.
- `bun script/m14/verify-label-coverage.ts` (the other consumer of the extracted
  allowlist) lists 15 undeclared gaps in 9 lanes, 2,367 edges. **typescript is
  not among them** — it skips for lack of a local `vue-core` pin. Those 15 are
  the same other-lane debt, reported and not repaired here.
- `bun script/m14/ts-no-regex-count.ts`: **0 regular-expression uses** across this
  lane's oracles and analyzer (exit 0), from 3. All three were in
  `typescript-references.ts` — `/^[A-Za-z_$][A-Za-z0-9_$]*$/`, the
  identifier-shaped test — and the fleet rule is not one regex in any analyzer,
  census or oracle (LAPTOP-B brief §2). They are now one character-scan helper,
  `isIdentifierText`, and the equivalence is held by the audit re-run rather than
  by a comment: every label's row is byte-identical before and after
  (`references` 816 / 750 / 66, `uses` 1331 / 941 / 390, and so on).
- Fixtures: `bun script/m14/run-fixtures.ts --lang typescript` reads
  **96 pass / 6 fail**, and the six are the COUNT the baseline already holds
  (`validation/m14/fixture-baseline.json` records 6 for this lane), so the gate
  reports **no regressions**. The earlier `92 pass / 0 fail` row predates those
  six fixtures being added; `run-fixtures.ts` imports no oracle (0 matches), and
  no fixture or analyzer file is modified in this pass's change set, so none of
  the six is attributable to it.
- `bun script/m14/differential.ts --lang typescript --repo element-plus`,
  cold-pool rot 1 hash `1e1e558b09de5f10`: `files=60 tree-truth=1803
  covered=1614 (89.5%) MISSING=189 | analyzer-edges=1345 unexplained=17 (1.3%)`.
  Against the recorded pre-wiring row (`tree-truth=992 covered=838 (84.5%)
  MISSING=154 | analyzer-edges=755 unexplained=31 (4.1%)`, rot 3 hash
  `30555483d544ff75`), this is NOT a controlled A/B — the cold pool rotates, so
  the two runs sample different files. The controlled comparison is the audit
table above, on one corpus with one matching rule. What the differential adds is
the magnitude the hole was hiding: **590 analyzer edges** (`imports` + `exports`)
previously dropped before comparison are now compared.

### The instrument that overstated, and was fixed

The scoped gate run above is also what exposed a defect in the GATE, not the
lane: `--langs=typescript` used to write its 1-lane result over the committed
43-lane evidence artifact, deleting 1,693 lines of recorded fleet evidence and
leaving a current timestamp on a claim that was no longer the claim (probed,
reverted, and the artifact at HEAD is intact), and its baseline line read
`104 recorded, 0 NEW, 104 repaid` — every other language's debt reported repaid
because the run never looked at it. Both writes are now refused for a scoped run
with the reason printed, the arithmetic is scoped by the `CHECK|lang|detail` key,
and the scoping has self-tests (`--self-test`: 20 passed, 0 failed, 0 skipped —
including "a scoped run cannot report another lane's debt repaid" against an
unscoped control).

`references` (80.2% / 16.0% unexplained) and `uses` (38.4% / 43.9% unexplained)
are the two labels with real disagreement, and question 4 is where it lives —
and this pass found the largest single cause of it (next section).

## RESOLVED 2026-10-09 (second pass) — `references` resolved a BOUND name to a class member

A constructor's parameters and an accessor's locals were invisible to the pass
that publishes `references`, so a bare read of a name that a class also declares
as a member was published as the CLASS referencing its own member.

### How it was found, and why the earlier count missed it

Question 4's probe reported 5 `(source, target)` pairs under both labels and
those 5 were filed as duplicate-label violations. Four of them were not: their
two labels sat on different LINES, and each line is a different read. The pair
key could not tell "one read, one label" from "two reads of one name". The probe
is now LINE-AWARE (`ts-type-mention-label-probe.ts`, `bothLabelsSameLine` vs
`bothLabelsDifferentLine`), and on the same corpus it reports **0 pairs at the
same `(source, target, line)`** — the contract is not violated anywhere in the
200-file draw — and 5 (now 1) pairs whose two labels are two sites.

The residue was the finding. Of the 5 pairs, 4 contained a `references` row
whose target is a name BOUND at the site it was emitted from:

| file:line | row | what is actually written there |
| --- | --- | --- |
| `cascader-panel/src/node.ts:60` | `references Node -> config` | `readonly config: CascaderConfig,` — a constructor PARAMETER PROPERTY |
| `cascader-panel/src/node.ts:89` | `references Node -> isDisabled` | `return isDisabled \|\| …` — a local `const` in an accessor body |
| `cascader-panel/src/node.ts:97` | `references Node -> isLeaf` | `return isUndefined(isLeaf)` — the same shape in the other accessor |
| `cascader-panel/src/store.ts:32` | `references Store -> config` | the same parameter-property shape |

The 5th pair (`lazyLoad \| id`, a `.test.tsx`) is two READS of a module-level
`let id` — a write at :120 and a template read at :121 — so it is a pair of
labels on a pair of sites and no contract applies to it. It is the one pair
that survives the fix, which is why it is named here rather than dropped.

### The mechanism, and it is a scope-rebinding gap rather than a shadow-set one

`resolveRelationshipSymbol` rebinds the walk's current symbol only for the
symbol kinds `Function` and `Method`, and TSD2's fresh-locals reset requires the
same two kinds. A constructor's symbol kind is `constructor` and an accessor's is
`property` — measured, not assumed: `extractSymbols` on `node.ts` publishes
`constructor kind=constructor owner=Node` and `isLeaf kind=property owner=Node`.
So the walk never rebinds for either, and their bodies and parameter lists were
walked with the CLASS as the current symbol, where `locals`,
`refShadowed` and `parameterNamesOf(currentSymbol)` see none of their bindings.
A method does rebind, which is why the same shape inside `appendChild` was
already right (`appendChild -> Node` at :110 is a module-level class read and is
kept).

### Two grammar facts, measured by probe against this repo's tree-sitter-typescript

Both were wrong in the same direction in more than one place, so they are stated
as facts rather than as fixes:

| written form | `arrow_function` fields |
| --- | --- |
| `name => name` | `parameter=identifier` — **SINGULAR** |
| `(x) => x` | `parameters=formal_parameters` |
| `({ p, q }) => p` | `parameters=formal_parameters` |
| `method_definition`, function declarations | `parameters=formal_parameters` |

A lookup of `parameters` alone returns null for the first shape, so a
one-parameter arrow's parameter is never bound. Three separate sites had this:
the analyzer's new scan (twice — the first version also missed that a
`required_parameter`'s `pattern` is a bare `identifier`), and the `references`
oracle. R14's arrow-parameter block above it
(`n.childForFieldName("parameters")`, then `params.namedChildren`) has the same
blind spot and is left as it stands, because the new scan answers the same
question for the guard R14 feeds; the gap is recorded here rather than repaired
silently in a second place.

### The fix, in two files

- `real-typescript-analyzer.ts`: `bindingsEnclosing(n)` — the union of the names
  bound by EVERY function-like scope enclosing `n` (parameters including
  parameter properties, local declarators, loop variables, catch bindings; the
  scope's own body scanned once and cached by node id). It gates the
  `references` guard and NOTHING else, which is the R13 precedent: `locals` also
gates `uses`, and a `uses` edge to a bound name is sometimes wanted. One subtree
  scan per scope, not per identifier; the union over all enclosing scopes rather
  than the nearest one, because a constructor's parameter still binds inside an
  arrow nested in the constructor (the nearest-scope-only version left
  `Node -> config` at node.ts:77 standing).
- `script/m14/oracles/typescript-references.ts`: `paramNodeOf` (both field names)
  and a `paramNames` total over the three shapes. The oracle walks scopes
  properly, but it could not see this binding either, so it derived the same
  rows; a fix on one side alone would have manufactured MISSING rows.

### Measured, on fixed corpora with the oracle as the independent side

The audit imports the differential's own truth builders, so its allowlist is the
one the differential uses. `bun script/m14/ts-deriv-oracle-audit.ts`:

| corpus | label | truth | covered | MISSING | cov% | analyzer | unexplained | unexp% |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typescript@50d70a3f5f, 12 files — before | `references` | 816 | 750 | 66 | 91.9% | 300 | 22 | 7.3% |
| same — after | `references` | 776 | 720 | 56 | **92.8%** | 279 | **10** | **3.6%** |
| vuejs@4ab865a848, 400 files — before | `references` | 8,107 | 7,209 | 898 | 88.9% | 4,158 | 760 | 18.3% |
| same — after | `references` | 8,047 | 7,106 | 941 | 88.3% | 3,503 | **186** | **5.3%** |

On vuejs the analyzer stops publishing **655** `references` rows and the rows
the oracle could not derive fall 760 → 186. In the other direction MISSING rises
898 → 941: 43 truth edges that used to be matched have no analyzer edge now,
which is the part of the oracle's binding model that still does not see these
bindings. That number is reported, not smoothed: the oracle's side is a rule
under test, exactly as the `uses` experiment below shows.

Everything else on those two runs is byte-identical (`calls` 7,127/7,127,
`overrides` 71/71, `uses` 4,109/1,926 unchanged on vuejs; `calls` 574/574,
`contains` 393/393, `exports` 65/65, `extends` 10/10, `instantiates` 34/34,
`imports` 106/106 on typescript).

**Row-level, and this is the strongest evidence in the section: the change is a
pure removal.** Full relationship row sets at each population, diffed between a
clean HEAD worktree and this tree — element-plus 200 files: 15 rows removed
(`references`) and **0 added**; 400 files: 83 / 0; the whole repository, 1,205
files: 194 / 0. typescript corpus, 12 files: 46 / 0. Every removed row was
adjudicated against its source line and each is a name bound at the site
(constructor and method parameter properties, arrow parameters, local
`const`s, loop variables such as `for (const kindType of …)`).

### The `uses` oracle is the OPPOSITE rule, and that experiment was reverted

Applying the same measured grammar fact to `typescript-uses.ts` made THAT label
worse, on the same corpus and matching rule: truth 1,331 → 1,314, covered
941 → 924, unexplained 49 → 50, cov% 70.7 → 70.3. That is not a bug on the `uses`
side: surface 3 publishes a template read of a PARAMETER on purpose (the
`interp-uses` fixture pins `greet -> name` for a template interpolation of its own
parameter), so a nested arrow's parameter is a name this label WANTS to publish.
The change is reverted and the measurement is kept in the file where the next
reader will look for it.

### The differential, on the pool hash the earlier rows were pinned to

`bun script/m14/differential.ts --lang typescript --repo element-plus`, cold pool
rot 3, hash `30555483d544ff75` — the SAME hash the pre-wiring row was recorded at:
`files=60 tree-truth=1,555 covered=1,396 (89.8%) MISSING=159 |
analyzer-edges=1,312 unexplained=28 (2.1%)`, unexplained by label `references=19,
uses=9`. Against that recorded row (`tree-truth=992 covered=838 (84.5%)
MISSING=154 | analyzer-edges=755 unexplained=31 (4.1%)`) the movement spans BOTH
this pass and the DERIVATION wiring pass, so it is a corroborating datapoint and
not an isolated one — the audits above are the controlled comparisons.

### The census tables below are re-runs of this pass

Instrument, population rule and two-scope rule are unchanged; the numbers in the
next section are the same measurement taken after the fix.

The AMBIGUITY_FLEET method (`real-zig-analyzer.md` §F), never run for this lane
before this pass. An AMBIGUOUS target is one edge that a reverse walk must
attribute to one declaration when the name it carries is published more than
once; both scopes are reported and never mixed, on the census's own two-scope
rule: WITHIN-FILE resolves against the symbols that same `analyze()` call
published (the tightest reading — the one a reverse walk inside one file
actually faces), CORPUS resolves against every symbol this run published.

Instrument: `validation/m14/instruments/typescript/ambiguity-census.ts`, the
production path (`getParser` -> `parse` -> `analyze`), population derived by
`readdirSync` and printed by the run. The count is only taken where the target
resolves at all, and the corpus-scope column is a LOWER BOUND — the JSON carries
`corpusScopeIsLowerBound: true`, because a target declared outside the 400-file
sample reads as unresolved, not as absent. Artifacts:
`validation/m14/results/typescript-ambiguity-census-element-plus-400.json` and
`-rxjs-400.json` — note these are ON-MACHINE evidence, not committed: the local
exclude `validation/**/*-census-*.json` (.git/info/exclude:11) keeps census JSONs
out of the tree, and the runs above reproduce them (`BB_TS_SAVE=<path>` beside
`BB_TS_REPO=`), so a reader who does not have the files can regenerate them
rather than take a number on trust.

**A — element-plus @400.** 400 admitted of 497 candidates, 400/400 parsed, 0
failed, 0 files with parse errors, 5,826 symbols, 30,044 edges (30,135 before
this pass).

| type | edges | within-file ambiguous | rate | corpus ambiguous | rate |
| --- | --- | --- | --- | --- | --- |
| `calls` | 20,770 | 287 | 1.38% | 2,055 | 9.89% |
| `uses` | 215 | 14 | 6.51% | 107 | 49.77% |
| `contains` | 1,306 | 208 | **15.93%** | 615 | **47.09%** |
| `imports` | 3,436 | 0 | 0.00% | 0 | 0.00% |
| `references` | 3,135 | 18 | 0.57% | 101 | 3.22% |
| `exports` | 1,135 | 7 | 0.62% | 113 | 9.96% |
| `extends` | 33 | 0 | 0.00% | 0 | 0.00% |
| `implements` | 0 | — | — | — | — |
| `overrides` | 0 | — | — | — | — |
| `instantiates` | 14 | 0 | 0.00% | 0 | 0.00% |
| **pooled** | **30,044** | **534** | **1.78%** | **2,991** | **9.96%** |

Movement from the 2026-10-09 first-run table (`references` 3,227 edges / 47
within-file ambiguous — 1.46% — / 156 corpus; pooled 562 = 1.86%): the
`references` rows the fix removes are exactly the kind of row this metric calls
ambiguous — a bare member name whose declaration is in the same file — so the
label's within-file rate falls **1.46% → 0.57%** and the pooled rate 1.86% →
1.78%. `uses` reads 215 rather than 214: one row more on this instrument's own
population, which no row-level diff reproduces (the whole repository diff is 194
removals and 0 additions), so it is reported as a one-row movement on this
instrument rather than attributed to the fix.

**B — rxjs @400.** 400 admitted of 402 candidates, 400/400 parsed, 0 failed, 0
files with parse errors, 17,175 symbols, 44,084 edges (44,307 before this pass).
The class-bearing corpus, so all ten types fire and the two heritage types have
rows.

| type | edges | within-file ambiguous | rate | corpus ambiguous | rate |
| --- | --- | --- | --- | --- | --- |
| `calls` | 36,108 | 154 | 0.43% | 5,673 | 15.71% |
| `uses` | 444 | 95 | 21.40% | 207 | 46.62% |
| `contains` | 789 | 190 | **24.08%** | 406 | **51.46%** |
| `imports` | 2,409 | 0 | 0.00% | 0 | 0.00% |
| `references` | 3,051 | 11 | 0.36% | 546 | 17.90% |
| `exports` | 506 | 4 | 0.79% | 67 | 13.24% |
| `extends` | 35 | 0 | 0.00% | 14 | 40.00% |
| `implements` | 5 | 0 | 0.00% | 3 | 60.00% |
| `overrides` | 9 | 0 | 0.00% | 0 | 0.00% |
| `instantiates` | 728 | 0 | 0.00% | 633 | 86.95% |
| **pooled** | **44,084** | **454** | **1.03%** | **7,549** | **17.12%** |

Movement from the first-run table (`references` 3,274 / 30 within-file (0.92%) /
652 corpus; pooled 473 = 1.07%): the same 223-row removal, and the label's
within-file rate falls **0.92% → 0.36%**. rxjs is the class-heavy corpus —
`Observable`, `Subscriber` and their constructors and accessors — which is exactly
where this defect class lived, and the 223 rows are its share of it.

**What the numbers say, and what they do not.** `contains` is the worst type in
both populations and by a wide margin (15.93% / 24.08% within-file against a
pooled 1.78% / 1.03%), which is the same Type and the same cause the zig filing
found: a `contains` target is a BARE MEMBER NAME, so it collides with every other
declaration of that name in the file, while `calls` targets are leaf callee names
in call position and resolve far more often. `uses` is second. The per-type
RANKING is comparable to §F's; the pooled rates are NOT — §F's denominator is
declaration endpoints pooled over its own 3,834-file fleet corpus, this one is
edges over a single 400-file corpus, and the corpus column here is a lower bound.

**`imports` reads 0.00% in both scopes BY CONSTRUCTION and is not a clean bill.**
Its target names a symbol in ANOTHER module (`<specifier>:<name>`), which by
definition collides with nothing in this file's or this sample's symbol table, so
the metric cannot see its ambiguity at all. That is why its `w/in-both` column
reads 0.0% on both corpora in the full census output.

Small-n rows are marked rather than quoted: `extends` and `implements` on rxjs
(35 and 5 edges) and every rxjs `overrides` row (9 edges) are facts about five
files, not rates about a language. Element-plus's `implements`/`overrides` rows
read `NO EDGES` — the corpus starvation this document rules on above, restated
here so the dash is not read as a pass.

## Question 4 — LABELLED: the uses/references boundary, counted

The lane's own rulings (TSD18, TSD28) hold that one read is SINGULAR, one
label — both were fixes for a template read published as `uses` by one pass and
`references` by another. `ts-type-mention-label-probe.ts` asks whether the
analyzer still publishes the same `(source, target)` under both labels.
element-plus, 200 files, 200 parsed:```
(source,target) pairs published under BOTH uses AND references: 1
  packages/components/cascader-panel/__tests__/cascader-panel.test.tsx :: lazyLoad|id

SAME (source,target,line) under BOTH labels = ONE READ, TWO LABELS: 0
pairs whose two labels are at DIFFERENT lines (two reads, not a violation): 1
```

**RETRACTED: the 5-pair / 0.49% headline published in the first run of this
document.** Those 5 pairs were counted on `(source, target)` alone, which cannot
tell ONE READ PUBLISHED TWICE from TWO DIFFERENT READS of one name wearing one
label each — and 4 of the 5 were the second shape. The probe carries the site
now (`bothLabelsSameLine` / `bothLabelsDifferentLine`), and the answer to the
question this section asks is **0 pairs at the same `(source, target, line)`**
across 999 `uses`+`references` edges on 200 files (1,014 before the fix — the 15
missing rows are the bound-name rows removed in the resolution section): the
one-read-one-label contract holds on the whole surface, on this corpus.

What the 5 pairs DID contain is a real defect, and it is not a labelling one:
4 of them carried a `references` row whose target is a name bound at the site it
was emitted from (a constructor parameter property, a local `const` in an
accessor body). It is filed in the resolution section above and FIXED there, and
its within-file ambiguity contribution is why the `references` rate in the next
section moves as far as it does. The one surviving pair is the two-site shape:
a write at `:120` and a template read at `:121` of a module-level `let id`, which
is two reads and two edges — no contract applies.

The measured lesson, kept rather than tidied: a pair key is a NAME-level key. A
probe for a PER-READ contract has to carry the read.

Analyzer surface by the metadata the emitting pass wrote, element-plus 200 files
— this is the label distribution question 4 asks, per emission site rather than
pooled. It is the post-fix run: `references/plain` reads 111 rather than 126 and
`uses/plain`/`uses/expr`/`uses/field`/`uses/type` are unchanged (297/59/50/9),
which is the same statement as the row-level diff — one surface moved, the others
did not:

| surface | edges | | surface | edges |
| --- | --- | --- | --- | --- |
| calls/plain | 5,424 | | references/declared_type | 284 |
| imports/plain | 1,109 | | references/plain | 111 |
| exports/plain | 370 | | references/type_alias | 99 |
| contains/plain | 339 | | references/type_argument | 47 |
| uses/plain | 297 | | references/cast_target | 32 |
| uses/expr | 59 | | references/return_type | 11 |
| uses/field | 50 | | instantiates/plain | 9 |
| uses/type | 9 | | extends/plain | 5 |

## Question 5 — R7: 447 reported, 0 real, and the 140 adjudicated one by one

Two instruments disagree about R7 on this lane, and the disagreement is the
finding:

| instrument | population | R7 endpoints reported |
| --- | --- | --- |
| `ts-ontology-census.ts` | element-plus whole, 1,069 admitted / 1,069 parsed | src 32 + tgt 415 = **447** |
| `ts-r7-endpoint-probe.ts` | element-plus, 400 files, 22,631 edges | **140** |

Neither number is `unknown` endpoints. The R7 probe's 140 break down into four
values, and each one is real code read at its source line:

| value | n | what it actually is |
| --- | --- | --- |
| `fn` | 130 | `vi.fn()` — a member call reduced to its leaf, which is the documented `calls` rule (`obj.method()` → `method`) |
| `default` | 8 | a default import / default export binding, named `default` in the source |
| `./node:default` | 1 | `import type { default as CascaderNode } from './node'` — cascader-panel/src/types.ts:3. The imported binding IS spelled `default`. |
| `placeholder` | 1 | a declared class property — `placeholder: String` at cascader/src/cascader.ts:160, and `placeholder?: string` at :36. The word collides with the placeholder vocabulary; the symbol does not. |

**R7 violations: 0.** Not because the check was relaxed — because every one of
the 447 flagged endpoints was traced to a declaration or a documented leaf
reduction. The 447 is `ts-ontology-census.ts`'s own `PLACEHOLDER_LITERALS` set
(`:45-50`) convicting `name`, `value`, `string`, `number`, `object`, `symbol`,
`any`, `foo`, `bar`, `baz`, which are ordinary TypeScript identifiers; its own
examples are `Sponsor -> name` and `getNav -> values`. Reported, not fixed.

Alongside R7, measured on the same runs:

- **0 empty endpoint names** (both instruments, both populations).
- **0 `unknown` SymbolKinds** — no emitted symbol has an empty or `unknown`
  kind.
- **0 edges below confidence 0.7.** Histogram over vuejs, 63,046 edges:
  `calls` 43,376 at 0.90; `uses` 1,552 at 0.85/0.90; `contains` 3,514 at 1.00;
  `imports` 4,764 at 1.00; `references` 7,670 at 0.80/0.95; `exports` 1,791 at
  1.00; `extends` 152 at 1.00; `implements` 5 at 1.00; `overrides` 71 at 0.95;
  `instantiates` 151 at 1.00.
- **0 sub-1.0 edges without a reason code** (M14-HONESTY-CONTRACT §4.1), and
  every one of the ten types carries an `evidenceClass` on every edge.

### The one mislabelled `evidenceClass` — RESOLVED 2026-10-09, and it was demoting the row

`overrides` reported `evidenceClass: usage_contextual` at 0.95 while every other
structurally-derived type on this lane reports `structural`
(`contains`/`exports`/`extends`/`implements`/`instantiates`). The overrides arms
ABSTAIN unless the base declaration resolves in-file
(`if (!baseDecl) continue`), so the edge is derived from in-file structural
truth and not from a contextual mention. It is now stamped `structural`.

Two independent fleet facts decided it, and neither is this lane's own opinion:

- `real-csharp-analyzer.ts:2369` and `real-dart-analyzer.ts:2748` stamp
  `structural` for `overrides` **unconditionally**, so the class is not a matter
  of taste in the fleet's newest analyzers. The JVM family
  (`real-java-analyzer.ts:2369`, `real-kotlin-analyzer.ts:2287`) and
  `real-rust-analyzer.ts:1470` carry the older confidence-tier mapping this lane
  had copied; that convention is theirs and is NOT changed here. The fleet
  comparison is recorded rather than harmonised.
- `src/lsp/evidence_tier.ts` lists `overrides` in its `STRUCTURAL_KINDS` set, so
  the LSP would DERIVE `structural` for such a row — but rule 1 of its own
  derivation makes a STORED legend-tier claim win. This stamp therefore DEMOTED
  every overrides edge from rank 0 to rank 2 (legend order: `structural`,
  `import_based`, `usage_contextual`, `reference_qualified`, `inferred`) in
  hover, `impact` and the tier list. The stored claim now agrees with the rule
  that would otherwise classify it, which is a user-visible repair and not a
  re-label.

Measured with the census instrument on the corpus the finding was filed on
(vuejs @400, `evidenceClass per type` line): `overrides usage_contextual=71
(100.0%)` → **`overrides structural=71 (100.0%)`**, with `uses`
`usage_contextual=1552` and `references` `reference_qualified` unchanged. On
rxjs @400 the same field reads `structural` for all 9 overrides edges.

## Per-type table

Two populations, both derived by `readdirSync`, both printed with their admitted
and examined counts, because a per-type number without its population is the
defect this programme keeps finding.

**A — vuejs, 400 files admitted of 405 candidates, 400/400 parsed, 12,998
symbols, 62,284 edges** (63,046 before this pass), production path (`getParser`
-> `parse` -> `analyze`). Re-run at HEAD and identical to the first run on every
per-type count except `references`: `calls` 43,376 / `uses` 1,552 / `contains`
3,514 / `imports` 4,764 / `references` 6,908 (was 7,670) / `exports` 1,791 /
`extends` 152 / `implements` 5 / `overrides` 71 / `instantiates` 151. The whole
movement is the `references` fix of this pass; this run is saved at
`validation/m14/results/typescript-ambiguity-census-vuejs-400.json`.

**B — element-plus, 400 files admitted of 497 candidates, 400/400 parsed** — the
corpus the brief assigns, and the one `firing-check-v2` samples.

| type | verdict | A edges | A files | B edges | B files | within-both (A) | corpus-both (A) | R7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| calls | EMITTED | 43,376 | 377 | 20,770 | 335 | 5.9% | 16.7% | 0 |
| uses | EMITTED | 1,552 | 164 | 215 | 66 | 84.5% | 94.7% | 0 |
| contains | EMITTED | 3,514 | 146 | 1,306 | 127 | 100.0% | 100.0% | 0 |
| imports | EMITTED | 4,764 | 375 | 3,436 | 359 | 0.0% | 0.0% | 0 |
| references | EMITTED | 6,908 | 305 | 3,135 | 326 | 43.9% | 59.7% | 0 |
| exports | EMITTED | 1,791 | 233 | 1,135 | 305 | 23.0% | 35.7% | 0 |
| extends | EMITTED | 152 | 28 | 33 | 24 | 83.6% | 87.5% | 0 |
| implements | EMITTED | 5 | 4 | 0 | 0 | 40.0% | 60.0% | 0 |
| overrides | EMITTED | 71 | 6 | 0 | 0 | **100.0%** | **100.0%** | 0 |
| instantiates | EMITTED | 151 | 41 | 14 | 9 | 7.9% | 11.3% | 0 |

The two `references` figures in column A and column B are this pass's re-runs;
every other cell is unchanged from the first run, which is itself the check that
the fix touched one label. Column A's `references` resolution percentages FALL
with the fix (49.4% -> 43.9% within-both, 63.7% -> 59.7% corpus-both) because the
removed rows were a subpopulation that resolved by name almost by construction —
a bare member name always finds a same-named declaration in the same file. Fewer
rows, fewer of the kind that resolve, and the ambiguity rate falls with them.

**Ten of ten EMITTED. None RULED, none GAP.** The two zeros in column B are
`implements` and `overrides` on element-plus, and they are RULED **for that
corpus** with a measurement: `construct-probe.ts` counts 0 `implements_clause`
nodes and 0 `override` modifiers across element-plus's 200 admitted files, so
the arms are correct to abstain there. The same census on vuejs finds 4
`implements_clause` nodes carrying 5 targets in 4 files, and the analyzer emits
5 edges in 4 files — 5-for-5 from two instruments that share no code.

R7 over both populations: 0 endpoints equal to the literal `unknown`, 0 empty
endpoint names, 0 edges below confidence 0.7.

### The six questions, one row each, with the measurement behind it

| # | question | answer | measurement |
| --- | --- | --- | --- |
| 1 | Exists | yes, all ten | `ASTEngine.RelationshipType.*` constructed in `real-typescript-analyzer.ts`; grammar audit `typescript PASS refs=103 unknown=0 unknownFields=0` |
| 2 | Fires | yes, all ten, on two corpora | the counts and file counts above, plus `firing-check-v2` **10/10 at NFILES 120 and 200** on rxjs (element-plus's 8/10 is superseded: a component library with 9 `extends` edges in 200 files starves the two heritage types) |
| 3 | Correct | all ten audited by the differential (2026-10-09); the oracle behind them is independent of the analyzer by construction | audited set now `[calls contains exports extends implements imports instantiates overrides references uses]`; `exports` 65/65 and `imports` 106/106 covered 0 unexplained, before that 357/357 and 1125/1125 on element-plus @200 |
| 4 | Labelled | 0 pairs at the same `(source, target, line)`; 1 pair whose two labels are two sites | `ts-type-mention-label-probe.ts` (LINE-AWARE since this pass), element-plus 200 files, 999 `uses`+`references` edges (1,014 before the fix). The earlier 5-pair / 0.49% count is RETRACTED above — it counted names, not reads |
| 5 | Confident | yes, and the one mislabelled class is fixed | 0 edges below 0.7 over vuejs 63,046 edges; 0 sub-1.0 edges without a reason code; `overrides` now reports `structural` (71/71 on vuejs, 9/9 on rxjs, measured) |
| 6 | R7 / endpoints | 0 `unknown`, 0 empty — and 321 source endpoints no identifier can carry | `ts-r7-endpoint-probe.ts` element-plus @400: 400 NOT-AN-IDENTIFIER endpoints, 321 of them sources, every one containing a `-` |

Question 3's limit, stated rather than glossed: the oracle is a second walker
over the SAME tree-sitter-typescript 0.23.2 grammar, so a grammar bug shared by
both paths is invisible to it — and that limit FIRED in this pass rather than
staying theoretical: the `references` oracle and the analyzer both missed the
same grammar fact (a one-parameter arrow binds under the singular `parameter`
field), so for a while both sides agreed on a wrong answer. It was found by
probing the grammar directly, not by the disagreement. Question 5's `instantiates` row shows the shape of
a real limit on the audited set too — 12 truth edges against 6 analyzer edges on
element-plus @200, 0 unexplained, so the analyzer is a strict subset there and
the oracle finds sites the analyzer does not emit.

### Are these edges OUTGOING only?

**Yes, and that is a property of the architecture rather than a caveat added to
soften a number.** An analyzer emits edges FROM the file being analyzed;
resolving who points AT a symbol is the reverse-direction subsystem, and it is
not built. Every resolution percentage above therefore means "does this endpoint
bind to a symbol this run published", never "does something outside this file
point here".

It is also why `calls` resolves at 16.7% corpus-both and 5.9% within-file on
vuejs: a callee is reduced to a leaf name, so its target lives in another file
almost always, and an outgoing analyzer cannot see it. `overrides` at 100.0% is
the contrast that proves the measurement discriminates rather than merely
reporting low numbers — both of its endpoints are in-file by construction,
because the arm abstains unless the base declaration resolves in-file.

### `implements` — the arm is NOT dead

`implements_clause` = 4 clauses carrying **5 targets** across 4 files on vuejs.
The analyzer emitted **5 edges across 4 files**. Exact count match, from two
instruments that share no code: one counts `node.type` occurrences in the tree,
the other counts `UniversalRelationship` objects out of `analyze()`. A branch
that never matches cannot produce a 5-for-5 match.

This refutes the reading that `implements` is silent for want of a construct. It
is 5 edges — a small number, because the corpus has 4 `implements_clause` sites
in 3.7 MB of source — and small counts deserve the sample-size caveat the same
way a verdict at one `NFILES` does. Adjudicated at vuejs `NFILES` 400 *and*
element-plus `NFILES` 200, where the construct itself is 0 and the honest
statement is that the corpus cannot exercise the arm.

### `overrides` — 71 edges, 71/71 RESOLVED (a retracted 0.0%)

**The 0.0% row above is retracted. It was an instrument bug, not an analyzer
bug, and the retraction existed only in a commit message until this commit put
it in the doc where a reader of the table would see it.**

Two distinct defects produced the false finding:

1. **Wrong key.** The census read `symbol.qualifiedName` off `analyze()` output.
   No analyzer in the fleet sets that field — `RealTypeScriptAnalyzer` sets
   `scope`, and PRODUCTION derives the qualified name from it at
   `pool-worker.ts:930`:
   `qualifiedName: s.qualifiedName || s.metadata?.fqn || (s.scope ? \`${s.scope}.${s.name}\` : s.name)`.
   A census reading `qualifiedName` measures "does the analyzer set a field it
   does not set", and reports 0% for every dotted endpoint in the language.
2. **Triple-counted tally.** One declaration answers to up to three keys — bare
   `name`, `scope`-derived qualified name, and dotted `ownerName.name` — and the
   qualified and dotted forms are frequently the SAME string. The corpus map
   incremented all three, so one declaration counted as three and every target
   looked ambiguous. Now a `Set` of distinct keys per symbol.

Effect of fix #2 on the multi-target column, vuejs NFILES=400:

| type | before | after |
| --- | --- | --- |
| overrides | 100.0% | **0.0%** — was entirely artefact |
| instantiates | 62.9% | 62.3% |
| references | 10.3% | 9.8% |
| uses | 40.3% | 40.1% |
| calls | 26.4% | 26.3% |
| contains | 51.1% | 51.1% (unchanged) |

An ambiguity count that FALLS when key derivation gets more accurate was
measuring the tally.

Adjudicated directly by `overrides-endpoint-shape.ts` (a lane fixture) over the
6 vuejs files that emit `overrides`, 71 edges — the measurement that separates
"wrong name shape" from "missing declaration", which a percentage cannot:

| probe | count |
| --- | --- |
| source found by BARE name | 71 |
| source found by `qualifiedName` (production leaves it empty here) | 0 |
| source found by dotted `Owner.member` | 71 |
| target found by BARE name | 71 |
| target found by `qualifiedName` | 0 |
| target found by dotted `Owner.member` | 71 |
| **BOTH endpoints found** | **71** |
| neither endpoint found anywhere | 0 |

Every one of the 71 edges names two REAL declarations. `overrides` is the only
type at 100% within-file resolution, and that is what the arm is FOR: it
resolves the base class in-file and abstains otherwise
(`if (!baseDecl) continue` at real-typescript-analyzer.ts:5346 and :5458), so an
in-file-resolved edge is the arm working as designed.

The lesson carried forward rather than only in prose: the prior doc's headline
was a wrong number about a real type, produced by an instrument that agreed
with itself. Rule 3 — nothing ships unverified — extends to the measuring
instrument, not only to the analyzer under it.

## JOB 2 — the gaps, and the one that was closed

All ten types are EMITTED, so JOB 2 has no missing TYPE to add. What it can have
is a construct the language uses to express a dependency that nothing carries.
`declared-construct-probe.ts` measures four candidates on the tree, and it exists
because its FIRST VERSION REPORTED 0 FOR ALL SEVEN ROWS and was wrong on three
of the four constructs — each by looking for a node type this grammar does not
use:

| looked for | the grammar actually produces |
| --- | --- |
| `import_alias` | `import_require_clause`, a CHILD of `import_statement` |
| `internal_module` with a string name | `ambient_declaration` -> `module` whose name is a `string` child; `internal_module` is the INTERNAL form, a namespace |
| the `type` modifier among NAMED children | an ANONYMOUS `type` child of the statement or specifier ITSELF |

A probe that looks for a node type the grammar never emits reports 0 forever,
and 0 is indistinguishable from a RULED verdict unless the probe is tested
against a construct known to be present. `element-plus` contains
`import type { InjectionKey, VNode } from 'vue'` at
`packages/components/cascader-panel/src/types.ts:1`; the first version reported 0
`import type` over 400 files of that same repository. The probe now runs a
SELF-TEST on a synthetic snippet before every corpus measurement and exits
non-zero if it fails. The self-test then caught the opposite error too — it
expected 3 import and 2 export statements and the probe's 2/3 was right,
because `export const q` inside the ambient module body counts.

Construct census, element-plus 400 admitted / 400 parsed, at HEAD:

| construct | sites | files | verdict |
| --- | --- | --- | --- |
| `import type` statement | 655 | 279 | read — see below |
| `export type` statement | 18 | 14 | read |
| ambient `declare module "x"` | 2 | 2 | 2 sites, both `'vue'` augmentation |
| import-equals `import a = require(...)` | 0 | 0 | not exercised by this corpus |
| triple-slash `<reference path/types/lib>` | 0 | 0 | not exercised by this corpus |

The two zeros are NOT rulings. `declared-construct-probe` says so in its own
output: "sites = 0 cannot be ruled from this corpus alone — widen the corpus, do
not conclude." element-plus does carry triple-slash directives, in
`play/env.d.ts` and `docs/.vitepress/env.d.ts`, and neither file is admitted by
the code-bearing signal filter — they are ambient `.d.ts` bundles. Widening the
corpus is the next step, not a conclusion.

### The gap that WAS closed: a type-only import edge could not say so

`import type { T } from "m"` is erased at compile time, so it is a type
dependency and not a runtime one. 655 sites across 279 files; 982 type-only
specifiers against 2,058 value specifiers — 32% of the import surface on this
corpus.

`type-only-import-coverage.ts` then measured the emission side, and the answer
split in two:

| | count |
| --- | --- |
| files with at least one type-only import | 271 |
| ... an `imports` RELATIONSHIP edge for it | 271 |
| ... NEITHER channel | 0 |
| ... an edge carrying any type-only marker | **0** |

So not a missing edge — an edge that could not say what it was. The graph
asserted a runtime dependency the compiler denies, and a consumer had no way to
tell the two apart without re-reading the source.

Fixed in `real-typescript-analyzer.ts` as metadata only: `isTypeOnlyImport` reads
the anonymous `type` child of the statement, `isTypeOnlySpecifier` the anonymous
`type` child of an `import_specifier` (TypeScript 4.5+'s INLINE
`import { type A, B }`). Statement-level wins when both apply. Adds no edge,
removes none, changes no endpoint.

| | before | after |
| --- | --- | --- |
| files publishing a type-only marker | 0 | 272 of 272 |
| edges | 11,690 | 11,690 |
| differential hash, element-plus @60 files, rotation 3 | `30555483d544ff75` | `30555483d544ff75` |
| fixture lane, typescript | 92 pass / 7 false FAIL | 92 pass / 0 fail |

The 272nd file is the INLINE form, which the statement-level construct probe
does not count — the change covers a construct the probe does not even measure.

### Instrument bugs found in this lane's own instruments, all by running them

Recorded because the first version of an instrument is the one most likely to
lie, and every one of these reported a confident number:

1. `construct-probe.ts` set a `wentPast` flag once and never cleared it,
   abandoning the tree early: 1,710 nodes over 645,513 bytes.
2. That bound was first per-file and threw on a DENSE file
   (`lib.es2025.promise.d.ts`, 76 nodes / 1,619 bytes). A per-file density bound
   measures style, not correctness. Moved to the aggregate.
3. The ambiguity census read `symbol.qualifiedName`, which no analyzer in the
   fleet sets, and triple-counted one declaration under three keys. Together
   these produced a false `overrides` 0.0% headline — retracted above.
4. `declared-construct-probe.ts`: three wrong node types, all silent zeros
   (above), plus a self-test reset that restored `sites` and faked `files` to the
   right SIZE but left `spellings` populated, so a 0-site row printed
   `distinct 1` — a correct-looking number about the self-test's population.
5. `type-only-import-coverage.ts` matched edges as `"<module>|<name>"` and
   reported 0 edges for 271 of 271 files — including files whose VALUE imports
   demonstrably produce edges. The emitted shape is `<module>:<name>`.
6. `regex-free-check.ts` classified instruments with `namedChild(0)` on an
   `import_statement`, which returns `import_clause`, so every instrument was
   filed as an input and it printed `PASS — 0 regex literals across 0 of 0
   instrument files`. It now reads the `source` FIELD and refuses to print PASS
   on an empty population. The guard fired for real during the directory move.

## Gates re-run at HEAD, with their actual results

| gate | command | result |
| --- | --- | --- |
| firing-check-v2 | `NFILES=200 bun script/m14/firing-check-v2.mjs TYPESCRIPT` | **8/10**, 200/200 parsed, silent `implements` `overrides` — **superseded 2026-10-09: 10/10** on the rxjs corpus, see the resolution section |
| firing-check-v2, sample sensitivity | `NFILES=25` / `NFILES=400` | 7/10 / 8/10 — superseded: **10/10 at NFILES 120 and 200** on rxjs |
| ontology coverage (DERIVATION) | `bun script/m60/rel-type-coverage-gate.ts --langs=typescript` | 2 un-audited: `exports`, `imports` — **repaid 2026-10-09**: CHECK 1 clean, `5 recorded, 0 NEW, 5 repaid` |
| grammar audit | `bun script/m14/audit-analyzer-grammar.ts typescript` | `typescript PASS refs=104 unknown=0 unknownFields=0` — 103 at HEAD, and the +1 is prose: the audit reads SOURCE TOKENS, so the bare word `override` in this pass's new comment registers as a type name. Harmless (`unknown=0`, no unknown-ref regression), and recorded rather than reworded away |
| differential, lane | `bun script/m14/differential.ts --lang typescript --repo element-plus` | files=60 tree-truth=992 covered=838 (84.5%) MISSING=154, analyzer-edges=755 unexplained=31 (4.1%) — superseded 2026-10-09: tree-truth=1803 covered=1614 (89.5%) MISSING=189, **analyzer-edges=1345** unexplained=17 (1.3%), rot 1 hash `1e1e558b09de5f10` |
| differential, before/after the DERIVATION change | same, cold-pool state pinned to rotation 3 | identical hash `30555483d544ff75` both ways |
| differential, after this pass | same command, rot 3 hash `30555483d544ff75` | tree-truth=1,555 covered=1,396 (89.8%) MISSING=159, analyzer-edges=1,312, unexplained=28 (2.1%), `references=19, uses=9` — spans both passes, so it corroborates rather than isolates |
| `references` audit, typescript @12 files | `bun script/m14/ts-deriv-oracle-audit.ts` | cov% 91.9 -> **92.8**, MISSING 66 -> 56, analyzer 300 -> 279, unexplained 22 -> **10** (7.3% -> **3.6%**) |
| `references` audit, vuejs @400 files | `bun script/m14/ts-deriv-oracle-audit.ts --repo vuejs --files 400` | analyzer 4,158 -> 3,503, unexplained 760 -> **186** (18.3% -> **5.3%**), MISSING 898 -> 941 (the oracle-side remainder, reported not smoothed) |
| row-level diff, pre-fix vs post-fix | all relationship rows, clean HEAD worktree vs this tree | element-plus 15/83/194 rows removed at 200/400/1,205 files; typescript corpus 46 at 12 files; **0 rows added anywhere**, and every removal is a `references` row |
| census re-runs | `ambiguity-census.ts 400` on element-plus, rxjs, vuejs | element-plus 30,135 -> 30,044 edges, `references` 3,227 -> 3,135, within-file ambiguous 47 -> 18; rxjs 44,307 -> 44,084, `references` 3,274 -> 3,051, 30 -> 11; vuejs 63,046 -> 62,284, `references` 7,670 -> 6,908 |
| overrides `evidenceClass`, vuejs @400 | same census, `evidenceClass per type` | `usage_contextual=71` -> **`structural=71`** |
| no-regex, lane instruments | `bun script/m14/ts-no-regex-count.ts` | 0 (exit 0), unchanged by this pass |
| script surface | `bun script/m60/verify-script-surface.ts` | PASS, 0 errors, canary visible |
| typecheck, scripts | `bun run typecheck:scripts` | 0 |
| fixture lane | `bun script/m14/run-fixtures.ts --lang typescript` | 92 pass / 0 fail, baseline gate no regressions — superseded 2026-10-09: **96 pass / 6 fail**, the six being the baseline's recorded count for this lane (gate: no regressions), none attributable to this pass |
| mutation | `BB_MUTANT_ONLY="typescript/" bun script/m14/mutate-analyzer.ts` | **all 70 mutants caught**, 0 survivors |
| payload / latency A-B | `bun validation/m14/instruments/typescript/ab-payload-latency.ts <before> 200 5` | edges +0.00%, symbols +0.00%, payloadBytes **+1.20%**, min-of-5 latency identical |
| no-regex, lane instruments | `bun validation/m14/instruments/typescript/regex-free-check.ts` | 0 regex nodes across 7 of 7 instrument files, 96,730 bytes |
| no-regex, analyzers | `bash script/m14/no-regex-gate.sh src/ast` | 4 regexes, all in `real-svelte-analyzer.ts`; 0 in any file this lane owns |
| analyzer complexity | `bun script/m60/analyzer-complexity-gate.ts --lang typescript` | `unscorable` (no loadRule/corpusManifest); self-tests 36/36 |
| honesty | `bun script/m14/verify-honesty.ts` | 21 failures, **none naming a file this lane owns** — see below |

The payload A/B deserves its own note. `edges` and `symbols` moved 0.00%, which
is the number `bb_graph`'s un-narrowed `relationshipTypes` default actually
scales with (2.5-4.8x a kind-filtered answer). `payloadBytes` moved +1.20%
(2,283,615 -> 2,311,067 over 11,690 edges, 195.3 -> 197.7 bytes per edge): that
is the weight of one added metadata key, not graph size. It is reported rather
than described as neutral. ### The instrument controls itself, and the latency columns show why

**Null control.** The same A/B run with the SAME code in both slots — the
`before` module taken from the docs commit, which already carried the marker —
reports `edges +0.00%`, `symbols +0.00%`, `payloadBytes +0.00%`, 197.7 bytes per
edge on both sides. So the +1.20% above is the code, not the instrument reading
its own change.

**The latency columns are unusable, and three runs show it.** `best round` is
0.3 ms in every run of both versions. Everything above it is load:

| column | run 1 | run 2 (null control) | run 3 |
| --- | --- | --- | --- |
| best round | -2.90% | -9.79% | -3.00% |
| worst round | -60.55% | +22.39% | +241.28% |
| all rounds | -5.39% | -5.71% | +21.73% |

A latency figure from a shared box is a statement about load — the F# lane
withdrew a +16% claim for exactly this reason. The instrument exists partly so
that this lane does not have to make one: it loads both versions in ONE process
and interleaves them over one parse, and the only column that survives is the
minimum. **No latency claim is made for this change.**The honesty gate at the end of this pass reads **10 failures, and the list is
byte-identical in a clean HEAD worktree** (`diff` on the two `HONESTY-GATE FAIL`
lists: no output), so this pass adds none:
evidence freshness on F1-F9 (1 declared input changed on F1/F3/F4/F6-F9, 84 on
F5), **F8 has 16 non-passing checks** (`corpus-census-*` for 16 languages,
`corpus-census-typescript` among them) and **F9 has 2**
(`F9-PROBE-M3710-PHP`, `F9-PROBE-CLEAN-HEAD-PATTERN`). The earlier 21-failure
reading this paragraph used to carry came from a different commit; the count is
reported per pass and this pass's number is the pair above. Regenerating F1-F9
and fixing other lanes' corpora is master-owned. Not one of the 10 names a file
under `src/ast/real-typescript-analyzer.ts`,
`docs/analyzers/typescript-ambiguity-sweep.md`,
`script/m14/oracles/typescript-references.ts`,
`script/m14/oracles/typescript-uses.ts`,
`validation/m14/fixtures/typescript/` or
`validation/m14/instruments/typescript/` — checked by grep, not by eye.

## Instrument notes

Two defects in these instruments were found and fixed while writing them, both
in the direction that manufactures a false RULED verdict:

1. `construct-probe.ts` first cursor loop set a `wentPast` flag once and never
   cleared it, abandoning the tree early: **1,710 nodes over 645,513 bytes**. The
   probe now throws when aggregate nodes < bytes/12.
2. That bound was first per-file, and threw on
   `lib.es2025.promise.d.ts` (76 nodes / 1,619 bytes) — which is a *dense* file,
   not a broken traversal. A per-file density bound measures style, not
   correctness. Moved to the aggregate.

`imports` is tallied on `res.imports` (`ImportInfo[]`, `src/ast/types.ts:206-216`),
a channel separate from `res.relationships`. `RelationshipType.Imports` in
`types.ts` reads `"brain_import"`, which names the `brain_import` **table** that
`parallel-indexer.ts:2169` writes to, not a relationship row type. A type absent
from the relationship tally while `imports[]` is non-zero is not a defect.

## Declared-external call targets — the incoming side's first honest column (2026-10-09)

The incoming question this lane could not answer before is not "how many edges
resolve" but "how many edges CANNOT resolve here, and does the analyzer say so".
The fleet owns the rule (`script/m14/incoming-gate.ts:38`: *an edge a lane cannot
bind must be MARKED, and the marking is what the gate counts*) and the vocabulary
(`EXTERNAL_KEYS`, `incoming-gate.ts:105`). TypeScript had neither, so every
`calls` edge into a dependency's member read as a broken binding to the reverse
walk `bb_impact` performs.

**What was measured first.** On the census's own 400-file rxjs sample
(`/tmp/ts-calls-external-probe.ts`), every `calls` edge whose target the sample
does not publish was classified by its receiver (shares over the 29,180
unresolved `calls` edges; the 37 unresolved `uses` edges are all unknown-base):

| class | edges | share | provable? |
|---|---|---|---|
| external-import-base (receiver bound by a bare import/require) | 10,261 | 35.2% | yes |
| runtime-global-base (`console`, `JSON`, `Math`, …) | 573 | 2.0% | yes |
| local-base (receiver IS a file declaration — a member NAME, not a binding) | 2,587 | 8.9% | no |
| unknown-base (no receiver, or a local variable / test global like `it`) | 15,759 | 54.0% | no |

Only the first two are markable: 10,834 of 29,180 unresolved `calls` edges,
**37.1%**. The
54.0% unknown-base column is dominated by rxjs's own test globals (`it`,
`describe`, `hot`, `rxTest`, `expectObservable`) and by member calls on local
variables — a WINDOW artifact, not a vocabulary gap, and the honest repair for it
is a repo-wide run, not a marker.

**The marker, and what it refuses to claim.** `real-typescript-analyzer.ts`
`markExternalTargets` stamps `metadata.isExternalTarget` (a key the gate
already reads) with `externalReason` in exactly four cases, and it covers value
positions (`calls`, `uses`) and type positions (`references`, `extends`,
`implements`) — see the subsection after the repo-wide table for the type side:

- `dependency-package` — the receiver is bound by an import/require of a bare
  specifier that (a) is declared in the nearest manifest's four dependency maps
  and (b) is **not** a package this workspace publishes;
- `builtin-module` — the specifier is a Node builtin (`isBuiltinModule`, the
  pinned table at `:599`);
- `runtime-global` — the receiver is a runtime global this file neither declares
  nor imports (fixed table, `RUNTIME_GLOBAL_RECEIVERS`);
- `builtin-lib-type` — TYPE positions only: the name is one of the TypeScript
  lib, DOM or Node type names in the pinned table `TS_LIB_TYPE_NAMES`.

It refuses, deliberately: a target the file declares (in-file truth wins); a
receiver bound to a RELATIVE import; and a bare specifier that is a **workspace
package** — in rxjs's pnpm monorepo `'rxjs'` is the workspace's own source, so
"bare specifier ⇒ external" would have been a false claim about project code.
Workspace names come from `pnpm-workspace.yaml` (or `workspaces`) globs, one
level deep; a deeper glob is documented as unexpanded rather than guessed.

**Measured effect, same 400-file sample, same instrument.**

| reading | before | after |
|---|---|---|
| `calls`: ambiguous | 3,459 | 3,417 |
| `calls`: bind-to-one | 4,301 | 4,070 |
| `calls`: declared external | 0 | **11,514** |
| `calls`: unresolved, marker HONORED | 28,320 | 17,079 |
| `calls`: unresolved, marker IGNORED (raw) | 28,320 | 28,320 |
| all types: bind-to-one **or** declared external | 16.8% | **42.4%** |

Two honest consequences sit in that table. First, `bind-to-one` itself FALLS
(7,383 → 7,152 across all types, calls 4,301 → 4,070), because 273 calls edges
that were previously counted as bound or ambiguous — 231 and 42 respectively —
now carry the marker instead: their targets ARE published in the sample, but the
*receiver* is external, and a same-named declaration elsewhere is a coincidence,
not a binding. The 16.8% → 42.4% move is therefore a reclassification, not new
binding power, and the raw column is the one that stays comparable to the old
table. Second, `incoming-check.ts` now prints `external` and `unres(raw)` as
separate columns and the JSON carries both fields, so the exemption can never
hide its own size.

**Negative controls, because a marker that fires on project code is worse than
none.** `/tmp/ts-ext-marker-verify.ts`, live output:

- snippets: vitest matcher `→ toBe` marked `dependency-package`/`vitest`;
  `node:fs` call marked `builtin-module`; `Math.max` marked `runtime-global`;
  relative import and `'rxjs'` self-import **unmarked**;
- 20 real files importing `'rxjs'`: 1,432 `calls` edges, 85 marked, **0** with a
  workspace or relative specifier;
- 20 real files importing `'vitest'`: 1,813 calls edges, **1,212 marked**
  (989 `vitest`, 165 Node builtins, 43 globals).

Edge counts through the production path are unchanged by this pass (calls
36,080 / uses 444 / contains 789 / references 3,051 on the sample, identical to
the stored census), so the outgoing table in this document stands as measured.

**Cost, and one void measurement.** A method-level A/B (patch
`markExternalTargets` to a no-op, analyze the same files both ways) was run
first and is **void**: it patched the OUTER `RealTypeScriptAnalyzer`, while the
pass lives in the inner `TypeScriptAnalysisRunner` the outer class delegates to,
so both arms ran the pass (identical marks, 168/168, gave it away). What is
reported instead is an UPPER BOUND on the pass's share, by timing its dominant
step — the `require`-binding tree walk — against full `analyze()` on the 12
largest sample files (493 KB, 74,665 nodes): walk 170.0 ms, analyze 4,677.3 ms,
**3.63%**. The pass's other two steps (a top-level scan and one linear pass over
the relationship array) are strictly cheaper than that walk, so the true share is
below this figure.

**Not done at that point, and stated as such:** the marker covered `calls` and
`uses` only — `references` (1,595 unresolved), `instantiates` (5), `extends` (11)
and `implements` (1) were untouched; `imports` 2,382/2,382 remains unresolved BY
DESIGN (a module URI is not a symbol); and the 54% unknown-base column needs the
repo-wide binding pass, which this lane still does not have. The type positions
were closed in the next subsection.

### Repo-wide pool: the WINDOW was the largest single blocker (2026-10-09)

Every incoming number above came from a 400-file slice, and that slice is a
**strict subset** of the corpus: 400 of 771 `.ts` files — 348 of 534
`packages/rxjs` files and **none** of the 167 `apps/rxjs.dev` files. The 186
excluded library files are exactly where a large share of the targets live, so
the slice's `unresolved` column was measuring the window as much as the analyzer.
Re-run on the whole pool (771 files, 33,906 symbols, **0 degraded, 0 parse
failures**), same instrument:

| reading | n=400 (slice) | n=771 (full pool) |
|---|---|---|
| `calls` edges | 36,080 | 69,589 |
| `calls` resolved | 4,070 | **36,891** |
| `calls` ambiguous | 3,417 | 10,162 |
| `calls` unresolved (marker honored) | 17,079 | **6,276** |
| `calls` declared external | 11,514 | 16,260 |
| all types: bind-to-one **or** declared external | 42.4% | **69.0%** |

So the question "what stops 100%" has four separate answers at full scope, and
only one of them is a resolution problem:

1. `imports` 4,626 / 4,626 — a module URI is not a symbol. **By design, at 0%,
   and not fixable by any resolver.**
2. `references` 1,976 unresolved + 786 ambiguous — type names, and the biggest
   repairable block, because the declared-external marker covers `calls`/`uses`
   only: a reference to a dependency's or a builtin's TYPE (`Promise`,
   `Observable`, `NodeJS.Timeout`) is still unmarked. Extending the same three
   proofs to `references` is the next lever.
3. `calls` 10,162 ambiguous + `instantiates` **921 of 1,129 (81.6%)** — member
   and constructor names that bind to MORE than one declaration once the whole
   library is in scope. `instantiates` is the worst type in the corpus at scale
   and was 33% at the slice: ambiguity grows with the universe. This needs a
   qualified spelling or a declared rule, not more marking.
4. `calls` 6,276 unresolved even with the marker — receivers that are neither
   in-file declarations, nor external imports, nor globals: test globals (`it`,
   `describe`) and calls on local variables. Not provable from the file, and a
   marker here would be a guess.

### Type positions, closed: `references` 1,976 → 981 unresolved (2026-10-09)

The repo-wide table above named `references` as the biggest repairable block, on
the grounds that the marker covered `calls`/`uses` only. It now covers the three
type-position kinds, with the same proofs applied to the target NAME (there is no
receiver to consult) and the same exclusions checked FIRST — a file declaration, a
relative import, and a workspace package all still win:

- the name is bound by an import/require of a bare dependency or a Node builtin
  (`import type { Foo } from "vitest"` → `Foo` is external);
- the name is rooted at a global type namespace and the head is not a file
  declaration (`NodeJS.Timeout`, `Intl.NumberFormat`);
- the name is a TypeScript-lib/DOM/Node type (`Promise`, `Partial`, `Record`,
  `HTMLElement`) — a pinned table, `TS_LIB_TYPE_NAMES`;
- a QUALIFIED name whose HEAD is an external binding inherits it: `fs.Stats` under
  `import * as fs from "node:fs"`. This last rule was worth **+124** `references`
  marks on its own, found by inspection after the first extension landed.

| reading (n=771 full pool) | before | after |
|---|---|---|
| `references` declared external | 0 | **996** |
| `references` unresolved | 1,976 | **981** |
| `extends` unresolved | 17 | **1** |
| `implements` unresolved | 27 | **0** |
| all types: bind-to-one **or** declared external | 69.0% | **70.2%** |

Negative controls re-run through the production analyzer after the extension
(`/tmp/ts-ext-marker-verify.ts`, VERDICT PASS): a relative type import is
unmarked; a file-declared `interface Record` is **not** marked despite colliding
with a lib type name; a file-declared superclass is unmarked; and the positives
carry exactly the expected reasons (`dependency-package` for the vitest type,
`builtin-lib-type` for `Promise`/`Partial`, `runtime-global` for `NodeJS.Timeout`,
`builtin-module` for an `EventEmitter` superclass).

What remains on this type after the extension is 981 unresolved + 786 ambiguous:
qualified names rooted at something the file does not import, and member/interface
names that more than one declaration publishes.

### Ambiguity, diagnosed: declaration merging and re-export barrels, not name collisions (2026-10-09)

Ambiguity is now the largest remaining class, so it was diagnosed before anything
was changed. Two hypotheses were tested on the full pool (`/tmp/ts-ambiguity-diagnosis.ts`,
`/tmp/ts-ambiguity-kinds.ts`):

**The fixture hypothesis is FALSE.** The pool does contain dozens of independent
fixture projects, so the guess was that identical class names across projects were
inflating the number. They are not: names declared only inside fixtures = **0** for
`instantiates`, and any-fixture involvement is 3.4% for `calls`.

**The instrument's rule is KIND-based, and that is what is firing.** A target is
ambiguous when `published.get(name)` holds more than one KIND — not when more than
one file declares it. Split by kind-set, on the full pool:

| type | ambiguous names | edges | dominant kind-sets |
|---|---|---|---|
| `instantiates` | 10 | 921 | `interface+variable` 510, `class+variable` 406 |
| `calls` | 110 | 10,372 | `constant+method+property` 3,404, `method+property` 1,314 |
| `references` | 37 | 786 | `interface+variable` 458, `class+interface+variable` 199 |
| `contains` | 227 | 631 | `constant+property` 190, `property+variable` 69 |
| `uses` | 129 | 421 | `constant+property` 176, `property+variable` 69 |

The single biggest name is `Observable`, at **510 `instantiates` + 458 `references`
edges across 95 declaration sites** — and the sites are 98 files carrying
`declare global { interface Observable<T> { … } }` module AUGMENTATIONS plus the
one real declaration. `Subject` (156 edges, kinds `class+variable`) comes from
`packages/rxjs/src/subject.ts` declaring the class and `packages/rxjs/src/index.ts:26`
re-exporting it. So the top of this table is **one logical symbol published under
several kinds**, which is declaration merging and barrel re-export, not two things
a reverse walk could confuse.

The rest of the `calls` table is NOT that: `cold` 1,974, `observable` 1,942,
`subscribe` 1,454 (51 sites), `next` 1,263, `error` 374 (66 sites) are member NAMES
declared on many different types — genuine ambiguity that no merge rule touches and
that only a qualified spelling (`Owner.member`) can resolve.

Two fixes are therefore on the table, with different sizes and different risk:

1. **Publication**: stop publishing a declaration for a `declare global`/`declare
   module` AUGMENTATION and for a barrel RE-EXPORT (`export { X } from "./y"`) —
   neither declares the symbol, both forward or extend one that exists elsewhere.
   Would address the TYPE+VALUE pairs — **917 of the 921** ambiguous `instantiates`
   edges and **695 of the 786** `references` ones (1,612 of 1,707) — and deliberately
   NOT `class+interface` (8 edges across the two types) or `interface+type` (44):
   those are separate symbols in separate modules, not one symbol with a value
   binding, so collapsing them would hide real ambiguity. It is NOT a bug fix:
   `ambient-global.ts` and
   `re-export-module-dependency.ts` are committed fixtures with expectations, so
   the current behavior is deliberate and changing it is a design decision about
   what an augmentation declares.
2. **Qualified spellings** for member calls, which is the only lever for the
   ~10,372 `calls` edges and the ~1,052 `contains`+`uses` member names.

Until one is chosen, this document reports BOTH readings: the kind-based ambiguity
that the instrument counts today, and the fact that part of it is one symbol seen
twice.

### The ambiguity rule was too lenient: 70.2% → 48.2% under per-declaration candidates (2026-10-09)

Three changes landed together, and the third one **supersedes every percentage in
this document**:

1. **Augmentations are labelled, not dropped.** `real-typescript-analyzer.ts` sets
   `metadata.isAugmentation` on interface and type-alias declarations inside a
   `declare global { ... }` block (`isInsideDeclareGlobal`, grammar verified by
   dump: `ambient_declaration > statement_block`). They are still PUBLISHED —
   `ambient-global.ts` expects `Window` and `jsx.d.ts` declares 0 symbols without
   them — so the flag exists for resolution, not for deletion.
2. **The flag crosses the worker seam.** It did not: the direct analyzer reported
   `Window isAug=true` while `parseFile()` reported `false`, because
   `pool-worker.ts` projects symbol metadata through an explicit allow-list (the
   same seam the bash lane documented: 13 keys, 0% survival). `isAugmentation` is
   now carried there.
3. **Candidate declarations are FILES, not kinds.** A target resolves when ONE
   declaring file publishes it; a type plus its runtime binding in one file is one
   declaration (TypeScript declaration merging); augmentations are consulted only
   when the corpus has no non-augmentation declaration of that name. The old rule
   counted distinct KINDS, which called `Observable` ambiguous against its own 94
   augmentations and, worse, called a name "resolved" whenever all 294 of its
   declarations happened to share a kind.

| reading (n=771 full pool) | kind rule | file rule |
|---|---|---|
| `instantiates` ambiguous | 921 | **437** |
| `references` ambiguous | 786 | **346** |
| `calls` ambiguous | 10,162 | **28,766** |
| `uses` ambiguous | 421 | **677** |
| `contains` ambiguous | 631 | **1,230** |
| all types: bind-to-one **or** declared external | 70.2% | **48.2%** |

Both directions are real and they mean different things. The merging fix worked:
`instantiates` drops 921 → 437 and `references` 786 → 346, and `Observable`'s 95
declaration sites now collapse to at most 15 candidates for the whole type. But
`calls` RISES 10,162 → 28,766 because the old rule was measuring the wrong thing —
`subscribe` is a `method` in all 51 of its declaring files, `map`/`next`/`error`
likewise, and kind-uniformity was scoring them as resolved when the reverse walk
has 294 places to land. `maxDeclaringFiles` is now a reported column (294 for
`calls`, 15 for `instantiates`).

**So the honest headline is 48.2%, not 70.2%**, and the blocker is member-name
ambiguity: a qualified spelling is the only thing that can bind `subscribe` to one
declaration, because no amount of external marking or augmentation merging touches
a name that 294 files legitimately declare.

**Verification for this round (2026-10-09).** `npx tsc --noEmit --incremental false`
→ **0 errors**, which is the check that matters here: plain `npm run typecheck`
currently exits 2 with a single `TS6053 File 'src/ast/tmp-base-cpp-analyzer.ts' not
found` — a STALE INCREMENTAL input reference to another lane's deleted temporary
file, present in no checked-in tsconfig. The clean invocation is green; the default
one needs the cache cleared, not a code change. The TypeScript fixture lane runs
**96 pass / 6 fail with the fixture baseline gate reporting "no regressions"**, all
six pre-existing (including both `re-export-*` fixtures, which were already failing
before this work), and **`typescript/ambient-global` PASSES** — the fixture whose
rationale is that global-augmentation contents must be extracted, i.e. the one this
change could have broken. The flag's survival was verified on both paths
(`analyze()` and `parseFile()`).

### Closure: the bar is a command, and the lane meets it (2026-10-09)

Everything above is measurement. This section is the DECLARATION, and it exists
because a metric with no arbiter is a log line: the 48.2% number was correct and
nothing read it.

`script/m14/ts-incoming-gate.ts` is the arbiter, and it changes the
question from *"is every edge resolved"* to **"is every emitted edge in a DECLARED
class, and is every declared class inside its recorded ceiling"**. One command on
the discovered pool:

```
npx tsx script/m14/ts-incoming-gate.ts        # full pool, exit 0 = PASS
```

The declaration itself is
`validation/m14/instruments/typescript/incoming-baseline.json`: **37 classes, each
with a kind, a sentence and a ceiling** (20 nonzero + 17 zero-locks after the scope
rules moved `implements:ambiguous` to zero). A nonzero class
with no entry fails as `UNDECLARED CLASS`; a class above its ceiling fails as `OVER
CEILING`. `BB_TS_BASELINE=<copy>` re-runs against a proposed ceiling without editing
the recorded one.

**The verdict on this pool, 771 files, 33,906 symbols, 0 degraded, 0 parse
failures** — after the scope rules of 2026-10-09 (next section):

| type | edges | resolved | external | ambiguous | unresolved | sameLeaf | bind% | bind+ext% |
|---|---|---|---|---|---|---|---|---|
| calls | 69,589 | 19,667 | 16,260 | 27,386 | 6,276 | 143 | 28.3 | 51.6 |
| uses | 1,170 | 546 | 0 | 588 | 36 | 0 | 46.7 | 46.7 |
| contains | 2,037 | 1,945 | 0 | 86 | 6 | 0 | 95.5 | 95.5 |
| imports | 4,626 | 0 | 0 | 0 | 4,626 | 0 | 0.0 | 0.0 |
| references | 4,639 | 2,629 | 996 | 33 | 981 | 92 | 56.7 | 78.1 |
| exports | 775 | 752 | 0 | 20 | 3 | 64 | 97.0 | 97.0 |
| extends | 69 | 45 | 17 | 6 | 1 | 0 | 65.2 | 89.9 |
| implements | 51 | 24 | 27 | 0 | 0 | 0 | 47.1 | 100.0 |
| overrides | 26 | 23 | 0 | 0 | 3 | 0 | 88.5 | 88.5 |
| instantiates | 1,129 | 802 | 0 | 298 | 29 | 1 | 71.0 | 71.0 |
| **TOTAL** | **84,111** | **26,433** | **17,300** | **28,417** | **7,335** | **300** | **31.4** | **52.0** |

The same table under the pool-wide-only rule, kept because the difference IS the
measurement: `calls` 26.3 · `uses` 39.1 · `contains` 39.3 · `imports` 0.0 ·
`references` 49.9 · `exports` 81.9 · `extends` 60.9 · `implements` 39.2 ·
`overrides` 88.5 · `instantiates` 58.7, TOTAL **27.6 / 48.2**, ambiguous **31,606**.

**An independent instrument reproduces the corrected table to the edge.** This gate
was written from the same rule but shares no code with `incoming-check.ts`, and before
the scope rules it read `calls` ambiguous **28,766**, `instantiates` **437**,
`references` **346**, `calls` unresolved **6,276**, `references` unresolved **981**,
`references` external **996**, `imports` unresolved **4,626** — every figure the
corrected round recorded, without being fitted to it. That is the strongest evidence
in this document that the 48.2% is a measurement and not an artifact of one script.
`incoming-check.ts` still applies the pool-wide rule, so the fleet-comparable figures
remain the 27.6 / 48.2 row above; this gate's 31.4 / 52.0 is what the same edges bind
to once the edge's own file is allowed to answer for itself.

**Two instrument corrections were found by building it, both of the
false-finding class this programme keeps meeting:**

1. **`source === target` is not a self-loop class.** The first version carried one,
   and it read **64 `exports` "self-loops"** — which are `packages/rxjs/src/filter.ts`
   emitting `filter -> filter`, one export per file named after the file's leaf, 64 of
   64 files. A module and a named export are different node KINDS that share a leaf
   name; that is the family's leaf-identity convention, not a cycle. The 64
   reclassified as `resolved` 22 / `ambiguous` 41 / `unresolved` 1. The symbol-endpoint
   types held **236** more, and a probe over the rows (`/tmp/ts-selfloop-probe.mts`)
   showed they are mostly coincidence rather than recursion: only 2 of 236 have the
   source equal to the file's module leaf and 31 of 236 sit in a file that publishes
   the target name more than once (`references` `TreeNode -> TreeNode`,
   `calls` `replace -> replace` where the enclosing method and a member name agree).
   Whether such an edge binds to the source's own declaration is the qualified-spelling
   question, so excluding them would have removed 236 edges from the accounting and
   called that a disposition. They are now classified by TARGET, exactly as
   `script/m14/incoming-gate.ts` classifies them, and counted in a printed `sameLeaf`
   column: **300 edges**.
2. **The engine's own positive control caught its first version.** The classifier and
   the ratchet are self-tested before a corpus is read; the control plants one edge of
   every class and a ceiling BELOW a measured count, and it failed the first draft,
   which had a module-endpoint case asserting a name that the index did not publish.
   A gate whose control cannot fail is the failure mode the fleet arbiter's own header
   documents — CSS's pass-1 containment probe reading 0 on a broken probe, PHP's
   `define()` probe that could never fire — so the control runs FIRST and exits 3,
   and it reports no lane at all rather than a clean one.

### The classifier learned the file's own scope, and 3,189 more edges bound (2026-10-09)

The rule above bound an edge when the pool published exactly ONE declaring file for
the target — a fact about the CORPUS. That is the wrong question for a name 294 files
legitimately declare: `getComponent` in a spec file is not ambiguous TO THAT FILE.
So before anything was changed, the lever was measured on the full pool, read-only
(`/tmp/ts-done-probe.mts`, three passes):

| measured on the same pool, before the change | edges |
|---|---|
| union of the three scope rules (would newly bind) | **3,189** |
| of which the qualified endpoint `<source>.<target>` published in the same file | 2,227 |
| a BARE name the file itself declares | 1,236 |
| a single relative import that resolves to a declaring file | 166 |
| **excluded by the shape guard**: member-shape references to an imported leaf name | **17** |

The 17 are why the guard exists, not a footnote: `import { join } from "node:path"`
says nothing about `[1,2].join`, and a rule that narrowed by leaf-name import would
have bound 17 `calls` edges to the wrong declaration. The guard and the three rules
are all negative-controlled in the gate's self-test: a qualified key published in
ANOTHER file must NOT bind, a bare specifier must NOT narrow, a relative specifier
that resolves to no admitted file must NOT narrow, and a member-shape call must NOT
bind to a leaf name the file declares. `uses` and `contains` are excluded from the
lexical-local rule outright — a member name the file declares is not proof the edge's
source OWNS it — and they bind by the qualified endpoint or not at all (`contains`
1,230 → 86, precisely because 1,229 of its edges name their owner in `<source>`).

The gate now prints which rule earned each resolution, and exports it as
`resolutionProvenance` (counts label resolved edges; they are not the same 3,189, and
the totals are: 26,433 − 23,244 = 3,189):

```
resolution provenance — how each RESOLVED edge earned it:
  leaf-unique              21270     one declaring file (the pool-wide rule)
  qualified-endpoint        4201     <source>.<target> published in the same file
  lexical-local              796     a bare name the file declares
  lexical-import             166     one relative import names a declaring file
```

**What this changes, and what it does not.** Every one of the 3,189 newly bound
edges is bound by a fact the EDGE'S OWN FILE carries, not by lowering a bar:
`AppComponent -> currentDocument` is proven by the pool publishing
`AppComponent.currentDocument` in that same file, `HostComponent` by the spec that
declares it, `legacy` by the one relative module the file imports it from. It does NOT
mean `bb_impact` exploits these keys today — this gate measures what the DATA can
bind, and edge correctness remains the differential's and the mutation suite's
question. It also does not shrink the member-name class much: `calls` ambiguous fell
28,766 → 27,386, because a member call's receiver is a local variable the edge does
not name, so the ontology lever stands. Per-type movement, ambiguous before → after:
`contains` 1,230 → 86, `references` 346 → 33, `calls` 28,766 → 27,386, `instantiates`
437 → 298, `uses` 677 → 588, `exports` 137 → 20, `extends` 9 → 6, `implements` 4 → 0.

**The dispositions, and the four things they say.** The baseline is the list; the
substance is:

1. **By design, and never resolvable: `imports` 4,626 at 0%.** The target is
   `<module>:<name>` (`vitest:describe`, `@angular/core:Component`,
   `rxjs/merge-map:mergeMap`) — a module URI plus an exported name, not a symbol name.
   Recorded with its size so the 0.0% column is a stated design with 4,626 edges
   behind it rather than a discovery downstream.
2. **Declared external: 17,300 edges.** The marker and its four reasons
   (dependency-package 15,307 · runtime-global 1,146 · builtin-lib-type 571 ·
   builtin-module 276), with `externalUnreasoned` locked at ZERO across the six types
   that carry markers: all 17,300 marks carry a reason, so the exemption cannot hide.
3. **Not provable from a single file: the residue.** `calls` 6,276 — test-runner
   globals declared outside the pool (`expect` 949, `it` 491) and member calls on local
   variables (`push` 2,296). `references` 981, and its composition is measured rather
   than named: **82 of 1,011** unresolved type-position edges name a type some
   TypeScript lib file declares, and **929** name something no lib file declares —
   dominated by TYPE PARAMETERS (`T` 621, `R` 46, `K` 30, `S` 17, `E` 13) and
   test-framework globals (`jasmine.Spy` 26). **Consequence, and it kills a plausible
   fix**: extending the pinned `TS_LIB_TYPE_NAMES` table with the DOM set is worth
   **82 edges, 0.10%** of the pool, and was measured and deliberately not done.
4. **Backlog, with the lever named: the ambiguous classes.** `calls` 27,386 (`result`
   is declared by 294 declaring files, `error` by 41, `subscribe` by 23), `uses` 588,
   `instantiates` 298, `contains` 86, `references` 33, `exports` 20, `extends` 6. After
   the scope rules the residue is the part a file's own scope cannot name — a member
   whose OWNER the edge does not carry — and the only thing that binds it is a
   qualified `Owner.member` TARGET, which is an ontology decision — the
   family fixes leaf identity, so it changes every target the fleet emits — not a
   repair to this analyzer. It is recorded as a backlog with a ceiling that may not
   grow. The three `overrides:unresolved` edges (`MatIconRegistry.getNamedSvgIcon`,
   `ErrorHandler.handleError`, `ObservableBase.subscribe`) are the same question in
   miniature: dotted targets the pool publishes no such spelling for.

**So: is TypeScript done?** It is done at the bar this gate states and enforces —
every edge in a declared class, every nonzero class carrying a written rule, no class
over its ceiling, all of it one command. **It is not at 100% resolution and cannot be
under the current ontology**: 52.0% of edges bind to exactly one declaring file or
carry a declared external reason, and the residue is **28,417 ambiguous (27,386 of
them `calls`) + 4,626 by-design module URIs + 7,335 not provable from a single file**
— the four figures sum with the 43,733 that bind to exactly 84,111, which is the
arithmetic check on the whole table. Declaring the lane done means those numbers are
DECLARED, ratcheted and reviewable — not that they are zero.

**Verified for this round (2026-10-09, after the scope rules).**
`npx tsx script/m14/ts-incoming-gate.ts` → **exit 0, PASS**, 37 declared classes,
control fired, 771/771 parsed, 0 degraded, provenance printed. The fail path was
exercised end to end, not asserted: with a copy of the CURRENT baseline holding
`calls:ambiguous` 100 below its count and `extends:ambiguous` removed,
`BB_TS_BASELINE=/tmp/baseline-tight.json` → **exit 1**, both violations
(`OVER CEILING calls:ambiguous = 27386, recorded ceiling 27286 (+100)` and
`UNDECLARED CLASS extends:ambiguous = 6`). `--update-baseline` is idempotent (two
runs, identical md5), `npm run typecheck:scripts` **0 errors**,
`script/m60/verify-script-surface.ts` **PASS, 0 errors, canary VISIBLE**, the
TypeScript fixture lane **96 pass / 6 fail with the fixture baseline gate reporting
"no regressions"** (all six pre-existing), and the new classifier contains **0 regex
literal nodes**, checked through the TypeScript AST.
