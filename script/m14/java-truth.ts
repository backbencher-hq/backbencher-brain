/**
 * JAVA's OWN audited-label set — the DERIVATION findings this lane closed.
 *
 * ## Why this file exists
 *
 * `script/m60/rel-type-coverage-gate.ts` CHECK 1 reports, measured against the
 * shared audited-set filter in `script/m14/differential.ts`:
 *
 *     java  2 un-audited: ["exports", "imports"]
 *
 * `differential.ts`'s java oracles derive eight labels — `calls`, `contains`,
 * `extends`, `implements`, `instantiates`, `overrides`, `references`, `uses` — and
 * the two that derive nothing are the two the M60 java ontology pass added
 * edges for. The gate's own header states the consequence: "the type is stored
 * and compared against nothing", which is the structural gap the ontology gate
 * was written for. `imports` in particular went from 0 edges to 39,410 measured
 * edges on the pinned corpus with no oracle anywhere in the tree to check a
 * single one.
 *
 * ## WHAT ACTUALLY AUDITS THEM
 *
 * `script/m14/tmp/java/java-imports-exports-oracle.ts` — a second walker that
 * re-derives both labels from the JLS rules rather than from the analyzer's
 * code path. Measured over the same pinned corpus the census uses:
 *
 *     imports  oracle 39,410 / observed 39,410 / agreed 39,410
 *              missing 0, unexplained 0, shape-label disagreements 0
 *              precision 100.00  recall 100.00
 *     exports  oracle  2,559 / observed  2,567 / agreed  2,559
 *              missing 0, unexplained 8, shape-label disagreements 0
 *              precision 100.00  recall 100.00
 *
 * The 8 unexplained `exports` rows are the Spring-MVC `@GetMapping` route
 * publications (`metadata.relationshipType: "api_endpoint"`), which the oracle
 * deliberately does not derive: an HTTP route is not a JLS 7.6 package
 * publication, and an oracle that derived it would be asserting something the
 * JLS does not say. They are two distinct claims under one wire name, separated
 * only by the shape label, and the artifact records them rather than reconciling
 * them.
 *
 * ## WHAT IT IS WORTH
 *
 * Both walkers load the same `tree-sitter-java` wasm, so a defect IN THE GRAMMAR
 * is invisible to this comparison exactly as it is to `differential.ts`. The
 * oracle's `imports` derivation is genuinely divergent (it rebuilds a dotted name
 * by descending the `scoped_identifier` spine; the analyzer reads one
 * `scoped_identifier` child and takes its text). Its `exports` derivation is now
 * WEAKER than that: after the oracle's visibility test was corrected to read
 * modifier token types, it resembles the analyzer's `getJavaModifiers`. The
 * artifact's `independence.reducedIndependence` field says so in the same terms.
 *
 * So this export widens what the gate REPORTS, and it is honest about which of
 * the two labels the widened claim is stronger for.
 *
 * ## WHY IT IS SAFE TO ADD
 *
 * `rel-type-coverage-gate.ts`'s `readOwnOracleLabels()` prefers a lane's own
 * export over the shared filter — the Ruby precedent, added for the same reason
 * (a lane whose derivation lives outside the shared file otherwise reports a
 * stale set as a current one). The per-lane export WINS only when present, so no
 * other lane's behaviour changes.
 */

/**
 * The labels java's oracle derivation actually emits, across BOTH derivations.
 *
 * Read by `script/m60/rel-type-coverage-gate.ts` as TEXT — it matches
 * `export const [A-Z_]*ORACLE_LABELS[^=]*= \[([^\]]*)\]` and then every
 * `"([a-z_]+)"` inside — so the values must be plain quoted lowercase strings.
 *
 * ## WHY ALL EIGHT AND NOT TWO
 *
 * `readOwnOracleLabels()` REPLACES the shared audited set with this array; it does
 * not add to it. So an array naming only the two labels this lane added made the
 * gate report `java 8 un-audited: ["calls","contains","extends","implements",
 * "instantiates","overrides","references","uses"]` — six labels that
 * `script/m14/differential.ts` derives with real oracles (`deriveJavaEdges` for
 * calls, JD-J2 for uses, JD-J4 for contains, JD-J3 for references, the heritage
 * and instantiates and overrides filters). That was measured, not assumed: the
 * first version of this file shipped those two labels and the gate's DERIVATION
 * finding count rose from 46 to 52.
 *
 * Over-reporting is the safe direction to be wrong in and it is still wrong: it
 * buries the finding this file exists to close inside six that were never open.
 * So the array is the UNION, with the provenance of each label stated:
 *
 *   differential.ts (shared, unchanged, not this lane's)
 *     calls  extends  implements  instantiates  overrides  contains  references  uses
 *   this lane's oracle, script/m14/tmp/java/java-imports-exports-oracle.ts
 *     imports  exports
 *
 * The six are listed because `differential.ts` derives them, not because this file
 * re-derives or re-verifies them. Nothing here should be read as a claim that this
 * lane audited them.
 */
export const JAVA_ORACLE_LABELS: ReadonlyArray<string> = [
  // derived by script/m14/differential.ts — shared harness, not this lane's
  "calls", "contains", "extends", "implements", "instantiates", "overrides", "references", "uses",
  // derived by script/m14/tmp/java/java-imports-exports-oracle.ts — this lane
  "imports", "exports",
]
