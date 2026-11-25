# TypeScript Analyzer — lane notes (last revised 2026-11-18)

> **Status: the owner's six conditions are met in this file's terms** (implemented / whole-population /
> resolved-closure / walls-dispositioned / fixtures / no-regex), with the evidence pointers at the
> bottom. The lane's last working session was 2026-11-18; after it, changes are issue-driven only.

## What it extracts

- **Symbols**: classes, interfaces, enums, type aliases, functions, methods, constructors,
  properties, accessors (get/set pair = one property), abstract members
- **Relationships (14/14)**: calls, uses, contains, imports, references, exports, extends,
  implements, overrides, instantiates, decorates, renders, mixes_in, part_of
- **Payloads**: qualified_calls, JSDoc comments, complexity (per-symbol cyclomatic), decorators,
  visibility, genericParameters, isMappedType, isConditionalType

## Evidence tiers

Heritage (`extends`/`implements`) structural when confidence 1.0. `contains`, `exports`,
`decorates` structural by construction. `imports` import_based. `references` reference_qualified.
`calls` usage_contextual (0.9). **`overrides` structural** — fixed 2026-11-17: the arms abstain
unless the base resolves in-file, so the row is read off two declarations; the old
`usage_contextual` label applied a confidence axis to a structural fact (pinned by
`class-extends-overrides`). `instantiates`, `renders`, `mixes_in` per their literal confidences.

## The owner/source channel

- `metadata.owner` + `metadata.ownerEvidence` are emitted on member CALLS and, since 2026-11-17,
  on member READS (`uses`); one per-file receiver-facts collection feeds both walks.
- A member row whose receiver is a local whose type the file does not state carries
  `typescriptUnresolvedReceiver`, so the store WITHDRAWS the name binding instead of guessing.
- Non-identifier module sources are gone: module-level rows carry `(file)` +
  `metadata.fileLevel: true` + `metadata.scopeName` (2026-11-17). Measured on element-plus/400:
  400 → 0 NOT-AN-IDENTIFIER endpoints; 0 empty endpoints.
- Claim order (2026-11-17, measured): binding claims run FIRST, project-index claims LAST. Before
  the fix the index pass displaced 10,019 rows of which 10,015 would verify as binding claims
  (`bindOK` was a function of index availability). Now `bindingVerified` is identical in both arms
  and the residual is 238 rows (0.26%) recorded in the probe log.

## Type-reference semantics

- Every `type_annotation` emits references to its named types (primitives/builtin wrappers
  excluded); generics expand; nullable/union/readonly descend
- Return annotations on functions/methods are labelled `return_type`
- `x as T` → cast_target; `y instanceof T` → instanceof_check; `satisfies` → satisfies_target
- A plain identifier read of a declared binding is `references`; a member read is `uses` — the
  one-label ruling, narrowed per position on 2026-10-17 (the boundary the differential residue is
  measured against: 88.1% of the residue, adjudicated in
  `validation/m14/verification/TYPESCRIPT-M12-ADJUDICATION.md`)

## Known limitations

- **Receiver channel wall** (the D7 wall): of 19,811 member calls on a 1,500-file stride, 1,939
  carry an owner (9.8%); the 17,872 unowned rows partition into W0 no-nameable-root 6,762 (37.8%),
  W1 file-binds-the-name 7,183 (40.2%), W2 project-declares-name 2 (0.0%), W3 declares-nowhere
  3,925 (22.0%), with 2 further classes (type-alias receiver 19, chain-off-typed-root 206,
  imported-class 301, generic-over-type-parameter 202, and 27 rows the probe flags as
  "file states the type" — sampled 3/3 and diagnosed as the probe keying on the chain's ROOT while
  the call sits on a call RESULT; instrument over-attribution). Full ledger with falsifiers:
  `validation/m14/verification/TYPESCRIPT-D7-WALLS-PROD.md`.
- **`class` node / class expressions**: `const A = class Inner { m() {} }` — the variable path still
  suppresses descent; fixtures pin the named-class-expression declaration lane
  (`named-class-expression-is-declaration`) and `mixin-application`; the members shape is covered by
  the receiver gates.
- **`linesOfCode`** counts all lines to match the javascript twin; both over-count a trailing
  newline by one (family-level, left alone).
- **No-regex invariant**: 0 at HEAD, restored 2026-11-17 after Release 0.1.4 reintroduced four
  literals. The file has been regex-free and then regressed FOUR times; the count is an instrument,
  not a claim, and the fleet census + `ts-no-regex-count` are both in the verification chain.
- **Canonical M12 artifact stays red** until the master 50-language sweep regenerates it against
  the current contract; the lane's complete adjudication is committed (all 65 FP / 6 FN classified,
  zero unexplained).

## Verification (at 2026-11-18)

- Fixtures: **123 pass / 0 fail**; TSX probe covers 3 fixtures with controls fired
  (`tsx-renders` 12/12, `decorator-emission` 7/7, `renders-imported-binding` 3/3)
- 16 `verify-typescript-*.mts` compiler-backed gates pass (`tsc` 5.9.3); 14 mutants registered
- Whole-population: corpus manifest `validation/m14/instruments/typescript/corpus-manifest.json`
  (default root **17,350 admitted files / 41 repos**, population digest `4bd7bba5441c5344`; the
  `.corpus` FARM is gone and the two roots are different populations, which the gate prints);
  arm log + regenerated declaration under `validation/m14/measurements/` and
  `validation/m14/instruments/typescript/`
- Firing: master firing check now FIRED for TYPESCRIPT (10 types on vue-core/120), fleet log
  regenerated at `validation/m14/results/firing-laptop-b.current.log`
- Production delivery: element-plus, analyzer → production filter differential: calls 613 lost
  → 121 (test-lifecycle hooks, the filter's intended class), imports 101 → 0, uses 3 → 0
- Grammar: `script/m14/ts-partof-grammar-proof.ts` 8/8 GREEN (stock 8515404d vs served b75fa34c,
  pin table + patched-copy identity checked); construct census finds reference directives in the
  population and **0 call-shaped heritage (mixin) sites**
- Self-corpus: this repository is an authorised corpus (`ts-self-corpus-probe.ts`), 6,816 tracked
  `.ts`-family files at the manifest's recorded HEAD

## C9 — the constructor receiver, and the three instruments that could not see it (2026-11-25)

**The defect, reported from outside the lane.** A three-file project:

```
used.ts:   export class Worker { run() {} }
other.ts:  export class Other  { run() {} }
main.ts:   import { Worker } from "./used"
           export function f() { return new Worker().run() }
```

bb bound `f -> run` to **`other.ts`** — a class `main.ts` never imports. The row carried
`calleeExpression: "new Worker().run"`, so the analyzer had the right class in hand and
simply never told the store.

**The cause.** `receiverOwnerType` had branches for `identifier`, `subscript_expression`
and `member_expression`, and **none for `new_expression`**. The grammar puts the class in
the `new_expression`'s own `constructor` field — the type is _stated_, not inferred — so the
row arrived with no `metadata.owner`, and `src/ast/member-owner-resolution.ts` (the channel
that withdraws a name binding and re-resolves inside the owner) had nothing to walk. The
store fell back to the name model, which chose between two `run` members by tie-break.

**Why nothing caught it — three independent reasons, and each one alone was sufficient:**

1. **The wall probe shelved the shape by construction.** `ts-receiver-wall-probe.ts` files a
   receiver ending in `)` into W0, "a call result or a literal receiver — outside the
   partition". `new Worker().run` ends in `)` exactly like `foo().run`, so the one instrument
   built to find unowned member calls classified this class as _not its question_. The `new `
   prefix is now excluded from that test, so a constructor receiver enters the partition.
2. **The fixtures pin names, never declarations.** 126 `calls` pins across the lane, and
   **0** with a file-qualified target. A fixture says `calls f -> run`; it cannot say _which_
   `run`. Every existing fixture would pass whether the binding were right or wrong.
3. **The differential compares names too.** Its match key is `(label, from, target)` and its
   TS oracle derives `from: "(expr)"`. Measured on the repro: truth says
   `calls (expr) -> run`, the analyzer says `calls f -> run`, and the two MATCH. The
   differential can see a missing edge, a fabricated edge or a wrong label; it structurally
   cannot see an edge attached to the wrong declaration of the right name.

**The fix.** A C9 branch in `receiverOwnerType` reading the `new_expression`'s `constructor`
field and emitting `{ type, evidence: "new-expression" }`. Negative cases checked: a
call-result receiver (`a.make().run()`) still carries no owner, and a cast-wrapped
`(new B() as any).go()` is still an honest gap rather than a guess.

**Measured.** 138 call sites in the first 4,000 corpus files. The repro now binds to
`src/used.ts:run` (was `src/other.ts:run`), verified end-to-end through `bb index` +
`bb_graph`, not only through the analyzer. Fixture
`validation/m14/fixtures/typescript/new-expression-receiver-owner.ts` declares a rival
`Other.run` on purpose — without it the fixture passes with or without the fix — and fails
when C9 is disabled. Mutant `new-expression-receiver-owner-lost` (15/15 caught).

**The lesson worth keeping.** Three instruments agreed the lane was clean because all three
asked the same question — _is the name there?_ — and none asked _is it the right
declaration?_ The wall probe was the closest, and it had a hardcoded exemption for the exact
shape. A lane whose only resolution evidence is name equality has no evidence about binding.
