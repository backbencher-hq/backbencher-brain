// Dump one rust fixture through the PRODUCTION entry (ASTEngine.parseFile), so a
// fixture expectation is authored from what the pipeline publishes rather than
// from the analyzer's internal call.
// Run: bun script/m14/tmp/rust-798-fixture-dump.ts <fixture.rs>
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const file = process.argv[2]
const src = fs.readFileSync(file, "utf8")
// BB_PRE_R10=1 dumps the PRE-FIX rule's own output (HEAD's analyzer), which is
// how a fixture's forbid list is proven to FAIL on revert instead of assumed.
const r: any = process.env.BB_PRE_R10
  ? await (async () => {
      const { RealRustAnalyzerPreR10 } = await import("../../../src/ast/zz-pre-r10-rust-analyzer")
      const parser = await ASTEngine.getParser("rust" as any)
      const root: any = parser.parse(src).rootNode
      return new (RealRustAnalyzerPreR10 as any)().analyze(root, src, file)
    })()
  : await ASTEngine.parseFile(file, src)
console.log("SYMBOLS:")
for (const s of r.symbols ?? []) {
  console.log(
    `  ${s.name}|${s.kind} owner=${s.ownerName ?? "-"} md=${JSON.stringify(
      Object.fromEntries(Object.entries(s.metadata ?? {}).filter(([k]) => k === "type" || k === "implementedType")),
    )}`,
  )
}
console.log("RELATIONSHIPS:")
for (const x of r.relationships ?? []) {
  console.log(`  ${x.type}|${x.source ?? x.from}|${x.target}|line=${x.line_number ?? "-"} md=${JSON.stringify(x.metadata ?? {})}`)
}
