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
| Module identity | the file's basename **without** its extension (`Basic.json` → `Basic`). Differs from bash, which keeps the extension (`Deploy.sh`); both self-consistent. |
| Symbol identity | a `pair` key is a symbol named by its key. Its **owner is the parent SYMBOL's name**, never its qualified path — a path is a fine identity and a useless endpoint, because the store resolves by name. The path lives in `qualifiedName` and in edge metadata, where nothing has to resolve it. |
| Kinds | an **object** is `class`: it has named children and `contains` edges come from it. Everything else is `property`, **including an array** — the analyzer previously called arrays `variable`, importing a shell-shaped mutable-binding distinction JSON does not have. |
| Arrays | a **leaf of scalars, a container of objects**. Scalar elements are positional and unnamed: no symbol, no edge. An object element is a `class` named `<array>[i]`, contained by the array, and **its own keys are owned by the element**. An element is identified by its index *under the array*, and the array is named by the key it was written under — never derived from a path, which is correct only while the module name has no dot. |
| `line_number` | **every relationship carries a positive site line.** It used to carry none: the string did not occur once in the file, so every json edge in the index was stored with a NULL line while symbols carried `range` throughout. The position was known and simply not published. |
| `$ref` | names a **LOCATION**, not a symbol, so the target is the location. Nothing guarantees the name at a location is unique — two documents in one file can each declare `spec` — while the location is. A JSON Pointer is *relative to the document root*, so `#/components/schemas/X` names `<module>.components.schemas.X`. |
| `imports` | a `$ref` naming **another file** is a dependency and emits both `imports` and `references`. A local pointer and a URL are neither: a URL names a **vocabulary** (a JSON-Schema draft identifier), and 38 of the 50 external refs in the corpus are exactly that. |
| OpenAPI | a `/`-prefixed key whose object declares an HTTP method is an endpoint, and the `paths` object `uses` it. |
| Manifests | in a `package.json`/`composer.json`, an entry under `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies` is a `uses`. Keyed on the **filename**, so any JSON with a `dependencies` key does not acquire npm semantics. |
| Documents | a document may hold an object, an array, or **several values** — concatenated JSON is real input (kubernetes' `hack/testdata` holds it) and every top-level value is walked. |
| Invalid input | errors are engine-owned and surfaced; the module symbol is still emitted so a consumer can attribute the failure to a file. |
| Regex | **zero regex literals**, enforced by `script/m12/json-contract-probe.ts` rather than asserted, and scanned with comments and strings stripped. The analyzer never reads the file as text: every decision comes from the tree. |

## Relationship ontology — 5 of 10, and the 5 exclusions are audited

`contains`, `uses`, `references`, `imports`, `exports` are **EMITTED**.
`extends`, `implements`, `instantiates`, `calls`, `overrides` are **RULED**: the grammar yields **12 named types** —
`array comment document escape_sequence false null number object pair string
string_content true` — and **none** expresses a class declaration, a supertype
clause, a constructor, a function or a redefinition.

`script/m14/ontology-coverage-gate.ts` re-measures that on every run and **fails**
when a ruled type's construct actually occurs, so a ruling is falsifiable rather than
asserted. It has earned its keep twice: it falsified this lane's own first rulings on
`imports` and on `exports`, **both of which had been made on a grammar inventory** —
the reasoning that a grammar cannot see a CONVENTION, and a Node manifest's `exports`
field is a convention written as ordinary object keys. The five surviving exclusions
were then re-tested against the **corpus** for a convention that would satisfy them,
not against the grammar again, and all five held.

The contrast with bash is the point: bash emits 7 of 10 and rules 3 on a
164-node-type inventory; **json emits 5 of 10 and rules 5 on a 12-node-type
inventory.** Same ontology, same gate, opposite verdicts, neither arbitrary.

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

Whole corpus — **3,334 admitted files** across 6 repositories, production
`parseFile`:

| | |
| --- | --- |
| truth edges (independent oracle) | 772,376 |
| covered | **772,376 (100.0%)** |
| MISSING / unlined | **0 / 0** |
| UNEXPLAINED | **3** — external refs the oracle deliberately does not assert |
| files with truth edges | **2,201** == files emitting any edge |

- **Contract probe** — 28/28 (`script/m12/json-contract-probe.ts`, reads production)
- **Fixtures** — 7, each pinning both directions; `Arrays.json` forbids containment
  for array scalars so an analyzer emitting it cannot pass
- **Mutants** — 6, all CAUGHT; **all 1,148 project-wide, 0 survivors**
- **Ontology gate** — 4 emitted / 6 ruled-sound / **0 falsified**
- **Differential** — enrolled in F5 with an independent oracle
  (`script/m14/oracles/json.ts`, lane-owned so the shared file is not a fault line).
  Corpora chosen by measurement: `terraform` primary (415 hand-written files, 12
  lockfiles) and `otp` second for its **adversarial** `json_SUITE_data`.
  `clj-kondo` was rejected despite 742 files because 729 are `.transit.json`
  (Clojure, not JSON); `shadcn-svelte` because its 2,369 are mostly
  `package-lock`.
- **Spec** — `script/m14/spec/json-completeness.json`, a written ruling per construct
- **Full record** — `reviews/json/m60-closure.md`, `reviews/json/resolution.md`
