// Measure the php include-path fixture through the REAL analyzer and generate
// its expectation (no transcription), so the fixture pins what the rule does.
import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

const file = path.join(ROOT, "validation/m14/fixtures/php/include-paths.php")
const src = fs.readFileSync(file, "utf8")
const res: any = await ASTEngine.parseFile(file, src)
console.log("symbols:", res.symbols.map((s: any) => `${s.name}:${s.kind}`).join(", "))
console.log("\nimports:")
for (const i of res.imports ?? []) console.log("  ", JSON.stringify({ module: i.module, meta: i.metadata }))
console.log("\nrelationships:")
for (const r of res.relationships ?? []) {
  const line = r.line_number ?? null
  console.log("  ", r.type, "|", r.source, "->", JSON.stringify(r.target), "| line", line, "|", JSON.stringify(r.metadata ?? {}))
}
