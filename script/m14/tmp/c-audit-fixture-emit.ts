import { parseFile } from "../../../src/ast/pool-worker"
const f = "validation/m14/fixtures/c/callsite-lines-825.c"
const r: any = await parseFile(f, "validation/m14/fixtures/c")
console.log(`symbols ${r.symbols.length}, relationships ${r.relationships.length}`)
for (const s of r.symbols) console.log(`  SYM ${s.kind.padEnd(9)} ${String(s.name).padEnd(14)} line=${s.range?.startLine} owner=${s.ownerName ?? "-"}`)
for (const rel of r.relationships) console.log(`  REL ${String(rel.type).padEnd(11)} ${String(rel.source).padEnd(14)} -> ${String(rel.target).padEnd(14)} line=${rel.line_number} meta=${JSON.stringify(rel.metadata)}`)
