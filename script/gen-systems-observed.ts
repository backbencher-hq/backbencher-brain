// Generates validation/m11/results/systems-observed.json by parsing the
// systems-language fixtures with the real analyzers (no DB, no embeddings).
import { parseFile } from "../src/ast/pool-worker"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"

const fixtures = [
  "validation/m11/fixtures/systems/CoreApi.h",
  "validation/m11/fixtures/systems/CoreApi.c",
  "validation/m11/fixtures/systems/Service.h",
  "validation/m11/fixtures/systems/Service.cpp",
  "validation/m11/fixtures/systems/lib.rs",
  "validation/m11/fixtures/systems/storage.rs",
  "validation/m11/fixtures/systems/geometry.zig",
  "validation/m11/fixtures/systems/Logger.h",
  "validation/m11/fixtures/systems/Logger.m",
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
  "validation/m11/results/systems-observed.json",
  JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), symbols }, null, 2),
)
console.log(`wrote ${symbols.length} observed symbols`)
process.exit(0)
