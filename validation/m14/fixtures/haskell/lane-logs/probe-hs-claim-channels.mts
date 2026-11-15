/**
 * HASKELL LANE — the CLAIM CHANNELS, tested with the ARBITER'S OWN classifier before they are
 * refused. Read-only; imports `classifyEdge` from script/m14/incoming-rule.ts and never
 * re-implements it.
 *
 *   bun validation/m14/fixtures/haskell/lane-logs/probe-hs-claim-channels.mts
 */
import { classifyEdge } from "/home/ishaq2321/mcp/backbencher-brain/script/m14/incoming-rule"
const declCount = new Map<string, number>()
const kinds = new Map<string, Set<string>>()
const noFacts = undefined
const rows: Array<[string, any, string]> = [
  // the aliased qualified call: base is a single segment
  ["P.runParser", { kind: "cause", base: "P", conflict: false }, "cause claim, base = the alias"],
  // the full-module-path qualified call: base is dotted
  ["Data.Map.fromList", { kind: "cause", base: "Data.Map", conflict: false }, "cause claim, base = the module path"],
  ["Data.Map.fromList", { kind: "cause", base: "Data", conflict: false }, "cause claim, base = the module ROOT only"],
  ["Data.Map.fromList", { kind: "owner" }, "owner claim (isExternal)"],
  ["Data.Map.fromList", { kind: "binding" }, "binding claim, target NOT spelled with the separator"],
  ["getCI.checkVendor\u0000getCI.checkVendor", { kind: "binding" }, "binding claim, spelled <callable>\\u0000<binding>"],
  ["getCI.checkVendor", { kind: "namespace", roots: ["Data", "Text"] }, "namespace claim, root on a closed list"],
]
for (const [tgt, claim, label] of rows) {
  const r: any = classifyEdge(declCount, kinds, tgt, claim as any, noFacts as any)
  console.log(`${String(r.outcome).padEnd(18)} ${JSON.stringify(tgt).padEnd(46)} ${label}`)
}
