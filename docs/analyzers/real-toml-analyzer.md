# real-toml-analyzer.md

> **Canonical contract doc for the toml lane.** The rulings and why each was taken
> live in the analyzer's own header comment and in the completeness spec; this file
> is the reference: what it emits, what it refuses to emit, and the measurements
> behind both.
>
> **Ontology sweep (M14 laptop B, `analyzer/TOML`).** Every relationship type now
> carries a verdict with a number, and each ruled type carries the instrument, the
> probe and the condition that would overturn it. Section "The ten types, verdict
> by verdict" is that table. Two defects the census found are fixed and pinned;
> four are recorded as findings with their counts.

## Language

| | |
|---|---|
| Grammar | `wasm/tree-sitter-toml.wasm`, 25,436 bytes, sha256 `7849ac8ce9d10a46…`. Source `@tree-sitter-grammars/tree-sitter-toml`, obtained as a **redistributor collection build** (`tree-sitter-wasms`), so `versionKind: redistributor-collection` and `versionIsComparableToUpstreamGrammar: false` — the M60 survey records it that way on purpose, because a collection build states a collection version and comparing it to an upstream grammar version would yield a false "behind" |
| Node types | **20 distinct types observed across the census**, measured: the 19 named types the grammar declares (`escape_sequence` occupies two `nodeTypeForId` slots) plus `ERROR`. `MISSING` is **0** across 1,141 files. The census is `verification/m14/fixtures/toml/census.ts`, phase `bc` |
| Completeness | `script/m14/spec/toml-completeness.json` — **21/21 classified, gap list empty**: 17 handled, 3 silent, 1 design decision (19 grammar types plus the universal `ERROR`/`MISSING` pair) |
| Analyzer | `src/ast/real-toml-analyzer.ts` |
| Corpus | 1,141 git-tracked `.toml` files across **56** repositories; largest is `cargo` @ `94faf91`, **684** files |
| Tracking | #289 |

**The lane entered with a grammar and nothing else.** `toml` was absent from
`getAnalyzer`, so a `.toml` file was walked by the generic AST fallback. A ten-line
Cargo.toml published **28 symbols and 0 relationships**, every one `kind=variable`
with `owner=null`; **11 of the 28 names contained whitespace** — one was literally
`[package]\nname = "demo"\nversion = "0.1.0"\n\n` — and two collided. A name is an
identity, and source text is not one.

## Symbol contract

**A symbol is the FILE, a TABLE, or a KEY.**

| Input | Result |
|---|---|
| the file itself | one `module`, named from the file **stem** — `Cargo.toml` is `Cargo`, never `Cargo.toml` |
| `[table]` or `[[array-of-tables]]` | a `namespace` |
| `key = value` | a `property`, owned by the table that declares it |
| `class`/`kind` of a VALUE | **nothing** — a value is data, recorded as `metadata.valueType` on its key |
| an inline table's keys | **nothing** — recorded on the key in `metadata.inlineKeys` |
| a comment | **nothing** — a comment is not an identity |

**A symbol's NAME is its full dotted path from the document root.** So
`[workspace.lints.rust]` is ONE symbol named `workspace.lints.rust`, and a key
`rust-version` inside `[workspace.package]` is `workspace.package.rust-version`.

Not the leaf segment, because the first manifest anyone writes collides: cargo's own
contains a key literally named `name` under `[package]` **and** under every `[[bin]]`.
The full path is also what makes a file's names unique, which is the property that
otherwise needs a synthetic suffix on every collision.

A segment containing `.`, `"` or `\` is written back **in quotes**, which is TOML's
own disambiguation. Inside `[t]`, `a.b.c` and `"a.b".c` are *different* keys — three
nested tables versus a table literally named `a.b` — and assembled naively both
produce `t.a.b.c`, after which the dedupe invents `t.a.b.c#2` and asserts the
document declared one key twice when it declared two distinct ones. The quoted form
round-trips; the bare form stays bare.

| Field | Value |
|---|---|
| `kind` | `module` / `namespace` / `property` — the three that mean what they say here |
| `ownerName` | the nearest **declared** table, or the module for a key before any header |
| `visibility` | `public` — a configuration document has no private/package/protected |
| `range` | a table spans its **whole section**, `[` to the line before the next header, so a key's range always falls inside its table's |
| `line_number` | 1-based, byte-accurate, never fabricated `0` |

**The module owns its name in its own file.** `doc/book/book.toml` — a real cargo
file — declares `[book]`, so the module and the table would both be `book`, and
relationships address nodes by *name*: every `contains` edge naming it would resolve
to two nodes. The module's name is derived from the file's **path** and is not
negotiable, so the table takes the suffix. This is html's precedence exactly (its
`usedNames` starts `{ [moduleName]: 1 }`), and the rule was found by the **corpus**:
2 collisions in 684 files, both of the form `<stem>.toml` containing `[<stem>]`.

**Implied parents are recorded, not materialised.** `[a.b.c]` implies `a` and `a.b`
whether or not the file declares them. They land in `metadata.impliedParents`; no
symbol is invented for a header the document never wrote.

**Empty keys produce nothing, at every level.** `"" = 1` parses but names nothing,
because an identity needs a name. That decision was pinned at the document root
where a guard existed, and the in-table path did not have one — see
"Defect D2" below, which the corpus found at `pb-grpc/pyproject.toml:53`.

**Declaration order is not significant.** TOML v1.0.0 requires no super-table to be
written first, so `[a.b]` above `[a]` is valid and `a.b` is inside `a`. The walk
resolves an owner against the **whole** declared-table map, in a second pass —
see "Defect D1" below.

## Relationship ontology

TOML's relationship vocabulary is `contains`, **and that is the whole truth** — now
established by measurement rather than by assertion, with each of the other nine
types carrying a falsifiable ruling (next section).

| Label | Emitted for | Confidence | Tier |
|---|---|---|---|
| `contains` | the module → its top-level tables and root keys; a table → its keys and sub-tables | 1.0 | `structural` |

There is no second type, and inventing one would be worse than a thin graph.

## The ten types, verdict by verdict

Corpus: **1,141** git-tracked `.toml` files, 56 repositories, admitted by the same
rule the arbiter uses (`git ls-files`, `detectLanguageFromPath === "toml"`, ≤512 KB).
Every analyzer count comes from production `parseFile`, not from `analyze()`.
Harness: `validation/m14/fixtures/toml/census.ts`.

| Type | Verdict | Count | Instrument, probe, and what would overturn it |
|---|---|---|---|
| `contains` | **EMITTED** | **19,087** edges, 100% resolved at both ends | See "The six questions" |
| `calls` | **RULED** | 0 | **A: grammar-inventory.** The corpus yields **20** distinct node types (§Language) and none is a function definition, method, or call. **Overturn:** a node type expressing a callable appearing in the inventory — `function_definition`, `call_expression`, `lambda`, `macro_invocation` |
| `uses` | **RULED** | 0 | **A** (no value-evaluating node type) **+ B: parse-tree-count**, two probes. (i) A key named one of `uses, using, interpolate, interpolation, template, expr`: **1** occurrence in 1,141 files — `proxicall/supabase/config.toml:137`, `template = "Your code is {{ .Code }} ."`, a Go template carried as a string value. (ii) A `string` value containing an interpolation marker (`${`, `{{`, `%(`, `$(`): **366** occurrences in 155 files, and every one inspected is a *template for another tool* rendered before TOML ever reads it — `redwood/__fixtures__/.../redwood.toml:10` `"${WEB_DEV_PORT:8910}"` is a JS template, `traefik/integration/fixtures/acme/acme_base.toml:15` is Go's `{{range}}`. **Overturn:** the grammar producing an interpolation node, or a corpus file whose consumer reads a TOML value as already-interpolated |
| `imports` | **RULED** | 0 | **B: parse-tree-count**, two probes. (i) A value naming a file that EXISTS on disk relative to the manifest: **216** hits in 68 files, broken out by target extension — `.rs` 146, `.md` 24, no-extension 12, `.txt` 10, **`.toml` 7**, `.py` 5, and 12 more of one each. (ii) The decisive sub-probe, a value naming another **`.toml`** file that exists: **7** hits in 4 files — `cabal/.typos-srcs.toml:6,7` (`extend-exclude` listing typos' own config files), `cargo/triagebot.toml:174,176,178` and `ghostty/typos.toml`, `pb-grpc/examples/python/ruff.toml`. Every one is a **list of files a tool is told about**, which is the shape the arbiter's own header warns about ("a probe that matches a SHAPE rather than a ROLE produces a number, and the number is worth nothing"). **Overturn:** a `.toml` value that a TOML parser is documented to splice into the document |
| `references` | **RULED** | 0 | **A** (no reference node type) **+ B**, two probes. (i) A key named one of `$ref, ref, refs, reference, references, anchor, alias, target, points_to, link`: **169** hits in **6** files, broken out — `ref` 167, `target` 2. 167 of the 167 `ref` hits are `version.ref = "<name>"` in five Gradle `libs.versions.toml` version catalogues, and the 2 `target` hits are `target = "cgroup1/stats/metrics.pb.txt"` in `docker/vendor/.../Protobuild.toml`. (ii) Cargo's workspace inheritance, `x.workspace = true`: **1,269** hits in 138 files. **See "The two measurements `references` is most likely to be argued about"** — these are real dependencies and they are deliberately not emitted, with the reason stated there. **Overturn:** a TOML-v1.0.0 clause assigning meaning to a key whose value names another key |
| `exports` | **RULED** | 0 | **A** (no module surface) **+ B**, two probes. (i) A key named one of `export, exports, expose, exposed, pub, public, publish, main, module, mod, entrypoint`: **144** hits in 65 files — `module` 71, `publish` 49, `main` 16, `public` 6, `exposed` 2. (ii) A `[lib]`/`[[bin]]`/`[[bench]]`/`[[test]]`/`[[example]]` section carrying `name`, `path` or `crate-type`: **173** hits in 90 files. The `publish` hits are `publish = false`, a crates.io flag; the build-target hits name what cargo *builds*, and a crate's public surface is its Rust source, not its `Cargo.toml`. **Overturn:** a construct that publishes a name to a consumer of the document |
| `extends` | **RULED** | 0 | **A** (no type declaration, so nothing to extend) **+ B**. A key named one of `extends, extend, extends_from, inherits_from, base, parent, superclass, derived_from, template`: **13** hits in 12 files — `base` 11, `extend` 1, `template` 1. All 11 `base` hits are `base = "my_base"` in `cargo/tests/testsuite/cargo_add/*/Cargo.toml`, where `--base` names a **git branch baseline** for `cargo add`, not a supertype. **Overturn:** a header or key whose declaration says "this entity IS-A that one" |
| `implements` | **RULED** | 0 | **A** (no supertype clause, no interface node) **+ B**. A key named one of `implements, implement, implements_from, iface, interface, contracts`: **0** occurrences in 1,141 files. **Overturn:** a non-zero count |
| `overrides` | **RULED** | 0 | **B: parse-tree-count**, three shapes counted separately because they are three semantics. (i) A `table` header path declared 2+ times: **1** occurrence in 1,141 files — `traefik/docs/content/reference/static-configuration/file.toml:650`, `[core]` duplicating line 7. **This is the one shape with override-like reading, and it is reported rather than buried**: TOML v1.0.0 *forbids* redefining a table, so the document is invalid rather than the second body winning — the arbiter would call this FALSIFIED on the count alone, and the honest reading is that the corpus contains one spec violation, not one override. (ii) A key path declared 2+ times **inside one section**: **0**. (iii) A `[[array-of-tables]]` header declared 2+ times: **96** in 66 files, and TOML **appends** to the array, so nothing is replaced. **Overturn:** a TOML v1.0.0 clause defining replacement semantics for a redeclared table or key |
| `instantiates` | **RULED** | 0 | **A** (no constructor or `new` node type) **+ B**. A key named one of `new, instantiate, instantiates, construct, constructor, factory`: **0** occurrences in 1,141 files. **Overturn:** a non-zero count |

### The two measurements `references` is most likely to be argued about

**1,269 `x.workspace = true` and 167 `version.ref = "<name>"` are real dependencies
between keys of one document, and this lane does not emit them.** That is the whole
argument, stated so it can be rejected:

- The dependency is genuine. `package.version.workspace = true` means the effective
  value of `package.version` **is** `workspace.package.version`'s. A consumer that
  wants the value has to follow it.
- TOML v1.0.0 assigns it no meaning. `workspace` is a bare key; `true` is a
  boolean. In a document that is not a `Cargo.toml` the same two tokens carry no
  inheritance at all, and the same is true of `ref` outside Gradle's catalogue
  format. The reading is **Cargo's** and **Gradle's**, not TOML's.
- Emitting them requires importing ecosystem knowledge — *which keys inherit in
  which tool* — into a format that defines no reference mechanism. The analyzer's
  own header already refuses that trade for a path-shaped string, and the trade does
  not change because the value here is a boolean instead of a path.
- The populations are small and single-tool: 1,269 hits in 138 files are Cargo's,
  and 167 of the 169 marker hits are in 5 Gradle catalogues. A rule keyed on them
  would fire on any TOML file in any other tool that happens to use those key names.

**What would overturn this ruling, stated so it can be applied without
re-deriving it.** A per-dialect layer, keyed on the TOML *dialect* rather than on
TOML, emitting one edge per occurrence:

| Rule | Source → target | Type | Count it would add |
|---|---|---|---|
| `Cargo.toml` + a pair whose leaf is `workspace` and whose value is `true` | that key | `[workspace.<table>]` with the matching leaf, e.g. `workspace.package.version` | **1,269** in 138 files |
| `libs.versions.toml` + a pair whose leaf is `ref` under `version` | that pair | `[versions].<string value>` | **167** in 5 files |

That layer needs an oracle in `deriveTomlEdges` (`script/m14/differential.ts`) to be
audited at all, and that file is supervisor-owned. **Until it exists, toml has 1
DERIVATION finding for any such edge, which is the reason this lane emits none.**

## The six questions for `contains`

Each fails independently, so each is measured separately. The corpus is 1,141
files; every count is production `parseFile`.

| Question | Measurement | Verdict |
|---|---|---|
| **1. Exists** — the analyzer can construct it | `relationships.push` at two sites in `real-toml-analyzer.ts`: the table header and the key. Both reachable from the document's own children | Constructible, and the reachability is not conditional |
| **2. Fires** — it produces edges on real code | **19,087** edges across **1,141 of 1,141** files. The lowest per-file count is 1; there is no branch that a corpus file fails to reach | Fires on every admitted file |
| **3. Correct** — an independent oracle agrees | `deriveTomlEdges`: `cargo` 60-file draw **416/416 (100%), MISSING 0, unexplained 0**; `cargo` at 657-file depth **5,515/5,515 (100%), MISSING 0, unexplained 0**; `ripgrep` 13-file draw **344/344 (100%), MISSING 0, unexplained 0**. **The oracle is a second walker over the same grammar, so a grammar bug shared by both paths is invisible to it** — the limit is declared here and in the oracle's own header | Conforms on every draw; the declared limitation stands |
| **4. Labelled** — the right type, not a neighbour | 19,087 of 19,087 are `contains`. Zero edges carry any other label. The lane's declared confusions (`uses` vs `references` vs `calls`, `extends` vs `implements`) cannot arise: those labels are emitted nowhere | One label, no confusion to check |
| **5. Resolved** — both endpoints bind to real symbols | **19,087 / 19,087 = 100.0%** at both ends. 0 unresolved sources, 0 unresolved targets, 0 endpoints equal to the literal `unknown`. Against the CSS `references` reference point of 66.8%, this is a containment graph with nothing dangling in it | 100% |
| **6. Confident** — `evidenceClass` and confidence are right | 19,087 / 19,087 carry `confidence: 1.0` and `evidenceClass: "structural"`. **Heuristic edges (confidence < 0.7): 0.** 0 edges with `line_number <= 0`; 0 self-edges; 0 empty symbol names; 0 empty `SymbolKind`s; 0 files with a duplicate symbol name | All deterministic, none countable as a guess |

### DERIVATION findings

**Zero, and unchanged.** `deriveTomlEdges` derives `contains` and the lane emits
`contains` and nothing else, so every edge the analyzer produces is audited by the
differential. This is the property the two `references` measurements above would
destroy: an emitted type with no oracle is stored and compared against nothing.

## Defects the census found

Two fixed and pinned here; four recorded with their counts. The census is what
found all six — the differential could not, and for D1 it actively could not.

### D1 — an out-of-order super-table was filed under the FILE · FIXED

`ansible/pyproject.toml` declares `[tool.setuptools.dynamic]` on line **45** and
`[tool.setuptools]` on line **49**. TOML v1.0.0 requires no super-table to be
written first, so the section is inside the table — but the owner was resolved from
a document-order map, so `tool.setuptools.dynamic` was published with
`ownerName = pyproject` and its `contains` edge ran from the module.

**1 occurrence in 1,141 files.** The symbol's *name* was always right; only the
containment was wrong, which is the same defect class the lane's `resolveOwner`
comment already records for quoted segments.

**The oracle has the identical bug** — `deriveTomlEdges` builds its `declared` map
in document order — so F5 differential **agreed with the analyzer and could not see
it**. This is the shared-premise class the oracle's own header says it cannot catch,
found by an instrument that consults neither side.

Fixed by a second pass over the sections already emitted, using the whole
declared-table map. It cannot loop: an owner is always a strict **prefix** of the
section's own path. Pinned by `toml/declaration-order-and-empty-keys` and by
mutant `toml/declaration-order-second-pass-disabled`.

### D2 — an empty key inside a table published a name ending in a bare `.` · FIXED

`pb-grpc/pyproject.toml:53` — `[tool.setuptools.package-dir]` followed by
`"" = "src/python/grpcio"` — published the symbol **`tool.setuptools.package-dir.`**.
The in-table path is built as `${table}.${key}`, `segmentsOf` dropped the empty
segment, and the result was a name TOML cannot parse back. The document-level path
had a guard and the in-table path did not: **two halves of one rule, disagreeing.**

**1 occurrence in 1,141 files.** Production never showed the edge: the leaf after the
trailing `.` is empty, so `filterNoiseRelationships` dropped it. The **symbol** is
published, and a symbol is what search, the docs engine and the store index.

The lane's own oracle already had it right — `spell("")` returns `""` and its
`segmentsOf` does not filter — so the two disagreed by exactly one edge on exactly
one file, and neither of the lane's two differential corpora contains that file.
`validation/m14/fixtures/toml/oracle-diff.ts` runs both sides on both files and
reproduces it.

Fixed by keeping an empty segment as a segment (so `spellSegment("")` renders it
`""` and the path round-trips) and asking `namesSomething` of every key at every
level, which is the lane's recorded ruling applied uniformly rather than at one
level. Pinned by `toml/declaration-order-and-empty-keys` and by mutant
`toml/empty-key-fix-reverted`.

### D3 — a valid edge dropped in production by a cross-language filter · REPORTED

`ansible/pyproject.toml:41` — `"CI: Azure Pipelines"` is a legal quoted TOML key.
The analyzer emits `contains project.urls → project.urls."CI: Azure Pipelines"`, and
production **does not return it**.

`extractLeaf` in `filterNoiseRelationships` (`src/ast/pool-worker.ts:541`) splits a
target on `:` and then on `.`. For this target the segments are
`['project.urls."CI', ' Azure Pipelines"']`, so the leaf is `" Azure Pipelines"`,
which trips `leaf.startsWith(" ")` at line 595 and the edge is dropped. The colon
split is an Objective-C selector-arity accommodation, documented in that function's
own comment, and it is applied to every language.

**1 of 19,088 analyzer-emitted edges lost in production, 1,141 files.** Phase `e` of
the census measures the two sides side by side; the lane's own header records the
same lesson for bash ("the m12 corpus measurement read `analyze()` directly, not
`parseFile`").

`src/ast/pool-worker.ts` is shared machinery and this lane does not edit it. The
one-line need is in the report to the supervisor.

### D4 — pairs inside an ARRAY of inline tables are recorded nowhere · RECORDED

`metadata.inlineKeys` is filled only when a value's own type is `inline_table`. A
`pair` inside an **array** of inline tables is therefore recorded in no field.
**2,115 pairs in 296 files.** Not an edge defect — the inline-table ruling stands —
but a metadata gap with a count.

### D5 — `ERROR` nodes: 16 files, not 2 · RECORDED

Earlier pages of this document and the completeness spec said `ERROR` occurs in
**2 of 743** files, measured against cargo's `invalid_manifest` fixtures. The corpus
is now 1,141 files and **203 `ERROR` nodes occur in 16 of them**: the 2 cargo files
plus 14 of `traefik`'s Go-template fixtures
(`traefik/integration/fixtures/acme/acme_base.toml:15` and its siblings, where
`{{range $name, $resolvers := .Acme }}` is Go's template syntax in a file the
traefik documentation treats as TOML). `MISSING` holds: **0** across 1,141 files.

### D6 — a module name may carry a leading `.` · NOT A DEFECT, RECORDED

**16 files** publish a module named `.gitleaks`, `.typos`, `.pip-tools`. The module
name is the file's **stem**, so a dotfile yields a leading dot. The first version of
the D2 probe conflated this with a trailing dot and reported 17 defects; every one
was a dotfile. The shape is correct and the probe was wrong, and both are recorded.

## Noise-elimination contract (what produces NO edges)

| Input | Why no edge |
|---|---|
| a value of any type | data, not a dependency — recorded as `metadata.valueType` on its key |
| an inline table's keys | part of one value expression; recorded in `metadata.inlineKeys` |
| a path-shaped string (`path`, `include`, `manifest_path`) | TOML has no reference mechanism, so a path is a string, not a fetch |
| a Cargo/Gradle convention (`workspace = true`, `version.ref`) | a tool's rule, not TOML's — the two populations are measured above and the reason for declining them is stated there |
| a comment | not an identity |
| an implied parent table | recorded in metadata, never a node — an edge to a non-existent target is the unresolvable-identity defect |
| an empty key `""` | no name, so no identity — now asked at every level, not only at the document root |

## Supported constructs

| Construct | Handling |
|---|---|
| `bare_key` (`a`, `a1`, `a-b_c`) | one segment |
| `quoted_key`, basic (`"a b"`) | one segment; quotes stripped, so it can never collide with the bare spelling |
| `quoted_key`, literal (`'a b'`) | one segment, pure slice — a literal string has no escapes |
| an empty quoted key `""` | one **empty** segment; `spellSegment` renders it `""`, and `namesSomething` then omits the key at every level |
| escapes in a quoted key (`\n \t \r \" \\ \uXXXX`) | decoded in pure-String; an **unknown** escape passes through with its backslash rather than being dropped |
| `dotted_key`, bare (`a.b.c`) | three segments, one symbol, full path as name |
| `dotted_key`, quoted (`"a.b".c`) | two segments; the quoted one keeps its quotes so the name round-trips |
| `table` `[a.b.c]` | one symbol; implied parents recorded |
| a section declared **before** its ancestor | one symbol, owned by the ancestor — resolved in a second pass against the whole declared-table map (D1) |
| `table_array_element` `[[bin]]` | one symbol per element; the second takes `#2`, and its keys are prefixed with the **allocated** name so `bin.name` and `bin#2.name` cannot collide |
| `pair` | a `property`; the key is the first child, never the pair's text |
| all nine value types | `string`, `integer`, `float`, `boolean`, `array`, `inline_table` and the four datetimes → `metadata.valueType` |

Numeric and float keys work (`1`, `2.5`), because TOML's bare-key alphabet includes
digits. Unicode **quoted** keys work; a unicode **bare** key is rejected by the
grammar, which is correct — TOML v1.0.0 restricts bare keys to `A-Za-z0-9_-`.

## Unsupported / explicit-unknown constructs

| Construct | Disposition |
|---|---|
| a value as a symbol | ruled out — data, not identity |
| an inline table's keys as symbols | ruled out — one value expression; recorded on the key instead |
| implied parent tables as symbols | ruled out — never written, so inventing one is a guess |
| `ERROR` / `MISSING` recovery nodes | `ERROR` **does occur** — 203 nodes in 16 of 1,141 files, reported at their own span. `MISSING` does not: **0**. Twelve deliberately malformed documents and 1,141 real ones disagreed about `ERROR`, and the real ones were right. Pinned by `toml/malformed-and-rejected`, which places the error **between** two keys so a walk that stopped at the recovery node would lose everything after it |
| `"" = 1` (empty key) | parses, produces no symbol at any level — an identity needs a name. Pinned by `toml/malformed-and-rejected` at the root and by `toml/declaration-order-and-empty-keys` inside a table |
| a section nested inside another section | **0** occurrences in 1,141 files (census probe D3), so the walk's one-level depth loses nothing. This is measured rather than assumed, because it is the load-bearing structural claim of the walk |
| external references of any kind | no TOML construct produces one |

## Regex inventory

**Zero.** Pure-String throughout: `segmentsOf`, `joinPath`, `spellSegment`,
`unquoteKey`, `isBareKeyChar`, `asciiLower` are index loops. The M12 regex census
carries **no toml row**, which *is* the zero — re-measured after these changes.

`TOML-D1` is why the escape decode is a String routine and not a walk: an
`escape_sequence` node's text is exactly the escape its parent contains, so reading
the children buys nothing and costs a second pass over every quoted key — and the
natural way to write a decode is a replacement pattern, which would put the no-regex
rule under pressure.

## Complexity envelope

`cyclomaticComplexity` is `1 + <table count>`: a **measured** decision-point count,
not a constant wearing a metric's name. Each section header is a branch the walk
takes, so two `[[bin]]` elements count twice — they are two branches, not one table
seen twice. Pinned by fixture, which is what stops the field decaying into the
constant `1` that a switch-shaped construct once measured elsewhere in this repo.

**No per-symbol complexity is published, and none is pinned.** A configuration key
has no internal branching, so a per-symbol number would restate the symbol's own
existence. `metadata.complexity` is the *structural depth* — the deepest key path in
the document — because a flat file with 10,000 sibling keys is not deeper than one
with three levels, and reporting the former as complexity would be meaningless.

**The walk is one level deep.** TOML tables are flat sections: a `table` never
contains another `table`, and the only nesting is inside a value (`inline_table`,
`array`), which is not descended into. So there is no recursion, no stack, and no
depth-dependent blowup. **Measured, not assumed: 0 occurrences of a nested section
in 1,141 files (probe D3).**

The **second pass** adds one linear walk over the sections already emitted, which
is O(sections) and allocates one record per section. On the census it fires on
**1 file of 1,141** (`ansible/pyproject.toml`, 1 section moved) and is a no-op
everywhere else — the metric `documentMetrics.reOwnedSections` reports the count per
file so that stays checkable.

### Measured complexity, and the one term that is not linear

Two dimensions behave differently and the difference is worth stating rather than
averaging away, because "O(n)" over a document is ambiguous between them.

| Shape | Input | Result |
|---|---|---|
| **width** | 2,000 → 4,000 → 8,000 root keys | 314 → 261 → **177 ms**, and microseconds *per symbol fall* (157 → 65 → 22) as the document grows, because fixed costs amortise. Linear or better |
| **width** | one table, 8,000 keys | 227 ms |
| **width** | 2,000 tables × 4 keys (10,001 symbols) | 175 ms |
| **width** | 4,000 `[[b]]` elements | 57 ms |
| **width** | 2,000 quoted keys containing dots | 65 ms |
| **path depth** | 40 → 400 → 2,000 → 8,000 segments in ONE dotted key | 1 → **21 → 420 → 6,091 ms** — roughly **O(depth²)** |

The quadratic term is the path string: the ancestor lookup appends one spelled
segment per level, and appending to a string copies it, so a key *d* levels deep
costs O(d²) character copies. An earlier form re-spelled the entire accumulated
prefix at every level, which was the same term and 3.3× worse at depth 400 (95 ms
→ 29 ms once the two were unified).

**The practical envelope is nowhere near this.** Real manifests top out around path
depth 4; cargo's deepest header in 684 files is depth 4. A single 8,000-segment key
is not a document any tool can consume. It is measured and stated rather than left
for someone to meet in a fuzzer.

**And it fails safe.** Through the production `parseFile` path:

| Path depth | Time | Heap | Result |
|---|---|---|---|
| 2,000 | 1.8 s | 174 MB | ok |
| 8,000 | 8.7 s | 330 MB | ok |
| 20,000 | 55 s | 1.3 GB | engine timeout → `2.0-basic-fallback`, **no crash** |

So the honest complexity statement is: **O(nodes + attribute bytes) in width, and
O(depth²) in the path of a single deeply-dotted key, with a graceful degradation
above ~12,000.** Anything less precise than that would be a claim about a shape
nobody publishes.

### Measured on the whole census (1,141 files, 56 repositories)

| | value |
|---|---|
| files | **1,141** — `cargo` 684, `traefik` 180, `hasura-engine` 53, `redwood` 52, `r-air` 28, `graphql-nim` 21, `docker` 14, `ripgrep` 14, `julia` 11, `ansible` 8, and 46 repositories of 1–4 |
| symbols | **20,229** — 1,141 `module`, 6,239 `namespace`, 12,849 `property` |
| relationships | **19,087**, **all `contains`** |
| duplicate names | **0** |
| empty names | **0** |
| empty `SymbolKind` | **0** |
| relationships without a `line_number` | **0** |
| relationships with `line_number <= 0` | **0** |
| self edges (source == target) | **0** |
| endpoints equal to the literal `unknown` | **0** |
| edges lost between the analyzer and production | **1** of 19,088 — defect D3 |
| density | 17.7 symbols/file, 16.7 relationships/file |
| **unresolvable edge targets** | **0** of 19,087 |

The corpus is no longer SHORT of the floor. Earlier pages of this document recorded
743 files and stated the shortfall against the project's ≥1,000 standing requirement;
`traefik` (180) and `julia` (11 tracked) have since been cloned and the admitted set
is **1,141 across 56 repositories**, so the requirement is met without redefining
anything. The census is a point-in-time census of a shared corpus that other lanes
extend: it read 1,140 files at one run and 1,141 at the next, one repository apart.

## Differential ground truth

Oracle: **`deriveTomlEdges`** in `script/m14/differential.ts`, written from the TOML
v1.0.0 key/table grammar and **deliberately not along the analyzer's code path**. The
two differ in every dimension that can differ while still describing the same
document, because a second transcription of the same functions would agree with the
analyzer by construction:

- the analyzer walks with an explicit stack and accumulates a **segment array** per
  key, joining at the end; the oracle descends **recursively carrying an already-joined
  path string**, so the two never hold the same intermediate value;
- the analyzer re-quoted a segment by testing it for `.`, `"` and `\`; the oracle asks
  the **spec's** question — *may this segment be written bare?* — and quotes when it
  may not.

| Draw | Files | Truth | Covered | MISSING | Unexplained |
|---|---|---|---|---|---|
| `cargo:toml` (primary, 60-file draw) | 60 | 416 | **416 (100%)** | 0 | 0 |
| `ripgrep:toml` (second) | 13 | 344 | **344 (100%)** | 0 | 0 |
| `cargo:toml` (depth, `--sample 100000`) | **657** | 5,515 | **5,515 (100%)** | 0 | 0 |

Re-measured after the D1 and D2 fixes. `ripgrep`'s truth hash is
**byte-identical** before and after (`c5e515b54f5e915c`), which is the A/B that shows
the fixes are behaviour-preserving on a corpus that contains neither defect. The
`cargo` 60-file draw rotates (the cold pool advanced from rotation 15 to 17), so its
edge count differs between runs; the **657-file depth draw reproduces the documented
5,515 exactly**.

Comparable on `contains` **alone** — a label is comparable exactly when the lane's
oracle derives it, nothing less and nothing more. `ripgrep` is declared as the
second corpus with its weakness stated: at 13 files against cargo's 684 it is an
order of magnitude smaller and a different dialect (a tool manifest, not a
workspace), so the property the two-corpus gate exists to provide — a defect with
zero occurrences in the primary corpus — is **not** provided for this lane. **Both
defects this round found live outside both corpora**, which is the sharpest statement
of that weakness available.

### The oracle found three real analyzer defects on its first corpus run

Every other gate was blind to all three, which is the entire argument for having
written it.

1. **Bare-writability, not punctuation.** `[target.'cfg(unix)'.dependencies]` is real
   cargo syntax and the segment `cfg(unix)` contains **parentheses** — no punctuation
   a `.`/`"`/`\` test looks for — so the name was emitted unquoted, and an unquoted
   path is not a spelling TOML can parse back. The same hole let a segment
   containing a **space** through.
2. **One function owns a path's spelling.** `resolveOwner` built its ancestor
   prefixes from **raw** segments while the declared-path table was keyed by the
   **quoted** spelling, so `target.cfg(unix).dependencies` never matched
   `target."cfg(unix)".dependencies` and a declared ancestor was recorded as implied.
   The symbol's **name stayed right** — the emit path does quote — so only the
   **containment** was wrong: cargo's own `Cargo.toml` filed
   `[target.'cfg(windows)'.dependencies.windows-sys]` under the module instead of the
   parent declared three lines earlier. Two paths through one file building one key
   differently is invisible to a symbol assertion and obvious to a differential.
3. **The oracle was itself wrong first**, filing `workspace.lints.rust` under the
   module because it tracked no declared-table map. Recorded because a differential
   that only ever finds the analyzer at fault is not being tested symmetrically.

### The honest limit of this oracle

It is a **second reading of the same specification by the same author**, so it
catches *implementation* divergence and not *shared-premise* divergence. html's six
missing carriers were absent from the analyzer **and** from its oracle at once,
because both were written from one reading of one carrier list, and every truth
edge being matched on both lanes never noticed. Nothing in `deriveTomlEdges` prevents that class of error.

**Defect D1 is that class, measured.** The analyzer filed an out-of-order super-table
under the module; the oracle filed it under the module too; the differential reported
every truth edge matched, MISSING 0 and unexplained 0. Only the census, which consults
neither side, found it. And after the analyzer was fixed the two now **disagree** on
that one file, which is the correct state for a differential to be in and the reason
the oracle needs the same second pass (§Report to the supervisor).

## Corpus validation

| Gate | State |
|---|---|
| F3 fixtures | **7/7** — `identity-and-paths`, `arrays-and-values`, `module-name-collision`, `dotted-and-quoted-paths`, `store-seam-probe`, `malformed-and-rejected`, `declaration-order-and-empty-keys` |
| F4 mutation (shared registry) | **9/9 caught** (`BB_MUTANT_ONLY="toml/"`), unchanged by this round |
| F4 mutation (lane-local, `mutants.ts`) | **2/2 applied and 2/2 caught** — `toml/declaration-order-second-pass-disabled`, `toml/empty-key-fix-reverted` |
| M12 differential | **precision 1.000, recall 1.000** — TP=41, FP=0, FN=0, `earliestFailingLayer=none`, against a **hand-audited** 41-fact truth |
| M14.0.TOML-CENSUS | **PASS** — 21 declared node types all accounted for (7 claimed, 13 ruled silent with a reason, 1 not-seen) over the pool, plus 6 ruled non-carrier shapes. Consults **neither** the analyzer nor the oracle |
| F6 fixture coverage | **PASS** — 18 handled, 29 fixture types, 0 uncovered, 0 dead literals |
| F5 differential | **100% / MISSING=0 / unexplained=0** on both corpora, and **5,515/5,515 at 657-file depth** |
| L2 grammar audit | **PASS** — `toml refs=8 unknown=0 unknownFields=0` |
| regex census | **0** — no `toml` row |
| typecheck | clean |
| honesty gate | **22 failures, all pre-existing** — evidence-freshness on F1–F9 plus banned terms in other lanes' files. Re-measured with this lane's changes stashed: the same failures, same counts. Nothing here is attributable to this round |

### Two probes were wrong before they were right

Recorded because the shape is the one the honesty contract exists to catch, and
because both first versions would have been reported as findings:

- **D6.** A probe for "a symbol name with an empty path segment" matched
  `s.name.startsWith(".")` and reported **17** defects. All 17 were dotfiles, whose
  stem legitimately begins with a dot. The trailing-dot and leading-dot cases are
  now separate probes; the real count is **1**, and it is a real defect.
- **Duplicate keys.** A probe for "a name declared twice" counted every in-table
  pair a second time under the root scope and treated two `[[rules]]` elements as one
  table, and reported **1,512** duplicate keys. With the scope corrected to include
  the array-element ordinal and only document-level pairs counted at the root, the
  count is **0**.

An inflated count is worse than no count: it is a number that survives into a report
and nobody re-derives it.

## Error recovery — and a claim that was false

An earlier version of this page, and the completeness spec beside it, said `ERROR`
and `MISSING` **never occur** for this grammar. That was measured against **twelve
hand-made malformed documents** and never against the corpus. Measuring the corpus
contradicted it: **2 of 743 files (0.27%) carried an `ERROR` node**. The corpus has
since grown and the number with it — **203 `ERROR` nodes in 16 of 1,141 files** —
and 14 of those 16 are `traefik`'s Go-template fixtures rather than deliberately
invalid manifests. Two synthetic documents and 1,141 real ones disagreed, and the
real ones were right. `MISSING` holds: **zero** across the whole pool.

`ERROR` is classified `handled_verified`, and the analyzer walks for recovery nodes
itself. It had been pushing **no diagnostics at all**, so the "reported" half of the
three-part contract was entirely the engine's — a contract resting on a caller,
which is the same blindness the svelte lane had in the opposite direction. The walk
uses `children`, not `namedChild`, because a `MISSING` node's expected token can be
anonymous.

Two consequences are declared rather than repaired, each with its blast radius:

- **A key whose value fails to parse is not published.** The whole
  `key = invalid-value` pair sits inside the `ERROR` and the walk does not descend
  into one, so `invalid-section.key` is absent from a document whose table and every
  earlier key are present. Recovering it would mean inferring table scope from
  *position* inside a region the parser marked unreadable — a wrong guess attaches a
  real key to the wrong table. Not worth it, and it is not silence: the file is
  reported with a parse error at the key's own line.
- **An unterminated header** such as `[bad` is recovered by the grammar into a real
  `table` node whose header children include an `ERROR`, with a following genuine
  header nested inside it. Read naively the analyzer would publish the invented
  table and lose the real one. Measured across all 1,141 files this shape occurs
  **zero** times, so no behaviour changes on the strength of a synthetic input — the
  same discipline that removed the values-as-symbols mutant rather than fixing it,
  because the measured enter state is stronger evidence than a stand-in. It is
  recorded so a future corpus containing the shape inherits the decision.

Pinned by `toml/malformed-and-rejected`, which asserts the analyzer's own message
**verbatim** alongside the engine's — the only way to require the analyzer's half of
the contract, since both report the same line — plus the mutants
`toml/error-node-becomes-symbol` and `toml/own-error-report-dropped`.

The whole-pool differential on cargo's 657 files is unchanged by the error pass and
by the D1/D2 fixes: **5,515 truth edges, 5,515 covered, MISSING 0, unexplained 0**.

## Limitations

Declared non-empty because a blank list is treated as dishonesty. TOML is not a
Turing-complete language, and the limits below are the ones that follow from that.

1. **A tool's semantics are not TOML's, and this lane does not model them.**
   1,269 Cargo `workspace = true` inheritances and 167 Gradle `version.ref`
   catalogue references are real key-to-key dependencies that the graph does not
   carry. The counts, the reason and the exact rule that would add them are in
   "The two measurements `references` is most likely to be argued about".
2. **The oracle shares the analyzer's premises.** 19,087 of 19,087 truth edges
   covered on `contains` is conformance to a second reading of TOML v1.0.0 by the
   same author, not proof of correctness. Defect D1 is the measured demonstration: both implementations filed
   an out-of-order super-table under the module and the differential was green
   throughout.
3. **`declaredTables` keeps the LAST allocated name for a repeated path.** Two
   `[[a.b]]` elements mean `declaredTables["a.b"]` is the second, so a later
   `[a.b.c]` is owned by the second element rather than the first. Not measured on
   this census — no corpus file has that shape — and therefore a stated limit rather
   than a fixed behaviour.
4. **A key whose value fails to parse is dropped** with the `ERROR` region that
   contains it (see above). Measured cost on cargo: 2 symbols in 2 files.
5. **Pairs inside an array of inline tables are recorded in no metadata field** —
   2,115 pairs across 296 files (D4).
6. **The second differential corpus is 13 files.** The property a two-corpus gate
   exists to provide is not provided for this lane, and this round's two defects are
   the evidence: both live in repositories neither corpus contains.
7. **The corpus is shared and growing.** The census read 1,140 files and then 1,141
   across consecutive runs. Every number here is a point-in-time census of git
   -tracked files under `$HOME/fixtures/repositories`; re-running
   `census.ts` reproduces it against whatever that directory holds at the time.
8. **One production edge is lost to a cross-language filter** (D3). The analyzer's
   own output is correct there; the pipeline drops it, and the file is shared
   machinery this lane does not edit.
9. **Grammar drift.** The analyzer reads `node.type` for 8 node types. The L2 audit
   re-reads the grammar's own data at verify time and reports
   `toml refs=8 unknown=0 unknownFields=0`, so a renamed node type fails the audit
   rather than silently publishing nothing.

## Evidence pointers

| Artifact | Path |
|---|---|
| Ontology census (this round's instrument) | `validation/m14/fixtures/toml/census.ts` |
| One-file oracle diff (D1, D2) | `validation/m14/fixtures/toml/oracle-diff.ts` |
| Lane-local mutation proof | `validation/m14/fixtures/toml/mutants.ts` |
| New fixture | `validation/m14/fixtures/toml/declaration-order-and-empty-keys.{toml,expectation.json}` |
| Completeness spec | `script/m14/spec/toml-completeness.json` |
| Fixtures | `validation/m14/fixtures/toml/` (7) |
| Mutants | `script/m14/mutate-analyzer.ts` (`toml/`, 9) + `validation/m14/fixtures/toml/mutants.ts` (2) |
| Analyzer | `src/ast/real-toml-analyzer.ts` |
| Ledger row | `validation/m49/ledger.json` → `TOML1` |

Reproduce the census from a clean checkout:

```bash
npx tsx validation/m14/fixtures/toml/census.ts --phase=all   # ~25 s
npx tsx validation/m14/fixtures/toml/oracle-diff.ts          # D1 + D2, both sides
npx tsx validation/m14/fixtures/toml/mutants.ts              # 2/2 caught
npx tsx script/m14/run-fixtures.ts --lang toml               # 7/7
BB_MUTANT_ONLY="toml/" npx tsx script/m14/mutate-analyzer.ts  # 9/9
npx tsx script/m14/differential.ts --lang toml --sample 100000
```

## The three checks, and what each one is for

This lane's coverage comes from three checks that fail differently, and the reason
they are not redundant is worth stating because it is the whole argument for having
built all three:

| Check | Consults | Catches |
|---|---|---|
| **F5 differential** | analyzer + oracle | implementation divergence between two implementations — **found 3 real defects** on the oracle's first run |
| **M12 hand audit** | analyzer + a human's reading of the spec | divergence between the code and what the document *means* — **found 0**, because the oracle had already fixed what it would have found |
| **M14.0.TOML-CENSUS** | **neither** | a mistake in the reading *itself*, where both implementations would be wrong together and the differential would report the agreement as correctness |
| **Ontology census (this round)** | the **language**, plus the analyzer only for defect probes | a construct that is absent from the analyzer *and* from the oracle, which is the class the arbiter exists for — and, in the shape it took here, a defect both implementations share |

The M12 audit finding nothing is the weaker result and is recorded as such. Writing
"0 found" without that context would read as a stronger claim than it is.

## Report to the supervisor — shared files this lane needs changed

Four items. None is edited here; each is stated so it can be applied without
re-deriving it.

1. **`script/m14/ontology-coverage-gate.ts` — add a `TOML_RULED` table.**
   `RULED_BY_LANG` (line 192) carries `bash` and `json` only, so
   `npx tsx script/m14/ontology-coverage-gate.ts toml` **exits 2** with
   `no RULING TABLE for toml` and reports nothing. The table needs nine entries
   (everything except `contains`), each `{ type, instrument, describe }` plus
   `nodeTypesThatWouldMeanIt` for the six ruled on instrument A and a `countOnTree`
   for the three that need B (`imports`, `references`, `overrides`).
   **The probes are written and measured** in `validation/m14/fixtures/toml/census.ts`
   — `MARKERS`, the `imports`/`references`/`uses`/`exports` probe blocks and the
   three-shape `overrides` block — and can be lifted directly. Copy them verbatim:
   a re-derivation is exactly how `overrides` was ruled wrong in bash.
   Two entries need a note attached or the gate will over-call them: `overrides`'s
   table-header probe returns **1** (a TOML-invalid document, not an override) and
   `references`' marker probe returns **169** (Gradle/Cargo conventions). Both are
   explained above.

2. **`script/m14/differential.ts` — `deriveTomlEdges` needs the D1 second pass and
   the D2 guard.** The oracle builds its `declared` map in document order, so after
   the analyzer's fix the two disagree on `ansible/pyproject.toml`:
   `contains tool.setuptools → tool.setuptools.dynamic.version` is emitted by the
   analyzer and `… ← tool.setuptools.dynamic.version` by the oracle. Reproduce with
   `npx tsx validation/m14/fixtures/toml/oracle-diff.ts`. The fix mirrors the
   analyzer's: after `visitSection` has run for every section, re-resolve each
   section's parent against the whole `declared` map and update `edges[i].from`.
   A prefix is always shorter than the path, so the pass cannot loop.
   Separately, the in-table pair loop in `visitSection` should skip a key whose
   segments are all empty, matching the lane's `namesSomething` ruling — today the
   oracle emits `tool.setuptools.package-dir.""` where the analyzer, correctly,
   emits nothing.

3. **`src/ast/pool-worker.ts` — `filterNoiseRelationships`, defect D3.** At line 541
   `extractLeaf` splits a target on `:` to accommodate Objective-C selector arity,
   and the fragment after the colon is then tested by `leaf.startsWith(" ")` at line
   595. For `project.urls."CI: Azure Pipelines"` the leaf is `" Azure Pipelines"`,
   so a legal TOML key's containment edge is dropped. **1 of 19,088 edges in 1,141
   files.** The minimal repair is to make the colon split conditional — it exists for
   `objective-c`, and the function already has per-language scoping for exactly this
   reason (`JS_FAMILY_LANGUAGES`, `CSS_FAMILY_LANGUAGES`, the `json`/`yaml`/`hcl`
   early return at line 557). A TOML entry on that early return would also be
   correct, since a TOML target is a dotted key path and never a source identifier.

4. **`script/m14/mutate-analyzer.ts` — register two mutants.** This lane's fixes are
   proven by `validation/m14/fixtures/toml/mutants.ts` because that registry is
   shared, but F4 reads the registry and would not run them. Both mutants are defined
   there with their source patches and their `mustBreak` pin; copying the two entries
   across is mechanical. Note the shape difference: `MUTANTS` transforms the
   analyzer's **output**, while these two are **source** patches, because the defects
   are structural (an index captured after the push rather than before it; a filter
   removed) and a result transform cannot express either without re-implementing the
   thing it breaks.

## Not closed

**Sections E and F** of the completeness spec await the canonical F5 ceremony, so
there is no pinned corpus floor yet.

**Section D** is red, and the reason is measured rather than asserted. The gate
(`verifySectionD` in `completeness-inventory.ts`) counts distinct
`meta.evidenceClass` values across the lane's fixture expectations and wants two or
more; TOML pins one, `structural`, and that is every edge it emits.

Two checks were run rather than assumed, because the first answer was wrong. There is
**no `json` lane** in this project — it has no registry key and no fixture directory —
so a "json does the same thing" comparison has nothing behind it. The real precedent
is **yaml**, and it is not in the same position at all: it pins **four** tiers
(`structural`, `inferred`, `import_based`, `reference_qualified`) and passes D,
because TOML's absent constructs are precisely yaml's present ones — a merge key is
an inference, an anchor is a reference, an `!include` is a fetch. TOML has no merge,
no anchor, no alias, no include, no import and no reference of any kind.

The taxonomy itself rules out the tempting fix. `inferred` does not mean "the
analyzer chose this name" — it means a **resolution step that could be wrong**, and
every `inferred` edge in the corpus carries a `confidenceReason` beside it (yaml's are
`cross-document-alias` and `unresolved-sibling-name`). TOML performs no resolution
step: containment is asserted lexically by text the document literally writes. The
synthetic module is an *identity* decision, already recorded in symbol metadata, and
does not make the edges through it inferences. So relabelling the module edges to
reach two tiers would be a category error, not a correction.

`go` is the lane that faced this same wall and shows what a legitimate remedy looks
like: its D was impossible only because it was not *tagging* edges, and once
`classifyEvidenceTier` ran across them the tiers fell out on their own — precisely
because go emits seven relationship types with genuinely different provenances. That
remedy is unavailable here for the same reason the fix is dishonest: there is only
`contains`, so there is nothing else to tag.

Both available routes to a second tier were declined: emitting `uses` for a
path-shaped string, or for `workspace = true`, imports ecosystem knowledge about
which keys mean what in which tool into a format that defines no references; and
tagging an edge to an implied parent `inferred` points at a target that is
deliberately not a symbol, which is the unresolvable-identity defect. D stays red
until the gate grows a documented single-tier allowance or TOML grows a construct
that earns one.