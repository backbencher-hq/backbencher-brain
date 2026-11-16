// M59 (#825): `contains SuspendedObject` claims line 94 (its primary-constructor
// PARAMETER line) while the class name is written on 93. Which node does the
// symbol range come from?
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const F =
  "<corpus-root>/bb_tests/repositories/Exposed/spring-transaction/src/main/kotlin/org/jetbrains/exposed/v1/spring/transaction/SpringTransactionManager.kt"

async function main(): Promise<void> {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const src = fs.readFileSync(F, "utf8")
  const res: any = await ASTEngine.parseFile(F, src)
  const lines = src.split("\n")
  for (const s of res.symbols ?? []) {
    if (!/SuspendedObject|ModifierData/.test(String(s.name))) continue
    const ln = s.range?.startLine
    console.log(`${String(s.kind).padEnd(10)} ${String(s.name).padEnd(22)} owner=${String(s.ownerName).padEnd(24)} line=${String(ln).padEnd(4)} :: ${(lines[ln - 1] ?? "").trim().slice(0, 50)}`)
  }
  console.log("--- relationships naming those classes ---")
  for (const r of res.relationships ?? []) {
    if (!/SuspendedObject|ModifierData/.test(String(r.target))) continue
    const ln = r.line_number
    console.log(`${String(r.type).padEnd(10)} ${String(r.source).padEnd(24)} -> ${String(r.target).padEnd(22)} line=${String(ln ?? "-").padEnd(4)} :: ${(typeof ln === "number" ? (lines[ln - 1] ?? "").trim() : "").slice(0, 45)}`)
  }
  console.log("--- source 88..96 ---")
  for (let i = 88; i <= 96; i++) console.log(`${i}| ${lines[i - 1]}`)
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
