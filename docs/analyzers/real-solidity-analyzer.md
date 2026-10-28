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
| SOL-22 | A file's LICENCE | `// SPDX-License-Identifier: MIT` attaches to the **module** symbol as `license`, read from the file's **first comment run** only. | The licence reached nothing: its next named sibling is the `pragma_directive`, which is not a DECLARATION, so SOL-16's attachment rule had nothing to land on — and the module symbol is pushed before that pre-pass runs, so it was the one symbol that could never be documented. Zero of 5,976 symbols carried a licence on a corpus where 389 of 389 files state one; now 100%, MIT and BSD-3-Clause. A licence buried on line 400 is a remark that happens to contain the word, so only the first run is scanned, and a file whose first comment is an ordinary remark gets no key at all rather than a guess. |
| SOL-23 | NatSpec checked against the SIGNATURE | `undocumentedParameters`, `overDocumentedParameters` and `returnDocumentedWithoutReturn` per callable. Zero regex — the tag scan reads a leading `@` and the whitespace-delimited name after it. | SOL-16 reads the documentation; this asks whether it is TRUE, and both halves are in the same tree. An undocumented parameter is a coverage gap and usually benign (4,660 over the corpus). A `@param` naming a parameter that does not exist, and a `@return` on a void function, are real defects — and BOTH are **zero** across all 389 files. That zero is only meaningful because natspec-check-sol23 forces the branches: without it, "zero defects" and "the checker never ran" are indistinguishable, which is this repo's clean-looking-zero failure in its purest form. Reported as counts and samples, never as relationships — there is no second symbol to connect an edge to, and an edge to a parameter that may not exist would put a target in the graph no project declares. |
| SOL-21 | A PROJECT-WIDE INDEX, read when one is supplied | `AnalyzeContext.projectIndex` (`src/ast/project-index.ts`, optional and additive). With it: an inheritance kind declared elsewhere is SETTLED — 507 undecided → 0, of which **99 were genuinely mis-typed** — and a call to an ancestor's member becomes `crossFileInheritedMember` (456). `external` call targets fall **1,677 → 190**. | The ceiling was an unfilled parameter, not a language limit: fifteen sibling analyzers already read `AnalyzeContext` and nothing populated it. Two grades, NOT interchangeable — `crossFileInheritedMember` (the owner's ancestors declare the name, so the call SITE proves which type) versus `projectMemberCandidate` (some project type declares it, but a Solidity `calls` edge carries no receiver type for a free function, so WHICH is undecidable). Collapsing them would have turned 1,031 honest candidates into 1,031 confident facts. The index is built by reading the TREE, never by the analyzer it feeds, so it cannot inherit that analyzer's mistakes. **Production supplies it**: `parallel-indexer.ts` builds one per run for opted-in extensions and ships it to the workers; `fork()` serialises with JSON and cannot carry a `Map`, so it travels as an explicit wire format whose version is checked and whose loss is a no-enrichment outcome rather than a wrong answer. Every relationship carries `projectIndexSupplied`, so a per-file answer is always distinguishable from a settled one. |
| SOL-19 | An inheritance edge whose KIND was undecided says so | `extends B` where `B` is declared in **another file** is emitted at **0.9**, tier **`inferred`**, with `kindUnresolved: true`, `assumedKind`, `reasonCode: "base-not-declared-in-file"`. A base resolved in-file keeps 1.0/`structural`. | The inheritance is structural — the tree states it — but the row's KIND is part of what it asserts, and when the base is elsewhere the kind was decided by the ABSENCE of a declaration. It was published at **1.0/`structural`**: 507 corpus rows where a guess read as a fact, and a consumer filtering `extends` to find contracts inherited a mis-typed base. The edge is still emitted — omitting a TRUE edge to avoid annotating an uncertain KIND would trade a labelled fact for a silence. The tier is decided at the call site, not by a `confidence < 1` heuristic: that heuristic was tried and it relabelled `instantiates` (0.95, structural evidence) as inferred. A conservative score and an undecided claim are different facts. |
| SOL-20 | `qualified_calls` | The qualified call expressions a symbol **makes** (`token.transfer`, `super.supportsInterface`), accumulated on the frame that owns the code and deduplicated when it closes. `abi.` and `type.` receivers are excluded. | The TypeScript lane populates this and the lane left it unset, so a consumer could ask "which qualified calls does this symbol make" for every language but this one. `abi.`/`type.` are LANGUAGE NAMESPACES, not calls on an object — publishing them beside `Helpers.twice` would destroy the distinction a reader of this field most needs — while `super.f()` is kept, because `super.supportsInterface` says something the bare name cannot. Reuses the `namespaceBuiltin` split SOL-15 already draws. Measured: 601 symbols over 407 distinct names. |
| SOL-18 | Per-symbol `complexity` and `ownerKind` | Every function, modifier, constructor and fallback/receive carries a cyclomatic `complexity` attributed through the FRAME stack (1 + branch nodes inside that frame, nested declarations excluded); `ownerKind` is the kind of the enclosing type — `contract`, `interface` or **`library`** — read from the declaration table, and is ABSENT for a local whose owner is a function. | Before SOL-18 **every** Solidity symbol reported complexity 1: `pool-worker` defaults to `s.complexity || s.metadata?.complexity || 1` and the analyzer set neither, so the field was populated corpus-wide with a constant that reads as a measurement. It now reaches **25**, with 690 symbols above 1 and a mean of 1.214. The frame attribution costs one increment per branch node and no second traversal, which is the cost the TypeScript lane measured and removed. `else` is PART of `if_statement` in this grammar, so an if/else pair is ONE branch. |
| SOL-16 | NatSpec documentation | `///` and the slash-star block form attach to the **next** declaration and are published as `docstring` (first-class, persisted to `brain_symbol.docstring`), `comments` (per-comment array, the shape the TypeScript lane uses), `docstringKind` (`natspec-line` / `natspec-block` / `line`) and `docTags`. Markers stripped with `startsWith`/`slice`. A run of line-ADJACENT comments is one docstring; a blank line ends the run. | Solidity's documentation system, and the lane read none of it: 5,254 `comment` nodes, zero reaching a symbol. Attachment is measured, not assumed — a comment's `prevNamedSibling` is NULL, and only the LAST comment of a run has the declaration as its next sibling, so per-comment attachment keeps one line in three. A comment before an expression, or a trailing remark, documents nothing and is dropped. |
| SOL-17 | Applied modifiers are `decorators` | `function f() public onlyOwner nonReentrant` publishes `decorators: ["onlyOwner","nonReentrant"]` on the symbol; a DECLARED modifier with nothing applying it carries none. | Solidity's annotation mechanism is what the TypeScript lane calls a decorator, and this is the FAMILY CONTRACT: C#, Java and F# all treat decorators as metadata on the thing they decorate, and the `modifier_invocation` case already emits the one edge that carries meaning — a `calls` edge, because invoking a modifier IS calling it. Measured: 188 of 5,976 symbols, over 40 distinct names. **The INVOCATION half moved after this row was written:** a `modifier_invocation` that resolves to a declared modifier is published as `decorates`, a 1:1 relabel of the rows that used to be `calls` (`metadata.isModifierInvocation` kept), so the sentence above describes the state before that relabel and `decorates` is now IMPLEMENTED in this lane. |
| SOL-24 | `using L for T` is **NOT** `mixes_in` — tried, shipped, withdrawn | A `using_directive` whose composed set is ONE library and whose host is a declared type was published as `mixes_in` (source = host `T`, target = library `L`, 1.0/`structural`, carrying `isUsingDirective`, `usingForm: "library"`, `isMemberSetComposition`, `hostDeclaredInFile`), and the emission was **REMOVED the same day**. The braced function-set form, the `for *` form and a primitive or undeclared host stay counted, not dropped. | **THE VOCABULARY'S CONTRACT IS THE REASON, AND IT FAILED HERE.** `mixes_in` is "a class COMPOSES a mixin into its SUPERTYPE CHAIN … the mixin is a supertype MEMBER" (`src/ast/types.ts`), and every other user of the value satisfies that: PHP trait `use` flattens the trait's methods into the class's table where subclasses inherit them, Go embedding PROMOTES the embedded type's methods and fields into the outer struct's method set, ruby `include` and zig `usingnamespace` likewise. **Solidity adds no member:** after `using MathLib for Price`, `Price` is still `uint128`, has no `double`, and its ABI and inheritance chain are untouched — `p.double()` binds as `MathLib.double(p)` only where a directive is in scope, and `global` widens the SCOPE, not the type. So the composing actor is the SCOPE, not the type, and the refused row had the wrong source as well as the wrong relation. The cost was concrete: `graph-engine.ts` ranks `mixes_in` as supertype composition between `implements` and `renders` and `complexity.ts` carries it in the coupling set, so `Price -> MathLib` read as a supertype Price does not have. **MEASURED, whole 421-file population:** 124 `using_directive` sites in 76 files = 27 with a declared host and one library (23 struct, 3 interface, 1 struct+type) + 54 no-host (`for *`) + 39 primitive host + 4 braced function set, and **0 of the 27 adds a member to the host** — the census's own split is 120 − 54 − 39 = 27, and the analyzer's per-file buckets reproduce it (0 rows + 54 + 66 + 4 without the project index, the 66 being 39 primitives plus the 27 project-declared hosts). **NO DEPENDENCY WAS LOST:** the `type_alias` case already publishes a `references` edge to the library for every one of these directives (all 27 resolve), and `validation/m14/fixtures/solidity/using-directive-is-not-a-mix-in.sol` forbids `mixes_in` on all five forms including the two declared-host ones while firing that `references` row as the positive half. |
| SOL-25 | MEMBER RESOLUTION — the receiver's declared type, the enclosing type's own ancestry, and the call's own static object each name the DECLARER | Three mechanisms, each publishing `<DeclaringType>.<member>` — the spelling the project's own `qualifiedName` index carries — and each recording its evidence on the row: `calleeKind: receiverTypedMember` with `receiverType` for `t.shared()` where `t` is declared with ONE type whose inheritance closure names ONE declarer; `calleeKind: inheritedMemberQualified` with `ownerType` for a BARE inherited call (`inherited()`), where the enclosing type's closure names the declarer. Guards, each a measured requirement: the member name must be declared by MORE THAN ONE project type (otherwise the bare spelling already names one declaration, and a qualified spelling can collide where the bare one did not); the closure must name exactly ONE declarer (two bases declaring the member is a Solidity conflict, not a resolution); the receiver's name must be declared with exactly ONE type in the file; and the declarer must not be the enclosing type itself (its own override is a `localFunction`). | **THE LANE HAD TWO RELATED DEFECTS, AND BOTH WERE MEASURED, NOT ARGUED.** (1) `buildResolutionTables`' `memberOwners` maps a member to the types that EXPOSE it, not the ones that DECLARE it — `IERC20.transfer` puts every inheriting contract in the set — so the first version of this pass required `owners.size === 1`, which no inherited member can satisfy, and it rewrote 4 rows in the whole repository. The shared builder now also returns `memberDeclarer` (the one declarer in a type's closure, `null` on a conflict) and `memberDeclarers` (how many types declare the name), and the pass reads those. (2) The `calleeKind` chain tested "does SOME OTHER in-file type declare this name" for BARE callees too, so `inherited()` in a contract whose base is in another file was labelled `inFileTypeMember` the moment a sibling type declared the same name — stating something false and hiding the row from the cross-file branch; the loop now runs only when there IS a receiver (`x.twice()`, `Helpers.twice()`), which is what the SOL-15 fixture pins. **A THIRD MECHANISM, AND THE SAME EVIDENCE SHAPE — the STATIC LIBRARY CALL (W14).** `Math.min(…)`, `SafeCast.toUint(…)` and `EnumerableSet.add(…)` published a bare member name, so the gate had to choose among every declaration of `min` / `toUint` / `add` — while the SOURCE already spells the library. The object's name must have exactly ONE project DECLARATION (`symbolCounts`) and must not be a VALUE declared in the file; both guards were needed, and each proved its necessity by a mutant: with the value guard removed, `Lib2.T internal Lib; Lib.shared()` was published as `Lib.shared` — naming a library the call does not use — and the fixture went red on the forbidden row. **AND THE PASSES WERE READING A STALE LOCAL.** `target` was a `const` captured from the edge, so after the static pass wrote `Lib.shared` the receiver pass still tested the bare `shared`, decided it applied, and OVERWROTE the better-evidenced answer with `Lib2.shared`. Four passes mutate `rel.target`; the local is now updated at every mutation, which is what made the value-guard mutant fire at all. The corpus did not expose this — the fixture did. **MEASURED, whole 421-file population, A/B by analyzer digest with the same corpus and instrument:** resolved **22,123 → 22,688 (+565)**, amb(decl) **1,757 → 1,192 (−565)**, unresolved **1,348 unchanged**, extOK 948 and bindOK 8,923 unchanged, TOTAL 35,099 unchanged; row-level reconciliation on the gate's own `(label, target, file:line)` key: **565 rows DISAPPEARED from the non-resolved dump (ambiguous → resolved), 0 APPEARED** — no row regressed. `validation/m14/fixtures/solidity/sol25/` pins four rewrites AND four negatives (a name ONE type declares; an own override; a receiver name declared with two types; a value shadowing a library), and each pass was disabled in turn and went red on its own row. **A SAMPLED dump is now REFUSED by the classifier** (`script/m14/solidity-dump-classify.ts`): its marker join used to re-analyse without the project index, which reads an inherited member call as `calleeKind: external`, and 826 ambiguous `calls` rows were charged to W3 on the strength of a configuration no arm ran. With the index the class table is **W3 1,070 · W7 704 · W14 251 · W6 146 · W1 134 · W13 87 · W10 72 · W8 38 · W3-modifier 17 · W4 16 · W5 4 · W11 1** — W14 is now its own class (`projectMemberCandidate`: library members reached through an INDEX receiver, `_roleMembers[role].pos`, whose `calleeObject` is empty because the object is not an identifier) and W13 (`crossFileInheritedMember` left alone: the name is declared by ONE type but the BARE spelling still collides with non-member symbols, e.g. a state variable of that name — the index carries no count for those names (`symbolCounts` is type names only, 509 of them, and `symbolNames` is a set), so the falsifier is stated: **an index that carried a count for every published name would let W13 resolve its 87**. The next addressable class is W14's index-receiver half — it needs the receiver's VALUE TYPE from the container's declaration (a mapping's value type head names the library), which is a typing pass this row does not claim. |
| SOL-15 | Every `calls` edge carries a `calleeKind` | `localFunction` (declared on the enclosing type) · `inheritedMember` (reached through an in-file base) · `inFileTypeMember` (a member of another in-file type, via a receiver or `using X for T`) · `modifierInvocation` · `eventEmission` · `errorRevert` (a custom error) · `namespaceBuiltin` (`abi.` / `type.` / `super.` / `this.`) · `external` (declared in another file). Derived from the grammar and this file's declarations; **no hand-written list of builtin member names**. | A call edge used to be emitted from the callee NAME alone, so the census reported one undifferentiated "1,786 unresolved" class mixing a conversion, a language namespace, a custom error and a genuinely cross-file member. There is deliberately no builtin-name list: the first measurement had one containing `at`, `contains` and `length`, which are user-defined `EnumerableSet` methods — it would have silently reclassified live project edges. A conversion (`uint256(x)`) emits **no** edge at all, because `calleeNameOf` has no `primitive_type` case and a conversion is not a call. |
| SOL-14 | Store-refused names | Not declared. | `pool-worker.ts`'s `UNIVERSAL` denylist says such names are "never legitimate declarations in any language". For Solidity that is false: `self` (CrosschainLinked.sol:59) and `root` (MerkleTreeMock.sol:15) are both real. Measured as 2 unknown `contains` targets before the rule existed. |
| F9 | Edge targets | An edge target must be a name a stored symbol could have. | A target carrying `/` names nothing, and would sit at **zero** `unknownTargets` for as long as it existed — the metric asks whether a target *matches* a symbol, and a name matching nothing is no more detectable than one matching something. |

---

## ALL-OUT-OF-ALL phase 2 — D1 applicable set (grammar-derived, red-proven)

The D1 clause (`validation/m14/verification/ALL-OUT-OF-ALL-PROGRAMME.md` §9.1) asks for every
relationship type the language can express. The instrument is `script/m14/solidity-applicable-set.ts`;
the machine-readable table is `script/m14/spec/solidity-spec-table.json` (generated by
`script/m14/solidity-spec-table.ts`). Re-runnable:

```bash
bun run script/m14/solidity-applicable-set.ts --out validation/m14/fixtures/solidity/measurements/applicable-set.json
```

**Grammar, enumerated and reconciled:** the pinned wasm exposes **531 slots = 121 named types + 407
anonymous tokens** through the Language API. The other two counts a reader will meet are stated so they
are not confused with it: `grammar.js` declares **166 rules (121 visible + 45 hidden)**, and
`node-types.json` lists **124 "named" entries** because it also marks the literal spellings `true` /
`false` / `string`. sha256 `07420813…`.

**APPLICABLE 10/10 AT THE D1 GATE**, each with an emission site and ≥1 positive fixture row, and
**RED-PROVEN** by the real runner with that value's edges removed: calls 9 red fixtures · uses 9 ·
contains 11 · imports 1 · references 7 · exports 7 · extends 4 · implements 4 · overrides 3 ·
instantiates 1 (baseline 32 pass / 0 fail) — with **four** types ruled not applicable at that gate:
decorates (the modifier adjudication, SOL-R3), renders, mixes_in, part_of.

**THAT IS NOT THE CURRENT APPLICABLE SET, AND TWO OF THE FOUR RULINGS CHANGED.** As of
2026-10-27 the lane is **11 implemented / 11 applicable / 3 excluded**
(`bun run script/m14/coverage-block-gate.ts --json`): `decorates` was implemented as the 1:1
modifier-invocation relabel; `mixes_in` was implemented from `using_directive` (SOL-24), published 27 rows,
and was **WITHDRAWN the same day** when the vocabulary's own contract failed on it. **`renders`, `part_of`
and `mixes_in` are all RULED now**, each carrying a count and a falsifier in
`script/m14/spec/solidity-completeness.json` — `renders` and `part_of` as **grammar-remedy-ruled** (the
ladder was walked: R1, the latest published build is npm 1.2.13 and its 124 named types contain no such
node; R2, a clone+patch could add a node but would have to invent the component model/part-file semantics
the language does not have; R3, no existing node type carries the relation), `mixes_in` as
ontological (an emission tried and refused, so the claim is measured rather than argued): the served grammar's 124 named types contain 0
template/component/element/render/markup nodes and the vocabulary has 0 component `SymbolKind`s among
its 32, so there is no node a rendering edge could be read from (a contract is DEPLOYED, not rendered);
and `part_of` in this vocabulary is a PART-FILE directive — a compilation unit that SHARES another
library's single scope — where a Solidity file dependency is an `import` naming a MODULE, already
emitted per path as `imports` (932 edges). Declaration nesting — a struct inside a contract — is
`contains`, and 0 of the grammar's 124 named types names a part construct.

**The scope is stated because the numbers move with it.** Both arm artifacts were taken over the
same 421 files (per-file on 2026-10-27; the whole-population arm re-run 2026-10-28): `--index` (production's scope, SOL-21) reads calls 6,590 · decorates 144 · extends 488 ·
implements 107, and the per-file run reads calls 6,703 · decorates 31 · extends 588 ·
implements 7 — 113 cross-file modifier applications and 100 base-list entries change
label, and **no other type moves by one row**. (Both arms carried `mixes_in` 27 on the day it waspublished; that type is withdrawn — SOL-24.) `validation/m14/measurements/solidity-gate-whole-2026-10-28.json`
and `validation/m14/measurements/solidity-gate-perfile-2026-10-27.json` carry both, and the same A→B delta is what D3 below already recorded for the heritage kinds. The 2026-10-28 whole-population run reads **contains 6,531 · references 1,452 · exports 526 · TOTAL 35,099** — the 61-row contains/references pair returned to its 2026-10-14 value by measurement, and exports fell 8 with the SOL-12 nested-UDVT fix. **The internal-import file claim then moved 798 of the 932 `imports` edges to project-verified `extOK` (0 refuted), leaving 134 the project does not carry; the `languageNamespace` claim moved another 150 `abi.*` calls to `extOK` (0 refuted) and the W2 class falls to 1 ambiguous** — clause 1 is 1,436 ambiguous + 1,348 unresolved, plus 948 verified claims — the 1,757 → 1,436 movement is SOL-25's member resolution, measured as 321 ambiguous rows becoming resolved with 0 rows appearing in the non-resolved dump.

**The value rulings, each settled by a measurement (full text in the spec table's `rulings`):**

- **SOL-R1 `implements` — APPLICABLE BY ADAPTED SEMANTICS.** No implements-clause production exists; the
  grammar's ONE heritage construct (`inheritance_specifier`) carries both readings, and an ancestor bound
  to an in-file `interface_declaration` is `implements` (SOL-5, site `:1726`).
- **SOL-R2 `exports` — APPLICABLE BY ADAPTED SEMANTICS.** No export construct exists; the value is the
  compilation-unit surface (SOL-12, site `:2703`).
- **SOL-R3 `decorates` — construct adjudicated, and the ruling CHANGED after it was written.** Modifiers
  are still published as `decorators` METADATA (SOL-17), but a `modifier_invocation` that RESOLVES to a
  declared modifier is now published as a `decorates` edge — a 1:1 relabel of the rows that were `calls`
  with `calleeKind: modifierInvocation`, the label move being forced by the impostor that looks identical
  in the tree: a base-constructor call `constructor() Base(1)` is the SAME node type, and only resolution
  separates them (a base-constructor target that resolves to a contract/interface/library stays `calls`).
  So there is no "no `decorates` edge" claim left to make: the type is implemented, 144 rows at index
  scope and 31 per file.
- **SOL-R4 `overrides`** — the `override_specifier`'s three tiers (SOL-11); the REFUSALS are the rule.
- **SOL-R5 `uses`** — positional read (SOL-2); measured 2026-10-19: assignment LHS is a uses
  (write-as-use), `return bal;` is a uses, parameter reads are uses by position (the binding wall).
- **SOL-R6 `imports`** — `import_directive` only (module path); imported bindings and using-directories
  are `references`. A using-directory publishes **no** composition edge (SOL-24): the `references` row says
  the file READ the library's name, which is the whole of what `using L for T` does to the file, and the
  host type acquires nothing — a member-set composition whose members do not enter the composing type is
  not this vocabulary's `mixes_in`.
- **SOL-R7 `instantiates`** — `new_expression` only; struct construction is `calls` (SOL-10).
- **SOL-R8 the synthesised getter** is a relationship (contains + references, SOL-3), not metadata.

The full construct table (14 rows: contracts/interfaces/libraries · inheritance · functions/constructor/
receive/fallback · state vars+getters · modifiers · events/errors/emit/revert/try-catch · structs/enums ·
imports · using-for · `new` · override · Yul/assembly · type aliases · NatSpec/pragma) is in the spec
table. Evidence page: `validation/m14/verification/SOLIDITY-D1.md`.

## ALL-OUT-OF-ALL phase 2 — D2/D3/D4/D5 (whole population, both arms, the audit)

**D2 — what the analyzer EMITS, whole population.** `script/m14/solidity-emission-census.ts` (lane-owned)
over **421/421 admitted `.sol` files · 2 repos · 0 parse failures · 0 degraded** → **TOTAL 35,107 rows**:
uses 17,880 · calls 6,734 · contains 6,531 · references 1,452 · imports 932 · extends 588 · exports 534 ·
overrides 423 · instantiates 26 · implements 7. Payloads: calls by `calleeKind` (external 3,707 ·
localFunction 1,980 · errorRevert 455 · namespaceBuiltin 362 · eventEmission 170 · modifierInvocation 31 ·
inFileTypeMember 22 · inheritedMember 7 — the SOL-15 taxonomy); overrides **all 423 `inferred`, 0
`verified`** at whole population (measured finding); uses variableReference 12,454 · yulPathSegment 2,420 ·
memberReference 1,967; imports path 931 + namespace 1; contains includes 61 synthesised getters (SOL-3).
Construct populations make the rulings numeric (Yul: 2,843 yul_function_calls each carrying an
yul_evm_builtin child, 487 assembly statements, **0 yul_function_definition sites** — a measured negative;
modifier_definition 23/invocation 222; pragma 421 / comment 5,787 ruled no-relationship). Evidence page:
`SOLIDITY-D2.md`. **THESE ROWS ARE THE CENSUS'S OWN AND TWO RELABELS CAME AFTER IT, so they are not the
current per-type counts:** 31 in-file modifier applications became `decorates` (calls 6,734 → 6,703 per
file), and at index scope 113 more cross-file applications and 100 base-list entries move as well (calls
6,590 · decorates 144 · extends 488 · implements 107) — see the D1 correction above and
`validation/m14/measurements/solidity-gate-whole-2026-10-28.json`.

**D3 — resolution, BOTH whole-population arms.** Arm A (`incoming-gate solidity sol 0 --dump`,
`BB_DUMP_LIMIT=1000000`): **421/421 parsed · 2 repos · self-test PASS** · **TOTAL 35,107 = resolved 17,186 +
amb(decl) 13,380 + unresolved 4,541** (+collRes 3,491, amb(kind) 5,327) · claims/bindings/causes all 0 ·
dump rows 17,921 = TOTAL − resolved exactly · **arbitraryTwin 12,234** with exact intent closure. The D2
census TOTAL equals the arm TOTAL exactly (cross-instrument). D3 classification by
`script/m14/solidity-dump-classify.ts` (dump rows joined to the analyzer's own metadata markers per row;
381 files re-analysed, JOIN 17,921/17,921 misses 0) → control PASS, closure exact, **11 named walls**:
W8-function-scope-binding-read 9,805 (54.7% — parameter/return/Yul-local reads; see the claim-opportunity
note in `SOLIDITY-D4-AUDIT.md` §4) · W6-yul-path-segment 2,275 · W3-cross-file/unvendored 2,039 ·
W7-member-or-builtin 1,465 · W5-in-file-name-not-a-declaration 935 · W1-module-path 932 ·
W2-language-namespace 344 · W10-type-mention 72 · W4-declared-kind 47 · W12-export-surface 6 ·
W11-override-base 1. Clause 1 fails ONLY on these named classes; clause 4 clean by measurement.
**Arm B (`--index`) is the SOL-21 effect measured, not an artifact:** the gate builds **2 repo indexes (2
built, 0 damaged)**, and the A→B delta is exactly **extends 588→488 (−100 edges/resolved) and implements
7→107 (+100/+100)** with **every other per-type column 0**, TOTAL/resolved/ambiguous/unresolved unchanged,
arbitraryTwin unchanged (12,234), classifier classes identical — the project index settles heritage KINDS
and trades ZERO resolutions. Evidence page: `SOLIDITY-D3.md`.

**D4 — the audit, MEASURED on the wired digest (Lead `174f35fda` + lane `86e39a889`).** All ten emitted
labels derived AND admitted; `imports` was the last (m60: emitted 10 / audited 9). The lane found that
`normTarget` collapses every module path to its extension segment (`./A.sol` → `sol`), which would have
made the imports audit vacuous; the Lead fixed the matcher globally for path-like imports. Post-wiring
draws: `--repo solidity --sample 60` → truth 2,567 · covered 2,565 (**99.9%**) · MISSING 2 · analyzer 1,875
· unexplained 21 (1.1%) · heuristic 0 · hash e9708e75; stride draw → truth 3,799 · covered 3,792 (**99.8%**)
· MISSING 7 · analyzer 2,414 · unexplained 33 (1.4%) · heuristic 0 · hash 8de36144 — **`imports`
contributes ZERO unexplained in both**, a label that can now fail and does not. Residual classified by
`script/m14/solidity-d4-audit.ts` (control fails on any unclassified row): own 60-file draw → MISSING 6 /
unexplained 101 in four named classes with deciding side (`truth-gap/uses-yul` 79 ·
`truth-gap/uses-variable` 21 · `truth-over-derivation/uses-inheritance-specifier` 6 ·
`truth-gap/calls-errorRevert` 1). Oracle contract: `solidity-oracle-verify.ts` 4/4 cases + self-test PASS.
Evidence page: `SOLIDITY-D4-AUDIT.md` (and the inventory/matcher narrative in `SOLIDITY-D4-ORACLE.md`).

**D5 — permissions.** Fixtures **32 pass / 0 fail** (exit 0, "no regressions"; no pre-existing pin, no
allowance consumed) · inventory **126 types / lane-pass 8/8** (caveat quoted) · **no-regex**: lane-owned
AST census CLEAN (0 regex literals, 0 constructors, 0 regex args; 6 allowed string arguments) and the lane
is **absent from the fresh shared census** (0 solidity rows); the older M60 gate PASSes but its own
`--selftest` reports `MUTANT 3` not caught — **a defect in that gate (outside this lane's write scope),
reported to the Lead**, which is why the lane's D5 evidence uses its own AST census · **perf row** measured
on the M60 baseline's exact population/surface (389 production files × 2 trials, `parseFile`): min **11.494
ms/file** · median 21.544 · analyzer share 83.1% · 1.653 ms/KiB · ratio **0.19×** against the recorded
baseline 59.738 ms/file (which was itself load-29-contended and unqualified) — **UNSCORED** per the `#871`
no-re-pin ruling · **tsc**: 0 errors naming any solidity script / the analyzer (both configs; evidence
file). Spec table current (`solidity-spec-table.ts --check` passes).

**Named residuals and their owners** are listed in `SOLIDITY-DONE.md` §NAMED RESIDUALS; the single
candidate improvement is **`SOL-W8-BINDING-CLAIM`** (parameters + named returns as fleet binding claims —
priced by the lane's reverted 400-file experiment: unresolved −52.3%, amb −3,944, bindOK 6,504,
arbitraryTwin FELL 3,703, collRes unchanged; four fixtures pin the bare spelling and are reconcilable
under the task-9 ruling).

## DEPTH CAMPAIGN (D7, task-20) — the function-scope binding CLAIM

**`SOL-W8-BINDING-CLAIM`, charter §18 task-20, contract `SOLIDITY-LOCAL-BINDING-CONTRACT.md`.** A read of a
function-scope binding — a parameter or a named return, and a Solidity binding read inside `assembly` — is
now published with the FLEET claim spelling instead of the bare name:

```
target   = `<declaring callable>` + BINDING_SEP (`"\u0000"`) + `<binding name>`
metadata = { localBinding: true }
```

The claim says "this name is a binding, not a declaration"; the gate verifies the spelling and counts the row
in its own **`bindOK`** column — never in `resolved`. Three emission sites, each gated on the analyzer's own
frame stack: positional `identifier` reads (0.75), one-segment `yul_path` reads inside assembly whose name is
a binding of the enclosing Solidity callable (0.7), and a BARE `call_expression` callee that is a
function-type parameter (`calls`, 0.9, `calleeKind: "localBinding"`). **Never claimed:** `variable_declaration`
locals (this lane publishes them as symbols — they resolve, and claiming them would remove a correct
resolution), Yul `let` locals (published), state variables (published), imported bindings (`references`, not
`uses`), `this`/`super`/`msg`/`block`/`tx`, and reserved spellings. A claim RE-SPELLS a row: `dedupeAs` keeps
the old bare key in `relKeys` so the D2 edge total cannot move, and the 204 reads whose bare name the SOL-7b
guard refuses are deliberately NOT rescued (a named opportunity, `SOL-RESERVED-NAME-CLAIMABLE`). The binding
list is gated on the NODE KIND, not the published symbol — a measured fix: gating on `sym !== null` silently
left the parameters of every overload after the first unclaimed (`AccessControl.sol`'s two `_checkRole`s).

**MEASURED, whole population (421 files / 2 repos; both arms):** edges **35,107 unchanged**;
resolved 17,186→**16,288** (−898, all decoy rows: a claimed target names no declaration, so a row leaving
`resolved` had bound to a same-named declaration — the JS-precedent explanation); amb(decl) 13,380→7,666;
unresolved 4,541→2,230; **`bindOK` 0→8,923**; bindFAIL/extFAIL/causeFAIL 0; closure exact
`35,107 = 16,288 + 7,666 + 2,230 + 8,923`. Intent axes: intended unchanged 7,065; **arbitraryTwin
12,234→6,785 (−5,449, FELL)**. Classifier (both arms, control PASS, 9,896/9,896 joined, misses 0):
**W8 9,805→3,254** and **W6 2,275→819** (6,551 + 1,456 claimed; +18 calls rows from W3; +898 decoy = 8,923).
The W8/W6 residuals are EXACTLY split and CORRECTED TWICE (`solidity-w8-residual-split.ts`, control PASS
over all 9,896 residual rows), by what the bare target is declared as in its own file and project-wide:
W8 family = **2,008 duplicate-in-file** (locals reusing a name across functions — the one scope-resolvable
class; a resolver consulting the row's source callable/container could choose) + **1,177
single-in-file-declared-elsewhere-too** (ordinary cross-file name collision) + 21 nowhere + 4 other-file;
W6 = 488 + 192 + 119 + 20 = 819; W7 = 478 + 264 + 662 + 61 = 1,465. `UNIQUE-DECLARATION-IN-PROJECT` = **0
rows, measured** — so there is no "resolver ignored an unambiguous declaration" class. Two drafts were
corrected by measurement and the corrections are recorded in the page: (1) tuple-destructured locals ARE
published (`newDefaultAdmin`×2/`schedule`×3 in one file — it is a name-keyed scope question, not a
declaration-coverage gap); (2) the "single-declaration-but-residual" bucket is cross-file collision, not a
resolver-scope defect. D2 census TOTAL identical 35,107 per type; only `calls.external`
3,707→3,689 (−18) and the new `calleeKind: localBinding` 18. Arm B preserves SOL-21 exactly
(extends 588→488, implements 7→107, everything else 0). D4 draws: truth unchanged (2,567/2,565/2 · imports 0
unexplained); the differential's per-file `label|target` dedupe view rises 1,759→2,081 and unexplained
21→23 because re-spelled rows become distinct pairs and the tree oracle refuses `self` reads (the D4
truth-debt class); the lane audit (full row sets, `auditTarget` rule) is unchanged MISSING 6 / unexplained 101.
**D7 metric: verified-class (resolved + bindOK)/edges = 48.9% → 71.8% (+22.9 pp).** Fixtures 32/0 with the
four pinned expectations reconciled in a separate `task-9` commit (six rows re-spelled, old bare spellings
forbidden, controls for locals/state vars/Yul `let`/Yul function params kept asserted bare); no-regex AST
census clean; tsc 0; inventory 126/8/8.

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
`10.41 ms/file, 8,299 facts/ms` over 389 files at `loadAvg1 4.68` on 8 cores, with
`perfIsQualified: true` — the box was quiet for this run, and the row says so rather than leaning on a
claim it cannot keep. THAT is the honest shape of a perf figure: the same unchanged analyzer measured
**28.42 ms/file at `loadAvg1 9.53`** an hour earlier on the same box, which is the contention the single
number always carried. A separate best-of-N run — **ms/file best-of-3**, median
98.545, worst 101.168, **spread x1.69** on an
UNCHANGED analyzer — is in `script/m60/solidity-perf.ts`, and the spread is the contention the single figure has
been carrying all along. Contention only ever adds time, so the fastest trial is an UPPER BOUND on the unloaded
figure, and it is still not a qualified one.

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
`script/m14/spec/solidity-completeness.json`: **102 handled, 17 internal_silent,
0 gaps, 7 design_decision.** The 17 silences are wrappers and payloads whose content
is read by their children, and each names which child — "it is a wrapper" is not a
reason until you say which wrapper. (Four node types moved from silent to handled
when the analyzer began naming them: `binary_expression` and `ternary_expression`
through the complexity/read passes, and `yul_if_statement` / `yul_switch_statement`
through the Yul branch walk. The bucket is DERIVED — `script/m60/solidity-completeness-spec.ts`
reads the analyzer's own `case` labels — so the counts move with the source, and this
sentence is checked against the artifact by `script/m60/solidity-doc-truth.ts`.)

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
3. **1,849 `calls` targets resolve to no local symbol** (553 distinct), and every one
   is now CLASSIFIED rather than pooled — `external` 1,625 (a member or free function
   declared in another file), `errorRevert` 148, `eventEmission` 59, `localBinding` 17.
   Two kinds are
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
14. **THE PROJECT INDEX IS BUILT FROM THE RUN'S FILE LIST, so an INCREMENTAL run is
    UNDER-ENRICHED.** `parallel-indexer.ts` builds one index per run, from `files` — which
    for an incremental run is a subset of the project. A full re-index therefore resolves
    more than an incremental one, and that is run-dependence.
    It is contained rather than hidden, by two properties. Every relationship carries
    `projectIndexSupplied`, so a per-file answer is distinguishable from a settled one in
    the store, and a row with `kindUnresolved: true` is not in conflict with a settled one
    — the first says it does not know. And enrichment is MONOTONIC: a full re-index can
    only ADD resolution, never contradict a settled answer, because a settled answer is
    written only when the index knew. Resolving against the whole project on an
    incremental run needs a second discovery pass honouring `.bbignore` and `.git`
    boundaries; duplicating that logic is a worse risk than an under-enriched run, so the
    trade is made deliberately rather than overlooked.
    Every row the index settles carries `kindResolvedProjectWide: true` and which kind it
    read, so the provenance is on the row and not only in this document.
15. **`M60.solidity-perf` reports an UPPER BOUND, not a qualified figure.** Best of 3
    trials is 59.738 ms/file at `loadAvg1` [21.17, 22.58, 27.07], and `perfIsQualified` is **false**
    because no trial ran below the rule's `loadAvg1 < 8`. The box is shared: a
    14-minute poll during this change never saw it below 16, with other agents'
    processes at ~200% CPU. Contention only ever adds time, so the fastest trial is the
    closest available approach to the unloaded figure — and the ×1.69 spread across
    three runs of an UNCHANGED analyzer is exactly the noise the surface artifact's
    `perFileMs` has been carrying all along. Nothing here upgrades an unqualified figure
    by relabelling it.
16. **THE CASE AUDIT IS A PROOF, and it is pinned.** `script/m60/solidity-case-audit.ts`
    answers "can this switch case lose a row?" mechanically: a case whose body is only
    `break` cannot, by construction — 53 of 62 such cases are that — and
    the remaining 9 have a real body, are listed with a reason each, and the gate
    FAILS if that set grows or shrinks. Two dead branches were found this way
    (`revert_statement`, `using_alias`) and neither was visible to any count-based gate,
    because a branch that emits nothing changes no count. The first version of the
    expectation was hand-written from memory and the gate immediately rejected all three
    of its entries, which is the gate working.
17. **State-variable DATA LOCATION is read but the corpus cannot exercise it.** This
    grammar reports `transient` on the declaration's `location:` FIELD, not as a
    `layout_specifier` node — that node is the contract-level `layout at 0x100` clause,
    a different construct. Zero of 389 production files declare a data location, because
    no OpenZeppelin contract at this revision uses transient storage. So
    `state-location-transient.sol` is the only place that read is gated, and a zero in a
    census is not a broken path.
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
| Symbols / relationships | **5,976** / **27,625** | `script/m60/solidity-surface-measure.ts` |
| **Line coverage** | **27,625 / 27,625 = 100.00%** | same |
| `unknownTargets` | **0** | same |
| `dupKeys` | **0** | same |
| `reservedTargets` | **0** | same, via the imported predicate |
| Relationship kinds | `contains` 5587 · `uses` 14128 · `calls` 4300 · `extends` 537 · `exports` 479 · `references` 1307 · `imports` 826 · `implements` 7 · `overrides` 422 · `decorates` 31 · `instantiates` 1 | same. Three movements from the previous row, each accounted: `imports` is now published as its OWN kind (**+826**) instead of being described as import-annotated `references`; `decorates` was split out of `calls` (**31** modifier applications, `calls` 4331 → 4300); `exports` fell by **8** because a `type` declared inside a contract or library is a nested type, not a member of the compilation unit's export surface (the UDVT ruling, oracle-verified — see `solidity-type-census`). The net **+818** is 826 + 31 − 31 − 8, and it closes to the row above exactly. |
| Evidence tiers | structural 6104 · usage_contextual 18867 · import_based 1725 · inferred 929 | same, read from the analyzer's own central emitter. The 507 SOL-19 rows moved from `structural` to `inferred`, which is the point of that ruling. `import_based` is 899 import-annotated `references` **plus** the 826 rows now labelled `imports` (899 + 826 = 1,725) — one fact, two spellings, and the tier is the same for both. |
| Perf | 10.41 ms/file, 8,299 facts/ms, at `loadAvg1 4.68` / 8 cores — **`perfIsQualified: true`** | best-of-3 **59.738 ms/file** (median 98.545, worst 101.168, spread x1.69); `script/m60/solidity-perf.ts`. The unqualified 28.42 ms/file at `loadAvg1 9.53` is the figure the LANE budgets against: contention only ever adds time, so the unqualified number is the conservative one and the qualified one is not a budget. |
| Synthesised getters, both halves | **58** getters published, and **58 `contains` + 58 `references`** delivered through `parseFile` | `validation/m60/results/solidity-surface.json`. Measured, not assumed: the direct `analyze()` arm and the production arm were compared on one contract and disagreed by exactly these two rows. `filterNoiseRelationships` refuses a leaf carrying `(` because a call expression is the canonical SNIPPET — right about source text, wrong about `bal()`, which is a NAME this analyzer declares. The filter now answers that one shape test with the declaration itself (`declaredNames`), and the controls hold: an UNDECLARED `foo()` is still refused, `f(a, b)` and `f (a)` are still refused, and the 116 corpus rows came back on the same draw. The 58 `contains`/`references` in the kinds row above **are** this fix: before it, the analyzer emitted them and the store never received them. Controls: `script/m14/tmp/declared-signature-controls.mts` — a declared `balance()` kept, the SAME shape undeclared refused, `f(a, b)` / `f (a)` / `f(a)` refused; probe: `script/m14/tmp/sol-getter-probe.mts`, which runs `analyze()` and `parseFile` on one file and prints both counts. **F5 cannot see this class, and saying so is part of the row:** its production arm calls `ASTEngine.parseFile`, which does not pass through `filterNoiseRelationships` at all, so a deletion made by the shared filter is invisible to the differential BY CONSTRUCTION — which is why this fact is pinned in the surface artifact's `getterContainsDelivered` / `getterReferencesDelivered` instead. |
| Reserved tokens | **262** derived from `grammar.json`, byte-equal to the shared module; **28/28** negative controls | `script/m60/solidity-reserved-words.ts` |
| Engine builtins needing a declared entry | **15 of 17**; the other 2 (`type`, `revert`) have dedicated node types | same |
| Store denylist mirror | 15 names, **0 drift** in either direction | same |
| Completeness | **126/126** classified exactly once, **0 gaps** | `script/m60/solidity-completeness-spec.ts --verify-silence` |
| Fixtures | **36**, all passing (0 fail), every row read off measured output — including `using-directive-is-not-a-mix-in`, the control for the withdrawn `mixes_in` emission, and `sol25/`, which pins four member-resolution rewrites beside three negatives | `bun run script/m14/run-fixtures.ts --lang solidity` |
| Applicable set | **11 implemented / 11 applicable / 3 excluded** (renders, part_of — grammar-remedy-ruled after R1/R2/R3; mixes_in — ontological, emission tried and withdrawn) | `bun run script/m14/coverage-block-gate.ts --json` |
| `mixes_in` ruling | **0 rows.** The emission published **27** (all resolved, from 124 `using_directive` sites in 76 files; 54 no-host + 39 primitive host + 4 braced set skipped and counted) and was withdrawn the same day: 0 of the 27 adds a member to the host. The 27 `references` rows to the same libraries remain | `validation/m14/measurements/solidity-extended-census.json`; `script/m14/tmp/sol24-mixes-counters.mts`; `bun run script/m14/run-fixtures.ts --lang solidity` |
| Mutants | **49**, all caught (0 survivors; `modifiers-every-scope` was a no-op keyed on the pre-relabel `calls` shape and is now fixed to read `decorates` too) | `BB_MUTANT_ONLY="solidity/" bun run script/m14/mutate-analyzer.ts`; log `validation/m14/fixtures/solidity/measurements/mutants-solidity-2026-10-27.txt` |
| Zero regex | 0 operations, 0 literals, 4/4 helpers; gate verified to fail 3 ways | `bun run script/m60/solidity-zero-regex.ts --selftest` |
| F5 differential | coverage **99.9%**, MISSING **2**, unexplained **21** (1.2%) | `bun run script/m14/differential.ts --lang solidity` |
| F5 adjudication | **0** unclassifiable in either direction | `script/m60/solidity-unexplained-adjudication.ts` |
| Project index over REAL IPC | **7/7** — the index crosses a `fork()` boundary and settles BOTH kinds there: `ERC2981 is IERC2981` → `implements`, `ERC2981 is ERC165` → `extends` | `bun run script/m60/solidity-ipc-wiring-gate.ts` |
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
## Gate repairs, 2026-10-27

Four instruments in this lane were found measuring a stale subject while every lane gate was
green. They are repaired here, because a gate that passes for the wrong reason is the failure
mode this repo's own docs are loudest about.

- **`script/m60/solidity-completeness-spec.ts` no longer eats the `coverage` block.** The
  generator rebuilt the JSON from its four classification buckets and wrote it over the file;
  `coverage` — the hand-authored block the coverage gate reads, carrying every exclusion's
  evidence, count and falsifier — was not in the object it constructed, so the documented run
  deleted it (measured: 126 lines). It also reverted `using_directive` to "internal_silent"
  and restored the stale 20-fixture description. The generator now carries an existing
  `coverage` block verbatim and REFUSES to write if it would drop one. The classification
  counts are still derived: **126 types = 102 handled + 17 silent + 0 gaps + 7 decisions**,
  each exactly once.
- **`script/m60/solidity-doc-truth.ts` reads the lane's real counts.** It hardcoded
  `fixtures: 22` and `mutants: 24` — the values when it was written — and reported `NOT IN
  DOC` against a doc that says 34 and 49. The fixture count is now discovered recursively
  (two sources live in `sol21/`) and the mutant count is `SOLIDITY_MUTANTS.length`, so the
  instrument moves with its subject.
- **`script/m60/solidity-zero-regex.ts --selftest` is not stale.** Its MUTANT 3 injected
  `.replace(...)` by replacing a hardcoded analyzer line that a later change had rewrapped
  (`if (!opts.pathTarget && !isPlausibleSymbolName(target))`), so the mutant was byte-identical
  to the original and the gate reported 0 operations — reading as a failed gate rather than an
  aged test. The injection is now prepended and asserts that it changed the source.
- **The stale fixture allowance is gone.** `validation/m14/fixture-baseline.json` carried
  `solidity: 2`; the scoped suite measures 0 and the two free passes were retired, so the
  baseline now records `0`.

Verified after the repairs: fixtures **34/34**, mutants **49/49**, coverage gate
**11 implemented / 11 applicable / 3 excluded**, completeness **126/126 exactly once**,
doc truth **72/72 numbers agree**, zero-regex selftest **8/8**, cross-file gate **15/15**,
IPC-wiring gate **7/7**.
