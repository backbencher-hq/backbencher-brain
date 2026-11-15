import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../../../src/ast/engine"

const p = "validation/m14/fixtures/c/instantiates-allocator-register-989.c"
const content = readFileSync(p, "utf8")
const r = await ASTEngine.parseFile(p, content)
for (const rel of r.relationships) {
  if (String(rel.type) === "instantiates") console.log("INST", rel.source, "->", rel.target, (rel.metadata as any)?.allocator)
}
for (const s of r.symbols) if (["Seg", "Table", "Node"].includes(s.name)) console.log("SYM", s.kind, s.name, (s.metadata as any)?.ownerName ?? "")
