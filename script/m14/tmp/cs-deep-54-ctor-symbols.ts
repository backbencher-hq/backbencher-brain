import * as fs from "fs"; import * as path from "path"
const ROOT = process.cwd()
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const f = '/home/sano/ishaq/bb_tests/repositories/roslyn/src/Analyzers/CSharp/Tests/AbstractBuiltInCodeStyleDiagnosticAnalyzer/AbstractBuiltInCodeStyleDiagnosticAnalyzerTests.cs'
const res: any = await ASTEngine.parseFile(f, fs.readFileSync(f, "utf8"))
const cs = (res.symbols ?? []).filter((s: any) => s.name === "constructor")
console.log(`  symbols named "constructor" in this file: ${cs.length}`)
for (const s of cs.slice(0, 8)) console.log(`    kind=${s.kind} owner=${s.ownerName} line=${s.line ?? s.startLine ?? "null"} range=${JSON.stringify(s.range ?? null)}`)
const src = fs.readFileSync(f, "utf8")
const decl = src.split("\n").findIndex((l) => /class AbstractBuiltInCodeStyleDiagnosticAnalyzer/.test(l))
console.log(`\n  the class declaration is on line ${decl + 1}:`)
console.log(`    ${src.split("\n")[decl].trim().slice(0, 110)}`)
const m = src.match(/class AbstractBuiltInCodeStyleDiagnosticAnalyzer[^({]*\(([^)]*)\)/)
console.log(`  primary constructor parameters: ${m ? m[1].trim().slice(0, 120) : "(none found)"}`)
