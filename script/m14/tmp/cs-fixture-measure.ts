// CS-DEEP-14 — author a fixture's expectations from the analyzer's OWN output, printed
// in the fixture runner's shape.
//
// The lane's rule (and the C2a/#804 discipline) is that a fixture is written from a
// MEASUREMENT of the fixed analyzer, never from a reading of the code — a pin authored
// from intent can encode the same mistake twice. This prints every symbol, import,
// decorator payload and relationship of one fixture file with line numbers, so the
// expectation file is transcribed from what the analyzer does rather than from what it
// ought to do, and the review can diff the two.
//
// Usage: bun script/m14/tmp/cs-fixture-measure.ts <fixture.cs>
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

async function main() {
  const file = process.argv[2]
  if (!file) { console.error("usage: cs-fixture-measure.ts <fixture.cs>"); process.exit(2) }
  const abs = path.isAbsolute(file) ? file : path.join(ROOT, file)
  const src = fs.readFileSync(abs, "utf8")
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const res: any = await ASTEngine.parseFile(abs, src)

  console.log(`== ${path.basename(abs)}   symbols=${res.symbols.length} relationships=${res.relationships.length} errors=${res.errors.length}`)
  console.log(`\n-- imports`)
  for (const im of res.imports ?? []) console.log(`   { "module": ${JSON.stringify(im.module)} }`)
  console.log(`\n-- symbols (decorators only where non-empty)`)
  for (const s of res.symbols ?? []) {
    const dec = s.decorators && s.decorators.length ? `  decorators=${JSON.stringify(s.decorators)}` : ""
    console.log(`   { "name": ${JSON.stringify(s.name)}, "kind": "${s.kind}", "ownerName": ${JSON.stringify(s.ownerName ?? null)}${dec} }`)
  }
  console.log(`\n-- relationships (references + contains)`)
  for (const r of res.relationships ?? []) {
    const t = r.type ?? r.relationshipType
    if (t !== "references" && t !== "contains") continue
    console.log(`   { "type": "${t}", "from": ${JSON.stringify(r.source)}, "target": ${JSON.stringify(r.target)}, "line_number": ${r.line_number ?? null}, "meta": ${JSON.stringify(r.metadata ?? {})} }`)
  }
}

if (import.meta.main) await main()
