// script/m14/tmp/cs-825-measure.ts — MEASURE the csharp 825 fixture: what the
// analyzer actually emits, with the line each edge claims. The expectation file
// is written from this output, never from what the code looks like it does.
import * as fs from "fs"
import * as path from "path"

async function main() {
  const ROOT = process.cwd()
  const file = path.join(ROOT, "validation/m14/fixtures/csharp/callsite-lines-825.cs")
  const src = fs.readFileSync(file, "utf8")
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const res: any = await ASTEngine.parseFile(file, src)
  console.log("language:", res.language)
  console.log("errors:", JSON.stringify(res.errors ?? []).slice(0, 500))
  const lines = src.split("\n")
  console.log(`\n--- ${lines.length} source lines ---`)
  console.log("symbols:")
  for (const s of res.symbols ?? []) {
    console.log(`  ${String(s.name).padEnd(12)} kind=${s.kind} owner=${s.ownerName ?? "-"} range=${s.range?.startLine}..${s.range?.endLine}`)
  }
  console.log("\nrelationships (type | source -> target | line | that line's text):")
  for (const r of res.relationships ?? []) {
    const ln = r.line_number
    const txt = typeof ln === "number" ? (lines[ln - 1] ?? "").trim().slice(0, 46) : "(no line)"
    console.log(`  ${String(r.type).padEnd(13)} ${String(r.source ?? "?").padEnd(9)} -> ${String(r.target ?? "?").padEnd(34)} line=${String(ln ?? "-").padEnd(4)} ${JSON.stringify(txt)}`)
  }
}

main()
