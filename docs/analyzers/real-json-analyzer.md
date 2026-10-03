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
| Symbol identity | a `pair` key is a symbol named by its key. Its **owner is the parent SYMBOL's name**, never its qualified path — a path is a fine identity and a useless endpoint, because the store resolves by name. The path lives in `qualifiedName` and in edge metadata, where nothing has to resolve it. |
| Kinds | an **object** is `class`: it has named children and `contains` edges come from it. Everything else is `property`, **including an array** — the analyzer previously called arrays `variable`, importing a shell-shaped mutable-binding distinction JSON does not have. |
| Arrays | a **leaf of scalars, a container of objects**. Scalar elements are positional and unnamed: no symbol, no edge. An object element is a `class` named `<array>[i]`, contained by the array, and **its own keys are owned by the element**. An element is identified by its index *under the array*, and the array is named by the key it was written under — never derived from a path, which is correct only while the module name has no dot. |
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

## Relationship ontology — 8 of 10 emitted, 2 ruled, every verdict measured

Whole admitted population, **11,713 files** across 106 repositories, production
`parseFile` (`validation/m14/fixtures/json/census.ts`). 2,119,275 symbols,
2,130,251 relationships, 0 parse failures, 0 symbols with an empty name, 0 with an
empty or unknown kind.

| type | verdict | edges | files | both endpoints resolve | confidence min |
| --- | --- | ---: | ---: | ---: | ---: |
| `contains` | EMITTED | 2,107,562 | 10,459 | 100.00% | 1.0 |
| `references` | EMITTED | 14,747 | 158 | 98.52% | 0.8 |
| `uses` | EMITTED | 5,703 | 453 | 100.00% | 0.8 |
| `extends` | EMITTED | 1,432 | 79 | 99.79% | 1.0 |
| `exports` | EMITTED | 506 | 211 | 100.00% | 1.0 |
| `calls` | EMITTED | 213 | 78 | 100.00% | 0.8 |
| `imports` | EMITTED | 67 | 20 | 0.00% (see below) | 1.0 |
| `overrides` | EMITTED | 21 | 11 | 100.00% | 1.0 |
| `implements` | RULED | 0 | — | — | — |
| `instantiates` | RULED | 0 | — | — | — |

`imports` resolving at 0% is **correct, not a defect**: an `imports` target names
another FILE (`v0.0.1/dsse_v0_0_1_schema.json`), and a file in another file is not a
symbol in this one. All 67 have a resolvable source. It is the one type whose endpoint
is deliberately not a symbol.

**Edges below the 0.7 heuristic threshold: 0 of 2,130,251.** Sub-1.0 edges are
`calls` (213, all 0.8), the 218 `references` whose target did not resolve (0.8), and
the OpenAPI-endpoint `uses`. Each carries `evidenceClass`; `calls` additionally
carries `reasonCode: npm_run_sibling_script`.

**51 endpoints carry the literal text `unknown`, and 51 of 51 are declared keys.**
That is not 51 violations: a JSON symbol name is an object key, and `unknown` is an
ordinary word for one — proxicall declares it in 38 i18n message files, redis 6,
terraform 3, hasura-engine 1. Measured by `validation/m14/fixtures/json/unknown-endpoints.ts`
over the same population: 48 of 48 resolvable on the earlier 10,983-file snapshot, 0
genuinely unresolvable on either.

### What each type means in JSON

- **`contains`** — the object a key is written in contains that key. The only relation
  the *format* defines; 99.0% of the lane's graph.
- **`references`** — a `$ref` names a **location**, not a symbol, so the target is the
  location. A JSON Pointer is relative to the document root, so
  `#/components/schemas/X` names `<module>.components.schemas.X`.
- **`imports`** — a `$ref` naming **another file** is a file dependency and emits both
  `imports` and `references`. A local pointer and a URL are neither: a URL names a
  **vocabulary**.
- **`uses`** — an OpenAPI `paths` object uses the endpoint it declares, and a manifest
  uses each entry under `dependencies` / `devDependencies` / `peerDependencies` /
  `optionalDependencies`.
- **`extends`** — JSON Schema composition. `allOf` means "must satisfy all of these",
  the one keyword that means a superset relation. `anyOf` and `oneOf` are
  **alternatives** and `not` is a negation; none has an ontology type, so they
  contribute only the `references` their `$ref`s already produce. Corpus:
  `allOf` 1,445 occurrences, `oneOf` 1,021, `anyOf` 573, `not` 206 — the shape the
  reading predicts.
- **`exports`** — what a manifest **publishes**: a subpath key of `exports`, the field
  name for `main`, the command name for `bin`.
- **`calls`** — an npm script that runs a **sibling** script:
  `"pretest": "npm run compile"`. Both endpoints are keys of the same `scripts` object,
  so both are symbols in the same file. 213 edges over 78 files; `apollo-server/package.json`
  alone carries 7.
- **`overrides`** — a key declared **twice in one object**. The second declaration
  replaces the first under every mainstream parser, which is the relation the bash lane
  calls `overrides`. RFC 8259 §4 says only that names SHOULD be unique and that a
  parser's behaviour is unpredictable. 21 edges over 11 files.
- **`implements`** — RULED, see below.
- **`instantiates`** — RULED, see below.

### The two exclusions, with the instrument, the probe and the overturn condition

Both were ruled **before** this wave and both survived re-measurement, so unlike the
six types above they carry a positive corpus measurement rather than an absence.

**`implements` — RULED. Instrument A (the KEY VOCABULARY) plus B (parse-tree counts).**
For JSON the meaningful inventory is not the grammar's 12 named node types but which
strings appear in the `key` field of a `pair`, because that is where every JSON Schema
keyword, manifest field and OpenAPI section name lives. A grammar has no node type for
a keyword any more than for a manifest field — the reasoning that produced four wrong
rulings in this lane before it was recognised. Composition keywords were counted on the
parse tree: `allOf` 1,445 / 84 files, `oneOf` 1,021 / 171, `anyOf` 573 / 58, `not`
206 / 125. Only `allOf` is a superset relation, and it is emitted as `extends`. Of 28
supertype-candidate keys (`implements`, `inheritsFrom`, `superclass`, `base`,
`prototype`, `mixin`, `satisfies`, `conformsTo`, `derivedFrom`, `$extends`, …) only
three occur at all — `extends` 318 / 248 files, `base` 215 / 20, `inherits` 102 / 20 —
and each names a config or manifest field (`tsconfig.json`'s `extends`,
cargo's `base`) rather than a supertype clause.
**Overturn condition:** a corpus file carrying a key that denotes a supertype clause —
something no current schema vocabulary has — would falsify it. Count would overturn it:
≥1 such key.

**`instantiates` — RULED. Instrument B, with the shape/role split that makes the
number mean something.** 274 keys spell a constructor (`new`, `init`, `constructor`,
`__init__`, `instantiate`) and **not one denotes an invocation**. Split by the value's
ROLE: 142 string values (proxicall's i18n key `new`, nvim-treesitter's `constructor`),
100 array values (duckdb's serialization schemas, where `constructor` is a *described
C++ field*), 22 object values, 10 scalars. `new <Identifier>` occurs 5,091 times inside
strings, of which **7** have that identifier also declared as a key in the same file —
every example a JavaScript AST dump or a prose message. A probe that matches a SHAPE
rather than a ROLE produces a number, and the number is worth nothing; that is how the
gate's own first `extends` probe convicted `class voice` inside a telnet IAC word list.
**Overturn condition:** a `pair` whose key is a constructor name and whose value binds
an actual construction — an object whose members are the constructed instance's state.
Count would overturn it: ≥1 such pair.

### The failure mode this lane has now produced six times

`imports`, `exports`, `extends`, `calls` and `overrides` were each ruled out by an
audit that searched for the conventions it **already had in mind**. `calls` was
re-tested against the corpus and passed — for `new Foo` invocations and functions
named `new`, which is the *JavaScript* shape of a call. The npm shape was never among
the conventions imagined, and it carries 213 edges. `extends`'s audit searched for
class-declaration conventions and never for schema-composition ones, so it re-ran the
same instrument on the same question and returned the answer it was looking for. The
rule this leaves: an inapplicability ruling is only as strong as the instrument that
could have found the construct, and for a convention-bearing language the instrument
has to be the corpus, read for conventions you did not already have in mind.

`script/m14/ontology-coverage-gate.ts` re-measures every ruling and fails when a ruled
type's construct occurs. On a 12-repository scoped corpus (3,559 admitted files) it
reports **8 emitted / 2 ruled-sound / 0 falsified / 0 ruled-without-justification**.
On the full 11,713-file population it does not finish: `getParser` reuses one
tree-sitter WASM parser per language and its own comment records that WASM memory
accumulation "causes hangs after ~9,000 parses". Past that point a parse traps with
`memory access out of bounds`, the instance is left unusable, and the next parse on it
hangs to a hardcoded 120 s `process.exit(1)` that takes the whole run down — reproduced
4 times, each on a different file, with the hang always on the first file that trapped.
Those files are not pathological: all 300 files in `graphql-java/performance-results`
parse in 17.1 s (mean 57 ms, slowest 902 ms, 0 failures) in the same process. See §8.

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
3. **`calls` reads a shell command out of a string value.** 213 edges at confidence 0.8,
   the only class in the graph derived by parsing text rather than a tree. A wrapper
   script, a variable callee (`npm run "$TASK"`) or a Makefile-driven pipeline would
   produce no edge, so the count is a floor for the construct and not its extent.
4. **The `overrides` edge cannot name what it overrides.** Both declarations share a
   name and a qualified path, so the prior declaration is carried in `overridesLine`
   and not in an endpoint. A consumer resolving `overrides` by name alone will collapse
   the two rows.
5. **The structural limit is unresolved and is a property of the language.** 64.54% of
   endpoints are ambiguous (see below); no store-side change closes it, and closing it
   needs an analyzer-side decision that is the owner's to take.
6. **The census is a whole-population snapshot, not a stable number.** The corpus grew
   from 10,855 admitted files to 11,713 during this wave, because other lanes are
   cloning repositories into the same root. Counts here carry that timestamp and are
   reproducible only against that corpus state.
7. **Whole-corpus gate runs do not finish above ~9,000 parses** (§ontology). The scoped
   12-repository gate run is the one whose verdict is quoted, and it covers 3,559 of
   11,713 admitted files — so the gate has re-measured 30% of the population, not all
   of it.

## The structural limit: JSON has no names

**64.54%** of relationship endpoints are **ambiguous** — the name they carry is
shared by more than one symbol in the same file. **33.49%** resolve to exactly one
symbol, **1.97%** name none. 56.4% of files have two symbols sharing a name;
309,092 repeated-name instances; the worst is terraform's `plan-redacted.json` with
10,227 repeated instances over 10,245 symbols.

This is a **property of the language**, not a defect: a JSON key is unique only
within its object and the store resolves endpoints by name, so every object in a
JSON array has the same keys. Resolving by `qualifiedName` does not rescue it —
unique by name 32.92%, by qualifiedName 5.25%, **by either 34.92%**. The two
indexes barely compose, because `contains` sources are bare names and `references`
sources are paths, so **no store-side change closes this**. Closing it needs the
analyzer to name an ambiguous endpoint by its path, or to disambiguate duplicated
names after the walk. That is a **decision for the owner**, recorded with its
numbers rather than taken unilaterally.

## Evidence

**Whole admitted population — 11,713 files across 106 repositories**, production
`parseFile` on the analyzer side and `deriveJsonEdges` (lane-owned oracle) over a fresh
parse on the truth side (`validation/m14/fixtures/json/differential.ts`):

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
- **Fixtures** — 11, each pinning both directions. `Arrays.json` forbids containment
  for array scalars; `DuplicateKey.json` pins the `overrides` prior line;
  `SameKeyDifferentObjects.json` is its negative control and exists only to catch an
  unscoped duplicate check; `manifest/package.json` pins `calls`, `exports` and the
  five `calls` shapes that are declined.
- **Mutants** — 7 lane-owned (`script/m14/json-mutants.ts`), **7 caught, 0 survivors**,
  each caught by its intended fixture. `overrides-unscoped-to-file` is the one that
  matters most: it is worth ~5,700 false edges over the corpus.
- **Ontology gate** — 8 emitted / 2 ruled-sound / **0 falsified** (scoped corpus; see
  the WASM note in the ontology section for why the full population does not finish)
- **Differential** — enrolled in F5 with an independent oracle
  (`script/m14/oracles/json.ts`, lane-owned so the shared file is not a fault line).
  Corpora chosen by measurement: `terraform` primary (415 hand-written files, 12
  lockfiles) and `otp` second for its **adversarial** `json_SUITE_data`.
  `clj-kondo` was rejected despite 742 files because 729 are `.transit.json`
  (Clojure, not JSON); `shadcn-svelte` because its 2,369 are mostly
  `package-lock`.
- **Spec** — `script/m14/spec/json-completeness.json`, a written ruling per construct
- **Full record** — `reviews/json/m60-closure.md`, `reviews/json/resolution.md`
