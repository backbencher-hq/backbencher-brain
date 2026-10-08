# real-vb-analyzer.md

## Language

- Analyzer file: `src/ast/real-vb-analyzer.ts`
- Parser: `tree-sitter-vbnet` — a **vendored and patched** grammar (18 repairs over `govindbanura/tree-sitter-vbnet`, which publishes no release). WASM in `wasm/tree-sitter-vbnet.wasm`; the `~/.bb/wasm` mirror is byte-identical and is the second copy the pin verifies.
- Language detection: extension `.vb` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealVbAnalyzer`; the wasm path is a second `case "vb"` in `getParser` (the engine has two language switches, and changing only `SUPPORTED_LANGUAGES` leaves every `.vb` file throwing "parser not yet implemented" — that was measured, not guessed).
- Pin: `validation/m14/grammar-pins.json` → `lanes.vb`; grammar doc `grammars/tree-sitter-vbnet/PIN.md`; lane review `reviews/vb/master-review.md`

### Grammar (M60 VB wave)

The vendored grammar arrived parsing **38.67 %** of Microsoft's own
`Microsoft.VisualBasic.Core` cleanly. It now parses **90.89 %** over four
independent corpora (1185 files, 0 crash files). The repairs, each with a
minimal repro under `grammars/_vendored/vbnet/repro-cases/`:

1. `repeat` instead of `optional` on `attribute_list` in 14 member positions — consecutive attribute lists are the standard pattern and upstream allowed one. (49.33 % → 62.67 % on the authoritative corpus.)
2. File-scoped `Namespace N` (VB 15+), as a second alternative **pinned to the file's last position** rather than an optional `End Namespace` — the optional form also "succeeds" for a file that *has* one, leaving it dangling and hoisting the classes after the early reduction to file scope.
3. `&H`/`&O`/`&B` literals with per-radix digit classes and the `% & ! D F R I L S US UI UL` type characters.
4. `!`, `#` and `@` on `floating_point_literal` — `!` is Single (85.7 % of one corpus's failures); `#`/`@` are VB6's legacy Double/Decimal, and an earlier revision of the grammar *ruled them out* until Microsoft's own `Financial.vb` (`Period - 1.0#`) contradicted it.
5. `As New T [args] [With { … }]` moved into the shared `as_clause`, so a property or field may carry it.
6. `Declare … Lib "dll" Alias "e" [params] [As T]` — the P/Invoke member, which had **no rule at all** upstream.
7. Bare `{…}` array initializer, reachable as a `_literal` so it nests and is legal in an assignment.
8. `:` as a clause-head terminator (`_clause_terminator`) for `Case` / `Case Else` / `Else`.
9. `named_argument` (`b:=`) at invocation precedence, with `array_access_expression` indices built from `$._argument`.
10. Unicode identifiers (`\p{L}` / `\p{Nd}`) in `_identifier_token`.
11. `character_literal` as **one token**, so `"x"c` beats `string_literal`.
12. Class / structure / interface **header** heritage: `Class C : Inherits B, Implements I` and the keyword-less `Interface I : IDisposable`.
13. `Generic.Name(Of T)` — a qualified name whose last segment is generic.
14. VB **statement lambdas**: optional parameter list, `As T` return clause, and a required `End Sub`/`End Function` that does **not** eat the enclosing statement's newline.
15. `Global.` reachable from `_type`.
16. `ReDim` target widened from `identifier` to an expression.
17. `generic_name` admitted to `_name_reference`, so `Implements IComparable(Of C)` parses.
18. Four GLR conflicts plus right-associativity and dynamic rank on `as_clause`, each named at its declaration.

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | `childForFieldName("name")` → `namingToken()` (descends to the last segment's leaf); fallback to the first `identifier`/`simple_name` child |
| kind | ✅ | `namespace_declaration`→Namespace, `class_declaration`→Class, `structure_declaration`→Struct, `interface_declaration`→Interface, `module_declaration`→Module, `enum_declaration`→Enum (+`enum_member_declaration`→EnumMember), `delegate_declaration`→Type, `method_declaration`→Method, `constructor_declaration`→Constructor, `property_declaration`→Property, `event_declaration`→Event, `operator_declaration`→Method (`Operator +`), `declare_statement`→Method (P/Invoke), `field_declaration`→Variable/`Constant` |
| owner | ✅ | the declaration stack (`ownerStack`); namespaces and types both push |
| visibility | ✅ | the `modifiers` field's `member_modifier` list, resolved in VB's own precedence order: `Private` → `Protected` → `Friend`(internal) → `Public`; default `internal` |
| isStatic | ✅ | `Shared` |
| isAbstract | ✅ | `Abstract` or `MustInherit` |
| parameters | ✅ | `parameter_list` → `parameter`; `ByVal`/`ByRef` recorded as `passingMode` (VB's default is `ByRef`, so it is stated explicitly rather than left implicit) |
| returnType | ✅ | `as_clause` → `declared_type` |
| range | ✅ | 1-based `startLine`/`endLine` + byte `startIndex`/`endIndex` |

`metadata` carries the grammar node name, `NotInheritable`/`NotOverridable` as
`sealed`, `Partial`, `ReadOnly`, `WriteOnly`, `Default`, `Shared`, `WithEvents`,
`autoImplemented` for a property with no accessor block, and the P/Invoke
`library`/`entryPoint`/`kind`.

## Relationship contract

| Type | Source → Target | Confidence | Line stamped on |
| --- | --- | --- | --- |
| `contains` | owner → member | 1.0 | the member's name node |
| `calls` | enclosing method/property/field-init → callee | 1.0 in-file, 0.6 not | the **callee name leaf** |
| `extends` | type → base type | 1.0 in-file, 0.7 not | the base name leaf |
| `implements` | type/member → interface | 1.0 in-file, 0.7 not | the interface name leaf |
| `imports` | `root` → namespace | 1.0 | the imported name leaf; carries `isImport` + `include_dependency` |
| `references` | declaration → a type it names | 0.6 | the type name leaf |
| `overrides` | member → itself (base member unknown) | 0.6 | the member's name node |

**Every relationship carries `line_number`** (M59.A7), 1-based, on the node that
*names* the thing, per site rather than per set. Measured: **0 of 33,910 edges**
without one, over 435 real files. `namingToken()` is what makes a wrapped
qualified name stamp the line of its last segment's leaf rather than the line the
name starts on — a three-line chained call gets one site line per call.

`imports` carries `isImport` and `include_dependency` because the family contract
(C# and C publish import dependencies that way) is what the completeness
section-B pin and the tier classifier read.

## Complexity

- `cyclomaticComplexity` — counted off AST decision nodes (`if_statement`,
  `while_statement`, `do_statement`, `for_statement`, `for_each_statement`,
  `case_clause`, `case_else_clause`, `else_clause`, `catch_clause`,
  `catch_block`, `catch_filter_clause`, `when_clause`), starting at 1. The set is
  named rather than pattern-matched, so a grammar change that adds a branching
  rule shows up as a number that moved.
- `complexity` — total AST node count.

## Rules this analyzer holds itself to

1. **AST only, zero regex.** Every classification is a node-type test, a field
   read, or a character-code scan with the equivalence argued inline. The file
   contains no regex literal; the M49.R2 census confirms 0 usages.
2. **No unknown symbols.** A symbol with no readable name is **counted**
   (`vbGaps["declaration-without-name"]`) rather than emitted with an invented
   one.
3. **The grammar's real vocabulary.** Node types and field names were read out of
   the pinned wasm's enumerable surface (449 ids / 165 named / 54 fields). The
   first version of this file named three node types that do not exist
   (`blank_line`, `name_reference`, `namespace_name`) — dead branches, the LUA-00
   defect class. M14.0.F1 caught them; all three are fixed and the audit is green.
4. **Gaps are disclosed, not silent.** `metadata.vbGaps` counts what the grammar
   could not express, so a consumer can see the boundary instead of inferring
   completeness from silence.

## Measured state

Over 435 real `.vb` files through `ASTEngine.parseFile`:

| | |
|---|---:|
| symbols | 12,930 |
| relationships | 39,125 |
| imports | 1,157 |
| crash files | 0 |
| empty names / unknown kinds | 0 / 0 |
| relationships without a line | 0 |
| members without `ownerName` | 423 — **all** in grammar-errored files, 0 in clean ones |

Kinds: 5456 variable, 4370 method, 913 enum_member, 725 property, 481 class,
**285 constructor**, 166 namespace, 137 interface, 118 enum, 99 struct, 63 module,
11 type, 10 event.
Edges: 14410 references, 11973 contains, 10451 calls, 1157 imports, 265 extends,
176 implements.

M14.0.F1: **PASS**, 27 references, 0 unknown node types, 0 unknown fields.

M14.0.F8 (node-type census, `script/m14/vb-node-type-census.ts`): **145/145
classified, exit 0.** The first run found 146 distinct named types against 42
classified — the "every construct is accounted for" claim was 29 % true and
nothing had measured it. Two whole kinds fell out of the unclassified 101:
**interface members** (three node types in neither set, so nothing visited them
and every interface was an empty shell) and **operators** (no `name` field, plus
a visitor that classified the operator's own symbol as punctuation). The
classification is four-way — declaration, relationship source, known candidate,
silent — because "classified" and "handled" are different words, and the two-way
split is what hid both.

M14.0.F5, **whole corpora, not a draw, all seven labels audited** —
`P3D-Legacy` **1,880 of 1,880 files**, 23,356 truth edges, 23,353 covered
(**100 %**), 3 missing, **0 unexplained**; `DISMTools` **483 of 483**, 15,689
truth edges, 15,685 covered (**100 %**), 4 missing, 0 unexplained. Labels:
`calls`, `contains`, `imports`, `extends`, `implements`, `overrides` and
`references` — the last two joined the audit this wave, which grew the audited
set by 3,073 edges that had previously been published and agreed with by nobody.
All 7 remaining missing rows across both corpora are dropped constructions; 6 are
the `Sub New*` grammar defect and 1 (`SoundManager`) is unexplained and recorded
as such.

**Caveat that is part of the number, not a footnote:** the differential's sampler
had no avalanche, so consecutive "rotations" drew the same 60 files. Every
earlier 100 % figure from a draw was one file set measured repeatedly. Fixed with
mulberry32; three independent rotations now read 99.9 %, 100 %, 100 % with 0
unexplained. See `docs/vb.md`.

The differential is what found the three defects a corpus-wide count could not,
because in each case the count stayed healthy while a class of output was missing
or wrong:

- **a construction with arguments was not a call** — `New Box(1, 2)` is an
  `array_creation_expression` with a `type` field and no `function` field, so
  reading the callee from `function` dropped 15,577 call edges across 1,718 of
  2,660 files. Found NOT by the differential, which read 100 % with the defect
  live because the oracle made the same assumption; found by writing the fixture.
- **every modifier after the first was invisible** — `modifierNames` read
  `childForFieldName("modifiers")`, which returns one node, but this grammar emits
  the field once per modifier. `Public Shared` reported `isStatic: false`,
  `Public Overrides` published zero `overrides` edges across 435 files, and `Const`
  fields were published as `Variable`. VB writes `Public` first, so the one
  modifier that was read was the one least worth reading. Found because the docs
  claimed `overrides` was published and it was not.
- **an interface's members were never visited** — three node types in neither the
  declaration set nor the silent set, so nothing dispatched them and every
  interface was published as a name with no members while the implementing class
  had all of them. Found by the census, not by a differential: no edge was
  *wrong*, a whole class of declaration was *absent*.
- **no operator was ever published**, for two independent reasons — no `name`
  field, and a visitor that skipped the operator's own token because
  `isKeyword` rejects every token not starting with a letter (written to reject
  `(`, and it rejected every operator symbol). Word operators are worse: the
  keyword and the word are inlined away and exist nowhere in the tree.
- **member-level heritage was never collected** — `visitHeritage` was called from
  exactly one place, the type visitor, so `Public Sub Refresh() Implements
  IThing.Refresh` published nothing at all. Found by the full-corpus sweep (17 of
  23 missing rows). The target keeps its qualifier, `IThing.Refresh`, because
  last-segment reduction would make it `implements Refresh -> Refresh` — the
  method is named `Refresh` *because* it implements `IThing.Refresh`, so the edge
  would collapse onto itself.
- **constructors were absent entirely** — `Public Sub New()` has no `name` field
  (`New` is an anonymous token), so the "declaration without a name" guard
  returned *before* the naming contract was reached. 12,549 symbols contained
  zero constructors; there are 285 now. Any check that can reject a declaration
  has to be evaluated against the contract, not in front of it.
- **callee targets were expression text** — `New AnimatedBlock()` is
  `(object_creation_expression type: (simple_name (identifier)))`, the type is in
  a `type` field, and the naming helper only followed `name`, so it published the
  literal string `"New AnimatedBlock"`. 31 in one method.
- **nested types had an `ownerName` and no edge** — containment was emitted per
  visitor, and a nested type's visitor did not emit one, so containment
  navigation stopped at the enclosing class. It is emitted once in `pushSymbol`
  now, which is the form that cannot recur.

**Not closed.** No fixtures, no mutants, no F8 spec, no F10 floor, and no
committed `M14.0.F5` artifact — the canonical artifact belongs to the full
60-file, 30-language sweep, and a scoped `--lang vb` run refuses to write it
rather than replace a bigger claim with a smaller one. See `docs/vb.md` and
`reviews/vb/master-review.md`.

---

# Ontology pass `analyzer/VERIFY_VB10` — every verdict carries a number

The handover claim for this lane was "**10/10 labels, 0 unexplained endpoints**".
Measured through the production path (`getParser` → `parse` → `analyze`) on
`fixtures/repositories/roslyn-vb`, it is **7/10**, and it is 7/10 at every file
count tried. The three silent types are real absences, not sampling artefacts.

## The baseline, and why 10/10 was wrong

`script/m14/firing-check-v2.mjs VB`, code-bearing sampling, `roslyn-vb`
(3,751 `.vb` files on disk):

| NFILES | fired | silent | `imports[]` |
|---:|---:|---|---:|
| 50 | 7/10 | `uses` `exports` `instantiates` | 216 in 46 files |
| 200 | 7/10 | `uses` `exports` `instantiates` | 1,060 in 192 files |
| 400 | 7/10 | `uses` `exports` `instantiates` | 2,039 in 365 files |
| 1000 | 7/10 | `uses` `exports` `instantiates` | 4,645 in 920 files |

Edge counts at NFILES=200: `references` 3241, `contains` 2119, `calls` 1895,
`imports` 1060, `overrides` 595, `implements` 206, `extends` 113.

Three separate things were conflated in the handover claim, and each is worth
naming because each is a different error:

1. **A source scan counted `RelationshipType` symbols in the file.** That
   answers `constructible`, not `fires`. The seven types above are the ones the
   seven `relationships.push` sites can build; the three silent ones are the
   ones with no push site at all. Derivation saw the enum, not the corpus.
2. **`instantiates` and `uses` and `exports` were counted as covered** somewhere
   between the analyzer and the table. There is no `push` site for any of the
   three anywhere in this file — a grep for the enum members finds the *import*
   sites and no others.
3. **`imports` is a special case worth stating precisely.** This analyzer emits
   `imports` on BOTH channels: an `ImportInfo` per name on `ParseResult.imports`
   (what `parallel-indexer` writes to the `brain_import` TABLE) *and* an
   `imports` relationship row (`RelationshipType.Imports` from `engine.ts`,
   whose value is the string `"imports"`). `types.ts` spells the same member
   `"brain_import"`, which no emitter produces. So `imports` fires here and the
   1,060 in the `imports[]` column are a *second*, parallel set — they are not
   double-counted in the 1,060 `imports:` relationship rows, they are the same
   1,060 facts published twice by design.

## Two defects found outside this lane, named not fixed

- **`firing-check-v2.mjs` cannot resolve this lane's own name.** The documented
  command is `NFILES=200 bun script/m14/firing-check-v2.mjs VERIFY_VB10` and it
  exits 2 with "no lane matches". `resolveLane` splits the lane name into
  tokens and matches a token against a key as a *prefix*
  (`norm(k).startsWith(t)`, line 195) or the whole name against a key as a
  *prefix* (line 202) — and the programme's own lane naming
  (`VERIFY_<LANG><N>`, `BASH`, `JAVA`) fits neither: the language token carries
  its digit (`VB10`, not `VB`) and the `VERIFY` prefix is a prefix of the name,
  not of a key. Every lane launched with its own branch name hits this. Workable
  around by passing the bare key (`VB`); the fix is a token that *contains* the
  key, and it belongs to the master.
- **The instrument's lane key is `VB`, not `VISUAL_BASIC`.** `REVIEW-2026-10-04`
  §2 table row 4 lists `VISUAL_BASIC | csharp-sample | absent`; `LANES.VB` was
  repointed to `roslyn-vb` and the row was never updated, so the review's claim
  that VB had never been measured reads as still true while the table above
  contradicts it.

## The three silent types, each with the instrument its question needs

`script/m14/vb-construct-probes.ts`. Silence in `firing-check-v2` says the
analyzer has no construction site; it says nothing about the LANGUAGE. So each
silent type gets the instrument the question needs — a grammar inventory where a
node type would express the construct, and a parse-tree semantic count where it
would not.

Whole corpus, population derived: **3,751 `.vb` files, 3,751 parsed, 0 throws.**
The grammar produced **208 distinct named node types and 43 distinct anonymous
tokens**.

### `instantiates` — **GAP**, and a large one

| construct | count | files |
|---|---:|---:|
| `object_creation_expression` (plus the `New` inside an `invocation_expression`) | 16,871 | 1,266 |
| `array_creation_expression` (`New T(args)` with arguments) | 18,636 | 1,457 |

**35,507 construction sites.** VB.NET has the construct in bulk and the analyzer
publishes a `calls` edge for every one of them — carrying
`metadata.constructed: true` — but no `instantiates` edge exists anywhere in the
file. The family contract for `instantiates` is csharp's
`object_creation_expression` → `{source: enclosing, target: constructed type,
confidence: 0.95, metadata: {isNew: true}}`, and the shape transfers to VB
unchanged because the construct is the same construct.

### `uses` — **GAP**

| construct | count | files |
|---|---:|---:|
| `member_access_expression` / `with_member_access_expression` that is a READ | **536,141** | 3,555 |
| bare `identifier` that names a member THIS FILE declares | 415,065 | 2,939 |

A member read is the family's `uses`: go's GO1, csharp's CS-D4 and CS-R1 all
define it as a value read that is neither a call nor a write. One GRAMMAR FACT had
to be measured first, because getting it wrong makes the construct look absent:
**in this grammar `member_access_expression` has no `name` field and no
`expression` field.** Its children are positional — `identifier`, the anonymous
`.`, `identifier`. A probe written against the C# shape reads
`childForFieldName("name") === undefined` on every one of them and reports **0
member reads**, which is indistinguishable from "VB cannot read a member". The
first version of this probe made exactly that error and returned 0. The accessed
member is the **last `identifier` leaf**, which is the same `calleeLeaf` rule the
analyzer's own call path already uses.

A second measured fact shapes the callee test: `obj.M().N()` puts the
`member_access_expression` under an `array_access_expression`, not directly under
the `invocation_expression`, so the climb has to pass through it or every chained
call's leading segment reads as a use.

### `exports` — **RULED**, with the measurement that rules it

Two measurements, because a grammar cannot see a CONVENTION and the json lane's
own table records that a grammar-inventory-only ruling on `exports` was unsound:

1. **Instrument A — grammar inventory.** Across 3,751 files the grammar produced
   **208 named node types and 43 anonymous tokens. Zero of either contains
   "export" as a word**, named or anonymous. `module_declaration` — the nearest VB
   shape to a unit of publication — does not appear in the corpus at all. VB.NET
   has no `Export` keyword, no export statement and no export list.
2. **Instrument B — what is left.** **48,976 `Public` modifiers** across 3,217
   files are the only thing in this corpus that even resembles "published". A
   `Public` member modifier is a *modality*, it is already published on the symbol
   as `visibility`, and turning it into 48,976 edges would be manufacturing an
   edge the language does not have — the exact failure the workstream names when
   it says "a TOML value is a string in a format that defines no include, import
   or reference … inventing one would be worse than a thin graph".

The ruling is falsifiable, which is what makes it a ruling: a probe finding a
non-zero count of an export-bearing node type overturns it, and this probe is
committed so that it can be re-run.

### The grammar defect the tuple-return finding exposes

The same probe also counts `return_statement` nodes whose expression is a
parenthesised comma list. Over a 400-file draw: **2,016 `return_statement` nodes,
4 of them with a parenthesised expression, and 0 of those 4 containing a comma.**
The grammar cannot *represent* a tuple return at all, which is why the count is
zero rather than large. See the `Return (A, B)` repro above.

## Payload / latency AFTER the two added edge types — a REGRESSION, reported not re-baselined

`script/m14/vb-payload-latency.ts`, `VB_LABEL=AFTER-verify_vb10`, roslyn-vb,
**sample MEASURED 300 files of 3,751 DERIVED on disk** (sorted directory walk,
`VB_NFILES=300` — the identical sample the BEFORE row in commit `435b74053`
measured, so the two are comparable):

| | BEFORE `435b74053` | AFTER this branch | ratio |
|---|---:|---:|---:|
| relationships | 14,255 | 22,945 | **1.61×** |
| relationships / file | 47.5 | 76.5 | 1.61× |
| payload, total | 2417.6 KiB | 4600.4 KiB | **1.90×** |
| payload / file | 8.06 KiB | 15.33 KiB | 1.90× |
| parse latency | 2.99 s (10.0 ms/file) | 3.71 s (12.4 ms/file) | 1.24× |
| analyze latency | 5.46 s (18.2 ms/file) | 10.67 s (35.6 ms/file) | **1.95×** |
| analyze per edge | — | 464.98 µs | — |
| symbols | 5,795 | 5,795 | 1.00× |
| imports[] | 1,213 | 1,213 | 1.00× |

Payload bytes per type, AFTER, so the growth is attributable to a type a consumer
can actually filter on:

| type | edges | % of edges | payload | % of bytes |
|---|---:|---:|---:|---:|
| references | 5,782 | 25.20 | 898.0 KiB | 19.52 |
| calls | 4,837 | 21.08 | 1184.3 KiB | 25.74 |
| contains | 4,655 | 20.29 | 652.1 KiB | 14.17 |
| **uses** | 4,519 | 19.69 | **1073.8 KiB** | 23.34 |
| imports | 1,213 | 5.29 | 209.0 KiB | 4.54 |
| overrides | 889 | 3.87 | 299.3 KiB | 6.51 |
| **instantiates** | 677 | 2.95 | **180.2 KiB** | 3.92 |
| extends | 272 | 1.19 | 62.8 KiB | 1.37 |
| implements | 101 | 0.44 | 18.1 KiB | 0.39 |

**This is a regression against a green budget and it is reported as one.** The
workstream's rule is "report it — do not quietly re-baseline"; nothing here changed
a baseline. Two honest qualifications, both measured rather than asserted:

1. **`calls` is the larger half of the growth, and `calls` is not one of the two
   types added.** 1,303 → 4,837 edges, +3,534. That is the lane's own oracle's
   defect 1 and the `Sub New*`/argument-bearing-construction repairs landing in the
   same branch: a construction with arguments (`New Box(1, 2)`) was an
   `array_creation_expression` with no `function` field, so reading the callee from
   `function` dropped them. `uses` (4,519 edges, 1073.8 KiB) and `instantiates`
   (677 edges, 180.2 KiB) — the two types this ontology pass added — account for
   1,253.8 KiB of the 2,182.8 KiB growth, and `calls` for more than the rest.
2. **The workstream's own comparison is against `bb_graph`'s un-narrowed default,
   which is a per-QUESTION payload, not a per-corpus one.** 4600.4 KiB over 300
   files is 15.33 KiB/file; the 795 KiB (ripgrep) figure is a whole-repo graph
   answer. The lane cannot claim a ratio against it and does not: what it claims is
   the 1.90× growth of the relationship channel on an unchanged sample, which is
   the measurement a lane can make and a reader can re-run.

`ast-walk-cost.ts`, the shared instrument that would put this next to the other
lanes, has a hardcoded `$HOME/ishaq/fixtures/repositories` corpus that does not
exist on this machine and carries no vb sample. Reported to master; not edited.
