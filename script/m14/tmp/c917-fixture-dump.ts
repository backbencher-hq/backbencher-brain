// #917 fixture dump: everything the fixture produces, in the shape the
// expectation file pins (kind/visibility/returnType/parameters + edges).
import path from "node:path"
import { readFileSync } from "node:fs"
const { parseFile } = await import(path.resolve("src/ast/engine.ts"))

const F = process.argv[2] ?? "validation/m14/fixtures/c/macro-wrapped-heading-917.c"
const res: any = await parseFile(path.resolve(F), readFileSync(F, "utf8"), { language: "c" })
console.log(`== symbols (${(res.symbols ?? []).length}) ==`)
for (const s of res.symbols ?? []) {
  console.log(
    `  @${s.range?.startLine}-${s.range?.endLine} ${s.kind} ${s.name}` +
      ` scope=${s.scope} vis=${s.visibility} ret=${s.returnType ?? "-"}` +
      ` params=${JSON.stringify((s.parameters ?? []).map((p: any) => `${p.name}:${p.type}`))}` +
      `${s.metadata?.recoveredFromMacroWrappedHeader ? " RECOVERED" : ""}`,
  )
}
console.log(`== relationships (${(res.relationships ?? []).length}) ==`)
for (const r of res.relationships ?? []) {
  console.log(`  @${r.line_number} ${r.type} ${r.source} -> ${r.target} [${r.metadata?.relationshipType ?? ""}] conf=${r.confidence}`)
}
