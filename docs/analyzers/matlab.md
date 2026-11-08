# MATLAB (`matlab`)

`RealMatlabAnalyzer` is a per-file, tree-sitter-only AST analyzer over the vendored
`tree-sitter-matlab` grammar (`src/ast/real-matlab-analyzer.ts`,
`metadata.analysisVersion: "m1-matlab-2"`). It never parses source text with a
regular expression, and it publishes eleven relationship types: `calls`, `uses`,
`contains`, `extends`, `implements`, `imports`, `references`, `exports`,
`overrides`, `instantiates`, `part_of`. Three engine values are ruled inapplicable
(`decorates`, `renders`, `mixes_in`) with grammar-inventory and site counts; see
[Relationship ontology](#relationship-ontology).

**One fact the reader must hold before any number in this page**: the shared M14
corpus contains **no genuine MATLAB source** (measured: 412 tracked `.m`, 3
router-admitted, all three Objective-C prose whose comments contain the English
word `function `). The lane is therefore **measured on a dedicated corpus root**,
`.corpus-tail/robotics-toolbox-matlab` @ `06fddf52` — **365 of its 467 tracked `.m`
files admitted** by the router's content test, whole-population arm **365/365 parsed,
56,488 edges**. Both populations and the reason for the split are stated in
[Corpus validation](#corpus-validation); the shared-root finding is retained, not
deleted.

## Language

- **Analyzer file:** `src/ast/real-matlab-analyzer.ts` — class `RealMatlabAnalyzer`,
  `analysisVersion: "m1-matlab-2"`. Output shape: `imports: []` in the ParseResult —
  MATLAB import directives are published as **relationship edges**, not as
  `ImportInfo` entries.
- **Parser:** `wasm/tree-sitter-matlab.wasm`, digest-pinned in `src/ast/engine.ts`
  (`"tree-sitter-matlab.wasm": "0f2f381f010d81af18a9f132e77606dceb02ae705c5b2e3cb0eabff3f42083c3"`),
  pin record `validation/m14/matlab-grammar-pin.json`. The grammar is **vendored in
  tree** at `grammars/tree-sitter-matlab/` (`grammar.js`, `node-types.json`) because
  no npm package publishes this build; its `node-types.json` declares **148 node
  types, 76 named**.
- **Language detection:** `.m` is shared with Objective-C.
  `EXTENSION_LANGUAGE["m"] = "objective-c"` (`src/ast/language-detection.ts:183`) is
  the fallback, and `detectLanguageFromPath` (same file, ~line 403–408) returns
  `matlab` when the first 64 KiB contains `function ` **or** `classdef `, else the
  extension table's `objective-c` answer stands. **The test is a substring test**, so
  it fires on the English word inside a comment — measured consequence and trigger
  lines in [Corpus validation](#corpus-validation). `.mlx` is not routed (binary /
  package format; no parser is vendored for it).
- **Wired in:** `src/ast/engine.ts` — the grammar map (`tree-sitter-matlab` at
  line 378) and `case "matlab": resolveWasm("tree-sitter-matlab.wasm")` in the
  dedicated-roots switch (~line 1270). The analyzer is a normal
  `engine.ts getAnalyzer` entry, so production's `parseFile` path applies
  `filterNoiseRelationships` to its output (see the arm reconciliation in
  [Corpus validation](#corpus-validation)).

## Symbol contract

Extraction is a single pre-order pass over the tree (`collectDeclarations`), then
one publish per declaration; no symbol is synthesized from text.

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | yes | `childForFieldName("name")` on `function_definition`, `class_definition`, `property`; `events`/`enum` members are their `identifier` children |
| kind | yes | `function_definition`→`function` (→`method` when its parent is a `methods` block; →`constructor` when its name equals the enclosing `class_definition`'s name), `class_definition`→`class`, `property`→`property`, `enum`→`enum_member`, `events` identifier→`event` |
| qualified/container name | partial | `qualifiedName` is the bare name for a top-level declaration, and `owner.qualifiedName + "." + name` for a member (set in `walk`); there is no package-qualified name — MATLAB's package is a folder, not a symbol path |
| ownerName / ownerKind | yes | set for every nested declaration in `walk` (methods, properties, events, enumeration members, nested functions) |
| range (start/end line + column) | yes | `node.startPosition`/`endPosition` rows+columns plus `startIndex`/`endIndex` |
| parameters | yes (names only) | `function_arguments` → its `identifier` children. Default values, validation arguments (`arguments` blocks) and types are **not** modeled |
| returnType / type | no | `function_output` is not captured as a type; MATLAB declares no parameter types in the function signature, and `metadata.hasTypeInference` is `false` |
| documentation/comments | no | `comment` nodes are not attached to declarations (the grammar carries them as siblings; the analyzer publishes no docstring field) |
| complexity metrics | no | no complexity metric is computed by this analyzer |
| syntax errors | no | the analyzer does not surface parse errors; tree-sitter error nodes are not converted into symbols or relationships |
| decorators/attributes | partial | `attributes`/`attribute` node text is collected (classdef, properties, methods, events, enumeration and arguments attributes) into `metadata.attributes`, and is read to derive `visibility` (`private` / `protected` / `public`). These are **passive metadata**, not applied callables — why `decorates` is ruled below |

Symbol `metadata` also carries `language: "matlab"`, `grammarNode` (the declaring
node type) and `attributes` when non-empty. No `Module`/file symbol is published:
MATLAB's file-as-module identity is carried on `exports` edges only.

## Relationship ontology

The engine's fourteen-value vocabulary, one row each, plus the two template rows
that are **not** engine values. "Emitted?" is a claim about
`src/ast/real-matlab-analyzer.ts`; a `no` row names its ruling, never silence.
Every `yes` row is pinned by at least one fixture in
`validation/m14/fixtures/matlab/` (12 fixtures, 0 fail), and the arm's per-type
whole-population edges on the dedicated 365-file population are quoted in
[Corpus validation](#corpus-validation). A `no` row is a RULING carried by
`script/m14/spec/matlab-completeness.json`: its measured site census was taken on
the retained shared-root population (census artifact
`validation/m14/fixtures/matlab/measurements/matlab-constructs.txt`), and on the
dedicated population the type publishes **0** edges with the firing log reading it
SILENT.

**Confidence model.** Two tiers, read from the analyzer's own `declarations` index:
`1.0` (`metadata.evidenceClass: "structural"`) when the target name is declared in
**this file**, and `0.6` (`"inferred"`) when it is not — MATLAB's `.m` call/index
ambiguity is exactly why an unresolved target is retained with lower confidence
rather than guessed into a declaration. Three types are fact-shaped and always
`1.0`: `exports` and `part_of` come from the file path, and `overrides` is only
published once a base member is **verified**. `imports`/`references` targets are
cross-file names by construction and are therefore usually `0.6`.

| Type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | yes | `function_call`'s `name` child (identifier or field expression); target spelling as written; `command` statements are not calls (see Unsupported) | 1.0 in-file declaration, else 0.6; `metadata.evidenceClass` records which |
| uses | yes | `field_expression` receiver + member (`construct: field_receiver` / `field_member`), and free `identifier` reads not already owned by a declaration, a callee, a parameter, or a reference construct; assignment RHS is walked explicitly | 1.0 in-file declaration, else 0.6 |
| contains | yes | nested declarations in `walk`: a class contains its properties/events/enumeration members/methods (constructor included); a function contains nested functions | 1.0 (containment is structural) |
| extends | yes | the **first** `property_name` base of a `superclasses` node — `classdef X < Y` is X IS-A Y; one base node per base, so a dotted base (`matlab.mixin.Copyable`) is one target | 1.0 in-file declaration, else 0.6 |
| implements | yes | every **following** `property_name` base of the same `superclasses` node (`X < A & B & C` → B and C are additional superclass conformance). An `&` base is an IS-A superclass, which is why it is `implements` and NOT `mixes_in` | 1.0 in-file declaration, else 0.6 |
| imports | yes | the grammar's `command` production: `command_name` text `import`, each `command_argument` published only when symbol-shaped — `mypkg.f` (`importForm: qualified_name`), `mypkg` (`name`), `mypkg.*` → target `mypkg` (`package_wildcard`); a non-identifier argument (e.g. a header path) publishes nothing, and the raw wildcard is never a target | 0.6 — an import names a package/name that a file-scoped analyzer has usually not declared |
| exports | yes | the file **is** the module: the package-qualified file stem (`mypkg.pkgfunc` for `+mypkg/pkgfunc.m`) exports its primary (first, top-level) declaration. A flat `foo.m`/`foo` identity would be X→X, so it is intentionally **withheld** rather than published as noise | 1.0 (path + declaration identity) |
| overrides | yes | a method of a subclass that redeclares a base method, verified only against a base declared in the same file or visible in `context.overrideCompanion` (the fleet companion the cross-file fixture supplies). An unverifiable base publishes **no** row; `metadata.overriddenClass` / `overridingMember` / `overriddenMember` name the verification | 1.0 (verified only — a guess is never published) |
| instantiates | yes | a `function_call` whose callee identifier names a class declared in this file is construction, and it is published **instead of** `calls` (one call site never carries both labels) | 1.0 (class declarations in-file) |
| references | yes | names captured without invocation: `handle_operator` (`@fn`, `@pkg.f` → `function_handle`), `metaclass_operator` (`?Name` → `metaclass_object`), and the `superclass` qualifier of `method@SuperClass(...)` (`superclass_method_call`). The captured identifier is not also published as `uses` | 1.0 in-file declaration, else 0.6 |
| part_of | yes | MATLAB's namespace is a FOLDER: each `+pkg` segment of the file path becomes one dotted package (`+a/+b/f.m` → `a.b`), and each top-level declaration is `part_of` that package with `partRole: "part"`. Derived from the path because the grammar has **no** namespace node | 1.0 (path fact) |
| decorates | no — ruled ontological | No decorator construct: the served grammar's 76 named types include `attribute`/`attributes` but **0** decorator/annotation production that applies to a declaration; attribute lists are passive metadata the runtime reads (they already ride `visibility` and `metadata.attributes`), not applied callables. On the dedicated population the arm publishes **0** `decorates` edges and the firing log reads it SILENT; the ruling's site census (0 attribute lists) and falsifier are in the spec's `coverage.excluded`. | — |
| renders | no — ruled ontological | No markup/component model: 0 render/component/template productions among the 76 named types; a widget constructor (`uifigure`, `uicontrol`, …) is an ordinary call whose first argument is a container object, not a declared component symbol; App Designer `.mlapp` is a ZIP the router admits to no lane (measured `.mlapp` files on the corpus tree: 0). On the dedicated population the arm publishes **0** `renders` edges and the firing log reads it SILENT; the ruling's site census (0 UI constructor calls, 0 `.mlapp`) and falsifier are in the spec's `coverage.excluded`. | — |
| mixes_in | no — ruled ontological | No mixin/trait/composition clause: 0 mixin/with/include productions among the 76 named types; the only multi-parent construct is the superclass list, and an `&` base is an IS-A base whose members are inherited — published as `implements`, never as member-set composition. On the dedicated population the arm publishes **0** `mixes_in` edges and the firing log reads it SILENT — the multi-parent rows there are measured as `extends` (71) and `implements` (1), which is the split this ruling protects; the `&`-site census and falsifier are in the spec's `coverage.excluded`. | — |
| depends | no — not an engine value | `depends` is not a member of `RelationshipType` in `src/ast/types.ts`; the family spelling for a name dependency is `references` (this lane emits it) | — |
| field_access | no — not an engine value | `field_access` is not a `RelationshipType` member; the family spelling is `uses` with `construct: field_receiver` / `field_member` (this lane emits both) | — |

The ontology is held to the fleet's fourteen-value bar and to the owner's
"implemented or ruled with a count" rule: coverage gate row `matlab yes 11 11 3`
with **0 problems** (`bun script/m14/coverage-block-gate.ts`), denominator `n = 11`
(the fourteen minus the three ruled values).

## Supported constructs

Fixtures (authored before each run; fire **and** forbid halves):
`bun script/m14/run-fixtures.ts --lang matlab` → `{"matlab":{"pass":12,"fail":0}}`.
All under `validation/m14/fixtures/matlab/`:

| Fixture | Pins |
| --- | --- |
| `functions.m` | multiple outputs, parameters, local functions, call/uses edges |
| `nested-and-script.m` | nested function containment, script-level `root` source reads |
| `ambiguity.m` | call/index ambiguity retained as inferred calls (no semantic claim) |
| `class-and-methods.m` | class, property, constructor, method, single inheritance `extends`, containment, field receiver/member uses |
| `class-surface.m` | class-section visibility (`properties (SetAccess=private)`, `methods (Access=private)`), events, enumeration members |
| `heritage.m` | `classdef Multi < BaseOne & BaseTwo & matlab.mixin.Copyable`: first base `extends`, following bases `implements`, dotted base is ONE target |
| `Widget.m` | object construction: same-file class constructor call is `instantiates`, never a plain `calls` |
| `imports.m` | `import` command spellings (`qualified_name`, `name`, `package_wildcard`); raw wildcard, non-import commands and `calls`-to-`import` forbidden |
| `references.m` | `@helper` (structural), `?Widget` / `@pkg.f` (inferred), and forbidden double-label (`uses`) / call-to-metaclass |
| `+mypkg/pkgfunc.m` | folder-namespace facts: `part_of pkgfunc -> mypkg` (`partRole: "part"`) and `exports mypkg.pkgfunc -> pkgfunc`; flat identity export forbidden |
| `Base.m` + `Multi.m` | cross-file override pair (`crossFileOverride: ["Base"]`): verified `overrides Multi -> alpha`; new member and un-redeclared base member forbidden |

Covered surface: function files and scripts; function parameters (names);
multiple outputs; local and nested functions; classes with properties, events,
enumeration members and methods; constructor detection; section attributes and
visibility; single and multiple superclasses; constructor-call instantiation;
`import` directives; function handles and metaclass references; qualified
superclass-method calls; `+pkg/` folder namespaces; cross-file override
verification.

### Unsupported / explicit-unknown constructs

Each is a declared limit, not a silent drop:

- **Script variables** have no declaration construct in the grammar, so they are
  never symbols; a script's reads publish `calls`/`uses` from the synthetic `root`
  source.
- **Commands are not calls.** `clear all` / `hold on` / `disp hello` are `command`
  statements in the grammar; the analyzer emits no edge for them (only the
  `import` command is interpreted, as `imports`). This is a deliberate scope
  decision pinned by a forbid row in `imports.m`, not an accident of parsing.
- **Cross-file resolution** (packages, imports, base classes, constructor targets)
  is out of scope for a per-file analyzer; `qualname.m` callables are published by
  spelling and marked `0.6`/inferred. The only cross-file fact accepted is the
  `overrideCompanion` the fixture runner can supply.
- **Overload and arity resolution** are not attempted (MATLAB dispatch is runtime).
- **`@Class/` folder methods** are not modeled as a namespace: the grammar has no
  folder node and the admitted population carries no such folder (0 measured).
- **App Designer `.mlapp`** is not routed (ZIP/binary format; no parser vendored).
- **`arguments`-block validation** declarations are parsed as `arguments_statement`
  children but not published as symbols or edges.
- **No `depends` / `field_access` / `Module` symbol** — see the ontology rows.

## Regex inventory

From `validation/m12/results/regex-census.json` (AST census over the **committed**
analyzer blobs; `describes: "HEAD blobs"`, generated artifact) and the fleet gate:

| File | HEAD regex usages | Census entries |
| --- | --- | --- |
| `src/ast/real-matlab-analyzer.ts` | **0** | 0 (the census's `totalRegexUsages` is 0 across all 50 analyzers; it carries no matlab row because there is none) |

`bash script/m14/no-regex-gate.sh` → `PASS — 0 regex literals, by AST census`, and
the matlab analyzer appears **zero times** in its output. The analyzer's name and
path tests are character-code scans (`isIdentifierPath` / `isIdentifierSegment`),
`slice`/`split`/`includes` only; there is no `RegExp`, no `.match(`, and no
`replace(/…/)` in the file. Any future regex is a gate failure before it is a
review comment.

## Complexity envelope

**Not measured for this lane.** The template's source of truth,
`validation/m12/results/matlab-complexity.json`, **does not exist**, and
`validation/m60/analyzer-budget-register.json` carries **no matlab row**, so there
is no declared time/RSS budget either. No fabricated envelope is presented here.

What latency evidence does exist, quoted with its instrument and population:

| Measurement | Value | Source |
| --- | --- | --- |
| differential per-file timing | avg **11.4 ms/file**, max **88.4 ms/file**, 60 files timed, `loadAvg1: 3.76`, `loadAvgRetried: false` | `validation/m14/results/M14.0.F5.json` → `data.report.matlab.perf` |
| census walk over the 3-file shared population | **27,821 ms** wall for 3 files (tree walk + production `parseFile`), `load at start 3.60` | `validation/m14/fixtures/matlab/measurements/matlab-constructs.txt` |

Hot-path audit — **reasoned from the source, not profiled** (the honest form when
no profiler artifact exists): the analyzer makes one pre-order declaration pass and
one tree walk per file; the only whole-file passes (`emitOverrides`,
`emitModuleMembership`) are O(declarations in this file) map lookups; the override
pass iterates classes × bases × methods, all file-scoped and bounded by the file's
own declaration count. There are no per-symbol full-tree rescans, no transitive
closure, and no regex backtracking. What would verify the claim: a per-phase timing
breakdown on the dedicated corpus, which does not exist yet (see
[Differential ground truth](#differential-ground-truth) for the corpus pin).

## Differential ground truth

- **Oracle (ground truth):** `script/m14/oracles/matlab-truth.ts` — lane-owned,
  derives truth from the parse tree from MATLAB's own semantics and the lane's
  measured conventions, and shares **no rule table or resolver** with
  `real-matlab-analyzer.ts` (an agreement is two implementations agreeing, not one
  confirming itself). Authority: **lane-owned derivation** (`manual_audit`-class),
  not a compiler or language service.
- **Result artifact:** `validation/m14/results/M14.0.F5.json` →
  `data.report.matlab`; per-lane verdict in
  `validation/m14/results/M14.0.F5.lane-measurements.json`.
- **Corpus pin:** `$HOME/mcp/backbencher-brain/.corpus-tail/robotics-toolbox-matlab`
  @ `06fddf5228cbfa1132fa63b8e336b43c5ed04899` (467 tracked `.m` files,
  `dirtyCorpus: false`). The shared corpus is **not** usable here: it holds 0
  genuine MATLAB files (see [Corpus validation](#corpus-validation)), which is why
  `script/m14/differential.ts` maps matlab to this dedicated root.
- **Sample vs population, stated so neither is read as the other:** the differential
  draws a **seeded 60-file sample of the root's 467 tracked `.m` files**; the arm's
  population is the router-admitted **365**. The differential answers "does the
  analyzer agree with the oracle on this sample"; the arm answers "what does
  production emit over the admitted set".

Measured (`filesSampled: 60`, `sampleSetHash: "b21c90671b755238"`):

| Field | Value |
| --- | --- |
| tree-truth edges (`treeTruthEdges`) | **9,035** |
| covered by analyzer (`coveredByAnalyzer`) | **8,201** |
| **coverage** (`coveragePct`) | **90.8 %** |
| missing from analyzer (`missingInAnalyzer`) | **834** |
| analyzer edges (`analyzerEdges`) | **2,876** |
| explainable by tree (`explainableByTree`) | **1,966** |
| unexplained by truth (`unexplainedInAnalyzer`) | **94** |
| **fabrication** (`fabricationPct`) | **3.3 %** |
| declared-heuristic unmatched (`heuristicUnexplained`, confidence < 0.7) | **816** |

Reading rules, stated so the numbers cannot be read as more than they are:

- **Compared labels are exactly eight:** `exports`, `extends`, `implements`,
  `contains`, `calls`, `uses`, `references`, `imports`
  (`script/m14/differential.ts`, matlab's compared-label list). `overrides`,
  `instantiates` and `part_of` are emitted but **not audited** by this harness — no
  oracle rows exist for them — and this page does not claim they are.
- `unexplainedInAnalyzer` counts only **confident** (≥ 0.7) unmatched edges; the
  816 low-confidence rows are published separately as *declared heuristic* (honest
  suspicion), not as fabrication. The artifact does not publish a per-label split of
  either class.
- **`pinned: false` is a verdict, not an absence** — the per-lane artifact's own
  note: "a lane carrying its own missing/unexplained is never pinned" (#870).
- **Samples are capped** at 300 (`270 MISSING` + `30 UNEXPLAINED` in the artifact).
  Among those samples the dominant MISSING class is `uses` (256) with `exports`
  (14), and the dominant UNEXPLAINED class is `calls` (19) with `contains` (10).
  Two known **scope** differences are visible in the samples and are recorded as
  scopes, not adjudicated here: the oracle derives an identity `exports tpoly ->
  tpoly` that the analyzer intentionally withholds as X→X, and the oracle counts
  parameter reads as `uses` that the analyzer excludes as declaration names. The
  artifact does **not** settle whether a sampled UNEXPLAINED row is an oracle gap or
  an analyzer defect; that adjudication is a separate step and is not claimed.

## Corpus validation

Two populations, named separately. The **dedicated root is the lane's declared,
whole-population measurement**; the shared-root finding is retained because it is
the measurement that forced the dedicated root to exist.

**(a) Dedicated population — the lane's declared measurement (DONE).**

- **Root:** `.corpus-tail/robotics-toolbox-matlab` (workspace-relative); repository
  `https://github.com/petercorke/robotics-toolbox-matlab.git` @
  `06fddf5228cbfa1132fa63b8e336b43c5ed04899` — 712 tracked files, **467 tracked `.m`**.
- **Admission:** the gate's own predicate on that root — `admitted files [0, 365) of
  365` (365 of the 467 pass the router's 64 KiB content test). **The 102 not admitted
  are the router's rule, not a dropped measurement**: a MATLAB SCRIPT with no
  `function`/`classdef` routes to objective-c (`language-detection.ts:405`), and a
  lane measures only what production admits — the population is not the repository,
  and the spec's `_corpus_root` says so.
- **Arm:** `BB_CORPUS_ROOT=$PWD/.corpus-tail bun run script/m14/incoming-gate.ts matlab 0`
  → **365 parsed of 365**, one process, TABLE 1 **56,488 edges**. Declaration
  `validation/m14/instruments/matlab/incoming-declaration.json`:
  `parsed=365/365 admitted=365 exts=m index=no`, **14 types**, five buckets per type
  closing to each type's own edges with `unclassed: 0`, **8 cause rulings**, 5
  resolution caveats.
- **Per-type TABLE 1 (edges / resolved):** calls 19,030 / 4,275 · uses 35,520 / 6,171 ·
  contains 1,627 / 1,627 · imports 11 / 0 · references 107 / 37 · exports 16 / 16 ·
  extends 71 / 5 · implements 1 / 0 · instantiates 96 / 69 · part_of 9 / 0 ·
  overrides 0 · decorates 0 · renders 0 · mixes_in 0.
- **Cause rulings** — one per wall, each with the population string and a falsifier
  carrying a run and a wouldFail: calls 14,755 · uses 29,349 · imports 11 ·
  references 70 · extends 66 · implements 1 · instantiates 27 · part_of 9.
- **Firing instrument:** `MATLAB 10 types fired 400/400 parsed of 467 admitted (even
  stride) [corpus=robotics-toolbox-matlab]` — calls 17,530 · uses 36,634 · contains
  1,383 · instantiates 96 · references 88 · extends 61 · exports 29 · part_of 8 ·
  imports 4 · implements 1; **SILENT: overrides decorates renders mixes_in**. The
  three ruled values are expected to be silent; `overrides` is implemented but has no
  verified base in this population, so its evidence is the cross-file fixture pair
  (`Base.m` + `Multi.m`), not a corpus count.
- **Gates:** coverage `matlab yes 11 11 3` with **0 problems**; the completion gate
  records the lane **DONE** — committed fleet record
  `validation/m14/verification/COMPLETION-STATUS.md` §"THE FULL 50-LANE FLEET IS
  COMPLETE — gate: 50 lanes · 50 at n/n · 50 DONE"; fixtures **12 pass / 0 fail**;
  no-regex **PASS**.

**(b) Shared-root finding — retained (spec `_shared_corpus_finding_2026_10_31`).**
Measured by `npx tsx validation/m14/fixtures/matlab/census-constructs.ts` over
`<corpus-root>`:

- **412 tracked `.m`** = **3 admitted** + **153 tracked-but-absent/unreadable** + **256
  routed to objective-c** by content — the arithmetic reproduces the tracking total
  exactly.
- **All 3 admitted files are Objective-C by content** (`#import`, `@interface`,
  `NSString`); the router marker is the **English word `function ` inside a comment**
  in each — `CoreTests.gen.m:1187`, `FVPTextureBasedVideoPlayer.m:130`,
  `SDWebImageDownloaderOperation.m:574` (trigger lines in the census artifact).
- **Genuine MATLAB constructs in that population: 0** — 0 classdef sections, 0
  function definitions, 0 methods/properties/events/enumeration sections, 0 `+pkg/`
  or `@Class/` folders.
- Its arm read `3 parsed of 3 sampled`, **1,634 edges** (`calls` 1,524 + `references`
  110, every other type 0, all unresolved); that 3-file slice artifact is kept in
  `validation/m14/instruments/matlab/slices/whole-population.txt` as history and is
  **superseded** by the declared declaration. Adding a MATLAB repository to `.corpus`
  was rejected because every lane's population would change (the objective-c lane also
  admits `.m`) and the 48 shared-corpus declarations would be voided — a separate root
  keeps them intact and is named in every number this lane publishes.
- The M12 corpus manifest `validation/m12/corpus-manifest.json` has **no matlab entry**
  (the M12 corpus was never admissible for this lane) — declared rather than replaced
  with a number.

Commands that re-derive these numbers:
`BB_CORPUS_ROOT=$PWD/.corpus-tail bun run script/m14/incoming-gate.ts matlab 0` (the
arm; its own TABLE 1 is the declared population) ·
`bun script/m14/run-fixtures.ts --lang matlab` ·
`npx tsx validation/m14/fixtures/matlab/census-constructs.ts` (shared-root finding) ·
`bun script/m14/coverage-block-gate.ts` ·
`npx tsx script/m14/verify-analyzer-docs.ts --lang matlab`.

## Evidence pointers

- Analyzer: `src/ast/real-matlab-analyzer.ts`
- Grammar + node inventory: `grammars/tree-sitter-matlab/grammar.js`, `grammars/tree-sitter-matlab/node-types.json`; pin `validation/m14/matlab-grammar-pin.json`
- Fixtures + expectations: `validation/m14/fixtures/matlab/` (12 fixtures)
- Construct/emission census: `validation/m14/fixtures/matlab/measurements/matlab-constructs.txt`;
  instrument `validation/m14/fixtures/matlab/census-constructs.ts`
- Coverage spec (implemented/ruled + falsifiers, `_corpus_root`, and the retained
  `_shared_corpus_finding_2026_10_31`): `script/m14/spec/matlab-completeness.json`
- Dedicated-root arm + derived declaration:
  `validation/m14/instruments/matlab/incoming-declaration.json` (14 types, 5 buckets
  per type, 8 cause rulings, `parsed=365/365`); arm command
  `BB_CORPUS_ROOT=$PWD/.corpus-tail bun run script/m14/incoming-gate.ts matlab 0`;
  cause-ruling writer `script/m14/matlab-declaration.ts`. The 3-file shared-root arm
  at `validation/m14/instruments/matlab/slices/whole-population.txt` is retained as
  **superseded history**, not as this declaration's source
- Fleet completion record: `validation/m14/verification/COMPLETION-STATUS.md`
  (§"THE FULL 50-LANE FLEET IS COMPLETE — gate: 50 lanes · 50 at n/n · 50 DONE")
- Firing instrument row: `validation/m14/results/firing-laptop-b.current.log`
  (`MATLAB 10 types fired 400/400 parsed of 467 admitted [corpus=robotics-toolbox-matlab]`)
- Differential: `validation/m14/results/M14.0.F5.json`, `validation/m14/results/M14.0.F5.lane-measurements.json`,
  oracle `script/m14/oracles/matlab-truth.ts`, corpus `.corpus-tail/robotics-toolbox-matlab` @ `06fddf5`
- Regex census: `validation/m12/results/regex-census.json`; gate `bash script/m14/no-regex-gate.sh`
- Docs gate: `npx tsx script/m14/verify-analyzer-docs.ts --lang matlab`
