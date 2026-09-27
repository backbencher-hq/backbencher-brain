# real-toml-analyzer.md

> **Canonical contract doc for the toml lane.** The rulings and why each was taken
> live in the analyzer's own header comment and in the completeness spec; this file
> is the reference: what it emits, what it refuses to emit, and the measurements
> behind both.

## Language

| | |
|---|---|
| Grammar | `wasm/tree-sitter-toml.wasm`, 25,436 bytes |
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
| `ERROR` / `MISSING` recovery nodes | **never occur** for this grammar. Twelve deliberately malformed documents and tree-sitter-toml either recovered or rejected the input as invalid TOML without producing either node. A malformed document that *is* accepted still yields a module and whatever sections parsed, so degradation is partial |
| `"" = 1` (empty key) | parses, produces no symbol — an identity needs a name |
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

## Differential ground truth

**Not yet written.** The lane has fixtures and mutants but no independent oracle, so
the F5 differential cannot run for toml today. This is the honest state, and it is
the same gap html carried before its oracle existed: `deriveTomlEdges` must be
written from the TOML spec's own key/table grammar and must **not** share the
analyzer's segment logic, or the differential will agree with the analyzer by
construction — the shared-premise failure that hid html's bare-`#` and its six
missing carriers.

## Corpus validation

| Gate | State |
|---|---|
| F3 fixtures | **3/3** — `identity-and-paths`, `arrays-and-values`, `module-name-collision` |
| F4 mutation | **5/5 caught** (entered with 0) |
| F6 fixture coverage | see the inventory run |
| SPEC #419 | **A, B, C pass**; gap list empty. **D red** (one tier, justified in the spec); **E/F** await the canonical baseline pin; **G** this file |
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

**Not closed:** the F5 differential has no oracle, so sections E and F are red and
there is no corpus floor — the lane has fixtures, mutants and a spec, but no
independent second opinion. Section D is red for a different reason and will not
become green by writing more code: TOML's graph is entirely `structural`, and
manufacturing a second tier would mean either emitting a `uses` edge for a
path-shaped string or pointing an edge at a deliberately non-existent implied parent.
