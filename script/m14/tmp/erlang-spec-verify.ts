// ER3 — verify script/m14/spec/erlang-completeness.json against the SAME source
// the completeness gate reads: the wasm's own node-type table, not a corpus walk.
// A corpus census can only see the types some file happens to produce; the gate
// sees every type the grammar defines, so a classification written from a census
// has to be checked against the table before it can claim to be complete.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm")))
  const named: string[] = []
  const anon: string[] = []
  for (let i = 0; i < g.nodeTypeCount; i++) {
    const n = g.nodeTypeForId(i)
    if (!n || n.startsWith("_")) continue
    if (g.nodeTypeIsNamed(i)) named.push(n)
    else anon.push(n)
  }
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "script/m14/spec/erlang-completeness.json"), "utf8"))
  const handled = new Set<string>(spec.handled_verified?.types ?? [])
  const silent = new Set<string>(spec.internal_silent?.types ?? [])
  const gapTypes = new Set<string>()
  for (const g2 of spec.gap?.gaps ?? []) {
    if (typeof g2.node_type !== "string") continue
    for (const t of g2.node_type.split(",")) gapTypes.add(t.trim())
  }
  const decisionTypes = new Set<string>()
  for (const d of spec.design_decision.decisions) {
    if (!d.node_type) continue
    for (const t of d.node_type.split(",")) decisionTypes.add(t.trim())
  }
  const classified = (t: string) => handled.has(t) || silent.has(t) || gapTypes.has(t) || decisionTypes.has(t)
  const unclassified = named.filter((t) => !classified(t))
  const stale = [...handled, ...silent].filter((t) => !named.includes(t))
  const dupes = [...handled].filter((t) => silent.has(t))
  console.log(`wasm node types: ${named.length} named, ${anon.length} anonymous`)
  console.log(`spec: handled ${handled.size}, silent ${silent.size}, gap types ${gapTypes.size}, decision types ${decisionTypes.size}`)
  console.log(`UNCLASSIFIED named types (${unclassified.length}): ${unclassified.join(" ") || "(none)"}`)
  console.log(`STALE rows not produced by the wasm (${stale.length}): ${stale.join(" ") || "(none)"}`)
  console.log(`rows in BOTH buckets (${dupes.length}): ${dupes.join(" ") || "(none)"}`)
  console.log(`decisions: ${spec.design_decision.decisions.length} | open gaps: ${(spec.gap?.gaps ?? []).length}`)
  const bad = unclassified.length + stale.length + dupes.length
  console.log(bad === 0 ? "\nSPEC COMPLETE: every named node type the grammar defines is classified exactly once" : `\nSPEC INCOMPLETE: ${bad} problem(s)`)
  process.exit(bad === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
