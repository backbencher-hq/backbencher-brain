import { parseFile } from "../../src/ast/pool-worker"

const file = process.argv[2] || "$HOME/fixtures/repositories/mojo/lib/Mojolicious.pm"
const result = await parseFile(file, process.cwd())
console.log("=== SYMBOLS ===")
for (const s of result.symbols ?? []) {
  console.log(`${s.kind}\t${s.name}\tL${s.range?.startLine}\towner=${s.ownerName || ""}\tvisibility=${s.visibility || ""}`)
}
console.log("=== RELATIONSHIPS ===")
for (const r of result.relationships ?? []) {
  const type = r.type || r.relationshipType
  const source = r.source || r.fromSymbol || ""
  const target = r.target || r.toSymbol || ""
  console.log(`${type}\t${source} -> ${target}`)
}
console.log("=== IMPORTS ===")
for (const i of result.imports ?? []) console.log(`${i.module} [${(i.items ?? []).join(",")}]`)
console.log("=== EXPORTS ===")
for (const e of result.exports ?? []) console.log(`${e.name} [${e.kind || e.type || ""}]`)
console.log(`=== ERRORS ===\ncount: ${(result.errors ?? []).length}`)
