# Solidity analyzer — `real-solidity-analyzer.ts`

Every number in this document is re-derivable by a command named beside it. Where a
number could not be derived, it says so. The three claims this lane's handoff
carried that turned out to be **wrong** are recorded where they bite rather than
quietly dropped, because a handoff is not evidence.

---

## Provenance

Two different claims, deliberately not merged.

**What upstream is.** `tree-sitter-solidity@1.2.13`, vendored at
`grammars/tree-sitter-solidity/`, with the generated `grammars/tree-sitter-solidity/src/grammar.json` and
`grammars/tree-sitter-solidity/src/node-types.json` checked in alongside `grammar.js` so the pin gate can compare
source to bytes. Declared in the `LANES` table of
`script/m14/verify-grammar-pins.ts`; the generated record is
`validation/m14/grammar-pins.json`.

**What we ship.** `wasm/tree-sitter-solidity.wasm`, sha256
`07420813d7668445152a5d5d2017e0fb84cb27342257e1add3cc7462eec7f811`, 508,582 bytes,
ABI 15, 531 node types, 35 fields, **byte-identical to the npm tarball's own wasm**
with **zero local patches**.

Those are different claims and the difference is the whole reason this lane's grammar
needs no work queue. A local rebuild would replace a published artifact with one that
merely resembles it: a rebuild's sha256 is not a function of its source across
toolchain versions, so nothing would object to drift. Byte-identity with a file
somebody else shipped is the only provenance kind structurally immune to the failure
the PowerShell lane hit — a pin record claiming 8 patches against bytes containing 7,
invisible to every structural check because sha, length and surface digest all agreed.

**There is no build step and none is wanted.** The package publishes a prebuilt wasm,
so the bytes are the maintainer's artifact. Re-derive the identity with
`npm pack tree-sitter-solidity@1.2.13` plus a `sha256sum` of the extracted wasm; the
pin gate additionally compares the wired bytes against a durable mirror at
`~/.bb/wasm/tree-sitter-solidity.npm-1.2.13.wasm`, so the claim survives that copy
disappearing.

**What the corpus is.** `OpenZeppelin/openzeppelin-contracts` at
`32b5b8c4655448291e27272d43607b9e3ae8c1d8`, 420 tracked `.sol` files of which **389
are production** (`test/` and `*.t.sol` excluded). Real production Solidity, not a
tutorial set — which is why the draw is 0% damaged and why this lane has no grammar
work queued.

---

## Contract

Each concern, its ruling, and the measurement or grammar line that forced it. The
analyzer's own header carries the same rulings with their derivations; this table is
the index.

| # | Concern | Ruling | Forced by |
|---|---|---|---|
| SOL-1 | The file is the module | The `module` symbol is the file's basename **with** its extension, and it OWNS every file-scope declaration. No synthesised `global` scope symbol. | A `.sol` file holds several top-level declarations (389 files → 325 contracts, 75 interfaces, 65 libraries), so no single declaration names the file. `isIndexArtifactName` rejects `global`, so a synthetic scope makes every file-scope edge unresolvable. |
| SOL-2 | Declaration / reference / call / **read** | A read is an `identifier` whose **parent is an `expression`**. Positional, not a name list. | Every declaration name in Solidity is the `name:` field of its declaration node, so a declaration name can never sit under an `expression` and the two classes cannot overlap. A name list would need ~40 suppressions and would still leak. |
| SOL-3 | The public state-variable getter | **Published**, as a method named with its external signature — `bal()` — plus a `references` edge from the variable to it. | `uint256 public bal` makes the compiler synthesise a getter written nowhere in the source. A Solidity identifier cannot contain `(`, so `bal()` cannot collide with `bal`. **The first draft recorded the getter in `metadata` and published nothing, and measurement killed it**: `parseFile` returns every symbol with `metadata: undefined`, because `src/ast/pool-worker.ts` drops the object at the worker boundary — the same seam that cost PowerShell its `is_static = 0`. A decision the store never received. |
| SOL-4 | `constructor`, `receive`, `fallback` | Names **read off the leading keyword token**, not synthesised. | `constructor_definition` has no `name:` field — but Solidity writes the literal word, so the line is the real name line and needs no null-line handling. `fallback_receive_definition` is ONE rule for two keywords. |
| SOL-5 | `is` is not always `extends` | An ancestor bound to an `interface_declaration` **in this file** is `implements`; everything else is `extends`. | Solidity has one heritage construct with no `interface` keyword in the list, so the tree does not say which kind each ancestor is — the distinction lives in the ancestor's own declaration. |
| SOL-6 | Recovery regions | **Nothing** is emitted from a source line the parser invented. The rule is a line RANGE, not an `ERROR` subtree. | On `recovery-regions-sol6.sol` the parser emits an `ERROR` covering only `is not ) valid solidity ( at`; the tokens `this` and `all` are **siblings** of it. The subtree rule published a symbol named `all`. |
| SOL-7 | EVM globals | A global's **members** are not project members. `msg.sender` publishes nothing; `this.f()` and `super.f()` keep their `calls` edge. | `msg`/`block`/`tx`/`super`/`this` are **not** grammar tokens — 262 alphabetic anonymous tokens and none of these five is among them, `externals` is empty — so `GLOBAL_OBJECTS` is DECLARED and labelled as declared, not presented as measured. |
| SOL-7b | Engine functions | An identifier-spelled builtin is refused at the emit site, and the **residue is counted**. | `require(x)` and `function require() internal {}` produce **identical trees**. No `hasError`-keyed gate can see a fabricated `calls -> require` — exactly the PowerShell PS5 failure. |
| SOL-8 | EVM builtins | An opcode is not a Yul call. | `yul_function_call`'s `function:` is `choice(yul_identifier, yul_evm_builtin)`. The skip is **lossless**: the lexer always spells a bare `add` as the builtin, so no user Yul function can carry the name. |
| SOL-9 | The callee resolver | Recurses through the wrappers the grammar builds and stops at the first name. | `t.call{value: 1}("")` is a `call_expression` → `expression` → **`struct_expression`** (grammar.js:801, conflicting at :53). The intuitive `identifier`/`member_expression` model returns nothing for every option-bearing call in the language. |
| SOL-10 | Two struct spellings | `S({a: 1})` (call + `call_struct_argument`) and `S { a: 1 }` (`struct_expression`) both yield a constructor `calls`. | Both spellings exist: 33 and 13 corpus occurrences, disjoint. |
| SOL-11 | `overrides` | **Three tiers.** Base in-file **and** declaring the member → **0.9**, verified. Base **not** in-file but named by an explicit `override(…)` → **0.75**, `inferred`, `meta.reasonCode: "named-by-override-specifier"`, `meta.externalBase: true`. Bare `override` with **one** header base → **0.75**, `reasonCode: "single-header-base"`. Bare `override` with **two or more** header bases → **no edge**. `AnalyzeContext.overrideCompanion` is read when a caller populates it. | Solidity's compiler **rejects** `override(X)` unless `X` declares the member, so for any compiling source the edge is the language's own invariant, not a guess — which is why an external base may be emitted at all. Fifteen sibling analyzers get cross-file overrides from `overrideCompanion`, and **nothing in production ever populates it**; Solidity does not need it. The 2+-bases case stays refused because the keyword says *one* of them declares the member without saying which. |
| SOL-12 | `exports` | The **compilation-unit surface**: every file-scope declaration except a free function. | Solidity has no export construct. `solc` emits an ABI and abstraction for each contract, interface and library and nothing else; a free function contributes no ABI entry. |
| SOL-13 | A function is a declaration container | Its **locals belong to it**, so `contains f -> ok` rather than `contains C -> ok`. | Solidity locals are strictly function-scoped, so the contract-level edge is simply false. PowerShell PS3 deliberately keeps a method's owner as its class; that is right for PowerShell and wrong here, and the divergence is stated rather than inherited. |
| SOL-18 | Per-symbol `complexity` and `ownerKind` | Every function, modifier, constructor and fallback/receive carries a cyclomatic `complexity` attributed through the FRAME stack (1 + branch nodes inside that frame, nested declarations excluded); `ownerKind` is the kind of the enclosing type — `contract` or `interface` — read from the declaration table, and is ABSENT for a local whose owner is a function. | Before SOL-18 **every** Solidity symbol reported complexity 1: `pool-worker` defaults to `s.complexity || s.metadata?.complexity || 1` and the analyzer set neither, so the field was populated corpus-wide with a constant that reads as a measurement. It now reaches **25**, with 690 symbols above 1 and a mean of 1.214. The frame attribution costs one increment per branch node and no second traversal, which is the cost the TypeScript lane measured and removed. `else` is PART of `if_statement` in this grammar, so an if/else pair is ONE branch. |
| SOL-16 | NatSpec documentation | `///` and the slash-star block form attach to the **next** declaration and are published as `docstring` (first-class, persisted to `brain_symbol.docstring`), `comments` (per-comment array, the shape the TypeScript lane uses), `docstringKind` (`natspec-line` / `natspec-block` / `line`) and `docTags`. Markers stripped with `startsWith`/`slice`. A run of line-ADJACENT comments is one docstring; a blank line ends the run. | Solidity's documentation system, and the lane read none of it: 5,254 `comment` nodes, zero reaching a symbol. Attachment is measured, not assumed — a comment's `prevNamedSibling` is NULL, and only the LAST comment of a run has the declaration as its next sibling, so per-comment attachment keeps one line in three. A comment before an expression, or a trailing remark, documents nothing and is dropped. |
| SOL-17 | Applied modifiers are `decorators` | `function f() public onlyOwner nonReentrant` publishes `decorators: ["onlyOwner","nonReentrant"]` on the symbol; a DECLARED modifier with nothing applying it carries none. | Solidity's annotation mechanism is what the TypeScript lane calls a decorator, and this is the FAMILY CONTRACT: C#, Java and F# all treat decorators as metadata on the thing they decorate, and the `modifier_invocation` case already emits the one edge that carries meaning — a `calls` edge, because invoking a modifier IS calling it. Measured: 188 of 5,976 symbols, over 40 distinct names. |
| SOL-15 | Every `calls` edge carries a `calleeKind` | `localFunction` (declared on the enclosing type) · `inheritedMember` (reached through an in-file base) · `inFileTypeMember` (a member of another in-file type, via a receiver or `using X for T`) · `modifierInvocation` · `eventEmission` · `errorRevert` (a custom error) · `namespaceBuiltin` (`abi.` / `type.` / `super.` / `this.`) · `external` (declared in another file). Derived from the grammar and this file's declarations; **no hand-written list of builtin member names**. | A call edge used to be emitted from the callee NAME alone, so the census reported one undifferentiated "1,786 unresolved" class mixing a conversion, a language namespace, a custom error and a genuinely cross-file member. There is deliberately no builtin-name list: the first measurement had one containing `at`, `contains` and `length`, which are user-defined `EnumerableSet` methods — it would have silently reclassified live project edges. A conversion (`uint256(x)`) emits **no** edge at all, because `calleeNameOf` has no `primitive_type` case and a conversion is not a call. |
| SOL-14 | Store-refused names | Not declared. | `pool-worker.ts`'s `UNIVERSAL` denylist says such names are "never legitimate declarations in any language". For Solidity that is false: `self` (CrosschainLinked.sol:59) and `root` (MerkleTreeMock.sol:15) are both real. Measured as 2 unknown `contains` targets before the rule existed. |
| F9 | Edge targets | An edge target must be a name a stored symbol could have. | A target carrying `/` names nothing, and would sit at **zero** `unknownTargets` for as long as it existed — the metric asks whether a target *matches* a symbol, and a name matching nothing is no more detectable than one matching something. |

---

## Complexity envelope

(M60 R6.) One iterative DFS with an explicit `{node, exit}` stack — no recursion
whose depth is input-bounded. A frame stack whose depth is declaration nesting depth,
carrying both `owner` (the nearest declaration container, which a `contains` edge
names) and `scope` (the nearest scope, which a `calls`/`uses` edge is sourced from);
they differ inside a contract, which is the point. A Map symbol dedupe keyed
`owner\0name\0kind`. A Set **per-site** relationship dedupe — the line is in the key,
so two call sites of one callee are two rows, because the store resolves a
containment edge *by* the line it carries. Descendant searches that stop at the
first hit. One O(n) pre-pass for SOL-6's recovery line set, consulted by an O(1)
`Set` lookup at each emit. `overrides` resolves in a single **post**-pass, because a
base may be declared after its subclass — legal Solidity, and the corpus does it.

Cyclomatic complexity is counted once per branch, **before** the switch (half the
branch constructs are in the silent list, and counting them in `default` meant the
switch consumed them first — measured 4 where there are 7), counting control flow and
short circuits only, with the operator read **structurally** rather than by matching
source text.

Measured: `bun run script/m60/solidity-surface-measure.ts` →
`103.72 ms/file, 813 facts/ms` over 389 files at `loadAvg1 27.42` on 8 cores, with
`perfIsQualified: false` because of it.

---

## Regex inventory

**Zero.** 0 regex operations and 0 stored regex literals in
`src/ast/real-solidity-analyzer.ts`, enforced — not asserted — by
`script/m60/solidity-zero-regex.ts`.

The policy the analyzer's header states: **no regex in that file decides a fact.**
Every symbol, relationship, type and parameter is read off the AST. The four
character-loop helpers that remain normalise AST-derived text (a basename, an import
path, a quoted literal, a plausible-name test), and `isSpaceCode` spells out all 25
code points of JavaScript's `\s` rather than the `c <= 32` approximation that
silently stops matching NBSP.

The gate has a **second half**, which matters more than the first: it asserts the four
helpers are still PRESENT. Without that it is trivially satisfiable by deleting the
work, and a green "zero regex" meaning "nothing left to be wrong about" is the vacuous
pass this repo refuses elsewhere.

**The gate is itself checked in both directions.** `--selftest` runs it over three
mutated copies and requires all three to FAIL. It earned its place on its first run:
3 of 8 expectations failed and every failure was a defect in the **gate** —
`findStoredLiteral` tested the character immediately before the `/` (so
`const x = /ab+c/gi` scored 0 literals), one mutant's cut over-ran and took a second
helper with it, and one mutant injected `target.split(" ")`, which is not a regex
operation at all.

Re-derive: `bun run script/m60/solidity-zero-regex.ts --selftest`

---

## Supported constructs

All 126 named node types the gate's universe contains are classified exactly once in
`script/m14/spec/solidity-completeness.json`: **98 handled, 21 internal_silent,
0 gaps, 7 design_decision.** The 21 silences are wrappers and payloads whose content
is read by their children, and each names which child — "it is a wrapper" is not a
reason until you say which wrapper.

Yul is analysed as a **first-class sub-language**, and that is a measured decision
rather than a preference. The handoff proposed ruling it out on the grounds that the
corpus under-represents it; the census **refuted** that. Over the full 389-file
production corpus: 2,800 `yul_function_call`, 2,819 `yul_identifier`, 2,640
`yul_path`, 447 `assembly_statement`. Ruling Yul out would have removed more edges
than the entire contract layer's call graph. Yul functions, variables, calls, paths
and loops each get a case.

**The 126 is not 124, and the difference is not a detail.** `grammars/tree-sitter-solidity/src/node-types.json` declares
124 named types. The gate builds its universe from the wasm's own walk and then adds
an explicit universal `["ERROR", "MISSING"]` pair, because tree-sitter produces both
on every parser while listing neither in the wasm ABI. The first run of this section
therefore reported seven types unclassified — five of which the section had correctly
ruled, in a `type` field the gate does not read. Both corrected here, under the gate's
own rule that when two instruments disagree the fix is never to delete the correct
row.

Re-derive: `bun run script/m60/solidity-completeness-spec.ts --verify-silence`
(the silence bucket is verified against live sources, not asserted).

---

## Verified limitations

Named, with their measured size. None of these is hidden in a percentage.

1. **Cross-file inheritance resolves as `extends`.** 507 edges over the 389-file
   corpus: an ancestor that is really an interface declared in **another file** gets
   the wrong KIND — not a missing edge. Reported as `implementsCrossFileUnresolved`.
   The census in limitation 3 quantifies the same ceiling from the other side: 430
   `external` call targets resolve through an ancestor's member list, and some ancestor
   routes are **under-counted** here precisely because these 507 edges mis-type the very
   bases whose members are being looked for.
2. **`overrides` is now 422/100 emitted/unresolved — and the 100 are a real
   ambiguity, not a gap.** 414 of the 422 point at a base declared in **another file**
   (`overridesEmittedExternal`), carried at 0.75 with a `reasonCode`. That was not the
   first draft of this lane: it emitted **8** and reported **386 unresolved**, which
   is the JavaScript lane's failure mode wearing a different language — a true fact
   dropped for want of a companion index nobody builds. Solidity needs no guess,
   because the compiler enforces `override(X) ⟹ X declares it`. The remaining **100**
   are bare `override` over 2+ header bases: Solidity 0.8.8+ requires an explicit
   list precisely when more than one base declares a member, so the keyword says one
   of them does and not which. Reported as `overridesUnresolved` /
   `overridesAmbiguousBaseCount`.
3. **1,849 `calls` targets resolve to no local symbol** (543 distinct), and every one
   is now CLASSIFIED rather than pooled — `external` 1,642 (a member or free function
   declared in another file), `errorRevert` 148, `eventEmission` 59. Two kinds are
   EXCLUDED from the figure because their target is not a project symbol by
   construction: `namespaceBuiltin` 269 (`abi.encode`, `type(X).y`, `super.f()`) and
   `conversion`. **Expected, and not meant to be 0**: Solidity has no syntax that
   separates `t.transfer(…)` from a user-defined member call, so suppressing the class
   would lose real edges. Note the figure ROSE from 1,786 while the lane got more
   correct — see limitation 11. Top
   targets are in the surface artifact as the adjudication surface.

   **The `external` class was then MEASURED rather than left as a ceiling.**
   `script/m60/solidity-projectwide-census.ts` audits all 1,677 of them against the whole
   389-file corpus and gives each one of four verdicts: `in-file` 35 (2.1% — the name
   matches a local declaration, so the *caller* is under-determined, not the target
   missing), `ancestor-member` 430 (25.6% — an ancestor declared in another file declares
   that member), `project-declared` 1,134 (67.6%), and `external` **78 (4.7%)**. So
   **93.3% is project-resolvable and 4.7% is the true floor** — low-level EVM members
   like `x.delegatecall` and library free functions from packages this corpus does not
   contain (solady's `ShortStrings.wrap`).

   The important part is not the ratio. **The ceiling is an unfilled parameter, not a
   language limit.** `AnalyzeContext` is this repo's own hook for project-wide knowledge,
   **fifteen sibling analyzers already read it**, and no production caller populates it —
   the JavaScript lane's external-override fixture says so in its own header. So this is
   the size of the prize for wiring one shared parameter fifteen lanes are already written
   to accept, not a shortfall in Solidity support. The census resolves nothing and
   publishes no relationship: every row is a measurement of what such a pass *would*
   find, kept separate from the graph so a measurement can never be read as a fact the
   index holds. Its denominator is asserted equal to the sum of its routes, because the
   first version counted 35 rows it never gave a verdict and every percentage was
   therefore computed against a number the numerators did not cover.
4. **Two store-refused names.** `self` and `root` are real Solidity identifiers that
   `pool-worker.ts`'s shared `UNIVERSAL` denylist drops. The lane refuses the
   declaration so no edge dangles, and the **drift between the two lists is checked**
   by `script/m60/solidity-reserved-words.ts`, which re-reads pool-worker's own source
   and fails if they disagree. The fix belongs in `pool-worker.ts`, which this lane
   does not own.
5. **Two files sharing a basename in different directories produce the same module
   name.** Inherited from the bash and PowerShell rulings that the module is named
   after its basename.
6. **The recovery rule is untested by the corpus.** 0 damaged files over all 389, so
   no corpus run can exercise SOL-6. That is precisely why
   `validation/m14/fixtures/solidity/recovery-regions-sol6.sol` forces an `ERROR` on
   purpose — otherwise a green 0-damage corpus would leave the rule untested, which is
   how it stayed too narrow through a full surface measurement.
7. **A bare import contributes no relationship edge.** `import "./X.sol";` binds no
   name; its fact lives in the `imports` payload, and the only string available as an
   edge target is a path the F9 gate refuses. Pinned by a `forbidRelationships` row
   and by the `references` count of 4 in `all-kinds-sol`.
8. **`src/parser.c` is present in this working tree and is NOT part of what we ship.**
   The pin lists it under `notVendored` (correctly: `tree-sitter generate` rebuilds
   it), but a 2.5 MB copy exists on disk and `.gitignore:46`
   (`grammars/tree-sitter-*/src/*`) excludes it from every commit. The citation
   census resolves against the **working tree**, so it currently scores this lane
   `src/parser.c` as **present** — a false green that `git clean` or a fresh clone
   flips to missing, with nothing about the lane having changed. This is the §5.4
   defect class in its inverse: not a citation that fails to resolve, but one that
   resolves to a file which is not a deliverable. Verify with
   `git ls-files --error-unmatch grammars/tree-sitter-solidity/src/parser.c` (fails)
   against `git check-ignore -v` (matches). The file was left in place rather than
   deleted: it is gitignored and regenerable, and another agent may be mid-work on
   it. The census's own row for this lane is currently **7 citations, 0 missing, 0
   patches claimed**.
9. **One of the pin's evidence artifacts is another lane's.** The solidity entry in
   `script/m14/verify-grammar-pins.ts` cites
   `validation/m14/results/M14.0.F11.powershell.json` — F11 is the shared
   grammar-conformance gate and that file is its **PowerShell** instance. It exists,
   so the census passes, but it is not Solidity conformance evidence; a Solidity F11
   instance would be. Named rather than fixed, because the pin is a shared file and a
   working gate beats a clever one.
10. **The F5 floor is 2 missing / 21 unexplained, not 0/0.** The floor moved UP from
    18 because of limitation 11 — more truth is derived and more analyzer edges exist,
    so the residue is larger in absolute terms while `unclassifiable` stays **0**. The
    move and its reason are recorded in `validation/m14/differential-baseline.json`
    under `floorMoves["solidity:solidity"]`. Both directions are itemised into classes
    with reasons, and **0 rows are unclassifiable in either direction**. The 8 MISSING
    rows are one class — a `type(IFoo).interfaceId` mention of an interface declared in
    another file. The unexplained rows are `uses` naming a member of a built-in type.
    Both are SCOPE limits with a named class each.
11. **Two dead instruments that agreed were reading as a pass.** The `revert_statement`
    case had **never fired** — in the analyzer *and* in the F5 oracle — because both
    tested `node.namedChild(0).type === "identifier"` and the grammar puts an
    `expression` wrapper there for `revert Boom(1)`, `revert Solo` and `revert("x")`
    alike. 453 custom-error call edges over the corpus did not exist in this lane, and
    F5 agreed at zero because truth was dead in the same place. Repairing only the
    analyzer then produced 37 "unexplained" edges that no re-run could clear, because
    `sweepStateKey` hashed every analyzer in `src/ast` but **not** `script/m14/oracles`
    — so an oracle edit left the journal key byte-identical and the next run printed
    `RESUMED` with the previous truth function's numbers. All three are fixed; the
    oracles are part of the sweep state now, and the oracle repair cut
    calls-unexplained from 47 to 2 on the adjudication draw.

    A **second** dead branch of the same kind was found by instrumenting every case in
    the analyzer's switch with a hit counter and an emit counter and reporting any case
    whose node type occurs in the corpus but which emitted nothing: `using_alias`
    searched for DIRECT `identifier` children while the grammar nests the name as
    `using_alias (user_defined_type (identifier)) (user_definable_operator)`, so its
    loop body never ran and the corpus's 4 nodes produced 0 edges. The census reports 56
    such cases; all but this one are containers (`statement`, `block_statement`,
    literals) or emit in a post-pass, which is why it is the only finding and why the
    instrument is worth keeping rather than running once.
13. **Per-symbol complexity is reported for every symbol but is only MEANINGFUL for
    declarations.** All 5,976 carry a value; the 690 above 1 are functions, modifiers and
    constructors. A state variable or a struct field is 1 by construction, which is the
    correct answer and not a measurement — stated so the mean of 1.214 is not read as a
    claim about the whole symbol table.
12. **NatSpec reaches 46.5% of symbols, and that is not 100%.** 2,773 of 5,976 carry a
    `docstring`; 5,254 comments were read and 2,895 attached. The gap is real and not a
    defect — a comment before an expression, or a trailing remark, documents nothing.
    What is NOT covered is the file-leading SPDX comment, whose anchor is a
    `pragma_directive` and therefore not a declaration, so **no symbol carries a
    licence**. Named rather than half-done: licence detection is the feature, and
    `pool-worker`'s symbol whitelist has no licence field to carry it yet.

---

## Evidence

Every number, and the instrument that produced it. Each is re-runnable.

| Claim | Number | Instrument |
|---|---|---|
| Corpus | 420 `.sol`, 389 production, rev `32b5b8c4` | `script/m60/solidity-type-census.ts` |
| Draw | 389 files, digest `c1531019`, unbiased (hash of `repo/relative-path`) | same |
| Parse damage | **0** damaged, 0 ERROR, 0 MISSING, 0 damage classes | same |
| Type coverage | **112 of 124** declared named exercised; **12** never | same |
| Never-exercised reachability | **12/12** probes reached their type; **8/8** negative controls correct | same, `--verify-silence` on the spec |
| Symbols / relationships | **5,976** / **26,807** | `script/m60/solidity-surface-measure.ts` |
| **Line coverage** | **26,807 / 26,807 = 100.00%** | same |
| `unknownTargets` | **0** | same |
| `dupKeys` | **0** | same |
| `reservedTargets` | **0** | same, via the imported predicate |
| Relationship kinds | `contains` 5587 · `uses` 14128 · `calls` 4331 · `extends` 537 · `exports` 487 · `references` 1307 · `implements` 7 · `overrides` 422 · `instantiates` 1, plus 899 import-annotated `references` | same |
| Evidence tiers | structural 6619 · usage_contextual 18867 · import_based 899 · inferred 422 | same, read from the analyzer's own central emitter |
| Perf | 103.72 ms/file, 813 facts/ms, at `loadAvg1 27.42` / 8 cores — **`perfIsQualified: false`** | same |
| Reserved tokens | **262** derived from `grammar.json`, byte-equal to the shared module; **28/28** negative controls | `script/m60/solidity-reserved-words.ts` |
| Engine builtins needing a declared entry | **15 of 17**; the other 2 (`type`, `revert`) have dedicated node types | same |
| Store denylist mirror | 15 names, **0 drift** in either direction | same |
| Completeness | **126/126** classified exactly once, **0 gaps** | `script/m60/solidity-completeness-spec.ts --verify-silence` |
| Fixtures | **22**, all passing, every row read off measured output | `bun run script/m14/run-fixtures.ts --lang solidity` |
| Mutants | **24**, all caught | `BB_MUTANT_ONLY="solidity/" bun run script/m14/mutate-analyzer.ts` |
| Zero regex | 0 operations, 0 literals, 4/4 helpers; gate verified to fail 3 ways | `bun run script/m60/solidity-zero-regex.ts --selftest` |
| F5 differential | coverage **99.9%**, MISSING **2**, unexplained **21** (1.2%) | `bun run script/m14/differential.ts --lang solidity` |
| F5 adjudication | **0** unclassifiable in either direction | `script/m60/solidity-unexplained-adjudication.ts` |
| F5 floor / perf baseline | `missing 2 / unexplained 21 / ruling SOL-SCOPE`; 5.3 ms/file with its load recorded and flagged unqualified | `validation/m14/differential-baseline.json` |

### What the instruments are for, and what they are not

The surface measure is **not a truth oracle**. It measures what the analyzer emits
and how it changed; whether each edge is *correct* is F5's question, and everything
in the surface table can be green with every edge wrong.

Three instruments in this lane were themselves wrong, and each was caught by
cross-checking rather than by trusting:

- A first `unknownTargets` proxy resolved targets **per file** and reported 509
  unknowns, every one a legitimate cross-file base. Making it project-wide made it
  **worse** (1,116) until the real rule was stated: `contains` resolves per-file,
  because a containment edge cannot cross a file; `extends`/`implements`/
  `overrides`/`exports` resolve project-wide, because in Solidity they routinely do.
- A type-census run printed `NaN ERROR` because the destructured key names did not
  match the function's return. `NaN` serialises to `null`, so the artifact published
  `"errorNodes": null` while looking like a rendered number. Every accumulated counter
  is now `Number.isFinite`-checked.
- The differential's oracle was wrong six times before it was right, and each time the
  harness caught it: a bare callee read as a read (336 rows), an event emission read
  as a read (25 rows), an interface inheriting an interface not walked at all, a file
  scope closed by `source_file`, `new X()` reported twice, and a leftover `continue`
  that stopped the walk at the first declaration (209 rows). All six are recorded in
  the oracle's header with the number they produced.

### Three handoff claims this lane's measurements refuted

1. **"27 never-exercised named types"** is a property of a 60-file draw. Over the
   full 389-file production corpus it is **12**. Quoting the draw's number as the
   corpus's would have put 15 phantom work items in the lane.
2. **"the corpus under-represents Yul"** is **false**. See Supported constructs.
3. **"0 damage"** was measured on the 60-file draw; it also holds at full size.

And one number the handoff did not carry, which is the lane's most expensive lesson:
**RESERVED_TOKENS alone is not sufficient against a fabricated call.** `keccak256`
*is* one of the grammar's 262 tokens, and in call position the lexer still produces a
plain `identifier` — a token only appears where the grammar expects that literal, and
`NAME()` is not such a place. "It is a keyword, the token set covers it" reads as
obviously true and is wrong for **15 of 17** builtins. The first draft of
`solidity-reserved-words.ts` asserted the opposite split in its own header and the
instrument's negative control refuted it.