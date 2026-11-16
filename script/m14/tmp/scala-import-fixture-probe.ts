// M59 (#825): print the import edges emitted for the new multi-line/renamed
// import fixture, with the source line each claims.
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const F = path.join(ROOT, "validation/m14/fixtures/scala/import-multiline-825.scala")

async function main(): Promise<void> {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const src = fs.readFileSync(F, "utf8")
  const res: any = await ASTEngine.parseFile(F, src)
  const lines = src.split("\n")
  console.log(`symbols=${(res.symbols ?? []).map((s: any) => s.name).join(",")}`)
  for (const r of res.relationships ?? []) {
    const ln = r.line_number
    console.log(
      `${String(r.type).padEnd(11)} ${String(r.source).padEnd(10)} -> ${String(r.target).padEnd(45)} line=${String(ln ?? "-").padEnd(4)} src="${(typeof ln === "number" ? lines[ln - 1] : "").trim().slice(0, 40)}"`,
    )
  }
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
