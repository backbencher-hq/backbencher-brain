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
| Edge endpoints | **every relationship type emits QUALIFIED PATHS on both ends**, with one declared fallback. A bare JSON key is ambiguous by construction — a document repeats `name`, `type`, `items`, `properties` relentlessly — and the shared resolver declines a non-unique bare name, so an ambiguous endpoint does not degrade to a wrong answer, it degrades to **no answer**. Measured on a 202-file, 99-repo sample: **32,660 of 66,032 `contains` edges (49.4%)** named a target matching more than one published symbol, **1,119** were self-loops (source string == target string), and **51 corpus-wide** carried an endpoint equal to the literal `unknown`, because a real JSON key is named `unknown` (proxicall's 38 i18n bundles, redis 6, terraform 3, hasura-engine 1). The path is already computed — it is the symbol's `qualifiedName` — and it matches the resolver exactly. |
| Kinds | an **object** is `class`: it has named children and `contains` edges come from it. Everything else is `property`, **including an array** — the analyzer previously called arrays `variable`, importing a shell-shaped mutable-binding distinction JSON does not have. |
| Arrays | a **leaf of scalars, a container of objects and of arrays**. Scalar elements are positional and unnamed: no symbol, no edge. An object element is a `class` named `<array>[i]`, contained by the array, and **its own keys are owned by the element**. An element identified by an index under a KEYED array keeps the key's name (`allOf[0]`); an element of an array that is itself an element is named from its qualified path (`rows[0][0]`), and it gets a symbol of its own because it owns elements. |
| `line_number` | **every relationship carries a positive site line.** It used to carry none: the string did not occur once in the file, so every json edge in the index was stored with a NULL line while symbols carried `range` throughout. The position was known and simply not published. |
| `$ref` | names a **LOCATION**, not a symbol, so the target is the location. Nothing guarantees the name at a location is unique — two documents in one file can each declare `spec` — while the location is. A JSON Pointer is *relative to the document root*, so `#/components/schemas/X` names `<module>.components.schemas.X`. |
| `imports` | a `$ref` naming **another file** is a dependency and emits both `imports` and `references`. A local pointer and a URL are neither: a URL names a **vocabulary** (a JSON-Schema draft identifier), and 38 of the 50 external refs in the corpus are exactly that. |
| OpenAPI | a `/`-prefixed key whose object declares an HTTP method is an endpoint, and the `paths` object `uses` it at 0.8 with `reasonCode`. |
| Manifests | in a `package.json`/`composer.json`, an entry under `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies` is a `uses`. Keyed on the **filename**, so any JSON with a `dependencies` key does not acquire npm semantics. |
| npm scripts | a `scripts` entry invoking a **sibling** entry by name (`npm run <name>`, and `pnpm`/`yarn`/`bun` with `run`/`run-script`/`run-s`) is a `calls`. Declined and pinned with `forbidRelationships`: a target that is not a key of the same `scripts` object (a binary, or another package's script), a self-reference, a **quoted** target (the shell rewrote the argument), and any token that merely *contains* a runner name — `npx` contains `npm`, and a PATH named `npm` is not a runner. npm's implicit `pre`/`post` lifecycle hooks are also not emitted: npm runs them without the command naming them. |
| **Declared types** | a document that declares types and states their supertypes emits `extends` and `implements` from ordinary object keys. Two shapes occur, and both announce themselves before any key is interpreted: LSP's meta-model uses `{"kind":"reference","name":X}` (2 of 11,713 admitted documents), and duckdb's serialization schemas declare a C++ class with a `class` string (21 documents, all duckdb). Without the precondition the emitter would fire on every JSON file. |
| Documents | a document may hold an object, an array, or **several values** — concatenated JSON is real input (kubernetes' `hack/testdata` holds it) and every top-level value is walked. |
| Duplicate keys | a key declared **twice in one object** is a redefinition — the second replaces the first under every mainstream parser — and emits `overrides` in the **bash lane's** shape: source is the owner symbol, target the key, and `overridesLine` carries the prior line, because both declarations share one name *and* one qualified path and the line is the only thing that distinguishes them. Scoped to the **object**: the same key in two different objects is not a redefinition, and that is the corpus's dominant shape (120,174 occurrences across 7,679 files against 21 genuine duplicates). An **empty** key is declined (10 occurrences, every one a document the grammar recovered with ERROR nodes). |
| Invalid input | errors are engine-owned and surfaced; the module symbol is still emitted so a consumer can attribute the failure to a file. |
| Regex | **zero regex literals**, enforced by `script/m12/json-contract-probe.ts` rather than asserted, and scanned with comments and strings stripped. The analyzer never reads the file as text: every decision comes from the tree. |

## Relationship ontology — 9 of 10 emitted, 1 ruled, every verdict measured

Whole admitted population through production `parseFile`
(`validation/m14/fixtures/json/census.ts`).

| type | verdict | edges | files | both endpoints resolve | confidence min | reason code |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `contains` | EMITTED | 3,881,840 | 12,040 | 100.00% | 1.0 | — |
| `references` | EMITTED | 15,017 | 159 | 98.55% | 0.8 | `json_schema_ref` / `ref_target_not_declared_in_document` |
| `uses` | EMITTED | 5,758 | 470 | 100.00% | 0.8 | `openapi_path_entry_declares_http_method` |
| `extends` | EMITTED | 1,721 | 94 | 99.83% | 1.0 | `json_schema_all_of` / `declared_supertype` |
| `exports` | EMITTED | 513 | 217 | 100.00% | 1.0 | — (`evidenceClass: structural`) |
| `calls` | EMITTED | 217 | 81 | 100.00% | 0.8 | `npm_run_sibling_script` |
| `implements` | EMITTED | 113 | 1 | 100.00% | 0.9 | `declared_interface_mixin` |
| `overrides` | EMITTED | 22 | 12 | 100.00% | 1.0 | — (`evidenceClass: structural`) |
| `imports` | EMITTED | 67 | 20 | 0.00% (see below) | 1.0 | — (`evidenceClass: structural`) |
| `instantiates` | RULED | 0 | — | — | — | — |

`imports` resolving at 0% is **correct, not a defect**: an `imports` target names
another FILE (`v0.0.1/dsse_v0_0_1_schema.json`), and a file in another file is not a
symbol in this one. All 67 have a resolvable source. It is the one type whose endpoint
is deliberately not a symbol.

**Edges below the 0.7 heuristic threshold: 0 of 3,905,268.** Sub-1.0 edges are
`calls` (217, all 0.8), the 218 `references` whose target did not resolve (0.8), and
the OpenAPI-endpoint `uses`. Every one of them carries a machine-readable
`reasonCode`, which honesty contract §4 point 1 requires and which the previous
version of this analyzer did **not** provide — 453 `uses` and 16 `references` edges
sat below 1.0 with neither a `reasonCode` nor an `evidenceClass`, measured on a
2,343-file stride sample. That is fixed; `contains` and the 4,741 dependency `uses` still carry no
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

### What each type means in JSON

- **`contains`** — the object a key is written in contains that key. The only relation
  the *format* defines; 99.4% of the lane's graph.
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
**Measured: 0 occurrences over 11,713 admitted files** —
`validation/m14/fixtures/json/ruling-table.ts`.

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
gate's own verdict logic and reports, on a 1,952-file / 4-repository corpus:

```
emitted 9/10   ruled-sound 1   FALSIFIED 0   ruled-without-justification 0
grammar node types observed across the corpus: 20
```

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
9. **The parser traps, and the gate's exit code does not mean what it looks like.**
   Four corpus files make the WASM parser trap `memory access out of bounds`
   (`clj-kondo/…/java.util.Properties.transit.json`, `ghostty/build.zig.zon.json`, and
   two kubernetes `testdata` files) — and `rc.json` among them **parses cleanly under
   `JSON.parse`**, so no validity filter excludes it. A trap leaves the pooled parser
   unusable and the next parse on it hangs to a hardcoded 120 s `process.exit(1)`.
   `validation/m14/fixtures/json/trap-scan.ts` enumerates them by discarding a poisoned
   slot instead of reusing it. Two consequences: **the whole-population ontology gate run
   does not finish**, and a scoped run can print a passing verdict table and still
   `exit 1`, because a stale watchdog fires after the table. Read the table, not the
   code.
10. **The census is a whole-population snapshot, not a stable number.** The corpus is
   shared and other lanes clone into it: this lane's admitted population moved from
   **11,713 files / 106 repositories** at pass 1 to **12,543 files** by 2026-10-03, and
   `contains` from 2,107,562 to 3,881,840 edges. Numbers here carry that timestamp.
   **Two pass-1 figures did not reproduce and are corrected above**: the repository count
   (106 → 114 at the 11,713-file state, 12,543 files after), and the supertype-key
   census, which reported "only three occur at all" when `parent` (293 occurrences / 17
   files), `mixins` (88 / 2) and `interface` (1 / 1) also occur. Every EDGE count in the
   pass-1 table reproduced to the digit at the pass-1 corpus state.

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

**Whole admitted population**, production `parseFile` on the analyzer side
(`validation/m14/fixtures/json/census.ts`): **12,543 admitted files**, 3,894,382 symbols,
**3,905,268 relationships**, 0 parse failures, **0 symbols with an empty name, 0 with an
empty or unknown kind**, **0 endpoints equal to the literal `unknown`**, 0 edges below the
0.7 heuristic threshold. Kinds: `property` 2,541,967 / `class` 1,339,873 / `module`
12,542 — one file short of the population, and the file is named in §limitation 8.

**Differential**, production `parseFile` against `deriveJsonEdges` over a fresh parse
(`validation/m14/fixtures/json/differential.ts`). Two runs, because the second is the one
that covers the inheritance evidence and the first is the wider corpus:

| | files | truth | covered | MISSING | UNEXPLAINED | files matching exactly |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 12 repositories (openapi-spec, postgrest, docker, terraform, kubernetes, svelte, apollo-server, duckdb, otp, vault, graphql-js, vega) | 3,272 | 846,762 | 846,762 (100.00%) | **0** | **200** | 2,878 of 2,897 |
| 4 repositories (dart-sdk, duckdb, openapi-spec, hasura-engine) | 1,952 | 526,510 | 526,510 (100.00%) | **0** | **65** | 1,891 of 1,909 |

Per label, on the 4-repository run chosen for the inheritance evidence:

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

- **Contract probe** — 28/28 (`script/m12/json-contract-probe.ts`, reads production),
  including the zero-regex check
- **Fixtures** — 14, each pinning both directions. `Arrays.json` forbids containment for
  array scalars; `ArrayInArray.json` exists because the array-inside-an-array shape had no
  fixture and had a defect; `DuplicateKey.json` pins the `overrides` prior line;
  `SameKeyDifferentObjects.json` is the duplicate check's negative control;
  `Inherit.lsp.json` and `Inherit.duckdb.json` pin both inheritance shapes and their four
  declined forms; `manifest/package.json` pins `calls`, `exports` and the five `calls`
  shapes that are declined.
- **Mutants** — 14 lane-owned (`script/m14/json-mutants.ts`), **14 caught, 0 survivors**.
  Two matter most: `overrides-unscoped-to-file` is worth ~5,700 false edges over the
  corpus, and `array-item-named-from-bare-array-name` is the shape that hid for a whole
  wave behind two agreeing implementations.
- **Ontology gate** — 9 emitted / 1 ruled-sound / **0 falsified**, via
  `validation/m14/fixtures/json/ruling-table.ts` on a 1,952-file corpus. The shared gate
  cannot report this lane's table until the wiring in §*Ruling table* lands, and the
  whole-population run does not finish at all (§limitation 8).
- **Differential** — enrolled in the shared F5 harness with an independent oracle
  (`script/m14/oracles/json.ts`, lane-owned so the shared file is not a fault line).
  Corpora chosen by measurement: `terraform` primary (415 hand-written files, 12
  lockfiles) and `otp` second for its **adversarial** `json_SUITE_data`.
  `clj-kondo` was rejected despite 742 files because 729 are `.transit.json`
  (Clojure, not JSON); `shadcn-svelte` because its 2,369 are mostly
  `package-lock`.
- **Spec** — `script/m14/spec/json-completeness.json`, a written ruling per construct
- **Full record** — `reviews/json/m60-closure.md`, `reviews/json/resolution.md`

## Six questions, per emitted type

They fail independently, and the numbers are per type rather than per lane.

| type | Exists | Fires | Correct (oracle) | Labelled | Resolved | Confident |
| --- | --- | --- | --- | --- | --- | --- |
| `contains` | yes | 3,881,840 | 522,304/522,304 = 100.00% | containment is the format's only relation; the array-in-array source was wrong and is fixed | 100.00% | 1.0, no reason code needed |
| `references` | yes | 15,017 | 2,713/2,713 covered; **65 UNEXPLAINED** | `$ref` names a LOCATION — the lane's stated contract; a bare `"$ref": "#"` (220 corpus-wide) targets the document root and both readings are arguable | 98.55%; the 218 misses are pointers to undeclared locations, at 0.8 with a reason code | 1.0 / 0.8, both with `reasonCode` |
| `uses` | yes | 5,758 | 892/892 = 100.00% | two sites with different warrant: a manifest DEPENDENCY is a use; an OpenAPI endpoint `uses` is arguable — the same pair already has a `contains` edge — and is held at 0.8 for that reason | 100.00% | 1.0 (deps) / 0.8 (endpoints, `openapi_path_entry_declares_http_method`) |
| `extends` | yes | 1,721 | 421/421 = 100.00% after two fixes (array-in-array, oracle walk order) | `allOf` is the one superset keyword; `anyOf`/`oneOf`/`not` correctly emit nothing. **The strongest argument against the label is the strongest one available**: in type theory `allOf` is an INTERSECTION, so the composed schema is a SUBTYPE, and "extends" reads the other way. It is kept because the workstream's `overrides` precedent accepts the language's own reading of a relation | 99.83% | 1.0, `json_schema_all_of` / `declared_supertype` |
| `implements` | yes | 113 | 113/113 = 100.00% | LSP `mixins` = interfaces. Held at 0.9 because the mapping is a naming decision, not a parse fact | 100.00% | 0.9, `declared_interface_mixin` |
| `exports` | yes | 513 | 26/26 = 100.00% | a manifest's published entry point IS an export; the strongest counter is that `main`/`bin` name FILES, so `imports` would fit — declined because a file the manifest does not list as a dependency is not a declared symbol | 100.00% | 1.0, `evidenceClass: structural` |
| `calls` | yes | 217 | 5/5 = 100.00% | both endpoints are keys of ONE `scripts` object, so this is not a cross-file name guess. The strongest counter is that it is derived from a STRING by a CLI convention, which is why it is 0.8 and not 1.0 | 100.00% | 0.8, `npm_run_sibling_script` |
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