// M12.26: dump the analyzer output on a fixture in harness-format for GT audit.
import { parseFile } from "../../src/ast/pool-worker"
const file = process.argv[2] || "validation/m12/fixtures/clean/Service.icl"
const p = await parseFile(file, process.cwd())
console.log("=== SYMBOLS ===")
for (const s of p.symbols ?? []) {
  console.log(`${s.kind || s.type}\t${s.name}\tL${s.startLine ?? s.range?.startLine}\towner=${s.ownerName || ""}`)
}
console.log("=== RELATIONSHIPS ===")
for (const r of p.relationships ?? []) {
  const type = r.type || r.relationshipType
  const src = r.source || ""
  const tgt = r.target || ""
  console.log(`${type}\t${src} -> ${tgt}`)
}
console.log("=== ERRORS ===")
console.log(`count: ${(p.errors ?? []).length}`)
