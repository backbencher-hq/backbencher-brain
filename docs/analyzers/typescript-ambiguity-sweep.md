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
`.ts`/`.tsx` files under `<corpus-root>/element-plus`.

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

`references` (80.2% / 16.0% unexplained) and `uses` (38.4% / 43.9% unexplained)
are the two labels with real disagreement, and question 4 is where it lives.

## Question 4 — LABELLED: the uses/references boundary, counted

The lane's own rulings (TSD18, TSD28) hold that one read is SINGULAR, one
label — both were fixes for a template read published as `uses` by one pass and
`references` by another. `ts-type-mention-label-probe.ts` asks whether the
analyzer still publishes the same `(source, target)` under both labels.
element-plus, 200 files, 200 parsed:

```
(source,target) pairs published under BOTH uses AND references: 5
  packages/components/cascader-panel/__tests__/cascader-panel.test.tsx :: lazyLoad|id
  packages/components/cascader-panel/src/store.ts                   :: Store|config
  packages/components/cascader-panel/src/node.ts                   :: Node|isLeaf
  packages/components/cascader-panel/src/node.ts                   :: Node|isDisabled
  packages/components/cascader-panel/src/node.ts                   :: Node|config
```

**5 duplicated pairs out of 1,014 `uses`+`references` edges = 0.49%**, in 3
files. The one-read-one-label contract holds on 99.5% of the surface and is
violated on 5 named pairs, which are now a filed defect rather than a shape
nobody had counted. 4 of the 5 are in one directory, so the duplicate-label arm
is a property of that code, not of the corpus.

Analyzer surface by the metadata the emitting pass wrote, same run — this is the
label distribution question 4 asks, per emission site rather than pooled:

| surface | edges | | surface | edges |
| --- | --- | --- | --- | --- |
| calls/plain | 5,424 | | references/declared_type | 284 |
| imports/plain | 1,109 | | references/plain | 126 |
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

### The one mislabelled `evidenceClass`

`overrides` reports `evidenceClass: usage_contextual` at 0.95 while every other
structurally-derived type on this lane reports `structural`
(`contains`/`exports`/`extends`/`implements`/`instantiates`). The overrides arms
ABSTAIN unless the base declaration resolves in-file
(`if (!baseDecl) continue` at real-typescript-analyzer.ts:5346 and :5458), so
the edge is derived from in-file structural truth, not from a contextual
mention. `usage_contextual` is the wrong class for it. Carried as a finding, not
silently re-labelled — changing it moves 71 edges on vuejs and every count that
reads the field.

## Per-type table

Two populations, both derived by `readdirSync`, both printed with their admitted
and examined counts, because a per-type number without its population is the
defect this programme keeps finding.

**A — vuejs, 400 files admitted of 405 candidates, 400/400 parsed, 12,998
symbols, 63,046 edges**, production path (`getParser` -> `parse` -> `analyze`).
Re-run at HEAD and identical to the first run on every per-type count: `calls`
43,376 / `uses` 1,552 / `contains` 3,514 / `imports` 4,764 / `references` 7,670
/ `exports` 1,791 / `extends` 152 / `implements` 5 / `overrides` 71 /
`instantiates` 151.

**B — element-plus, 400 files admitted of 497 candidates, 400/400 parsed** — the
corpus the brief assigns, and the one `firing-check-v2` samples.

| type | verdict | A edges | A files | B edges | B files | within-both (A) | corpus-both (A) | R7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| calls | EMITTED | 43,376 | 377 | 20,770 | 335 | 5.9% | 16.7% | 0 |
| uses | EMITTED | 1,552 | 164 | 214 | 65 | 84.5% | 94.7% | 0 |
| contains | EMITTED | 3,514 | 146 | 1,306 | 127 | 100.0% | 100.0% | 0 |
| imports | EMITTED | 4,764 | 375 | 3,436 | 359 | 0.0% | 0.0% | 0 |
| references | EMITTED | 7,670 | 320 | 3,227 | 327 | 49.4% | 63.7% | 0 |
| exports | EMITTED | 1,791 | 233 | 1,135 | 305 | 23.0% | 35.7% | 0 |
| extends | EMITTED | 152 | 28 | 33 | 24 | 83.6% | 87.5% | 0 |
| implements | EMITTED | 5 | 4 | 0 | 0 | 40.0% | 60.0% | 0 |
| overrides | EMITTED | 71 | 6 | 0 | 0 | **100.0%** | **100.0%** | 0 |
| instantiates | EMITTED | 151 | 41 | 14 | 9 | 7.9% | 11.3% | 0 |

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
| 2 | Fires | yes, all ten, on two corpora | the counts and file counts above, plus `firing-check-v2` 8/10 at NFILES 200 and 400, 7/10 at 25 |
| 3 | Correct | 8 of 10 audited by the differential; the other 2 audited here against the differential's OWN truth builders | audited set `[calls contains extends implements instantiates overrides references uses]`; `exports` 357/357 covered 0 unexplained and `imports` 1125/1125 covered 0 unexplained on element-plus @200 |
| 4 | Labelled | 5 duplicated `uses`/`references` pairs out of 1,014 edges = 0.49% | `ts-type-mention-label-probe.ts`, element-plus 200 files; 5 pairs named, 4 of them in one directory |
| 5 | Confident | yes, with one class mislabelled | 0 edges below 0.7 over vuejs 63,046 edges; 0 sub-1.0 edges without a reason code; `overrides` reports `usage_contextual` where `structural` is right |
| 6 | R7 / endpoints | 0 `unknown`, 0 empty — and 321 source endpoints no identifier can carry | `ts-r7-endpoint-probe.ts` element-plus @400: 400 NOT-AN-IDENTIFIER endpoints, 321 of them sources, every one containing a `-` |

Question 3's limit, stated rather than glossed: the oracle is a second walker
over the SAME tree-sitter-typescript 0.23.2 grammar, so a grammar bug shared by
both paths is invisible to it. Question 5's `instantiates` row shows the shape of
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
| firing-check-v2 | `NFILES=200 bun script/m14/firing-check-v2.mjs TYPESCRIPT` | **8/10**, 200/200 parsed, silent `implements` `overrides` |
| firing-check-v2, sample sensitivity | `NFILES=25` / `NFILES=400` | 7/10 / 8/10 |
| ontology coverage (DERIVATION) | `bun script/m60/rel-type-coverage-gate.ts --langs=typescript` | 2 un-audited: `exports`, `imports` |
| grammar audit | `bun script/m14/audit-analyzer-grammar.ts typescript` | `typescript PASS refs=103 unknown=0 unknownFields=0` |
| differential, lane | `bun script/m14/differential.ts --lang typescript --repo element-plus` | files=60 tree-truth=992 covered=838 (84.5%) MISSING=154, analyzer-edges=755 unexplained=31 (4.1%) |
| differential, before/after my change | same, cold-pool state pinned to rotation 3 | identical hash `30555483d544ff75` both ways |
| fixture lane | `bun script/m14/run-fixtures.ts --lang typescript` | 92 pass / 0 fail, baseline gate no regressions |
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
minimum. **No latency claim is made for this change.**

The honesty gate's 21 failures, and why none of them is this lane's:
evidence freshness on F1-F9 (62 to 2,625 declared inputs changed each; 26 commits
have touched `real-typescript-analyzer.ts` since F2's recorded commit
`a943047e5c`, so this lane is 1 of 26 there), banned terms in OTHER lanes'
artifacts (`validation/m14/grammar-pins.json`, `fixtures/clean/`, `fixtures/c/`,
`fixtures/csharp/`, `fixtures/html/`, `results/M14.0.F5.json`,
`results/archive/fsharp-shape-census.json`), and `analyzer-hygiene-cpp` /
`analyzer-hygiene-elixir`. Regenerating F1-F9 and fixing those artifacts is
master-owned. Not one of the 21 names a file under
`src/ast/real-typescript-analyzer.ts`, `docs/analyzers/typescript-ambiguity-sweep.md`,
`validation/m14/fixtures/typescript/` or
`validation/m14/instruments/typescript/`.

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
