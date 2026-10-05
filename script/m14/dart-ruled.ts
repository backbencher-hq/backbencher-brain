/**
 * DART_RULED — the ruling table `script/m14/ontology-coverage-gate.ts` needs before it will
 * report this lane at all.
 *
 * ## This table is EMPTY, and that is the finding
 *
 * `DART_RULED` has zero entries because this lane fires all ten relationship types on real
 * Dart code, and a ruling table only adjudicates types the analyzer does NOT emit. There is
 * nothing to adjudicate, so there is nothing to write. Every number behind that sentence is
 * in `validation/m14/measurements/dart-gate-600.txt` and in
 * `validation/m14/measurements/dart-library-node-600.txt`:
 *
 *   type          edges @600 files   edges @n=400 (arbiter columns)   source published
 *   calls          10,239                                       7,331              7,331
 *   uses           20,570                                      21,956             21,956
 *   contains        6,936                                      12,109             12,109
 *   imports         1,815                                       1,276              1,276
 *   references      1,320                                       1,420              1,420
 *   exports            10                                          9                  9
 *   extends           560                                         475                475
 *   implements        276                                         155                155
 *   overrides       1,220                                       6,666              6,666
 *   instantiates    2,644                                       2,609              2,609
 *
 * `exports` is the narrow one and is worth stating precisely, because a 120-file sample says
 * it does not fire at all. The committed 26-lane sweep
 * (`validation/m14/measurements/firing-sweep-26-lanes.ndjson`, dart row) records
 * `firedCount: 9` and `notFired: ["exports"]` at n=120 — and that is a property of the
 * SAMPLE, not of the language: an `export` directive is rare, and at 600 files it fires 10
 * times. A gate reading that row would rule `exports` inapplicable on the evidence of a
 * sample too small to contain one, which is exactly the error this gate was built to catch.
 * The count that settles it is 10 edges at 600 files and 9 at the arbiter's own n=400.
 *
 * ## Why an empty table is the STRICT choice, not a convenient one
 *
 * `RULED_BY_LANG.dart` being DEFINED is what the gate needs; its contents are only consulted
 * for a type with `observed.n === 0`. So with this table registered:
 *
 *   - all ten emitted  -> ten EMITTED rows, `FALSIFIED 0`, exit 0;
 *   - any type later stops firing -> that type falls through to `rulingFor()`, which finds
 *     no table entry and no spec decision, and reports RULED-UNJUSTIFIED, exit 1.
 *
 * The second branch is the point. A table carrying stale prose would convert a regression into
 * a `RULED-SOUND` row and the gate would stay green while the lane lost a type — the
 * `overrides`-in-bash failure this gate exists to prevent, reached from the opposite
 * direction. An empty table cannot excuse anything, so a regression in this lane fails the
 * gate loudly. For a lane that emits all ten, that is the strongest table available.
 *
 * ## Two open items that are NOT rulings, recorded so nobody adds them here
 *
 * Both are live defects, and both are reachable by writing a ruling — which is why they are
 * named here. Neither belongs in this table, and putting either in it would be a false
 * verdict: a ruling asserts a construct is INAPPLICABLE, and both of these are cases where the
 * type fires and its ENDPOINT does not resolve.
 *
 * 1. **`imports`/`exports` TARGETS resolve 0/1,825 at 600 files.** The target is a URI
 *    (`package:http/src/settings.dart:*`). A URI is not a declared name anywhere in Dart; the
 *    imported library's published name is its declared or implicit library name, never the URI
 *    that reaches it. Binding it needs a resolver that maps a URI to a file's library. The
 *    analyzer-side workaround — publishing a second node per file per URI — would assert a
 *    fact about the file that is not there. Shared machinery; reported in section 8 of
 *    `docs/analyzers/real-dart-analyzer.md`, not ruled here.
 *
 * 2. **`overrides` emits a QUALIFIED source against a BARE published name** (1,220/1,220 at
 *    600 files), and 119 of 196 contested `overrides` edges bind to the wrong declaration.
 *    Measured, with ground truth (`dart-store-tier-attribution-600.txt`): a dotted-qualified
 *    strategy reaches `netNew 112`, and 189 of 1,220 targets name exactly one published
 *    `qualifiedName`. The bind happens at insert time against a flat leaf name, so the fix is
 *    in the store's resolution tiers, not in the analyzer. Retargeting the SOURCE to the bare
 *    name was measured and rejected: source and target become the same string, converting
 *    1,220 edges into 1,220 self-loops (measured 0/1,220 for `source == lastSegment(target)`).
 *
 * Neither is a claim that Dart lacks the construct. Both are resolution defects on types this
 * analyzer emits, which is a different axis from the one this table adjudicates.
 *
 * ## The supervisor's registry edit, in full
 *
 * In `script/m14/ontology-coverage-gate.ts`:
 *
 *   1. after the last `import { …_RULED } from "./…-ruled"` line, add
 *        import { DART_RULED } from "./dart-ruled"
 *   2. add `  dart: DART_RULED,` to `RULED_BY_LANG`.
 *
 * Both are additive. That file's own header calls `RULED_BY_LANG` a REGISTRY whose merge
 * conflict is always "both sides added a lane" and must resolve toward the UNION, so an
 * additive pair of lines cannot delete another lane's ruling table.
 */
import type { Ruled } from "./ontology-coverage-gate"

export const DART_RULED: Ruled[] = []
