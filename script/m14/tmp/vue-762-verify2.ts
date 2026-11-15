import * as fs from "fs"
async function main() {
  const engine: any = await import("../../../src/ast/engine")
  const r: any = await engine.ASTEngine.parseFile("script/m14/tmp/v762/probe2.vue", fs.readFileSync("script/m14/tmp/v762/probe2.vue", "utf8"))
  console.log("calls: " + JSON.stringify((r.relationships ?? []).filter((e: any) => e.type === "calls").map((e: any) => e.source + "->" + e.target)))
}
main().catch((e) => { console.error(e); process.exit(1) })
