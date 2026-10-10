# Java Analyzer

## What it extracts
- **Symbols**: classes, interfaces, records, enums, annotation types, methods,
  constructors (incl. compact), fields, interface constants, record components,
  enum constants
- **Relationships**: extends, implements, instantiates, calls, uses (field access),
  contains, exports, overrides, permits, references (imports + declared types:
  fields, params, locals, catch unions, throws; cast targets, instanceof checks,
  class literals, array creation, method-reference receivers, switch patterns)
- **Payloads**: qualified_calls, complexity (per-symbol cyclomatic), javadoc comments,
  genericParameters, visibility, decorators/annotations, apiContractPath (Spring routes)

## Evidence tiers
Every relationship carries `metadata.evidenceClass`:
- `structural`: grammar-clause derived (extends, implements, contains, exports)
- `usage_contextual`: observed calls, field access
- `inferred`: pass-3 override guesses @0.5

## Type-reference semantics
- Declared types expand generics: `Map<String, List<X>>` → Map, String, X
- Bounded wildcards descend: `List<? extends CharSequence>` → CharSequence
- Scoped names stay fully dotted: `java.io.IOException` (dotted-name convention)
- Primitives (`int`, `double`) are never type_identifier nodes — correctly silent

## Known limitations
- Override confidence reason codes added but pass-2/pass-3 thresholds not empirically calibrated beyond patterns.ts consumer audit
- Same-name ambiguity resolution picks one candidate without overload/language preference

## Incoming — the declaration, the external marker, and what is still unresolved (2026-10-10)
The incoming gate counts an edge as resolved / ambiguous / unresolved, and a JDK symbol is a
fourth thing: legitimately outside the corpus. An unmarked edge of that kind is
indistinguishable from a broken one, so it counted against the lane. Before this change,
`npx tsx script/m14/incoming-gate.ts java java 200 --json` reported **`markedExternal 0` on
every type** and 16,021 unresolved of 26,095 edges (that run was made in the shared tree with
another lane live — the clean figures below are the ones this document now carries).

Java now has a DECLARATION with a ratchet, the artifact its incoming round was missing:

```
npx tsx script/m14/java-incoming-gate.ts            # ratchet check against the declaration
npx tsx script/m14/java-incoming-gate.ts --json     # declared + measured, per type
npx tsx script/m14/java-incoming-gate.ts --update-baseline   # re-declare deliberately
```

It does **not** re-measure Java with a second instrument — it shells out to
`script/m14/incoming-gate.ts` and ratchets THAT measurement, because two instruments measuring
the same population and disagreeing is the failure mode `verify-honesty.ts` exists to catch.
Every edge of every type falls in exactly one of five declared classes:

| class | what it is | bound |
|---|---|---|
| `resolved` | target matched exactly one declaration (name or `qualifiedName` alias) | **floor** — may not decrease |
| `external` | no declaration matched, and the edge carries the provable external marker (+`externalReason`) | **floor** — may not decrease |
| `ambiguous` | target matched two or more declarations (counted by DECLARATION) | **ceiling** |
| `otherUnresolved` | no declaration and no marker — the honest backlog, *not* asserted third-party | **ceiling** |
| `unclassed` | empty target string, so no class was assigned | **exact 0** — checked, not assumed |

The five are siblings that partition the edges, and the gate verifies the identity
`edges = resolved + ambiguous + otherUnresolved + external + unclassed` per type. This file's
first version derived `otherUnresolved = unresolved − external`, assuming the marker was counted
*inside* `unresolved`; the instrument increments the two in mutually exclusive branches
(`incoming-gate.ts:331-340`), and the assumption printed **`implements otherUnresolved −10`** —
a negative count of things that do not exist — on the first full run. The `unclassed` class (an
exact bound, not a ceiling: `≤ 0` would accept −1) exists so impossible arithmetic cannot pass
as a clean measurement.

The declaration binds the ANALYZER DIGEST (`sha256:6e2e5693569c62ee` today). A changed analyzer
fails the gate until the lane is re-declared on purpose — ceilings are not inherited by a
successor. The gate's positive control runs before any corpus: six planted failures (ambiguous
over-ceiling, resolved floor loss, external floor loss, undeclared type, `otherUnresolved`
over-ceiling, both signs of unclassed) must each fire, or the gate refuses to print any verdict.
The end-to-end control was run too: tightening `calls.ambiguous` 2,143 → 2,142 produced
**exit 1** with `calls: ambiguous ceiling 2142 violated — measured 2143 (1 REGRESSED)`.

The marker asserts only what a single file can PROVE: a target carrying a JVM-platform /
Kotlin-stdlib qualifier (`java.`, `javax.`, `jakarta.`, `jdk.`, `sun.`, `com.sun.`, `kotlin.`,
`kotlinx.`), or a target whose root segment the file imports from such a module. Deliberately
NOT marked: `org.`/`com.` packages (in a multi-module build `com.acme` IS project source — the
same reason `isJavaBuiltin` keeps `com.sun` and `com.mycompany` apart), wildcard imports, and
java.lang simple names used with no import (`String`, `Object`, `System`) — those are *probably*
the platform types, and an unproven marker would hide a genuine unresolved edge behind a claim
the file cannot make.

### Three changes to the lane, and a clean-vs-dirty correction

**(1) `qualifiedName` aliases, +103 resolved with zero edge churn.** The analyzer now publishes
each symbol's file-scoped `qualifiedName`, which the gate indexes as an ALIAS of the same
declaration; 3,040 aliases (was 0) bind the 103 edges the dotted spellings could not reach —
the alias rule RESOLVES, it does not reclassify, and no other count moved.

**(2) The bare-read fix: +301 `uses` edges, all published, none newly unresolved.** The bare-read
block sourced at the enclosing TYPE while the dotted read beside it in the same body was
method-sourced, so one spelling of the same read could not compose with `x calls read`. The M49
W15 #814 owner ruling, the fixture pair (`member-read-source`, `bare-member-read-uses`) and the
mutation battery all put the family on METHOD source; the block's comment claimed "this lane's
truth expects" type-sourced rows, and the java `uses` oracle wildcards the source as `(expr)`,
so that claim was unsupported. Fixing it stopped the per-TYPE dedup, so each reading method now
publishes its own read: +169 resolved and +132 ambiguous occurrences, `otherUnresolved
UNCHANGED` at 12,628. The mutant `java/bare-read-type-attribution` had SURVIVED the mutation
suite because mutant and live code were the same shape; it is now CAUGHT, F4 dropped from 16
survivors to 15 with zero Java survivors, and F3's java row moved 52/63 → **53/63**.

**(3) The clean-vs-dirty correction, and the guard that makes it visible.** The first declaration
shipped `overrides 495`; a CLEAN checkout of the same commit measures **488**. The difference
was seven edges from another lane's uncommitted `pool-worker`/`import-resolution` work in this
shared tree — numbers that would have read as a Java regression forever. `java-incoming-gate.ts`
now REFUSES (exit 3, naming the files) when `src/ast` is dirty, because the declared numbers come
from pool-worker parsing and move without moving the analyzer digest; the census reports that
refusal as a refusal rather than a crash.

Current declaration — clean-to-clean deltas against `e462a3797` (the pre-fix commit, measured in
its own clean worktree), digest `sha256:2a275b904319f6ba`:

| type | edges | resolved | external | ambiguous (decl) | otherUnresolved |
|---|---|---|---|---|---|
| calls | 8,290 (±0) | 1,591 (±0) | 40 (±0) | 2,143 (±0) | 4,516 (±0) |
| uses | **1,513 (+301)** | **582 (+169)** | 0 (±0) | **390 (+132)** | 541 (±0) |
| contains | 3,833 (±0) | 2,056 (±0) | 0 (±0) | 1,777 (±0) | 0 (±0) |
| imports | 2,716 (±0) | 10 (±0) | 889 (±0) | 0 (±0) | 1,817 (±0) |
| references | 8,198 (±0) | 590 (±0) | 2,083 (±0) | 819 (±0) | 4,706 (±0) |
| exports | 299 (±0) | 290 (±0) | 0 (±0) | 9 (±0) | 0 (±0) |
| extends | 143 (±0) | 22 (±0) | 10 (±0) | 3 (±0) | 108 (±0) |
| implements | 111 (±0) | 15 (±0) | 53 (±0) | 0 (±0) | 43 (±0) |
| overrides | 488 (±0) | 1 (±0) | 57 (±0) | 0 (±0) | 430 (±0) |
| instantiates | 798 (±0) | 165 (±0) | 151 (±0) | 15 (±0) | 467 (±0) |
| **total** | **26,389 (+301)** | **5,322 (+169)** | **3,283 (±0)** | **5,156 (+132)** | **12,628 (±0)** |

The marked-external change adds a DECLARED EXCEPTION: it does not claim resolution and does not
drop or invent an edge. Instrument self-test PASS, 200/200 parsed, 0 degraded, `qualifiedNameAliases
3,040`. **The fleet gate's verdict is still FAIL** — 5,156 ambiguous + 12,628 unresolved of
26,389 — because that verdict is the fleet's bar, not Java's; Java's own gate reads PASS at its
declaration, which is a statement about what is declared and ratcheted, not about the ceiling
being small. Fixture control: the failing set lost exactly `bare-member-read-uses` (`--lang java`,
53 pass / 10 fail, baseline gate *no regressions*); every other failure is byte-identical to the
pre-fix set.

### What the backlog IS, by family — `script/m14/java-incoming-census.ts`
`12,628 unresolved` is not actionable; the census says what it is. It walks the same 200-file
sample with the same discovery and classification, and **refuses to print unless its per-type
counts equal a fresh `incoming-gate.ts --json` run** (the equality control — a family table over
a different walk is a number about nothing). Measured 2026-10-10 at the current commit,
200/200 parsed:

| family | occurrences | distinct names | by type |
|---|---|---|---|
| `member-shaped` (lowerCamelCase) | 4,767 | 827 | calls 4,468, uses 258, references 40 |
| `third-party` (dotted) | 3,535 | 893 | imports 1,816, references 1,238, overrides 430 |
| `java-lang-shaped` (JDK list) | 2,110 | **36** | references 1,935, instantiates 168 |
| `other` (project types, out of sample) | 1,969 | 425 | references 1,493, instantiates 279, extends 93 |
| `constant-shaped` (ALL_CAPS) | 197 | 95 | uses 197 |
| `keyword-spelled` | 50 | 2 (`super`, `this`) | calls 48, uses 2 |

and the ambiguity: **5+ declarations 2,871 occurrences over just 83 names** (worst 139
declarations for one `contains` target), 2 decl 1,367/317, 3 decl 628/109, 4 decl 290/70 —
the `uses` type is now 390 ambiguous, because the #814 fix publishes one read per reading METHOD
instead of one per type, so more occurrences carry colliding member names while `otherUnresolved`
did not move at all.

Three families look like defects and are not, with the ruling that makes each one:
- **`keyword-spelled`** — `super(...)`/`this(...)` keep the keyword as target by an explicit
  ruling (M14 #419 G2, analyzed at `real-java-analyzer.ts:1613-1641`): the receiver is the
  honest endpoint and the class's own `extends` edge carries the parent; the differential's
  oracle mirrors this by design (`differential.ts:1432-1441`), and both spellings are pinned in
  the fixture `ctor-delegation`.
- **bare `contains` targets** (`constructor`, member names) — the containment oracle
  (`deriveJavaContainsTruth`, `differential.ts:1577+`) derives bare member names on both ends
  from the language's containment rule. Qualifying them would break the oracle, not improve it.
  The 1,777 ambiguous is the price of the member-name contract, and it is declared and ratcheted.
- **`other`/project names** (`HubMessage`, `IChunk`) — declared in files OUTSIDE this 200-file
  sample; a sampling property of the measurement, not a lane defect. `extends` 93 of 108 is
  the same effect for superclasses.

What remains genuinely unprovable in-file: `java-lang-shaped` (a same-package class may legally
shadow `String`, so the marker cannot claim it) and `third-party` (needs a dependency model).

### What Java's incoming round still owes
- **12,628 `otherUnresolved`** — now explained family by family above; ceilings per type are in
  `validation/m14/instruments/java/incoming-declaration.json` and the gate prints the
  instrument's 25-name sample per type.
- **5,156 ambiguous by declaration** (2,143 `calls`, 1,777 `contains`, 390 `uses` — the last grew
  with the #814 per-method reads) — the pool is file-local, so an
  unqualified member name collides across files (`next` × 2, `constructor` × 5, `Builder` × 4).
  The alias change was the cheapest fix available (target spelling); a real reduction needs a
  receiver-type pass, which is a different piece of work, not a re-run.
- Corpus: 10,305 `.java` files across 14 repos; the numbers above are the 200-file sample the
  fleet gate draws. A corpus-wide figure needs the same sample-size statement the typescript
  lane now prints.

## Verification
- Fixtures: 63 (`validation/m14/fixtures/java/`), incl. type-usage-graph pinning the declared-type graph
- Corpus: grails-core@HEAD differential 100% coverage / 0 fabrications; perf gate warm-up hardened
- Grammar audit: PASS (0 unknown node-type references)
- Incoming (200 files, `incoming-gate.ts java java 200 --json`): **exit 1 — FAIL**, 5,156
  ambiguous + 12,628 unresolved of 26,389 edges, `markedExternal 3,283` (was 0),
  `qualifiedNameAliases 3,040` (was 0). Measured in a CLEAN worktree at the commit it names;
  in the shared tree the same command now refuses at the java gate instead of ratifying dirt
- Java declaration (`java-incoming-gate.ts`, 200 files): **exit 0 — PASS**, all five classes
  declared per type, no floor lost, no ceiling raised, `unclassed 0` and the class sum equals
  the edge count on all ten types; six-case self-test PASS; tightened-ceiling control **exit 1**
  with the violation named; dirty-`src/ast` control **exit 3** with the files named
- Mutation: F4 **15 survivors** (was 16), **zero of them Java** — java/bare-read-type-attribution
  is CAUGHT by the fixture that was waiting for the fix
- Census (`java-incoming-census.ts`, 200 files): **exit 0**, equality control PASS — every
  per-type count equals `incoming-gate.ts --json`; marker finding **none** (every
  platform-qualified target is marked)
- Honesty ledger, after this round: **F1, F2, F3, F7, F9 current** — every regeneration ran in a
  CLEAN worktree of the commit it stamps, because the shared tree carries another lane's
  uncommitted JavaScript work (a shared-tree fixture run reported vue/svelte/html regressions
  the clean checkout does not reproduce: 0 there). F3 records java at 53/63; F9 went from
  2 failing probes to **52/52 pass** by repairing the two stale ones (php's deleted 0.5 guess;
  clean's imported-constructor expectation) — repairable evidence, not silenced checks.
  **F4, F5, F8 remain red for reasons this machine cannot fix:** F5 and F8 need corpora that do
  not exist here (`grails-core`, `Exposed`, `vue-core` — F8's 16 failing rows are literally
  `corpus missing: <repo>`, and regenerating would replace canonical evidence with local
  "corpus missing" rows), and F4 is a 1,836-mutant run over other lanes' analyzers.
- Mutation hardening: 4 java-specific mutants ALL CAUGHT (incl. drop-declared-types)
