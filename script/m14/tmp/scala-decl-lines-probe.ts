// Probe: emitted relationships for validation/m14/fixtures/scala/declaration-lines-825.scala
import * as path from "path"
import * as fs from "fs"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FIX = "validation/m14/fixtures/scala/declaration-lines-825.scala"
async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const content = fs.readFileSync(path.join(ROOT, FIX), "utf8")
  const res: any = await ASTEngine.parseFile(path.join(ROOT, FIX), content)
  const lines = content.split("\n")
  console.log("=== symbols ===")
  for (const s of res.symbols ?? []) console.log(`  ${s.kind} ${s.name} @${s.range?.startLine}`)
  console.log("=== relationships ===")
  for (const r of res.relationships ?? []) {
    const ln = r.line_number
    const src = typeof ln === "number" && ln > 0 ? (lines[ln - 1] ?? "").trim() : "<no line>"
    console.log(`  ${String(r.type).padEnd(12)} ${String(r.source).padEnd(10)} -> ${String(r.target).padEnd(12)} @${ln}  | ${src.slice(0, 60)}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
