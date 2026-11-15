// WORKFLOW-CALL-ROLE PROBE — what does the analyzer ACTUALLY emit for the `uses:` sites?
//
// The `workflow-call-role` fixture failed with "expected relationship not found" naming
// `meta.isExternal: true`. An expectation mismatch can mean the edge is gone, the edge moved,
// or only a metadata KEY changed, and those are three different findings. This prints every
// relationship the analyzer emits for the fixture, with its full metadata, so the answer is
// read off the analyzer rather than inferred from the fixture runner's complaint.
//
// USAGE: bun validation/m14/fixtures/yaml/workflow-call-probe.ts [file.yaml]
import { readFileSync } from "node:fs"
import { getParser } from "../../../../src/ast/engine.ts"

const target = process.argv[2] ?? "validation/m14/fixtures/yaml/workflow-call-role.yaml"
const m: any = await import("../../../../src/ast/real-yaml-analyzer.ts")
const Cls = Object.values(m).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any

const content = readFileSync(target, "utf8")
const parser = await getParser("yaml")
const pr = await parser.parse(content, target)
const res = new Cls().analyze(pr.rootNode, content, target)

console.log(`=== ${target}`)
console.log(`symbols ${res.symbols?.length}  relationships ${res.relationships?.length}\n`)
for (const r of res.relationships ?? []) {
  const md = (r as any).metadata ?? {}
  console.log(`${(r as any).type ?? (r as any).relationshipType}  [${md.relationshipType ?? "-"}]`)
  console.log(`    ${(r as any).source}  ->  ${(r as any).target}`)
  console.log(`    metadata: ${JSON.stringify(md)}`)
}
const docs = (res.symbols ?? []).filter((s: any) => s.kind === "module" || String(s.kind).includes("module"))
console.log(`\nmodule/document symbols: ${JSON.stringify(docs.map((s: any) => ({ name: s.name, qn: s.qualifiedName })))}`)
