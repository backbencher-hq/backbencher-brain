# Groovy Analyzer

## What it extracts
- **Symbols**: classes, traits, interfaces, enums, methods, constructors, properties,
  constants
- **Relationships**: extends, implements, instantiates, calls (incl. juxt_function_call),
  uses, contains, overrides, references (imports), permits
- **Payloads**: qualified_calls, groovydoc comments, visibility, decorators/annotations,
  framework detection (grails/spring/hibernate/jpa/spock/junit)

## Evidence tiers
Same taxonomy as JVM family. Template instantiates = usage_contextual.
Script-level calls attributed to `(script)` sentinel.

## Type-reference semantics
- Fields, params, locals, throws clauses, instanceof targets emit references
- Generics expand to base + arguments; `def`/`as` keywords never become edges
- Grammar quirk: dangling `x as T` mis-parses as a declaration with
  type_identifier("as") — excluded by name

## Known limitations
- Same-name ambiguity resolution imprecise
- Chain topology root-anchored (documented decision)

## Grammar provenance
Vendored fork (amaanq 0.1.2, owner-improved). Measured head-to-head vs community
murtaza64 grammar: fork 34% clean parse rate vs 29%. Fork has trait support; murtaza64
does not. No rebuild needed.

**RE-MEASURED 2026-09-15 (M49 W19) — the decision holds, and the margin has widened.**
Same instrument, same 400-file recorded sample; murtaza64 rebuilt from its `main`:

| grammar | sample files failing | with a true ERROR node |
| --- | --- | --- |
| this fork | **29/400 (7.2%)** | 29 |
| murtaza64 (main, built 2026-09-15) | **291/400 (72.8%)** | 276 |

The Aug-2026 "no trait support" finding is consistent with today's probes once stated
precisely: minimal traits (method, property, abstract method) parse on their `main`, but
`class C implements T`, `class C extends Base` with a constructor, and a bare
`Foo(String a)` constructor all FAIL — traits as *used* are what shreds. Our own residual
is 29 files with no dominant class (7 begin with a comment block; the rest are scattered),
and the only construct in the battery that still fails is the one-line label block.
Harness: `script/m14/tmp/groovy-grammar-headtohead.ts` (parses with web-tree-sitter
directly, so it measures the grammar rather than the analyzer).

For any future "PR it upstream" idea: **there is no official Groovy tree-sitter grammar.**
Apache `GROOVY-11705` ("Official tree-sitter grammar for Groovy") is an OPEN, unassigned
request that names murtaza64's as the most popular maintained grammar; `amaanq`'s upstream
has been dormant since 2024-11-19 (5 commits, v0.1.2, README self-described as a one-hour
experiment). So this fork is the maintained artifact, not a derivative waiting on upstream.

## Verification
- Fixtures: 18+ (`validation/m14/fixtures/groovy/`)
- Corpus: grails-core@HEAD differential 100% coverage / 0 fabrications
- Grammar audit: PASS (0 unknown node-type references)
- Mutation hardening: drop-declared-types mutant CAUGHT via type-usage-graph fixture
