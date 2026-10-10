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
every type** and 16,021 unresolved of 26,095 edges.

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

### The second change: qualifiedName aliases (resolved +103, zero edge churn)
The analyzer now publishes each symbol's file-scoped `qualifiedName`, which the gate indexes as
an ALIAS of the same declaration. Measured effect, everything else identical:

| type | edges | resolved | external | ambiguous (decl) | otherUnresolved |
|---|---|---|---|---|---|
| calls | 8,290 (+0) | 1,591 (+0) | 40 (+40) | 2,143 (0) | 4,516 (−40) |
| uses | 1,212 (+0) | 413 (+0) | 0 (0) | 258 (0) | 541 (0) |
| contains | 3,833 (+0) | 2,056 (+0) | 0 (0) | 1,777 (0) | 0 (0) |
| imports | 2,716 (+0) | **10 (+10)** | 889 (+889) | 0 (0) | 1,817 (−899) |
| references | 8,198 (+0) | **590 (+87)** | 2,083 (+2,083) | 819 (0) | 4,706 (−2,170) |
| exports | 299 (+0) | 290 (+0) | 0 (0) | 9 (0) | 0 (0) |
| extends | 143 (+0) | 22 (+0) | 10 (+10) | 3 (0) | 108 (−10) |
| implements | 111 (+0) | **15 (+1)** | 53 (+53) | 0 (0) | 43 (−54) |
| overrides | 495 (+0) | **1 (+1)** | 57 (+57) | 0 (0) | 437 (−58) |
| instantiates | 798 (+0) | **165 (+4)** | 151 (+151) | 15 (0) | 467 (−155) |
| **total** | **26,095 (+0)** | **5,153 (+103)** | **3,283 (+3,283)** | **5,024 (0)** | **12,635 (−3,386)** |

Every edge count is unchanged, `ambiguous` is unchanged at every type, and `resolved` gains
exactly the 103 edges the aliases bind: the alias rule RESOLVES, it does not reclassify. The
marked-external change adds a DECLARED EXCEPTION: it does not claim resolution and does not drop
or invent an edge. Instrument self-test PASS, 200/200 parsed, 0 degraded, `qualifiedNameAliases
3,040` (was 0). **The fleet gate's verdict is still FAIL** — 5,024 ambiguous + 12,635 unresolved
of 26,095 — because that verdict is the fleet's bar, not Java's; Java's own gate now reads PASS
at its declaration, which is a statement about what is declared and ratcheted, not about the
ceiling being small. Fixture control: the 11 failing java fixtures are the SAME SET before and
after both changes (`--lang java`, 52 pass / 11 fail, baseline gate *no regressions*).

### What Java's incoming round still owes
- **12,635 `otherUnresolved`.** The biggest named families are third-party packages
  (`org.`/`com.`, provable only against a dependency model the analyzer does not have),
  java.lang names used with no import (`String`, `Object`, `Exception`), and member paths whose
  receiver type the file cannot see (`Closure.getParameterTypes`, `HubMessage.getMessageType`).
  Ceilings per type are in `validation/m14/instruments/java/incoming-declaration.json`; the
  gate's worklist prints the instrument's 25-name sample per type.
- **5,024 ambiguous by declaration** (2,143 of them `calls`) — the pool is file-local, so an
  unqualified member name collides across files (`next` × 2, `constructor` × 5, `Builder` × 4).
  The alias change was the cheapest fix available (target spelling); a real reduction needs a
  receiver-type pass, which is a different piece of work, not a re-run.
- Corpus: 10,305 `.java` files across 14 repos; the numbers above are the 200-file sample the
  fleet gate draws. A corpus-wide figure needs the same sample-size statement the typescript
  lane now prints.

## Verification
- Fixtures: 25 (`validation/m14/fixtures/java/`), incl. type-usage-graph pinning the declared-type graph
- Corpus: grails-core@HEAD differential 100% coverage / 0 fabrications; perf gate warm-up hardened
- Grammar audit: PASS (0 unknown node-type references)
- Incoming (200 files, `incoming-gate.ts java java 200 --json`): **exit 1 — FAIL**, 5,024
  ambiguous + 12,635 unresolved of 26,095 edges, `markedExternal 3,283` (was 0),
  `qualifiedNameAliases 3,040` (was 0); fixture set identical before and after both changes
- Java declaration (`java-incoming-gate.ts`, 200 files): **exit 0 — PASS**, all five classes
  declared per type, no floor lost, no ceiling raised, `unclassed 0` and the class sum equals
  the edge count on all ten types; six-case self-test PASS; tightened-ceiling control **exit 1**
  with the violation named
- Mutation hardening: 4 java-specific mutants ALL CAUGHT (incl. drop-declared-types)
