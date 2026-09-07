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
| rust | 5 waves (dc08f9b: 4 dead literals, tiers #419-D, T1 complexity incl. match-arm calibration, qc payload, ::new receiver targets, deferred instantiation resolution, 0-based columns, visibility defaults; wave2: 185-type completeness contract A-H 8/8, 5 rust mutants, ripgrep 1948/1948 100% 0/0, use-list import module/items contract + wildcard, union_item + trait associated_type; wave3: awaited-call dedupe — one canonical calls edge per call site with isAwait metadata (raw await edge removed; it duplicated the edge AND used full function text as target), 6th+7th rust mutants, 8th fixture rust/use-list-imports (import contract pinned — differential derives no import truth, so fixture is the sole guard); wave4 = M37 #603 (2026-09-05, cargo 1373 + ripgrep 110 corpus census): RSD1 qualified_calls bare-name pollution fixed by DIRECT per-symbol attach (410 buckets / 1,313 symbols / 749 excess — 21 deserialize methods shared one payload), RSD2 whole-file error suppression removed (519 error files / 4,620 fns lost payloads — payload now survives single-token ERROR recovery), RSD3 symbol-id uniqueness (struct + impl blocks all id 'Foo': 2,852 duplicates / 271 files → deterministic #N suffixes), RSD4 macro invocations reach the payload as macro:name (payload == emitted call set); runner + expectUniqueIds assertion + expectErrors reads metadata.errors too; wave5 (post-close re-review, same wave): RSD5 assignment-LHS field writes no longer emit uses (1,076 bogus edges — span-compare write-gate, cpp/ruby lesson class), RSD6a nested-group use bindings no longer dropped (65 decls: std::{env, io, path::{Path, PathBuf}} now binds Path/PathBuf), RSD6b top-level group use imports no longer fabricate joined-item modules (28 decls → per-binding rows); runner expectImports comments are documentation (not constraints); RSD7 (perf + frameworks re-review wave): detectedFrameworks only caught actix route macros — serde/tokio/thiserror/tracing/clap/axum/rocket attribute detection added (family contract, name-scoped so std derives can't false-positive; corpus sanity over cargo+ripgrep 1,481 files = serde 55 / thiserror 10 / tracing 29, zero garbage; perf verified clean — weak_dep_features.rs 16 ms and doc.rs 89 ms repeats stable, the 313-366 ms scan readings were contention artifacts) | 12 defects + RSD1-7 (payload cross-type merge, whole-file error payload wipe, duplicate impl/type symbol ids, macro calls absent from payload, field-write uses leakage, nested/top-level group import loss + fabricated modules, framework-blind attribute detection) | fixed + gated (RUST-D4..D11 recorded); fixtures 10/10 rust (14 rust mutants incl. RSD7 framework-detection mutant, 265 total caught), differential-rust floor unchanged (100% / 0.1% unexplained @60), F1/F2/F3/F4/F5/F6/F7/F8/F9/SPEC/CC1/honesty green |
| c | wave1: metrics fake #5 cured, evidence tiers, qc payload, cast/call fix, goto de-counted. wave2 = M37 #601 Holy C (2026-09-05, deep dual-lens): ERROR-glue discriminator CGD19 (glued-span artifacts suppressed, real os_win/jimsh0 fnDefs kept, prototype exemption), CGD25 bare-fd glue names, order-independent declaredNames + fnDef-name admission (CGD36), typedef-alias type_identifier fix (references class), type-only `uses` suppression (CGD33) + field-callee leaf `uses` suppression (CGD31) + object-leaf fix, cast-type re-route vs cast-value uses (CGD28) with operand discriminator, designated-initializer write-gate (CGD27), macro-qualified struct phantom FUNCTION symbols killed (CGD38), SQLITE_WSD phantom value-read suppression (CGD34), fn-pointer typedef chains (CGD30), F7 hygiene: three web-tree-sitter object-identity antipatterns converted to position comparisons (isGlueFdName alive, oracle isBareFdGlueName closed positionally — s3jni_config_log fabrication removed), CGD12 plain-identifier type positions re-routed to references | 8 defects wave1 (cast/call confusion 127 noise edges, malloc instantiates noise) + CGD31–38 classes (callee-field uses, type-only uses, field-object reads, cast operand confusion, designator-name uses, drop-typedef-references, fn-value-before-def, phantom function symbols, glue-name asymmetry) | fixed + gated: fixture cgd31-37-regressions pins CGD31-38, 10 c mutants (251/251 total), sqlite:c 100% covered / 9 missing / 105 unexplained + jq:c 99.9% / 4 / 28 @60 — RECORDED residual floor C-D4 (macro-mangled generated amalgamation files, C-D2 boundary), SPEC 160 types A–H 8/8, honesty gate green |
| cpp | wave1 (455ea1c) + wave2 = M37 #602 dual-lens (2026-09-05): line-by-line read + corpus census (fmt 73 files: 8,684 syms / 27,256 rels), dedicated deriveCppEdges oracle (calls + member-read uses truth — previously NO calls/uses/instantiates/overrides label was ever compared; fmt 0/0 was vacuous over ~145 extends truths only), fmt sample cc→cc,h; wave3 = M37 #602 DEEP review (2026-09-05): fresh full read surfacing symbol-surface defects the oracle cannot see (payload/keying/scope classes) + callee-leaf corruption at 855 scale | 16 defects: wave2 CPPD1 (template-spec → anonymous class, 255), CPPD2/3 (member-write uses, temp-read drop), CPPD5 (name-in-signature override loss — 22 pairs), CPPD6 (recovery-new garbage), CPPD8 (leading-:: new) + oracle overrides fabrication + overrides RULED not derivable; wave3 CPPD9 (ctor-body calls sourced to the CLASS symbol + qc payload never reached the ctor — 532 calls/272 class qc payloads), CPPD10 (post-loop qc merge keyed by bare name — Alpha.run/Beta.run cross-pollution, 192 names/640 owners), CPPD11 (virtual registry last-sig-wins — first-declared overload override silently dropped), CPPD12 (using-declarations emitted legacy {source,imported} imports — never persisted, the C #include class missed for using), CPPD13 (callee leaf corrupted by template args m<int>/func<int>, nested :: chains, template-keyword dependent_name, defense-parens, functor-temp std::forward<F>(f)(args), ptr-to-member ->* — 855→0 leaky/junk targets) | fixed + gated: 6 cpp fixtures pass (new ctor-and-overload-regressions pins CPPD9-11/13; system-completeness pins CPPD12 using imports + CPPD8), 257/257 mutants (6 cpp deep-review mutants added), fmt:cpp @200 4,751-truth floor 100%/0/0 (junk removed from both sides in lockstep), @60 4,298-truth 0/0, F1 cpp clean 0 unknowns, F6 21/21 (144+ fixture types, 0 dead literals), SPEC A-H 8/8 (CPP-D4..D14 recorded incl. D10-14 deep-review rulings), F7/F9/honesty green |
| go | 2 waves (7f68bae: return-type corruption — receiver/parameters captured as fake return types breaking parameterized implements; embedded-interface promotion lost (constraint_elem never emitted) causing false implements; embedded-struct method promotion absent; mirrored analyzer+oracle in lockstep; terraform corpus 1423/1423 + go-tools 822/822 both 0/0; implements-params fixture + 2 mutants; + f4c81d9-adjacent deep-review: none; M37 #604 dual-lens wave (2026-09-05, go-tools 1931 + terraform 1993 = 3,924 files): GOD4 selector field WRITES emitted uses — 5,202 write-only (fn,field) bogus edges, family write-gate added (assignment-statement LHS + inc/dec = write; chained operand reads kept; ~5.2k edges removed corpus-wide); GOD4 interface embedding (`interface { Reader; io.Closer }`) had no extends (156 sites) — go_interface_embedding extends to type leaf, java/rust superinterface parity, oracle mirrored; GOD6 composite-literal construction emitted NO instantiates (65,843 literals!) — new go_composite_literal_construction pass (rust struct-literal / csharp new parity; stored package closures not descended), oracle mirrored; GOD5 implements gaps (6 MISSING @200): only isStruct implementors checked (func/slice types like HandlerFunc/subcommands missed), raw-text named-result signature mismatch (`(result any, err error)` vs `(any, error)` — defaultHandler), generic receivers MapLattice[K,E,L] orphaned, oracle over-claimed function-local + generic-instantiation pairs — implementors now Struct+Type, results reduced to canonical types, receivers strip `[`, oracle package-scope-only + generic-pair skip both sides; unused `$1` guard literal removed | 3 defects + GOD4-6 (field-write uses leakage, interface-embedding extends gap, composite-literal construction gap, non-struct/generic/named-result implements gaps, closure-descent over-reach) | fixed + gated (GOD4-6 recorded); fixtures 3/3 go (go fixtures gained write-gate forbids + read pins, interface-embedding extends pin, composite-literal instantiates pins, RunnerFn/HandlerImpl/Box pins; 6 new go mutants incl. drop-composite-construction, func-type-implementors-dropped, generic-implements-fabricated -> 271 total caught); M37 #604 wave-2 (2026-09-06): GOD7 framework detection was differential-invisible + unpinned (RSD7 lesson) — import-path detection verified genuine on 3,924 files (net_http 86 / grpc 50, zero false positives), new framework-detection fixture pins exact set [gin, net_http, gorilla_mux, grpc] + go/drop-framework-detection mutant (272 total caught); perf scan across both corpora linear (9-13 us/node on large files, no super-linear pass), fixtures 4/4 go; M37 #604 wave-3 (2026-09-06): GOD8 channel-op uses were differential-invisible + unpinned — raw-text targets (dotted h.jobs, ctx.Done(), bare locals = 327) and no dedup (79 dup rows); now leaf-targeted + deduped, declared channels only (pkg-var/member), locals/call-results silent; type-usage-graph pins + go/reemit-dotted-channel-uses mutant (273 caught; GOD9 qualified_calls payload dedup (29,463 excess rows, 4,719 dup symbols -> 0; rust #383 unique-set lesson) — countEquals s.startWork:1 pin + go/duplicate-qualified-calls mutant (274 caught)), differential go-tools:go @200 = 3,392 truth 100%/0/0 + terraform @120 = 2,737 truth 100%/0/0, F1/F2/F3/F4/F5/F6/F7/F8/F9/SPEC/CC1/honesty green |
| zig | 2 waves (2d3909d: family-standard build — calls/uses/references/complexity/evidence-tiers from zero, (global) source for top-level/comptime/test call sites (745 measured lost edges), same-named method call guard removed, dead node literals removed (boolean_literal/char_literal/number_literal/type_identifier/return_type/orelse_expression), differential oracle + registration, zig:zig 3731/3731 0/0, completeness spec 96 types A-H 8/8, fixture + 4 mutants; f4c81d9 final deep-review: expression-form complexity (if_expression/for_expression/while_expression + anonymous else token), binary substring trap (x + standard + order false +2), var globals Variable not Constant, generic type-app base refs (MyList(u32) -> MyList; builtin arg shadowing lost them), enum members no phantom refs; + this closure: 1-based columns (was 0-based, caught by M14.CC1 systems gate) | 10 defects: no calls/uses/references/complexity/tiers at all; top-level call sites dropped; same-named method calls lost; 6 dead node literals; expression-form complexity uncounted; substring-trap false counts; var globals mislabeled constant; generic base refs lost; enum-member phantom refs; 0-based columns | fixed + gated |
| svelte | 3 waves (d7784bf tiers/metrics/columns/dispatch; 7dcd251 + #419 A/B/C; this review: S5/S6 lexical-shadow and reactive-dedupe hardening) + `svelte` repo corpus floors true 0/0; delegated sign-off authorized 2026-08-28 | 13 defects total (including oracle type_arguments over-derivation, LIFO block-index inversion, render_tag opaque text, each/const scope collision, repeated `$:` target duplication) | fixed + gated; #419 A/B/C closed at fixture level; delegated sign-off recorded in `docs/M14-JVM-WEB-DELEGATED-SIGNOFF.md` |

Delegated JVM/web sign-off (2026-08-28): the owner authorized the agent to sign on the owner's behalf. The tracked record is `docs/M14-JVM-WEB-DELEGATED-SIGNOFF.md`; supporting spot-check packs remain in `.probe/m14/`. This is delegated verification, not a claim of personal owner execution.

Delegated systems sign-off (2026-08-29): the owner authorized the agent to work on the systems-family closure. The tracked record is `docs/M14-SYSTEMS-DELEGATED-SIGNOFF.md` for issues #259–#263 (c/cpp/rust/go/zig). Family gates supporting it: M14.0.F9 systems-cluster e2e, family differential floors (jq/fmt/ripgrep/go-tools/zig all 0/0), completeness A–H 8/8 for all five, CC1 systems consistency. This is delegated verification, not a claim of personal owner execution.

Delegated ManagedOO sign-off (2026-08-31): the owner authorized the agent to work on the ManagedOO-family closure. The tracked record is `docs/M14-OO-DELEGATED-SIGNOFF.md` for issues #264 (csharp + dart), #266 (swift), #267 (objc), #268 (php), and the ruby family tail. Family gates supporting it: six family differential floors (powershell:csharp 1366, proxicall:dart 1620, swift-nio:swift 1935, Clyde:objc 207, phpunit:php 834, rake:ruby 1174 — all 100% covered / 0 missing / 0 unexplained), completeness A–H 8/8 for all six, 38 ManagedOO mutants caught (172/172 total), CC1 OO consistency (ranges/kinds/complexity), F3 fixture evidence restored to full 20-language coverage. The closure deep review found and fixed a REAL family defect: objc + swift emitted 0-based columns (all other gated analyzers are 1-based) — fixed in both analyzers and permanently pinned by the new `oo-ranges-1based` CC1 check. This is delegated verification, not a claim of personal owner execution.

Haskell wave (#271, 2026-09-03): first language of the FP/academic family, one-analyzer-at-a-time per the standing convention. F1 grammar audit: 9 dead literals removed (identifier/varid/qconid/tycon/type_constructor/type_name/class_name/export_list/signature_type — none exist in the pinned tree-sitter-haskell grammar). Analyzer defects fixed and probe-verified on real corpus shapes: HSD1 backtick calls (infix_id) emitted no edge; HSD2 `$` application (Haskell's most common idiom) emitted no call; HSD3 operator definitions symbolized by whole head text; HSD4 parametrized instance targets (`instance Sized [a]` → `[]`) dropped; HSD5 record construction in body position (not update) emitted no instantiates; HSD6 where/let-local nullary binds leaked attribution to the enclosing function; HSD9 do-bind exit wiped currentFunction for 2nd+ binds of the same do-block; HSD10 do-bind-hosted inner-do let-functions pruned from the prepass declared set (cabal ProjectPlanning addPaths class); expression-position `(e :: T)` inline annotations fabricated declarations (fromIntegral). Family contract added: per-symbol complexity + evidence tiers (#419-D). Differential oracle built (extends via superclass context, implements via instance/deriving incl. parens single-element form, constructor-head instantiates with pattern-position gate, backtick/`$`/qualified calls); cabal:haskell floor pinned at 60/lang — 100% covered / 0 missing / 0 unexplained (3097 truth edges at sample 200). Fixtures: payload-and-complexity authored from probed behavior incl. adversarial negatives (record update, data-decl records, pattern-variable leaks). Gates: 5 haskell mutants CAUGHT (181/181 total), F6 haskell 49/49 spec-handled types fixture-covered, 0 dead literals (spec note: `inferred` is the evidenceClass string, not a grammar node), SPEC 253 types A–H 8/8, F3 all 21 languages pass. Evidence: M14.0.F1–F6, M14.0.SPEC, M14.CC1, honesty gate — all regenerated and green.

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

Haskell re-review wave (2026-09-03): corpus-expanded re-review (shellcheck,
hledger, postgrest added to cabal — 392 new files) exposed 8 defect classes
the gates could not see because the differential oracle mirrors the analyzer
(HSD11–HSD19: standalone deriving, pattern-position fabrication via
alternative/guard/record-head paths, qualified-constructor loss, expression
signature-annotation call loss, element-wise deriving entries, unnameable
function heads). All fixed with probe-verified parse shapes, mirrored in the
oracle; fixture extended (pins+forbids per class) and 4 mutants added — a
same-day regression (deriving parens recursion) was caught by the new fixture
pins, proving the hardening works. All 4 corpora 100%/0/0; 185 mutants
caught; F1–F6+SPEC+CC1+honesty green. Grammar pinned at v0.23.1 (upstream
rewrite unreleased — migration trigger recorded in issue #271).

Csharp re-review wave (2026-09-04): first OO backfill with the dual-lens
method (corpus census + full analyzer read). Census: 105 unreferenced node
types in 400 real powershell files. Reading caught what the census could not
(dead no-op statement, side-variable scope never pushed, mvcPattern flag
nothing reads); census quantified what reading underestimated (switch
expression arms, member-binding reads). 10 defect classes fixed (CSD1-CSD10:
file-scoped FQN desync, switch-arm complexity, operator-name collapse,
null-conditional reads, accessor events, alias-using capture,
constructor-initializer calls, primary-base argument leakage, file-scoped
scope lifetime), each probe-verified, oracle mirrored where compared. Fixture
pins+forbids per class; 5 new mutants; 190/190 caught; floor re-pinned 100%/0/0.
Process lesson recorded: pins authored against broken emission "pass" while
both sides are wrong — pins must be re-authored from re-probed emission after
every fix (caught CSD10's over-firing guard exactly this way).

Csharp claim-validation wave (2026-09-04, same day): the OWNER read the code
and surfaced two suspects. Validation verdicts, both probe-tested on real
parses before any fix: (1) "field target-typed new() silently dropped" —
REFUTED as stated: the exact quoted shape `private List<int> _items = new();`
emits correctly (the resolver's variable_declarator branch fires BEFORE the
field_declaration early return, making that early return unreachable dead
code — the owner's "intentional early-return never revisited" diagnosis was
right about the mechanism, wrong about the consequence). The census then
found the REAL sibling defect (CSD11): ASSIGNMENT-form `_items = new();` in a
constructor emits nothing (6/400 files; explicit `new List<int>()` in the
identical position emits — a pure target-typed asymmetry). Fixed via a
member-type pre-pass map resolved through the assignment LHS; the dead early
return was removed. Locals declared without initializer remain an honest
no-edge. (2) "interface-only base lists mislabel index-0 external as
extends" — CONFIRMED exactly as described (CSD12; 66/400 powershell files
carry interface-only base lists). F5's corpus-interface companion narrows the
fabrication to EXTERNAL interfaces (IDisposable, IComparable), still among
the most common C# shapes. Fixed: unknown external index-0 I-prefixed
PascalCase names (length > 2, so Icon/IntPtr never match) emit implements;
structs/record-structs emit implements for EVERY base (C# structs cannot
inherit — I-naming irrelevant). Oracle mirrored on both; the pre-existing
fixture pin `extends F6Tank -> IDisposable` had codified the bug and was
re-authored from re-probed emission. Note: an I-named external CLASS
(`: IdentityMap`) still follows the first-base rule — a declared,
documented limitation of the convention heuristic. Fixture extended
(+4 pins, +2 forbids, assignment-form + struct shapes); 2 new mutants (192
total, ALL caught); F5 re-verified 100%/0/0 (1386 truth edges); F1/F6 21
languages green; SPEC 8/8; CC1 pass; honesty green.

## Gate-strengthening wave (F7/F8/F9) + dart heritage regression (2026-09-04)

Wave 1 — three new PERMANENT gates wired into the honesty REQUIRED set:
- **F7 analyzer-hygiene lint** (`script/m14/verify-analyzer-hygiene.ts`):
  mechanically detects the php relative_scope `? owner : owner` class of
  defects — no-op ternaries (both arms identical, nested-ternary and
  string-literal aware), no-op statements, write-only locals/fields.
  Positive-control tested against the historical php/csharp bugs. All 21
  analyzers clean (scala `? start : start` finding was a false positive:
  nested ternary, gate refined and re-verified).
- **F8 corpus-census gate** (`script/m14/verify-corpus-census.ts`): parses a
  real-corpus sample per language and fails on ANY parse-tree node type the
  spec never classified. First run found 28 blind spots across 8 languages;
  probe-verified each — most were already classified via `gap.gaps[]`
  (F8's collector now reads every ruling format), genuinely unclassified
  ones now carry recorded rulings (haskell lambda_case/multi_way_if =
  internal_silent by design; type_synomym = design decision).
- **F9 defect-class probe battery** (`script/m14/verify-probe-battery.ts`):
  12 probes, each encoding a defect class that ACTUALLY occurred (HSD12-19,
  CSD1-12, php relative_scope), asserting analyzer AND oracle semantics,
  with a self-test for F7's own detectors. Authoring it caught an apparent
  HSD16 regression; bisection proved the battery snippet was the wrong
  shape (bare qualified REFERENCE vs application) — the coherent boundary
  (constructor VALUES are silent, applications emit) is now RULED as
  haskell design decision HS-D2 and asserted as a battery probe.

Wave 2 — the strengthened F5 caught a REAL dart regression (DAD1-DAD3):
proxicall's mocktail mocks (`class _FakeX_0 extends _i1.SmartFake implements
_i2.Database`) parse FLAT (two adjacent type_identifiers joined by an
anonymous `.`; first = import alias). The analyzer named the base after the
ALIAS (extends -> _i1), leaked aliases into implements targets, and the
gate's tree-truth oracle demanded generic ARGUMENTS (implements -> T1).
Provenance: analyzer/oracle code identical since the dart wave — the
regression surfaced because the USER'S OWN PROJECT EVOLVED (new mocks file
entered the 60-file sample); the gate did exactly its job. Fixed with the
resolved-leaf contract (a type name followed by `.` is an alias prefix;
type_arguments never bases) mirrored across RealDartAnalyzer
(resolvedHeritageNames) and BOTH oracles; web-tree-sitter returns fresh
node objects per child() call so sibling lookup is position-based. Fixture
gains F6MockClient (aliased supertypes) + 3 pins + 3 alias forbids; 2 new
mutants (194 total, ALL caught). Full sweep: 21 languages 100% coverage /
0 missing / 0 fabrication; sqlite:c perf outlier (270ms vs 89.7 baseline)
attributed to load-15 environment (4 concurrent agent sessions, single-file
11.5s stall — physically impossible at steady-state; 3-attempt min-of-runs
retry already engaged), no correctness impact. Honesty gate green at
cc76e37 with F1-F9 + SPEC + CC1 fresh.

> **NEXT MILESTONE: M37 (Dual-Lens Analyzer Backfill, tracking issue #593; renamed from M34 after a numbering collision with the closed "M34: Consumability Hardening" was discovered).**
> The 18 gated-done analyzers get the csharp/haskell dual-lens pass (line-by-line
> read + corpus census + probe-verified fixes), one at a time: python -> java ->
> ts/js -> kotlin/scala/groovy -> zig -> c/cpp/rust/go -> dart/php/swift/objc/ruby
> confirms. When M37 closes, return HERE to M14 for the not-yet-done analyzers
> (clean, clojure, elixir, ...) under the F1-F9 + dual-lens regime. Milestone:
> "M37: Dual-Lens Analyzer Backfill". The milestone formerly carried the
> number M34 until the collision was found; "M34" in this repo now means
> Consumability Hardening, not the backfill.

## 2026-09-04 — M37 python dual-lens wave (PYD2): #594
- **PYD3** (analyzer): underscore class-variable visibility hard-coded `"public"` — now `pythonVisibility()` like every other python symbol kind (`_memo` → protected, `__x` → private).
- **PYD4** (analyzer): enum members with call-valued RHS (`RED = enum.auto()` — the canonical python idiom) were silently dropped; `call` added to the accepted constant-value set.
- **PYD5** (analyzer + oracle): member reads inside NESTED defs were re-owned by the nested (non-symbol) name while the calls contract attributes those bodies to the ENCLOSING function — two walks, two owners, edges dangling from a non-symbol. Rule now: rebind the owner only when entering a SYMBOL-LEVEL def (`inFn` undefined); nested bodies keep the outer owner. Mirrored in `derivePythonEdges`.
- **PYD6** (analyzer): dead ternary in the assignment-LHS gate (`namedChild(0) === undefined ? false : …` — condition unfireable; F7-class hygiene). Plain byte-range compare.
- **Fixture**: Colors(auto()) enum, `_memo` protected pin, Decorated nested-def pins (uses run->base_name, calls run->helper), forbid: no edge may source from `step`.
- **Mutants**: python/class-var-public-visibility, python/drop-enum-auto-members, python/nested-def-reowner — 197/197 caught.
- **Note**: corpus F5/census were already 100%/0 — all five defects lived in the gate-blind zone; the line-by-line read found them. This is why M37 exists.
- Gates: F1 41-lang audit, F2 fresh, F3 fixtures 21/21, F4 197/197, F5 full sweep 21 langs (jvm family unexplained counts pre-existing, baselines unchanged), F6 coverage, F7 hygiene 21 clean, F8 census 0 blind, F9 12/12, CC1, honesty GREEN.

## 2026-09-04 — M37 java dual-lens wave (JAD): #595
- **Cross-analyzer expansion sweeps first** (the new standing rule): PYD3/PYD4/PYD5 defect classes swept across all 21 analyzers — python was the only instance of each (verified php/ruby/java/dart/swift/objc/csharp/kotlin/scala/groovy semantics). No new defects.
- **JAD1** (analyzer): assignment-LHS field/array WRITES emitted `uses` edges (`this.x = 5` -> uses x) — the only managed-OO analyzer without the write gate. Parent-type gate added (assignment_expression, probed).
- **JAD2** (analyzer): member reads sourced to the receiver variable (`cfg.limit` -> cfg) or the enclosing TYPE — edges from non-symbol locals the graph can never connect. The uses walk now tracks method/constructor scopes: non-this reads source to the method, this/super reads keep the type owner (swift precedent), array reads included.
- **JAD3** (analyzer): implicit-public interface members had visibility=undefined and were excluded from EXPORTS — the most intentional API surface in Java silently missing (JLS 9.4). effectiveVisibility fallback when parentContext.isInterface; modifiers still win (private interface methods stay private).
- **Dead literals** (F1 audit): `assignment` never exists in the pinned java grammar (assignment_expression) — 2 comparisons cleaned; the F1 gate caught this immediately after the JAD1 edit introduced it.
- **Fixture updates**: array-access-uses pin re-authored to the corrected contract (reads -> method, writes gated, forbid type-sourced reads); multi-interface-extends pins fetch as an EXPORT.
- **Mutants**: java/emit-write-as-read, java/type-sourced-member-reads, java/interface-methods-unexported — 200/200 caught.
- Gates: F1 (35/41 pass, java clean), F2 fresh, F3 31/31 java fixtures, F4 200/200, F5 full sweep (java 100%/0 missing, JVM-family unexplained counts pre-existing baselines), F6, F7, F8, F9 12/12, CC1, honesty GREEN.
## 2026-09-06 — M37 dart dual-lens wave (DARTD6-D10): #605
- **Cross-analyzer expansion sweeps first** (standing rule): DARTD7/DARTD8/DARTD9 classes swept across all 21 analyzers before closing — every analyzer was checked for (a) per-site duplicate relationship rows (csharp/java/js/ts emit per-site; the family presence-based oracles make multiplicity invisible — only dart and the payload qc surfaces (rust #383/go GOD9) had explicit dedup), (b) local-function-as-symbol leaks (only dart emitted them; csharp/python/go never reference local_function nodes), (c) non-function contexts falling back to the module/file basename instead of the enclosing class (csharp parentContext.rawName||global is the family precedent; swift/objc/php/ruby/py member-initializer attribution verified class-owning already).
- **DARTD6** (analyzer PERF, differential-blind): `extractFieldType` scanned `node.parent` — the whole class_body — for EVERY field/variable (1,512 fields x 3,025-member scan on phosphor_icons_regular.dart = 13.6 s, 366 us/node). The parent fallback never returns a type (the explicit type is always a direct child of the declaration container — probed dart-typedecl-shapes.ts); inferred `static const x = Ctor(...)` has none by design. Removed: 13.6 s -> 252 ms (50x). Same O(class)^2 trap hasModifier already documents and avoids.
- **DARTD7** (payload, differential-blind): per-site calls/instantiates emission with NO dedup — 192,761 identical (type,source,target,confidence) rows corpus-wide (35% of 545,208 relationships; icon file: 1,511 identical instantiates rows from 1,512 const fields). Dedup exact rows at emission (first metadata wins): total 545,208 -> 351,722, dup rows 0.
- **DARTD8** (analyzer, contradicts own DARTD2 header rule): local functions (local_function_declaration > lambda_expression > function_signature) leaked as top-level Function symbols with empty scope AND became their own call-source context. Family parity: not symbols, calls fold into the enclosing real function (csharp/python/go zero local-fn references). Both halves fixed — the countingFetch/start census 'duplicate functions' rows are gone.
- **DARTD9** (attribution, differential-blind): class-member initializers with no function context fell back to the MODULE (file basename) as call/instantiates source — every const field of an icon class attributed to a name that is not a symbol. extractCallRelationships now tracks the enclosing class/mixin/enum/extension; module remains only for true top-level code (csharp parentContext parity).
- **DARTD10** (symbol-loss): top-level getters/setters (getter_signature/setter_signature under program) fell through every dispatch branch — dropped as symbols while their bodies' calls attributed to a non-declared source (corpus: translate.dart `List<String> get _deepLKeys`). Now Property symbols with meta.isTopLevelAccessor/isGetter/isSetter. Non-declared call-source tail: 90 -> 0.
- **Spec fix**: dart spec decision ids had a duplicate DARTD2 (the trailing constructor_invocation grammar probe) — renumbered DARTD11; DARTD2's call-source clause marked SUPERSEDED by DARTD8. Decisions now DARTD1-11 unique.
- **Fixture**: new dart/dedup-and-attribution fixture pins every class above (2 const fields + 2 in-body IconData constructions + 2 make() sites dedup to ONE row per source via expectRelationshipCount equals:1; IconSet->IconData class-sourced + forbid module->IconData; forbidSymbols localHelper; calls topFn->helperCall fold + forbid calls from localHelper; activeKeys top-level accessor pin meta.isTopLevelAccessor:true; acorn meta.dataType:IconData) — fixtures 3/3 dart.
- **Mutants**: dart/dup-rows-reintroduced, dart/field-init-module-source, dart/local-fn-symbols-reintroduced, dart/local-fn-call-context-reintroduced, dart/top-level-accessors-dropped — 279/279 caught (was 274).
- Gates: F1 grammar audit clean (dart), F3 fixtures 21/21 (dart 3/3), F4 279/279, F5 full sweep 21 langs no regressions (dart floor unchanged 100%/0/0 — presence-based, multiplicity invisible by design), F6 coverage 21/21, F7 hygiene 21 clean, F8 census dart PASS 0 blind, F9 12/12, CC1, SPEC (DARTD6-11 recorded), honesty GREEN.
## 2026-09-06 — M37 dart MASTER-REVIEW wave 2 (DARTD12-D17): #605
- **Provenance**: user-ordered second full read of the 1,582-line analyzer after wave-3, region-driven (the wave-3 pass was defect-driven; this one read every region skeptically, including the wave-3 fixes). All six findings were probe-verified on real parses BEFORE any edit; three initial suspicions (arrow-body isAbstract, hasBody gaps, extension-call resolution) were VERIFIED CORRECT and left untouched — no manufactured findings.
- **DARTD12** (symbol-loss, gate-blind): accessor pairs collapsed — seenMembers deduped by owner:name WITHOUT kind, so `get value` + `set value` kept only the getter (setters carry the typed value param). Corpus census: 0 pairs survived in proxicall (all collapsed pre-fix). Key is now owner:name:kind. Fixture: expectSymbolCount value/property/Counter equals:2. Mutant dart/accessor-pair-collapsed.
- **DARTD13** (payload corruption, differential-blind): EVERY typed parameter degraded to `dynamic` — tree-sitter-dart formal_parameter has NO `type` field (probed dart-param-children.ts), so childForFieldName("type") never matched; 8,094 corpus params affected (205 files). Fix: span-matched leading type child (type_identifier/function_type/nullable_type/void_type) before the name — reference equality vs childForFieldName fails in web-tree-sitter (fresh wrapper objects; same trap extractReturnType's KAD2 sweep fixed, now documented). this-params (`P(this.x)`) bind the sibling field's type in an O(symbols) post-pass (no parent scans — DARTD6 lesson); genuinely untyped params stay `dynamic` honestly. Census: 8,094 -> 54 (all untyped-in-src). Fixture: expectParameters total:double, nv:int, sides:int (+ new metadataKind option in the runner). Mutant dart/param-types-degraded.
- **DARTD14** (relationship-loss, differential-invisible): mixin on-clause heritage emitted ZERO edges — `mixin M on Base implements I` parses the on-base as a DIRECT type_identifier child of mixin_declaration (probed dart-mixin-shape.ts); the heritage extractor only looked for superclass/interfaces children. Corpus: 2 on-clauses, 0 edges. Now extends Flow->Base (meta.isMixinOn) + implements; oracle mirrors (deriveDartEdges mixin branch). Mutant dart/mixin-on-heritage-dropped.
- **DARTD15** (relationship-loss): enhanced enums (`enum Poly implements Shape`) never called extractClassHeritage — implements/with edges vanished; in-file interface methods also produced no overrides. Now heritage extracted; Poly.area->Shape.area overrides edge. Oracle enum_declaration branch mirrors. Mutant dart/enum-heritage-dropped.
- **DARTD16** (relationship-loss, THE big one — 34k): 34,306 corpus @override methods produced 32 overrides edges (0.09%). Three stacked causes: (a) production NEVER passes an overrideCompanion — verified: every parseFile caller passes no AnalyzeContext, so cross-file resolution was dead machinery in ALL analyzers that rely on it; (b) the dart pass only checked the DIRECT extends base (no implements, no transitivity); (c) csharp solves the same problem with a deterministic first-parent fallback (resolveOverrides Pass 3) — dart had no equivalent. Fix: 3-pass resolution (in-file BFS over extends+implements+with transitively -> companion when provided -> annotation-gated external first-parent at conf 0.8, meta.isExternalBase). The annotation gate is essential: an un-gated fallback made every field of a subclass fake an override (Poly.sides->Shape.sides — fields cannot override in Dart). Result: 34,324 edges / 34,330 annotations. Mutants dart/external-override-dropped + dart/field-override-fabricated.
- **DARTD17** (call-resolution): cascade chains resolved to the FIRST selector segment (`b..a.b.c(1)` -> calls a) — the leaf (c) lives in nested unconditional_assignable_selector children. Fix: last identifier across selector children EXCLUDING argument_part (so call arguments like `b..foo(a.bar)` never leak). Probe-verified both directions.
- **F6 allowlist note**: `dynamic` added to the dart literal allowlist — it compares the parameter-type PAYLOAD (DARTD13 honest no-type), not a parse-tree node; the audit flagged it as a dead literal because it isn't a grammar type, and it never claimed to be one.
- **Fixture harness upgrades**: expectSymbolCount and expectParameters now honor optional ownerName/kind/metadataKind (accessor pairs need kind-level pins; generic name-count pins cannot distinguish IconSet's getter from Counter's pair).
- **Corpus deltas (proxicall, 309-file sample)**: overrides 32 -> 34,324; dynamic-typed params 8,094 -> 54; accessor pairs 0 -> surviving; mixin on-bases 0 -> 2 extends edges. Differential parity held at 100%/0 missing/0 unexplained (overrides are not compared for dart — oracle truth mirrored for DARTD14/15 only).
- Gates: F1 34/41 (untouched languages only), F3 21/21 fixtures (dart 3/3), F4 285/285 (7 new mutants), F5 proxicall:dart 100%/0/0, F6 21/21 (dart deadLiterals 0), F7 hygiene 21 clean, F8 census 21/21 (dart blind=0), F9 12/12, CC1, honesty GREEN (F1/F2/F3-F9 evidence re-emitted at HEAD).
## 2026-09-06 — M37.10 cross-analyzer sweep: overrideCompanion dead-machinery (#605 lesson, family-wide)
- **Provenance**: dart master-review wave-2 discovered that production callers NEVER populate AnalyzeContext.overrideCompanion (grep across src/ide/script: only m12/verify-analyzer builds one for its own fixture tests). Per the standing cross-analyzer rule, the class was swept across all 13 analyzers that reference the companion.
- **Verdict per analyzer**: php, ruby, python, javascript, perl gated ALL override emission on the companion — external bases (declared in another file) silently produced ZERO override edges, no fallback. swift had the INVERSE defect: its Pass-3 first-parent fallback emitted the GUESS at confidence 1.0 + evidenceClass "structural" (the exact anti-pattern java's own Pass-3 comment documents as fixed). java, groovy, kotlin, scala, csharp, dart already had the correct Pass-3 contract.
- **Fix contract (family parity)**: in-file base declares the method -> verified override (0.95 php/ruby/python/js/perl, 1.0 java/swift Pass-1); companion present -> companion-index resolution (0.85-0.9); otherwise deterministic Pass-3 first-parent guess @0.5, reasonCode "first-parent-guess", tier "inferred" (php/ruby/python/swift classifiers corrected; js already inferred) — below the patterns.ts 0.7 threshold, heuristic in F5 (honest suspicion, never fabrication).
- **Gates**: 5 new external-override fixtures (php/ruby/python/javascript/swift; external base deliberately absent from file) pinning the guess @confidenceMax 0.5 + reasonCode + inferred tier AND the verified tier @confidenceMin 0.9 (forbid pins both directions); 6 new mutants (php/ruby/python/js drop-external-override-guess, swift guess-at-verified-confidence + drop) — 291/291 caught; F9 battery extended to 19 probes (F9-PROBE-M3710-* for 7 languages incl. perl which has no fixture infra) asserting both tiers' confidence/reasonCode/tier contract.
- **Spec**: M3710-COMPANION decision recorded in php/ruby/python/javascript/swift completeness specs. Ruby spec had pre-existing duplicate decision ids (two RUBD2, two RUBD3 — same class as dart's DARTD2 collision) — renumbered RUBD8/RUBD9.
- **Differential**: new guess edges land in the heuristic bucket (by design); affected baseline rows (phpunit:php, rake:ruby, cython/jq/fmt:python, swift-nio:swift, *:javascript) re-pinned against the verified sweep.
## 2026-09-07 — M37.13 php dual-lens pass (PHPD5-PHD9): #606
- **Provenance**: first full line-by-line read of the 1,141-line real-php-analyzer.ts (php had never had a dual-lens read — only the M37.10 companion fix touched it). Findings probe-verified on pinned-grammar parses BEFORE editing; no manufactured findings (self::CONST suspect CLEARED: it parses as class_constant_access_expression, never a scoped_call — no fabrication exists).
- **PHPD5** (relationship-loss, corpus-blind): the extractive main walk only recursed into node types it MATCHED (no fallback), and every call/creation processor (function_call/member_call/scoped_call/object_creation) lived ONLY inside walkBody — method/function bodies. Top-level/procedural statements in PHP scripts, config/bootstrap and WP/plugin hook files (`$app = new Application(); $app->boot(); register_shutdown_function(...)`) were silently DROPPED: the analyzer emitted ZERO edges for whole files while the oracle (generic walk) derived them all. phpunit is class-heavy (top-level statements in only 4/300 sampled files, 1.3%) so F5's 60-file sample never saw the shape — a coverage blind spot of the haskell HSD12/CSD1 class. Fix: main-walk dispatch of the four call/creation types wherever reached outside a body + a generic child-recursion fallback for unmatched nodes (mirrors the oracle). Member READS deliberately not dispatched there — oracle derives uses only inside method/function bodies (inBody), which walkBody owns.
- **PHPD6** (relationship-loss, shared blind spot): PHP 8.1 enums implement interfaces via the SAME class_interface_clause as classes (`enum Status implements Labeled`) — the enum_declaration branch never read it AND the oracle mirrored the hole, so both sides silently dropped enum implements (a shared hole no differential can see). Analyzer + oracle now read the clause (implements edges, meta.isEnumImplements, implementedInterfaces payload).
- **PHPD7** (oracle fabrication): the oracle imported the analyzer's PHP_BUILTINS but NOT processFunctionCall's early return for add_action/add_filter (WP hook registrars — framework detection only, never a calls edge). The oracle therefore fabricated calls:add_action/add_filter truth on procedural WP-style files. Exclusion now mirrored in derivePhpEdges.
- **PHPD8** (symbol fabrication, consequence of PHPD5's fallback): descending anonymous_class subtrees would have let ownerless method_declaration nodes reach the extractive walk and fabricate method symbols (a class-body member always carries owner via pushMembers — ownerless methods can ONLY be anon-class methods). Guard: never symbolized (no nameable owner; mirrors walkBody's in-method anon treatment), body still walked for calls/creations (global-sourced).
- **PHPD9** (documented boundary): PHP 8.1 "new in initializers" (param defaults / attribute args) lives in signatures the walk continues past — census: 0 occurrences in 300 phpunit files (168 attribute_list nodes, none carrying object_creation). Recorded as explicit boundary, not accidental gap.
- **Corpus deltas (phpunit, 300-file sample)**: tree-truth 2,698 = analyzer 3,202, MISSING=0 unexplained=0 (100%/0/0 unchanged — the defects were corpus-rare; gates carry them).
- **Gates**: new fixture php/procedural-enum (procedural global-sourced instantiates/calls equals pins ×2, enum implements Status->Labeled/Tagged with isEnumImplements, forbidSymbols handle, forbidRelationships calls->add_action/add_filter); 4 new mutants (drop-top-level-procedural, drop-enum-implements, emit-wp-hook-calls, symbolize-anon-class-methods) — all die, 295/295 total; spec PHPD5-9 recorded.
## 2026-09-07 — M37.13 php wave 2 (PHPD10): #606
- **PHPD10** (relationship-fabrication, family-blind): same-leaf cross-namespace inheritance. A class may extend a DIFFERENT class sharing its leaf name in another namespace (phpmyadmin `Setup\FeaturesForm extends User\FeaturesForm` — 11 files; phpunit `interface Exception extends \PHPUnit\Exception`, `class InvalidArgumentException extends \InvalidArgumentException`). Leaf-collapse of the qualified base made every such class look like it extends ITSELF: fabricated `extends Self` edges (12 phpunit / 11 phpmyadmin), VERIFIED @0.95 self-overrides (the in-file/companion override check matched the class's OWN methods — 16 phpmyadmin / 2 phpunit), and `new parent()` resolving to self. F5 stayed green because the ORACLE leaf-collapsed identically — both sides fabricated the same extends truth (collusion; overrides truth was empty so self-overrides only surfaced on files in the sample).
- **Fix contract**: `heritageTarget` — a QUALIFIED base/interface whose leaf equals the declaring class's own name keeps its qualification (leading backslash stripped): `extends FeaturesForm -> Forms\User\FeaturesForm`; overrides then resolve against the external same-leaf base as the M37.10 first-parent guess @0.5/inferred. A base qualification CANNOT disambiguate (global single-segment `\InvalidArgumentException`) is unresolvable in the leaf graph: NO edge (self-loop always fabrication; wrong-edge-worse-than-no-edge precedent). Mirrored across analyzer (metadata.baseClass/extends/implements/enum-implements, resolveOverrides no longer re-leafs) and oracle (derivePhpEdges heritage + heritageOrSkip on class/interface/enum branches).
- **Corpus deltas**: phpunit self-extends 12->0, self-overrides 2->0; phpmyadmin self-extends 11->0, self-overrides 16->0. Differential 100%/0 missing/0 unexplained on both (phpunit sample 300: tree-truth 2,697 = analyzer 3,201; phpmyadmin sample 150: 2,555 = 2,870).
- **Gates**: fixture php/same-leaf-inheritance (qualified same-leaf extends pin to Forms\User\FeaturesForm + overrides guess @reasonCode/inferred, forbid self-extends FeaturesForm/InvalidArgumentException + self-overrides, extends equals:1) + 2 mutants (self-extends-reintroduced, self-override-verified-reintroduced) — 297/297 caught (was 295). Spec PHPD10 recorded.
