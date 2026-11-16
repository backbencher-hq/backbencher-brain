// Probe: what does csharp publish for an OPERATOR declaration — and does the lane
// spell the same member two ways?
//
// Context: the R10 census (validation/m60/results/target-spelling.json) convicts two
// edges in this file: `contains -> operator ==` and `contains -> operator !=`. The
// lane's own doc says an operator's SYMBOL name is `operator`. If the containment
// target is `operator ==` while the symbol is `operator`, one member has two
// spellings — a lane defect independent of the family's pending ruling on how an
// operator member should be named.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()
const FILE = "<corpus-root>/bb_tests/repositories/fsharp/vsintegration/src/FSharp.ProjectSystem.Base/ProjectConfig.cs"

async function main() {
  const src = fs.readFileSync(FILE, "utf8")
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const res: any = await ASTEngine.parseFile(FILE, src)
  const lines = src.split("\n")
  console.log("language:", res.language, "| symbols:", (res.symbols ?? []).length, "| rels:", (res.relationships ?? []).length)
  console.log("\nSYMBOLS whose name mentions operator:")
  for (const s of res.symbols ?? []) {
    if (/operator/i.test(String(s.name))) console.log(`  name=${JSON.stringify(s.name)} kind=${s.kind} owner=${s.ownerName} line=${s.range?.startLine}`)
  }
  console.log("\nRELATIONSHIPS whose TARGET mentions operator:")
  for (const r of res.relationships ?? []) {
    if (/operator/i.test(String(r.target ?? ""))) {
      const ln = r.line_number
      console.log(`  ${String(r.type).padEnd(11)} ${String(r.source).padEnd(14)} -> ${JSON.stringify(r.target)} line=${ln ?? "-"} src=${JSON.stringify((lines[(ln ?? 1) - 1] ?? "").trim().slice(0, 70))}`)
    }
  }
  console.log("\nAny target carrying whitespace or '::':")
  for (const r of res.relationships ?? []) {
    const t = String(r.target ?? "")
    if (/\s|::/.test(t)) console.log(`  ${String(r.type).padEnd(11)} ${String(r.source).padEnd(14)} -> ${JSON.stringify(t)}`)
  }
}
main()
