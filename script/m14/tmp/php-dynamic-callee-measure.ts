import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const file = path.join(ROOT, "validation/m14/fixtures/php/dynamic-callee.php")
const res: any = await ASTEngine.parseFile(file, fs.readFileSync(file, "utf8"))
for (const r of res.relationships ?? []) {
  console.log(r.type, "|", r.source, "->", JSON.stringify(r.target), "|", JSON.stringify(r.metadata ?? {}))
}
