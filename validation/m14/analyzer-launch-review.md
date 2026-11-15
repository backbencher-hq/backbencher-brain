# Analyzer launch review evidence

## Fixture and corpus runs

`bun run script/m14/run-fixtures.ts --lang typescript,javascript,cpp,c,python,java,kotlin,go,rust,csharp,php,ruby,swift` passed all 705 fixtures. Corpus probes ran with a scratch `BB_M14_WORK` using `--lang LANGUAGE --repo CORPUS --sample 8 --check-edge-identities`. These are deterministic samples, not population estimates. The two endpoint columns record unpaired tuples and include placeholder sources and spelling differences. They cannot be read as counts of analyzer bugs. The Go row reflects the post-fix rerun. Other rows are the initial triage samples.

| Language | Corpus | Fixture passes | File-level label/target covered | Matched / oracle-only / analyzer-only endpoint tuples | Sample |
| --- | --- | ---: | ---: | ---: | --- |
| TypeScript | vue-core | 121 | 208/215 | 109 / 106 / 133 | 316f49ed4a2543c6 |
| JavaScript | svelte | 95 | 202/202 | 0 / 202 / 247 | 3030ca17c7481093 |
| C++ | fmt | 57 | 1174/1204 | 508 / 691 / 1490 | 5d4cd9200bb56898 |
| C | sqlite | 53 | 1775/1792 | 208 / 1584 / 5239 | c867c132b236df4a |
| Python | cython | 66 | 796/796 | 562 / 16 / 28 | dff193cde74b21e1 |
| Java | grails-core | 80 | 589/590 | 145 / 433 / 672 | 804df49e257e7800 |
| Kotlin | Exposed | 71 | 1043/1043 | 744 / 273 / 389 | 560cda8153cfac3d |
| Go | go-tools | 34 | 282/282 | 127 / 153 / 189 | 2960d92597c5a79a |
| Rust | ripgrep | 34 | 682/682 | 338 / 340 / 766 | 7e7cab2f15b069fc |
| C# | powershell | 26 | 1662/1662 | 1288 / 260 / 327 | f024e10dc5dac0bf |
| PHP | phpunit | 33 | 83/83 | 29 / 54 / 77 | 7e2d86635e3ef4b8 |
| Ruby | rake | 13 | 646/651 | 7 / 369 / 529 | 2210858e71c9ab85 |
| Swift | swift-nio | 22 | 345/345 | 0 / 345 / 853 | 3ccec8b7886027fb |

The C and C++ oracle comparator self-tests passed. The independent Clang macro check matched five class definitions and seven member edges. `javac` accepted the Java generic override fixture. The TypeScript and JavaScript receiver fixtures failed before their fixes. The Kotlin and Go probes under this directory passed after reproducing the companion and oracle defects.

## Backbencher dogfooding

- `bb 0.1.1` exact name queries for analyzer classes showed archived definitions and script bindings ahead of the production implementation on small pages. Class filtering narrowed the result but could still return the archive first. This is a ranking observation. A directory-bearing `bb_search mode=symbol` scope is the precise lookup.
- Reproduced a scoped search defect with `src/analyzer.ts` and `archive/src/analyzer.ts` both indexed. The relative path returned two matches. With the target file edited to declare a previously unseen symbol, a miss also failed to declare the file's staleness. `verify-bb-search-file-scope.mts` checks both behaviors through the tool handler against a scratch index.
- `bb_search mode=file` reported the TypeScript analyzer at 463,028 source characters and truncated the returned text to its stated limit. The main differential is over 1.6 MB. Its production `deriveTreeEdges` symbol was absent from the existing index while an archived mirror was returned. Source inspection remained necessary. This lookup establishes an indexed absence, and the size tier is a plausible explanation.
- `bb_graph` found the TypeScript receiver helper's caller but declared `caller-depth-cap-reached`. File-scoped `bb_analyze mode=complexity` returned a stale-file count for edited analyzers. Neither result was used to claim current or exhaustive code coverage.
- `bb doctor` reported the local compiled worker did not answer the startup self-test and the index contained vectors from other embedding models. These observations describe the local installation and its index.

## Deeper verification pass

- The JavaScript identity gate now names callers for supported function and method forms and keeps distinct caller/target tuples. The TypeScript compiler AST independently agreed on four callers in the control fixture. Removing one caller's edge failed the comparison. Anonymous calls with no established owner stay unverified. The 60-file Svelte draw `005ebc808ac8a8ea` matched 340 complete tuples and reported 749 oracle rows with unknown sources. It still failed the gate. Its legacy metric covered 1,097 of 1,097 rows.
- The identity report separates unknown-source rows from missing edges. An analyzer row that could correspond to unknown-source truth is reported as unverified. This does not make the gate pass.
- Clang agreed on both caller endpoints in independent C and C++ controls. Dropping the second caller failed each comparison. This is a check of direct calls in those fixtures, separate from the shared-grammar corpus oracle.
- The TypeScript receiver regression covers same-name lexical blocks and a `var` declaration hoisted out of a nested block. The fixture failed before the change and passed afterward.
- The incremental test compares the relationship rows after adding a previously missing imported module, removing an import, and deleting its source file. Removing the import originally left an unattributed relationship behind. The real Node worker-pool run also exposed an unresolved existing caller after adding the target module. The fix removes file-owned rows by their stored anchor and reconsiders existing relative importers. The test requires the real worker pool when passed `--require-worker`.
- The compiled `bb doctor` reproduced the local worker diagnosis under sandbox restrictions. Node returned a spawn error alongside an empty capture and zero status. After the fix the sandbox run reports `fork-unavailable` with the operating-system error, and the unrestricted run verifies the same compiled worker.

## Rust, C#, PHP, Ruby, and Swift batch

All 129 scoped fixtures passed across the five lanes. The targeted production
parser probe covers C# local, companion and parent-guess evidence, PHP
grandparent and companion evidence, and Swift companion evidence. The Rust
containment probe compares owner identities for a trait implementation and
a nested const and excludes an ordinary local binding. The graph and impact
probe runs both MCP handlers against a scratch index with two same-name
symbols and distinct incoming call edges. The test sets the stored target IDs
directly to isolate graph root selection.

| Lane and corpus | Fixtures | Draw hash (30 files each) | Legacy rows covered | Endpoint matched | Missing | Unexpected | Unknown oracle source |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Rust / ripgrep | 34 | `96f9b23c8dfdf897` | 2701/2701 | 1570 | 251 | 1198 | 845 |
| C# / PowerShell | 26 | `db6ffb853801d9d8` | 6253/6253 | 4832 | 177 | 173 | 773 |
| PHP / PHPUnit | 33 | `c679ceb75c2b646d` | 624/624 | 240 | 0 | 248 | 384 |
| Ruby / Rake | 14 | `a8317d3c0232ca03` | 2635/2635 | 21 | 215 | 244 | 1086 |
| Swift / swift-nio | 22 | `83291876164deb16` | 982/982 | 0 | 0 | 0 | 982 |

The legacy comparison groups by file, label, and target. On identical draws
the Rust oracle update brought legacy unexplained analyzer rows from four to
zero. The Ruby change covered all five previously missing `options` rows in
`lib/rake/application.rb`. Ruby endpoint missing stayed at 215 and unexpected
rose from 238 to 244. Swift's zero endpoint matches reflect absent source
attribution in the oracle rows. None of the five samples passed the endpoint
gate.

Local `bb_search` located override implementations and declared staleness
for one result in the wider query. `bb_graph` on
`resolveGraphRootDetailed` exposed the traversal entry points and reported
`caller-depth-cap-reached`. The source and scratch-index checks established
the behavior of the changed code.

## Swift and PHP follow-up

All 22 Swift and 33 PHP fixtures passed. The targeted Swift probe exercises
two callers of one target, a dropped-caller negative control, duplicate
overload names, operator callers, enum conversion, and local override
signature evidence. The PHP probe exercises braced and semicolon namespaces,
grouped and ordinary aliases, case-insensitive method names, function import
exclusion, and ambiguous stored endpoints. The cross-language override
evidence probe, comparator self-test, and both TypeScript checks passed.

| Corpus | Draw hash | Verified endpoints | Missing | Unexpected | Unknown oracle source | Unverified analyzer |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| SwiftNIO, 30 files | `83291876164deb16` | 458 | 0 | 0 | 846 | 1805 |
| SwiftNIO and Alamofire, 60 files | `83291876164deb16`, `d14de4ee5dd13bec` | 1096 | 0 | 0 | 1644 | 3608 |
| PHPUnit, 30 files | `c679ceb75c2b646d` | 240 | 0 | 248 | 384 | 396 |

The identity gate remains red for each scope. Swift's oracle supplies named
callers from the shared grammar and leaves overloaded names and unsupported
scopes unknown. Its local signature comparison works on written syntax and
does not perform type substitution or resolve type aliases. PHP's internal
class lookup now uses namespace identity, while public member keys and the
cross-file companion still use the existing name format.

The differential now limits printed examples per discrepancy type. Before
the change, unknown-source examples could hide all missing-edge examples.
This exposed an Alamofire mismatch where the oracle spelled the operator
caller `==` and the analyzer published `operator ==`. The regression
covers the corrected spelling.

The installed bb navigation skill listed `symbol` as a search argument.
The live tool refused it and accepted `symbolName` in exact symbol mode.
The canonical skill now lists the mode-specific arguments. The exact lookup
returned one stale Swift result. An earlier auto-refresh attempt reported
a read-only index, so source and runtime probes supplied current evidence.

## Nested callable attribution

The Swift oracle now compares source identities for more uses, construction,
heritage, render and import-reference relationships. The new source coverage
exposed a read in Alamofire's nested `requestForSegue` that was attributed to
`MasterViewController`. The Swift analyzer now preserves the nested function
source. The bare-member oracle still uses the analyzer's member inventory.

The Ruby oracle now distinguishes calls from uniquely named methods and
attributes literal load facts to file scope. It exposed three Rake calls
from the nested `execute` method that were assigned to
`load_debug_at_stop_feature`. The analyzer now emits the nested declaration
with lexical ownership and analyzes its locals independently. The Ruby
oracle also treats an unbound call receiver as an evaluated expression.

| Scope | Draw hash | Matched | Missing | Unexpected | Unknown oracle source | Unverified analyzer |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| SwiftNIO and Alamofire, 60 files | `83291876164deb16`, `d14de4ee5dd13bec` | 2573 | 0 | 0 | 1145 | 2132 |
| Rake, 30 files | `a8317d3c0232ca03` | 1174 | 181 | 204 | 583 | 676 |
| Ripgrep, 30 files | `96f9b23c8dfdf897` | 2140 | 0 | 624 | 846 | 1459 |
| PowerShell, 30 files | `db6ffb853801d9d8` | 5005 | 0 | 0 | 770 | 1576 |

The endpoint gates remain red. The Rust comparison exposed an analyzer bug
in nested grouped imports. It now preserves every prefix segment, with a
regression covering `std::io` and `std::path`. The Rust oracles also retain
read owners, nearest import scopes, and qualified implementation owners.
The C# oracles now use the primary type for using references, preserve nested
type and qualified construction identities, and compare interface-member
overrides through the dedicated oracle in endpoint mode.

Swift still lacks source identities for
some scopes. Ruby's printed missing examples include external override
guesses whose target spelling differs from the analyzer output. The Rack
oracle audit also reported residual disagreements. PHP's external visibility
index is still keyed by class leaf, which is insufficient to rule out a
method on a specific namespaced class.

All 129 scoped fixtures passed across Ruby, Swift, PHP, Rust, and C#.
The targeted production parser probes, the dedicated C# oracle regression,
and the edge-identity comparator self-test passed. An exact bb lookup for the Swift oracle returned no match and
declared the differential source file stale. Source inspection supplied
the current code.

## Rust and Ruby endpoint reconciliation

The Rust oracle now preserves distinct declaring sources for type references
and derives caller identities and local qualified member targets from the
tree. Macro invocations and constructions keep the enclosing source. The
containment oracle includes associated types and wrapped implementation
owners. These are checks of the analyzer's published relationship tuples
using the same grammar. They do not run macro expansion or independently
resolve compiler bindings.

Ruby's class-method visibility directives now update singleton-method
visibility without publishing a call from the declaring class. A qualified
superclass cannot acquire structural evidence from a different in-file class
that shares its leaf name. The oracle now follows evaluated load arguments
and compound-assignment receivers and derives the alias edges the lane
publishes. The analyzer now uses the declared operator or setter name on
an alias edge. Before the change, `alias [] new` could name `new`. The endpoint gate reports guessed targets separately. A matching
guess cannot satisfy a verified edge, and a verified duplicate takes
precedence over a guessed row with the same spelling.

| Scope | Draw hash | Matched | Missing | Unexpected | Oracle source unknown | Oracle target unverified | Analyzer unverified |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ripgrep, all 110 Rust files | `781671e47d4a8a2d` | 23868 | 0 | 0 | 0 | 0 | 0 |
| Cargo, 30 files | `33e8ced8d3e9562b` | 2193 | 0 | 0 | 0 | 0 | 0 |
| Rake, 30 files | `a8317d3c0232ca03` | 1342 | 0 | 0 | 490 | 188 | 711 |
| Rack, 30 files | `937137dda6059008` | 874 | 0 | 0 | 378 | 28 | 442 |

All 34 Rust and 14 Ruby fixtures passed. The targeted parser probe checks
qualified Rust calls, repeated type targets, construction and containment,
Ruby singleton visibility and qualified base collisions, and a negative
control for a missing Rust caller. The comparator self-test passed. The bb
symbol lookup located the Ruby oracle and reported one stale match. The
source and parser runs established the current behavior.

## Expanded batch verification

| Scope | Draw hashes | Matched | Missing | Unexpected | Oracle source unknown | Oracle target unverified | Analyzer unverified |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| PowerShell and FSharp C#, 200 files | `9c00c0d55173e454`, `e5c364ff05052789` | 29128 | 0 | 0 | 0 | 0 | 0 |
| PHPUnit and phpMyAdmin PHP, 200 files | `1a6bc2f271397147`, `bda016b26ec392a8` | 9722 | 0 | 0 | 0 | 0 | 0 |
| SwiftNIO and Alamofire, 60 files | `83291876164deb16`, `d14de4ee5dd13bec` | 5276 | 0 | 0 | 0 | 0 | 0 |
| Rake and Rack Ruby, 60 files | `a8317d3c0232ca03`, `937137dda6059008` | 3160 | 0 | 0 | 0 | 216 | 217 |

The preceding full ripgrep and sampled Cargo results remain the Rust controls.
These gates compare distinct relationship tuples. Repeated Swift and Ruby
callable names are distinguished by the containing declaration's start line
when the reported site identifies exactly one declaration. A missing site or
two declarations sharing that line remains unverified. The underlying grammar
and some semantic helpers remain shared with production.

Production fixes cover C# local function symbols and call ownership, PHP
anonymous-class method symbols and call ownership, and Swift overload
deduplication for calls, reads, and constructions. Swift symbol ranges now
extend through the body. A separate scratch-store regression verifies distinct
source IDs for two overloaded callers. Ruby exports now carry `fileLevel` so
the store records the owning path.

All five fixture suites passed with 129 cases total. The new four-language
oracle control includes negative edge removal and duplicate Ruby callers.
The existing override, graph-root, and comparator controls passed. Both
TypeScript checks and the package build passed.

The five-language index parity test modifies the target name in each file,
compares the incremental graph with a clean rebuild, then deletes the Swift
file and compares again. Its first sandbox run failed the required-worker
assertion after worker startup fell back to serial. The unrestricted run
used the real worker pool and passed. The file-level Ruby export assertion
also passed in the serial run. This fixture establishes parity for its local
edits and deletion, while cross-file invalidation needs additional cases.

An attempted Roslyn run was rejected because that repository has no recorded
pin in this corpus registry. The registered second C# corpus is FSharp, and
its pinned checkout supplied the reported results.

Ruby's 216 external override candidates remain unverified and keep the full
Ruby endpoint gate red. PHP's qualified cross-file resolution and independent
compiler-backed semantic checks remain open. This pass establishes the listed
corpus and regression results.

## Namespace and override follow-up

This run followed the current batch through the actual worker and store paths.
It reproduced the following failures before changing their production rules:

- A PHP imported base's inherited call remained unresolved when another
  namespace declared a class with the same short name.
- `namespace\\Service::Run()` bound to a service in another namespace because
  the grammar's `relative_name` receiver had no owner metadata.
- Correct direct-analyzer results lost namespace metadata in the worker's
  allowlist. The required-worker test failed even though the direct test passed.
- An incremental alias change could overwrite receiver resolution with the
  generic name resolver's result. Deletion-only updates did not run derived
  repair, leaving obsolete cross-file flags behind.
- Property syntax could qualify and resolve to a same-named method. PHP now
  distinguishes calls and tear-offs, properties, and class constants in this
  resolution path. Only methods receive case folding.
- Ruby's optional `BB_RUBY_INDEX_CONSUME=1` path certified `Wanted::Base.run`
  using a different namespace's `Base`. Its merged member-name set also lacked
  evidence for distinguishing instance and singleton methods. Name matches now
  remain inferred candidates; local override lookup uses distinct method tables.

The PHP regression uses eight files, 13 call rows, six member reads, and two
real `bb_graph` handler queries. It includes duplicate class leaves in one file,
import aliases that reset between namespace blocks, missing qualified and
unqualified classes, namespace-relative receivers, and case-sensitive property
and constant negatives. Reconciliation corrects deliberately misbound rows and
performs zero row writes against an already-correct graph. Its pipeline mode
compares all stored relationships, target files, source declaration lines,
confidence, and cross-file flags after an alias change, base deletion, and base
restoration with clean full indexes. The final run required real workers and
passed; sandbox worker startup had previously failed and was not counted as
worker verification.

| Check | Command | Result |
| --- | --- | --- |
| PHP extraction and worker projection | `bun validation/m14/verify-php-receiver-identities.mts` | Passed |
| PHP worker, graph, and incremental parity | `bun validation/m14/verify-php-stored-namespaces.mts --require-worker` | Passed; alias change, delete, and restore |
| PHP algorithm mutation controls | `bun validation/m14/verify-php-namespace-mutations.mts` | Control passed, all six mutations killed |
| PHP existing fixtures | `bun script/m14/run-fixtures.ts --lang php` | 33 passed |
| PHP namespace override regression | `bun validation/m14/verify-php-override-namespace.mts` | Passed |
| PHP corpus | `bun script/m14/differential.ts --lang php --sample 100 --check-edge-identities` | 200 files, 9,722 matched; zero missing, unexpected, or unverified |
| Ruby override and index evidence | `bun validation/m14/verify-ruby-project-index-evidence.mts` | Passed, including local dispatch-kind positives and negatives |
| Ruby algorithm mutation controls | `bun validation/m14/verify-ruby-override-mutations.mts` | Control passed, all three mutations killed |
| Ruby index-consumer contract | `BB_RUBY_INDEX_CONSUME=1 bun script/m14/ruby-index-consume.ts` | Ten checks passed |
| Ruby existing fixtures | `bun script/m14/run-fixtures.ts --lang ruby` | 14 passed |
| Ruby corpus | `bun script/m14/differential.ts --lang ruby --sample 30 --check-edge-identities` | 60 files, 3,160 matched; zero comparable mismatches, 216 oracle targets and 217 analyzer rows unverified; gate remains red |
| Five-language worker parity | `bun validation/m14/verify-batch-index-parity.mts --require-worker` | Passed; Rust, C#, PHP, Ruby, Swift |
| TypeScript import invalidation | `bun validation/m14/verify-incremental-import-parity.mts --require-worker` | Passed; module addition, removal, and deletion |
| Oracle identity and graph-root controls | `verify-batch-oracle-identities.mts`, `verify-graph-impact-root-file.mts` | Passed |
| Freshness envelope | `bun script/m35/verify-envelope-contract.ts` | 37/37, eight negative cases |
| Freshness CLI flags | `bun script/m43/verify-a3-flag-semantics.ts` | 32/32, two negative cases |
| Generated tool references | `bun script/verify-tool-docs.ts --only <tool>` for the six changed pages | Passed |
| Source and script types, build | `npm run typecheck`, `npm run typecheck:scripts`, `npm run build` | Passed |

Corpus draws remain `1a6bc2f271397147` / `bda016b26ec392a8` for PHP and
`a8317d3c0232ca03` / `937137dda6059008` for Ruby. These are tuple comparisons
over the pinned draws, not compiler-backed semantic certification. Mutation
controls replace executable production decisions during module load rather
than altering output objects. PHP controls remove owner identity, canonical
parent resolution, method case folding, relative receivers, member-kind
filtering, and bound-target reconciliation. Ruby controls merge the dispatch
tables, promote the project-index candidate back to structural confidence, or
disable the local ancestor walk. All three were killed in the final run.

The bb navigation call for `resolveMemberTargetsByOwner` returned one fresh,
untruncated match. The Ruby symbol lookup returned no match with one stale
file; direct source and runtime probes established its current behavior. That
stale answer's remediation used `bb index "<file>"`, which the CLI interprets
as a project directory. Both envelope variants now specify
`bb index --file "<file>"`, and the six generated reference pages were checked.

Remaining work: PHP's implicit cross-file override generation is still absent
from the companion pass, and qualified identities for heritage, construction,
and overrides need their own store assertions. Ruby's shallow index cannot
establish lexical constant binding or dynamic method dispatch; the 216
external targets are still excluded from verified coverage. Runtime verification
was subsequently added for the targeted cases below. The shared resolver's added project-wide reads
have fixture verification but no large-project performance benchmark yet.

### Independent PHP and Ruby execution

The native runtimes were initially unavailable. Distribution packages were
downloaded from the configured Ubuntu mirror and extracted into
`/tmp/bb-language-runtimes/root`; no system installation or project dependency
change was needed. The required binaries are PHP 8.3.6 and Ruby 3.2.3.

`validation/m14/verify-php-ruby-native-bindings.mts` requires interpreters and
fails when they cannot run. It compares seven stored PHP call destinations
against native execution of the exact analyzed files. Controls cover class
import aliases, a qualified receiver, namespace-relative receiver, inherited
and `parent::` calls, case-insensitive lookup, and an absent class. Ruby's
native `UnboundMethod#super_method` determines five source/dispatch/target
tuples from the exact analyzed program, including instance/singleton negatives
and methods declared by a grandparent.

The initial grandparent comparison failed: the analyzer checked only the
immediate parent's declarations and omitted both instance and singleton
overrides through an empty intermediate class. The local analyzer and its
separate oracle now walk eligible in-file ancestors, stop at the nearest
declaration, and guard cycles and namespace ambiguity. The native comparison,
all 14 Ruby fixtures, three Ruby mutation controls, caller regression, and
four-language identity controls passed after the change. The 60-file Ruby
draw remained at 3,160 matched and 216 oracle targets unverified, with no
comparable mismatches. Source/script type checks and build passed again.

Executed native check:

```sh
PHP_BIN=/tmp/bb-language-runtimes/root/usr/bin/php8.3 \
RUBY_BIN=/tmp/bb-language-runtimes/root/usr/bin/ruby3.2 \
LD_LIBRARY_PATH=/tmp/bb-language-runtimes/root/usr/lib/x86_64-linux-gnu \
bun validation/m14/verify-php-ruby-native-bindings.mts
```

It returned `passed: true`, `phpCallBindings: 7`, and `rubyOverrides: 5`.
Binary package SHA-256 values:

| Package | SHA-256 |
| --- | --- |
| `php8.3-cli_8.3.6-0ubuntu0.24.04.13_amd64.deb` | `6868966e46f777624f8cdfd3c38dfb2a7b6c2654bcacda57dc2049ecc9ca566b` |
| `ruby3.2_3.2.3-1ubuntu0.24.04.8_amd64.deb` | `6f11e297b3508e8db95a5a047126a16ccf1358292049a27e3dc72b88180e779a` |
| `libruby3.2_3.2.3-1ubuntu0.24.04.8_amd64.deb` | `77c2e98ccfba2c4a4e5edb48ca8c0eb041702e1579eabc40cf07064fd4f3033e` |

These interpreter checks establish the tested bindings and inheritance cases.
They supply no runtime comparison for the external corpus override candidates,
which require loading each project's actual dependencies and execution context.

## PHP sequential completion pass: project overrides

The active language is PHP; other analyzer reviews are queued. A project-level
override reconciler now derives implicit class-method candidates from canonical
stored class identities and exact source/target symbol IDs. It follows imported
parents through intermediate files, uses case-insensitive method lookup, and
withdraws stale PHP override rows after a hierarchy change. It does not reuse
the leaf-keyed companion index. Signature compatibility remains unchecked, so
these stored relationships explicitly carry inferred evidence at 0.85.

The new ten-file regression failed before implementation because the two
cross-file relationships were absent. Native PHP 8.3.6 reflection agrees with
three valid override tuples. Separate parsed controls reject private ancestors,
final-method redeclarations, static/instance mismatches, visibility narrowing,
duplicate class identities, and cyclic inheritance. Invalid controls are not
loaded into the native program. Both `bb_graph` and `bb_impact` return the
correct overriding method. An unchanged, enriched graph causes zero writes
when reconciled again.

The required-worker test passed through parent-alias modification, parent-file
deletion, and restoration without reparsing the child file; its override graph
matches a clean full index after the alias change. The first worker run exposed
a no-op bug: enrichment had added metadata, and comparing the whole metadata
string forced every override to be rewritten. The reconciler now compares only
its own fields and retains other metadata on unchanged rows. Changed child
sources and targets enter the bounded enrichment/gravity work set.

Verified commands:

- `PHP_BIN=/tmp/bb-language-runtimes/root/usr/bin/php8.3 bun validation/m14/verify-php-project-overrides.mts --require-worker --native` — passed.
- `bun validation/m14/verify-php-project-override-mutations.mts` — control passed; all eight executable-decision mutations rejected.
- Existing PHP fixtures — 33 passed. Namespace/member and worker-projection regressions passed.
- The pinned 200-file PHP tuple comparison remained at 9,722 matched, with zero missing, unexpected, source-unknown, or unverified rows.
- Source/script type checks and build passed.

PHP remains active. Canonical store binding for construction, heritage, trait
composition, and declared-type references is the next closure item. This
project override pass does not certify signature variance or runtime loading.

## PHP sequential completion pass: canonical types and unknown receivers

Canonical type binding now covers heritage, interface implementation, trait
composition, construction, class imports, and declared-type references. The
seven-file type regression checks 32 distinct stored tuples, eight class
imports, a file-level construction, and 20 native PHP reflection/execution
results. Its real-worker run passed alias modification, deletion, restoration,
and clean-index comparisons. Eight executable-decision mutations were killed.
The separate oracle derives namespaces and import aliases without importing the
production resolver. Parent-type derivation no longer reads analyzer class
symbols: both sides independently preserve the parent of each same-named class
in separate namespaces.

This exposed and fixed return types missing namespace metadata, class/enum
sources displaced onto enclosed properties/cases in direct storage, omitted
namespace-relative construction, and concrete targets asserted for late static
binding. Late-bound constructor and type-reference rows remain unverified in the
endpoint comparator. Native checks also refuted three historical same-leaf
fixture expectations: global and namespaced declarations of the same leaf are
different types, while an exact qualified self-reference is self-heritage. Those
expectations and the oracle were corrected against native evidence.

All 34 registered PHP fixtures passed. The fixture coverage check reports 67
handled types, 201 occurring fixture types, zero uncovered handled types, zero
ambiguous types, and zero dead literals. The final pinned 200-file comparison
has 9,720 comparable tuples matched, zero missing/unexpected/source-unknown,
and two late-bound reference targets explicitly unverified on each side. The
full endpoint gate therefore remains open. The Swift
stored-overload regression was used to reject a broad source-line change; the
final source-span rule applies specifically to PHP type facts, and both checks
pass. This was regression verification, not a switch to reviewing Swift.

The next store probe reproduced arbitrary name binding for five untyped
receiver forms: calls, nullsafe calls, property reads, dynamic class constants,
and method tear-offs. They now retain their relationship rows and literal target
names with null target IDs. Known class receivers and plain function calls still
bind. A native ten-result control demonstrates that the same untyped function
can call Alpha or Beta depending on its argument. The real-worker check passed
changing one receiver to a named class and back through incremental indexing.
Both receiver-claim mutations were killed; no-op reconciliation performs zero
writes. Actual `bb_graph` queries omit the false callers and preserve the known
caller; the ambiguous `run` root explicitly reports three candidates.

The older owner-resolution gate was corrected too: its required AlphaStore
misbinding is now an unresolved negative, namespace-specific Twin parents are
positive controls, and signal-removal tests remove both legacy and canonical
identity fields. It passes with three direct and two inherited resolutions.

Commands added:

- `PHP_BIN=/tmp/bb-language-runtimes/root/usr/bin/php8.3 bun validation/m14/verify-php-type-identities.mts --require-worker --native`
- `bun validation/m14/verify-php-type-identity-mutations.mts`
- `PHP_BIN=/tmp/bb-language-runtimes/root/usr/bin/php8.3 bun validation/m14/verify-php-unresolved-receivers.mts --require-worker --native`
- `bun validation/m14/verify-php-receiver-claim-mutations.mts`
- `bun script/m14/verify-fixture-coverage.ts --lang php`

Source/script type checks and build passed. PHP remains active. Remaining
semantic work includes function namespace/import resolution, receiver inference,
method-signature compatibility, and trait adaptation/dispatch. These tests
establish their listed cases; they do not justify a whole-language perfection
claim or advancing another language ahead of PHP.

## PHP sequential pass: function namespace identities

Function calls, tear-offs, and function imports now retain ordered canonical
lookup candidates. `use function` has a separate alias table; grouped and mixed
imports, namespace-prefix imports, absolute names, namespace-relative names,
case-insensitive function identity, namespace-first lookup, and global fallback
are covered. The stored resolver considers functions only. Ambiguity in a higher
priority namespace blocks fallback, and name-only bindings to methods are
withdrawn. Missing targets stay unresolved. Reconciliation writes zero rows on
an unchanged graph and includes changed endpoints in incremental enrichment.

A builtin leaf is insufficient to suppress a call: `Library\\count` may name
user code, and a namespaced `count()` may have a project shadow in another file.
Only a single global builtin candidate is safely omitted. WordPress registrar
calls are retained without claiming callback execution. The old fixture and
output-mutation expectations that suppressed these facts were corrected.
Nested named functions also retain their braced namespace when published.

Verification:

- `PHP_BIN=/tmp/bb-language-runtimes/root/usr/bin/php8.3 bun validation/m14/verify-php-function-identities.mts --native --require-worker`: nine files, 27 function facts; native dispatch and callable identity; duplicate/function-vs-class controls; real workers; import changes; changes in another file affecting untouched global-fallback callers; deletion/restoration; clean-index parity. Production `bb_graph` and `bb_impact` handlers distinguish global and namespaced functions with the same leaf.
- `bun validation/m14/verify-php-function-identity-mutations.mts`: control passed, all eight executable-decision mutations killed (aliases, fallback, qualified names, builtin suppression, target kinds, ambiguity, stale binding, nested namespace).
- `bun script/m14/run-fixtures.ts --lang php`: all 35 fixtures passed.
- `bun script/m14/mutate-analyzer.ts --lang php`: all 79 registered output mutants caught. These remain output transformations, separate from the source-level checks above.
- `bun script/m14/verify-fixture-coverage.ts --lang php`: 67 handled types, 201 fixture types, zero uncovered/ambiguous/dead literals.
- `bun script/m14/differential.ts --lang php --sample 100 --check-edge-identities`: 9,945 matched, zero missing/unexpected/source-unknown, two oracle target-unverified and two analyzer-unverified. The endpoint gate remains open on late-static return targets. Draw hashes remain phpunit `1a6bc2f271397147`, phpMyAdmin `bda016b26ec392a8`.
- Source typecheck, script typecheck ratchet, and build passed.

The bb symbol lookup found the changed analyzer method and reported it stale.
Its automatic refresh was refused by the read-only sandbox for `~/.bb`; source
and fresh isolated test indexes supplied verification. No empty/stale answer was
treated as evidence of absence. PHP remains active. Static function declarations
do not prove runtime availability under conditional declarations, dynamic loading,
or eval. Nested-body source attribution, receiver inference, method-signature
compatibility, and trait adaptation/dispatch remain closure work.

### Nested source-attribution follow-up

Direct execution of `nested-named-functions.php` showed the current body walker
already emits `nestedHelper -> decorate`, not `registerHelper -> decorate`.
The source comment and analyzer documentation describing the former defect were
stale. Corrected them and added an exact count plus a forbidden outer-source
edge to the fixture. The function identity verifier also exercises a nested
function inside a braced namespace, compares its stored endpoint to native PHP,
and rejects a ninth source-level mutation that restores outer attribution.
Native direct verification, all nine mutation controls, and all 35 fixtures pass.
There is no new production algorithm change in this follow-up. Receiver inference,
signature compatibility, and trait adaptation/dispatch remain active PHP work.

## PHP stable parameter receiver inference

`php-receiver-types.ts` derives scope-local, single-class parameter identities.
Nullable parameters are admitted; union/intersection and variadic parameters,
references, assignment, capture, unknown argument escapes, and dynamic local
binding operations decline inference. Each closure/nested function has its own
parameter environment. The resulting owner passes through the existing canonical
member resolver, while the written target spelling remains unchanged. Evidence
is explicitly inferred at 0.8; this is static declaration lookup, not proof of
the runtime implementation selected by subtype dispatch.

The self-parameter control exposed a separate direct-store source error when a
method and property share a line. PHP member facts now use their named source
and containing span, matching the existing PHP type/function source treatment.
The type-source mutation anchor was updated after the earlier function guard
extension; all eight type-identity source mutations now execute and fail again.

Verified commands/results:

- `PHP_BIN=/tmp/bb-language-runtimes/root/usr/bin/php8.3 bun validation/m14/verify-php-parameter-receivers.mts --native`: passed, 26 member facts. Native execution verifies the positive bindings and demonstrates why reassignment, reference escapes, captures, and dynamic writes cannot retain the initial type.
- The same command with `--require-worker`: passed with real workers, graph queries, incremental withdrawal on reassignment, and restoration after reverting it.
- `bun validation/m14/verify-php-parameter-receiver-mutations.mts`: control passed; all four executable-decision mutations killed.
- `bun validation/m14/verify-php-type-identity-mutations.mts`: control passed; all eight mutations killed, including source attribution.
- Unresolved-receiver, canonical-type, and function-identity regression scripts passed.
- PHP fixtures: 36 passed. Source typecheck and build passed.
- The 200-file endpoint draw remains 9,945 matched, zero missing/unexpected/source-unknown, and two late-static targets unverified on each side. Its certification gate remains open.

No later language was advanced. Remaining PHP work includes broader receiver
flow/property chains, override signature compatibility, and trait adaptation
and dispatch. These bounded results do not establish whole-language perfection.

## PHP override calling-shape checks

The analyzer now extracts method calling shapes from AST fields and transports
them through workers. Both local and project override selection reject proven
arity/variadic/reference incompatibilities. Required arity includes the position
of a required argument following an optional one. A concrete constructor's
signature exception is preserved; an abstract constructor's contract is checked.
The generic parameter extractor also now reads the actual `default_value` field,
avoiding reference/visibility modifiers as invented defaults, and stops marking
every promoted property parameter optional.

Type variance is explicitly **unchecked**. Stored overrides remain inferred at
0.85 and add `signatureShapeChecked`; this work does not establish full PHP
signature compatibility. Rules were checked against the PHP manual's
[signature compatibility](https://www.php.net/oop5.basic) and
[constructor inheritance](https://www.php.net/oop5.decon) documentation and native
PHP 8.3.6 execution.

Validation:

- `PHP_BIN=/tmp/bb-language-runtimes/root/usr/bin/php8.3 bun validation/m14/verify-php-signature-shapes.mts --native --require-worker`: 20 isolated cases, 10 valid override candidates, all native/compiler verdicts agree. Real worker transport, zero-write no-op, and incremental withdrawal/restoration pass.
- `bun validation/m14/verify-php-signature-shape-mutations.mts`: control passes; bypassing the compatibility decision is killed.
- Existing eight project-override algorithm mutations are all killed.
- All 36 PHP fixtures, source typecheck, and build pass. The 200-file corpus remains 9,945 comparable matches, zero mismatches, and two explicitly unverified late-static targets on each side.

**New unresolved defect:** compressing the two classes and same-named methods
onto one line makes the direct stored graph lose the expected overrides, even
though analyzer extraction agrees with native PHP. Reproducer:
`bun validation/m14/verify-php-signature-shapes.mts --same-line` (expected failure
until repaired). The normal signature matrix keeps declarations on separate
lines to isolate signature semantics; the compact case remains a tracked
storage-identity defect, not a passing result. PHP remains active for this defect,
type variance, broader receiver flow, and trait adaptation/dispatch.

A further native probe establishes another open constructor case: abstract
`A::__construct($a)`, concrete `B extends A::__construct($a)`, and concrete
`C extends B::__construct()` is rejected by PHP because A's abstract contract
persists. The nearest concrete-constructor exception currently does not walk
back to that contract. This is an identified remaining compatibility defect;
the 20-case matrix checks direct abstract/concrete parents only.

## PHP constructor ancestry and same-line symbol repair

The preceding constructor and compact-source defects are repaired. Both local
and project override checks now walk past concrete constructor declarations to
check inherited abstract calling-shape contracts. The native matrix contains
24 cases and 11 accepted child overrides. Removing the ancestor-contract guard
is a separate executable mutation, alongside the existing shape bypass.

PHP declarations with the same name and starting line now receive distinct IDs
using their byte offsets. The store's span index and semantic snippet records
use those IDs. Byte containment selects same-named class owners, and body edges
carry the declaring callable's byte start so same-line callers remain distinct.
These rules are scoped to PHP. The Swift stored-overload regression still passes.

Verified:

- `PHP_BIN=/tmp/bb-language-runtimes/root/usr/bin/php8.3 bun validation/m14/verify-php-signature-shapes.mts --native --same-line --require-worker`: 24 native verdicts agree, 11 child overrides, real-worker transport and incremental withdrawal/restoration pass. The former `--same-line` reproducer is now a passing regression.
- `bun validation/m14/verify-php-same-line-symbols.mts --require-worker`: two namespace-scoped classes on one line retain four methods and exactly two correct source-owner/target-owner call pairs. Direct storage passes too.
- PHP type-identity mutation suite: all eight killed. The former span-guard deletion became redundant after exact source IDs were added; replaced it with discarding an established source ID, which the same assertions reject.
- Function identity and parameter receiver regressions, all 36 PHP fixtures, source typecheck, build, and Swift stored-overload regression pass.

User order updated: PHP remains active, **TypeScript is next**. Remaining PHP
work includes type variance, trait adaptations/dispatch, and broader receiver
flow. The results above do not certify those remaining semantics.

## PHP bounded type variance

Method signature metadata now includes AST-derived type expressions in union-of-
intersection form, with canonical names resolved in the declaration's namespace.
Both local and project override resolution reject incompatible parameter types
(contravariant) and return types (covariant). Scalar/literal types, nullable and
implicit-null parameters, unions, intersections/DNF, class/interface inheritance,
aliases, lexical self, iterable/array, mixed, void, and never are represented.
Ancestor abstract constructor contracts receive the same variance check.

The comparator is three-valued. Missing/duplicate/cyclic type declarations,
object-to-callable questions, and version-sensitive static return types do not
produce a fabricated incompatibility verdict. Stored candidates remain inferred
at 0.85 and record signatureCompatibility as checked only for known comparisons;
otherwise unchecked. Body validity and full PHP program validity are not proved.
The [PHP variance manual](https://www.php.net/oop5.variance) documents a PHP 8.5
change for static return types in final classes; native validation here is 8.3.6,
so that version-sensitive case is deliberately left unknown.

Verification: 53 isolated native compile checks agree with analyzer and stored
results (26 accepted child overrides), including same-line real-worker transport
and incremental withdrawal/restoration. The split-file mode also places parent
and child declarations in separate files for production hierarchy verification.
Three source-level mutations are killed: calling-shape bypass, inherited
constructor guard removal, and variance bypass. All eight project override
mutations are killed; the ambiguity mutation now replaces both occurrences of
the ancestor guard, rather than mutating only the newly added constructor scan.
All 36 PHP fixtures, source/script type checks, and build pass. The 200-file
endpoint result remains 9,945 matched with zero mismatches and two explicitly
unverified late-static targets per side.

Commands: `verify-php-signature-shapes.mts --native --same-line --require-worker`,
`verify-php-signature-shapes.mts --native --split --require-worker`, and
`verify-php-signature-shape-mutations.mts` under `validation/m14/`, with PHP_BIN
set to the extracted PHP 8.3.6 runtime. PHP remains active; TypeScript is next.

## PHP direct override parity

The direct analyzer previously emitted edges for final methods, static/instance
mismatches, and narrowed visibility which project reconciliation rejected. Both
paths now reject those cases. Direct extraction also abstains on cyclic local
ancestry and duplicate method declarations, instead of selecting a nearby or
last-seen declaration. Local candidates are inferred at 0.85, with checked or
unchecked signature compatibility; the former 0.95 structural classification
and in-file-verified reason overstated the bounded analysis.

The native signature matrix now has 63 cases and 31 accepted child overrides.
Two valid late-static return cases retain unchecked compatibility in both direct
and stored output. Real-worker compact-source indexing and incremental
withdrawal/restoration pass. The project hierarchy test also passes native
Reflection comparison, bb graph/impact checks, parent alias changes,
deletion/restoration, and full/incremental parity with real workers.

Six signature/modifier source mutations and all eight project override mutations
are killed. All 36 PHP fixtures pass after replacing three fixtures' obsolete
structural evidence expectations with inferred evidence. Source typecheck,
script typecheck (zero errors), and build pass. Commands are the signature and
project verification scripts above, plus `run-fixtures.ts --lang php`.

Dogfooding: bb_search reported stale index entries and a read-only auto-refresh
failure. Verification used current source and isolated writable indexes; the
stale repository index was not treated as correctness evidence. PHP remains
active, with trait dispatch and broader receiver flow next; TypeScript follows.

## PHP trait member dispatch

The prior member resolver omitted trait composition and could bind a call to a
parent implementation which a trait replaces. It also treated an interface
contract and inherited implementation as competing destinations. New canonical
PHP member lookup follows class > trait > nearest parent method precedence,
with trait aliases, exclusions, nested composition, and abstract requirements.
Interface inheritance and constants remain supported. Composition metadata is
AST-derived and survives worker transport. Older stored types without that
metadata abstain on inherited lookup until reindexed.

Native PHP exposed an initially mistaken assumption during implementation:
`A::f insteadof B; f as alias` is still ambiguous when both traits declare f.
The implementation now leaves that alias unresolved; a dedicated source
mutation restoring the incorrect behavior is rejected. Qualified aliases can
expose the excluded implementation, as checked independently by PHP execution.

`verify-php-trait-dispatch.mts --native --require-worker` checks 22 stored
call/read destinations (including explicit null targets), exact multiplicity,
cross-file flags, zero-write reconciliation, and seven bb_graph caller rows for
one trait. Native execution checks 12 method results and three property/constant
values, plus rejection of the ambiguous alias. Worker tests change trait
adaptations, compare with a clean index, delete trait declarations, and restore
them. Missing traits, cycles, unresolved conflicts, and version-sensitive
property/constant collisions must remain unbound.

Eight source mutations cover composition removal, alias removal, precedence,
exclusions, conflicts, unqualified alias ambiguity, and local/project override
walks skipping composed methods. Existing namespace mutations now target the
new resolver's executable decisions; all six pass. The owner-resolution gate
now expects DupBase's implementation over DupIface's contract, with three
direct and three inherited resolutions. Parameter receiver and unknown receiver
mutation controls also pass. This is a bounded static declaration resolver;
trait-origin override contracts and consumer-specific dispatch inside reusable
trait bodies remain outside its guarantee. Fully qualified and multiple-name
adaptation clauses can produce errors in the pinned grammar; those compositions
abstain instead of applying a partially parsed adaptation.

Reference: [PHP trait semantics](https://www.php.net/manual/en/language.oop5.traits.php).
The current manual notes PHP 8.5 property/constant composition differences;
native verification here uses PHP 8.3.6 and makes no version-independent claim
for those collisions. PHP remains active. TypeScript is next after closure.

## PHP composed override contracts

Follow-up to the abstention boundary above: project override reconciliation now
uses effective trait member resolution and targets the original trait method.
Metadata records the consuming class and the source declaration name, including
aliases. Visibility adaptations participate in compatibility checks. Lexical
trait `self` and `parent` are stored symbolically and instantiated in the
consuming class before variance comparison; explicit type names stay distinct.
Abstract trait constructors are checked through concrete intermediate classes.
Concrete constructor signature exceptions remain intact. Per-file extraction
continues to defer trait-origin overrides to this project pass.

The dedicated `verify-php-trait-overrides.mts --native --require-worker` matrix
has 25 cases and 12 accepted child overrides. Independent PHP compilation checks
the positive and negative declarations; Reflection checks prototype identity
where PHP exposes one. Concrete constructors are declaration replacements in
this graph but do not expose a PHP Reflection prototype, so that difference is
asserted explicitly. The stored tuples check trait method IDs, composing class
identity, compatibility status, and alias destinations. Four source mutations
remove adapted visibility, consuming-class type substitution, final checks, and
inherited trait constructor checks; each is rejected. The existing eight trait
dispatch mutations and 22-destination worker regression remain required.

The 200-file endpoint draw remains at 9,945 matched tuples, zero missing or
unexpected tuples, and two explicitly unverified late-static targets per side.
This draw does not exercise project reconciliation; the native/worker matrices
provide its targeted evidence. Remaining review scope includes consumer-bound
receivers inside reusable trait bodies and broader receiver-flow boundaries.

## PHP reusable-trait receivers and final regression pass

The remaining consumer-bound receiver defect is repaired. A trait's own method
body used to bind `$this`, `self::`, and a `self`-typed parameter to the trait's
method declaration even when two consuming classes replace that method with
different implementations. Direct analysis now abstains on that receiver; the
store retains a null target. Explicit concrete typed parameters still resolve.
Relative type references and `new self/parent/static` inside a reusable trait
also retain consumer-bound evidence instead of a concrete trait target.

`verify-php-trait-receivers.mts --native --require-worker` checks seven call
sites, two relative type references, and three constructions. Native execution
checks their behavior in two consumers. The pre-fix regression failed on the
fabricated `traitreceivers\\shared` receiver; removing the trait-context guard
still fails that assertion. `verify-php-trait-mutations.mts` now checks this
ninth mutation after the eight composition/override decisions.

Final checks on the current source:

- PHP fixtures: 36 pass; coverage gate: 67 handled types, 202 fixture types,
  zero uncovered, ambiguous, or dead literals.
- All 79 output mutants are caught. These remain distinct from source mutations.
- Ordinary signatures: 63 native verdicts, 31 accepted child overrides;
  six calling-shape/variance/modifier mutations rejected.
- Trait contracts: 25 native verdicts, 12 accepted child overrides; four
  contract mutations rejected, plus the nine trait dispatch/receiver mutations.
- Native real-worker suites pass for parameter receivers, function identities,
  project overrides, type identities, trait dispatch/contracts/receivers, and
  namespace incremental repair. Graph/impact checks use those fresh test indexes.
- Function mutations: nine; namespace mutations: six; type-identity mutations:
  eight; project-override mutations: eight; stable-parameter mutations: four;
  unknown-receiver mutations: two. Each suite has a passing unmutated control.
- Source/script type checks and build pass. The 200-file draw still has 9,945
  matched tuples, zero missing/unexpected/source-unknown, and two unverified
  late-static targets on each side. Draw hashes are unchanged.

The identified defects in this PHP pass are addressed; unsupported cases remain
declared rather than converted into guessed bindings. This does not establish
full program correctness, flow/path sensitivity, dynamic loading or magic-call
resolution, call-site accessibility, every PHP version, or complete grammar
coverage. The two unverified corpus targets keep full endpoint certification
open. TypeScript remains next; no TypeScript changes were made in this pass.

## TypeScript sequential pass: scoped collection and generic receivers

The user accepted moving to TypeScript with PHP's documented limits. Initial
TypeScript fixtures: 121/121 pass. bb_search found collectLocalReceiverTypes in
both TS and JS but declared both stale; auto-refresh failed on the read-only
repository index. Current source and fresh temporary indexes supplied the
verification evidence. JavaScript was not changed.

Ordinary receiver bindings were scoped, but elementTypes and localTypeArgs were
file-wide name maps. The same `items` or `box` name in sibling functions could
change another function's method target. Unknown shadows could borrow those
facts too. Element and generic-argument facts now use the lexical binding scope;
destructured and loop bindings form shadow barriers even when their types are
unknown. Class fields no longer populate maps intended for local bindings.
Uninstantiated generic parameters are not published as concrete owner types.

A second failure appeared after fixing analyzer evidence: generic storage
resolution still attached unknown local receivers to an arbitrary same-named
method. The analyzer now emits typescriptUnresolvedReceiver for these established
local bindings, and member reconciliation withdraws the unsupported target.
This is limited to explicit unresolved local-receiver evidence; it does not
establish complete dynamic or flow-sensitive resolution.

`verify-typescript-receiver-scopes.mts` uses TypeScript 5.9.3's checker as an
independent reference. Its isolated program has no compiler diagnostics and
contains 20 method-call sites. Assertions compare source function, call-site
line, and receiver declaration identity, then verify stored endpoints and exact
bb_graph caller count. Inferred generic constructor arguments are explicitly
excluded from the syntax-only supported subset and must remain unresolved.
Loading the original analyzer from git fails the comparison, including an
Alpha array call attributed to Beta. Two executable mutations are rejected:
file-wide auxiliary lookup and skipping unresolved-receiver withdrawal.

Real-worker mode checks the same tuples plus a parameter-type edit and
restoration through incremental indexing. Existing 121 TS fixtures pass, as do
source/script type checks, build, and PHP unknown-receiver mutation controls
covering the shared storage helper. Commands:

- `bun validation/m14/verify-typescript-receiver-scopes.mts --require-worker`
- `bun validation/m14/verify-typescript-receiver-scope-mutations.mts`
- `bun script/m14/run-fixtures.ts --lang typescript`

TypeScript remains active. Next review areas include factory-return and field
owner identity, assignment-flow handling, and independent adjudication of the
uses oracle. No whole-language correctness or corpus-completion claim follows
from this targeted 20-site matrix.

## TypeScript factory bindings and caller identity

The pre-fix analyzer (61d62d327) failed the new compiler-backed matrix: a nested
or method-local `make(): Beta` contaminated calls to a module `make(): Alpha`,
and unknown shadow bindings acquired a fabricated owner. Return annotations now
belong to lexical callable bindings. Parameters, locals, and block declarations
shadow outer factories; methods cannot supply a bare function's return type.
Conflicting overload returns, uninstantiated return type parameters, and writes
to callable bindings withdraw this evidence conservatively.

The same test exposed a direct-store discrepancy: universal symbols carry
`range.startLine`, but the source fallback built an ID from missing `startLine`,
then guessed the innermost line span. A nested function ending on the same line
stole the surrounding function's call. TypeScript calls now carry their actual
source declaration offset, resolved by the store just as PHP declaration offsets
already were. Worker and direct-storage tuples agree.

Verification commands:

- `bun validation/m14/verify-typescript-factory-bindings.mts`: TypeScript 5.9.3
  accepts the fixture and independently supplies target owners; 16 complete
  source-name/site/target-owner tuples agree through analyzer and storage.
  Three named unsupported cases explicitly require unresolved targets instead
  of counting as compiler agreement. The `bb_graph` caller count also agrees.
- The same script with `--require-worker`: real worker-pool indexing, a module
  factory return-type edit, and restoration preserve all expected tuples.
- `bun validation/m14/verify-typescript-factory-mutations.mts`: independent
  file-wide lookup, skipped write invalidation, and discarded source-offset
  mutations must each fail assertions after a passing control.
- `bun script/m14/run-fixtures.ts --lang typescript`: 121/121 fixtures.

These checks cover explicit callable annotations and lexical binding, not
inferred function return types, overload selection, generic call instantiation,
or arbitrary control-flow analysis. Field ownership and broader receiver
invalidation remain separate open work; this is not TypeScript completion.

## TypeScript field bindings

Before this fix, unrelated `First.item: Alpha` and `Second.item: Beta` canceled
each other's `this.item` evidence. Static `Both.item: Beta` also contaminated the
instance member table for `Both.item: Alpha`. Field facts now key on the class
AST declaration offset and static/instance side; static fields do not populate
instance member facts. Private fields and class expressions use the same rule.
Arrows retain their class `this`; normal functions and object methods stop that
lookup. Unknown `this` field chains explicitly withdraw generic name matching.

`verify-typescript-field-bindings.mts` checks 15 source/site/owner tuples against
TypeScript 5.9.3 (zero compiler diagnostics), direct storage, bb_graph and real
worker indexing. Four explicit unsupported cases test abstention, not semantic
agreement: rebound function/object `this`, a generic field cast to any, and an
inherited field. Incremental class-field edits and restoration preserve the
expected graph. The mutation runner rejects global field maps, merged static
and instance sides, and traversal across a function that rebinds `this`.

The 121 TypeScript fixtures, previous 20 receiver-scope sites, previous 16
factory sites, and PHP stored-namespace regression pass. Source declaration
lookup now uses a per-file offset map to avoid scanning every symbol per call.
Source and script typechecks report zero errors; the build passes.

Residuals: field writes and inheritance are not flow/hierarchy resolved here.
The initial field probe also exposed a later relationship filter discarding
calls from a real method named `unknown`. The named-caller follow-up below fixes
that defect and restores the original method name in this matrix.

## TypeScript generic argument positions

The new compiler-backed matrix failed on c3e2a9451: `Pair<number, Beta>` lost
its second member's owner, while `Pair<any, Beta>.first.run()` invented a Beta
receiver. Both annotation and constructor helpers discarded unsupported argument
syntax, compressing the positional vector. They now preserve null slots and
reject visible type-parameter names as concrete receiver owners.

`verify-typescript-generic-positions.mts` checks 12 full source/site/owner tuples
against TypeScript 5.9.3, direct storage and bb_graph. Two explicitly unsupported
union/constrained-type-parameter cases require null owners rather than claiming
compiler agreement. Real worker indexing and a second-argument Beta-to-Alpha
edit/restoration pass. The mutation runner independently restores constructor
compression, annotation compression, and acceptance of uninstantiated type
parameters; all three must fail assertions with a passing control.

This is positional substitution of explicitly supplied arguments. Generic
defaults, inferred constructor arguments, constraints, and namespace-qualified
type declaration identities remain outside the established guarantee.

## TypeScript named callers

`verify-typescript-named-callers.mts` demonstrates that real methods/functions
named `unknown` were present as symbols but their outgoing calls were discarded
by the generic-source-name relationship filter. Source declaration offsets now
exempt those concrete callers from that filter. Synthetic `unknown` and block
sources without declaration evidence remain filtered.

Three compiler-backed source/site/owner tuples now pass direct storage and
bb_graph, real workers, field-type incremental edits, and restoration. The
mutation runner rejects both reintroducing the caller loss and admitting an
unproven placeholder. The original 15-field-site matrix now uses `unknown()`
again and passes through real workers; all 16 factory sites also pass after the
per-file source offset lookup optimization. PHP namespace-storage checks pass.

This does not repair the separate artifact-symbol filters for legitimate names
such as `block_7`, `lambda_1`, or some JavaScript global names. Those filters need
a declaration-provenance review across storage and query consumers; merely
relaxing this relationship filter would leave their symbols absent.

## TypeScript signature scope isolation

On 8ec5200ff, adding interface, ambient, and callable-type declarations whose
parameter happened to be named `make` erased evidence for a real module-level
`make(): Alpha`. Their parameters entered the surrounding scope and conflicted
with that runtime binding. Seven signature AST forms now establish their own
parameter scopes: function, method, abstract method, function type, constructor
type, call signature and construct signature.

The 16-site factory matrix includes all seven forms and still agrees with the
compiler-backed expectations through direct storage, bb_graph, real workers,
and incremental factory edits/restoration. The factory mutation runner now has
ten source controls: the prior three plus independent removal of each signature
scope. All ten are rejected by semantic assertions. All 121 TypeScript fixtures
and the other 20 receiver, 15 field, 12 generic-position and 3 caller sites pass.

Current new-regression totals: 46 call sites across four compiler-backed
matrices, including nine explicitly conservative abstentions; 18 rejected source
mutations across their runners. These totals describe these matrices, not corpus
precision or recall. Each matrix requires zero TypeScript compiler diagnostics,
checks analyzer source/site/owner tuples, checks stored tuples and a bb_graph
caller count, and supports a real-worker incremental edit/restoration arm.

Reproduction:

- `bun validation/m14/verify-typescript-factory-bindings.mts --require-worker`
- `bun validation/m14/verify-typescript-field-bindings.mts --require-worker`
- `bun validation/m14/verify-typescript-generic-positions.mts --require-worker`
- `bun validation/m14/verify-typescript-named-callers.mts --require-worker`
- Run the corresponding `factory-mutations`, `field-mutations`,
  `generic-mutations` and `caller-mutations` scripts in the same directory.
- `bun script/m14/run-fixtures.ts --lang typescript`
- `bunx tsc --noEmit`, `bun run audit:script-typecheck`, `bun run build`.

The shared repository bb index reported stale source and its refresh failed on
the read-only external data directory. Source navigation therefore used current
files after the stale bb_search result. Every new graph assertion used a freshly
created temporary project index; stale repository graph data was not evidence
for these fixes.

Next work remains in TypeScript: receiver reassignment/control flow; inherited
field lookup; namespace-qualified and shadowed type identities; declaration
provenance for artifact-name filters; and independent corpus adjudication of the
low-agreement `uses` oracle. Signature isolation does not establish those claims.

## TypeScript receiver writes (current pass)

The pre-fix analyzer retained initializer owners after local reassignment and
used a file-wide name check for late initialization. The new regression
reproduced false Alpha owners after assignments, destructuring, logical writes,
loop writes and closure writes; explicit `any` and union annotations also
incorrectly borrowed an initializer's class.

Write targets now resolve to the lexical binding. Inferred receiver, collection
and callable evidence is withdrawn for written bindings, including nested
patterns. Explicit supported annotations retain static declaration evidence;
this is not a runtime-dispatch guarantee. Unknown annotations no longer borrow
initializer types. A single standalone late initialization in the declaration's
block can establish a type after its source offset; conditional, repeated and
nested-scope assignments do not. Non-null receiver wrappers preserve unknown
binding provenance through storage.

`verify-typescript-receiver-writes.mts` checks 36 source/site/owner tuples with
TypeScript 5.9.3 (zero diagnostics), direct storage, bb_graph, real worker indexing
and incremental edit/restoration. Twenty-four named cases explicitly require
abstention, not compiler-equivalent type inference. Twenty-two executable
scenarios independently check actual dispatch, including Beta dispatch where
old inferred evidence incorrectly claimed Alpha. Eight source mutations restore
stale inference, pattern omissions, scope confusion, annotation fallthrough,
collection leakage, callable leakage, conditional initialization and non-null
provenance loss; all are rejected by assertions after a passing control.

Commands: `bun validation/m14/verify-typescript-receiver-writes.mts
--require-worker` and `bun validation/m14/verify-typescript-write-mutations.mts`.
The 121 TypeScript fixtures and existing 20 receiver, 16 factory (ten mutations),
15 field and 12 generic sites pass. Source and script typechecks report zero errors; the build passes.

Limits: whole-binding invalidation sacrifices some valid pre-write calls. This
is not control-flow analysis, alias tracking, or collection/field mutation
analysis. Explicit annotations describe static references, even when `any`
allows a different runtime object. The test also exposed same-line call-site
collapse in storage. The follow-up below repairs it and restores the write
matrix's before/after calls to the same line with exact offset assertions.

## TypeScript call-site multiplicity and bb graph

Twelve compiler-derived call sites became seven stored rows before the repair.
Every TypeScript call now carries its syntax start offset; the store appends a
validated offset to relationship identity. Duplicate delivery of one site still
collapses, while distinct calls to one method on one line do not.

Dogfooding exposed the matching graph-reader defect: after storage was repaired,
Alpha's seven callers still became five because spelling deduplication used only
source/target/file/line. Both graph directions now include the validated offset,
and bb_graph publishes it. The regression checks full source/line/offset/owner
tuples, Unicode before a call, nested callers, both caller owner queries, a
repeated-call callee query, and duplicate delivery. Six malformed offset shapes
must not produce claimed exact offsets. Five source mutations independently
break each layer and are rejected after a passing control.

Verification:

- `bun validation/m14/verify-typescript-call-sites.mts --require-worker`: 12/12
  tuples; exact graph offsets; worker indexing; leading-comment edit/restoration.
- `bun validation/m14/verify-typescript-site-mutations.mts`: five rejected
  mutations; malformed metadata tests included in every control run.
- `bun validation/m14/verify-typescript-receiver-writes.mts --require-worker`:
  all 36 sites with exact offsets, including both calls before/after a late
  initialization on one line; 22 executable dispatch scenarios still pass.
- All eight write source mutations, 121 TypeScript fixtures, named-caller and
  PHP stored-namespace regressions pass.
- The full `script/verify-graph.ts` suite passes with temporary data and real
  workers. A baseline rerun confirms the old M59 gate failure predates this
  change. Its repaired version now selects roots by file, asserts only calls,
  checks TypeScript as well as Java, and passes all seven checks.

Storage changes are limited to TypeScript `calls` carrying a valid offset.
Existing indexes require reindexing to gain it. Missing offsets and other
relationship kinds retain existing behavior. The source-level TypeScript checker
and script-typecheck ratchet report zero errors, and the build passes. The
final script check and worker matrix were rerun after the test updates.
The storage identity hunk was included by concurrent workspace commit
`7ff9605da`; the remaining analyzer/graph changes and evidence follow separately.

Open work remains: field/collection content writes and aliases; broader control
flow; inherited fields; namespace-qualified/shadowed type identities; legitimate
artifact-like declaration names; independent corpus adjudication of `uses`.
This pass measures targeted regressions, not whole-language precision or recall.

## TypeScript loop binding scopes

The 13-site compiler-backed loop matrix failed against the unchanged analyzer
from 008c52f15. A `var` loop's receiver was recorded in loop scope even though
its declaration belongs to function scope; closures outside that loop lost the
owner. A loop writing an existing local could create a phantom loop-local
binding and bypass write invalidation. Repeated `var` loop declarations also
reuse one binding, rather than creating independent evidence.

Loop receiver recording now uses the declaration's actual scope, or the existing
binding for assignment targets. Multiple `var` loops and `var` loops over an
already declared binding count as writes. The existing conservative invalidation
rules remain in force. `let`/`const` siblings retain independent receiver facts.

`verify-typescript-loop-bindings.mts` checks 13 full source/site/owner tuples with
TypeScript 5.9.3, zero compiler diagnostics, direct storage, both owner caller
queries, real workers, incremental source shifts and restoration. Four named
unsupported scenarios require unresolved owners instead of claiming flow-sensitive
compiler agreement. Three source mutations reinstate loop-local var evidence,
phantom existing-target scopes, and ignored repeated var declarations; all fail
assertions with a passing control. The previous 36-site write matrix and its
eight mutations, 20 receiver-scope sites and all 121 TypeScript fixtures pass.

Commands: `bun validation/m14/verify-typescript-loop-bindings.mts --require-worker`
and `bun validation/m14/verify-typescript-loop-mutations.mts`. The baseline arm
uses `BB_TS_BASELINE_SOURCE` to load the previous analyzer into the same harness.
Source and script typechecks report zero errors; the build passes.
This establishes lexical binding behavior; it does not prove loop execution,
nonempty iteration, or flow-sensitive narrowing.

## TypeScript inferred field writes

The 23-site matrix in `verify-typescript-field-writes.mts` reproduces stale
initializer owners against b08b98024: a field initialized to Alpha still claimed
Alpha after assignment of an arbitrary receiver. The repair withdraws inferred
field evidence at the declaring class and static/instance side. It covers direct
`this` writes, private fields, destructuring, logical assignments, loop targets,
arrows retaining `this`, string-keyed and dynamic computed writes, and external
receivers whose local/parameter type is known. An unknown computed key invalidates
all inferred fields on that known owner, conservatively.

Both `this` field lookup and the class member table are invalidated, so external
reads and destructuring cannot restore the stale owner. Explicit field
annotations remain static reference evidence. Unrelated classes and a normal
function that rebinds `this` do not contaminate the enclosing class. Local late
initialization and loop receiver collection now precede field write resolution;
the expanded regression failed before that ordering repair.

Verification:

- TypeScript 5.9.3 accepts the fixture with zero diagnostics. Twenty-three full
  source/line/offset/owner tuples pass direct analysis, storage and bb_graph.
  Sixteen named scenarios explicitly require conservative abstention rather
  than claiming compiler-equivalent inference.
- Fifteen executable scenarios independently confirm dispatch after writes,
  including private, computed, destructured, static, late-bound and loop-bound
  receivers. The annotated-field control deliberately demonstrates the limit:
  `any` can produce Beta runtime dispatch despite an Alpha static annotation.
- Real worker indexing, an offset-shifting edit and restoration preserve all
  expected tuples.
- Five source mutations independently restore stale `this` fields, stale external
  member tables, cross-owner invalidation, missing write patterns and missed
  static writes. Every mutant is rejected after a passing control.
- All 121 TypeScript fixtures, the 36-site local-write matrix (22 executions),
  the existing field-scope and loop mutation matrices, 16 factory sites and
  12 generic sites pass. Source and script typechecks report zero errors; the
  build passes.

Commands: `bun validation/m14/verify-typescript-field-writes.mts --require-worker`
and `bun validation/m14/verify-typescript-field-write-mutations.mts`. The baseline
arm uses `BB_TS_BASELINE_SOURCE` to run the unchanged analyzer in the same harness.

Limits: this is a same-file, known-owner write scan, not alias analysis or a
control-flow graph. Writes through untyped aliases, arbitrary mutator calls
(such as Object.assign), other files, inherited-field identities and namespace
collisions remain outside this guarantee. An inferred field with any observed
write is unresolved even before that write; explicit annotations describe static
references, not all possible runtime implementations. Collection content writes
and broad corpus oracle adjudication remain open.

## TypeScript inherited fields

The pre-repair analyzer loaded from git HEAD fails the new exact call-site gate
with missing inherited owners. The expanded test also reproduced a false Alpha
owner for `constructor(public item: any)` shadowing an Alpha field; the own-member
barrier corrects it. Expected resolved owners come independently from TypeScript
5.9.3, after zero diagnostics. Seventeen named abstention scenarios explicitly
expect no owner, rather than counting disagreement as compiler agreement.

Verification commands and results:

- `bun validation/m14/verify-typescript-inherited-fields.mts`: 33 exact
  source/line/offset/owner tuples; 15 executable dispatch scenarios; direct storage
  and bb graph caller sets for Alpha and Beta. Duplicate delivery is idempotent.
- The same gate with `--require-worker`: asserts worker-pool mode, verifies an
  actual parent change from Alpha's declaring class to Beta's, restores it, then
  shifts source offsets with a leading comment and restores again.
- `bun validation/m14/verify-typescript-inheritance-mutations.mts`: seven source
  mutations rejected by relationship assertions (missing parent, ignored unknown
  shadow, one-level traversal, child this-write, external child write, static
  child write, ignored parameter properties). The unmodified control passes.
- Existing field tests now expect the formerly unsupported inherited call to
  resolve. Fifteen sites and the real worker field-type edit/restoration pass;
  all three field-identity mutations and five field-write mutations fail.
- Receiver writes (36 sites / 22 executions), loops (13 sites), generic positions
  (12 sites), factories (16 sites), and all 121 TypeScript fixtures pass.
- Source typecheck, script typecheck ratchet, build and whitespace checks pass.
  The script ratchet covers its configured script directories, not these `.mts`
  regressions; these are executed by Bun.

bb dogfooding: `bb_search collectLocalReceiverTypes` locates production source but
reports it stale; automatic refresh fails with EROFS under the shared `~/.bb`
index. Only fresh temporary test databases support the graph assertions here.
Worker enrichment's one missing-source warning was traced to the namespace
file-level `exports` row (`source_symbol_id = NULL`, target `Base`), not a tested
call edge. It remains outside the call-binding claim.

Scope: same-file, unique top-level class declarations, bare-name parents,
concrete field types, static/instance identity, protected fields, private identity
controls, shadow barriers, destructured reads and inherited inferred-field write
invalidation. Unknown own members and parameter properties stop traversal.
Generic heritage substitution, nested and qualified parent binding, dynamic
parents, cross-file hierarchy resolution, alias effects, collection-content
writes, broader type identity and corpus-level uses-oracle adjudication remain
open. No claim of whole-language completeness is made.

## TypeScript alias writes

Loading the analyzer from `635e333a6` fails the alias gate: reads of an inferred
field retain Alpha after an alias writes a Beta instance. The repaired scan uses
lexical binding identities and a cycle guard to collect possible origins from
initializers and simple assignments. Origins only withdraw field inference;
they do not create resolved alias call edges. Inherited declaration lookup is
reused so writes through a child invalidate the declaring parent's inferred
field. Existing annotated fields retain static evidence.

- `bun validation/m14/verify-typescript-alias-writes.mts`: 37 exact call tuples
  (caller, line, call-expression offset, owner), native TypeScript 5.9.3 with zero
  diagnostics, 19 executable dispatch scenarios, storage and fresh bb graph
  caller sets. Explicit abstention scenarios are separately named, not counted
  as compiler agreement. Positive controls retain owners across unrelated
  lexical shadows, siblings, static/instance sides and rebound `this`.
- `--require-worker` requires worker-pool mode and verifies that deleting an
  alias write restores the original inferred owner. Restoring the write removes
  it again. A source-prefix edit shifts every call offset and then restores it.
- `bun validation/m14/verify-typescript-alias-mutations.mts`: five implementation
  mutations are rejected by relationship assertions: disabled alias origins,
  broken initializer chains, ignored assignments, ignored lexical `this`, and
  lookup by name instead of lexical binding. The unchanged control passes.
- The earlier inheritance (seven) and field-write (five) mutation batteries
  remain effective. Existing field bindings (15 sites), receiver writes
  (36 sites / 22 executable scenarios), loop bindings (13 sites) and all 121
  TypeScript fixtures pass.
- Source typecheck, zero-error script ratchet and production build pass. The
  `.mts` gates are executed by Bun; they are outside the script ratchet's
  configured include paths.

The scan conservatively combines possible origins, rather than claiming a
flow-sensitive points-to solution. Aliases from destructuring, object/array
members, conditional/logical assignments, unmodeled factory calls and cross-file
or interprocedural effects remain open. Broader namespace-qualified identities,
collection-content mutations and independent corpus adjudication still prevent
whole-language completion claims. Shared bb search staleness remains as recorded
in the inheritance pass; graph assertions use fresh temporary databases.

## TypeScript conditional alias writes

`verify-typescript-conditional-aliases.mts` reproduces retained inferred Alpha
owners with the analyzer from `cbd17fded`. The repair follows possible expression
values for ternaries, logical operators and assignments, while excluding ternary
conditions and non-final comma operands. Arithmetic expressions do not become
aliases. Explicit field annotations retain static evidence.

The gate passes with TypeScript 5.9.3 reporting zero fixture diagnostics:
28 exact caller/line/offset/owner tuples, 12 executable scenarios, direct storage
and fresh bb graph callers. Named conservative abstentions are distinguished
from compiler-derived positive owners. `--require-worker` asserts worker-pool
mode and checks write removal/restoration plus source offsets shifting and
restoring. The unchanged control and five rejected source mutants are exercised
by `verify-typescript-conditional-alias-mutations.mts` (ternary traversal, mistaken
condition origin, logical values, logical assignment, discarded comma operands).
The earlier five alias mutants remain rejected and all 121 TypeScript fixtures
pass. Source typecheck, zero-error script ratchet and production build pass;
`.mts` regressions execute under Bun and are outside the script ratchet includes.

bb symbol search again reports the shared index stale with EROFS preventing
refresh; fresh temporary graph databases provide the relationship evidence.
Destructured and container-derived aliases, arbitrary calls, cross-file effects,
qualified type identity and corpus-level oracle adjudication remain open.

## TypeScript destructured alias writes

The analyzer from `d13d9c778` fails the new exact-call gate after the compiler
accepts its fixtures: writes via object/array destructuring leave stale inferred
field owners. The repair projects binding patterns onto possible literal origins
using actual keys and comma-delimited array positions. Defaults contribute their
own possible origins. Member/index access carries a projection path through
lexical container aliases; the container's class cannot substitute for a value
at a nonempty path. Active binding guards terminate recursive property origins.

`bun validation/m14/verify-typescript-destructured-aliases.mts` passes with
TypeScript 5.9.3, zero fixture diagnostics, 50 exact source/line/offset/owner
tuples and 23 executed runtime scenarios. Positive owners are compiler-derived;
conservative abstentions are explicitly named. Controls preserve unrelated object
keys, array positions, rest-copy sources, shadowed containers, annotations and
container identity. Object spreads, shorthand defaults, array defaults and holes,
computed literal keys and recursive origin paths have executable coverage.
Storage and fresh bb graph caller sets match; `--require-worker` requires the real
worker pool and checks write removal/restoration plus source shifts/restoration.

`verify-typescript-destructured-alias-mutations.mts` rejects six source mutations:
ignored declaration patterns, wrong object keys, wrong array positions, ignored
defaults, ignored assignment patterns and container-as-value confusion. Updated
mutation anchors preserve the prior five conditional and five lexical alias
checks. Seven inheritance and five field-write mutations also remain rejected.
All 121 TypeScript fixtures, source typecheck, zero-error script ratchet and build
pass. The `.mts` gates execute under Bun, outside the script ratchet include set.

Limits: dynamic keys, array spreads with unknown length, parameter-pattern
projections, container-content writes, arbitrary call effects and cross-file
aliases are still open. This pass does not establish whole-language correctness
or resolve the independent corpus-oracle gaps. Shared bb search freshness remains
limited as above; relationship assertions use fresh temporary indexes.

## TypeScript redeclared alias writes

The pre-repair analyzer on `fee4ce72a` retains a Beta owner after a write through
a second `var alias` initializer. A lexical binding's singleton declaration map
was insufficient for possible alias origins. The repair collects every variable
declaration for that scope/name, while keeping the original singleton map for
late-initialization checks. Empty redeclarations do not erase known origins;
block-scoped declarations remain distinct.

`verify-typescript-redeclared-aliases.mts` passes with TypeScript 5.9.3 and zero
fixture diagnostics: 20 exact call tuples, six runtime scenarios, storage and
fresh bb graph callers. Explicitly named conservative abstentions remain separate
from compiler-derived positive owners. Cases cover ordinary/block `var`, empty
redeclarations, destructured `var`, lexical shadows and explicit field annotations.
The real-worker variant changes a second initializer from one class to another,
checks that the no-longer-written class regains its inferred field owner, restores
the initializer, then shifts and restores source offsets. Two source mutants
(single initializer and unscoped declaration keys) fail relationship assertions.

All five lexical-alias and six destructured-alias mutation controls remain
rejected, and all 121 TypeScript fixtures pass. Source typecheck, the zero-error
script ratchet and build pass. Runtime `.mts` gates are outside the script
ratchet's configured directories. No push is part of this verification.

Remaining priorities are container-content writes and loop-produced aliases,
parameter-pattern projections, qualified and cross-file type identities,
interprocedural effects, and independent corpus adjudication. These targeted
repairs do not establish whole-language completion.

### Static checking of the alias regression gates

`bunx tsc --noEmit -p validation/m14/tsconfig.alias-gates.json` now statically
checks all ten `.mts` entry points for inherited fields, lexical aliases,
conditional aliases, destructured aliases and redeclared aliases, including their
mutation runners. It passes with zero diagnostics. This closes the include-path
gap for these ten gates; the historical script ratchet remains a separate check.
The recorded execution, mutation, storage, graph and worker checks remain required:
static checking alone does not validate the analyzer's relationships.

## TypeScript container-content writes

The baseline analyzer from `8b96d72f5` fails exact call-owner assertions after
writes replace container contents. The first repair also exposed skipped direct
member writes (`box.held.item` and `box[0].item`); an intermediate source snapshot
reproduced those failures. The final scan combines initializer origins with
explicit container writes, following static projection paths and simple lexical
container aliases. Dynamic write-key positions match conservatively. Assignment
pattern sources and default values retain their respective projection paths.

`bun validation/m14/verify-typescript-container-writes.mts` checks TypeScript
5.9.3 fixture acceptance with zero diagnostics, 52 exact caller/line/offset/owner
tuples, 25 executed scenarios, stored destinations and bb graph caller sets.
Positive controls preserve distinct keys, scopes, parent objects, rest copies and
explicit annotations. Conservative abstentions are named and are not presented
as compiler agreement. Equal-depth sibling reads, cyclic container aliases,
closure writes, object/array assignment patterns, nested replacement, logical
assignments, default values and direct projected writes have executable checks.

The `--require-worker` variant asserts worker-pool mode. Changing the replacement
container origin restores the now-unwritten class's field hint; restoring the
write withdraws it again. Source-prefix edits shift all stored call offsets and
restoration returns the original tuples. Fresh test indexes support graph checks;
the shared bb search index again reports stale data and cannot auto-refresh under
its read-only `~/.bb` location.

`verify-typescript-container-write-mutations.mts` rejects eight source mutants:
ignored writes, ignored keys, ignored container-alias links, lost projection
tails, ignored pattern writes, ignored dynamic-key possibilities, overbroad cycle
rejection and skipped direct receivers. The unchanged control passes. Earlier
conditional (five), destructured (six), lexical (five), redeclared (two) and
inheritance (seven) mutation controls remain effective. All 121 TypeScript
fixtures pass. Source typecheck, all 12 alias gate entry points, the zero-error
script ratchet and production build pass.

Limits remain: array mutator calls, dynamic read indices, container aliases
through property/conditional expressions, parameter projections, arbitrary
interprocedural effects, accessors/proxies and cross-file identity. The scan is
flow-insensitive: an overwritten earlier origin may still invalidate a field.
The current checkpoint in `docs/ANALYZER-LAUNCH-REVIEW.md` takes precedence over
historical open-item lists in earlier follow-ups.

## TypeScript loop-produced alias writes

The analyzer at `c89e6a377` leaves stale field owners after writes through loop
variables populated from array literals. The repair records each for-of target
at its lexical binding and projects possible array elements through its binding
pattern. Existing targets, block-scoped targets, repeated var loops and assigned
patterns are covered. A distinct internal symbol marks iteration, so it cannot
collide with user property keys. Explicit writes to canonical array indices
supply additional element origins.

The first expanded implementation over-invalidated fields for `"01"` and
`4294967295` array properties. Native execution confirmed that these are not
iterated elements. The repair checks canonical index spelling and the upper
bound, while preserving explicit reads of those same properties. Casted literal
keys are unwrapped before classification. The failing pre-index-guard snapshot
was also exercised independently of the original baseline.

`verify-typescript-iterated-aliases.mts` passes with TypeScript 5.9.3 and zero
fixture diagnostics: 40 exact source/line/offset/owner tuples, 20 runtime
scenarios, stored endpoints and fresh bb graph caller sets. Positive controls
cover lexical shadows, for-in, named/noncanonical/out-of-range keys and explicit
field annotations; abstentions are explicitly named rather than presented as
compiler agreement. `--require-worker` requires worker-pool mode, removes the
first iterable element to restore the untouched inferred field, restores it,
and then shifts/restores every source offset.

Five source mutations fail: missing loop origins, for-in/value confusion,
ignored spread origins, ignored array-slot writes and accepting non-index keys
as iterated elements. Earlier container (eight), destructuring (six), lexical
alias (five) and loop-binding (three) mutation controls remain effective.
All 121 TypeScript fixtures pass. Source typecheck, the dedicated 14-entry
alias gate typecheck, the zero-error script ratchet and production build pass.

Limits remain: arbitrary/custom iterables, generators and factory-return
collections, asynchronous value resolution, array mutator calls, dynamic reads,
parameter-pattern projections, cross-file identity and interprocedural effects.
The analysis collects possible origins without predicting loop execution or
performing a full heap/control-flow analysis. Shared-index freshness limits
remain recorded above; relationship assertions use fresh temporary databases.
