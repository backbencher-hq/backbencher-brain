import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../../../src/ast/engine"

const p = process.argv[2] ?? "validation/m14/fixtures/c/export-linkage-marker-989.c"
const r = await ASTEngine.parseFile(p, readFileSync(p, "utf8"))
for (const rel of r.relationships) {
  if (String(rel.type) === "exports") console.log("EXPORT", rel.source, "->", rel.target, "@"+rel.line_number, JSON.stringify(rel.metadata))
}
