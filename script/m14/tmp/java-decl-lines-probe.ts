// M59 (#825): symbols + relationships for the new java declaration-line fixture,
// each with the source line it claims.
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const F = path.join(ROOT, "validation/m14/fixtures/java/declaration-lines-825.java")

async function main(): Promise<void> {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const src = fs.readFileSync(F, "utf8")
  const res: any = await ASTEngine.parseFile(F, src)
  const lines = src.split("\n")
  console.log("=== symbols ===")
  for (const s of res.symbols ?? []) {
    const ln = s.range?.startLine
    console.log(`${String(s.kind).padEnd(11)} ${String(s.name).padEnd(12)} line=${String(ln).padEnd(3)} :: ${(lines[ln - 1] ?? "").trim().slice(0, 45)}`)
  }
  console.log("=== relationships ===")
  for (const r of res.relationships ?? []) {
    const ln = r.line_number
    console.log(
      `${String(r.type).padEnd(13)} ${String(r.source).padEnd(12)} -> ${String(r.target).padEnd(18)} line=${String(ln ?? "-").padEnd(4)} :: ${(typeof ln === "number" ? (lines[ln - 1] ?? "").trim() : "").slice(0, 45)}`,
    )
  }
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
