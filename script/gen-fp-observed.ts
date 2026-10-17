// Generates validation/m11/results/fp-observed.json by parsing the functional
// language fixtures with the real analyzers (no DB, no embeddings).
import { parseFile } from "../src/ast/pool-worker"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"

const fixtures = [
  "validation/m11/fixtures/fp/order_book.ex",
  "validation/m11/fixtures/fp/worker.erl",
  "validation/m11/fixtures/fp/Streaming.hs",
  "validation/m11/fixtures/fp/Stats.icl",
]

const root = process.cwd()
const symbols: any[] = []

for (const rel of fixtures) {
  const abs = resolve(root, rel)
  try {
    const p = await parseFile(abs, root)
    for (const s of p.symbols) {
      // `p.symbols` is a union of two symbol shapes and only one carries `range`.
      // Narrow once, here, instead of leaving a property access that does not
      // typecheck on the other member of the union.
      const pos = s as { range?: { startLine?: number }; startLine?: number }
      symbols.push({
        file: rel.split("/").pop(),
        name: s.name,
        kind: s.kind,
        start_line: pos.range?.startLine ?? pos.startLine ?? 0,
      })
    }
  } catch (e: any) {
    console.error(`ERR ${rel}: ${e?.message?.slice(0, 120)}`)
  }
}

writeFileSync(
  "validation/m11/results/fp-observed.json",
  JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), symbols }, null, 2),
)
console.log(`wrote ${symbols.length} observed symbols`)
process.exit(0)
