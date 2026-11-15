// script/m14/tmp/cs-literal-callee-measure.ts — what the literal-callee fixture
// actually emits (the expectation is written from this, never from intent).
import * as fs from "fs"
import * as path from "path"

async function main() {
  const ROOT = process.cwd()
  const file = path.join(ROOT, "validation/m14/fixtures/csharp/literal-callee-recovery.cs")
  const src = fs.readFileSync(file, "utf8")
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const res: any = await ASTEngine.parseFile(file, src)
  const lines = src.split("\n")
  console.log(`lines=${lines.length} errors=${JSON.stringify((res.errors ?? []).map((e: any) => `${e.message ?? e}@${e.line ?? "?"}`))}`)
  console.log("symbols:", (res.symbols ?? []).map((s: any) => `${s.name}(${s.kind}@${s.range?.startLine})`).join(" "))
  for (const r of res.relationships ?? []) {
    const ln = r.line_number
    console.log(`  ${String(r.type).padEnd(12)} ${String(r.source ?? "?").padEnd(18)} -> ${String(r.target ?? "?").padEnd(24)} line=${ln ?? "-"} ${JSON.stringify(typeof ln === "number" ? (lines[ln - 1] ?? "").trim().slice(0, 40) : "")}`)
  }
  console.log("\nnumbered source:")
  lines.forEach((l, i) => console.log(`${String(i + 1).padStart(3)}: ${l}`))
}

main()
