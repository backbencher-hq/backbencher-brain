import * as fs from "fs"
import { execSync } from "child_process"
import * as WTS from "web-tree-sitter"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const [a, b, label = "A/B", lim] = process.argv.slice(2)
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const ts = await L.load(`${ROOT}/wasm/tree-sitter-typescript.wasm`)
  const tsx = await L.load(`${ROOT}/wasm/tree-sitter-tsx.wasm`)
  const Base = (await import(a)).RealTypeScriptAnalyzer
  const Cand = (await import(b)).RealTypeScriptAnalyzer
  const files = execSync(`git ls-files '*.ts' '*.tsx' | rg -v '^node_modules/|^dist/|^wasm/' | head -${lim ?? 1500}`, { encoding: "utf8", cwd: ROOT }).trim().split("\n").filter(Boolean)
  let same = 0; const diffs: string[] = []
  for (const f of files) {
    const full = `${ROOT}/${f}`
    let src: string
    try { src = fs.readFileSync(full, "utf8") } catch { continue }
    const g = f.endsWith(".tsx") ? tsx : ts
    const p1 = new P(); p1.setLanguage(g); const p2 = new P(); p2.setLanguage(g)
    let x: any = {}, y: any = {}
    try { x = await new Base().analyze(p1.parse(src).rootNode, src, full) } catch {}
    try { y = await new Cand().analyze(p2.parse(src).rootNode, src, full) } catch {}
    const d = ["symbols", "relationships", "imports", "exports", "errors"].filter((k) => JSON.stringify(x?.[k] ?? null) !== JSON.stringify(y?.[k] ?? null))
    if (!d.length) same++; else diffs.push(`${f} [${d.join(",")}]`)
  }
  console.log(`${label}: identical on ${same}/${files.length}   differing=${diffs.length}`)
  for (const d of diffs.slice(0, 10)) console.log("   " + d)
}
main()
