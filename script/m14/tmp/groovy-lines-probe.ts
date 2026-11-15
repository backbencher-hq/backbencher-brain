// M59 (#825): dump the groovy fixture's emission WITH LINES, printed against the
// source, so the expectation is authored from facts and the pre-fix positions
// are visible rather than assumed.
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const FIX = path.join(ROOT, "validation/m14/fixtures/groovy/lines-825.groovy")

async function main(): Promise<void> {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const src = fs.readFileSync(FIX, "utf8")
  const lines = src.split("\n")
  const res: any = await ASTEngine.parseFile(FIX, src)

  console.log("=== symbols ===")
  for (const s of res.symbols ?? []) {
    const ln = s.range?.startLine
    console.log(
      `  ${String(s.kind).padEnd(10)} ${String(s.name).padEnd(12)} owner=${String(s.ownerName ?? "-").padEnd(10)} line=${String(ln).padEnd(3)} :: ${(lines[ln - 1] ?? "").trim()}`,
    )
  }

  console.log("\n=== relationships ===")
  for (const r of res.relationships ?? []) {
    const ln = r.line_number
    const kind = r.metadata?.relationshipType ?? ""
    const text = typeof ln === "number" ? (lines[ln - 1] ?? "").trim() : ""
    console.log(
      `  ${String(r.type).padEnd(11)} ${kind.padEnd(22)} ${String(r.source).padEnd(12)} -> ${String(r.target).padEnd(14)} line=${String(ln ?? "-").padEnd(3)} :: ${text.slice(0, 44)}`,
    )
  }
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
