import * as fs from "fs"
import { execSync } from "child_process"
import * as WTS from "web-tree-sitter"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const ts = await L.load(`${ROOT}/wasm/tree-sitter-typescript.wasm`)
  const tsx = await L.load(`${ROOT}/wasm/tree-sitter-tsx.wasm`)
  const files = execSync("git ls-files '*.ts' '*.tsx' | rg -v '^node_modules/|^dist/|^wasm/' | head -700", { encoding: "utf8", cwd: ROOT }).trim().split("\n").filter(Boolean)
  let refs = 0, globals = 0
  const dupExact = new Map<string, number>()
  const samples: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(`${ROOT}/${f}`, "utf8")
    const p = new P(); p.setLanguage(f.endsWith(".tsx") ? tsx : ts)
    const r: any = await new (await import(`${ROOT}/src/ast/real-typescript-analyzer`)).RealTypeScriptAnalyzer().analyze(p.parse(src).rootNode, src, `${ROOT}/${f}`)
    const rs = (r.relationships ?? []).filter((x: any) => x.type === "references")
    refs += rs.length
    const g = rs.filter((x: any) => x.source === "global")
    globals += g.length
    const counts = new Map<string, number>()
    for (const x of rs) { const k = `${x.source}->${x.target}|${x.line_number ?? "-"}`; counts.set(k, (counts.get(k) ?? 0) + 1) }
    for (const [k, n] of counts) if (n > 1) { dupExact.set(k, (dupExact.get(k) ?? 0) + 1); if (samples.length < 6) samples.push(`${f}  x${n}  ${k}`) }
  }
  console.log(`files=${files.length}  references=${refs}  of which source=global: ${globals} (${((100 * globals) / refs).toFixed(1)}%)`)
  console.log(`exact duplicate reference rows: ${[...dupExact.values()].reduce((a, b) => a + b, 0)} across ${dupExact.size} distinct keys`)
  for (const s of samples) console.log("  " + s)
}
main()
