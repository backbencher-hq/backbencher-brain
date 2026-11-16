// M59 (#825) follow-up probe: `@Param(Array("32768"))` on line 47 followed by
// `var size: Int = _` on 48. The store check reported target=size CLAIMED on 47 —
// the annotation's line. Question: which line does the analyzer stamp for the
// symbol and for the edge that names it?
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const F = "<corpus-root>/bb_tests/repositories/cats-effect/benchmarks/src/main/scala/cats/effect/benchmarks/QueueBenchmark.scala"

async function main(): Promise<void> {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const src = fs.readFileSync(F, "utf8")
  const res: any = await ASTEngine.parseFile(F, src)
  const symbols = res?.symbols ?? []
  const rels = res?.relationships ?? []
  console.log(`symbols=${symbols.length} relationships=${rels.length}`)
  for (const s of symbols) {
    if (String(s.name).includes("size")) console.log("SYMBOL:", JSON.stringify(s.name), "range=", JSON.stringify(s.range), s.kind)
  }
  for (const r of rels) {
    if (String(r.target).includes("size")) {
      console.log("REL:", String(r.type), JSON.stringify(String(r.target).slice(0, 50)), "line=", r.line_number, "source=", r.source)
    }
  }
  const lines = src.split("\n")
  console.log("source 46:", JSON.stringify(lines[45]))
  console.log("source 47:", JSON.stringify(lines[46]))
  console.log("source 48:", JSON.stringify(lines[47]))
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
