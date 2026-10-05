# real-json-analyzer

Tree-sitter extraction for `*.json`, `*.jsonc` and `*.json5`, verified under the
**M14/M60** json lane wave (record: `reviews/json/m60-closure.md`).

> Rewritten 2026-10-03 from measurement, in the pass-2 adversarial round. The previous
> version said **8 of 10** relationship types were emitted and that `implements` was ruled
> inapplicable. **Both statements were wrong**, and the doc did not know it: the ruling was
> made on a grammar inventory, and a grammar has no node type for a keyword. Nine are
> emitted. Every number below was re-measured; the ones that moved are named as moved.

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
| Symbol identity | a `pair` key is a symbol named by its key. Its **owner is the parent SYMBOL's name**, never its qualified path — a path is a fine identity and a useless endpoint when the endpoint is to be resolved by name. The path lives in `qualifiedName` and in edge metadata. |
| Edge endpoints | **every relationship type emits QUALIFIED PATHS on both ends**, with one declared fallback (`imports`, whose target is another FILE). A bare JSON key is ambiguous by construction — a document repeats `name`, `type`, `items`, `properties` relentlessly — and the shared resolver declines a non-unique bare name, so an ambiguous endpoint does not degrade to a wrong answer, it degrades to **no answer**. Measured on a 202-file, 99-repo sample: **32,660 of 66,032 `contains` edges (49.4%)** named a target matching more than one published symbol, **1,119** were self-loops (source string == target string), and **51 corpus-wide** carried an endpoint equal to the literal `unknown`, because a real JSON key is named `unknown` (proxicall's 38 i18n bundles, redis 6, terraform 3, hasura-engine 1). The path is already computed — it is the symbol's `qualifiedName` — and it matches the resolver exactly. **Four types were still violating this row when the incoming pass measured it**, and all four are fixed: `calls` and the OpenAPI-endpoint `uses` in the second pass, and `overrides` in the third (§*The fourth bare endpoint*). |
| Kinds | an **object** is `class`: it has named children and `contains` edges come from it. Everything else is `property`, **including an array** — the analyzer previously called arrays `variable`, importing a shell-shaped mutable-binding distinction JSON does not have. |
| Arrays | a **leaf of scalars, a container of objects and of arrays**. Scalar elements are positional and unnamed: no symbol, no edge. An object element is a `class` named `<array>[i]`, contained by the array, and **its own keys are owned by the element**. An element identified by an index under a KEYED array keeps the key's name (`allOf[0]`); an element of an array that is itself an element is named from its qualified path (`rows[0][0]`), and it gets a symbol of its own because it owns elements. |
| `line_number` | **every relationship carries a positive site line.** It used to carry none: the string did not occur once in the file, so every json edge in the index was stored with a NULL line while symbols carried `range` throughout. The position was known and simply not published. |
| `$ref` | names a **LOCATION**, not a symbol, so the target is the location. Nothing guarantees the name at a location is unique — two documents in one file can each declare `spec` — while the location is. A JSON Pointer is *relative to the document root*, so `#/components/schemas/X` names `<module>.components.schemas.X`. |
| `imports` | a `$ref` naming **another file** is a dependency and emits both `imports` and `references`. A local pointer and a URL are neither: a URL names a **vocabulary** (a JSON-Schema draft identifier), and 38 of the 50 external refs in the corpus are exactly that. |
| OpenAPI | a `/`-prefixed key whose object declares an HTTP method is an endpoint, and the `paths` object `uses` it at 0.8 with `reasonCode`. |
| Manifests | in a `package.json`/`composer.json`, an entry under `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies` is a `uses`. Keyed on the **filename**, so any JSON with a `dependencies` key does not acquire npm semantics. The edge publishes the entry's **version range**, read from the pair's value node; `unspecified` when the value is not a string, because npm's object alias form and composer's array form have no range and inventing one is the defect this row was written to fix. |
| npm scripts | a `scripts` entry invoking a **sibling** entry by name (`npm run <name>`, and `pnpm`/`yarn`/`bun` with `run`/`run-script`/`run-s`) is a `calls`. Declined and pinned with `forbidRelationships`: a target that is not a key of the same `scripts` object (a binary, or another package's script), a self-reference, a **quoted** target (the shell rewrote the argument), and any token that merely *contains* a runner name — `npx` contains `npm`, and a PATH named `npm` is not a runner. npm's implicit `pre`/`post` lifecycle hooks are also not emitted: npm runs them without the command naming them. |
| **Declared types** | a document that declares types and states their supertypes emits `extends` and `implements` from ordinary object keys. Two shapes occur, and both announce themselves before any key is interpreted: LSP's meta-model uses `{"kind":"reference","name":X}` (2 of 11,713 admitted documents), and duckdb's serialization schemas declare a C++ class with a `class` string (21 documents, all duckdb). Without the precondition the emitter would fire on every JSON file. |
| Documents | a document may hold an object, an array, or **several values** — concatenated JSON is real input (kubernetes' `hack/testdata` holds it) and every top-level value is walked. |
| Duplicate keys | a key declared **twice in one object** is a redefinition — the second replaces the first under every mainstream parser — and emits `overrides` in the **bash lane's** shape: source is the owner symbol, target the key, and `overridesLine` carries the prior line, because both declarations share one name *and* one qualified path and the line is the only thing that distinguishes them. Scoped to the **object**: the same key in two different objects is not a redefinition, and that is the corpus's dominant shape (120,174 occurrences across 7,679 files against 21 genuine duplicates). An **empty** key is declined (10 occurrences, every one a document the grammar recovered with ERROR nodes). |
| Invalid input | errors are engine-owned and surfaced; the module symbol is still emitted so a consumer can attribute the failure to a file. |
| Regex | **zero regex literals in the analyzer**, enforced by `script/m12/json-contract-probe.ts` rather than asserted, and scanned with comments and strings stripped. The analyzer never reads the file as text: every decision comes from the tree. The lane **oracle** is also regex-free and tree-driven — it reads `node.type`, `childForFieldName` and `namedChildren`, and touches `.text` only on a leaf value, which the probe permits explicitly. |

### Where regex still appears in this lane, and why it is not the same defect

The no-regex rule exists because regex over SOURCE TEXT matches comments and string
literals, misses nested syntax, and breaks silently on the next grammar version. That
failure mode needs two things this lane does have — a regex, and analyzed source text to
apply it to. **The analyzer and the oracle have neither pairing.** What remains is regex over
things that are not the analyzed language, and calling it "the same defect" would be a
category error that hides the finding that matters:

| file | what it matches | why it is not source-text analysis |
| --- | --- | --- |
| `census.ts` | `repo.replace(/[^A-Za-z0-9._-]/g, "_")` | sanitising a **repository name** into a temp filename |
| `differential.ts` | `relPath.replace(/\.[^.]+$/, "")` | stripping a **file extension** off a path |
| `json-mutants.ts` | `/^(.*)\[(\d+)\]\[(\d+)\]$/` | reshaping the analyzer's **own output** to manufacture a mutant |
| `parse-determinism.ts` | `"symbols":(-?\d+)` | **removed** — see below |

Three of the four were removed this pass. `parse-determinism.ts` had two: one was a genuine
**no-op** — `.replace(/^.*\//, (m) => m)` replaces the match with itself, so it did nothing
and read as if it were stripping a directory prefix — and the other pulled a number out of a
child process's JSON stdout with a pattern where the line is already known to be a JSON
object, so it now reads the field. A renamed or nested field yields `undefined` instead of
silently matching a **different number that happens to sit after that text**. The three above
remain and are listed rather than quietly left for a reader to assume they were overlooked.

`ruling-table.ts` also carried two `new RegExp` and now carries none; the reasoning is in
§*Ruling table*, and it is a worse instance than the four above because it interpolated a type
name into a pattern source on the branch that decides whether a RULED verdict is justified.

## Relationship ontology — 9 of 10 emitted, 1 ruled, every verdict measured

Whole admitted population through production `parseFile`
(`validation/m14/fixtures/json/census.ts`). **Re-measured 2026-10-04, THIRD pass, same
branch. The corpus moved under the lane again — 182 → 199 repositories and 12,547 → 13,951
admitted files (+1,404, +11.2%) — so every row below is the new population's, and the pass
that produced it is recorded in §*Re-measurement, third pass* rather than asserted here.**

| type | verdict | edges | files | both endpoints resolve | confidence min | reason code |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `contains` | EMITTED | 3,988,554 | 13,444 | 100.00% | 1.0 | — |
| `references` | EMITTED | 17,117 | 272 | 98.59% | 0.8 | `json_schema_ref` / `ref_target_not_declared_in_document` |
| `uses` | EMITTED | 9,955 | 1,041 | 100.00% | 0.8 | `openapi_path_entry_declares_http_method` |
| `extends` | EMITTED | 1,780 | 119 | 99.83% | 1.0 | `json_schema_all_of` / `declared_supertype` |
| `exports` | EMITTED | 1,200 | 446 | 100.00% | 1.0 | — (`evidenceClass: structural`) |
| `calls` | EMITTED | 263 | 99 | 100.00% | 0.8 | `npm_run_sibling_script` |
| `implements` | EMITTED | 113 | 1 | 100.00% | 0.9 | `declared_interface_mixin` |
| `overrides` | EMITTED | 22 | 12 | 100.00% | 1.0 | — (`evidenceClass: structural`) |
| `imports` | EMITTED | 82 | 28 | 0.00% (see below) | 1.0 | — (`evidenceClass: structural`) |
| `instantiates` | RULED | 0 | — | — | — | — |

**The two rarest types held to the digit while the population grew 11.2%.** `implements`
**113 edges / 1 file** and `overrides` **22 edges / 12 files** are unchanged from the
12,547-file state, and `instantiates` is still 0. The corpus added 1,404 admitted files and
not one of them carries a duplicate key or an LSP `mixins` declaration. That is worth more
than the growth itself: a rare type's count is the figure most likely to be an artefact of
the sample, and here a population increase of eleven per cent left three of them untouched.

**Coverage is reported as APPLICABLE, never as a flat 10: 9 applicable of 9
(9 emitted, 1 measured-absent).** The denominator shrank by exactly one and only through a
RULED verdict carrying a corpus measurement — `instantiates`, instrument B, **0 hits over
14,095 admitted files across 155 repositories** (it was 12,663 / 141 at the previous state,
so the ruling now rests on 1,432 more files than the table above counts). Numerator and
denominator come from different instruments: the 9 emitted from the census and the firing
arbiter, the absent one from the ruling recheck over a strictly larger population.

`imports` resolving at 0% is **correct, not a defect**: an `imports` target names
another FILE (`v0.0.1/dsse_v0_0_1_schema.json`), and a file in another file is not a
symbol in this one. All 82 have a resolvable source. It is the one type whose endpoint
is deliberately not a symbol.

**Edges below the 0.7 heuristic threshold: 0 of 4,019,086.** Sub-1.0 edges are
`calls` (263, all 0.8), the 257 `references` whose target did not resolve (0.8), and
the OpenAPI-endpoint `uses`. Every one of them carries a machine-readable
`reasonCode`, which honesty contract §4 point 1 requires and which the previous
version of this analyzer did **not** provide — 453 `uses` and 16 `references` edges
sat below 1.0 with neither a `reasonCode` nor an `evidenceClass`, measured on a
2,343-file stride sample. That is fixed; `contains` and the dependency `uses` still carry no
`evidenceClass`, deliberately: both are at confidence 1.0, and §4 binds sub-1.0 edges, so
adding a string to 3.9M edges would be payload without evidence behind it. The census
prints the split per type so the absence is a number and not an omission.

**0 endpoints carry the literal text `unknown`** — down from 51, and not because the
keys stopped existing: a JSON symbol name is an object key, and `unknown` is an
ordinary word for one (proxicall declares it in 38 i18n message files, redis 6,
terraform 3, hasura-engine 1). They disappeared because `contains` endpoints became
qualified paths, so a key named `unknown` is now `proxicall.website.src.messages.ar.unknown`
and is no longer indistinguishable from the placeholder. The measurement is in
`validation/m14/fixtures/json/unknown-endpoints.ts` and in the census.

### Re-measurement, second pass on the same branch (2026-10-04)

Every instrument in this document was re-run rather than carried forward, because a number
nobody re-ran is a number nobody checked. The corpus is shared and other lanes clone into
it, so the population moved and the figures have to move with it.

**What reproduced, to the digit.** `calls` 217, `uses` 5,758, `imports` 67, `references`
15,017, `exports` 513, `extends` 1,721, `implements` 113, `overrides` 22,
`instantiates` 0. The differential's `220 UNEXPLAINED` and its single file. The
`instantiates` ruling at **12,663 files / 141 repositories, 0 hits, 0 parse throws**. The
verdict table at **emitted 9 / ruled-sound 1 / FALSIFIED 0 / without-justification 0**.
Fixtures **14/14**. Lane mutants **17/17 caught, 0 survivors**; 25 registered for this lane
across the shared and lane registries, **25 caught, 0 survivors**. Contract probe **28/28**.
`calls` ambiguous incoming targets **0**.

(The mutant counts here are the **post-`overrides` figures** and supersede the 16/24 this
pass originally recorded: the third pass added `json/overrides-endpoints-are-bare-names`,
so the lane file went 16 → 17 and the lane's registration across both registries 24 → 25.
All other rows in this paragraph reproduced to the digit and are the second pass's.)

**What moved, and why.** `contains` 3,881,840 → **3,882,272** (+432) and the admitted
population 12,543 → **12,547** (+4 files): the corpus grew from 171 to 182 repositories and
13,187 → 13,191 tracked json-extension files, and the 4 new admitted files carry only
`contains`. Symbols 3,894,382 → **3,894,818**. The firing arbiter read **9/10 and
5,172,776 edges** against 5,172,561 before, on 12,478 of 13,000 sampled files with **66
degraded** — a degraded parse falls back to the regex extractor and returns FEWER edges with
no error, so that count is a floor for the sample and not its extent.

**What this pass found and fixed.** One, and it was in a measuring instrument rather than
in the analyzer: the incoming probe classified `extends -> dataTypeBase.json#` as a defect
when the analyzer had already published `refForm: "sibling_file"` on that edge. See
§*EXTERNAL vs NEVER-INDEXED*. Two instruments also stopped being reproducible and were
repaired so the two claims above can be re-run at all — see §*Ruling table* and
§*Declared limitations* 9.

### Re-measurement, third pass (2026-10-04, later the same day)

Run to settle the `overrides` endpoint change, and it landed on a corpus that had moved
again: **199 repositories** (was 182), **14,624 tracked** json-extension files (was 13,191),
**13,951 admitted** (was 12,547). Six instruments re-run rather than carried forward.

**The rare types reproduced to the digit under an 11.2% larger population.** `implements`
113 edges / 1 file, `overrides` 22 edges / 12 files, `instantiates` 0 — all unchanged. The
`overrides` endpoint probe reproduced **every** figure in §*The fourth bare endpoint*:
22 of 22 targets qualified paths, 22 of 22 ambiguous by bare name (**85** bindings, mean
3.86) against 22 of 22 by path (**83**, mean 3.77), source ambiguity **2 of 22 → 0 of 22**,
collision-set sizes **2, 3, 5 and 7**, and the narrowing on exactly **1** edge —
`FSharp.Data/…/DictionaryInference.json`, bare `rec2 -> 1`, bare 4 → path 2. Every one of
those numbers is independent of how many files the corpus holds, which is exactly what makes
them worth re-running.

**What moved, and only because the corpus did.** `contains` 3,882,272 → **3,988,554**,
`uses` 5,758 → **9,955**, `references` 15,017 → **17,117**, `exports` 513 → **1,200** (more
than doubled, on new manifests), `extends` 1,721 → **1,780**, `calls` 217 → **263**,
`imports` 67 → **82**. Symbols 3,894,818 → **4,002,504**; relationships 3,905,700 →
**4,019,086**; files with an edge 13,444.

**The invariants held, which is the point of re-running them.**

| invariant | previous | this pass |
| --- | ---: | ---: |
| parse failures | 0 | **0** |
| symbols with an empty name | 0 | **0** |
| symbols with an empty or unknown kind | 0 | **0** |
| endpoints equal to the literal `unknown` | 0 | **0** |
| edges below 0.7 | 0 | **0 of 4,019,086** |

**What this pass FOUND, and it was in the oracle and not in the analyzer.** The
whole-population differential reported **1 UNEXPLAINED `uses`** — a class this document
records as 0 across two passes:

```
gql-graphql-mesh/packages/loaders/openapi/tests/fixtures/blockfrost.json
  uses|blockfrost.paths|blockfrost.paths./
```

The lane oracle guarded its endpoint test with `key.length > 1`, which excludes `/`. The
analyzer's own predicate carries no length floor, so **the analyzer was right and the
oracle was wrong**: OpenAPI 3.0 requires a path name to *begin* with `/`, `/` does, and
blockfrost declares a `get` on it. The guard was unjustified rather than a stricter
reading. Fixed in `script/m14/oracles/json.ts`, which is lane-owned; measured on that file
in one process, analyzer `uses` 98 and oracle `uses` 98, UNEXPLAINED **1 → 0**, MISSING 0,
root-path edge present on both sides. Re-run over the whole population:

| label | truth | analyzer | covered | MISSING | UNEXPLAINED |
| --- | ---: | ---: | ---: | ---: | ---: |
| `uses` | **9,955** | 9,955 | **100.00%** | 0 | **0** (was 1) |
| `contains` | 3,988,554 | 3,988,554 | 100.00% | 0 | 0 |
| `references` | 16,860 | 17,117 | 100.00% | 0 | 257 |
| `extends` | 1,780 | 1,780 | 100.00% | 0 | 0 |
| `exports` | 1,200 | 1,200 | 100.00% | 0 | 0 |
| `calls` | 263 | 263 | 100.00% | 0 | 0 |
| `implements` | 113 | 113 | 100.00% | 0 | 0 |
| `imports` | 82 | 82 | 100.00% | 0 | 0 |
| `overrides` | 22 | 22 | 100.00% | 0 | 0 |
| **TOTAL** | **4,018,829** | **4,019,086** | **100.00%** | **0** | **257** |

**0 MISSING and 257 UNEXPLAINED, all 257 the one known `"$ref": "#"` class** in
`docker/vendor/github.com/go-openapi/spec/schemas/jsonschema-draft-04.json` — the same single
file as before, now 257 edges rather than 220. Files matching exactly 13,396 → **13,397**,
the one file being blockfrost.

That is the **fifth** place on this lane where the two implementations disagreed and the
corpus adjudicated, and the **fourth** where the oracle was the wrong side —
`contains` array-in-array (a bug both had), the oracle's `allOf` walk order, `contains`
bare endpoints, `calls` and OpenAPI `uses` bare endpoints, and now the OpenAPI root path.

**New fixture `OpenApiRootPath.json`, 14 → 15 passing**, pinning the case in both
directions: `/` earns `uses`, `/health` is the control that was already covered, and
`/docs` is a `/`-prefixed key declaring **no** HTTP method, so `forbidRelationships` asserts
it earns `contains` and no `uses`. The negative control is what makes the pin mean
something — a fixture asserting only the positive cannot tell the rule from one that fires
on every `/`-prefixed key. And because it pins the **analyzer's** handling of `/`, a future
change that added a length floor to the analyzer — "fixing" it to match the oracle this pass
found wrong — now fails a fixture instead of passing unnoticed.

**The other four instruments at this population.** The firing arbiter at the whole
population: **9/10 fired, 4,686,339 edges over 12,478 of 13,000 sampled files, 61 degraded**
— the shared instrument and the census agreeing on 9 from two directions. The ruling
recheck: **0 hits over 14,095 admitted files across 155 repositories, 0 parse throws**, so
the `instantiates` ruling rests on 1,432 more files than the table above counts. The
namespace-orphan probe, re-run over a **514-file, 154-repository** deterministic spread,
space-free paths only: 155,770 symbols, 156,261 edges, **0 parse failures**, orphan by
qualified path **269 of 149,267 = 0.18%**, and **0 `DEFECT-in-document-target`** across 487
adjudicated unresolved edges in 4 verdicts (403 `external-package`, 54
`document-does-not-declare-it`, 23 `external-entry-point`, 7 `external-file`) with **0
`UNCLASSIFIED`**. That probe's first invocation in this pass was passed **no file arguments**
and read 0 files; it is recorded here as the void run it was, not as a pass.

### Re-measurement, fourth pass (2026-10-05) — a naming defect, and two instruments that could not see it

The third pass measured the census. This pass found and fixed a defect the census could not
have found, and the finding worth keeping is not the defect — it is **which instruments were
blind to it**.

**The defect.** The module-prefix strip was a fixed `slice(rootName.length + 1)`, which
assumes the character at `rootName.length` is the **dot** separating a module from its first
key. In a document whose **top level is an array** there is no key to name it — the module is
the only thing that can — so that character is `[`, and the `+ 1` ate it:

    TopLevelArray[0].tags[0]   ->   name `0].tags[0]`

A `]` with no `[` before it is a family **no other case produces**: the keyed form
(`Statement[0]`) carries its own `[i]`, and the element form (`rows[0][0]`) carries the
enclosing `[...]` it descends from. That is what separates the bug from the correct spellings
that also end in `]`, and it is why the predicate is derived from the **qualified path** and
not from the name's shape. Two earlier predicates were wrong and are recorded in the probe
rather than discarded: a shape test on the name reported 3,411 hits that were every one the
correct keyed form, and "name = path minus module prefix" reported 132,180 deviations and 0
conforming names, because object members are named by their KEY at every depth.

**The measurement** (`top-level-array-selection.ts` then `top-level-array-name-probe.ts`,
production `parseFile`; sample = every 5th of the 2,569 admitted documents whose top level is
an array, 514 files):

| spelling | before | after |
| --- | ---: | ---: |
| `TRUNCATED-HEAD` (`3]`, `4][2][6]`) | **17,803** (215 files) | **0** |
| `BRACKET-FORM` (`[4][2][6]`) | 0 | **17,803** |
| `MODULE-PREFIXED` (`pass0[1]`) | 9,692 | 9,692 |
| `KEYED` (`Statement[0]`) | 2,340 | 2,340 |
| `OTHER` (object members named by key) | 90,629 | 90,629 |

Population 120,464 symbols over 443 files; total symbols in the sample 120,975, **identical
on both sides**. 14.8% of the population. The move is exact — 17,803 in, 17,803 out, zero
names created or destroyed.

**Where the 17,803 sat.** A controlled A/B on one file list, patching the sites one at a
time: `arrayItemName` accounted for **63** and `addArrayElementSymbol` for the remaining
**17,740**. The 63 is confirmed independently rather than asserted — under the half-applied
fix, `BRACKET-FORM` appeared with **exactly 63** while `TRUNCATED-HEAD` fell by exactly 63.
The earlier commit named both sites as the cause and had fixed only one; had the second not
been found, the fix would have removed 0.35% of the defect and read as a success. The strip
now lives in **one** place, and `pathDepth` calls it rather than repeating the arithmetic —
it had the same bug, cost nothing (`4][2][6]` and `[4][2][6]` both split to one segment),
and survived a fix to the rule beside it. Two copies of one derivation is a second chance to
be wrong for free.

**Measured to be SPELLING-ONLY.** Every graph-observable property is byte-identical on both
sides of the fix, over the same 514 files (`array-owner-probe.ts`):

| property | before | after |
| --- | ---: | ---: |
| `contains` edges | 120,464 | 120,464 |
| resolved at both ends (by qualified path) | 120,464 (100%) | 120,464 (100%) |
| unresolved | 0 | 0 |
| containment sound (source path a proper prefix of target path) | 120,464 | 120,464 |
| declared-owner agreement, of the 85,670 whose `ownerName` is unique | 85,670 (100%) | 85,670 (100%) |
| `extends` edges / resolved | 76 / 76 | 76 / 76 |

**And the lane's own differential is byte-identical too**: 363,344 `contains`, 100% covered,
**0 unexplained**, 1 `overrides`, before and after. This is the finding. `deriveJsonEdges`
derives endpoints from qualified **paths**, and the defect lived in the symbol **name**, so
the oracle is **structurally blind** to it — a 100% agreement that carries no information
about the thing that was broken. This is the same shape as the markdown lane's
`emitInlineUses`: two walkers agreeing is evidence they agree, not that either is right.
Resolution could not see it either, because the malformed namespace was internally
self-consistent — every edge still resolved *inside* the malformed names, which is exactly
why it was cheap to miss and is not a reason to leave it. **Only a probe that derives its
population from the qualified path sees this class of defect.**

**A separate, pre-existing defect, measured and NOT fixed here.** Decomposing children by
whether their declared `ownerName` binds in the file: **85,670 unique (and 85,670 of those
agree with the edge's source, 100%)**, **32,128 colliding**, and **2,666 naming an owner the
file never publishes** — `[0].tags`, where the keyed array `tags` is published under its
qualified path but under the bare name `tags`, so the element's declared owner matches
nothing. The `contains` **edge still resolves**, because it is emitted against the path, so
the graph walks correctly while this **metadata** does not bind. These counts are identical
on both sides of the fix, so the fix neither caused nor cured it. `TopLevelArray.json`
asserts the behaviour and the defect is written into the expectation's `authoredFrom` rather
than left for a reader to discover.

**Gate runs this pass.** `tsc --noEmit` clean. `bun run script/m14/run-fixtures.ts --lang
json` **16/16** (was 15; the new fixture is `TopLevelArray`). `bun run
validation/m14/fixtures/json/mutants.ts` **18/18 caught, 0 survivors** — the new
`json/top-level-array-name-truncates-bracket` is caught by `json/TopLevelArray`, whose three
`forbidSymbols` name the old `0].tags*` spellings, so reverting the fix **fails a fixture**
rather than passing quietly. The mutant's predicate is `name.startsWith("[")`, which is sound
rather than convenient: after the fix a name begins with `[` **iff** `afterModuleImpl` took
its bracket branch, so it transforms exactly the affected population and nothing else.
`npx tsx script/m12/verify-regex-census.ts` **PASSED** — 5 entries, 0 missing, 0 stale, 0
unclassified, 0 mislocated; the analyzer remains regex-free.

**The shared arbiter cannot finish a json sweep, and the reason is not this lane.**
`npx tsx script/m14/ontology-coverage-gate.ts json` and the lane's own
`ruling-table.ts` both exit on `[BB-HANG] parser stuck 120s` **before printing any verdict**,
on a **different file each run** — `hasura-engine/.../now.json` in one, `docker/vendor/.../
dsse_schema.json` in the other — each preceded by `[BB-PARSE-ERR] memory access out of
bounds`. `src/ast/engine.ts:1442` installs a 120 s timer that calls `process.exit(1)` because
`parser.parse()` is synchronous WASM and cannot be interrupted, so **one** pathological file
terminates the whole sweep and the arbiter reports nothing at all. That is a shared-machinery
defect (§8), not a lane failure: it is nondeterministic, it lands on files unrelated to this
analyzer, and the lane's `differential.ts`, `firing-check.ts` and both probes all run to the
end because they are per-file and per-process. The firing arbiter at 120 files: **7/10 fired,
40,159 edges over 116 of 120 files, 0 degraded** — `implements`, `overrides` and
`instantiates` read 0 at that sample size and are the three the census finds at 113 / 22 / 0
over the whole population, so a 120-file sample is simply too small for this lane's rarest
types. That gap is a property of the sample, not evidence against the census.

**A limitation on the instrument, not the analyzer.** Three "admitted file" counts for the
same corpus disagree and this pass did not resolve why: `top-level-array-selection.ts` reports
**13,884**, an independent walk of the same rules reports **13,851** (13,851 matched, 25 over
5 MB, 110 containing a space), and the lane census reports **13,951**. The probe's internal
ratio is unaffected — 17,803 of 120,464 is self-consistent within one instrument, and the
A/B ran on a fixed file list — but **a ratio computed between this probe and the census above
should not be quoted** until the three walks are reconciled. Recorded rather than papered
over.

### What each type means in JSON

- **`contains`** — the object a key is written in contains that key. The only relation
  the *format* defines; 99.24% of the lane's graph (3,988,554 of 4,019,086 edges).
- **`references`** — a `$ref` names a **location**, not a symbol, so the target is the
  location. A JSON Pointer is relative to the document root, so
  `#/components/schemas/X` names `<module>.components.schemas.X`.
- **`imports`** — a `$ref` naming **another file** is a file dependency and emits both
  `imports` and `references`. A local pointer and a URL are neither: a URL names a
  **vocabulary**.
- **`uses`** — an OpenAPI `paths` object uses the endpoint it declares, and a manifest
  uses each entry under `dependencies` / `devDependencies` / `peerDependencies` /
  `optionalDependencies`. Two emission sites, measured: 453 OpenAPI endpoints and 1,038
  dependency entries on a 2,343-file stride sample.
- **`extends`** — two sources, and both mean a superset relation.
  1. **JSON Schema composition.** `allOf` means "must satisfy all of these". `anyOf` and
     `oneOf` are **alternatives** and `not` is a negation; none has an ontology type, so
     they contribute only the `references` their `$ref`s already produce. Corpus:
     `allOf` 1,445 occurrences / 84 files, `oneOf` 1,021 / 171, `anyOf` 573 / 58,
     `not` 206 / 125 — the shape the reading predicts.
  2. **A declared supertype.** `lsp_meta_model.json` states 97 of them as
     `"extends": [{"kind":"reference","name":X}]`; duckdb's schemas state ~200 as
     `"base": "<ClassName>"` beside a `"class"` declaration.
- **`implements`** — a declared **interface** relation, and the type this lane shipped
  wrong. See below.
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

### `implements` was ruled on the wrong question, and the corpus said so

Pass 1 recorded `implements` as inapplicable, and `script/m14/ontology-coverage-gate.ts`
confirmed it: *"the grammar produced 20 distinct node types across the corpus and NONE
expresses it."* The ruling was a **grammar inventory**, and a grammar has no node type
for a **keyword** — the same unsound question this lane has now had to retract six times
(`imports`, `exports`, `extends`, `calls`, `overrides`, `implements`).

Two documents in the admitted population declare types and state their supertypes, both
as ordinary object keys:

```
dart-sdk/third_party/pkg/language_server_protocol/lsp_meta_model.json
  387 structures. 66 carry
    "extends": [{"kind": "reference", "name": "TextDocumentPositionParams"}]
  and 87 carry
    "mixins":  [{"kind": "reference", "name": "WorkDoneProgressParams"}, …]

duckdb/src/include/duckdb/storage/serialization/constraint.json
  { "class": "NotNullConstraint", "base": "Constraint", "constructor": ["index"] }
```

`lsp_meta_model.json` is the Language Server Protocol's own serialisation of its type
declarations. `extends` there means what `extends` means in a class declaration.
**`mixins` names the TypeScript INTERFACES a class mixes in**, which is `implements` and
nothing else: in TypeScript an interface carries no implementation, so there is nothing
else for the word to mean. Measured corpus-wide by
`validation/m14/fixtures/json/inheritance-probe.ts`: **113 `implements` statements in 1
file, every target declared in the same document**, plus 97 `extends` in the same shape
and ~200 duckdb superclasses.

**The gate could not have caught this.** Its `implements` row was on instrument A, and
instrument A returns RULED-SOUND for any keyword-shaped construct whether or not it
exists. The replacement table is `script/m14/json-ruled.ts`, both surviving entries on
instrument B, and §*Ruling table* below records the wiring the supervisor owes.

### The exclusion, with the instrument, the probe and the overturn condition

**`instantiates` — RULED. Instrument B, with the shape/role split that makes the
number mean something.** 274 keys spell a constructor (`new`, `init`, `constructor`,
`__init__`, `instantiate`, `create`, `factory`) and **not one denotes an invocation**.
Split by the value's ROLE: **142 string values** (proxicall's i18n key `new`,
nvim-treesitter's `constructor`), **100 array values** (duckdb's serialization schemas,
where `"constructor": ["index"]` is the constructor's **parameter names** — a
DECLARATION, which is the opposite of a construction), **22 object values** (a swagger
`init` parameter schema, a svelte parser fixture), **10 scalars**. `new <Identifier>`
occurs **5,093 times inside string values**, of which **7** have that identifier also
declared as a key in the same file — every example a JavaScript AST dump or a prose
message. A probe that matches a SHAPE rather than a ROLE produces a number, and the
number is worth nothing; that is how the gate's own first `extends` probe convicted
`class voice` inside a telnet IAC word list.

**Probe:** a `pair` whose key names a constructor and whose value is an OBJECT, inside a
document that declares types (a `class` string, or a `{"kind":"reference"}` literal).
**Measured: 0 occurrences over 12,659 admitted files** —
`validation/m14/fixtures/json/ruling-table.ts`, re-measured at the current corpus state by
`validation/m14/fixtures/json/ruling-recheck.ts`, which imports the table from
`script/m14/json-ruled.ts` rather than restating the rule, so it cannot audit a different
probe than the one the gate will read.

The population moved, so the ruling was re-measured rather than carried forward: pass 1
measured 0 over 11,713 admitted files and the corpus is now larger. **12,659 is a superset of
the census's 12,543** — the census declines files over 512 KB and the recheck does not, which
is 116 files, 66 of them over 1 MB (§limitation 11). The ruling therefore holds over strictly
more input than any count quoted elsewhere in this document.

**Overturn condition:** ≥1 such pair. The probe fires the moment a type-declaring
document carries a constructor-named key bound to an object. That is the whole ruling,
and it is a number rather than a sentence.

### The failure mode this lane produced seven times

`imports`, `exports`, `extends`, `calls`, `overrides` and `implements` were each ruled
out by an audit that searched for the conventions it **already had in mind**, and each
was later found in the corpus carrying edges. `calls` was re-tested against the corpus
and passed — for `new Foo` invocations and functions named `new`, which is the
*JavaScript* shape of a call. The npm shape was never among the conventions imagined,
and it carries 217 edges. `extends`'s audit searched for class-declaration conventions
and never for schema-composition ones. `implements`'s audit searched the GRAMMAR, which
by construction cannot hold a keyword, and therefore returned the answer it was looking
for. The rule this leaves: **an inapplicability ruling is only as strong as the
instrument that could have found the construct**, and for a convention-bearing language
the instrument has to be the corpus, read for conventions you did not already have in
mind.

### Ruling table

`script/m14/json-ruled.ts` exports `JSON_RULED` with **one** entry (`instantiates`, on
instrument B). The copy inside `script/m14/ontology-coverage-gate.ts` is **stale and
should be replaced by it**: it carries five entries, three of them (`calls`, `imports`,
`overrides`) for types this lane now emits, so the gate short-circuits them and they are
inert — and its `imports` entry carries a `countOnTree` the gate *runs* over the whole
corpus and then never reads. Its two live entries are on instrument A, which is the
instrument that passed the `implements` ruling the corpus overturned. Wiring the
replacement is one import and one map entry:

```ts
import { JSON_RULED } from "./json-ruled"
const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED }
```

`ontology-coverage-gate.ts` is shared machinery and this lane does not edit it.
`validation/m14/fixtures/json/ruling-table.ts` runs the replacement table through the
gate's own verdict logic:

```
emitted 9/10   ruled-sound 1   FALSIFIED 0   ruled-without-justification 0
grammar node types observed across the corpus: 20
```

**This harness stopped being reproducible, and the reason was the trap in §limitation 9.**
It walks the population **in-process**, and over all 12,547 admitted files it died at an
arbitrary file on three separate runs — a different file each time — after printing its
header and **without printing the verdict table**, which is the only thing it exists to
print. A verdict table that cannot be reproduced is not evidence, so the corpus is now
scopeable and **the scope is printed with the result**, so no number from it can be quoted
without its denominator. The corpus named for the run above is `dart-sdk`, `duckdb`,
`openapi-spec`, `hasura-engine` — **1,973 admitted files** (1,952 at the earlier corpus
state):

```
npx tsx validation/m14/fixtures/json/ruling-table.ts \
  --repos dart-sdk,duckdb,openapi-spec,hasura-engine
```

The two harnesses are not redundant and neither replaces the other. `ruling-recheck.ts`
answers the same ruling question over the **whole** population — 12,663 files, no size cap,
a discard-poisoned-slot parser so it terminates where the single-process walk does not — and
does terminate, at **0 hits**. `ruling-table.ts` is the one that runs the shared gate's
four-status verdict logic, which the recheck does not implement. The ruling rests on the
larger measurement; the verdict table is what shows the gate would not falsify it.

**Two `new RegExp` were removed from `rulingFor`,** the function that decides whether a
RULED verdict is *justified*. The old pattern interpolated the type name into a pattern
source, so a type name carrying regex metacharacters would have compiled to a different
pattern or thrown — and the failure would have landed on the justification decision itself.
It is now a code-point word-splitter plus a substring test, and it still resolves the
written ruling to `script/m14/spec/json-completeness.json#BD-ontology`, so `RULED-SOUND`
survives the change.

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

**One pathological file dominates, and it is not this lane's cost.**
`otp/lib/stdlib/test/json_SUITE_data/n_structure_open_array_object.json` is 250 KB of
**50,000 unclosed `[`** — the grammar recovers it as an `ERROR` root with 200,000
children, and the analyzer takes **249 s on the pre-pass-2 code** to say so. It exceeds
the engine's 30 s per-file budget on every run, so the file is excluded from the
chunked census and listed there. Two consequences are declared rather than hidden:

1. Every extra **full-tree** walk over that shape costs ~100 s, because
   `namedChild(i)` is not O(1) in this binding. Pass 2 added one such walk to read two
   document-level markers; it was folded into the pass that already visits every pair,
   which took the file from 347 s back to its baseline shape. **Anyone adding a
   pre-pass to this analyzer should measure this file, not a synthetic one.**
2. The 30 s budget means the file never reaches the analyzer at all in a full run, so
   **12,542 of 12,543 admitted files** contribute symbols. The census states which file
   it dropped and why.

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
   construct instead. The agreement figure is not evidence that neither is wrong about
   the language.
2. **The lane oracle is not independent evidence for the rules it was written beside.**
   `script/m14/oracles/json.ts` was written **from** the analyzer's rules — including the
   inheritance preconditions and the `contains` endpoint form — so differential agreement
   on those types shows that two implementations agree, not that either is right about
   the language. That is the case honesty contract §5.7 asks to be red-teamed, and this
   paragraph is the red-team note. The independent instruments are
   `inheritance-probe.ts` (counts the constructs on the parse tree without consulting the
   analyzer) and `namespace-orphan-probe.ts`; neither reads the analyzer's rules. Two
   defects this lane fixed — the array-in-array element name and the oracle's walk-order
   bug in `allOf` resolution — were each found by the CORPUS and not by the differential,
   and one of them was a bug BOTH implementations had.
3. **The inheritance edges are the weakest thing this lane emits, and the reason is
   structural, not incidental.** `implements` maps LSP's word `mixins` onto the
   ontology's `implements`. That is a **naming** decision, not a parse fact, which is
   why it is 0.9 with `reasonCode: declared_interface_mixin` rather than 1.0. A reader
   who rejects the mapping should reject the 113 edges with it; there is no second
   reading of `mixins` in the corpus to fall back on, and that is a single-corpus
   result.
4. **Inheritance endpoints do not bind by bare name.** `extends` and `implements`
   endpoints are qualified paths, so a consumer that resolves by name alone binds them to
   nothing. Measured before the source was retargeted: **114 of 114** `extends` edges on
   a 2,343-file stride sample bound by neither bare name, against 100% for `contains`,
   `uses`, `calls`, `exports` and `overrides`. The retarget moved the SOURCE from the
   `allOf` array to the schema object that composes, which is the semantically right
   endpoint, but the endpoint is still a path. Closing this needs a decision about
   whether the store should index qualified names — a store-side change, and §8.
5. **`calls` reads a shell command out of a string value.** 217 edges at confidence 0.8,
   the only class in the graph derived by parsing text rather than a tree. A wrapper
   script, a variable callee (`npm run "$TASK"`) or a Makefile-driven pipeline would
   produce no edge, so the count is a floor for the construct and not its extent.
6. **The `overrides` edge cannot name what it overrides.** Both declarations share a
   name and a qualified path, so the prior declaration is carried in `overridesLine`
   and not in an endpoint. A consumer resolving `overrides` by name alone will collapse
   the two rows.
7. **Config inheritance is not emitted.** `"extends": "./tsconfig.base.json"` in a
   `tsconfig` is a real superset relation and it is **not read**: 48 `extends` keys with
   a string value across the corpus, of which **36 name a document that exists beside
   the file** (filesystem-verified, `adversarial.ts` PROBE 1). It is declined for a
   stated reason — a config file's inheritance of another config file is a dependency
   between FILES, which `imports` already carries, and typing it as `extends` would put
   a file relationship in a type relationship — but that reason is a judgement, not a
   measurement, and 36 occurrences are the size of the disagreement.
8. **One `references` class is unadjudicated.** A `$ref` naming another FILE emits both
   `imports` and `references`; the oracle derives the `imports` and declines the
   `references`. 65 unexplained edges on a 1,952-file corpus, every one a sibling-file
   `$ref`. Both readings are arguable and this lane has not adjudicated.
9. **The parser traps, and the trap is a property of the RUN rather than of any file.**
   Whole-population walks of this lane die with `[BB-PARSE-ERR] … memory access out of
   bounds` followed by `[BB-HANG] parser stuck 120s … — exiting`, which is the engine's
   hardcoded watchdog around a synchronous WASM parse. **Four harnesses read the same
   12,543 admitted files and disagreed about whether it happens**: `census.ts` and
   `differential.ts` report parse failures **0**, `trap-scan.ts` reports trapping files
   **0**, and `ruling-table.ts` traps and then hangs.

   That disagreement was settled by measurement rather than by picking the harness that
   finished. `validation/m14/fixtures/json/parse-determinism.ts` takes the **8 files the
   production path named as trapping** and parses each **5 times in its own child process**,
   so a trap in one run cannot affect another: **40 parses, 0 traps, and every one of the 8
   also parses under `JSON.parse`.** `rc.json` is in that set and is 545 bytes. So the trap
   is not malformedness, it is not reproducible per file, and no validity filter can exclude
   it — it appears under sustained in-process load, when a poisoned WASM instance is reused.

   The consequence for this lane's numbers is that **a whole-population in-process walk is
   not reproducible and a chunked one is**, which is why the census and the differential run
   per-repo children and why they are the two instruments quoted here. It also means the
   gate's exit code does not mean what it looks like: a scoped run can print a passing
   verdict table and still `exit 1`, because the watchdog fires after the table. Read the
   table, not the code. The defect lives in `src/ast/pool-worker.ts` / the engine, which are
   shared, so it is reported rather than fixed.
   **Re-confirmed at the 2026-10-04 pass, and it now stops two harnesses before they print.**
   `script/m14/ontology-coverage-gate.ts json --files 300` names **6** files as trapping
   (`clj-kondo/…/clojure.set.transit.json`, `gh-cli/…/sigstore-js-2.1.0-bundle-v0.1.json`,
   `hasura-engine/…/pre_ndc_request/send_header/metadata.json`,
   `kubernetes/…/HEAD/core.v1.PodTemplate.json`,
   `kubernetes/…/v1.36.0/admissionregistration.k8s.io.v1beta1.MutatingWebhookConfiguration.json`
   and one more) and then `exit 1` **with no verdict table at all**; so does `ruling-table.ts`,
   on a different file. The gate also **ignores `--files`** and reports
   `corpus: 12547 admitted files`, so there is no scoped invocation to fall back on.
   `parse-determinism.ts` re-checked its named files in isolated child processes: **55 parses
   over 11 files, 0 traps, 0 nondeterministic, 0 timeouts**, and 10 of the 11 also parse under
   `JSON.parse` (the 11th is the 250 KB unclosed-bracket file named in §*Performance*, which
   fails `JSON.parse` and is the documented per-file timeout). The trap is still a property of
   the run and not of any file, and the consequence for a lane is now sharper than "read the
   table": **the shared arbiter cannot produce a verdict table for this language at all**,
   which is why every verdict in this document comes from a chunked harness instead.

10. **The census is a whole-population snapshot, not a stable number.** The corpus is
    shared and other lanes clone into it: this lane's admitted population moved from
    **11,713 files / 106 repositories** at pass 1 to **12,543 files** by 2026-10-03, and
    `contains` from 2,107,562 to 3,881,840 edges. Numbers here carry that timestamp.
    **Two pass-1 figures did not reproduce and are corrected above**: the repository count
    (106 → 114 at the 11,713-file state, 12,543 files after), and the supertype-key
    census, which reported "only three occur at all" when `parent` (293 occurrences / 17
    files), `mixins` (88 / 2) and `interface` (1 / 1) also occur. Every EDGE count in the
pass-1 table reproduced to the digit at the pass-1 corpus state, and the whole
     12,543-file census reproduced to the digit on re-run for this pass **and again across
     this pass's endpoint-form and metadata changes**.
     **The 2026-10-04 pass moved the corpus again and the admitted population did NOT
     follow**: the corpus root grew from 139 to **171 repositories** and from 12,665 to
     **13,187** tracked json-extension files, while the admitted population stayed at exactly
     **12,543 files / 139 repositories**. Of the 32 new repositories only `julia` carries
     json-extension files at all (7), and those 7 are tracked-but-absent (§*The 522 files*), so
     they were never admissible. Separately `ruling-recheck.ts`, which imposes no size cap,
     moved 12,659 → **12,663 files / 141 repositories**. A reader reconciling "13,187 tracked"
     against "12,543 admitted" should read §limitation 11 (116 over the 512 KB cap) and
     §*The 522 files* (522 absent from disk); the residual 6 are content-based rejection by
     `detectLanguageFromPath`.
11. **The census declines files over 512 KB, so every count here has a denominator that
    excludes 116 files.** `census.ts` sets `MAX_BYTES = 512 * 1024` and the largest file it
    admits is **510,521 B**. Counting the corpus independently: **12,665** files carry a json
    extension, of which **116 exceed 512 KB** and **66 exceed 1 MB**. Those 116 contribute to
    no symbol count, no edge count and no resolution rate in this document, and "whole
    admitted population" therefore means "whole admitted population under the 512 KB cap".
    The `instantiates` ruling is the one measurement here that is **not** under that cap:
    `ruling-recheck.ts` imposes no size limit and admits 12,659 files, so the ruling is
    measured over a strict superset of the population the counts describe.
12. **The arbiter's stride sample cannot see this lane's rarest types, and reports 6 of 10.**
    `script/m14/firing-check.ts --files 120 json` prints **6/10 fired** — `calls`, `uses`,
    `contains`, `references`, `exports`, `extends` — against the census's 9. This is **not a
    disagreement about the analyzer**; it is a property of the sampler. The arbiter picks a
    deterministic per-language **stride** over `git ls-files` (stride **104** at
    `--files 120`), and this lane's three missing types are the three rarest:

    | type | files | share of population | expected inclusions at `--files 120` | P(missed) |
    | --- | ---: | ---: | ---: | ---: |
    | `implements` | 1 | 0.0080% | 0.0096 | **0.9905** |
    | `overrides` | 12 | 0.0957% | 0.1148 | **0.8915** |
    | `imports` | 20 | 0.1595% | 0.1913 | **0.8257** |

    All three were missed, which is what those probabilities predict (joint ≈ 0.73). The
    three types the sample *did* see are each ≥0.6% of the population. Establishing a type
    confined to one file needs a sample whose stride reaches 1, which is the whole
    population.

    So the two instruments answer different questions and both are right: the census answers
    **what the analyzer emits over the admitted population**, and the arbiter answers **what
    a 120-file sample exercises**. A type confined to a handful of files cannot be
    established by sampling, and a lane reporting its arbiter row as its coverage would be
    reporting the sampler's reach as if it were its own. Reported to the supervisor as a
    §8 item, because the arbiter is shared and a default that under-samples rare types will
    read as a defect in whichever lane owns them.

     **Settled by running the same instrument at two sample sizes.** `firing-check.ts` was
     re-run on this lane at three widths with the analyzer unchanged:

     | invocation | files walked | fired | edges | degraded |
     | --- | ---: | ---: | ---: | ---: |
     | `--files 120` | 115/120 | **6/10** | 44,246 | 1 |
     | `--files 1200` | 1,147/1,200 | **7/10** | 507,494 | 3 |
     | `--files 13000` (whole population) | 12,478/13,000 | **9/10** | 5,172,561 | 66 |

     9/10 at the population is the census's answer from a different instrument, so the two
     agree and the 6/10 is a property of the stride. **The arbiter row a lane reports should
     carry its sample width next to it**, because at the default width this lane's three
     rarest types are unreachable by arithmetic, not by chance.

### The fourth bare endpoint, and the two instruments that agreed it was fine

`overrides` was the **last** type still emitting bare names on both ends. It was found by
`namespace-orphan-probe.ts` reporting **9 `DEFECT-in-document-target`** edges on
`duckdb/data/json/11152.json` — while `census.ts` reported `overrides` at **100.00%**
resolution and the shared `incoming-check.ts` reported **0 unresolved and 0 ambiguous**. Three
instruments, three answers, on the same files, and the two shared ones were the ones that said
there was nothing wrong.

**Both are blind in the same direction, and that is the finding.** `census.ts` resolves "by
name OR qualifiedName"; `incoming-check.ts` resolves by name into a last-wins map. So a bare
target naming **five** symbols still reads as 100% resolved and 0 ambiguous. Neither can see a
collision, because both collapse the name to one symbol before comparing.

`validation/m14/fixtures/json/overrides-endpoint-probe.ts` counts the **collision set** instead
of collapsing it. Whole admitted population, 12,547 files, 3,894,818 symbols, 12 files carrying
the type, **22 `overrides` edges**:

| metric | bare name | qualified path |
| --- | ---: | ---: |
| endpoints that are a qualified path | **0 of 22** | 22 of 22 |
| target matches >1 published symbol | **22 of 22** | 22 of 22 |
| target bindings, summed over edges | **85** (mean 3.86) | 83 (mean 3.77) |
| source matches >1 published symbol | **2 of 22** | **0 of 22** |

**Every one of the 22 was ambiguous by name, and the bare form is ambiguous in the WRONG
DIRECTION.** `FSharp.Data`'s bare `rec2` names both elements of one array and its bare `1`
names four keys, so the reverse walk could bind to a declaration in a **different object**:

```
FSharp.Data/tests/FSharp.Data.Tests/Data/DictionaryInference.json
  [{ "rec": {"0":"111","1":"222"}, "rec2": {"0":{"a":"10"},"1":{"a":"20"}} },
   { "rec": {"0":"333"},            "rec2": {"1":{"a":"30"},"1":{"a":"40"}} }]
  bare:  rec2 -> 1                    matches 2 sources x 4 targets
  path:  DictionaryInference[1].rec2 -> DictionaryInference[1].rec2.1
```

The endpoints now come from `parentPath` / `childPath`, which were **already in scope** at the
collection site — the containing object's path is what `contains` publishes for the same key —
so nothing is re-derived. The names are kept in metadata as `ownerName` / `key`, and
`meta.endpoints` records the form. `overridesLine` still carries the prior declaration's line.

**What the fix did and did not do, stated as measured.** Source ambiguity is **closed**, 2 of 22
→ 0 of 22. Target ambiguity is **not closed**: the collision set shrinks from 85 bindings to 83
and narrows on **1 of 22 edges**. Collision-set sizes under the path form are **2, 3, 5 and 7**.
Two causes, both properties of the document rather than of the analyzer:

1. the two declarations of one duplicated key share a name **and** a qualified path — only
   `overridesLine` separates them (§limitation 6), and that is not closable per-file; and
2. a key repeated across the **top-level values of a concatenated JSON document** gets one
   module-qualified path, because the module symbol owns every top-level value.
   `duckdb/data/json/11152.json` declares `fileSize` four times in its first object and once in
   its second, so `11152.fileSize` names five declarations.

An earlier draft of the probe printed "every remaining set is exactly 2". The measurement says
otherwise, so the sentence was **withdrawn rather than the table re-read until it agreed**.

**The cost, re-measured over the whole population: no edge count moved.**

| instrument | result |
| --- | --- |
| census | 3,905,700 relationships / 12,547 files / 0 empty names / 0 empty-or-unknown kinds / **0 endpoints equal to `unknown`** / **0 edges below 0.7** — identical to the digit |
| differential | truth 3,905,480 / analyzer 3,905,700 / covered **100.00%** / **0 MISSING** / 220 UNEXPLAINED (the one known `$ref: "#"` class) |
| fixtures | **14/14** |
| contract probe | **28/28** |
| lane mutants | **17/17**, 0 survivors |
| shared registry | **25/25**, 0 survivors, `M14.0.F4.json` byte-identical |
| `namespace-orphan-probe` | **DEFECT-in-document-target 9 → 0**; orphan by qualified path **242 of 192,503 = 0.13%** |
| shared `incoming-check.ts` | 24 ambiguous target names, **unchanged** — it collapses names last-wins, so its row never showed this and still does not |

**The oracle had to be retargeted first, as it has for `contains`, `calls` and the OpenAPI
`uses`.** Immediately after the analyzer moved, the whole-population differential read
**`overrides` at 0 of 22 covered, 22 MISSING, 22 UNEXPLAINED** — an endpoint-form disagreement
dressed as a disagreement about the language, the fourth time this lane has run that ground.

**And nothing objected while it happened.** The suite had three `overrides` mutants — dropped,
unscoped-to-file, prior-line-lost — and **none tested the endpoint FORM**, so the change passed
16/16 and 24/24 with no registered check objecting. `json/overrides-endpoints-are-bare-names`
now pins it. `DuplicateKey`'s `forbidRelationships` were migrated to the path form along with
its pins: left as bare names they could never match a path-named edge, and a negative control
that cannot fail is not a control.

## The incoming half — what reaches a declaration, and which targets are hopeless strings

Everything above is outgoing: one file in, edges out. It cannot see a target that resolves
to more than one declaration, and it cannot tell a target nobody could publish from a target
this analyzer failed to publish. Both were measured here, per declaration, through production
`parseFile`.

### The shared arbiter's row, and the metric in it that was wrong in both directions

`script/m14/incoming-check.ts json <449 files>`, one file per repo spread deterministically,
space-free paths only (an earlier run passed 464 paths of which 15 contained a space; the
shell split those into separate arguments and `parseFile` threw on the fragments — **80 parse
failures, 0 symbols contributed**, and the totals were unaffected, which is why the clean run
reports the same 188,498 symbols):

```
type            fired  edges    distinct  ambiguous  unresolved
calls           yes    37       28        0          0
uses            yes    765      639       222        0
contains        yes    188054   175568    37         0
references      yes    274      66        0          16
exports         yes    16       4         15         0
extends         yes    6        3         0          0

distinct declarations named by at least one edge : 176210
declarations nothing names (orphans)             : 181686 of 188498
target names resolving to >1 published symbol   : 158
```

**The orphan line is an artefact and must not be quoted as 96.4%.** It compares a
path-valued edge target against a name-valued symbol: `declaredNames` collects `symbol.name`
and `namedTargets` collects `target` strings, so it is only meaningful while a lane's targets
are also bare names. On this lane it read **0.23%** before `contains` endpoints became paths
(misleadingly low — a target `tag` "named" whichever `tag` the set held) and **99.75%** after
(misleadingly high — a target `pkg.outer.tag` never equals a bare `tag`). `validation/m14/
fixtures/json/namespace-orphan-probe.ts` measures both namespaces separately. Over the same
449 files:

| metric | value |
| --- | ---: |
| distinct qualified paths published | 175,822 |
| **orphan by qualified path** | **250 of 175,822 = 0.14%** |
| orphan by bare name (unique names only) | 8,760 of 11,856 = 73.89% |
| ambiguous bare names (excluded from that denominator) | 4,459 |

**0.14% is the number**, and 73.89% is the same fact in the namespace the shared metric
counts. Neither is a regression and neither is a pass.

### EXTERNAL vs NEVER-INDEXED — the two are opposite findings that look identical in a count

644 distinct target strings named nothing published. A previous version of this lane's probe
printed them and declined to say what they were, because separating them looked like it needed
a guess. It does not: **every type this analyzer emits already publishes the discriminator for
its own target contract**, and the two classes of type differ by construction — a target that
is contractually inside the document and does not resolve is a defect, and one that is
contractually outside cannot resolve and is not. The probe reads `metadata` and classifies:

| verdict | edges | what it is |
| --- | ---: | --- |
| `external-package` | 761 | a manifest `dependencies`-family entry (`@apollo/client`, `express`). An npm package name is not a symbol in the document and cannot be. |
| `document-does-not-declare-it` | 16 | a `$ref` with `reasonCode: ref_target_not_declared_in_document`, held at 0.8. The document does not declare the location. |
| `external-file` | 6 | `imports`, `importForm: json_schema_ref` — the target is another file. |
| `external-entry-point` | 3 | `exports`, `exportForm: manifest_entry_point` — `.`, `import`, `require`. |
| **`DEFECT-in-document-target`** | **0** | a type whose contract puts the target inside this document, unresolved. |

**786 of 786 unresolved edges are external or adjudicated, and 0 are defects.** A type with no
discriminator and no in-document contract is reported `UNCLASSIFIED` rather than assigned to
whichever bucket is tidier, so the classification cannot quietly absorb a type it does not
understand.

**The second pass found the opposite failure: the probe inventing a defect, and the number
was 1.** On 444 files / 139 repos it reported `DEFECT-in-document-target: extends ->
dataTypeBase.json#`. The analyzer was right and the reporter was wrong.
`extractSchemaComposition` publishes `refForm: "sibling_file"` and `resolvedPath: false` on
that edge, because an `allOf` entry may be `{"$ref": "dataTypeBase.json#"}` — a **sibling
file** — and that is still composition: "inherits from the schema in that file". The target is
another file and cannot bind to a symbol here, exactly as for `imports`.

`classifyUnresolved` read `importForm`, `exportForm` and `reasonCode`, and hard-coded
`extends` as in-document, so it never consulted `refForm`. That is the failure this section
exists to prevent, running in the direction nobody watches: **the two classes are opposite
findings, and a reporter that ignores a published discriminator manufactures the wrong
one.** A lane that reported that 1 as an analyzer defect would have spent a wave chasing a
bug in code that was correct. `refForm` is now read before the type-based branch.

| verdict | before | after | what it is |
| --- | ---: | ---: | --- |
| `external-package` | 295 | 295 | a manifest `dependencies`-family entry (`esbuild`, `@element-plus/build`). |
| `document-does-not-declare-it` | 91 | 91 | a `$ref` with `reasonCode: ref_target_not_declared_in_document`, held at 0.8. |
| `external-file` | 44 | **45** | `imports` (`importForm: json_schema_ref`) and `extends` (`refForm: sibling_file`) — the target is another file. |
| `external-entry-point` | 7 | 7 | `exports`, `exportForm: manifest_entry_point`. |
| **`DEFECT-in-document-target`** | **1** | **0** | a type whose contract puts the target inside this document, unresolved. |
| **total adjudicated** | **438** | **438** | 4 verdicts, 0 `UNCLASSIFIED`. |

### The ambiguity that WAS mine, and is closed

Before the fixes below, the same probe reported **38 `DEFECT-in-document-target` edges**, and
the per-type endpoint-form measurement showed why. Three types emitted bare names where a
qualified path exists:

| type | target = qualified path | bare name | neither | of which ambiguous |
| --- | ---: | ---: | ---: | ---: |
| `contains` | 188,054 | 0 | 0 | 0 |
| `references` | 258 | 0 | 16 | 0 |
| `extends` | 6 | 0 | 0 | 0 |
| `calls` | **37** (was 0) | 0 | 0 | **0** (was 7) |
| `uses` | 4 (was 0) | 761 | 0 | 27 |
| `exports` | 0 | 16 | 0 | 1 |
| `imports` | 0 | 0 | 6 | 0 |

Two of these were fixable and are fixed:

- **`calls`** — both endpoints are keys of **one** `scripts` object, so both have a position.
  `lodash` is the sharpest case: `npm run build` invokes `build:main` and `build:fp`, and
  `npm run test` invokes `test:main` and `test:fp`, so every target shares a prefix with its
  own source and 7 of 37 bound to more than one published symbol. Now
  `<module>.scripts.<name>` on both ends, with `scriptName`/`calleeName` kept in metadata.
- **the OpenAPI-endpoint `uses`** — an endpoint is a key of the `paths` object, so it has a
  position too. Now sourced from `endpoint.scope` and targeted at `endpoint.qualifiedName`.
  **453 edges corpus-wide.**

Two are **not** fixable, and the reason is the language rather than the analyzer:

- **`uses` from a manifest dependency** — `@apollo/client` is a package name. There is no
  position in the document for it and there never will be.
- **`exports`** — a published entry point (`.`, `./sub`, `fixture-bin`) likewise.

So 28 ambiguous `uses`/`exports` targets remain and are **declared as the language's property,
not papered over**: the two `uses` sites are now told apart by their published discriminators
(`package_dependency` vs `openapi_path_entry_declares_http_method`) rather than by inference,
and the 4 `uses` that resolve by qualified path are the OpenAPI ones.

The shared arbiter's ambiguity count for this lane went **160 → 158**: `calls` 9 → 0, and the
remainder is `uses` (222) and `exports` (15), which is where an npm package name lives.

### What the change cost, and what caught it

The lane's oracle (`script/m14/oracles/json.ts`) published bare `calls` endpoints. The first
whole-population differential after the change read **every `calls` edge at 0% covered — 217
MISSING, 217 UNEXPLAINED** — a disagreement about endpoint FORM dressed as a disagreement
about the language. That is the second time this lane has run that ground, and the doc already
records the first (`contains`). An endpoint-form change is a change to the comparison, and the
comparison has to be re-run or it certifies nothing. After the oracle was retargeted:

| label | truth | analyzer | covered | MISSING | UNEXPLAINED |
| --- | ---: | ---: | ---: | ---: | ---: |
| `calls` | 217 | 217 | 217 (100.00%) | 0 | 0 |
| `uses` | 5,758 | 5,758 | 5,758 (100.00%) | 0 | 0 |
| `contains` | 3,881,840 | 3,881,840 | 3,881,840 (100.00%) | 0 | 0 |
| `imports` | 67 | 67 | 67 (100.00%) | 0 | 0 |
| `references` | 14,797 | 15,017 | 14,797 (100.00%) | 0 | 220 |
| `exports` | 513 | 513 | 513 (100.00%) | 0 | 0 |
| `extends` | 1,721 | 1,721 | 1,721 (100.00%) | 0 | 0 |
| `implements` | 113 | 113 | 113 (100.00%) | 0 | 0 |
| `overrides` | 22 | 22 | 22 (100.00%) | 0 | 0 |
| **TOTAL** | **3,905,480** | **3,905,700** | **3,905,480 (100.00%)** | **0** | **220** |

Re-measured at the second pass: truth 3,905,480 / analyzer 3,905,700, covered **100.00%**,
0 MISSING, 220 UNEXPLAINED. The +220 on the analyzer side over the first pass is the
`contains` growth from the 4 newly admitted files; the per-label agreement is unchanged and
every label reproduced to the digit.

**No edge count moved** — this was endpoint form and metadata only, and the census reproduces
to the digit across it (3,905,268 relationships, 12,543 files, 0 empty names, 0 `unknown`
endpoints, 0 edges below 0.7).

## The 522 files no instrument in this lane can see

Every harness here enumerates the **on-disk** population, which is the right default and hides
one class of file silently. Measured on the shared corpus at 2026-10-04 by
`validation/m14/fixtures/json/absent-files-probe.ts`: **10 repositories are
`--filter=blob:none` partial clones whose working trees were never checked out**, and

| repo | tracked | absent on disk | absent AND json-extension |
| --- | ---: | ---: | ---: |
| pb-googleapis | 9,390 | 9,153 | **456** |
| pb-grpc | 10,504 | 9,792 | **55** |
| julia | 2,059 | 1,107 | **7** |
| pb-reference | 3,678 | 2,797 | **4** |
| cabal / cloogle.org / duckdb / flutter-packages / helm / hledger | — | 8 | 0 |
| **total** | | **22,861** | **522** |

The blobs are in the local object store, so the probe reads them into a temp dir and puts them
through the same production `parseFile` and the same ruling probe. It does **not** check them
out: six lanes are reading that tree concurrently and materialising 9,153 files underneath them
would move their denominators mid-run.

```
materialised 522   over the 512 KB cap 0   rejected by detectLanguage 0
ADMITTED 522/522   parse failures 0
symbols 50,947 (empty name 0, empty kind 0)   relationships 50,741
  contains 50,425/518 files   references 296/2   uses 20/2   other seven types 0
instantiates ruling probe: 0 hits, 0 files
```

So the blind spot is **+522 files (4.16% of 12,543; 3.74% of the third pass's 13,951) and
+50,741 edges (1.30% of 3,905,268; 1.26% of the third pass's 4,019,086)**,
and **no new relationship type appears in them**, so 9/10 stands. It also extends the
`instantiates` ruling: `ruling-recheck.ts` admits **12,663 files / 141 repositories** at the
current corpus state with 0 hits, and these 522 are disjoint from it (they are not on disk),
so the ruling is measured over **13,185 files**.

## The structural limit: JSON has no names

This was measured before pass 2 and the shape has not changed, only the endpoints.
**64.54%** of relationship endpoints were **ambiguous** — the name they carried shared by
more than one symbol in the same file — against **33.49%** resolving to exactly one and
**1.97%** naming none. Resolving by `qualifiedName` did not rescue it (unique by name
32.92%, by qualifiedName 5.25%, by either 34.92%) **because the two indexes barely
composed**: `contains` sources were bare names and `references` sources were paths.

Pass 2 changed the answer rather than restating it. `contains` — 99.4% of the graph —
now emits qualified paths on both ends, which removes the ambiguity for the largest class
by construction: the endpoint names a position, not a word. Measured on the same
202-file, 99-repo sample, before and after:

| | before | after |
| --- | ---: | ---: |
| `contains` edges | 66,032 | 66,164 |
| targets matching MORE THAN ONE published symbol | 32,660 (49.4%) | **6 (0.009%)** |
| self-loops (source string == target string) | 1,119 | **0** |
| endpoints equal to the literal `unknown`, whole population | 51 | **0** |

What remains is 6 targets across 198 files, plus `uses` (3 of 19) and `exports` (1 of 1),
which are **name-valued by construction** — a dependency's endpoint is its package name
and there is no position in the document for it. The language's own property is untouched:
a JSON key is unique only within its object, so every object in a JSON array repeats the
same keys. That part is not a defect and no store-side change closes it.

## Evidence

> **The per-label and per-harness tables in this section are the SECOND-pass measurement at
> the 12,547-file corpus state**, retained because they are the runs that cover the
> inheritance evidence and the 522 absent files, and because the third pass's own numbers
> are in §*Re-measurement, third pass*. The current headline figures are the third pass's:
> **13,951 admitted files, 4,002,504 symbols, 4,019,086 relationships, truth 4,018,829,
> covered 100.00%, 0 MISSING, 257 UNEXPLAINED, 0 parse failures, 0 empty names, 0
> `unknown` endpoints, 0 edges below 0.7.**

**Whole admitted population**, production `parseFile` on the analyzer side
(`validation/m14/fixtures/json/census.ts`): **12,547 admitted files**, 3,894,818 symbols,
**3,905,700 relationships**, 0 parse failures, **0 symbols with an empty name, 0 with an
empty or unknown kind**, **0 endpoints equal to the literal `unknown`**, 0 edges below the
0.7 heuristic threshold. Kinds: `property` 2,542,322 / `class` 1,339,950 / `module`
12,546 — one file short of the population, and the file is named in §*Performance*.
Third pass: **13,951 files**, `property` 2,615,677 / `class` 1,372,877 / `module` 13,950 —
again one short, the same file.

**Differential**, production `parseFile` against `deriveJsonEdges` over a fresh parse
(`validation/m14/fixtures/json/differential.ts`). Two runs, because the second is the one
that covers the inheritance evidence and the first is the wider corpus:

| | files | truth | covered | MISSING | UNEXPLAINED | files matching exactly |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **whole admitted population** (139 repositories) | **12,547** | **3,905,480** | **3,905,480 (100.00%)** | **0** | **220** | **12,011 of 12,044** |
| 12 repositories (openapi-spec, postgrest, docker, terraform, kubernetes, svelte, apollo-server, duckdb, otp, vault, graphql-js, vega) | 3,272 | 846,762 | 846,762 (100.00%) | **0** | **200** | 2,878 of 2,897 |
| 4 repositories (dart-sdk, duckdb, openapi-spec, hasura-engine) | 1,952 | 526,510 | 526,510 (100.00%) | **0** | **65** | 1,891 of 1,909 |

The whole-population row is the one to quote, and it is the run that covers the qualified-path
endpoint change on every admitted file rather than on 3,272 of them. **Re-measured at the
second pass and reproduced**: truth 3,905,480 / analyzer 3,905,700, **covered 100.00%, 0
MISSING, 220 UNEXPLAINED**, 12,011 of 12,044 files matching exactly. **All 220 unexplained
edges are one class**: a bare `"$ref": "#"` in
`docker/vendor/github.com/go-openapi/spec/schemas/jsonschema-draft-04.json`, naming the
document root. The analyzer emits it and the oracle declines it; the disagreement is 220 edges
on 12,547 files and it is listed as an unadjudged reading rather than dismissed (§limitation 8 of
the list below, *One `references` class is unadjudicated*).

Per label on the whole admitted population:

| label | truth | analyzer | covered | MISSING | UNEXPLAINED |
| --- | ---: | ---: | ---: | ---: | ---: |
| `contains` | 3,881,840 | 3,881,840 | 100.00% | 0 | 0 |
| `references` | 14,797 | 15,017 | 100.00% | 0 | 220 |
| `uses` | 5,758 | 5,758 | 100.00% | 0 | 0 |
| `extends` | 1,721 | 1,721 | 100.00% | 0 | 0 |
| `implements` | 113 | 113 | 100.00% | 0 | 0 |
| `exports` | 513 | 513 | 100.00% | 0 | 0 |
| `calls` | 217 | 217 | 100.00% | 0 | 0 |
| `imports` | 67 | 67 | 100.00% | 0 | 0 |
| `overrides` | 22 | 22 | 100.00% | 0 | 0 |

The narrower per-label run chosen for the inheritance evidence, kept because the `implements` and
`declared_supertype` rows are what the endpoint change was re-derived against:

| label | truth | analyzer | covered | MISSING | UNEXPLAINED |
| --- | ---: | ---: | ---: | ---: | ---: |
| `contains` | 522,304 | 522,304 | 100.00% | 0 | 0 |
| `uses` | 892 | 892 | 100.00% | 0 | 0 |
| `references` | 2,713 | 2,778 | 100.00% | 0 | 65 |
| `extends` | 421 | 421 | 100.00% | 0 | 0 |
| `implements` | 113 | 113 | 100.00% | 0 | 0 |
| `imports` | 21 | 21 | 100.00% | 0 | 0 |
| `exports` | 26 | 26 | 100.00% | 0 | 0 |
| `calls` | 5 | 5 | 100.00% | 0 | 0 |
| `overrides` | 15 | 15 | 100.00% | 0 | 0 |

**Four** classes of defect were found here and are fixed rather than listed as
limitations:

1. **`contains` for an array inside an array.** 183 edges corpus-wide that the analyzer
   emitted and the oracle declined, recorded as "not adjudicated" by pass 1. Naming an
   element from the array's own NAME is correct while every array is written under a key;
   it stops being correct once an array can be an ELEMENT of another array, because then
   the inner array's name is the outer array's name. `rows[0]`'s two elements came out as
   `rows[0]` and `rows[1]`, colliding with the outer array's element namespace, and since
   `contains` is emitted from the OWNER symbol the document asserted `rows[0] contains
   rows[0][1]` between two objects that are not nested. **Both implementations had the
   same bug**, which is the case the honesty contract names: agreement is evidence that
   two walkers agree, not that either is right about the language.
2. **The oracle published BARE `contains` endpoints while the analyzer published qualified
   paths.** The endpoint change landed without it, and nobody ran the lane's differential, so
   the change was invisible to the lane's own instrument: on the 3,272-file corpus,
   `contains` read **17,541 of 834,130 covered — 2.10% — with 816,589 MISSING and 816,589
   UNEXPLAINED**. The oracle already computed both paths (`parentPath` is the owning
   object's own path, `here` is the child's) and published names instead. After the fix:
   **834,130 of 834,130, 0 MISSING, 0 UNEXPLAINED.** The lesson is the one this lane keeps
   re-learning: a change to an endpoint form is a change to the comparison, and the
   comparison has to be re-run or it certifies nothing.
3. **The oracle resolved `allOf` composition DURING its walk.** `definitions` frequently
   comes after `properties` in a JSON Schema document, so a pointer into `definitions`
   had not been recorded when the `allOf` referencing it was read. Measured: 809
   `extends` edges on a 3,272-file corpus read as analyzer-only, and on go-openapi's
   `schema.json` the oracle produced **zero** where the analyzer produced 4 — every one an
   `allOf` under `properties`. The same document order is why the `references` rule,
   which resolves in a second pass, was always right.
4. **`extends` was sourced from the `allOf` ARRAY** rather than from the schema object
   that composes. Every corpus example read
   `debugAdapterProtocol.definitions.Request.allOf -[extends]-> …ProtocolMessage`, and
   `allOf` is a keyword shared by every schema in the file. The array's own path is still
   published, as `meta.compositionSite`.
5. **The oracle published BARE `calls` and OpenAPI `uses` endpoints**, the same defect as
   item 2 on two types, found by the same route. After this pass moved `calls` and the
   OpenAPI `uses` site to qualified paths, the whole-population differential read
   **`calls` at 0 of 217 covered, 217 MISSING, 217 UNEXPLAINED** and the 453 OpenAPI
   `uses` likewise. Both retargeted in the oracle, then re-run:
   **3,905,048 of 3,905,048 = 100.00% covered, 0 MISSING, 220 UNEXPLAINED.** Three
   endpoint-form changes have now needed an oracle change in this lane (`contains`, `calls`,
   OpenAPI `uses`), which is the argument for treating an endpoint-form change as
   automatically invalidating the comparison rather than as a metadata edit.

- **Contract probe** — 28/28 (`script/m12/json-contract-probe.ts`, reads production),
  including the zero-regex check
- **Fixtures** — 14, each pinning both directions. `Arrays.json` forbids containment for
  array scalars; `ArrayInArray.json` exists because the array-inside-an-array shape had no
  fixture and had a defect; `DuplicateKey.json` pins the `overrides` prior line;
  `SameKeyDifferentObjects.json` is the duplicate check's negative control;
  `Inherit.lsp.json` and `Inherit.duckdb.json` pin both inheritance shapes and their four
  declined forms; `manifest/package.json` pins `calls`, `exports` and the five `calls`
  shapes that are declined.
- **Mutants** — **25 registered for this lane, 25 caught, 0 survivors**, re-measured after the
  `overrides` endpoint change: **17 lane-owned** in `script/m14/json-mutants.ts` (run by
  `validation/m14/fixtures/json/mutants.ts`, **17/17 caught, 0 survivors**) plus **8 more
  registered inline in the shared `script/m14/mutate-analyzer.ts`**
  (`json/edge-lines-dropped`, `json/imports-dropped`, `json/ref-target-is-name`,
  `json/contains-source-is-path`, `json/array-item-by-path-segment`,
  `json/array-child-owner-is-array`, `json/extends-dropped`, `json/extends-local-form-only`).
  Scoped, byte-safe invocation and its measured result:
  `BB_MUTANT_ONLY="json/" bun run script/m14/mutate-analyzer.ts` → **all 25 caught (filtered
  1781 → 25)**, `M14.0.F4.json` md5 `8f73e5d8f9d001bebc9758d823d8a69c` before and after.
  The earlier "16" counted only the lane file and understated the registration; the shared
  harness ignores its language argument and sweeps every lane, so its 6 fleet-wide survivors
  (`php`, `erlang`, `zig`, `clojure`) are **not** this lane's and are reported in §*Unresolved*.
  Three new across the three passes: `dependency-version-is-the-json-type` (a published
  `metadata.version` read `"string"` on all 4,625 dependency edges),
  `calls-endpoints-are-bare-names`, and `overrides-endpoints-are-bare-names` — the last added
  because the suite had three `overrides` mutants and **none tested the endpoint FORM**, so
  that change passed 16/16 and 24/24 with no registered check objecting (§*The fourth bare
  endpoint*).
  Two existing ones — `calls-callee-any-token` and `calls-runner-substring` — were emitting
  bare-name endpoints and so became **invisible** rather than caught when the endpoint form
  changed; a mutant that cannot fail is indistinguishable from a defect class with no mutant,
  so both now carry qualified paths.
  Two existing ones — `calls-callee-any-token` and `calls-runner-substring` — were emitting
  bare-name endpoints and so became **invisible** rather than caught when the endpoint form
  changed; a mutant that cannot fail is indistinguishable from a defect class with no mutant,
  so both now carry qualified paths.
  Two matter most: `overrides-unscoped-to-file` is worth ~5,700 false edges over the
  corpus, and `array-item-named-from-bare-array-name` is the shape that hid for a whole
  wave behind two agreeing implementations.
- **Ontology gate** — 9 emitted / 1 ruled-sound / **0 falsified**, via
  `validation/m14/fixtures/json/ruling-table.ts` on a 1,952-file corpus. The shared gate
  cannot report this lane's table until the wiring in §*Ruling table* lands, **and at the
  2026-10-04 pass it printed no table at all**: `ontology-coverage-gate.ts json --files 300`
  and `ruling-table.ts` both die on the in-process WASM trap (§limitation 9). The arbiter's
  firing instrument is the one that does finish, and it reads **9/10 at the whole
  population** (§*incoming*, the three-width table).
- **Ruling re-measurement** — `validation/m14/fixtures/json/ruling-recheck.ts`, the whole
  admitted population, **12,663 files / 141 repositories, 0 hits, 0 parse throws**, plus the
  522 tracked-but-absent files (§*The 522 files*, 0 hits) for **13,185 files** in total. It
  imports the probe from `script/m14/json-ruled.ts` instead of restating it, and uses a
  discard-poisoned-slot parser so it terminates where the single-process walk does not.
- **Parse determinism** — `validation/m14/fixtures/json/parse-determinism.ts`: the 8 files
  the production path names as trapping, 5 isolated parses each, **40 parses / 0 traps /
  0 timeouts**, all 8 also clean under `JSON.parse`. This is what moved §limitation 9 from
  "four files trap" to "the trap is a property of the run".
- **Trap scan** — `validation/m14/fixtures/json/trap-scan.ts`: 12,543 admitted files parsed,
  **trapping files 0**, 298 files carrying ERROR/missing nodes.
- **Differential** — enrolled in the shared F5 harness with an independent oracle
  (`script/m14/oracles/json.ts`, lane-owned so the shared file is not a fault line).
  Corpora chosen by measurement: `terraform` primary (415 hand-written files, 12
  lockfiles) and `otp` second for its **adversarial** `json_SUITE_data`.
  `clj-kondo` was rejected despite 742 files because 729 are `.transit.json`
  (Clojure, not JSON); `shadcn-svelte` because its 2,369 are mostly
  `package-lock`.
- **Incoming** — `script/m14/incoming-check.ts` (shared arbiter) and
  `validation/m14/fixtures/json/namespace-orphan-probe.ts` (the lane's own, measuring both
  namespaces and adjudicating every unresolved target). 449 files / 188,498 symbols /
  189,158 edges: **orphan by qualified path 250 of 175,822 = 0.14%**; unresolved targets
  **786 edges → 761 external-package + 16 document-does-not-declare + 6 external-file +
  3 external-entry-point + 0 DEFECT**; `calls` ambiguous targets **9 → 0**, lane total
  **160 → 158**. Full numbers and the reasoning in §*The incoming half*.
- **Absent files** — `validation/m14/fixtures/json/absent-files-probe.ts`: 10 repositories are
  partial clones with **22,861 tracked files absent, 522 json-extension**. Read from git into
  a temp dir and run through production `parseFile`: **522 admitted, 0 parse failures, 50,947
  symbols, 50,741 relationships, `instantiates` probe 0 hits.** The corpus was not modified.
- **Dependency versions** — measured over 454 manifests through production `parseFile`:
  **4,625 of 4,625** `package_dependency` edges publish a real version range (caret 2,245 /
  exact 1,619 / other 603 / tilde 158), 0 `unspecified`, 0 `"string"`, 0 `"unknown"`. Before
  the fix in this pass all 4,625 carried a wrong value.
- **Spec** — `script/m14/spec/json-completeness.json`, a written ruling per construct
- **Full record** — `reviews/json/m60-closure.md`, `reviews/json/resolution.md`

## Six questions, per emitted type

They fail independently, and the numbers are per type rather than per lane.

| type | Exists | Fires | Correct (oracle) | Labelled | Resolved | Confident |
| --- | --- | --- | --- | --- | --- | --- |
| `contains` | yes | 3,881,840 | 522,304/522,304 = 100.00% | containment is the format's only relation; the array-in-array source was wrong and is fixed | 100.00% | 1.0, no reason code needed |
| `references` | yes | 15,017 | 2,713/2,713 covered; **65 UNEXPLAINED** | `$ref` names a LOCATION — the lane's stated contract; a bare `"$ref": "#"` (220 corpus-wide) targets the document root and both readings are arguable | 98.55%; the 218 misses are pointers to undeclared locations, at 0.8 with a reason code | 1.0 / 0.8, both with `reasonCode` |
| `uses` | yes | 5,758 | **5,758/5,758 = 100.00%** | two sites with different warrant: a manifest DEPENDENCY is a use; an OpenAPI endpoint `uses` is arguable — the same pair already has a `contains` edge — and is held at 0.8 for that reason | 100.00%; the OpenAPI site now resolves by **path**, the dependency site cannot (§*The incoming half*) | 1.0 (deps) / 0.8 (endpoints, `openapi_path_entry_declares_http_method`) |
| `extends` | yes | 1,721 | 421/421 = 100.00% after two fixes (array-in-array, oracle walk order) | `allOf` is the one superset keyword; `anyOf`/`oneOf`/`not` correctly emit nothing. **The strongest argument against the label is the strongest one available**: in type theory `allOf` is an INTERSECTION, so the composed schema is a SUBTYPE, and "extends" reads the other way. It is kept because the workstream's `overrides` precedent accepts the language's own reading of a relation | 99.83% | 1.0, `json_schema_all_of` / `declared_supertype` |
| `implements` | yes | 113 | 113/113 = 100.00% | LSP `mixins` = interfaces. Held at 0.9 because the mapping is a naming decision, not a parse fact | 100.00% | 0.9, `declared_interface_mixin` |
| `exports` | yes | 513 | 26/26 = 100.00% | a manifest's published entry point IS an export; the strongest counter is that `main`/`bin` name FILES, so `imports` would fit — declined because a file the manifest does not list as a dependency is not a declared symbol | 100.00% | 1.0, `evidenceClass: structural` |
| `calls` | yes | 217 | **217/217 = 100.00%** | both endpoints are keys of ONE `scripts` object, so this is not a cross-file name guess. The strongest counter is that it is derived from a STRING by a CLI convention, which is why it is 0.8 and not 1.0 | **100.00% by qualified path**; ambiguous bare names **9 → 0** | 0.8, `npm_run_sibling_script` |
| `overrides` | yes | 22 | 15/15 = 100.00% | a duplicate key replaces its prior declaration under every mainstream parser; RFC 8259 §4 says only that behaviour is unpredictable | 100.00% | 1.0, `evidenceClass: structural` |
| `imports` | yes | 67 | 21/21 = 100.00% | a file-naming `$ref` is a file dependency; a URL is a vocabulary and is declined | **0.00% by design** — the target is another FILE, not a symbol in this document | 1.0, `evidenceClass: structural` |

### DERIVATION findings

**6.** `contains`, `references`, `imports`, `uses`, `exports`, `calls`.

A DERIVATION finding is a type the analyzer emits that the **shared** differential never
audits. `script/m14/differential.ts` filters the ANALYZER side through a per-language
label allowlist before comparing, and its head — `extends`, `implements`, `instantiates`
— is unconditional while everything after it is gated on a per-language `lang === "…"`
test. **`json` appears in none of those tests.** Extracting and evaluating that
allowlist expression (the same extraction `script/m14/verify-label-coverage.ts` performs)
admits exactly `{extends, implements, instantiates, overrides}` for this lane, so the
other six emitted types are dropped before the comparison happens.

The canonical evidence says so, and the lane's own doc did not:
`validation/m14/results/M14.0.F5.json` records for `json`
`analyzerEdges: 0`, `coveragePct: 0`, `coveredByAnalyzer: 0`,
`missingInAnalyzer: 27,828`. Zero analyzer edges against 27,828 oracle edges is not a
disagreement between the oracle and the analyzer; it is the analyzer's output never
reaching the comparison. `validation/m14/results/json.json` has **no row at all** in
`validation/m14/differential-baseline.json` — not `json`, not `terraform:json`, not
`otp:json`.

All six have a lane-owned oracle that derives them
(`script/m14/oracles/json.ts` derives `contains`, `references`, `imports`, `uses`,
`exports`, `calls`, `extends`, `implements` and `overrides`), and the lane's own
whole-population differential measures them — that is the instrument this doc quotes.
**The fix is one clause in shared code**: add `lang === "json"` to the compared-label
allowlist at `script/m14/differential.ts` (~line 23153). §8, so it is reported, not
applied. Until it lands, this lane's canonical row reads 0% and 27,828 MISSING, and the
number in this doc comes from a different harness.

**The shared gate now says the same thing independently**, which is better evidence than this
lane extracting an expression out of a shared file and evaluating it. `script/m14/verify-label-coverage.ts`
is built for exactly this question — *"an emitted label the allowlist drops is compared by
nothing"* — and it names this lane without being asked:

```
| json | terraform | 25 | 233 | 0 | **contains** (233) | — |
      - json/contains: 233 edges unaudited

FAIL — 34 undeclared gap(s) across 19 lane(s); 8656 edges compared by nothing.
```

**Re-run at the second pass and this lane's row is byte-identical** — `json / terraform /
25 files / 233 edges / 0 covered / contains (233)`, and `json` still appears in **0** of the
compared-label allowlists in `script/m14/differential.ts` (grepped across the whole filter
expression). Only the fleet total moved, 31 → **34** gaps over 18 → **19** lanes and
8,573 → **8,656** edges, from other lanes adding gaps.

It reports one dropped label for this lane rather than six because its json corpus is
`terraform`, and `contains` is the only one of the six that terraform's json files actually
exercise — the other five do not occur there, so there is nothing to drop. The finding is the
same finding, measured twice: by the lane's own allowlist evaluation, and by a shared gate that
exists to catch it. The `34 gaps across 19 lanes / 8,656 edges` total is the fleet-wide size of
the same defect and is not this lane's to fix.
## §8 — items owed by the supervisor, specified so they need no re-derivation

Six, all in shared machinery this lane does not edit. Each states file, what it must do,
and why, so it can be applied without re-running anything in this lane.

**1. `script/m14/differential.ts` — one clause: add `lang === "json"` to the compared-label
allowlist (~line 23153).** This is the DERIVATION finding above, and it is the only item
that makes a *canonical* number wrong: `validation/m14/results/M14.0.F5.json` records
`analyzerEdges: 0, coveragePct: 0, missingInAnalyzer: 27,828` for json, and
`validation/m14/differential-baseline.json` has **no json row at all**. The oracle is
invoked (`differential.ts:22888`) so the truth side is complete; the analyzer side is
filtered to `{extends, implements, instantiates, overrides}` before comparison, so six
emitted types are dropped. Until it lands, every per-type number in this document comes from
a different harness than the canonical one.

**2. `script/m14/ontology-coverage-gate.ts` — replace the inline json ruling table with the
lane's, one import and one map entry.** As §*Ruling table* records: the inline copy carries
**five** entries, three of them (`calls`, `imports`, `overrides`) for types this lane now
emits, so they short-circuit and are inert; its `imports` entry carries a `countOnTree` the
gate *runs* over the whole corpus and never reads; and its two live entries are on
**instrument A**, the instrument that passed the `implements` ruling the corpus overturned.
The replacement is `script/m14/json-ruled.ts`.

**3. `script/m14/mutate-analyzer.ts` — the documented scoped invocation CORRUPTS a shared
artifact. Found by doing it.** The task prompt's §6 lists
`bun run script/m14/mutate-analyzer.ts json`. That command:

- reads **no positional language argument at all** — `process.argv` appears at line 36 only
  to locate `ROOT`, and at 18920 only to detect `main`. `json` is silently ignored.
- narrows by `BB_MUTANT_ONLY` alone (`:18848`), and computes `const scoped = !!mutantFilter`
  (`:18863`), so a positional argument leaves `scoped === false`;
- therefore runs **all 1,780 fleet mutants** and **writes
  `validation/m14/results/M14.0.F4.json`** — a §8 artifact — over a 23,003-line diff;
- and then `exit 2`, because 6 mutants survive (php, erlang, zig, clojure).

This is the identical hazard `script/m14/run-fixtures.ts` documents for its own `--lang` at
M49 G8 ("a 4-mutant slice once replaced the 21-language artifact"; here *"the scoped-run
hazard, found by doing it"*), reproduced in a sibling harness that has no guard at all. What
it must do: read a language argument and treat it as scoping, exactly as `run-fixtures.ts`
does — i.e. a language selection that is not the full registry sets `scoped`, prints, and
writes no evidence. The safe invocation **today**, verified not to write the artifact, is:

```
BB_MUTANT_ONLY="json/" bun run script/m14/mutate-analyzer.ts
  -> all 25 mutants caught (filtered 1781 -> 25); M14.0.F4.json unchanged
      (md5 8f73e5d8f9d001bebc9758d823d8a69c before and after)
```

This lane reverted the overwrite with `git checkout --` and re-verified byte-equality, so no
damage reached the branch. **Any other agent following that prompt has just corrupted F4.**

**4. `src/ast/pool-worker.ts` / the engine — the in-process WASM parse trap.** §limitation 9
measures it as a property of the RUN and not of any file (55 parses over 11 named files in
isolated children: 0 traps, 0 nondeterministic), and it has a sharper consequence than a
flaky log line: **the shared ontology arbiter cannot produce a verdict table for this
language at all.** `ontology-coverage-gate.ts json --files 200` exits 1 printing **no table**,
on a different file each run, and ignores `--files` while reporting the whole population. It
is the engine's hardcoded watchdog around a synchronous WASM parse.

**5. `validation/m14/results/M14.0.F4.json` — regenerate, but not before item 3's survivors
are fixed.** F4 declares the **glob** `validation/m14/fixtures/` as an input (see
`script/m14/verify-honesty.ts:232`), so any lane's probe or fixture change invalidates it.
This lane's probe files are a trigger, but they are no longer the only one: at the 2026-10-04
re-check `verify-honesty.ts` reports **`M14.0.F4: 637 declared input(s) changed`** — F1 64, F2
2,384, F3 1,042, F5 67, F6 1,082, F7 61, F8 133, F9 70 — so the trigger is fleet-wide and this
lane's contribution is a small share of it. The same run reports
**`0 artifact(s) current against their declared inputs`** and **`freshness rule flags every
artifact — it cannot distinguish current from stale`**, which means the freshness baseline is
itself broken and the per-artifact counts above are all reading "changed". **This is a §8 item
of its own: the freshness rule cannot currently tell a current artifact from a stale one, so
it cannot be used to decide whether F4 needs regenerating.** It must be regenerated by an
**unscoped** `bun run script/m14/mutate-analyzer.ts`, which cannot currently succeed: the
harness `exit 2`s while any mutant survives, and the recorded artifact already reads
`{mutantsRun: 1778, caught: 1772, survived: 6}`. So the ordering is item 3's guard, then the
6 survivors (`php/drop-external-override-guess`, plus erlang, zig and clojure), then
regenerate — otherwise the new artifact would certify a red suite. This lane verified the
scoped alternative leaves it untouched: `BB_MUTANT_ONLY="json/"` caught all 25 with
`M14.0.F4.json` md5 unchanged at `8f73e5d8f9d001bebc9758d823d8a69c`.
