// script/m14/tmp/cs-r1-measure.ts — MEASURE the R1 fixture: every import (with its
// relationship metadata, where the alias is published), every operator symbol, and
// the references edge each using directive emits.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

async function main() {
  const file = path.join(ROOT, "validation/m14/fixtures/csharp/using-alias-and-operators.cs")
  const src = fs.readFileSync(file, "utf8")
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const res: any = await ASTEngine.parseFile(file, src)
  console.log("language:", res.language, "errors:", (res.errors ?? []).length)
  console.log("\nimports:")
  for (const i of res.imports ?? []) console.log("  ", JSON.stringify({ module: i.module, items: i.items, ns: i.isNamespace }))
  console.log("\nreferences edges (metadata carries the alias):")
  for (const r of res.relationships ?? []) {
    if (r.type !== "references") continue
    console.log("  ", JSON.stringify({ target: r.target, line: r.line_number, meta: r.metadata }))
  }
  console.log("\noperator symbols + class symbols:")
  for (const s of res.symbols ?? []) {
    const op = s.metadata?.isOperatorOverload ? " OPERATOR" : ""
    if (op || s.kind === "class") console.log("  ", JSON.stringify({ name: s.name, kind: s.kind, owner: s.ownerName, op: Boolean(op), conv: s.metadata?.isConversionOperator }))
  }
}

main()
