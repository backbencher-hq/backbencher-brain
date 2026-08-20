import { parseFile } from "../../src/ast/pool-worker"

const file = process.argv[2] || "$HOME/fixtures/repositories/luarocks/src/luarocks/fs/lua.lua"
const result = await parseFile(file, process.cwd())
console.log("=== SYMBOLS ===")
for (const s of result.symbols ?? []) {
  console.log(`${s.kind}\t${s.name}\tL${s.range?.startLine ?? s.startLine ?? ""}\tscope=${s.scope || ""}\towner=${s.ownerName || ""}\tmeta=${JSON.stringify(s.metadata || {})}`)
}
console.log("=== RELATIONSHIPS ===")
for (const r of result.relationships ?? []) {
  console.log(`${r.type || r.relationshipType}\t${r.source || r.fromSymbol || ""} -> ${r.target || r.toSymbol || ""}`)
}
console.log("=== IMPORTS ===")
for (const i of result.imports ?? []) console.log(JSON.stringify(i))
console.log("=== ERRORS ===")
console.log(`count: ${(result.errors ?? []).length}`)
