// Measure the C2a fixture through the lane's real analyzer (ASTEngine, the same entry every
// instrument uses) so the expectation is authored from a MEASUREMENT: symbols, the rows that
// matter, and every published target still carrying `::`.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()
const FIX = process.argv[2] ?? path.join(ROOT, "validation/m14/fixtures/csharp/qualified-type-spelling.cs")

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const src = fs.readFileSync(FIX, "utf8")
  const res: any = await ASTEngine.parseFile(FIX, src)
  console.log(`symbols (${res.symbols.length}):`)
  for (const s of res.symbols) {
    const parts = [`kind=${s.kind}`, `name=${s.name}`]
    if (s.ownerName) parts.push(`owner=${s.ownerName}`)
    if (s.visibility) parts.push(`vis=${s.visibility}`)
    const md = s.metadata ?? {}
    for (const k of Object.keys(md)) {
      if (/isRecord|isStruct|isValueType|isOperatorOverload|isConversionOperator|module|includeType|type|frameworkPatterns/.test(k)) {
        parts.push(`${k}=${JSON.stringify(md[k])}`)
      }
    }
    console.log("  " + parts.join(" "))
  }
  console.log(`\nrelationships (${res.relationships.length}):`)
  for (const r of res.relationships) {
    console.log(`  ${String(r.type).padEnd(14)} ${String(r.source ?? "").padEnd(20)} -> ${r.target}   line ${r.line_number ?? "-"}`)
  }
  const bad = (res.relationships ?? []).filter((r: any) => String(r.target ?? "").includes("::") || String(r.source ?? "").includes("::"))
  console.log(`\ntargets/sources still carrying "::": ${bad.length}`)
  for (const b of bad) console.log(`  ${b.type} ${b.source} -> ${b.target}`)
  const badSym = (res.symbols ?? []).filter((s: any) => String(s.name).includes("::") || JSON.stringify(s.metadata ?? {}).includes("::"))
  console.log(`symbols carrying "::": ${badSym.length}`)
  for (const b of badSym) console.log(`  ${b.kind} ${b.name}`)
  console.log(`\nimports (${(res.imports ?? []).length}):`)
  for (const i of res.imports ?? []) {
    console.log(`  module=${JSON.stringify(i.module)} alias=${JSON.stringify(i.metadata?.usingAlias ?? null)} isNs=${String(i.isNamespaceImport)} items=${JSON.stringify(i.items ?? [])} keys=${JSON.stringify(Object.keys(i))}`)
  }
  console.log(`\nsource lines (1-based, as measured):`)
  src.split("\n").forEach((l, n) => { if (n >= 25 && n <= 90) console.log(`  ${String(n + 1).padStart(3)} ${l}`) })
}
main()
