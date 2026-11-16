// Read the live shape of validation/m14/fixtures/groovy/enum-constants.groovy —
// symbols and containment edges, authored from emission rather than memory.
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

async function main(): Promise<void> {
  const rel = process.argv[2] ?? "validation/m14/fixtures/groovy/enum-constants.groovy"
  const file = path.join(ROOT, rel)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const src = fs.readFileSync(file, "utf8")
  const res: any = await ASTEngine.parseFile(file, src)
  console.log("=== symbols ===")
  for (const s of res.symbols ?? []) {
    console.log(`  ${String(s.name).padEnd(12)} kind=${String(s.kind).padEnd(12)} owner=${String(s.ownerName ?? "-").padEnd(8)} line=${String(s.range?.startLine ?? "-")}`)
  }
  console.log("=== contains/uses edges involving constants ===")
  for (const r of res.relationships ?? []) {
    const t = String(r.target)
    if (!/HAPPY|GLOOMY|Mood|flip/.test(t) && !/HAPPY|GLOOMY|Mood|flip/.test(String(r.source))) continue
    console.log(`  ${String(r.type).padEnd(12)} ${String(r.source).padEnd(12)} -> ${String(r.target).padEnd(12)} line=${String(r.line_number ?? "-")}`)
  }
  console.log("=== exports ===", JSON.stringify(res.exports ?? []))
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
