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

## Incoming — the external marker, and what is still unresolved (2026-10-10)
The incoming gate counts an edge as resolved / ambiguous / unresolved, and a JDK symbol is a
fourth thing: legitimately outside the corpus. An unmarked edge of that kind is
indistinguishable from a broken one, so it counted against the lane. Before this change,
`npx tsx script/m14/incoming-gate.ts java java 200 --json` reported **`markedExternal 0` on
every type** and 16,021 unresolved of 26,095 edges.

The marker asserts only what a single file can PROVE: a target carrying a JVM-platform /
Kotlin-stdlib qualifier (`java.`, `javax.`, `jakarta.`, `jdk.`, `sun.`, `com.sun.`, `kotlin.`,
`kotlinx.`), or a target whose root segment the file imports from such a module. Deliberately
NOT marked: `org.`/`com.` packages (in a multi-module build `com.acme` IS project source — the
same reason `isJavaBuiltin` keeps `com.sun` and `com.mycompany` apart), wildcard imports, and
java.lang simple names used with no import (`String`, `Object`, `System`) — those are *probably*
the platform types, and an unproven marker would hide a genuine unresolved edge behind a claim
the file cannot make.

| type | edges | resolved | markedExternal | ambiguous (decl) | unresolved |
|---|---|---|---|---|---|
| calls | 8,290 (+0) | 1,591 (+0) | **40 (+40)** | 2,143 (0) | 4,516 (**−40**) |
| uses | 1,212 (+0) | 413 (+0) | 0 (0) | 258 (0) | 541 (0) |
| contains | 3,833 (+0) | 2,056 (+0) | 0 (0) | 1,777 (0) | 0 (0) |
| imports | 2,716 (+0) | 0 (+0) | **889 (+889)** | 0 (0) | 1,827 (**−889**) |
| references | 8,198 (+0) | 503 (+0) | **2,083 (+2,083)** | 819 (0) | 4,793 (**−2,083**) |
| exports | 299 (+0) | 290 (+0) | 0 (0) | 9 (0) | 0 (0) |
| extends | 143 (+0) | 22 (+0) | 10 (+10) | 3 (0) | 108 (−10) |
| implements | 111 (+0) | 14 (+0) | **53 (+53)** | 0 (0) | 44 (**−53**) |
| overrides | 495 (+0) | 0 (+0) | **57 (+57)** | 0 (0) | 438 (**−57**) |
| instantiates | 798 (+0) | 161 (+0) | **151 (+151)** | 15 (0) | 471 (**−151**) |
| **total** | **26,095 (+0)** | **5,050 (+0)** | **3,283 (+3,283)** | **5,024 (0)** | **12,738 (−3,283)** |

Every edge count and every `resolved` count is unchanged: the marker adds a DECLARED EXCEPTION,
it does not claim resolution and does not drop or invent an edge. Instrument self-test PASS,
200/200 parsed, 0 degraded. **The verdict is still FAIL** — 5,024 ambiguous + 12,738 unresolved
of 26,095 — because a quarter of the unresolved class was external and three quarters are not.
Fixture control: the 11 failing java fixtures are the SAME SET before and after this change
(`--lang java`, 52 pass / 11 fail, baseline gate *no regressions*).

### What Java's incoming round still owes
- **No declaration exists.** typescript has one (`validation/m14/instruments/typescript/`):
  classes with kinds, sentences and ratcheted ceilings, and a gate that fails on OVER CEILING /
  UNDECLARED. Java has a measurement and no declaration, so nothing yet stops the backlog growing.
- **12,738 unresolved.** The biggest named families are third-party packages (`org.`/`com.`,
  provable only against a dependency model the analyzer does not have) and java.lang names used
  with no import.
- **5,024 ambiguous by declaration** (2,143 of them `calls`), and `qualifiedNameAliases: 0` — the
  pool publishes no aliases for java, so the qualified-endpoint rule that bound 4,201 edges in
  typescript has nothing to work with here. That is the structural difference between the two
  lanes, not a defect in this one.
- Corpus: 10,305 `.java` files across 14 repos; the numbers above are the 200-file sample the
  fleet gate draws. A corpus-wide figure needs the same sample-size statement the typescript
  lane now prints.

## Verification
- Fixtures: 25 (`validation/m14/fixtures/java/`), incl. type-usage-graph pinning the declared-type graph
- Corpus: grails-core@HEAD differential 100% coverage / 0 fabrications; perf gate warm-up hardened
- Grammar audit: PASS (0 unknown node-type references)
- Incoming (200 files, `incoming-gate.ts java java 200 --json`): **exit 1 — FAIL**, 5,024
  ambiguous + 12,738 unresolved of 26,095 edges, `markedExternal 3,283` (was 0); fixture set
  identical before and after the marker
- Mutation hardening: 4 java-specific mutants ALL CAUGHT (incl. drop-declared-types)
