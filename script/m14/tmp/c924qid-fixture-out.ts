import { readFileSync } from "node:fs"
import { getParser } from "../run-fixtures"
const mod: any = await import("../../../src/ast/real-cpp-analyzer")
const f = "validation/m14/fixtures/cpp/qualified-declarator-name-924.cpp"
const src = readFileSync(f, "utf8")
const r: any = await new mod.RealCppAnalyzer().analyze((await getParser("cpp")).parse(src).rootNode, src, f)
console.log("SYMBOLS")
for (const s of r.symbols ?? []) {
  console.log(`  L${s.range?.startLine} [${s.kind}] name=${JSON.stringify(s.name)} owner=${JSON.stringify(s.ownerName ?? null)} meta=${JSON.stringify(s.metadata)}`)
}
console.log("RELATIONSHIPS (contains only)")
for (const e of r.relationships ?? []) {
  if (e.type === "contains") console.log(`  L${e.line_number} ${e.type} ${JSON.stringify(e.source)} -> ${JSON.stringify(e.target)}`)
}
