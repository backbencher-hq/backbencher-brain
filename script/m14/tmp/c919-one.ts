// #919 single-file A/B probe: dump symbols/rels for one file, so the two
// analyzer revisions can be compared on a region that is NOT a macro body
// (unit-regression1.cpp line 113 sits in a real class member function).
//   bun script/m14/tmp/c919-one.ts <file> <out.json>
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const file = process.argv[2]
const out = process.argv[3]
const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))
const src = readFileSync(file, "utf8")
const res: any = await parseFile(file, src, { language: "cpp" })
writeFileSync(
  out,
  JSON.stringify(
    {
      symbols: (res.symbols ?? []).map((s: any) => `${s.kind}|${s.name}|${s.ownerName ?? ""}|${s.range?.startLine ?? 0}`),
      rels: (res.relationships ?? []).map((r: any) => `${r.type}|${r.source}|${r.target}|${r.line_number ?? 0}`),
      exports: (res.exports ?? []).map((e: any) => `${e.kind}|${e.name}`),
    },
    null,
    1,
  ),
)
console.log(`symbols=${res.symbols?.length} rels=${res.relationships?.length} → ${out}`)
