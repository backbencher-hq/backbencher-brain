// M59 (#825): print every relationship the java analyzer emits for the new
// call-site fixture, with the source line it claims, so the expectation can be
// written against the source and checked against the emission.
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const F = path.join(ROOT, "validation/m14/fixtures/java/callsite-lines-825.java")

async function main(): Promise<void> {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const src = fs.readFileSync(F, "utf8")
  const res: any = await ASTEngine.parseFile(F, src)
  const lines = src.split("\n")
  const rels: any[] = res?.relationships ?? []
  console.log(`symbols=${(res?.symbols ?? []).length} relationships=${rels.length}`)
  for (const r of rels) {
    const ln = r.line_number
    const claimed = typeof ln === "number" ? lines[ln - 1]?.trim() ?? "" : "(none)"
    console.log(
      `${String(r.type).padEnd(14)} ${String(r.source).padEnd(16)} -> ${String(r.target).padEnd(16)} line=${String(ln ?? "-").padEnd(4)} src="${claimed.slice(0, 50)}"`,
    )
  }
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
