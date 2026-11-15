// Prints every `overrides` edge with its line metadata, so a fixture expectation's
// priorLine/replacementLine can be read off the analyzer instead of guessed.
import { readFileSync } from "node:fs"
import { getParser } from "../../../../src/ast/engine.ts"
const m: any = await import("../../../../src/ast/real-sql-analyzer.ts")
const Cls = Object.values(m).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any
for (const f of process.argv.slice(2)) {
  const content = readFileSync(f, "utf8")
  const parser = await getParser("sql")
  const pr = await parser.parse(content, f)
  const res = new Cls().analyze(pr.rootNode, content, f)
  console.log(`=== ${f}`)
  for (const r of res.relationships || []) {
    if ((r.type ?? r.relationshipType) !== "overrides") continue
    console.log(`  overrides ${r.source} -> ${r.target}  ${JSON.stringify(r.metadata)}`)
  }
  console.log("  ambiguity.overridesEmitted =", res.metadata?.ambiguity?.overridesEmitted,
    " overloadNotReplacementSkipped =", res.metadata?.ambiguity?.overloadNotReplacementSkipped)
}
