import { readFileSync } from "node:fs"
import * as path from "node:path"
import { RealPowershellAnalyzer } from "../../../src/ast/real-powershell-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-powershell.wasm"))))

const CASES: [string, string][] = [
  ["A-quoted-dotsource", `. "$PSScriptRoot\\tools\\buildCommon\\startNativeExecution.ps1"\n`],
  ["A-quoted-amp", `& "$targetPsHome\\pwsh" -NoProfile\n`],
  ["A-unquoted-control", `. ./plain.ps1\n`],
  ["A-unquoted-var-control", `& $exe -NoLogo\n`],
  ["B-param-named-call", `New-StagingFolder -StagingPath $S -R2RVerification $R\n`],
  ["B-control-ordinary-param", `New-StagingFolder -StagingPath $S -Verbose\n`],
  ["B-control-single-letter", `Get-Thing -A $x\n`],
  ["B-control-digit-after-dash", `Get-Thing -R2R $x\n`],
]

for (const [id, src] of CASES) {
  const tree = parser.parse(src)
  const a = new RealPowershellAnalyzer()
  const r: any = a.analyze(tree.rootNode, src, `${id}.ps1`)
  const calls = (r.relationships ?? []).filter((x: any) => (x.type ?? x.relationshipType) === "calls")
  console.log(`\n${id}   src: ${src.trim()}`)
  console.log(`  calls=${calls.length}`)
  for (const c of calls) {
    const t = String(c.target ?? "")
    console.log(`    -> ${JSON.stringify(t)}   op=${JSON.stringify((c.metadata ?? {}).invocationOperator ?? (c.metadata ?? {}).operator ?? null)}`)
  }
}
