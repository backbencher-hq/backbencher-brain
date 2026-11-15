/**
 * PERL — THE MECHANISM PROOF: what each candidate disposition DOES to a REAL perl target.
 *
 * Every claim in the lane's report about the claim/cause channels is a run of the arbiter's OWN
 * classifier (`classifyEdge`, imported from `script/m14/incoming-rule.ts` and never re-implemented),
 * against the real key space of the 400-file draw. No parsing, no population: the point is what the
 * RULE does, and the rule is a pure function of (declCount, kinds, target, claim).
 *
 * The four dispositions a perl edge could be given, and the target each one is available to:
 *
 *   A. bare leaf + `baseBeyondRunScope`   -> the shape of perl's 1974 bare unresolved calls
 *   B. dotted leaf-qualified + `baseBeyondRunScope: <owner>` -> the shape of its 1921 dotted ones
 *   C. bare leaf + `isExternal`           -> the owner claim (the "free pass")
 *   D. dotted + `languageNamespace`       -> the closed-vocabulary claim
 */
import { classifyEdge, externalClaimOf } from "../../../../script/m14/incoming-rule"

const keyOf = (entries: [string, number][]): Map<string, number> => new Map(entries)
const kindsOf = (entries: [string, string[]][]): Map<string, Set<string>> => new Map(entries.map(([k, v]) => [k, new Set(v)]))

/** The project key space these probes run against: the mojo draw's own shape, at the size that matters. */
const DECL = keyOf([
  ["Mojo::IOLoop", 1], ["Mojo::IOLoop.Mojo::IOLoop", 1],
  ["Mojo::IOLoop.server", 1], ["server", 1],
  ["Mojo::Base", 1], ["Mojo::Base.Mojo::Base", 1],
  ["Mojo::Base.constructor", 1], ["constructor", 12],
  ["Mojo::Asset", 1], ["Mojo::Asset.add_chunk", 1], ["add_chunk", 2],
])
const KINDS = kindsOf([
  ["Mojo::IOLoop", ["class"]], ["Mojo::IOLoop.Mojo::IOLoop", ["class"]],
  ["Mojo::IOLoop.server", ["method"]], ["server", ["method"]],
  ["Mojo::Base", ["class"]], ["Mojo::Base.Mojo::Base", ["class"]],
  ["Mojo::Base.constructor", ["constructor"]], ["constructor", ["constructor"]],
  ["Mojo::Asset", ["class"]], ["Mojo::Asset.add_chunk", ["method"]], ["add_chunk", ["method"]],
])

const rows: [string, string, Record<string, unknown>][] = [
  ["A", "plan", { baseBeyondRunScope: "plan", reasonCode: "name-only-callee" }],
  ["A'", "plan", { baseBeyondRunScope: "Test::Kong", reasonCode: "name-only-callee" }],
  ["B", "Mojo::IOLoop.stop", { baseBeyondRunScope: "Mojo::IOLoop", reasonCode: "name-only-callee" }],
  ["B'", "Mojo::IOLoop.stop", { baseBeyondRunScope: "IOLoop", reasonCode: "name-only-callee" }],
  ["B\"", "IOLoop.stop", { baseBeyondRunScope: "IOLoop", reasonCode: "name-only-callee" }],
  ["C", "plan", { isExternal: true, reasonCode: "name-only-callee" }],
  ["C'", "notdeclared_anywhere", { isExternal: true, reasonCode: "name-only-callee" }],
  ["D", "Mojo::IOLoop.server", { languageNamespace: ["UNIVERSAL", "CORE", "builtin"] }],
  ["D'", "UNIVERSAL::isa", { languageNamespace: ["UNIVERSAL", "CORE", "builtin"] }],
  ["—", "Mojo::IOLoop.server", { reasonCode: "name-only-callee" }],
]

console.log("disposition  target                     claim                              -> outcome")
for (const [tag, tgt, md] of rows) {
  const claim = externalClaimOf({ metadata: md })
  const res: any = classifyEdge(DECL, KINDS, tgt, claim as any, undefined, false, false)
  console.log(`${tag.padEnd(12)} ${tgt.padEnd(26)} ${JSON.stringify(md).padEnd(64)} -> ${res.outcome}`)
}
