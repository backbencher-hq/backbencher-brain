# real-json-analyzer

Tree-sitter extraction for `*.json`, `*.jsonc` and `*.json5`, verified under the
**M14/M60** json lane wave (record: `reviews/json/m60-closure.md`).

> Regenerated 2026-09-27 from measurement. The previous version predated the lane
> and described an analyzer that no longer exists.

## Grammar pin

`wasm/tree-sitter-json.wasm` — sha256 `fdb5219abe058369…`, **5,961 B**, **26 ids /
12 named / 14 anonymous / 2 fields**. Pinned as lane 10 of 10 in
`validation/m14/grammar-pins.json`, with the id-order, type-set and field-set
digests.

**Two builds of `tree-sitter-json` are in circulation and they are not the same
artifact.** The wired bytes are 5,961 B / 26 ids; `~/.bb/wasm/` holds 5,596 B /
25 ids. The **named vocabulary (12 types) and the field set (2) are identical** —
they differ only in anonymous tokens, the wired build leaking internal helpers
`string_content_token1` (id 8) and `string_content_repeat1` (id 25) where the
registry build has `_string_content` (id 21). That shifts **every named type's id
by one**.

So **a pin comparing named types alone would pass these two builds as one.** The
id-order digest is recorded for exactly that reason. The consequence for this lane
is favourable and was measured: the analyzer matches on node type **names** and
never on a numeric id, so a dev run and a compiled run see the same shapes. An
analyzer that cached numeric ids, or that treated an id-order digest as if it
described the grammar's semantics, would break between the two.

Provenance is `unnamed-build-sha-only`, the honest kind here: hash-matching a
published tarball is how the haskell and powershell lanes identified their bases,
and it was not possible — no vendored grammar source, no reachable published
artifact. **The version numbers are unknown, not unrecorded**, and the registry copy
is listed as DIVERGENT rather than as a match so the gate can fail on it.

`wasm/tree-sitter-json_schema.wasm` is **not** this lane's grammar: it is a
YAML-family schema backend selected at compile time by `-DYAML_SCHEMA` (6 node
types, no fields), already under `notVendored`.

## Contract

| Concern | Contract |
| --- | --- |
| Module identity | the file's basename **without** its extension (`Basic.json` → `Basic`), for **all three** routed spellings. It used to strip only `.json`, so `.jsonc` and `.json5` module symbols kept their extension while `.json` ones did not — a deviation from this very row, found by the differential as 24 MISSING and 207 UNEXPLAINED `contains` edges, every sampled example a dot-prefixed name like `.markdownlint-cli2.jsonc`. Small (4 `.jsonc` and 6 `.json5` files are tracked corpus-wide) and corrected. |
| Symbol identity | a `pair` key is a symbol named by its key, and its **owner is the parent object's qualified path**. An earlier version made the owner the parent symbol's NAME on the stated ground that "a path is a fine identity and a useless endpoint, because the store resolves by name" — that ground was half true and the conclusion was wrong, and the incoming check is what showed it. See [Endpoints are paths, and why](#endpoints-are-paths-and-why). The bare owner is still published, as `meta.ownerName`. |
| Kinds | an **object** is `class`: it has named children and `contains` edges come from it. Everything else is `property`, **including an array** — the analyzer previously called arrays `variable`, importing a shell-shaped mutable-binding distinction JSON does not have. |
| Arrays | a **leaf of scalars, a container of objects**. Scalar elements are positional and unnamed: no symbol, no edge. An object element is a `class` named `<array>[i]`, contained by the array, and **its own keys are owned by the element**. Three cases for the array's own name, told apart by the path's last segment: an array written under a **key** keeps the short name the document already uses (`allOf[0]`, not `definitions.Extended.allOf[0]`); an array that is itself an **element** has no key, so its children are named from its qualified path; a **top-level** array is named by the module, whose basename may contain a dot. The middle case exists because naming an element array's children from the array's own name made both levels `rows[0]`, and `contains` — emitted from the owner symbol — then asserted `rows[0] contains rows[0][1]` between two objects that are not nested. Pinned by `json/ArrayInArray.json`, with a keyed array as the control. |
| `line_number` | **every relationship carries a positive site line.** It used to carry none: the string did not occur once in the file, so every json edge in the index was stored with a NULL line while symbols carried `range` throughout. The position was known and simply not published. |
| `$ref` | names a **LOCATION**, not a symbol, so the target is the location. Nothing guarantees the name at a location is unique — two documents in one file can each declare `spec` — while the location is. A JSON Pointer is *relative to the document root*, so `#/components/schemas/X` names `<module>.components.schemas.X`. |
| `imports` | a `$ref` naming **another file** is a dependency and emits both `imports` and `references`. A local pointer and a URL are neither: a URL names a **vocabulary** (a JSON-Schema draft identifier), and 38 of the 50 external refs in the corpus are exactly that. |
| OpenAPI | a `/`-prefixed key whose object declares an HTTP method is an endpoint, and the `paths` object `uses` it. |
| Manifests | in a `package.json`/`composer.json`, an entry under `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies` is a `uses`. Keyed on the **filename**, so any JSON with a `dependencies` key does not acquire npm semantics. |
| npm scripts | a `scripts` entry invoking a **sibling** entry by name (`npm run <name>`, and `pnpm`/`yarn`/`bun` with `run`/`run-script`/`run-s`) is a `calls`. Declined and pinned with `forbidRelationships`: a target that is not a key of the same `scripts` object (a binary, or another package's script), a self-reference, a **quoted** target (the shell rewrote the argument), and any token that merely *contains* a runner name — `npx` contains `npm`, and a PATH named `npm` is not a runner. npm's implicit `pre`/`post` lifecycle hooks are also not emitted: npm runs them without the command naming them. |
| Documents | a document may hold an object, an array, or **several values** — concatenated JSON is real input (kubernetes' `hack/testdata` holds it) and every top-level value is walked. |
| Duplicate keys | a key declared **twice in one object** is a redefinition — the second replaces the first under every mainstream parser — and emits `overrides` in the **bash lane's** shape: source is the owner symbol, target the key, and `overridesLine` carries the prior line, because both declarations share one name *and* one qualified path and the line is the only thing that distinguishes them. Scoped to the **object**: the same key in two different objects is not a redefinition, and that is the corpus's dominant shape (120,174 occurrences across 7,679 files against 21 genuine duplicates). An **empty** key is declined (10 occurrences, every one a document the grammar recovered with ERROR nodes). |
| Invalid input | errors are engine-owned and surfaced; the module symbol is still emitted so a consumer can attribute the failure to a file. |
| Regex | **zero regex literals**, enforced by `script/m12/json-contract-probe.ts` rather than asserted, and scanned with comments and strings stripped. The analyzer never reads the file as text: every decision comes from the tree. |

## Relationship ontology

**9 of 10 emitted, 1 ruled, every verdict measured.**

Whole admitted population, **12,543 files** across 138 repositories, production
`parseFile` (`validation/m14/fixtures/json/census.ts --chunked`). 3,414,094 symbols,
3,424,980 relationships, 0 parse failures, 0 symbols with an empty name, 0 with an
empty or unknown kind, 0 relationship endpoints equal to the placeholder literal
`unknown`.

| type | verdict | edges | files | both endpoints resolve | confidence min | below 0.7 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `contains` | EMITTED | 3,401,552 | 11,283 | 100.00% (3,401,552/3,401,552) | 1.0 | 0 |
| `references` | EMITTED | 15,017 | 159 | 98.55% (14,799/15,017) | 0.8 | 0 |
| `uses` | EMITTED | 5,758 | 470 | 100.00% (5,758/5,758) | 0.8 | 0 |
| `extends` | EMITTED | 1,721 | 94 | 99.83% (1,718/1,721) | 1.0 | 0 |
| `exports` | EMITTED | 513 | 217 | 100.00% (513/513) | 1.0 | 0 |
| `calls` | EMITTED | 217 | 81 | 100.00% (217/217) | 0.8 | 0 |
| `overrides` | EMITTED | 22 | 12 | 100.00% (22/22) | 1.0 | 0 |
| `implements` | EMITTED | 113 | 1 | 100.00% (113/113) | 0.9 | 0 |
| `imports` | EMITTED | 67 | 20 | 0.00% (0/67) — see below | 1.0 | 0 |
| `instantiates` | RULED | 0 | — | — | — | — |

`imports` resolving at 0% is **correct, not a defect**: an `imports` target names
another FILE (`v0.0.1/dsse_v0_0_1_schema.json`), and a file in another file is not a
symbol in this one. All 67 have a resolvable source. It is the one type whose endpoint
is deliberately not a symbol.

**Edges below the 0.7 heuristic threshold: 0 of 3,424,980.** Sub-1.0 edges are
`calls` (217, all 0.8), `implements` (113, all 0.9), the 218 `references` whose target
did not resolve (0.8), and the OpenAPI-endpoint `uses`. Each carries `evidenceClass`;
every edge under 1.0 also carries a `reasonCode`, per honesty contract §4 point 1.

### Endpoints are paths, and why

Every relationship type in this lane emits **qualified paths** on both ends, and
`contains` was the last to be converted. The incoming check
(`npx tsx script/m14/incoming-check.ts --json json <files...>`, a shared §8
instrument) over a 202-file, 99-repository sample, before and after:

| | before | after |
| --- | ---: | ---: |
| `contains` edges | 66,032 | 66,164 |
| targets matching **more than one** published symbol | 32,660 (49.4%) | 6 (0.009%) |
| self-loops (source string == target string) | 1,119 | 0 |
| targets matching no published symbol | 0 | 0 |

The 49.4% is the finding. A JSON document repeats key names relentlessly — `name`,
`type`, `items`, `properties` — so a bare-name target is ambiguous **by
construction**. And ambiguity here does not degrade to a wrong answer; it degrades to
**no answer**. The shared resolver (`src/ast/parallel-indexer.ts`, strategy 2) matches
a bare name only under `HAVING COUNT(*) = 1`, and strategy 3 requires a `.` in the
string. An ambiguous bare target satisfies neither, so `target_symbol_id` stays NULL:
the edge is in the graph, asserts containment, and cannot be walked in either
direction.

**Endpoints equal to the literal `unknown`: 51 before, 0 after.** Those 51 were never
placeholders. proxicall's i18n bundles and hasura's OpenAPI map declare a real key named
`unknown`, published as `ar.dashboard.analytics.unknown`; the edge read
`analytics -[contains]-> unknown`, and rule R7 cannot tell that apart from a placeholder
because both are the string `unknown`. A key is named `unknown` 51 times in this corpus
and the placeholder is named `unknown` 0 times.

The bare owner is still published as `meta.ownerName`, and each edge carries
`meta.endpoints: "qualified_path"`.

#### One number that was wrong in both directions

`incoming-check` also reports `orphanDeclarations`, and on this lane it read
**0.23%** before the change and **99.75%** after. Neither is a regression and neither
is a pass; both are the same artefact. The metric is
`declaredNames.filter(n => !namedTargets.has(n))`, where `declaredNames` collects
`symbol.name` — the **bare** name — while the targets are now **paths**. A path never
equals a bare name, so almost nothing is "named" in the namespace the metric counts.

`validation/m14/fixtures/json/namespace-orphan-probe.ts` measures it in both namespaces
on the same 198 files:

| namespace | orphans | of | rate |
| --- | ---: | ---: | ---: |
| **qualified path** | **107** | 65,373 | **0.16%** |
| bare name, unique names only | 6,280 | 6,403 | 98.08% |
| ambiguous bare names, excluded from both | 2,077 | | |

So the incoming graph reaches 99.84% of published declarations. Reporting the tool's
99.75% as a regression, or the earlier 0.23% as a pass, would both be dishonest; the
figure that answers the question is 0.16%.

**Unresolvable targets are external, not unpublished.** 22 distinct target strings name
nothing published in the sample, and they are all external by inspection: npm packages
(`@actions/core`, `@actions/exec`, `@actions/github`, `graphql`, `lz-string`,
`dockerfile_lint`, `doctoc`, `eclint`) and sibling schema **files**
(`modelsObject.json#`, `authorizationObject.json#`, `operationObject.json#`,
`oauth2GrantType.json#`). None is a declaration in this corpus that the analyzer failed
to publish — which is the distinction deliverable C asks for, because the two look
identical in a count and are opposite findings.

### What each type means in JSON

- **`contains`** — the object a key is written in contains that key. The only relation
  the *format* defines; 99.3% of the lane's graph.
- **`references`** — a `$ref` names a **location**, not a symbol, so the target is the
  location. A JSON Pointer is relative to the document root, so
  `#/components/schemas/X` names `<module>.components.schemas.X`.
- **`imports`** — a `$ref` naming **another file** is a file dependency and emits both
  `imports` and `references`. A local pointer and a URL are neither: a URL names a
  **vocabulary**.
- **`uses`** — an OpenAPI `paths` object uses the endpoint it declares, and a manifest
  uses each entry under `dependencies` / `devDependencies` / `peerDependencies` /
  `optionalDependencies`.
- **`extends`** — two sources, and they are different claims. **Composition**: JSON
  Schema `allOf` means "must satisfy all of these", the one keyword that means a superset
  relation; `anyOf` and `oneOf` are **alternatives** and `not` is a negation, none of
  which has an ontology type, so they contribute only the `references` their `$ref`s
  already produce. **Declared supertype**: a document that declares types may state one,
  and `inheritance-probe.ts` is the measurement. Corpus: `allOf` 1,445 occurrences,
  `oneOf` 1,021, `anyOf` 573, `not` 206 — the shape the reading predicts. The `extends`
  SOURCE is the schema object that composes, not the `allOf` array that records it: the
  array is a keyword shared by every schema in the file, so a name-resolving consumer
  binds it to an arbitrary one. The array's own path is still on the edge as
  `meta.compositionSite`.
- **`implements`** — a document that declares types may state which **interfaces** it
  mixes in. See the retraction below.
- **`exports`** — what a manifest **publishes**: a subpath key of `exports`, the field
  name for `main`, the command name for `bin`.
- **`calls`** — an npm script that runs a **sibling** script:
  `"pretest": "npm run compile"`. Both endpoints are keys of the same `scripts` object,
  so both are symbols in the same file. 217 edges over 81 files.
- **`overrides`** — a key declared **twice in one object**. The second declaration
  replaces the first under every mainstream parser, which is the relation the bash lane
  calls `overrides`. RFC 8259 §4 says only that names SHOULD be unique and that a
  parser's behaviour is unpredictable. 22 edges over 12 files.
- **`instantiates`** — RULED, see below.

### `implements` was RULED and the corpus overturned it

The pass-1 ruling was **instrument A, a grammar inventory**: "the grammar produces 20
distinct node types across the corpus and NONE expresses a supertype clause." That
reasoning cannot see a **keyword**, because a grammar has no node type for one — the
same unsound question that produced this lane's five earlier wrong rulings, and the
arbiter reported `RULED-SOUND` on it.

`validation/m14/fixtures/json/inheritance-probe.ts` counted the construct instead, and
two documents in the admitted population declare types and state their supertypes, both
as ordinary object keys:

- `dart-sdk/third_party/pkg/language_server_protocol/lsp_meta_model.json` — the Language
  Server Protocol's own serialisation of its type declarations. 66 structures carry
  `"extends": [{"kind":"reference","name":"TextDocumentPositionParams"}]` and 87 carry
  `"mixins": [{"kind":"reference","name":"WorkDoneProgressParams"}, …]`. `mixins` names
  the TypeScript **interfaces** a class mixes in; an interface carries no
  implementation, so there is nothing else for the word to mean.
- `duckdb/src/include/duckdb/storage/serialization/*.json` — serialisation schemas for
  C++ classes, `{"class": "NotNullConstraint", "base": "Constraint", …}`, where `class`
  declares the type and `base` names its superclass.

Measured: **113 `implements` edges in 1 file**, all at confidence 0.9, and 1,721
`extends` over 94 files.

What keeps this from firing on every JSON file is that both shapes are **announced by
the document** before any key is interpreted: 2 of the admitted documents contain a
`{"kind":"reference"}` literal and 21 contain a `class` string. Without that precondition
a `name` key in an i18n bundle or an OpenAPI operation would read as a type declaration.

Two shapes are declined, and the corpus says why:

- a **member descriptor** — duckdb writes
  `{"id": 200, "name": "info", "type": "AlterInfo*", "base": "ParseInfo"}` for a *field*
  whose C++ class derives from `ParseInfo`. 16 corpus-wide. It is not a type
  declaration, and it carries no `class` marker, so all 16 are declined **by the marker**
  rather than by a name list.
- `"parent": <number>` — vega's data files carry it on 251 pairs. The value must be a
  string.

A statement naming a type the document **never declares** produces no edge: 16 real
statements take that shape (duckdb naming a superclass declared in a sibling file), and
an edge to a symbol the file does not contain is a fabrication.

Confidence is 1.0 for a declared supertype and 0.9 for `implements`, with a
`reasonCode`, because the mapping of LSP's word `mixins` onto the ontology's `implements`
is a **naming decision**, not a parse fact (honesty contract §4 point 1).

### The one exclusion, with the instrument, the probe and the overturn condition

**`instantiates` — RULED. Instrument B, with the shape/role split that makes the
number mean something.** 274 keys spell a constructor (`new`, `init`, `constructor`,
`__init__`, `instantiate`) and **not one denotes an invocation**. Split by the value's
ROLE: 142 string values (proxicall's i18n key `new`, nvim-treesitter's `constructor`),
100 array values (duckdb's serialization schemas, where `"constructor": ["index"]` is
the constructor's **parameter names** — a declaration, which is the opposite of a
construction), 22 object values, 10 scalars. `new <Identifier>` occurs 5,093 times
inside string values, of which **7** have that identifier also declared as a key in the
same file — every example a JavaScript AST dump or a prose message.

So the probe asks the only question that could mean "a construction happened": does a
document that **declares types** — by a `class` string, or by LSP's
`{"kind":"reference","name":X}` literal — contain a constructor-named key whose value is
an **object**, i.e. an instance's state rather than a parameter list? Measured: **0 over
12,543 admitted files**. duckdb declares constructors in exactly the documents that
declare types, and every one of them is an array of parameter names.

A probe that matches a SHAPE rather than a ROLE produces a number, and the number is
worth nothing; that is how the gate's own first `extends` probe convicted `class voice`
inside a telnet IAC word list, and how the naive form of this probe reports the
construct 274 times and means none of it.

**Overturn condition:** ≥1 pair whose key is a constructor name, inside a type-declaring
document, bound to an object. The probe fires the moment a type-declaring document
carries a constructor-named key bound to an object.

The ruling lives in `script/m14/json-ruled.ts` as `export const JSON_RULED`, ready for
one import in the shared arbiter. The copy inside
`script/m14/ontology-coverage-gate.ts` is **stale** and was left unedited because that
file is §8 shared machinery; see the report.

### The failure mode this lane has now produced six times

`imports`, `exports`, `extends`, `calls` and `overrides` were each ruled out by an
audit that searched for the conventions it **already had in mind**. `calls` was
re-tested against the corpus and passed — for `new Foo` invocations and functions
named `new`, which is the *JavaScript* shape of a call. The npm shape was never among
the conventions imagined, and it carries 217 edges. `extends`'s audit searched for
class-declaration conventions and never for schema-composition ones, so it re-ran the
same instrument on the same question and returned the answer it was looking for. The
rule this leaves: an inapplicability ruling is only as strong as the instrument that
could have found the construct, and for a convention-bearing language the instrument
has to be the corpus, read for conventions you did not already have in mind.

`script/m14/ontology-coverage-gate.ts` re-measures every ruling and fails when a ruled
type's construct occurs. On a 12-repository scoped corpus (3,559 admitted files) it
reported **8 emitted / 2 ruled-sound / 0 falsified / 0 ruled-without-justification**,
which is where the pass-1 `implements` ruling came from and where it was wrong.

**On the full population the arbiter does not produce a verdict table at all**, and the
reason is not corpus size. `src/ast/engine.ts:1441` arms a 120-second timer around the
synchronous `parser.parse()` and calls `process.exit(1)` when it fires — `setTimeout`
cannot interrupt synchronous WASM, so killing the process is all that code can do. The
consequence for a whole-corpus sweep is total: one pathological file ends the run before
any tally prints, and every other file is silently unmeasured. Observed on
`clj-kondo/resources/clj_kondo/impl/cache/built_in/java/
java.util.concurrent.CompletableFuture$UniComposeExceptionally.transit.json` — 200 bytes
of **Clojure transit** (`["^ ","~:members",…]`) admitted as JSON purely because the
filename ends `.json`. Whether that admission is correct is a `language-detection.ts`
question and that file is §8 shared machinery, so it is reported rather than edited.

That admission is also **not deterministic**: the same file hung on one run of the
arbiter and parsed on the next, which matches the known `parseFile` nondeterminism
recorded in this repository's history rather than anything in this analyzer. The census
harness therefore runs the same admitted population through the same production
`parseFile` in bounded per-repo children, so a hang costs one repository instead of the
run; on the run quoted here it excluded **0 files** across **138 repositories**, with 0
repositories unmeasured. Had a file been dropped it would be listed in `excludedFiles`
and printed in the header, because a census that quietly drops the file it could not
measure is the "empty result over a non-empty corpus" the workstream calls a failed check.

## Performance

The analyzer is **one iterative walk with a constant-time frame stack**:
**O(nodes)**, with no per-symbol rescan of the symbol list and no O(n²) pass.
Measured on synthetic documents of controlled size and depth, **minimum of 15 runs
each**:

| flat document | size | min time | ms/KB |
| --- | --- | --- | --- |
| 200 keys | 3.3 KB | 74.6 ms | 22.6 (fixed cost dominates) |
| 800 keys | 13.8 KB | 78.9 ms | 5.7 |
| 1,600 keys | 29.1 KB | 172.3 ms | 5.9 |
| 3,200 keys | 60.3 KB | 203.4 ms | 3.4 |
| 6,400 keys | 122.8 KB | 548.7 ms | 4.5 |
| 12,800 keys | 253.3 KB | 986.0 ms | 3.9 |

Depth is linear too: at constant size, depth 5 → 80 runs 5.8 ms → 124.2 ms.

**The variance is the finding.** On *identical* input the spread between the fastest
and slowest of 15 runs is **×2.6 to ×24**. A first pass reported a 7.6× jump between
14 KB and 60 KB and would have been filed as superlinear; re-measurement placed it
inside the noise band, and a second anomaly at 123 KB did the same. So **no
single-sample performance number for this lane is a measurement** — including the
1,043 ms/file that a whole-corpus run reported for the 300 largest files, which the
minimum-of-15 data says is mostly a slow sample. Size and depth were separated
deliberately, so a depth cost could not be mistaken for a size cost.

## Declared limitations

The honesty contract exempts json from a non-empty limitations list on the grounds that
the language has no dynamic semantics. That exemption is **declined here**, because
almost every fact this lane emits is a reading of a CONVENTION rather than of the
format, and conventions are exactly where a static grammar does not reach. What follows
is what the measurements do not settle.

1. **The two implementations walk the same grammar.** The oracle and the analyzer are
   independent in code and share no rule table, key set or resolver — but both are
   readers of `tree-sitter-json`. A misreading of the grammar common to both would be
   invisible to the differential, which is why `probes.ts` measures the CORPUS for the
   construct instead. The three unexplained classes (1,233 edges, §Evidence) are the
   part of the space where the two are known to disagree; the agreement figure is not
   evidence that neither is wrong about the language.
2. **1,233 of 2,130,251 analyzer edges are uncorroborated**, in three classes: 830
   `extends` to an undeclared location, 220 bare `"$ref": "#"`, 183 `contains` for
   array-in-array elements. Each is a definitional disagreement between the analyzer and
   the oracle and **none is adjudicated in this lane**.
3. **`calls` reads a shell command out of a string value.** 217 edges at confidence 0.8,
   the only class in the graph derived by parsing text rather than a tree. A wrapper
   script, a variable callee (`npm run "$TASK"`) or a Makefile-driven pipeline would
   produce no edge, so the count is a floor for the construct and not its extent.
4. **The `overrides` edge cannot name what it overrides.** Both declarations share a
   name and a qualified path, so the prior declaration is carried in `overridesLine`
   and not in an endpoint. A consumer resolving `overrides` by name alone will collapse
   the two rows.
5. **The ambiguity limit is closed, with a measured residual.** It stood at 64.54% of
   endpoints when this section was written, and closing it needed an analyzer-side
   decision that was recorded rather than taken unilaterally. It has now been taken:
   `contains` emits qualified paths. Ambiguous `contains` targets went 32,660 of 66,032
   (49.4%) to **6 of 66,164 (0.009%)** on the same 202 files, self-loops 1,119 to **0**,
   and endpoints equal to the literal `unknown` 51 to **0** across the whole population.
   What remains is 6 targets in 198 files, and `uses` (3 of 19) and `exports` (1 of 1),
   which are name-valued by construction — a dependency's name is its package name.
6. **The census is a whole-population snapshot, not a stable number.** The corpus grew
   from 10,855 admitted files to 11,713 to **12,543** during this wave, because other
   lanes are cloning repositories into the same root. Counts here carry that timestamp
   and are reproducible only against that corpus state.
7. **The lane oracle is not independent evidence for the rules it was written beside.**
   `script/m14/oracles/json.ts` was written **from** the analyzer's rules — including the
   inheritance preconditions and the `contains` endpoint form — so differential agreement
   on those types shows that two implementations agree, not that either is right about
   the language. That is the case honesty contract §5.7 asks to be red-teamed, and this
   paragraph is the red-team note. The independent instruments for those types are
   `inheritance-probe.ts` (counts constructs on the parse tree without consulting the
   analyzer), `incoming-check.ts` (resolves edges against published symbols) and
   `namespace-orphan-probe.ts`; none of them reads the analyzer's rules.
8. **The differential's coverage figure predates the endpoint change** and is quoted
   from the run recorded under Evidence. It was not re-run over the whole population
   after `contains` switched to qualified paths, because the arbiter cannot finish on
   this corpus (§7 in the workstream's correction) — see the report for what was run and
   what was not.

## The structural limit, and closing it

This section previously read: **64.54%** of relationship endpoints are **ambiguous** —
the name they carry is shared by more than one symbol in the same file — and "closing it
needs the analyzer to name an ambiguous endpoint by its path, or to disambiguate
duplicated names after the walk. That is a **decision for the owner**, recorded with its
numbers rather than taken unilaterally."

The numbers are now in [Endpoints are paths, and why](#endpoints-are-paths-and-why), the
decision has been taken, and the outcome measured on both sides:

| | before | after |
| --- | ---: | ---: |
| `contains` targets matching >1 published symbol | 32,660 / 66,032 (49.4%) | 6 / 66,164 (0.009%) |
| `contains` self-loops | 1,119 | 0 |
| endpoints equal to the literal `unknown` (whole population) | 51 | 0 |
| declarations with no incoming edge, by qualified path | not measured | 107 / 65,373 (0.16%) |

The residual 6 are worth naming rather than rounding away. JSON also has a genuine
structural property underneath this: a key is unique only **within its object**, so every
object in a JSON array has the same keys, and 2,077 bare names in the 198-file sample are
shared by more than one published symbol. Qualified paths make the *edge* unambiguous; they
do not make the *name* unique.

## Evidence

### Pass 3 — what fires, and what reaches a declaration

**Whole admitted population — 12,543 files across 138 repositories**, production
`parseFile`, chunked per repository so a parser hang costs one repository
(`validation/m14/fixtures/json/census.ts --chunked`, `--out`):

| | |
| --- | --- |
| admitted files sampled | 12,543 of 12,543 |
| repositories unmeasured | 0 of 138 |
| files excluded for hanging the parser | 0 |
| parse failures | 0 |
| symbols | 3,414,094 — empty name 0, empty kind 0, unknown kind 0 |
| relationships | 3,424,980 |
| endpoints equal to the literal `unknown` | **0** |
| edges below the 0.7 heuristic threshold | **0 of 3,424,980** |
| kind histogram | `property` 2,541,967 · `class` 859,585 · `module` 12,542 |

**Incoming direction — 202 files across 99 repositories**
(`script/m14/incoming-check.ts`, shared §8 instrument):

| type | edges | distinct declarations named | ambiguous | unresolved | self-loops |
| --- | ---: | ---: | ---: | ---: | ---: |
| `contains` | 66,164 | 65,265 | 6 | 0 | 0 |
| `references` | 481 | 149 | 0 | 4 | 0 |
| `extends` | 209 | 50 | 0 | 0 | 0 |
| `implements` | 113 | 4 | 0 | 0 | 0 |
| `uses` | 19 | 18 | 3 | 0 | 0 |
| `exports` | 1 | 1 | 1 | 0 | 0 |
| `calls` | 1 | 1 | 0 | 0 | 0 |

**Namespaces — 198 files** (`validation/m14/fixtures/json/namespace-orphan-probe.ts`):
107 of 65,373 declarations have no incoming edge **by qualified path (0.16%)**; 22
distinct target strings name nothing published, and all 22 are external by inspection
(8 npm packages, 4 sibling schema files, and the rest in the same two shapes).

### Pass 1 and 2 — the differential against an independent oracle

**Whole admitted population at 11,713 files across 106 repositories**, production
`parseFile` on the analyzer side and `deriveJsonEdges` (lane-owned oracle) over a fresh
parse on the truth side (`validation/m14/fixtures/json/differential.ts`). **These
figures predate the `contains` endpoint change and the inheritance emitters; see
limitation 8.**

| | |
| --- | --- |
| truth edges (independent oracle) | 2,129,018 |
| covered | **2,129,018 (100.00%)** |
| MISSING | **0** |
| analyzer edges | 2,130,251 |
| UNEXPLAINED | **1,233 (0.058%)** — three classes, below |
| files with truth edges | 10,458; files emitting any edge 10,459; files matching exactly 10,340 |

The 1,233 unexplained edges are **not** dismissed. They are three classes, each named:

1. **`extends`, 830** — the oracle derives a local-pointer `extends` only when the
   pointer's location is a declared name, and the analyzer falls back to the raw pointer
   when it is not. The two implementations disagree on whether a composition may target
   an undeclared location. Not settled here.
2. **`references`, 220** — a bare `"$ref": "#"`, which resolves to the document root.
   The oracle declines it by design; the analyzer emits it. Both readings are arguable
   and the lane has not adjudicated.
3. **`contains`, 183** — array elements that are themselves **arrays**. The analyzer
   emits `contains` for them; the oracle emits containment only for object elements.
   A definitional disagreement about whether an array contains its array elements.

The oracle also had a defect that this measurement exposed and that has been fixed: it
walked the tree **twice** for a `document`-rooted file, emitting every first-document
edge exactly twice (`contains` truth 122,146 against 61,115 analyzer edges — 50.03%,
with `uses` and `references` at 50.00% each). The shared F5 harness compares edge
**sets**, so the duplication was invisible there and the lane's recorded 100% survived
it; a count-sensitive consumer inherits the halving. Removing the redundant walk moved
files-matching-exactly from 4 of 354 to 354 of 354 on the same sample.

- **Contract probe** — 28/28 (`script/m12/json-contract-probe.ts`, reads production);
  includes the zero-regex check the two new emitters had to preserve
- **Fixtures** — 14, each pinning both directions. `Arrays.json` forbids containment
  for array scalars; `DuplicateKey.json` pins the `overrides` prior line;
  `SameKeyDifferentObjects.json` is its negative control and exists only to catch an
  unscoped duplicate check; `manifest/package.json` pins `calls`, `exports` and the
  five `calls` shapes that are declined.
- **Mutants** — 13 lane-owned (`script/m14/json-mutants.ts`) plus 8 inherited, **21 of 21 caught, 0 survivors**,
  each caught by its intended fixture. `overrides-unscoped-to-file` is the one that
  matters most: it is worth ~5,700 false edges over the corpus.
- **Ontology gate** — the full population produces **no verdict table**: one Clojure-transit
  file admitted as `.json` hangs the parser, and `engine.ts:1443` exits the process before
  any tally prints. The pass-1 scoped run reported 8 emitted / 2 ruled-sound / 0 falsified,
  and its `implements` ruling is the one the corpus overturned. See the ontology section.
- **Differential** — enrolled in F5 with an independent oracle
  (`script/m14/oracles/json.ts`, lane-owned so the shared file is not a fault line).
  Corpora chosen by measurement: `terraform` primary (415 hand-written files, 12
  lockfiles) and `otp` second for its **adversarial** `json_SUITE_data`.
  `clj-kondo` was rejected despite 742 files because 729 are `.transit.json`
  (Clojure, not JSON); `shadcn-svelte` because its 2,369 are mostly
  `package-lock`.
- **Spec** — `script/m14/spec/json-completeness.json`, a written ruling per construct
- **Full record** — `reviews/json/m60-closure.md`, `reviews/json/resolution.md`
