// #919: dump the fixture's analyzer output (formatted as the expectation's own
// vocabulary) so the pins can be authored against measured truth.
//   bun script/m14/tmp/c919-fixture.ts
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const file = path.join(ROOT, "validation/m14/fixtures/cpp/macro-declared-body-919.cpp")
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))
const res: any = await parseFile(file, readFileSync(file, "utf8"), { language: "cpp" })
console.log("SYMBOLS:")
for (const s of res.symbols ?? []) {
  console.log(`  ${s.kind}\t${JSON.stringify(s.name)}\towner=${JSON.stringify(s.ownerName ?? null)} line=${s.range?.startLine} meta=${JSON.stringify(s.metadata ?? {})}`)
}
console.log("RELATIONSHIPS:")
for (const r of res.relationships ?? []) {
  console.log(`  ${r.type}\t${JSON.stringify(r.source)} -> ${JSON.stringify(r.target)}\tline=${r.line_number}`)
}
console.log("EXPORTS:", JSON.stringify((res.exports ?? []).map((e: any) => `${e.kind}:${e.name}`)))
