/**
 * PROBE — the SHAPE of what the C analyzer publishes: symbols (name/kind/scope/qualifiedName)
 * and the edges of one file, so a target spelling can be compared with the key space.
 *
 * Read-only. Usage: bun run validation/m14/fixtures/c/probe-c-shape.ts <abs .c file> [--edges]
 */
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const file = process.argv[2]
if (!file) {
  console.error("usage: probe-c-shape.ts <abs .c file> [--edges]")
  process.exit(2)
}
const repo = file.split(path.sep).slice(0, file.split(path.sep).indexOf("repositories") + 2).join(path.sep)
const r: any = await parseFile(file, repo, { projectRoot: repo } as any)
console.log(`file: ${file}\nrepo: ${repo}\nsymbols: ${r.symbols.length}  relationships: ${r.relationships.length}`)
const byKind = new Map<string, number>()
for (const s of r.symbols) byKind.set(String(s.kind), (byKind.get(String(s.kind)) ?? 0) + 1)
console.log(`kinds: ${[...byKind].map(([k, n]) => `${k}=${n}`).join(" ")}`)
const metaKeys = new Map<string, number>()
for (const s of r.symbols) for (const k of Object.keys(s.metadata ?? {})) metaKeys.set(k, (metaKeys.get(k) ?? 0) + 1)
console.log(`symbol metadata keys: ${[...metaKeys].map(([k, n]) => `${k}=${n}`).join(" ")}`)
let withQual = 0
for (const s of r.symbols) {
  const q = String(s.qualifiedName ?? "")
  if (q && q !== String(s.name)) withQual++
}
console.log(`symbols whose qualifiedName differs from name: ${withQual}`)
if (process.argv.includes("--symbols")) {
  for (const s of r.symbols.slice(0, 200)) {
    console.log(`  sym ${JSON.stringify(s.name)} kind=${s.kind} qual=${JSON.stringify(s.qualifiedName ?? "")} scope=${JSON.stringify(s.scope ?? "")} meta=${JSON.stringify(s.metadata ?? {})}`.slice(0, 400))
  }
}
if (process.argv.includes("--edges")) {
  const byType = new Map<string, number>()
  for (const x of r.relationships) byType.set(String(x.type), (byType.get(String(x.type)) ?? 0) + 1)
  console.log(`edge types: ${[...byType].map(([k, n]) => `${k}=${n}`).join(" ")}`)
  for (const x of r.relationships) {
    console.log(`  ${String(x.type).padEnd(12)} ${JSON.stringify(x.source)} -> ${JSON.stringify(x.target)} @${x.line_number} md=${JSON.stringify(x.metadata ?? {})}`.slice(0, 420))
  }
}
