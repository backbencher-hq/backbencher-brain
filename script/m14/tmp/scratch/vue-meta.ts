import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const { readFileSync } = await import("node:fs")
  const f = path.join(ROOT, "validation/m14/fixtures/vue/template-lines-825.vue")
  const res: any = await ASTEngine.parseFile(f, readFileSync(f, "utf8"))
  console.log("top-level metadata keys:", Object.keys(res.metadata ?? {}))
  console.log(JSON.stringify(res.metadata, null, 1).slice(0, 800))
  for (const r of res.relationships ?? []) {
    console.log(String(r.type).padEnd(13), String(r.target).padEnd(20), "line=", r.line_number, "metadata=", JSON.stringify(r.metadata).slice(0, 120))
  }
}
main()
