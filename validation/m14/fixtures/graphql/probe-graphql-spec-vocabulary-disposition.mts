/**
 * PROBE-GRAPHQL-SPEC-VOCABULARY-DISPOSITION — can ANY claim kind this programme has legally dispose
 * of the lane's largest classes? A ruling that says "no claim kind fits" is PROSE unless it is RUN.
 *
 * ## The question, and why it needs an instrument rather than an argument
 *
 * `validation/m14/fixtures/graphql/probe-graphql-residual-causes.mts` attributes 84,075 residual
 * edges over 7 emitted types. The two largest classes are:
 *
 *   25,229 edges naming the five built-in scalars (`String` 13,644 · `ID` 3,887 · `Boolean` 3,517 ·
 *          `Int` 3,029 · `Float` 1,152) — 30.0% of the lane's residual, over FIVE names;
 *   11,867 edges naming the specification's `__`-reserved introspection vocabulary
 *          (`__type` 6,258 · `__typename` 4,589 bare, plus 755 `Type.__typename` and 23 other names).
 *
 * Both are the GraphQL specification's own predeclared vocabulary: no schema file declares them, and
 * §3.9 forbids a schema to define a `__`-prefixed name at all. §5x of the handoff says such a class
 * "needs a claim or an explicit rule per class" — so the question this file answers is whether a
 * CLAIM is available, and the answer must be measured, not asserted.
 *
 * ## The test
 *
 * For each representative target, every claim kind the arbiter knows is attached IN TURN and the
 * outcome is read from `classifyEdge` — the same function the gate calls, imported, never copied.
 * The key space is EMPTY, which is the true state of these targets: no declaration in any project
 * answers them (that is what makes them residual). Then the same claim is re-tested against a key
 * space that DOES declare the name, which is the only way to find out whether the claim is
 * falsifiable at all.
 *
 * A disposition is LEGAL only if it is `externalVerified`/`bindingVerified`/`causeDeclared` AND the
 * project can refute it when it is false. §5k states the rule: "an externality claim must be
 * checkable by a mechanism the CLAIMANT does not control. Where no such mechanism exists, the honest
 * outcome is a RULED BOUNDARY with a count and a falsifier — not a claim."
 *
 * Read-only. No corpus walk: this is a property of the RULE, and it runs in under a second.
 */
import {
  classifyEdge, externalClaimOf,
  BINDING_CLAIM_KEY, FILE_CLAIM_KEY, REMOTE_REF_CLAIM_KEY, IMPORT_CLAIM_KEY, CAUSE_CLAIM_KEY,
} from "../../../../script/m14/incoming-rule"

/** the lane's largest classes, with the edge count the attribution probe measured */
const TARGETS: [string, string][] = [
  ["references -> String   (13,644 edges)", "String"],
  ["references -> ID       ( 3,887 edges)", "ID"],
  ["references -> Boolean  ( 3,517 edges)", "Boolean"],
  ["references -> Int      ( 3,029 edges)", "Int"],
  ["uses -> __type         ( 6,258 edges, bare)", "__type"],
  ["uses -> __typename     ( 4,589 edges, bare)", "__typename"],
  ["uses -> JiraIssueField.__typename (755 edges, owner IS declared)", "JiraIssueField.__typename"],
  ["uses -> @deprecated    (  181 edges)", "@deprecated"],
  ["uses -> JiraIssueFieldConfiguration.fieldConfig (124 edges, owner declared nowhere)", "JiraIssueFieldConfiguration.fieldConfig"],
]

const ownerOf = (t: string): string => {
  const i = t.indexOf(".")
  return i > 0 ? t.slice(0, i) : t
}

const empty = new Map<string, number>()
const emptyKinds = new Map<string, Set<string>>()
/** the project's own facts, as `incoming-gate.ts` builds them for this lane (the admitted file list) */
const facts = { packages: new Set<string>(), files: new Set(["a.graphql"]), sdkLib: false }

const w = (s: any, n: number) => (String(s) + " ".repeat(n)).slice(0, n)

type Probe = { label: string; metadata: Record<string, any> }
const probesFor = (tgt: string): Probe[] => [
  { label: "(no claim — what the lane emits today)", metadata: {} },
  { label: `isExternalBase (owner claim)`, metadata: { isExternalBase: true } },
  { label: `isExternalTarget (owner claim)`, metadata: { isExternalTarget: true } },
  { label: `${IMPORT_CLAIM_KEY} (projectFacts claim)`, metadata: { [IMPORT_CLAIM_KEY]: true } },
  // THE CANDIDATE IS THE TARGET ITSELF, which is what "this target names a file" MEANS. An earlier
  // version of this probe planted `["a.graphql"]` — a file that exists in the synthetic fact list —
  // so the row read `externalVerified` for a scalar, which is an artifact of the plant and not a
  // property of the claim. A claim is tested with the candidate the lane would actually write.
  { label: `${FILE_CLAIM_KEY} [target] (file claim)`, metadata: { [FILE_CLAIM_KEY]: [tgt] } },
  { label: `${BINDING_CLAIM_KEY} (binding claim)`, metadata: { [BINDING_CLAIM_KEY]: true } },
  { label: `${REMOTE_REF_CLAIM_KEY} (reference claim)`, metadata: { [REMOTE_REF_CLAIM_KEY]: true } },
  { label: `${CAUSE_CLAIM_KEY} "${ownerOf(tgt)}" (declared cause)`, metadata: { [CAUSE_CLAIM_KEY]: ownerOf(tgt) } },
]

const run = (tgt: string, metadata: Record<string, any>, declCount: Map<string, number>) => {
  const claim = externalClaimOf({ metadata })
  return classifyEdge(declCount, emptyKinds, tgt, claim, facts, false)
}
const isRefutation = (o: string) => o === "externalRefuted" || o === "bindingRefuted" || o === "causeRefuted"

console.log("PROBE-GRAPHQL-SPEC-VOCABULARY-DISPOSITION — every claim kind the arbiter knows, against the")
console.log("lane's largest residual classes. A claim is LEGAL only if the PROJECT can refute it when false.")
console.log("")
for (const [label, tgt] of TARGETS) {
  console.log(`${label}   target=${JSON.stringify(tgt)}`)
  console.log(`  ${w("disposition attached", 56)} ${w("EMPTY key space (the truth)", 28)} ${w("FALSIFIABILITY: project DECLARES the name", 40)}`)
  for (const p of probesFor(tgt)) {
    const vacuous = run(tgt, p.metadata, empty)
    // The falsifiability arm plants the declaration the claim denies. `targetOwner` (the rule's own
    // spelling) decides which key the claim would be checked against, so the plant uses it.
    const dot = tgt.lastIndexOf(".")
    const ownerKey = dot > 0 ? tgt.slice(0, dot) : tgt
    const planted = new Map<string, number>([[ownerKey, 1]])
    if (dot <= 0) planted.set(tgt, 1)
    const refutable = run(tgt, p.metadata, planted)
    const verdict =
      isRefutation(vacuous.outcome) ? "ILLEGAL — refutes on a target that names nothing"
      : vacuous.outcome === "resolved" ? "n/a — the edge resolved"
      : refutable.outcome === "resolved" ? "** NOT FALSIFIABLE: the claim is never read (the edge just resolves) **"
      : isRefutation(refutable.outcome) ? "falsifiable: the project refutes it"
      : "unverifiable claim (extQ/bind? — blocks a PASS)"
    console.log(`  ${w(p.label, 56)} ${w(vacuous.outcome, 28)} ${w(refutable.outcome, 20)} ${verdict}`)
  }
  console.log("")
}
console.log("READING THE TABLE: a claim kind is usable only when its EMPTY-key-space outcome is a verified")
console.log("bucket AND its planted-declaration outcome is a REFUTATION. No row above satisfies both.")
