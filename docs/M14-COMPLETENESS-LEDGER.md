# M14 Completeness Ledger

Status: **LIVE GOVERNANCE ARTIFACT** — checked by `script/m14/verify-honesty.ts`.
Every cell is either `GATED` (a standing verification exists) or `PENDING`
(visible, scheduled). A PENDING cell may never be silently dropped; a wave
claiming L5 while touching a PENDING cell it depends on fails the honesty gate.

## Purpose

The import-persistence bug survived months of green gates because gates tested
layers, not seams. This ledger enumerates ALL verification cells so nothing is
protected by nobody. Rule: **every newly discovered bug class becomes a
permanent gate before its fix counts as landed** (see F7 rule).

## Matrix 1 — Pipeline stage × artifact type

Stages: PARSE → ANALYZE → STORE (brain.db) → QUERY (tools) 
Artifacts: symbols, relationships by kind, imports, taints, patterns, flags, embeddings, health

| Stage ↓ / Artifact → | symbols | extends/implements | calls | instantiates | uses | imports | overrides | GATED F3 java/groovy + owner kotlin/scala | GATED F3 | GATED F3 (override-fallback-confidence) | differential NOW COUNTS overrides; #381 acceptance met -> close |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ANALYZE (fixtures) | GATED F3 | GATED F3 | GATED F3 | GATED F3 | GATED F3 | GATED F3* | GATED F3* | PENDING -> #381 (taints) | PENDING F10 | GATED F3 | n/a | n/a |
| STORE (pipeline e2e) | GATED F7 | GATED F7 | GATED F7 | GATED F7 | PENDING -> #384 (uses/overrides rows) | GATED F7 | PENDING (add to F7) | PENDING (seam-sweep) | **DEAD SEAM → F10** | GATED F7 | PENDING (needs key; conditional gate) | GATED F7 |
| QUERY (tools truthfully read stored data) | M13 scope | M13 scope | M13 scope | M13 scope | M13 scope | PENDING -> M15 (co-agent; verify brain_import surfaced) | M13 scope | M13 scope | **BROKEN → F10** | PENDING | M13 scope | M13 scope |

\* fixture coverage per language grows with its wave; JVM done, others pending their waves.

Findings already produced by this matrix:
- brain_import was never written (FIXED, gated in F7)
- brain_pattern is read-but-never-written (F10)
- is_cross_language was never set (FIXED, gated in F7)

## Matrix 1b — Symbol-level payload coverage (added after qualified_calls bug)

The isKotlinBuiltin bug proved relationship-only verification misses
symbol-field rot. Every language wave must pin these symbol payloads:

| Payload | java | groovy | kotlin | scala |
|---|---|---|---|---|
| qualified_calls | GATED (java/qualified-call-path) | GATED (groovy/qualified-call-path + qualified-calls-payload) | GATED (qualified-calls-builtin-names) | GATED (CC1+payload fixture) |
| docstrings | GATED (javadoc-payload) | GATED (groovydoc-payload) | GATED (kdoc-extraction) | GATED (scaladoc-payload) |
| parameters (+defaults) | GATED (parameters-payload + mutant java/drop-parameters) | GATED (groovy/parameters-payload incl. varargs String[]; mutants drop-parameters + drop-varargs-type CAUGHT) | GATED (parameters-payload + mutant kotlin/strip-parameters CAUGHT) | GATED (parameters-payload incl. repeated String* + mutant scala/drop-parameters CAUGHT) |
| byte ranges (bb_edit depends) | indirect via M13 edit gates | same | same | M13 scope |
| visibility/modifiers | GATED (generic-visibility-payload) | GATED (generic-visibility-payload) | GATED (visibility-payload + mutant kotlin/strip-visibility CAUGHT) | GATED (generic-visibility-payload) |
| typeParameters/generics | GATED (generic-visibility-payload) | GATED (groovy/generic-visibility-payload) | GATED (generic-parameters-payload) | GATED (generic-parameters-payload) |
| apiContract | GATED (java/fq-api-endpoint) | NOT EMITTED -> declared (S4 ruling) | n/a | n/a |
| range columns 1-based | GATED (CC1) | GATED (CC1, was 0-based - FIXED) | GATED (CC1) | GATED (CC1) |

RECONCILED 2026-08-27 to the #419 gated state (earlier rows claiming
java/groovy PENDING for qualified_calls/docstrings were stale rot; the
#419 section-C gate in `completeness-inventory.ts` is now the
AUTHORITATIVE per-language payload record — Matrix 4b row + section C
checks, machine-verified on every `npm run verify`).

**Standing fixture-authoring rule**: every language's fixtures MUST include
identifiers that collide with stdlib/builtin words (get/map/run/add...),
because suppression filters are invisible to output-diff tests otherwise.

## Matrix 1c — Relationship-type verification taxonomy

Schema truth (src/ast/types.ts RelationshipType): calls, extends, implements,
instantiates, uses, references(+DependsOn alias), contains, overrides,
exports, imports (persisted to brain_import + reference edges).
NOT relationship types despite appearing in output: field_access /
kotlin_extension_function / config_property (= metadata.relationshipType
qualifiers on Uses/Calls edges); ownerName (symbol field); "regex"/"var" are
grammar nodes, never emitted concepts.

| Type | java | groovy | kotlin | pinned by |
|---|---|---|---|---|
| calls | GATED F3 | GATED F3 | GATED F3 | fixtures + differential |
| extends | GATED F3 | GATED F3 | GATED F3 | fixtures + differential |
| implements | GATED F3 | GATED F3 | GATED F3 | fixtures + differential |
| instantiates | GATED F3 | GATED F3 | GATED F3 | fixtures + differential |
| uses / field_access | GATED F3 (anti-skip) | GATED F3 | GATED F3 | pure-field-chain fixtures |
| contains | GATED (java #419 section B, 11/11) | GATED (groovy/contains-edges + mutant) | GATED (object-literal + init-attribution) | PENDING -> #254 |
| overrides | GATED (java/overrides fixture) | GATED (groovy/overrides + fq-annotations) | GATED (object-literal attribution + override-fallback-confidence) | PENDING -> #254 |
| references/imports | GATED (java/import-edges + mutant) | GATED (groovy/import-edges + mutants) | GATED (kotlin/import-edges + mutant kotlin/reclassify-import-tier CAUGHT — K8 closed) | PENDING -> #254 (+ confirmed import-tier finding) |
| exports | GATED (java/fq-api-endpoint) | NOT EMITTED -> declared (S3 ruling) | n/a | n/a |

RECONCILED 2026-08-27 to the #419 gated state (the earlier
"NO FIXTURE ANY LANGUAGE" overrides row and "implicit contains" rows
were stale — java/groovy now carry explicit fixture + mutant pins; the
#419 section-B gate in `completeness-inventory.ts` is the AUTHORITATIVE
per-language relationship-kind record).

Scala (Matrix 2 JVM cluster): fixtures 10/10 GATED; differential 95.1% cov / 0.5% unexplained on scala3@HEAD after #385 fixes (trait multi-parent positional bug fixed; stable_type_identifier parents; script-sentinel constructions).  kotlin wasm fieldCount=0 -> #382.

## AST purity audit (2026-08-23)

Relationship and symbol extraction in java/groovy/kotlin: tree-walk based,
grammar fields used where the wasm provides them (kotlin wasm: fieldCount=0 -
positional fallbacks documented). Remaining raw-text semantics, all DECLARED:
- java/groovy collectFieldAccessUses split(".") (anti-skip holds; grammar-fields rewrite open)
- framework/pattern DETECTION labels use content substring matching
  (kotlin stringIncludes(content,"let") etc) - cosmetic metadata, low stakes;
  destination decided under F10
No regex used in relationship extraction in the three audited analyzers.

## Gate CC1 — Cross-language consistency (script/m14/verify-cross-language-consistency.ts)

Equivalent class/method shape in java/groovy/kotlin/scala asserted structurally
identical: 1-based ranges everywhere, consistent symbol kinds, payload presence
per declared support. Born from the scala column-base finding; IMMEDIATELY
caught groovy emitting 0-based columns (fixed) and corrected the
qualified_calls support map (groovy does not emit them - #383).

## Matrix 1d — Evidence-tier coverage (#299)

Every relationship across gated languages carries metadata.evidenceClass:
structural | usage_contextual | import_based | reference_qualified | inferred.

| Language | Classifier live | Tier fixture pins |
|---|---|---|
| java | GATED | GATED (class-extends-implements: structural/usage) |
| groovy | GATED | GATED (runtime-verified extends/calls/contains) |
| kotlin | GATED | GATED (contains-edges: structural; indexing-uses/template-uses/instantiates-edges: usage_contextual; import-edges: import_based) |
| scala | GATED | runtime-verified; dedicated pins during payload pass |
| typescript | GATED | GATED (consistency-tiers) |

Rules: contains/exports=structural; extends/implements/overrides by confidence
(1.0 structural / 0.85 usage / <0.85 inferred); instantiates structural when
new-derived or >=0.9; calls/uses=usage_contextual; import references=
import_based. Applied centrally per analyzer so emission sites cannot skip it.

### Evidence-tier taxonomy (#299 — implemented, JVM+TS live)

Every relationship emitted by gated analyzers carries `metadata.evidenceClass`:

| Tier | Meaning | Typical sources | Confidence range |
|---|---|---|---|
| structural | grammar-clause or declaration-derived | extends/implements from type clauses, contains from body membership, overrides pass-1 exact match | 0.9–1.0 |
| usage_contextual | observed calls, field access, companion-apply idioms, extension markers | method_invocation calls, field_access uses, companion-apply instantiations | 0.6–0.95 |
| import_based | import/reference-derived edges | brain_import rows feeding reference edges | 0.9 |
| reference_qualified | qualified references (FQN paths, dotted names) | scoped identifier references | 0.9 |
| inferred | sub-1.0 resolutions (pass-3 guesses, heuristic instantiations) | first-parent-guess overrides @0.5, PascalCase instantiation @0.7 | 0.3–0.7 |

Rule: inferred-tier edges never contaminate thresholded analysis (patterns.ts
filters at >= 0.7). Suppression policy: name-collision edges are not emitted
(they were the #299 danger class). Every edge's tier is set centrally per
analyzer via classifyEvidenceTier() so emission sites cannot forget it.

## Matrix 2 — Language-cluster pipeline coverage (realistic combos, not all-to-all)

| Cluster | Languages | Polyglot e2e fixture | Status |
|---|---|---|---|
| JVM interop | java + groovy (+kotlin, scala when audited) | F7 project | GATED (java+groovy); kotlin/scala PENDING -> #384 |
| Web embedded | ts/tsx + js + html + css + vue/svelte + json | — | PENDING -> #384 |
| Web embedded (TS core) | typescript | vue-core@f8975657 (60 seeded files) | GATED: 100% coverage, 0.9% unexplained (1 duplicate-emission residual, tracked) |
| Mixed server | js/ts + python + json/yaml (ProxiCall shape) | ProxiCall as living corpus | PENDING -> #299 + #384 |
| .NET | csharp + fsharp | — | PENDING -> #384 |
| BEAM | elixir + erlang | — | PENDING -> #384 |
| Mobile | dart + swift + kotlin + objc | — | PENDING -> #384 |
| Systems | c + cpp + rust + go + zig | F9 systems-cluster (polyglot c/cpp/rust/go/zig project via real CLI) | GATED (M14.0.F9: symbols, imports, cross-language c→cpp edge verified) |

Issue back-references: Matrix 1b payloads -> #383; kotlin wasm fields -> #382;
cluster fixtures -> #384; overrides/contains/exports pins -> #381.
RULE: every ledger PENDING cell must cite a GitHub issue. An uncited PENDING
cell is itself a gate failure.

Owner directive recorded: real projects combine languages in unanticipated ways
(ProxiCall: flutter/dart + node + next.js + python). Cross-language resolution
is therefore name-based and language-agnostic by architecture — clusters are
for STRUCTURALLY embedded relationships only (vue template→ts, html→js/css).
No pair-map will ever be hardcoded.

## Matrix 3 — Per-analyzer seven stations (from wave issues)

Tracked per issue in plans/M14-issues.json / GitHub #245-#297:
grammar conformance · symbols · relationships · heuristic honesty · adversarial
fixtures · differential corpus · mutation hardening.
Done: java, groovy (stations 1-7; L5 pending owner spot-checks).
PENDING: remaining 39 analyzers.

## Matrix 4 — Grammar / WASM / version provenance per language

Owner directive: several languages have no official grammar; vendored community
grammars live in `grammars/` (user-improved). Analyzer audits MUST also check
grammar correctness (deadly-serious bugs only — AI-corrupting parses), wasm
provenance, and upstream version drift. Known vendored: tree-sitter-groovy
(amaanq 0.1.2, user-improved), tree-sitter-fsharp (vendored), tree-sitter-clean.

| Language | wasm source | grammar provenance | version pinned | drift checked |
|---|---|---|---|---|
| groovy | grammars/ build -> wasm/ | vendored amaanq 0.1.2 (improved) | YES | wave M14.1 done |
| fsharp | grammars/ build -> wasm/ | vendored | PENDING wave M14.5 | PENDING -> #382 |
| clean | grammars/ build -> wasm/ | vendored | PENDING wave M14.5 | PENDING -> #382 |
| all others | wasm/*.wasm (upstream builds) | upstream tree-sitter repos | PENDING per-wave -> #382 | PENDING -> #382 |

Standing sub-checks for every analyzer audit (added to seven stations):
8. grammar provenance + version recorded in evidence; upstream drift diffed
   (node-type deltas between pinned wasm and latest upstream release)
9. grammar-bug scan: parse corpus samples; ERROR-rate and wrong-tree shapes
   investigated; only AI-corrupting grammar bugs get fixed in-repo (fork policy)

## Matrix 5 — Tool-layer bug protocol (M15 boundary)

Co-agent owns tools/M15. When analyzer work hits a tool-layer bug:
(a) report to owner with evidence, or
(b) comment on the co-agent's M15 issue (or file new if absent), or
(c) if co-agent is not on that file: fix + verify + commit with explicit
    cross-agent note in the message.
Recorded so it is process, not memory.

## Matrix 3b — Owner review status (per language)

Rule: a language may reach L5 ONLY with at least one owner review round ON
THE POST-FIX STATE recorded here, plus the formal sign-off ritual. Agent
self-declaration of "done" is never sufficient (M13 lesson, re-learned).

| Language | Owner review rounds | Findings | Disposition |
|---|---|---|---|
| java | 2 (0765d36 + c044dff owner fix waves); delegated sign-off authorized 2026-08-28 | 6+ (FQ annotations, apiContractPath shadowing, varargs, compact ctors, permits, confidence tiering) | fixed + gated; delegated sign-off recorded in `docs/M14-JVM-WEB-DELEGATED-SIGNOFF.md` |
| groovy | 3 waves (73abae5, afdcdc4, 261c8a8 owner commits); delegated sign-off authorized 2026-08-28 | FQ annotations, class/field decorators, tiered overrides, framework detection D1/D2 | fixed + gated; delegated sign-off recorded in `docs/M14-JVM-WEB-DELEGATED-SIGNOFF.md` |
| kotlin | 3 waves (8c8e8b9, 2c62f1a, f51879d owner commits incl. wasm rebuild); delegated sign-off authorized 2026-08-28 | 5 defects + contract unification + silent misparse root-fix | fixed + gated; delegated sign-off recorded in `docs/M14-JVM-WEB-DELEGATED-SIGNOFF.md` |
| scala | 3 (dual-corpus wave + 2 review rounds); delegated sign-off authorized 2026-08-28 | isExtension dead flag, positional labels, dotted supertypes, column bases, unmeasured heuristic, synthetic complexity, orphaned comment | fixed + gated; delegated sign-off recorded in `docs/M14-JVM-WEB-DELEGATED-SIGNOFF.md` |
| typescript | 1 (b84cea5: 5 verified defects) + ongoing; delegated sign-off authorized 2026-08-28 | decorators/heritage/usage-pass/contract/ranges | fixed + gated; delegated sign-off recorded in `docs/M14-JVM-WEB-DELEGATED-SIGNOFF.md` |
| javascript | 2 (853f022: 8 defects; a00969e: 5 incl. 2 Tier-1); delegated sign-off authorized 2026-08-28 | barrel re-exports invisible, accessor-name collision, private methods, CJS chains | fixed + gated; delegated sign-off recorded in `docs/M14-JVM-WEB-DELEGATED-SIGNOFF.md` |
| vue | 2 waves (732e1dc dual-blocks/lang-dispatch/dedupe/metrics; 25fa235 script-setup contract/watch) + element-plus corpus 156/156 100%; delegated sign-off authorized 2026-08-28 | 7 defects incl. entire setup-block loss, lang dispatch, duplicate components, script-setup contract loss | fixed + gated; delegated sign-off recorded in `docs/M14-JVM-WEB-DELEGATED-SIGNOFF.md` |
| rust | 3 waves (dc08f9b: 4 dead literals, tiers #419-D, T1 complexity incl. match-arm calibration, qc payload, ::new receiver targets, deferred instantiation resolution, 0-based columns, visibility defaults; wave2: 185-type completeness contract A-H 8/8, 5 rust mutants, ripgrep 1948/1948 100% 0/0, use-list import module/items contract + wildcard, union_item + trait associated_type; wave3: awaited-call dedupe — one canonical calls edge per call site with isAwait metadata (raw await edge removed; it duplicated the edge AND used full function text as target), 6th+7th rust mutants, 8th fixture rust/use-list-imports (import contract pinned — differential derives no import truth, so fixture is the sole guard) | 12 defects: instantiation noise (90%+ unresolvable, deferred in-file contract), dead if_let/trait_bound literals, scoped enum-variant struct literals dropped (MatchStrategy::Suffix), turbofish whole-text call targets (cap.parse), parenthesized-closure (self.0) fabricated callee, union_item emitted NO symbol, trait associated_type invisible, oracle dead ctor branch (never derived ::new truth) + generic_function unwrap missing + in-file filter absent, broken use-list import extraction (module/items garbage, wildcard unhandled), awaited-call DUPLICATE edge (await branch pushed raw full-text-target edge + handleCallExpression pushed the canonical edge) | fixed + gated |
| c | 1 wave (this wave: metrics fake #5 cured, evidence tiers, qc payload, cast/call fix, goto de-counted) + `jq` corpus 1692/1692 100% | 8 defects incl. cast/call confusion (127 noise edges), malloc instantiates noise | fixed + gated |
| cpp | 1 wave (455ea1c: 256-type completeness contract A-H 8/8, 3 cpp mutants, fmt corpus 145/145 100% 0/0) + this review: reasonCode on signature-match overrides, cpp limitation surfacing in SPEC + systems-cluster gate: #include imports used the legacy {source, imported} shape and were NEVER persisted to brain_import (persister reads imp.module) — aligned to the family contract {module, items, metadata.isImport} and pinned in cpp/system-completeness expectImports | 5 defects: cross-file base leaf-name collision fabricated self-override (format_facet -> format_facet); include-edge metadata lacked family include_dependency/isImport labels; differential oracle LIFO param-name extraction (Send(message)->message) + macro-as-method (GTEST_DISALLOW_COPY_AND_ASSIGN_) fabricated override truth; cpp imports never persisted (legacy shape) | fixed + gated |
| go | 2 waves (7f68bae: return-type corruption — receiver/parameters captured as fake return types breaking parameterized implements; embedded-interface promotion lost (constraint_elem never emitted) causing false implements; embedded-struct method promotion absent; mirrored analyzer+oracle in lockstep; terraform corpus 1423/1423 + go-tools 822/822 both 0/0; implements-params fixture + 2 mutants; + f4c81d9-adjacent deep-review: none) | 3 defects: extractGoReturnType/extractGoMethodSpecReturnType scanned parameter_list (receiver/params as fake return type); embedded interfaces parsed as constraint_elem never emitted (promoted Read lost, false implements); embedded-struct method promotion missing (Worker impl Runner via *Shape) | fixed + gated |
| zig | 2 waves (2d3909d: family-standard build — calls/uses/references/complexity/evidence-tiers from zero, (global) source for top-level/comptime/test call sites (745 measured lost edges), same-named method call guard removed, dead node literals removed (boolean_literal/char_literal/number_literal/type_identifier/return_type/orelse_expression), differential oracle + registration, zig:zig 3731/3731 0/0, completeness spec 96 types A-H 8/8, fixture + 4 mutants; f4c81d9 final deep-review: expression-form complexity (if_expression/for_expression/while_expression + anonymous else token), binary substring trap (x + standard + order false +2), var globals Variable not Constant, generic type-app base refs (MyList(u32) -> MyList; builtin arg shadowing lost them), enum members no phantom refs; + this closure: 1-based columns (was 0-based, caught by M14.CC1 systems gate) | 10 defects: no calls/uses/references/complexity/tiers at all; top-level call sites dropped; same-named method calls lost; 6 dead node literals; expression-form complexity uncounted; substring-trap false counts; var globals mislabeled constant; generic base refs lost; enum-member phantom refs; 0-based columns | fixed + gated |
| svelte | 3 waves (d7784bf tiers/metrics/columns/dispatch; 7dcd251 + #419 A/B/C; this review: S5/S6 lexical-shadow and reactive-dedupe hardening) + `svelte` repo corpus floors true 0/0; delegated sign-off authorized 2026-08-28 | 13 defects total (including oracle type_arguments over-derivation, LIFO block-index inversion, render_tag opaque text, each/const scope collision, repeated `$:` target duplication) | fixed + gated; #419 A/B/C closed at fixture level; delegated sign-off recorded in `docs/M14-JVM-WEB-DELEGATED-SIGNOFF.md` |

Delegated JVM/web sign-off (2026-08-28): the owner authorized the agent to sign on the owner's behalf. The tracked record is `docs/M14-JVM-WEB-DELEGATED-SIGNOFF.md`; supporting spot-check packs remain in `.probe/m14/`. This is delegated verification, not a claim of personal owner execution.

Delegated systems sign-off (2026-08-29): the owner authorized the agent to work on the systems-family closure. The tracked record is `docs/M14-SYSTEMS-DELEGATED-SIGNOFF.md` for issues #259–#263 (c/cpp/rust/go/zig). Family gates supporting it: M14.0.F9 systems-cluster e2e, family differential floors (jq/fmt/ripgrep/go-tools/zig all 0/0), completeness A–H 8/8 for all five, CC1 systems consistency. This is delegated verification, not a claim of personal owner execution.

Svelte review hardening (2026-08-28): two adversarial defects were found after
the prior CONFORMANT claim. S5 was a real scope-collision leak: each-loop
bindings were not registered, and `{@const}` bindings were not propagated in
declaration order. S6 was duplicate `$:` reactive-target symbols. New
 fixtures failed before their fixes and pass after them: 18/18 Svelte fixtures,
 all-language fixture regression pass, and focused S5/S6 mutants both CAUGHT.
The prior full mutation evidence was not rerun to completion in this session;
therefore no fresh 109/109 claim is made here. The existing 107/107 evidence
plus the two focused catches is the honest current state. Owner spot-check
sign-off remains pending per §5.6.

Sign-off ritual: delegated owner authorization is recorded for issues #251–#258 in `docs/M14-JVM-WEB-DELEGATED-SIGNOFF.md`. The record preserves the distinction between delegated verification and personal execution; no personal execution is claimed.

## Matrix 4b — Completeness specification (#419)

Root cause of every missed item this milestone: coverage was bounded by
agent imagination — nothing defined what each analyzer MUST emit. Gates
verify what exists; absence was invisible by construction.

Fix: grammar-derived completeness inventory per language. The tree-sitter
grammar enumerates every declaration/expression/statement form; the spec
table maps each to required emissions; adversarial fixtures exercise every
item; the diff produces the numbered gap list.

Status: issue #419 filed, java pilot first. All open L5 issues (#251–#291)
require spec conformance before L5 (banner pending). Spec conformance is
now the DEFINITION of done — retroactively binding on all wave issues.

Java pilot progress (2026-08-26): inventory machinery live —
`script/m14/completeness-inventory.ts` + `spec/java-completeness.json`
classify ALL 143 pinned tree-sitter-java node types mechanically
(70 handled_verified, 60 internal_silent). Wired into `npm run verify`
as `audit:completeness`; evidence `M14.0.SPEC.json`.
Gap closure (owner-approved, fixture-first ritual):
- G1 array_access → Uses edge (fixture java/array-access-uses, mutant
  java/drop-array-access CAUGHT)
- G2 explicit_constructor_invocation → Calls edge (fixture
  java/ctor-delegation, mutant java/drop-ctor-delegation CAUGHT)
- G3 record_pattern → References edge (fixture java/record-pattern-refs,
  mutant java/drop-record-patterns CAUGHT)
- G4 calls in initializers/field-init/enum bodies → Calls edge attributed
  to enclosing type (fixture java/initializer-calls, mutant
  java/drop-initializer-calls CAUGHT)
Rulings (owner-approved 2026-08-26): G5 module-info DECLARED OUT OF
SCOPE; G6 generic type bounds DECLARED LIMITATION; S1 java-spec-table
corrected (throw/assert/try-with-resources removed from complexity).
Java fixtures now 31; mutation suite 54/54 caught (java 11 + groovy 13 + kotlin 14 + others).

Kotlin #419 wave (2026-08-27, owner-approved gap list K1-K8 / rulings S1-S6):
- K1 indexing Uses (indexing-uses fixture; kotlin/drop-expression-uses CAUGHT)
- K2 ctor delegation Calls (ctor-delegation; kotlin/drop-ctor-delegation CAUGHT)
- K3 callable-reference refs (callable-refs; kotlin/drop-callable-refs CAUGHT)
- K4 string-template Uses (template-uses; kotlin/drop-expression-uses CAUGHT)
- K5 typealias symbols + RHS refs (type-alias; kotlin/drop-type-alias-symbols + drop-type-alias-refs CAUGHT)
- K6 anonymous objects: symbol (anonymous_<Supertype>, noise-filtered), member attribution fix (no more P->go misattribution), object_literal type reference — hierarchy edges intentionally NOT emitted for expression-types (the object_literal References edge is the type channel; the differential oracle agrees)
- K7 init-block/property-initializer call attribution (init-attribution; kotlin/global-attribution CAUGHT)
- K8 import tier mislabel (import-edges; kotlin/reclassify-import-tier CAUGHT)
Rulings S1-S6 recorded in kotlin-completeness.json (S1 companion limitation, S2 accessors, S3 destructuring, S4 lambdas, S5 exports NOT EMITTED, S6 modifiers). Kotlin fixtures now 38; kotlin added to GATED_LANGS.

### Per-language #419 status (state lives in the ledger, never in conversation)

A language is CONFORMANT only when the completeness gate runs in `npm run
verify` AND all eight A–H sections pass mechanically (evidence M14.0.SPEC,
sections object). Re-auditing a language whose row is CONFORMANT with a
green gate is waste — the row says so. Statuses: NOT-STARTED /
INVENTORY-DONE / GAPS-CLOSED / CONFORMANT.

| Language | #419 status | A | B (11 kinds) | C (payloads) | D (tiers) | E (differential) | F (perf) | G (docs) | H (CC1) |
|---|---|---|---|---|---|---|---|---|---|
| java | CONFORMANT (2026-08-26) | 143/143 types | 11/11 (imports pinned via java/import-edges + mutant) | 7/7 Matrix 1b rows (parameters pinned via java/parameters-payload + mutant) | 2 tiers | grails-core 100%/0% | 7.9 ms/file | java.md + real-java-analyzer.md | 3/3 checks |
| groovy | CONFORMANT (2026-08-27, owner-approved plan; second reference implementation) | 151/151 types | 9/9 (contains-edges + import-edges pins) | 7/7 (parameters-payload incl. varargs) | 3 tiers (structural, import_based, usage_contextual) | grails-core 100%/0% | 7.5 ms/file | groovy.md + real-groovy-analyzer.md | 3/3 checks |
| kotlin | CONFORMANT (2026-08-27, owner-approved plan; third reference implementation) | 152/152 types | 9/9 (instantiates-edges + import-edges pins) | 7/7 (kdoc comment pin, visibility-payload, parameters-payload) | 3 tiers (structural, usage_contextual, import_based) | Exposed:kotlin 100%/0% (floor residuals were ORACLE defects — fixed in differential.ts) | 25.5 ms/file | kotlin.md + real-kotlin-analyzer.md | 3/3 checks |
| scala | CONFORMANT (2026-08-27, owner-approved plan; fourth reference implementation — JVM family terminal) | 189/189 types | 11/11 (implements-edges + import-edges pins, both halves of G1) | 7/7 (visibility-payload, parameters-payload incl. repeated params) | 3 tiers (import_based, structural, usage_contextual) | scala3:scala 100%/0% (floor unchanged by the wave; pinned at sample 60) | 9.2 ms/file | scala.md + real-scala-analyzer.md | 3/3 checks |
| typescript | CONFORMANT (2026-08-27, owner-approved plan; first web-family reference implementation) | 191/191 types | 10/10 (contains-overrides + exports-edges + import-edges pins) | 7/7 (generic-constraints typeParameters, visibility-payload, parameters-payload) | 3 tiers (structural, usage_contextual, import_based) | vue-core:typescript 100%/0% (floor verified; ledger 0.9% note stale) | 95 ms/file | typescript.md + real-typescript-analyzer.md | 3/3 checks |
| javascript | CONFORMANT (2026-08-27, owner-approved plan; second web-family reference implementation) | 125/125 types | 9/9 (instantiations + contains-overrides + import-edges pins) | 6/6 (visibility-payload, parameters-payload) | 3 tiers (structural, usage_contextual, import_based) | lodash:javascript 100%/0% (floor unchanged by the wave) | 193.7 ms/file | javascript.md + real-javascript-analyzer.md | 3/3 checks |
| vue | CONFORMANT (2026-08-27, owner-approved plan; third web-family reference implementation) | 37/37 types | 9/9 (script-relations pins + generic-props-emits + template-member-uses; expectRelationshipCount added — dedupe is now a permanent gate class) | 3/3 (payload-pins: complexity/visibility/parameters) | 3 tiers (structural, usage_contextual, import_based) | vue-core:vue 100%/0% (floor unchanged by the wave) | recorded in baseline | vue.md + real-vue-analyzer.md | 3/3 checks |
| svelte | CONFORMANT (2026-08-27 baseline; S5/S6 review hardening verified 2026-08-28) | 74/74 types | 9/9 (relationship-kinds pins all kinds; S1 template-uses pin; S5 collision fixture adds scope coverage) | 3/3 (payload-pins complexity + relationship-kinds parameters/visibility; S6 reactive-dedupe adds symbol-count coverage) | 3 tiers (structural, usage_contextual, import_based) | svelte:svelte 100%/0% (floor unchanged) | recorded in baseline | svelte.md + real-svelte-analyzer.md | 3/3 checks |

Java is the reference implementation: the first analyzer to be L5-closed
(#251) AND completeness-gated under #419. Its per-section evidence lives in
`validation/m14/results/M14.0.SPEC.json` (sections object) and is
regenerated + re-verified on every `npm run verify` run.

B-section closure note (2026-08-26): the imports relationship kind was the
last unpinned kind — the edge existed but no fixture guarded it, and a
static-import (import static ...) lost its isStatic flag on the edge
metadata (only the symbol-level imports entry carried it). Fixed
fixture-first: java/import-edges authored from JLS 7.5 semantics (single /
wildcard / static forms, full dotted targets), proved failing on the
missing isStatic, one-line analyzer fix, mutant java/drop-import-edges
CAUGHT.

#383 Matrix 1b parameters pin (2026-08-26): java's parameters (+defaults)
cell was PENDING -> #383 — the payload existed but nothing guarded it, and
the fixture runner had no parameter matcher. Added expectParameters to
run-fixtures.ts; java/parameters-payload authored from JLS 8.4.1 semantics
(names + types, varargs as String[] per erasure convention, generic
types kept full), passes on first run (correct-but-unpinned), mutant
java/drop-parameters CAUGHT. Section C now verifies 7 Matrix 1b rows for
java; groovy's parameters cell remains PENDING -> #383 for its own wave.

Evidence-tier finding (2026-08-26, F7 rule): the shared tier taxonomy
labels import-derived edges import_based (groovy does this correctly),
but the classifier conditions only recognized isGroovyImport/isImport —
java (isJavaImport), kotlin (isImportDep) import edges were all mislabeled
reference_qualified. Java FIXED + GATED: java/import-edges expectation
corrected to import_based (authored from the taxonomy), proved failing,
one-line classifier fix, mutant java/reclassify-import-tier CAUGHT
(29/29). Kotlin CLOSED during its wave (2026-08-27): kotlin/import-edges
fixture + one-line classifier fix (isImportDep recognized) + mutant
kotlin/reclassify-import-tier CAUGHT — and the completeness gate's own
section-B imports detection had the SAME blind spot (only
isJavaImport/isGroovyImport/isImport), fixed to recognize isImportDep.
Scala remains a CONFIRMED finding for its wave (fix + fixture pin land
together, per the standing rule that a bug class becomes a permanent gate
before its fix counts as landed).

Differential-oracle defects found during the kotlin wave (2026-08-27, F7
rule — the second opinion is itself audited): (1) tree-sitter-kotlin
parses `interface X : Y` as class_declaration with an UNNAMED `interface`
keyword child, so the oracle's isInterfaceDecl check never fired and every
kotlin interface was mislabelled implements (the analyzer emitted
extends) — a permanent MISSING+UNEXPLAINED pair per interface;
(2) dotted supertypes (class Builder : DatabaseConfig.Builder()) were
truncated to the first identifier (DatabaseConfig), fabricating an
unmatched oracle edge. Both fixed in script/m14/differential.ts;
Exposed:kotlin floor improved 1 missing + 1 unexplained -> 0 + 0
(100%/0%). Section E now reads the pinned differential-baseline.json
floor row (perfKey) instead of the last-run snapshot, so a language whose
floor repo isn't the sweep's grails-core run (kotlin -> Exposed) is
verified honestly.

Single-source-of-truth cleanup (2026-08-26): script/m14/spec/ previously
held TWO classification artifacts — the live java-completeness.json (the
gate's source) and the superseded java-type-classification.json (the
co-agent's early classification, zero references), plus the prototype
generator java-inventory.ts and its dump java-nodetypes.json (also zero
references). Removed all three; the spec dir now holds exactly one
classification and the spec table. Git history preserves the originals.

Groovy inventory (2026-08-26, harness generalized per #419 acceptance 4):
completeness-inventory.ts is now language-config driven (java + groovy;
`--lang <id>` selects, default runs the gated set). Groovy: 151 unique
named node types fully classified (68 handled, 58 internal_silent),
G1-G8 confirmed by live probes (array_access Uses; explicit ctor Calls;
pattern type refs; method_reference ref; cast ref; record_declaration
symbol; annotation_type_declaration symbol; imports pin), S1-S5 rulings
pending (gstring Uses; JPMS never-reachable; exports/apiContractPath NOT
EMITTED; parameters pin). Section state: A/E/F/G/H pass; B (contains +
imports unpinned), C (parameters), D (0 tier pins) fail — declared work
items. Gap list reported to owner before ANY fix (contract, acceptance 2).

Kotlin inventory (2026-08-27): 142 unique named node types fully
classified (67 handled, 44 internal_silent), K1-K8 confirmed by live
probes (indexing Uses; ctor-delegation Calls; callable_reference ref;
template identifier Uses; type_alias symbol; object_literal type ref +
override misattribution; init/field-init call source "Global"; import
tier mislabeled — isImportDep unrecognized, the kotlin/scala finding from
java's pass). S1-S6 rulings pending (companion/accessors/destructuring /
lambdas/modifiers internal_silent; exports NOT EMITTED). Section state:
A/F/G/H pass; B (instantiates + imports unpinned), C (docstrings /
visibility / parameters pins), D (0 tier pins), E (Exposed:kotlin 1
missing + 1 unexplained residual — floor not met) fail as declared work
items. Gap list reported to owner before ANY fix (contract, acceptance 2).

### #419 acceptance status (java pilot, 2026-08-26)

1. Generator produces complete inventory from grammar — DONE (143/143
   types, `script/m14/completeness-inventory.ts`)
2. Gap list printed and reviewed by owner BEFORE fixes — DONE (G1-G4 list
   reviewed; fixes followed)
3. Gaps closed with fixture-gated fixes OR declared limitations — DONE
   (G1-G4 closed fixture-first + mutants; G5/G6/S1 ruled)
4. Spec re-runs permanently in `npm run verify` — DONE (`audit:completeness`
   + A–H sections; future analyzers inherit via per-language status table)
5. Replicate for remaining languages — PENDING (their waves, one at a time)
6. All L5 issues (#251–#291) gain "L5 requires spec conformance" banner —
   DONE (37 open issues #255–#291 updated 2026-08-26; closed #251–#254
   untouched per closed-stays-closed)

Java pilot complete except replication (item 5, which is the other
languages' work by design).

### #419 section definition — the eight mandatory judgments per language

A language closes #419 only when ALL sections are satisfied:
A. Structural completeness (grammar inventory vs emissions)
B. Every relationship kind verified (11 kinds incl. permits)
C. Payload matrix complete (Matrix 1b rows)
D. Evidence tiers on every edge
E. Corpus differential baselined at floor
F. Perf budget recorded + respected
G. Docs truthful
H. Cross-language consistency

No partial closure. "Future work" absorption is banned by Matrix 3b/4b rules.

### Dotted-name convention — RATIFIED (owner decision)

All analyzers emit FULL DOTTED NAMES as relationship targets when types are
qualified (`collection.mutable.ArrayBuffer`, not `ArrayBuffer`). Rationale:
full path carries more information (last segment always extractable; path
cannot be reconstructed from segment alone). Cross-language consumers must
normalize via lastSegment() when comparing. Applied to java, groovy, kotlin,
scala uniformly.

## Standing rules

1. Every bug class found anywhere becomes a permanent gate before its fix lands (F7 rule).
2. PENDING cells are work items, not shame — silent gaps are the shame.
3. Wave closure requires no PENDING cell in its dependency path.
4. Owner spot-checks (contract §5.6) remain the final closure authority for every issue.

## Perf baselines (2026-08-23, grails-core groovy subsets, this machine)

| Scale | Duration | Marginal |
|---|---|---|
| 100 files | 10.4s | — |
| 200 files | 15.8s | 54 ms/file |
| 400 files | 22.1s | 31 ms/file |
| single 3,152-line file | parse 154ms + analyze 87ms | deterministic |

F9 IMPLEMENTED (per-analyzer budgets, differential harness): avg ms/file
recorded per language per repo into differential-baseline.json; gate fails on
>3x own baseline or >3x cross-language median. First recorded budgets:
java 12.3 ms/file, groovy 8.8, scala 10.6, kotlin 54.2 on Exposed (OUTLIER -
flagged for investigation under #385-family; budget passes at current margin).
100k+-file scaling: UNTESTED (declared).

JavaScript (M14.2): 10/10 fixtures GATED; field-access uses collector ADDED (parity gap - analyzer had none); vue-core corpus shared with TS.
JS update: payload-docs fixture GATED (JSDoc class+method); qualified_calls declared NOT EMITTED (#383); graphql-js differential 100%/0% baselined; 2 JS mutants added (11 total).
