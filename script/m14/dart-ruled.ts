/**
 * DART_RULED — the ruling table `script/m14/ontology-coverage-gate.ts` needs before it will
 * report this lane at all.
 *
 * ## This table is EMPTY, and that is the finding
 *
 * `DART_RULED` has zero entries because this lane emits all ten relationship types on real
 * Dart code, and a ruling table only adjudicates types the analyzer does NOT emit. There is
 * nothing to adjudicate, so there is nothing to write. Every number below comes from the
 * committed 600-file production census at
 * `validation/m14/measurements/dart-600-8237d3e31ac2.raw.ndjson`, drawn by the deterministic
 * stride in `validation/m14/fixtures/dart/collect-sample.ts` and named by its own list
 * digest, so a differently-drawn sample cannot be read as this one:
 *
 *   type          edges    files    both-ends resolved (within-census)   conf < 0.7
 *   uses          20,570      492                              53.7%           2,457
 *   calls         10,239      470                              54.4%               0
 *   contains       6,936      348                             100.0%               0
 *   instantiates   2,644      359                              25.9%               0
 *   imports        1,815      472                               0.0%               0
 *   references     1,320      162                             100.0%               0
 *   overrides      1,220      147                              16.1%               0
 *   extends          560      194                              33.0%               0
 *   implements       276       81                              38.0%               0
 *   exports           10        7                               0.0%               0
 *                  -------                                  --------
 *   TOTAL          45,590                                   39.2% (17,856)      2,457
 *
 * Resolution figures come from `validation/m14/fixtures/dart/resolution-rate-600.ts`.
 *
 * ## `exports` is the narrow one, and a 120-file sample says it does not fire at all
 *
 * The committed 26-lane sweep (`validation/m14/measurements/firing-sweep-26-lanes.ndjson`,
 * dart row) records `firedCount: 9` and `notFired: ["exports"]` at n=120. That is a property
 * of the SAMPLE, not of the language. `exports` fires 10 times across 7 files at 600 files:
 *
 *   dart-http/pkgs/http_client_conformance_tests/lib/src/redirect_server_web.dart:6
 *   dart-sdk/pkg/compiler/lib/src/js/js.dart:22, :24
 *   dart-sdk/pkg/front_end/testcases/regress/issue_36647_lib1.dart:5
 *   dart-sdk/pkg/vm/testcases/transformations/dynamic_interface_annotator/lib4.dart:5
 *   dart-sdk/sdk/lib/collection/collection.dart:60
 *   dart-sdk/tests/web/native/native_testing.dart:13, :15, :17
 *   flutter-packages/packages/camera/camera_avfoundation/lib/camera_avfoundation.dart:5
 *
 * A gate reading only the 120-file row would rule `exports` inapplicable on the evidence of
 * a sample too small to contain one, which is the error this gate was built to catch.
 *
 * Instrument A agrees from the other direction, which is the point of having two. The
 * grammar inventory for dart is 218 distinct node types over 1,200 files by stride 28,
 * converged at 70% of the sample and committed in full at
 * `validation/m14/measurements/dart-grammar-inventory-1200.txt`. It contains
 * `import_or_export` (3,473 occurrences), `library_import` (3,412) and `library_export`
 * (61). The construct is expressible; the 120-file row simply did not contain a use.
 *
 * ## Why an empty table is the STRICT choice, not a convenient one
 *
 * `RULED_BY_LANG.dart` being DEFINED is what the gate needs; its contents are only consulted
 * for a type with `observed.n === 0`. So with this table registered:
 *
 *   - all ten emitted  -> ten EMITTED rows, `FALSIFIED 0`, exit 0;
 *   - any type later stops firing -> that type falls through to `rulingFor()`, which finds no
 *     table entry and no spec decision, and reports RULED-UNJUSTIFIED, exit 1.
 *
 * The second branch is the point. A table carrying stale prose would convert a regression
 * into a `RULED-SOUND` row and the gate would stay green while the lane lost a type — the
 * `overrides`-in-bash failure this gate exists to prevent, reached from the opposite
 * direction. An empty table cannot excuse anything.
 *
 * ## The arbiter cannot currently RUN this lane, and that is not this table's doing
 *
 * `npx tsx script/m14/ontology-coverage-gate.ts dart` exits 1 with
 *
 *   RangeError: Maximum call stack size exceeded
 *       at Node.child (web-tree-sitter/tree-sitter.js:671:8)
 *       at v (script/m14/ontology-coverage-gate.ts:339:141)
 *
 * before it prints any table. gate:336 walks all 33,692 admitted files with unbounded
 * recursion to build `grammarNodeTypes`, and Dart's own test suite ships a 350,435-byte file
 * 20,005 levels deep:
 * `dart-sdk/tests/language/syntax/deep_nesting_statement_test.dart`. That file is ALREADY
 * marked `!bad` in the gate's own checkpoint, and gate:336 re-parses it anyway — no
 * bad-file filter, no try/catch, no depth bound. `grammarNodeTypes` is consumed only at
 * gate:493 and gate:505, both inside the branch for a type that is NOT emitted and HAS a
 * ruling, so for a ten-of-ten lane the whole pass is dead work that can only lose the table.
 *
 * Everything the table needs is measured above and in the committed artifacts, so the empty
 * table stands on its own measurements. The arbiter defect is reported in section 8 of
 * `docs/analyzers/real-dart-analyzer.md`; `script/m14/ontology-coverage-gate.ts` is shared
 * machinery and is not edited here.
 *
 * ## Two open items that are NOT rulings, recorded so nobody adds them here
 *
 * Both are live defects, and both are reachable by writing a ruling — which is why they are
 * named here. Neither belongs in this table, and putting either in it would be a false
 * verdict: a ruling asserts a construct is INAPPLICABLE, and both of these are cases where
 * the type fires and its ENDPOINT does not resolve.
 *
 * 1. **`imports`/`exports` TARGETS resolve 0/1,815 and 0/10**, at the within-file grain AND
 *    the within-census grain (15,299 distinct symbol names). The target is a URI
 *    (`package:http/src/settings.dart:*`). A URI is not a declared name anywhere in Dart; the
 *    imported library's published name is its declared or implicit library name, never the
 *    URI that reaches it. Binding it needs a resolver that maps a URI to a file's library.
 *    The analyzer-side workaround — publishing a second node per file per URI — would assert a
 *    fact about the file that is not there. Shared machinery; section 8, not ruled here.
 *
 * 2. **`overrides` targets resolve 196/1,220 (16.1%)**, and the rate is the SAME at the
 *    within-census grain, so it is not a corpus-size artifact. 1,220/1,220 sources are
 *    qualified while the published target name is bare, and the bind happens at insert time
 *    against a flat leaf name, so the fix is in the store's resolution tiers rather than in
 *    the analyzer. Retargeting the SOURCE to the bare name was measured and rejected: source
 *    and target become the same string, converting 1,220 edges into 1,220 self-loops
 *    (measured 0/1,220 for `source == lastSegment(target)`).
 *
 * Neither is a claim that Dart lacks the construct. Both are resolution defects on types this
 * analyzer emits, which is a different axis from the one this table adjudicates.
 *
 * ## Registration
 *
 * `RULED_BY_LANG.dart` is registered in `script/m14/ontology-coverage-gate.ts`:
 *
 *   import { DART_RULED } from "./dart-ruled"     (line 72)
 *   dart: DART_RULED,                            (line 267)
 *
 * Both are additive, and that file's own header calls `RULED_BY_LANG` a REGISTRY whose merge
 * conflict is always "both sides added a lane" and must resolve toward the UNION, so an
 * additive pair of lines cannot delete another lane's ruling table.
 */
import type { Ruled } from "./ontology-coverage-gate"

export const DART_RULED: Ruled[] = []