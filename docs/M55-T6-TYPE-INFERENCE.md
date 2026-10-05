# M55.T6 — Type inference on the hover card: what it can honestly say

Milestone: M55 ("The Hub That Tells the Truth"). Contract: `docs/IDE-HONESTY-CONTRACT.md`.
Gate: `script/m55/verify-type-inference.ts`. Evidence: `validation/m55/results/T6.json`.
Owner of the surface: `src/lsp/type_inference_surface.ts`, `src/lsp/hover.ts`.

Status: **the surface ships a verified subset, and the engine's own
`confidence` is NOT usable as a trust signal.** Read §"The headline" first.

## The headline

`src/ast/type-inference.ts` is a 1006-line type/flow inference engine that had
never been wired to any editor surface — at this lane's start,
`grep -rn "type-inference\|TypeInference" src/lsp/` returned nothing. The
question was whether its `TypeInfo.confidence` could be rendered.

**It cannot.** Measured across all 14 launch languages, asked for the return
type of a function whose source declares `String`:

| language | the engine's answer | honest? |
| --- | --- | --- |
| typescript | `string` @1.0 | yes |
| javascript | `string` @1.0 | yes |
| java | `string` @1.0 | yes |
| python | `string` @1.0 | yes |
| go | `unknown` @0 | yes (declared absence) |
| kotlin | *detector matches, then no entry at all* | absence |
| rust, c, cpp | *detector matches, then no entry at all* | absence |
| vue, svelte | *zero declared node types match* | no coverage |
| **scala** | **`void` @1.0** | **NO — the function returns String** |
| **groovy** | **`void` @1.0** | **NO** |
| **zig** | **`void` @1.0** | **NO** |

### Why `void` is wrong, in the engine's own source

`InferenceContext.inferFunctionReturnType` (`type-inference.ts:227-240`) returns
`getVoidType()` — **confidence 1.0** — when `findReturnStatements` finds zero
nodes typed `return_statement`. That condition is "I did not recognize this
grammar's return form", reported as maximum certainty in `void`.

Measured node shapes that trigger it:

| language | the function node | its `body` field |
| --- | --- | --- |
| scala, expression body `def f(): String = "s"` | `function_definition` | the body field **is** the `"s"` node |
| scala, block body `def f(): String { return "s" }` | `function_declaration` | **null** — no entry at all |
| groovy `String f() { return "s" }` | `method_declaration` | `closure` |
| zig `fn f() []const u8 { return "s"; }` | `function_declaration` | `block` whose returns are `return_expression`, not `return_statement` |

### `confidence` is a per-codepath constant, not a measurement

| what | value | where |
| --- | --- | --- |
| `getStringType` / `getNumberType` / `getBooleanType` | 1.0 | `type-inference.ts:585-599` |
| `getVoidType` (the misread above) | 1.0 | `type-inference.ts:581-583` |
| every UNLISTED language's `int`/`string`/`bool`/`object` | 0.8 | `type-inference.ts:200-210` |
| `o.push(1)` on a value of type `any` → `number` | **1.0** | `type-inference.ts:723-747`, the hardcoded method-pattern table |
| a union | `Math.max(...members) * 0.8` | `type-inference.ts:566-574` |

The union rule takes the **maximum**, so a union of one confident and one
unconfident member reports the confident member's number — the least
conservative choice available.

A gate of the form "render when `confidence >= X`" would therefore print
`→ void` on a Scala method returning `String`. That is the exact dishonesty
this repository exists to prevent, so it is not the rule.

## What the surface does instead

The engine is a **candidate source, never an authority**. Every answer is
witnessed against the syntax tree before a character reaches a human, and the
rendered text is one of three structurally distinct classes:

| class | when | what renders |
| --- | --- | --- |
| `stored` | the index stored a `return_type` | `type: void _(stored in the bb index · its explicit-vs-inferred origin is not recorded)_` |
| `inferred` | no stored type AND the tree corroborates | `type: string _(inferred · engine confidence 1 · witnessed in the tree: 1 return expression(s) of kind string at function_declaration)_` |
| `unknown` | neither | `type: unknown _(not resolved — <reason>)_` |

`confidence` is non-null **iff** `provenance === "inferred"`, so "a confidence
was rendered for a type the engine did not prove" is a type error, not a
runtime check.

### The witness, and why the engine cannot supply it

Two engine facts make its raw output unattributable to a symbol. Both measured:

1. **`inferredAt` is empty for every function return type.** Only
   `inferVariableType` pushes a location (`type-inference.ts:217-221`).
   Measured: 0 entries on every probed function. There is no recorded reason
   and no recorded place, so nothing downstream can tell which declaration a
   `name:return` entry came from.
2. **The result map is keyed by a bare `${funcName}:return` with no position.**
   Measured: two `add` declarations in one file collapse to **1** entry.

So the facade locates the callable node itself, and accepts it only when the
symbol's **own index-stored line range** lies inside it (§15.3 — the innermost
such node wins; when nothing contains the range the answer is a declared
absence, never the nearest node).

### The two dishonesty classes the witness exists to catch

Both are in the gate as fixture cases, because a rule that cannot be shown to
fail is not a rule.

**Blunt — `void` without a valueless return.** Scala/groovy/zig, above. The
facade honors `void` only when the tree itself shows a return with no value,
or an explicit `void`/`Unit` annotation. Otherwise `void` is withheld and the
declared marker renders.

**Subtle — a correct answer from the hardcoded table.** For
`return "s".toUpperCase()` the engine answers `string` @1.0. That answer is
*correct*, but it came from the pattern table, not from the tree: the return
expression is a `call_expression`, so there is no literal to corroborate.
Rendering it as `inferred` would claim a witness that does not exist. It is
withheld (`witness-disagrees-with-engine`).

## A second finding: the index cannot answer "was that explicit?"

§15.1 requires one surface to give one answer. The index already stores a
return type, and **that column carries no marker of explicit-vs-inferred.**
Measured over every `brain.db` on this machine — 735 indexes, 985,094 symbols,
38,924 carrying a `return_type`:

| language | with a type | not found verbatim at the declaration line |
| --- | --- | --- |
| typescript | 25,079 | 15,547 (**62%**) |
| json | 5,385 | 5,285 (98%) |
| rust | 3,848 | 1,092 (28%) |
| go | 640 | 224 (35%) |
| java | 82 | 15 (18%) |

`brain_symbol` has no metadata/confidence/provenance column. The one candidate,
`annotations`, carries `nodeType` on 335 of 5,459 sampled rows and **no**
key mentioning return, inference, confidence or source.

So `stored` means *stored*, and the `stored` class ships
`storedProvenanceUnknown: true` on the wire rather than resolving the mixture by
guessing. This is a schema gap, reported below, not something this lane fixed.

## The budget: a measured failure, and the ceiling that answers it

The first latency gate I wrote measured only the small fixture and passed at
6.3–11.0 ms p95. Measuring the facade against **real indexed files** found the
truth: it is far over budget at scale.

Measured `resolveTypeLine` end to end, nearest-rank p95, this machine
(darwin 23.6.0, 12 cpus, load average 6.4–7.5), 6 real `.ts` files per band
drawn from this repo's 3,464:

| band | worst p95 |
| --- | --- |
| 8–12 KiB | 18.5 ms |
| 12–16 KiB | 24.6 ms |
| 16–24 KiB | 35.1 ms |
| 24–32 KiB | 41.3 ms |
| 32–48 KiB | 40.1 ms |
| **48–72 KiB** | **65.4 ms — first band over the 50 ms budget** |
| 72–110 KiB | 80.8 ms |
| 1311 KiB (the largest real indexed file on this machine) | **1615.2 ms** |

Hence `MAX_WITNESS_BYTES = 48 * 1024`: the largest band whose worst measured
p95 stays inside the §3 budget. **Above it the facade does not parse at all**
and returns the declared marker with `file-too-large-for-witness`. The guard
runs before the parse, because on the 1311 KiB file the parse alone is the cost.

The gate pins the constant (`facade.MAX_WITNESS_BYTES === 48 * 1024`) so a facade
that raised its own ceiling to dodge the fixture would fail rather than pass.

### A pre-existing finding this lane did not cause

The hover **already** exceeded the same budget on large files before this
module existed. Measured `parseForSafety` — which `resolveOccurrenceSymbol` in
`hover.ts` calls on every hover — p95: 28.7 ms at 10.7 KiB, 68.0 ms at 34.2 KiB,
101.7 ms at 68.5 KiB, 2611.7 ms at 1311.5 KiB.

Reported, not fixed: that resolution path is not this lane's to redesign.

The **marginal** cost of this module over that existing parse is **negative** —
−0.1 to −38 ms across 10–81 KiB and −996 ms at 1311 KiB — because the facade's
walk is cheaper than `parseForSafety`'s mask-building plus identifier extraction.
This module is not what makes the large-file hover slow.

## Evidence discipline

`validation/m55/results/T6.json` regenerates **byte-identically** modulo six
declared volatile fields, which the record names in `volatileFields`:
`generatedAt`, `bbSeal` (it seals `generatedAt`), `fixture.workspace` and
`fixture.projectId` (both derived from a per-run OS temp path), `latency`, and
`machine.loadavg`. Verified: two consecutive runs at a stable HEAD differ in
those and nothing else — `observed`, `wireTypeLines`, `limitations`, `checks`,
`mutants` and `fixture.symbols` are identical.

## Mutation suite — 8 planted defects, all caught, none by a load failure

| id | planted defect | caught by |
| --- | --- | --- |
| M1 | a type the engine never returned is fabricated | renders `String` for a case whose engine answer is `unknown` |
| M2 | the declared unknown marker is suppressed | renders `""` instead of `unknown` |
| M3 | the engine's confidence is overridden with a constant | renders `0.42` where the engine said `1.0` |
| M4 | absence of a return node read as a witnessed valueless return | renders `inferred void` on the Scala case |
| M5 | a stored type is overridden by an unproven inference | `stored` becomes something else |
| M6 | the tree-agreement requirement is dropped | renders `inferred string` from the pattern table |
| M7 | a confidence is attached to a non-inferred type line | `stored` line carries `confidence: 1` |
| M8 | the size ceiling is removed | the over-ceiling file is parsed (190 ms vs 0.27 ms) and renders `inferred` |

Three of these eight were **rewritten after being measured not to fail**,
which is the point of running them:

- **M4's first two anchors were semantically equivalent.** Neutralising the
  void *withhold* guard alone still falls through to the "outside the proven
  subset" branch and renders a declared unknown; neutralising the *promote*
  condition alone leaves the withhold guard standing. Neither could fail. The
  anchor is now the single witness predicate — the one edit that actually
  renders `void` on a function whose source says `String`.
- **M3's original override to `1.0` was unobservable**, because the fixture's
  engine answers are already `1.0`. It is now `0.42`.
- **M6 was probed on a case the engine already calls `unknown`**, where the
  narrower branch would catch it anyway. It is now probed on the pattern-table
  case.

Two gate bugs were found and fixed rather than worked around:

- the freshness leg asserted `data.stale` when the wire nests the hover under
  `data.symbol`;
- the marker assertion was **tautological** — gate and facade both import
  `UNRESOLVED_TYPE`, so they would agree on any value including a real type
  name. The marker is now pinned to the literal word `unknown`.

One more, recorded because it is the kind of thing that quietly validates a
broken fixture: the size ceiling **hid an off-by-one in the fixture's own line
number**, because the honest facade returns `file-too-large-for-witness` before
it ever reads the tree. A wrong line therefore read as a passing fixture. Only
**M8 — the mutant that removes the ceiling and does parse** found it. A guard
that short-circuits ahead of the code under test will mask a broken fixture.

## What `src/ast/type-inference.ts` lacks

Reported, not edited — that file is the analyzer lane's. The exact API this
surface would need, in priority order.

1. **A body-expression path, so a grammar's non-`return` return form is read
   instead of concluding `void`.** This is the single defect behind all three
   dishonest rows. Needed: when `findReturnStatements` finds nothing, consult
   the function node's last expression / `childForFieldName("expression")`
   (scala `= expr`), or treat a `closure`/`block` body field as the body it is,
   before falling back to `getVoidType()`.

2. **`void` must be a conclusion, not a default.** Today "no returns found" and
   "found only valueless returns" are the same value at the same confidence.
   Needed: a distinct marker the caller can test, so absence of evidence is
   never spelled `void`.

3. **`inferredAt` recorded for the return-type path.** Measured 0 entries on
   every probed function. Needed: the same `InferenceLocation` push
   `inferVariableType` makes (`type-inference.ts:217-221`), so a returned type
   carries where and why it came from.

4. **A position in the result key, or a returned-with-location API.** The map is
   keyed by bare `${funcName}:return`, so two same-named functions in one file
   collapse to one entry (measured). Needed: key on symbol identity, or return
   `{ node, typeInfo }[]`.

5. **The pattern table must not answer at confidence 1.0.** `o.push(1)` on an
   `any` is answered `number` @1.0 from `type-inference.ts:723-747`. Needed: a
   confidence that reflects "matched a name in a table", which is not the same
   as having observed a type.

6. **A real confidence, or its removal.** `createUnionType` takes
   `Math.max(...members)` (`type-inference.ts:566-574`) and
   `initializeGenericTypes` hands every unlisted language 0.8. Needed: either a
   calibrated number with a stated method, or a field that is explicitly not a
   confidence so no surface can treat it as one.

7. **Node-type coverage for kotlin, rust, c, cpp** (detector matches, then no
   entry) and **vue, svelte** (nothing matches). Needed: the per-language
   declaration/body node types, as the language-specific body tables already
   exist for javascript/typescript/python/java/rust/cpp/csharp.

8. **Loop, try/catch and match flow analysis** are `TODO` stubs returning an
   empty map (`type-inference.ts:749-762`). Declared, not claimed.

## Declared limitations

- The proven inferred subset is deliberately narrow: a bare primitive literal
  type (`string`/`number`/`boolean`) whose every return expression in the tree
  agrees, or `void` witnessed by a valueless return or an explicit `void`/`Unit`
  annotation. Anything else renders the declared marker. **Measured coverage on
  the 10-case fixture: 2 of 10** (both typescript).
- No editor leg (I3) and no fork leg (I4). This is an **I2-surface claim at
  best**: the component and the wire are exercised, not a pinned editor.
- Latency is measured on a small fixture plus real repo files for the ceiling
  decision. No large-file *end-to-end hover* p95 is measured, because the
  pre-existing `parseForSafety` cost means that number measures another lane's
  work.
- `storedProvenanceUnknown` is `true` for every stored type until the schema
  carries an origin marker (item 2 of the schema gap above). It is declared on
  the wire, not resolved.