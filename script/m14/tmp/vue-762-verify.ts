// #762 verify-before-fix: prop-default factory body calls (production parseFile path).
import * as fs from "fs"
async function main() {
  const engine: any = await import("../../../src/ast/engine")
  const r: any = await engine.ASTEngine.parseFile("script/m14/tmp/v762/probe.vue", fs.readFileSync("script/m14/tmp/v762/probe.vue", "utf8"))
  const calls = (r.relationships ?? []).filter((e: any) => e.type === "calls").map((e: any) => e.source + "->" + e.target)
  console.log("calls: " + JSON.stringify(calls))
  console.log("symbols: " + JSON.stringify((r.symbols ?? []).map((s: any) => s.name + ":" + s.kind)))
}
main().catch((e) => { console.error(e); process.exit(1) })
