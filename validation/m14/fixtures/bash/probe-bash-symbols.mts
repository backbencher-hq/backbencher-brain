import { parseFile } from "../../../../src/ast/pool-worker"
import { dirname } from "node:path"
const f = process.argv[2]
const want = process.argv[3]
const r: any = await parseFile(f, dirname(f))
console.log(`file: ${f}`)
console.log(`symbols named ~${want}:`)
for (const s of r.symbols ?? []) {
  if (!want || String(s.name).includes(want)) {
    console.log(`  ${s.kind}\t${JSON.stringify(s.name)}\tline=${s.range?.startLine}\towner=${s.ownerName ?? "-"}\tmeta=${JSON.stringify(s.metadata)}`)
  }
}
console.log(`relationships touching ${want}:`)
for (const e of r.relationships ?? []) {
  if (String(e.source).includes(want) || String(e.target).includes(want)) {
    console.log(`  ${e.source} -[${e.type}]-> ${e.target} @${e.line_number} conf=${e.confidence} meta=${JSON.stringify(e.metadata)}`)
  }
}
console.log(`result.exports[]: ${JSON.stringify((r.exports ?? []).map((x: any) => x.name))}`)
