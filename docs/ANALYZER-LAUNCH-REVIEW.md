# Analyzer launch review

The first launch pass covers TypeScript, JavaScript, C++, C, Python, Java, Kotlin, and Go. Rust, C#, PHP, Ruby, and Swift received a fixture and sampled corpus pass. The evidence record lists each sample and its limits.

The pass uses Backbencher's own symbol search, graph traversal, and file-scoped analysis to locate and prioritize code. Regressions are reproduced against source and the production AST entry point, with compiler checks where available. A stale indexed answer can locate a candidate for inspection. Current source and runtime checks determine the verdict.

## Latest TypeScript repeated-binding follow-up

Repeated `var` declarations now contribute all initializers to alias provenance
for their shared lexical binding. This fixes writes missed after a second
initializer, including block-contained `var` and destructuring declarations.
Twenty exact call sites, six runtime scenarios, two source mutations and real
worker origin edits/restoration verify this extension. Conditional, destructured
and repeated-binding passes together add 98 exact sites and 41 runtime scenarios.
A dedicated config also typechecks all ten inheritance/alias gate entry points
with zero diagnostics. Broader container mutation and interprocedural effects
remain open. TypeScript continues as the active language.

## Latest TypeScript destructured-alias follow-up

Literal-backed destructuring now tracks the selected object key or array index
when invalidating inferred fields. Renaming, nesting, defaults, assignments,
container aliases, static member/index access, object spreads and array holes
are covered. Rest copies do not inherit the original object's identity, and
recursive property origins terminate. Fifty exact call sites, 23 runtime
scenarios, six source mutations and real-worker edits/restoration verify this
scope. Dynamic keys, array spreads, arbitrary container-content writes and
interprocedural effects remain open; TypeScript remains active.

## Latest TypeScript conditional-alias follow-up

Conditional and logical aliases now preserve possible value origins when
invalidating inferred fields. Ternary conditions and discarded comma operands
do not become aliases; logical assignments retain their possible right-hand
origin. The gate checks 28 exact call sites, 12 executable scenarios, five
source mutations and real-worker write removal/restoration. Existing alias
mutations and all 121 TypeScript fixtures pass. Destructured/container-derived
aliases are the next active gap; TypeScript is not complete.

## Latest TypeScript alias-write follow-up

Writes through simple lexical aliases now withdraw inferred field owners.
Initializer chains and simple assignments retain possible origins across
rebindings; lexical shadows, captured variables, static aliases and lexical
`this` are distinguished. The alias facts only invalidate inference and never
create a resolved call target. The new gate has 37 exact call sites, 19 executable
scenarios, five source mutations and real-worker write removal/restoration.

General interprocedural aliasing, aliases obtained through destructuring or
container reads, conditional/logical alias assignments and mutator calls remain
open, alongside cross-file hierarchy and namespace-qualified type identity.
TypeScript remains the active language. See the
[alias-write evidence](../validation/m14/analyzer-launch-review.md#typescript-alias-writes).

## Latest TypeScript inheritance follow-up

Same-file, top-level inheritance now preserves concrete field owners through
multiple ancestors. Unknown child declarations, constructor parameter properties
and accessors block parent hints; private and static/instance identities stay
separate. Writes through a child invalidate the actual inferred declaration
before inherited facts are copied. The new gate checks 33 exact call sites,
15 executable scenarios, seven source mutations, storage, bb graph, and real
worker parent edits and restoration. All 121 existing TypeScript fixtures pass.

Nested/qualified/dynamic parents, generic heritage substitution and cross-file
inheritance remain outside this repair. Aliases, broader type identity and
independent corpus adjudication remain active work; TypeScript is not complete.
See the [inheritance evidence](../validation/m14/analyzer-launch-review.md#typescript-inherited-fields).

## Latest loop follow-up

The TypeScript loop pass verifies 13 compiler-backed sites through storage,
bb graph and real workers. Three source mutations expose incorrect var scope,
phantom assignment bindings and ignored repeated declarations. Field writes now have a 23-site compiler-backed matrix, 15 runtime dispatch
scenarios, five source mutations and real-worker edit/restoration checks.
Known-owner writes invalidate inferred field evidence; annotations remain static
evidence. Aliases, cross-file field writes, inherited identities, collection
content mutations and corpus-level verification remain open. TypeScript is not
yet complete.

## Latest TypeScript work

Receiver-write verification now covers 36 compiler-checked call sites, 22
executable dispatch scenarios, eight source mutations and real worker
edit/restoration. Inferred facts are invalidated at the correct lexical binding;
explicit annotations remain static evidence. Details and limits are in the
[receiver-write evidence](../validation/m14/analyzer-launch-review.md#typescript-receiver-writes-current-pass).
Same-line calls now retain exact offsets through storage and bb graph: 12
compiler-derived sites, both graph directions, incremental shifts/restoration,
five mutations and the graph regression suite verify that repair. The older
Java/TypeScript multiplicity gate was corrected and now passes seven checks.
TypeScript remains active; these bounded repairs do not establish whole-language
perfection.

## Sequential completion pass

Work now stays on one language until its identified defects and verification
gaps have been addressed or explicitly bounded by evidence. Active language:
**TypeScript**, following the user's acceptance of PHP's documented verification scope.
Other languages remain pending. A passing sample is not a whole-language
completion claim.

Latest TypeScript checkpoint: factory binding, exact caller attribution, class
field ownership, generic argument positions, declared `unknown` callers, and
signature-parameter scope isolation are repaired for the recorded cases. Four
compiler-backed matrices cover 46 call sites (nine explicit abstention cases),
with real worker edit/restoration, graph checks, and 18 source mutation controls.
The existing 20-site receiver matrix and all 121 TypeScript fixtures pass.
Remaining priorities are receiver writes/control flow, inherited fields,
namespace-qualified type identity, legitimate names rejected by artifact filters,
and independent corpus adjudication of the `uses` oracle. This is verified
progress, not whole-language completion.

The TypeScript factory pass now preserves lexical callable bindings, rejects
conflicting overload returns and reassigned callable evidence, and keeps exact
caller declaration offsets through storage. Sixteen compiler-backed call sites
pass direct storage and real worker indexing, including incremental edits and
restoration; three source mutations are rejected. Receiver writes and corpus-level oracle adjudication
remain active work. See the factory evidence section below.

PHP closure work currently covers project-wide override generation, canonical
stored type/member identities, incremental hierarchy invalidation, negative
controls for ambiguous declarations, and native runtime comparisons.

PHP function resolution now preserves namespace and import candidates through
the worker/store boundary. It distinguishes function imports from class aliases,
uses namespace-first/global fallback only where PHP permits it, and leaves
missing or duplicate declarations unresolved. Native PHP, incremental/clean
parity, bb graph/impact, 35 fixtures, and eight source-level mutations verify the
listed cases. The latest 200-file draw matches 9,945 comparable tuples, with
zero mismatches and two late-static targets still explicitly unverified. PHP
remains active; receiver inference, signature
compatibility, and trait adaptation/dispatch still need work.

Nested named-function body attribution was already correct in executable code.
Its stale comments are corrected, the fixture now pins the nested source and
forbids the enclosing source, and a ninth executable-decision mutation proves
that reverting the source attribution is detected.

Stable PHP parameter receivers now resolve conservatively with inferred
evidence. Native and worker tests cover 26 member facts, scope separation,
reassignment/escape negatives, incremental withdrawal/restoration, and graph
queries. A same-line direct-store source defect was also fixed. All 36 PHP
fixtures pass; four new receiver algorithm mutations and the eight existing
type-identity mutations are rejected. PHP remains active for broader receiver
flow, signature compatibility, and trait adaptation/dispatch.

PHP override calling shapes now have native-checked guards for arity, optional
parameters, variadics, references, and constructor exceptions. Twenty isolated
PHP cases agree with analyzer and stored results, including real workers and
incremental withdrawal/restoration. Type variance remains unchecked. A separate
known defect remains: same-named declarations on one line can collide in stored
symbol identity; `verify-php-signature-shapes.mts --same-line` reproduces it.
Abstract constructor contracts inherited through a concrete intermediate class
also still need checking; native PHP rejects incompatible descendants there.

Follow-up: both defects above are now repaired. The signature matrix has 24
native-checked cases, including abstract constructor contracts through concrete
parents; it passes when compressed onto one line and through real workers.
Same-line symbols retain separate IDs, byte-contained owners, and callable
source offsets. A two-namespace compact file preserves four methods and two
correct caller/target pairs. TypeScript is next after PHP completion.

PHP signature variance now rejects incompatible parameter/return types across
known canonical hierarchies, including nullable, union, intersection/DNF, and
scalar cases. A 53-case native matrix agrees with stored results; unresolved
hierarchies and late-static types retain unchecked evidence. Trait dispatch and
broader receiver flow remain active PHP work.

The direct analyzer and stored graph now apply the same final/static/visibility
guards. Local cyclic ancestry and duplicate methods abstain. The native matrix
has 63 cases (31 accepted child overrides); local and project candidates both
use inferred evidence at 0.85 and explicitly report unknown compatibility.
Real-worker incremental tests and bb graph/impact assertions pass. PHP remains
active for trait dispatch and broader receiver-flow checks.

Trait member dispatch now resolves aliases, exclusions, nested composition,
class/trait/parent precedence, and inherited abstract requirements. It preserves
interface declaration lookup and declines ambiguous aliases or unresolved
composition. Native PHP and worker tests cover the stored destinations and
incremental updates. Trait-origin override contracts remain an explicit
abstention boundary; broader receiver-flow checks remain pending.

Follow-up: ordinary trait-origin override contracts now resolve in the project
pass, including aliases and visibility adaptations. Twenty-five native compile
and Reflection cases agree with stored results (12 accepted overrides), and
four new source mutations are rejected. Trait-relative self/parent types are
instantiated in the consuming class; abstract constructor requirements remain
checked through intermediate concrete constructors.
Per-file extraction leaves trait-origin overrides to project reconciliation.

Reusable-trait receiver checks now prevent a shared method body from claiming
the trait itself as the receiver of `$this`, relative scopes, or `self`-typed
parameters. Consumer-bound type references and object creation also stay
unresolved. Native execution in two consuming classes verifies the differing
destinations; explicit concrete parameter types continue to resolve.

The identified PHP namespace, signature, override, trait composition, and
receiver-claim defects above are repaired and covered by executable checks.
This is a bounded completion of those repairs. Full flow-sensitive inference,
runtime loading/magic dispatch, call-site accessibility, and parser-unsupported
adaptations are not certified. The sampled endpoint gate still reports two
late-static targets as unverified; it must not be described as a full semantic
correctness certificate. TypeScript remains the next language.

## TypeScript sequential pass

The initial TypeScript baseline passes 121 fixtures. The first focused regression
found file-wide array-element and generic-argument maps contaminating otherwise
scoped receiver facts. Those facts now follow lexical bindings, including unknown
and destructured shadows. Uninstantiated type parameters no longer become
concrete owner claims. Storage also withdraws name-only target guesses for local
receivers explicitly marked unresolved by the analyzer.

The compiler-backed regression checks 20 call sites, stored endpoints, and
bb_graph output. The installed TypeScript 5.9.3 checker provides independent
declaration destinations. Inferred constructor type arguments remain outside
this syntax-based inference and are explicitly expected to stay unbound.
TypeScript remains active; this first fix does not close the broader uses-oracle,
type identity, factory-return, field-owner, or flow-analysis review.

## Confirmed defects repaired

- TypeScript receiver typing now keeps function scope at byte zero distinct from module scope and stops at untyped or conflicting local bindings.
- JavaScript receiver typing now uses its positional binding model, so same-name bindings in different scopes retain their own type facts.
- Kotlin overrides prefer exact signatures over generic-name guesses. A name-only companion can supply an inferred candidate when the in-file search has no candidate.
- The Go oracle now emits `instantiates` for its constructor-name convention. The analyzer classifies that convention as inferred and keeps syntax-backed composite literals structural.
- `bb_search` now applies an exact directory-bearing file scope and checks that file's freshness even when no matching symbol was indexed.

## Launch verification still open

- Replace source placeholders in the JavaScript and Swift oracles before using their endpoint counts as graph evidence. Java, C, C++, Kotlin, and Go also have partial endpoint attribution.
- Adjudicate TypeScript `uses` and the highest-impact unmatched C++ containment, C construction, and Ruby call cases against independent declarations and source sites.
- Extend full and incremental index comparisons to the same files and configurations for the primary lanes. The current corpus probes run in per-lane analysis context and do not establish full-index parity.
- Expand compiler-backed and source-mutation checks beyond the targeted C++ and Java controls. Language-specific fixture results and legacy label/target matching are narrower evidence than that review.

[Recorded runs and tool observations](../validation/m14/analyzer-launch-review.md)

## Deeper verification pass

The next pass added caller-aware JavaScript comparisons, independent direct-call controls for C and C++, and TypeScript lexical-block coverage. The worker-pool parity test now exercises adding an imported module and removing both an import and its source file. The worker self-test reports operating-system spawn failures distinctly from an older worker's lack of a self-test marker.

Whole-corpus endpoint certification still requires explicit source identities, especially for anonymous JavaScript callbacks and other source-less oracle rows. The incremental parity result covers the tested relative imports. Workspace aliases, transitive module changes, and other language-specific project indexes require their own parity cases.

## Rust, C#, PHP, Ruby, and Swift

This batch verified five analyzer lanes and the graph and impact tool handlers.
The C# and Swift override paths now mark companion method-name matches as
inferred. C# also marks its first-parent guess as inferred. PHP now follows
in-file ancestry to find the nearest eligible declaration and distinguishes
that result from companion evidence. Ruby preserves calls used as receivers
of property writes. The Rust containment oracle now names owners for more
nested declarations and uses the self type of trait implementations.

Both graph tools can root traversal in an exact indexed file when symbols
share a name. The duplicate-name regression exercises the production handlers
and checks the caller returned by each.

The 30-file corpus probes still leave endpoint verification open. Swift's
sample supplied no concrete oracle sources, and local Swift overrides still
match by name without checking overload signatures. PHP's simple-name lookup
still needs namespace and alias controls. Rust, C#, PHP, and Ruby still have
unresolved discrepancies recorded in the validation run.

[Batch runs and endpoint counts](../validation/m14/analyzer-launch-review.md#rust-c-php-ruby-and-swift-batch)

### Swift and PHP follow-up

Swift's differential now compares caller identities for calls inside uniquely
named functions and operators. Swift's local override lookup checks written
signatures and keeps shared overload endpoints inferred. PHP's in-file
override lookup now resolves class names through the namespace and class
import aliases. It omits edges whose stored member names collide in the file.

Swift calls in unsupported scopes, the remaining relationship labels, and
PHP's cross-file namespace resolution still require verification. The other
three lanes retain their previously recorded corpus discrepancies.

[Swift and PHP verification](../validation/m14/analyzer-launch-review.md#swift-and-php-follow-up)

### Nested callable attribution

Endpoint comparison exposed misattributed reads in a nested Swift function
and misattributed calls in a nested Ruby method. Both analyzers now use the
nested declaration as the source. Ruby also keeps its nested parameters and
assignments out of the enclosing method's locals. Ruby's companion override
matches now carry inferred evidence.

The Rust analyzer now preserves fully qualified dependency paths for nested
grouped imports. The Rust and C# oracles gained source coverage for reads,
imports, inheritance, and construction where the AST supplies the identity.

[Corpus runs and remaining discrepancies](../validation/m14/analyzer-launch-review.md#nested-callable-attribution)

### Rust and Ruby endpoint reconciliation

All 110 Rust files in the pinned ripgrep checkout pass the relationship tuple gate. A separate 30-file Cargo draw also passes.
The Rust oracle tracks enclosing sources for calls, macro invocations and
construction, preserves declared member paths, and keeps type references
from distinct declarations separate. Ruby's pinned Rake and Rack draws have zero
missing or unexpected comparable tuples. Ruby's unresolved sources and
inferred override targets still keep its endpoint gate open.

[Reconciliation tests and corpus evidence](../validation/m14/analyzer-launch-review.md#rust-and-ruby-endpoint-reconciliation)

## Expanded batch verification

The latest pass adds callable declaration locations to the Swift and Ruby
endpoint checks when names repeat. Missing or ambiguous locations remain
unverified. This exposed Swift relationships lost across overloads, C# calls
attributed to the enclosing method instead of a local function, and PHP calls
attributed to an outer method instead of an anonymous-class member.

Callable ranges in Swift now cover the body while retaining the name's start.
A store-level regression checks that two overloads calling the same target
retain distinct source symbol IDs. Ruby file exports now carry the file-level
marker consumed by the store.

The current corpus gates pass for Rust, C#, PHP and Swift in the recorded
scopes. Ruby has no comparable mismatches but still reports unverified external
override targets. Cross-file namespace resolution and compiler-backed semantic
verification remain outside this pass's established guarantees.

[Expanded runs and worker verification](../validation/m14/analyzer-launch-review.md#expanded-batch-verification)

## Namespace and override follow-up

PHP member receivers now retain their canonical class identity through the
analyzer, worker projection, store, and graph tool. Canonical parent identities
resolve class imports and namespace-relative names without falling back to an
unrelated namespace's short name. Method lookup is case insensitive while
property and constant reads keep their case and member kind.

Incremental indexing now reconciles receiver bindings after name-based repair.
Deletion-only updates repair surviving relationships and clear obsolete
cross-file flags. The worker regression compares alias changes, base deletion,
and base restoration against clean graphs, including target files and flags.

Ruby local override checks now distinguish instance and singleton method
tables and walk through intermediate local classes to the nearest declaring
ancestor. Its optional project-index consumer reports name candidates as inferred
and requires exact keys for qualified names. A shallow name index no longer
promotes a guessed override to structural evidence. Ruby's external override
gate remains open: the recorded draw has 216 oracle targets unverified.

Dogfooding also exposed incorrect stale-file advice. Tool envelopes and their
references now use the executable CLI form, `bb index --file "<file>"`.

The current batch remains in progress. PHP cross-file override generation,
namespace-qualified identities for every relationship label, Ruby lexical
constant lookup and dynamic dispatch, and broader compiler-backed corpus checks
remain outside the guarantees established here.

An independent PHP 8.3.6 execution check agrees with seven stored call bindings.
Ruby 3.2.3 reflection agrees with five override tuples, including grandparent
declarations and the dispatch-kind negatives. These are targeted runtime checks;
they do not certify the remaining corpus relationships.

[Follow-up regressions, mutation controls, and remaining limits](../validation/m14/analyzer-launch-review.md#namespace-and-override-follow-up)

### TypeScript field follow-up

Fifteen compiler-backed field call sites now pass direct storage and real worker
indexing, including incremental edits/restoration and bb graph queries. Field
facts distinguish class declaration identity, static/instance side, private
fields, class expressions, and lexical arrow `this`. Unknown fields and rebound
`this` stay unresolved. Three field source mutations are rejected. Inherited
field lookup, arbitrary field writes, and broader type identity remain open.

### TypeScript generic argument positions

Twelve compiler-backed call sites now preserve generic argument positions through
annotations and constructors. Unsupported primitive/union/array slots remain in
the argument vector instead of shifting later class arguments; uninstantiated
type parameters cannot resolve to an unrelated same-named class. Worker edits
and restoration, stored graph endpoints, and three source mutations verify the
bounded repair. Generic defaults, constraints, and overload inference are not
covered by this pass.

### TypeScript caller-name filtering

The store now preserves calls from declaration-backed functions/methods named
`unknown`; synthetic placeholders remain filtered. Three compiler-backed sites,
worker edit/restoration, graph queries, and two opposing source mutations verify
the change. Other artifact-name filters and receiver/type identity gaps remain
open; TypeScript is still the active language.
