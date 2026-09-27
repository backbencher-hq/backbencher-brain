import { parseFile } from "../../src/ast/pool-worker"
async function main(): Promise<void> {
  const r: any = await parseFile("$HOME/fixtures/probe/fix-check.lua", "$HOME/fixtures")
  console.log("symbols:", (r.symbols||[]).map((s:any)=>`${s.kind}:${s.name}`).join(", ") || "(none)")
  console.log("exports:", JSON.stringify(r.exports ?? "(no exports key)"))
  console.log("imports:", JSON.stringify(r.imports ?? "(no imports key)"))
  const viaParse: any = await parseFile("$HOME/fixtures/probe/fix-check.lua", "$HOME/fixtures")
  console.log("keys on result:", Object.keys(viaParse).join(","))
}
main()
