// M12.28 probe: dump the production Ruby analyzer output.
import { parseFile } from "../../src/ast/pool-worker"

const file = process.argv[2] || "validation/m11/fixtures/ruby/service.rb"
const p = await parseFile(file, process.cwd())
console.log("=== SYMBOLS ===")
for (const s of p.symbols ?? []) {
  console.log(`${s.kind}\t${s.name}\tL${s.startLine ?? s.range?.startLine}-${s.endLine ?? s.range?.endLine}\towner=${s.ownerName || ""}\tvisibility=${s.visibility || ""}`)
}
console.log("=== RELATIONSHIPS ===")
for (const r of p.relationships ?? []) {
  const type = r.type || r.relationshipType
  const src = r.source || r.fromSymbol || ""
  const tgt = r.target || r.toSymbol || ""
  console.log(`${type}\t${src} -> ${tgt}`)
}
console.log("=== IMPORTS ===")
for (const i of p.imports ?? []) console.log(`${i.module} [${(i.items ?? []).join(",")}]`)
console.log(`=== ERRORS ===\ncount: ${(p.errors ?? []).length}`)
