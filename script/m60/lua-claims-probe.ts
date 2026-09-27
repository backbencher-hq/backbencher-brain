import { parseFile } from "../../src/ast/pool-worker"
async function main(): Promise<void> {
  const f = "$HOME/fixtures/probe/claims.lua"
  const r: any = await parseFile(f, "$HOME/fixtures")
  console.log("=== metadata.coroutineUsage:", r.metadata?.coroutineUsage, "(symbols mentioning coroutine:", (r.symbols||[]).filter((s:any)=>JSON.stringify(s).includes("oroutine")).length, ")")
  console.log("=== relationships carrying ANY line field:", (r.relationships||[]).filter((x:any)=>"line_number" in x || "line" in x).length, "of", (r.relationships||[]).length)
  console.log("=== performanceScore:", r.metadata?.performanceScore, "memoryEfficiency:", r.metadata?.memoryEfficiency)
  console.log("=== detectedFrameworks:", JSON.stringify(r.metadata?.detectedFrameworks))
  console.log("=== architecturalScore:", r.metadata?.architecturalScore, "codeQuality:", r.metadata?.codeQuality)
  console.log()
  console.log("=== ALL relationships ===")
  for (const x of r.relationships||[]) console.log(`  ${x.type}\t${x.source} -> ${x.target}\tmeta=${JSON.stringify(x.metadata)}`)
  console.log()
  console.log("=== ALL symbols ===")
  for (const s of r.symbols||[]) console.log(`  ${s.kind}\t${s.name}\tL${s.range?.startLine}\tscope=${s.scope}\towner=${s.ownerName??"-"}`)
}
main()
