import * as fs from "fs"; import * as path from "path"
const ROOT = process.cwd()
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const f = "/home/sano/ishaq/bb_tests/repositories/roslyn/src/Analyzers/Core/Analyzers/SimplifyLinqExpression/AbstractSimplifyLinqExpressionDiagnosticAnalyzer.cs"
const res: any = await ASTEngine.parseFile(f, fs.readFileSync(f, "utf8"))
for (const want of ["AnalyzeInvocationOperation", "OnCompilationStart", "TryGetMethodName"]) {
  const rows = (res.symbols ?? []).filter((s: any) => s.name === want)
  console.log(`${want.padEnd(30)} symbols=${rows.length}  ${rows.map((r: any) => `${r.kind}@${r.ownerName ?? "-"}`).join("  ")}`)
}
console.log("\nkinds present:", [...new Set((res.symbols ?? []).map((s: any) => s.kind))].join(", "))
