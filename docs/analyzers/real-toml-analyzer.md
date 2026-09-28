# real-toml-analyzer.md

> **Canonical contract doc for the toml lane.** The rulings and why each was taken
> live in the analyzer's own header comment and in the completeness spec; this file
> is the reference: what it emits, what it refuses to emit, and the measurements
> behind both.

## Language

| | |
|---|---|
| Grammar | `wasm/tree-sitter-toml.wasm`, 25,436 bytes, sha256 `7849ac8ce9d10a46…`. Source `@tree-sitter-grammars/tree-sitter-toml`, obtained as a **redistributor collection build** (`tree-sitter-wasms`), so `versionKind: redistributor-collection` and `versionIsComparableToUpstreamGrammar: false` — the M60 survey records it that way on purpose, because a collection build states a collection version and comparing it to an upstream grammar version would yield a false "behind" |
| Node types | 19 distinct named types (the grammar exposes 20 `nodeTypeForId` slots — `escape_sequence` is declared twice), plus the universal `ERROR`/`MISSING` pair the gate injects |
| Completeness | `script/m14/spec/toml-completeness.json` — **21/21 classified, gap list empty**: 17 handled, 3 silent, 1 design decision (19 grammar types plus the universal `ERROR`/`MISSING` pair) |
| Analyzer | `src/ast/real-toml-analyzer.ts` |
| Corpus | `cargo` @ `94faf91`, clean, **684** tracked `.toml` files |
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

**Empty keys produce nothing.** `"" = 1` parses but names nothing, because an
identity needs a name. Recorded here so the omission is a decision.

## Relationship ontology

TOML's relationship vocabulary is `contains`, **and that is the whole truth.**

| Label | Emitted for | Confidence | Tier |
|---|---|---|---|
| `contains` | the module → its top-level tables and root keys; a table → its keys and sub-tables | 1.0 | `structural` |

There is no second type, and inventing one would be worse than a thin graph. A value
like `path = "src/main.rs"` is a *string*; treating path-shaped strings as references
would import ecosystem knowledge — which keys are paths in which tool — into a format
that defines no include, no import and no reference at all. `extends`, `implements`,
`instantiates`, `overrides` and `exports` are absent for the same reason they are
absent from html: no TOML construct produces them. Measured 0 exports across the
corpus, because markup and configuration alike have no module surface.

## Noise-elimination contract (what produces NO edges)

| Input | Why no edge |
|---|---|
| a value of any type | data, not a dependency — recorded as `metadata.valueType` on its key |
| an inline table's keys | part of one value expression; recorded in `metadata.inlineKeys` |
| a path-shaped string (`path`, `include`, `manifest_path`) | TOML has no reference mechanism, so a path is a string, not a fetch |
| a comment | not an identity |
| an implied parent table | recorded in metadata, never a node — an edge to a non-existent target is the unresolvable-identity defect |
| an empty key `""` | no name, so no identity |

## Supported constructs

| Construct | Handling |
|---|---|
| `bare_key` (`a`, `a1`, `a-b_c`) | one segment |
| `quoted_key`, basic (`"a b"`) | one segment; quotes stripped, so it can never collide with the bare spelling |
| `quoted_key`, literal (`'a b'`) | one segment, pure slice — a literal string has no escapes |
| escapes in a quoted key (`\n \t \r \" \\ \uXXXX`) | decoded in pure-String; an **unknown** escape passes through with its backslash rather than being dropped |
| `dotted_key`, bare (`a.b.c`) | three segments, one symbol, full path as name |
| `dotted_key`, quoted (`"a.b".c`) | two segments; the quoted one keeps its quotes so the name round-trips |
| `table` `[a.b.c]` | one symbol; implied parents recorded |
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
| `ERROR` / `MISSING` recovery nodes | `ERROR` **does occur** — see below. `MISSING` does not. Twelve deliberately malformed documents and tree-sitter-toml either recovered or rejected the input as invalid TOML without producing either node. A malformed document that *is* accepted still yields a module and whatever sections parsed, so degradation is partial. Pinned by `toml/malformed-and-rejected`, which places the error **between** two keys so a walk that stopped at the recovery node would lose everything after it |
| `"" = 1` (empty key) | parses, produces no symbol — an identity needs a name. Pinned by the same fixture |
| external references of any kind | no TOML construct produces one |

## Regex inventory

**Zero.** Pure-String throughout: `segmentsOf`, `joinPath`, `unquoteKey`,
`isBareKeyChar`, `asciiLower` are index loops. The M12 regex census carries **no
toml row**, which *is* the zero.

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
depth-dependent blowup — the structural property that a language with an
`O(depth)` working set is usually trying to claim and here gets for free.

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

### Measured on cargo (684 files, 0.15 MiB)

| | value |
|---|---|
| symbols | 6,409 — 684 `module`, 1,856 `namespace`, 3,869 `property` |
| relationships | 5,725, **all `contains`** |
| duplicate names | **0** |
| empty names | **0** |
| relationships without a `line_number` | **0** |
| relationships with `line_number <= 0` | **0** |
| parse errors | 2 |
| density | 9.4 symbols/file, 8.4 relationships/file |
| **unresolvable edge targets** | **0** of 5,725 (and **0** across the whole 835-file pool) |
| **self edges (source == target)** | **0** |
| implied-parent records | 229 (metadata only, never nodes) |

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
| `cargo:toml` (primary) | 60 | 664 | **664 (100%)** | 0 | 0 |
| `ripgrep:toml` (second) | 13 | 344 | **344 (100%)** | 0 | 0 |
| `cargo:toml` (depth) | **657** | 5,515 | **5,515 (100%)** | 0 | 0 |

Comparable on `contains` **alone** — a label is comparable exactly when the lane's
oracle derives it, nothing less and nothing more. `ripgrep` is declared as the
second corpus with its weakness stated: at 13 files against cargo's 684 it is an
order of magnitude smaller and a different dialect (a tool manifest, not a
workspace), so the property the two-corpus gate exists to provide — a defect with
zero occurrences in the primary corpus — is **not** provided for this lane.

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
because both were written from one reading of one carrier list, and 100% coverage on
both lanes never noticed. Nothing in `deriveTomlEdges` prevents that class of error.

## Corpus validation

| Gate | State |
|---|---|
| F3 fixtures | **6/6** — `identity-and-paths`, `arrays-and-values`, `module-name-collision`, `dotted-and-quoted-paths`, `store-seam-probe`, `malformed-and-rejected` |
| F4 mutation | **9/9 caught** (entered with 0) |
| M12 differential | **precision 1.000, recall 1.000** — TP=41, FP=0, FN=0, `earliestFailingLayer=none`, against a **hand-audited** 41-fact truth |
| M14.0.TOML-CENSUS | **PASS** — 21 declared node types all accounted for (7 claimed, 13 ruled silent with a reason, 1 not-seen) over 835 files / 68 repos, plus 6 ruled non-carrier shapes. Consults **neither** the analyzer nor the oracle |
| M14.0.PIPE | **9 store assertions** green through the real CLI against `brain.db` |
| F6 fixture coverage | **PASS** — 18 handled, 29 fixture types, 0 uncovered, 0 dead literals |
| F5 differential | **100% / MISSING=0 / unexplained=0** on both corpora, and **5,515/5,515 at 657-file depth** |
| SPEC #419 | **A, B, C, G pass**; 21/21 rows, gap list empty. **D red** (one tier, justified in the spec); **E/F** await the canonical baseline pin |
| regex census | **0** |
| typecheck | clean |

### The heavy corpus is SHORT of the floor, and the number is recorded rather than redefined

The standing requirement is a corpus of **≥1,000** files. TOML cannot meet it:
**743** `.toml` files exist across every corpus repository, and `cargo`'s **684**
tracked files are the largest clean set. `ripgrep` (14), `docker` (14), `ansible` (8)
and the rest are an order of magnitude smaller, and `proxicall` is dirty.

So the depth draw is 684 and the shortfall is stated here, in the ledger, and in the
inventory rather than quietly redefined. 684 is still 3.4× the 200-file draw other
lanes use, and it is enough for every invariant on this page — 0 duplicate names and
0 missing lines are measured across all of it.

### Robustness swept before any fixture was written

Empty file · comment-only · a bare key with no header · an empty table · an 8-deep
dotted header · a dotted key at the root · literal-string and escaped quoted keys ·
CRLF · no trailing newline · a multi-line array · a nested inline table · all four
datetime forms · numeric and float keys · malformed input · a duplicate key in one
table (correctly `t.k`, `t.k#2`).

**Zero duplicate names and zero unresolvable targets in every case.** Every failure
the sweep found turned out to be **invalid TOML in the probe input** — bracketed
keys, bare words as values — which the grammar correctly rejects.

## Evidence pointers

| Artifact | Path |
|---|---|
| Completeness spec | `script/m14/spec/toml-completeness.json` |
| Fixtures | `validation/m14/fixtures/toml/` (3) |
| Mutants | `script/m14/mutate-analyzer.ts` (`toml/`, 5) |
| Analyzer | `src/ast/real-toml-analyzer.ts` |
| Ledger row | `validation/m49/ledger.json` → `TOML1` |

## Issue

**#289.** Open.

## The three checks, and what each one is for

The lane's coverage comes from three checks that fail differently, and the reason
they are not redundant is worth stating because it is the whole argument for having
built all three:

| Check | Consults | Catches |
|---|---|---|
| **F5 differential** | analyzer + oracle | implementation divergence between two implementations — **found 3 real defects** on the oracle's first run |
| **M12 hand audit** | analyzer + a human's reading of the spec | divergence between the code and what the document *means* — **found 0**, because the oracle had already fixed what it would have found |
| **M14.0.TOML-CENSUS** | **neither** | a mistake in the reading *itself*, where both implementations would be wrong together and the differential would report the agreement as correctness |

The M12 audit finding nothing is the weaker result and is recorded as such. html's
hand audit found two places the analyzer was wrong; this one found none, because the
oracle got there first. Writing "0 found" without that context would read as a
stronger claim than it is.

## Error recovery — and a claim that was false

An earlier version of this page, and the completeness spec beside it, said `ERROR`
and `MISSING` **never occur** for this grammar. That was measured against **twelve
hand-made malformed documents** and never against the corpus. Measuring the corpus
contradicted it: **2 of 743 files (0.27%) carry an `ERROR` node** —
`cargo/tests/testsuite/cargo_add/invalid_manifest/{in,out}/Cargo.toml`, cargo's own
deliberately-invalid manifest fixtures, where `key = invalid-value` is a bare word
where TOML requires a value. Two synthetic documents and 743 real ones disagreed,
and the real ones were right. `MISSING` holds: **zero** across the whole pool.

The lane's own corpus census had been reporting "2 parse errors" the entire time.
That number was sitting in the evidence and the spec contradicted it; nobody
reconciled the two.

`ERROR` is therefore classified `handled_verified`, and the analyzer now walks for
recovery nodes itself. It had been pushing **no diagnostics at all**, so the
"reported" half of the three-part contract was entirely the engine's — a contract
resting on a caller, which is the same blindness the svelte lane had in the opposite
direction. The walk uses `children`, not `namedChild`, because a `MISSING` node's
expected token can be anonymous.

Two consequences are declared rather than repaired, each with its blast radius:

- **A key whose value fails to parse is not published.** The whole
  `key = invalid-value` pair sits inside the `ERROR` and the walk does not descend
  into one, so `invalid-section.key` is absent from a document whose table and every
  earlier key are present. This costs exactly **2 symbols in 2 files**, both
  cargo's invalid-manifest fixtures. Recovering it would mean inferring table scope
  from *position* inside a region the parser marked unreadable — the `ERROR` sits at
  document level, so ownership would have to come from "the last header before this
  offset", and a wrong guess attaches a real key to the wrong table. Not worth it
  for two symbols in two intentionally-broken files, and it is not silence: the file
  is reported with a parse error at the key's own line.
- **An unterminated header** such as `[bad` is recovered by the grammar into a real
  `table` node whose header children include an `ERROR`, with a following genuine
  header nested inside it. Read naively the analyzer would publish the invented
  table and lose the real one. Measured across all 743 files this shape occurs
  **zero** times, so no behaviour changes on the strength of a synthetic input — the
  same discipline that removed the values-as-symbols mutant rather than fixing it,
  because the measured enter state is stronger evidence than a stand-in. It is
  recorded so a future corpus containing the shape inherits the decision.

Pinned by `toml/malformed-and-rejected`, which asserts the analyzer's own message
**verbatim** alongside the engine's — the only way to require the analyzer's half of
the contract, since both report the same line — plus the mutants
`toml/error-node-becomes-symbol` and `toml/own-error-report-dropped`.

The whole-pool differential is unchanged by the error pass: **835 files, 7,906 truth
edges, 100%, `MISSING=0`, `unexplained=0`**, so the addition is diagnostics only and
no symbol or relationship moved.

## Not closed

**Sections E and F** await the canonical F5 ceremony, so there is no pinned corpus
floor yet.

**Section D** is red, and the reason is measured rather than asserted. The gate
(`verifySectionD` in `completeness-inventory.ts`) counts distinct `meta.evidenceClass`
values across the lane's fixture expectations and wants two or more; TOML pins one,
`structural`, and that is every edge it emits.

Two checks were run rather than assumed, because the first answer was wrong. There is
**no `json` lane** in this project — it has no registry key and no fixture directory —
so a "json does the same thing" comparison has nothing behind it. The real precedent
is **yaml**, and it is not in the same position at all: it pins **four** tiers
(`structural`, `inferred`, `import_based`, `reference_qualified`) and passes D, because
TOML's absent constructs are precisely yaml's present ones — a merge key is an
inference, an anchor is a reference, an `!include` is a fetch. TOML has no merge, no
anchor, no alias, no include, no import and no reference of any kind.

The taxonomy itself rules out the tempting fix. `inferred` does not mean "the
analyzer chose this name" — it means a **resolution step that could be wrong**, and
every `inferred` edge in the corpus carries a `confidenceReason` beside it (yaml's are
`cross-document-alias` and `unresolved-sibling-name`). TOML performs no resolution
step: containment is asserted lexically by text the document literally writes. The
synthetic module is an *identity* decision, already recorded in symbol metadata, and
does not make the edges through it inferences. So relabelling the module edges to reach
two tiers would be a category error, not a correction.

`go` is the lane that faced this same wall and shows what a legitimate remedy looks
like: its D was impossible only because it was not *tagging* edges, and once
`classifyEvidenceTier` ran across them the tiers fell out on their own — precisely
because go emits seven relationship types with genuinely different provenances. That
remedy is unavailable here for the same reason the fix is dishonest: there is only
`contains`, so there is nothing else to tag.

Both available routes to a second tier were declined: emitting `uses` for a
path-shaped string imports ecosystem knowledge about which keys are paths in which
tool into a format that defines no references, and tagging an edge to an implied parent
`inferred` points at a target that is deliberately not a symbol, which is the
unresolvable-identity defect. D stays red until the gate grows a documented
single-tier allowance or TOML grows a construct that earns one.
