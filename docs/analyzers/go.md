# go.md — Go analyzer, M14 completeness wave

## Language

- Analyzer file: `src/ast/real-go-analyzer.ts`
- Parser: pinned `wasm/tree-sitter-go.wasm` (grammar audit PASS: 107 named
  node types, 38 analyzer references, 0 unknown, 0 unknown fields)
- Wired in: `engine.ts getAnalyzer` → `RealGoAnalyzer`
- Full symbol/relationship contract: `docs/analyzers/real-go-analyzer.md`
  (M12.22 baseline). This file records the M14 (#262) completeness wave.

## What the M14 wave fixed (all differential-verified)

The `go-tools` corpus differential (real Go code, tree-truth oracle) surfaced
five genuine analyzer defects; all five are fixed and pinned:

1. **Fabricated call targets from inline closures** — `buildGoCallExpression`
   returned the WHOLE func-literal text for non-nameable callees
   (`depth--\n\t}`, closure bodies), and goroutine/defer handlers returned
   `"anonymous_closure"`/full text. The oracle derives only declared-function
   and qualified leaves, so every one of those was an unexplained edge. Now
   leaf-resolved: identifier → name, selector → field leaf, everything else →
   no static name → skipped (same class as Rust's `(self.0)` fix).
2. **Closure-variable goroutines/defers emitted as calls** — `go done()` where
   `done` is a var-assigned func, not a declared symbol, is not a static call.
   `isGoResolvableCallTarget` now gates goroutine/defer emission through the
   same bare-call symbol contract as regular calls (qualified → leaf kept;
   bare → only if it names an in-file declared function/method).
3. **Package-scope calls never emitted** — `var _ = regexp.MustCompile(...)`,
   `var r = NewThing(...)` at package level were invisible to the body-only
   call walk. `analyzeGoPackageScopeCalls` now emits them (source `global`,
   leaf targets, constructor → instantiates, builtins/func-literals skipped).
   The oracle saw these as MISSING (newexpr.go, session.go, semtok.go).
4. **Dead `method_elem` literal failed the grammar audit** — the interface
   walk referenced `"method_elem"`, which does not exist in the pinned
   tree-sitter-go grammar. Removed; `method_spec` is the only
   interface-method node.
5. **Type conversions (and bare builtins) were call truth** — `string(x)`,
   `float64(x)` are `type_conversion_expression`, NOT calls; the oracle
   filters by its declared set, and the analyzer now does too.

### Deep review round 2 (2026-08-29, terraform corpus: 1423/1423, 0 missing)

A second deep pass over ~1,300 real Terraform Go files surfaced THREE more
defects the go-tools corpus could not (its interfaces are parameterless):

6. **Return-type scanners captured receiver/parameters as a fake return
   type** — `extractGoReturnType` and `extractGoMethodSpecReturnType` scanned
   for `parameter_list` children: `func (v *S) Notify(name string) {}`
   reported return type `(v *S)` (the RECEIVER) and a `method_spec` with
   parameters reported them as its return type. Signature comparison then
   failed, and parameterized interfaces silently produced NO implements edge
   (terraform `views.Plan` → `PlanHuman`/`PlanJSON`; the oracle saw them as
   MISSING). `parameter_list` is no longer scanned in the fallback — named
   result lists come from the `result` field.
7. **Embedded-interface methods never promoted** — `interface { Reader;
   Close() }` parses the embedded `Reader` as a `constraint_elem`, which the
   analyzer ignored (`method_spec`-only). The embedding interface's method
   set lost `Reader.Read`, so a struct implementing only `Close()` was
   (wrongly) declared to implement the interface, and one implementing the
   full promoted set was missed. Embedded-interface symbols are now emitted
   (leaf-named) and `getGoInterfaceMethods` folds their method sets
   transitively. The differential oracle was aligned (it shared the same
   blind spot).
8. **Embedded-struct method promotion** — `type Worker struct { *Shape }`
   promotes `Shape`'s methods into `Worker`'s method set, so `Worker`
   implements any interface `Shape` implements. Both analyzer and oracle
   silently omitted this (Worker could never satisfy an interface through an
   embedded type). `collectGoPromotedMethods` now resolves the
   `go_struct_embedding` closure (transitive, signature-deduped with
   shadowing honored) and the interface-implements check includes promoted
   methods; the oracle `structEmbedded` fold mirrors it exactly.

9. **Variadic interface parameters dropped, and `...` collapsed** (#914) —
   `extractGoMethodSpecParameters` accepted `parameter_declaration` only, so
   every variadic interface method lost its LAST parameter:
   `Logf(format string, args ...any)` on the declared side became
   `Logf(string) void` while the implementor kept `args`, and the textual
   compare refused a pair Go accepts. Not an edge case — every grpc-generated
   client method ends in `opts ...grpc.CallOption`, and terraform's view
   interfaces are `Output(code InitMessageCode, args ...any)`. It FABRICATED
   too: a fixed-arity `Dial(ctx, addr)` matched a variadic
   `Dial(ctx, addr string, opts ...string)` once the declared side had lost
   `opts`. Both extractors now publish `isVariadic` (the parameter's `type`
   stays the ELEMENT type — the pinned payload contract), and
   `buildGoMethodSignature` renders `...T`, so `...T`, `T` and `[]T` are three
   different types again.
10. **Implementor candidates were only the types DECLARED in the file** (#914)
   — but a Go method set is a PACKAGE-level property. gopls declares
   `clientDispatcher` in `protocol.go` and all 21 of `Client`'s methods in
   `tsclient.go`, so the file holds every method the interface needs and the
   pair is provable from its own evidence; the oracle had always keyed its
   implementor map by receiver NAME, so the analyzer was the odd side out.
   The candidate list is now the declared non-interface types PLUS every
   receiver type name with no same-file declaration (mirrored on both sides:
   a name with no declaration cannot be a declared generic, and a type whose
   embedding is declared elsewhere cannot promote).
11. **Alias interfaces and DIAMOND embedding** (#914) —
   `type A = interface{ M() }` parses as `type_alias`, not `type_spec`, and the
   ORACLE registered interfaces from `type_spec` only, so `A` never entered its
   map and `type T interface { A }` folded nothing (go-tools
   `gcimporter/testdata/issue25301.go` was the lane's only unexplained pair).
   Separately, both sides marked an interface visited and never released the
   mark — a global seen set rather than a path mark — so for
   `A { B; C }`, `B { D }`, `C { D }` the first branch to reach `D` consumed it
   and the second returned nothing: `Diamond → A/C` was lost by declaration
   order alone. Each side lost it in a DIFFERENT shape, which is why no
   differential could charge anyone.
12. **The oracle compared method NAMES only** (#914) — a strict SUPERSET of
   Go's rule, documented in the oracle as a deliberate simplification. It
   published pairs Go refuses (`Value -> Type` with `Elem() Value` against
   `Elem() Type`; `VT -> VI` with `F(int, ...string)` against `F(int)`;
   `Diff -> DiffRenderer`; `ReferenceMap -> GraphNodeReferencer`;
   `graphTransformerMulti -> GraphVertexTransformer`; every
   `UnimplementedXServer -> XClient`) and charged each to the analyzer as a
   MISSING edge it could never close. `deriveGoImplements` now derives the
   analyzer's canonical signature text from the tree — parameters by TYPE only,
   grouped declarations expanded one parameter per name, `...T` kept, named
   results reduced to their types, no result = `void`, whitespace collapsed,
   `interface{}` → `any` — and resolves each embedded interface/struct FULLY
   before merging.

All of the above are pinned by `go/implements-params` (parameterized implements
+ embedded-interface false-positive guard + embedded-struct `Worker→Runner2`
promotion + negative `PlainWorker` guard), `go/implements-signature-914` (variadic
parameters and the `isVariadic` payload field, receiver-only implementors, alias
interfaces, diamond embedding, and five same-name/different-signature negative
guards), the mutants `go/impl-iface-variadic-param-dropped`,
`go/impl-variadic-marker-stripped`, `go/impl-receiver-only-candidate-dropped` and
`go/impl-diamond-embedding-single-branch`, and `F9-PROBE-GO-IMPL-SIGNATURE` (which
pins the ORACLE side with `oracleForbid`; the executed negative against HEAD's real
code misses 5 of 8 edges and fabricates 5). At FULL extent the differential holds
0 missing / 0 unexplained on `go-tools` (1,931 files, truth 30,695), `terraform`
(1,993 files, truth 40,913) and `kubernetes` (13,488 files, read in index ranges).

## #419-D evidence tiers (family standard)

Go was the ONLY systems sibling (rust/c/cpp) that never tagged relationship
edges with `evidenceClass`, so completeness section D (≥2 tiers pinned) was
impossible. `classifyEvidenceTier` now runs over every emitted relationship
(metadata already tagged by the emitter is left intact):

- contains/exports → `structural`
- **imports** → `import_based` (round 5: the go import edge moved to the
  family's first-class `imports` label in the #799 round, which is what made
  the old `references`/`isImport` arm below unreachable; it is removed rather
  than left as a branch nothing can reach)
- references → `reference_qualified` (declared_type / return_type), else
  `usage_contextual`
- extends/implements/overrides → confidence ≥1 `structural`, ≥0.85
  `usage_contextual`, else `inferred`
- instantiates → `structural`
- everything else → `usage_contextual`

`exports` has no arm go can reach — the analyzer emits no `exports` edge. The
line is kept as a family-contract mirror (rust/c/cpp carry it) and is
commented in the source as a mirror rather than a live path.

## Per-symbol complexity (family standard)

`symbol.complexity` was absent for go functions/methods (result-level only),
so the completeness section-C complexity pin was impossible. Functions and
methods now carry per-symbol cyclomatic complexity computed by the same
counter as the result-level value (`calculateCyclomaticComplexity`).

## Completeness contract (#419) — 107 types, A–H

`script/m14/spec/go-completeness.json` classifies every named node type of
the pinned grammar (36 handled_verified, 68 internal_silent, 0 gaps, 3 RULED
decisions: GOD1 implicit interface satisfaction → method-set derives
implements; GOD2 struct embedding → single extends edge + bare-callee
declared-symbol contract; GOD3 anonymous func-literal/closures have no static
name → no calls target). Registered in `completeness-inventory.ts` with
requiredKinds (calls/extends/implements/instantiates/uses/references/
contains/imports), payload pins (complexity + qualified_calls via
`go/relationship-and-payloads`), docs (this file +
`real-go-analyzer.md`), and the `go-tools:go` corpus floor.

## Fixtures and mutants

- `validation/m14/fixtures/go/type-usage-graph.*` — declared-type reference
  graph (struct fields, params/receivers/returns; qualified_type keeps
  dotted pkg.Type; builtins excluded).
- `validation/m14/fixtures/go/relationship-and-payloads.*` — relationship
  kinds + evidence tiers + complexity + qualified_calls pins (extends via
  struct embedding, implements via interface method-set, calls
  function/package-scope/stdlib, instantiates via `NewShape`, uses via
  selector access, contains, references declared_type + import dep,
  complexity equals, qualified_calls leaf targets).
- `validation/m14/fixtures/go/round5-surfaces.*` (round 5) — the export rule
  (`Ünï`/`Ö`/`Ä` public and exported), the predeclared set (`comparable` must
  NOT become a `declared_type` target, and `interface{ comparable }` still
  DOES embed), parameter-vs-result by field, the Module range under a
  `//go:build` header, var/const name-node ranges, alias-to-struct `extends`,
  the framework vocabulary (`gorm` detected) and the struct-design score
  bonus. Valid, compilable Go — the two shapes no valid file can reach are
  pinned by the probe battery instead.
- Round 5's pins that are probes, not fixtures: `F9-PROBE-GO-BARE-CALLABLE-SET`
  (an interface-method name is not callable; a type does not implement itself)
  and `script/m14/tmp/go-round5-proto-names.ts` (the prototype-name crash
  class). Both carry the reason they cannot be fixtures.

## Differential floor

`go-tools:go {missing:0, unexplained:0, heuristic:0}` is pinned in
`validation/m14/differential-baseline.json` (822/822 files, 100% coverage,
0 unexplained at the pinned floor). The differential's regression gate
enforces the floor.

## Round 5 (2026-09-28): the read the gates could not do

Recorded in full in `reviews/go/sixth-review.md`. What belongs in the analyzer
doc is the *contract* — the rules a consumer of this analyzer can now rely on,
and the ones that changed.

### Corpus, at full extent

| tree | files | truth | MISSING | unexplained |
| --- | --- | --- | --- | --- |
| `go-tools` @`bf54bcd2` | 1,931 | 30,695 | 0 | 0 |
| `terraform` @`2e1710bf` | 1,993 | 40,913 | 0 | 0 |
| `prometheus` | 736 | 22,993 | 0 | 0 |
| `grpc-go` | 1,071 | 27,415 | 0 | 0 |
| `etcd` | 1,105 | 22,351 | 0 | 0 |

6,836 files, every label the harness compares for go, 0 skipped files. The
three new trees are read for a reason: the compared surface was already clean
on the pinned pair, so a defect had to be one the pair does not contain.

### What the differential cannot see

The harness offers go exactly five compared labels — `extends`, `implements`,
`instantiates`, `overrides`, `calls`. `uses`, `references`, `imports` and
`contains` are **excluded**, so a wrong edge on them can be neither MISSING nor
UNEXPLAINED. Across the three new trees that is **166,720 edges** with no
oracle. Four of the round's fifteen defects live on that surface; the rest live
in metadata.

### Contracts that changed in round 5

| rule | before | now |
| --- | --- | --- |
| **exported** | ASCII `A`-`Z`; a non-ASCII identifier was `private` and therefore absent from the export list | Go's spec: a **Unicode upper-case** test on the first code point (`toUpperCase(c) === c ∧ toLowerCase(c) !== c`) |
| **bare callee** | any `Function`/`Method` **by name**, including an interface method | a **declared function or method** only; an interface-method name is not callable (GO25) |
| **implements** | no self-pair guard (the oracle had one) | a type never implements itself (GO26) |
| **parameter vs result** | decided by `namedChildCount === 1` | read from the enclosing declaration's `result` **field**; a variadic parameter now reaches the declared-type graph at all (GO29) |
| **predeclared identifiers** | `any`, `error`, the numerics — no `comparable` | includes `comparable`, so a generic constraint no longer yields a dangling target (GO28) |
| **Module range** | hand-built at line 1 / byte 0 from the package name's length | `nodeToRange(packageClause)` — identical for a clause at byte 0, correct under any `//go:build` header (GO30a) |
| **var/const range** | the whole `var_spec` | the **name node's** range, the #919 rule the struct-field path already used (GO30b) |
| **struct embedding** | `type_spec` only | `type_spec` **and `type_alias`**, on the analyzer *and* the oracle — so `type A = struct{ *Inner }` emits `extends`, not just a member (GO31a) |
| **framework vocabulary** | two independently written lists that disagreed in both directions | one `GO_FRAMEWORK_RULES` table read by both; `golang.org/x/…` is `listed: false` (a namespace, not a framework) (GO31c) |
| **struct kind** | five predicates tested `SymbolKind.Class`, never emitted | `SymbolKind.Struct` — which is what activated the `struct_design` insight and its score bonus (GO31b) |
| **name-keyed maps** | four plain `{}` objects | `Object.create(null)`, so a type named `constructor`/`toString`/`__proto__` cannot crash the pass (GO35) |
| **regex** | 1 literal, unregistered | **0** |

### Performance

The implements pass's promoted-method closure is computed once per candidate
rather than once per (interface × candidate) pair, method signatures are
memoized per node, and each candidate's method set is indexed once. Emitted
edge sets are identical at every size measured. On a deterministic synthetic
shape (n interfaces × n candidates, 5 methods each, a 3-deep embedding chain),
cost per KB rose to 7.67× the smallest file before and 3.91× after; the ratio
at the largest size is 2.36×. On a real corpus (go-tools, 260 files in the
8–40 KB band) the ratio is **1.02–1.18×**, because a typical Go file never
reaches the quadratic term. The residual 3.9× is real and is named in the
review rather than rounded away.

### Round 5's own limits

- The canonical M14.0.F5 sweep was **not** re-run: it records
  `codeInputs.clean` and the commit it read, and the shared tree carries other
  lanes' in-flight work. The lane's F5 obligation is met by a strictly larger
  read (6,836 files at full extent against the canonical draw's 120).
- `GO-GAP-1` stands: two legal Go constructs have no representation in the
  pinned grammar, and error recovery swallows the declarations after them.
- The lane's `tracker` cell is not addressed. Tracker state is the owner's.
- R2 is red on **other lanes'** rows; this file's literal is no longer among
  them. The policy doc's declared survivor count still disagrees with the
  census, and correcting that number is M49's file, not this lane's.
- Three round-5 classes have a pin and deliberately **no mutant**, because the
  pre-fix emission is not reconstructible from the analyzer's output. The
  reasons are in `go-completeness.json` (GO25, GO26, GO30b) and in the review.

### New instruments

| script | what it answers |
| --- | --- |
| `go-round5-verify.ts` | 28 falsifiable cases, each declared as a DEFECT claim or a CONTROL; reads a comment-stripped analyzer for its code-shape cases |
| `go-round5-proto-names.ts` | the prototype-name crash class, against both analyzers (8/8 throw before, 8/8 publish after) |
| `go-round5-unknown-symbols.ts` | LANE-AUDIT-FORMULA §5 through the **production entry** (`parseFile`) |
| `go-round5-perf.ts` | §9: analyzer vs product entry, per 1k nodes, in a fixed size band, **with a measured load context** |
| `go-round5-perf-implements.ts` | §9's scaling check on the shape the implements cost lives in; pre/post interleaved, so the ratio is load-independent |
| `go-round5-fixture-dump.ts` | the emission in expectation-file shape, so a pin is derived from a probe and never from theory |

## Round 6 (2026-09-29): the three labels nobody was reading

Rounds 1-5 measured five labels, because that is all the harness offered go:

```
extends, implements, instantiates, overrides, calls
```

`uses`, `references` and `contains` were **excluded** — not clean, not dirty, unmeasured, which is
the state easiest to mistake for either. Round 6 built an independent derivation for each, admitted
the label to go's compared set, and read all three at full extent over five corpora / 6,825 files.

| label | truth rows | MISSING | UNEXPLAINED |
| --- | ---: | ---: | ---: |
| `references` | 127,061 | 0 | 0 |
| `contains` | 67,751 | 0 | 0 |
| `uses` | 154,656 | 0 | 4 |

The differential now audits **8 labels** for go and reads 100% / 0 MISSING / 0 UNEXPLAINED on both
pinned corpora at `--sample 200`.

### Defects fixed and pinned

| id | surface | what was wrong |
| --- | --- | --- |
| GO36 | `references` | `resolveSource` matched only `type_spec`, so a `type_alias` field's type was attributed to `global` — an edge whose source named nothing |
| GO38 | `contains` | the symbol walk `continue`d on every function, so a **local type** published no symbol — while the declared-type pass, which walks the whole tree, still named it. Same dangling source, opposite side |
| GOD9 | `uses` | the channel pass required a *named* containing function, so a channel read inside a **func literal** was discarded while the read passes published the same read as `global -> c` |

GO37 is a **ruling, not a fix**: a `parameter_declaration` inside a `function_type` describes a type,
not a result, so it is not a `return_type`. Pinned as controls S11/S14.

GOD9 is the one the differential could not have found, because the truth was originally written to
mirror the defect. A derivation that copies a defect reports agreement forever. The fix is one token
(`?? "global"`), and the negative control is exact: reverting it restores **precisely** the 2 MISSING
rows at lines 1611/1621 of `go/analysis/passes/unreachable/testdata/src/a/a.go` that the finding
predicted.

### Two corrections where the ORACLE was wrong

- **Channels are not a type question.** Gating the truth on a literal `channel_type` missed named and
  inferred channel declarations (`type Buffer chan int`, `var jobs = make(chan int)` — 9 in go-tools)
  and read 29 UNEXPLAINED. The **binding** decides: a send/receive operand in compilable Go is always
  a channel.
- **A 200-file draw hid the class.** The 3,370-row probe read 0/0; sorted order put the declarations
  past the cut. Full extent found it in seconds.

### A harness defect that made the lane look broken

Wiring `uses` in first read **3,208 MISSING on 200 files**. The cause is documented in
`differential.ts` at the allowlist, by a lane that hit it first: a `//` comment on the physical line
carrying a long expression runs to end of line and silently deletes the rest of it. The GO36 comment
had swallowed the `uses` entry, so the truth grew and the allowlist did not. It has now bitten two
lanes and the file predicts it; the entry sits on its own line.

### Line audit (new — lines had never been gated)

The F5 matcher reads no line (`differential.ts:15634`), so a wrong `line_number` on a correct edge was
invisible to every gate. `go-round6-line-oracle.ts` checks a **site invariant** from the parse, and
deliberately does not re-implement the analyzer's walk order. **97,185 edges over 5 corpora: 0 missing
lines, 0 site mismatches.**

Disclosed rather than passed: the published line is not always the first site in source order (24,242
selector, 3,893 identifier rows) — the analyzer dedupes per `(source, target)` and keeps whichever site
its walk reaches first. That is a measured property, not a claim.

### Round 6's own limits

- **4 EXTRA rows** (0.0026%), all in `testdata/` mutation fixtures — the analyzer is a strict
  superset, so no read is hidden. Recorded as `GO-GAP-2` with exact file and line.
- **Shadowing is resolved by name**: a local `c` shadowing a package `c` is attributed to the package
  symbol. Shared with the read passes; not changed mid-round on one label.
- **`imports` is still out.** Three labels were admitted; `imports` was not.
- **prometheus, grpc-go and etcd are measured but not gate-pinned** — the differential still maps go
  to go-tools + terraform, so those 2,901 files are evidence, not a gate.

## Round 7 (2026-09-29): the ninth label, and two latent crashes in my own oracle

Round 6 left the go lane auditing eight labels. There was a ninth.

`imports` has been emitted for every `import_spec` since **GO18**, and the analyzer's own comment
says go's `requiredKinds` "has named `imports` since the wave" — completeness section B reads the
marker, so the kind was claimed twice over and compared by nobody. Across the five corpora that is
**2,214 distinct import targets**, entirely outside the differential, and it is the label framework
detection reads (GOD7 rewrote framework detection on top of it).

The allowlist is now an explicit enumeration of the labels the analyzer actually emits, each on its
**own physical line** — that formatting is load-bearing and has bitten three times, because a `//`
comment on that expression runs to end of line and deletes the rest of it.

### GOD10 — the wrapper the recovery threw away

An unterminated import block does not parse into a degraded `import_declaration`; the grammar emits a
**bare `ERROR` node holding the specs directly**, so a pass keyed on the wrapper lost the whole
block. Ruled **publish**, per GO16 (recovery must not swallow a declaration the tree can still see) and
consistent with the GO15/GO17 distinction that suppresses only *values* read out of a recovery.
**0 corpus instances in 6,836 files** — a full-extent read returns 100% with or without the defect,
so only a shapes probe could find it.

### Two undefined identifiers in the round-6 oracle (GO42)

`d8823c13` removed the three round-6 oracles from `differential.ts` entirely. Restoring them exposed
that the inlined copy referenced **two identifiers defined nowhere**: `goEmbeddedFieldLeaf` (should be
`goEmbeddedLeaf`) and `GO_PLAIN_IDENTIFIER` (a *regex*, in a lane that forbids one). Either throws the
moment the branch runs.

It survived a 100% run because the branch is reached only by an embedded field and **the F5 draw
rotates** — the same command reports `rot 2` then `rot 7`. The deeper cause was two copies of one
derivation: the tested field-driven copy in `tmp/`, and an untested copy wired into the gate.

**Consequence, recorded as a rule:** the F5 sample is never a stable count. Full-extent, sorted,
non-rotating reads (`go-round7-refs-recheck.ts`) are the only figures that can carry a coverage claim.

### GO41 — `overrides` was a promise with nothing behind it

The go analyzer emits `RelationshipType.Overrides` **zero times**, yet `overrides` sat in the compared
set. Go has no override: dispatch is interface satisfaction (already `implements`) and embedding is
already `contains` on the owner. The entry is dead and is removed rather than left as an empty promise.

### Two instrument bugs this round, both recorded

- A duplicate-edge detector keyed on `source|target|line` **without the file** collided `main|fmt|9`
  across 14 files and reported 5,703 "duplicates" of which none were.
- GOD10's own mutant used `indexOf("import (")`, which matched inside `imports-recovered.go`'s own
  **comment** — the fixture documents the shape, so the literal appears in a `//` line — and the
  mutant survived its own fixture until made line-based and comment-aware.

An instrument that cannot produce a false positive cannot produce a finding. Both are in the review
and in the mutant's description.

### Round 7 measurements (draw-independent, 5 corpora / 6,836 files)

| label | measure | MISSING | UNEXPLAINED |
| --- | ---: | ---: | ---: |
| `imports` | 2,214 distinct targets | 0 | 0 |
| `references` | 9,999 distinct targets (116,329 `declared_type` + 10,736 `return_type`) | 0 | 0 |
| `uses` | 154,656 rows | 0 | 4 |
| `contains` | 67,751 memberships | 0 | 0 |

`imports` also reads **0 line mismatches** and **0 duplicate edges** — the first go oracle to assert
either. 11/11 discriminating shapes pass; reverting GOD10 fails precisely one of them.

Gates: fixtures **17/17**, mutants **54/54**, F6 36 types / 129 fixture types / 0 uncovered,
differential **100%** on both pinned corpora across nine labels, tsc clean.

### Round 7's own limits

Unchanged and still open: the differential is **blind to source** (GO36/GO38 were both source
defects), send/receive direction is invisible to the matcher, the 4 `uses` EXTRA stand as GO-GAP-2,
shadowing is resolved by name, there is **no M60 line round for go**, and prometheus/grpc-go/etcd are
measured but not gate-pinned.

## Round 7 (part 2): the M60 line round, and the sources that resolve

### M60 line round — three instruments, three different questions

M60's root-cause question is not "is this line right" but **"does this row have a line at all"**.
cpp #870 was a single `line_number: 0` in a whole 21-language sweep, caught only because that
analyzer emitted no line on *any* row. Nothing of the kind existed for go.

| instrument | question | result |
|---|---|---|
| `go-round7-line-census.ts` | PRESENCE, full extent, per (label, marker); zeros / negatives / past-EOF counted separately | **126,738 go-tools and 127,625 prometheus edges, every one carrying a line.** 0 missing, 0 zero, 0 negative, 0 past EOF — **M59.O3 holds** |
| `go-round7-line-conventions.ts` | the CONVENTION: 14 cases, 21 pinned sites, each naming the alternative site it must not report | 14/14, with negative controls |
| `go/line-conventions-2` | the four constructs `callsite-lines-825` never covered, with forbid rows | pinned |

The conventions probe reads its expected line **out of the source** via a `// @line:` marker rather
than hand-counting, so it cannot be wrong by an off-by-one — and `build()` now refuses to return a
case that pinned nothing, because the first run reported 14/14 ok with **0 pinned sites on every case**
(the marker regex was anchored at `^\s*//` while markers trail real code). A probe that cannot fail
reported green.

Negative controls: reporting the **receiver** line for a selector use fails exactly one case;
shifting an import to the `import (` declaration line fails exactly one case.

The four constructs newly pinned: `return_type` (the result type's line, two below `func produce() (`),
`instantiates` (a generic *call* instantiates the function at the callee line; a composite literal
instantiates the *type* at the literal's line — two targets in one body), `identifier_usage` (the
identifier's own line, the first line of a wrapped expression), and `go_channel_operation` (the
statement's line, send and receive as separate rows sharing a target, plus the file-scope `global`).

### Every relationship's source must name something — the resolution census

The differential matches `label + normTarget(target)` and reads **no source**, so an edge whose source
is a pseudo-source is indistinguishable from a good one. Three defects this session were all exactly
that, and none of them the differential could see. `go-round7-dangling-sources.ts` makes it measurable.

| | before | after GOD11 + GOD12 |
|---|---:|---:|
| edges | 716,968 | 720,663 |
| `global`-sourced | 6,723 (0.94%) | **2,184 (0.303%)** |

**GOD11** — a package-scope `var named Store` attributed to `global`, and *losing* rows rather than
only mis-sourcing them: `emitted` is keyed `source|target|relType`, so six declarations sharing a type
collapsed into the first one's row. Now each attributes to the name it declares, one edge per name.
Function-local is unchanged (LocalsAreNotSymbols); the **blank identifier is excluded** — my first cut
produced 713 `references _ -> Code` rows, still unresolvable, merely renamed.

**GOD12** — work inside a package-scope initializer (`var re = regexp.MustCompile(...)`,
`var api = Client{Timeout: ...}`) attributed to `global`, across `calls`, `uses` and `instantiates`.
One `resolveGoWorkSource` helper now answers for all three; the package-scope call emitter's `source`
was hardcoded to `global` and its dedupe key was the bare leaf, so two initializers calling the same
leaf collapsed. +3,695 edges recovered, which is the lost-row half of the class.

Both fixes **regressed something on the way in and both were caught by existing pins**:
GOD11's blank-identifier change, and GOD12's first cut which `break`ed instead of continuing the walk
and so answered `global` for every function-local `var x = T{}` — breaking
`go/relationship-and-payloads` and the new conventions case in the same run.

**Two classes ruled rather than fixed**, and one instrument corrected:

- **GO43** — 1,203 `contains` edges whose owner is an **untyped receiver** (`func (s) M()`). A receiver
  is a parameter, so it names no node; every available answer trades a dangling source against a lost
  membership, so it is declared with a count rather than chosen silently.
- **GO44** — the census first reported 3,167 "dangling" sources, but the largest class was
  `contains ModuleInstance -> Action` where the type is declared in a **sibling file of the same
  package**. That is correct in a package-scoped language: the *instrument* was wrong, and it
  manufactured 2,439 phantom defects on terraform alone. An instrument that invents a thousand
  phantoms gets ignored — and then the real six thousand go unread.
- **GO45** — the 2,184 that remain, broken down per label, with the 947 `references` explained as
  blank-named declarations that genuinely have no name.

## Round 8 (2026-09-29): the master review, and what the checklist found

`reviews/go/master-review-v2.md` supersedes `master-review.md` — the first review, written when the
lane measured five labels, and seven review rounds out of date. This round re-ran the whole checklist.
**Four of its eight items were dirty or unguarded on arrival**, which is the reason to run one rather
than declare victory.

### The checklist

| item | verdict |
|---|---|
| All relationship types covered | **8 of 8 emitted**, `overrides` ruled out (GO41) — enforced by `verify-go-lane-coverage.ts` |
| All relationship types explained | yes, per label and per marker, in the review §3 |
| 100% coverage output | yes on the gated sample (4 consecutive draws, 0 MISSING, 0 unexplained); the full-extent figures are in the review §4 |
| No unknown symbols | **0 at full extent** — 1,931/1,931 files, 27,572 symbols, 0 throwOnParse / unknownKind / badName / memberWithoutOwner |
| No regex, pure AST | **0**, now enforced by a character-level scan with string/template/comment state |
| M60 line numbers | **478,436 edges, every one carrying a line**; 0 no-line / 0 zero / 0 negative / 0 past-EOF. M59.O3 holds |
| Perf | **no measurable cost** — ratio 1.0066, ms-per-1k-nodes 51.455 → 50.106 |
| Docs | this file + the review |

**Not claimed, because not true:** the F5 100% is a **rotating** 200-file draw, not a full-extent read.
1,203 `contains` edges name an owner the grammar cannot resolve (GO-GAP-3). And the lane's measurement
had been **deleted four times** with a green gate every time.

### What the checklist turned up

**The regex ban was true and unenforced.** It is enforced now — after three wrong detection patterns,
each caught by a negative control rather than by reading the code.

**Lines had never been audited.** Round 6 proved a target is *written on* a line; nothing proved every
row *has* one, and nothing could choose between two plausible sites. Both questions now have
instruments, and the answer is clean — but it was clean by luck.

**Two latent `ReferenceError`s** sat in the round-6 oracle: a typo (`goEmbeddedFieldLeaf` for
`goEmbeddedLeaf`) and an undefined **regex** (`GO_PLAIN_IDENTIFIER`, in a lane that forbids one).
Either throws the moment the branch runs, and the branch is reached only by an embedded field — so
whether it fired was a property of which 200 files the rotating draw picked.

**GOD13 and GOD15** closed 1,949 rows of defect the differential structurally cannot see, because it
matches `label + normTarget(target)` and reads **no source**. In every case the **analyzer was right**
and the oracle was loose.

### Declared, not fixed

- **GO-GAP-3 (1,203 edges)** — `func (T) NoName()` and `func (s) Untyped()` produce **identical trees**;
  the grammar cannot tell a receiver written without a name from a receiver with no type. The only
  discriminator would delete 1,251 *correct* sibling-file edges to fix 1,203 edges in non-compiling
  files. A fix was written and **reverted** because its predicate never fired.
- **GO45 (2,184 edges)** — ruled **correct**: the residue is the compile-time assertion idiom
  `var _ Preempter = PreempterFunc(nil)`, where the declaration deliberately has no name. Attributing
  to `_` was tried and is worse — `_` can never be resolved by anything.

### Instrument bugs worth recording

Every one was caught by a control, not by inspection: a probe reporting **14/14 ok with 0 pinned
sites**; a duplicate detector reporting **5,703 phantoms** because its key omitted the file; a mutant
that matched `import (` **inside its own fixture's comment** and survived; and the coverage gate
finding four bugs in itself, including **three** successive wrong regex patterns.

## Evidence pointers

- Fixtures: `validation/m14/fixtures/go/`
- M14 differential evidence: `validation/m14/results/M14.0.F5.json`
- M14 completeness evidence: `validation/m14/results/M14.0.SPEC.json`
- M14 grammar evidence: `validation/m14/results/M14.0.F1.json`
- Ground truth / differential: `validation/m12/results/go-differential.json`
- Docs: this file + `real-go-analyzer.md`
