// #743 cpp port: dump ONE fixture's production analyzer output (symbols with
// ranges, relationships with metadata) so the expectation file is authored from
// measured truth rather than guessed.
//
// Usage: bun script/m14/tmp/cpp743-fixture-dump.ts <file.cpp>
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))
const file = process.argv[2]
if (!file) {
  console.error("usage: cpp743-fixture-dump.ts <file.cpp>")
  process.exit(2)
}
const r: any = await parseFile(file, readFileSync(file, "utf8"))
console.log("=== SYMBOLS ===")
for (const s of r.symbols ?? []) {
  console.log(
    `${s.kind}\t${s.name}\tline=${s.range?.startLine}\tcol=${s.range?.startColumn}\tscope=${s.scope ?? ""}\towner=${s.ownerName ?? ""}`,
  )
}
console.log("=== RELATIONSHIPS ===")
for (const x of r.relationships ?? []) {
  const src = x.source ?? x.from ?? x.fromSymbol ?? "?"
  const tgt = x.target ?? x.to ?? x.toSymbol ?? "?"
  const rt = (x.metadata ?? {}).relationshipType ?? x.type ?? x.relationshipType ?? "?"
  console.log(`${rt}\t${src} -> ${tgt}\tconf=${x.confidence}\tline=${x.line_number ?? "-"}`)
}
console.log("=== ERRORS ===")
const errList: any[] = [...(r.errors ?? []), ...(r.metadata?.errors ?? [])]
for (const e of errList) {
  const sl = e.range?.startLine ?? e.startLine ?? e.line
  console.log(`startLine=${sl} col=${e.range?.startColumn ?? e.column} ${e.message ?? ""}`)
}
