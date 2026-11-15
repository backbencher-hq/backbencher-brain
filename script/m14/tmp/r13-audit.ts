import * as fs from "fs"
import { execSync } from "child_process"
import * as WTS from "web-tree-sitter"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load(`${ROOT}/wasm/tree-sitter-typescript.wasm`)
  // HEAD = the file as committed at fc52d9ac; CAND = the working tree
  const Base = (await import(`${ROOT}/src/ast/__r13_head_baseline`)).RealTypeScriptAnalyzer
  const Cand = (await import(`${ROOT}/src/ast/real-typescript-analyzer`)).RealTypeScriptAnalyzer
  const files = execSync("git ls-files '*.ts' | rg -v '^node_modules/|^dist/|^wasm/|^script/m14/tmp/' | head -1200", { encoding: "utf8", cwd: ROOT }).trim().split("\n").filter(Boolean)
  const key = (e: any) => `${e.type}|${e.source}|${e.target}`
  let removed = 0, added = 0, unjust = 0
  const bad: string[] = []
  const removedByType = new Map<string, number>()
  for (const f of files) {
    const src = fs.readFileSync(`${ROOT}/${f}`, "utf8")
    const p1 = new P(); p1.setLanguage(lang); const p2 = new P(); p2.setLanguage(lang)
    let a: any, b: any
    try { a = await new Base().analyze(p1.parse(src).rootNode, src, `${ROOT}/${f}`) } catch { continue }
    try { b = await new Cand().analyze(p2.parse(src).rootNode, src, `${ROOT}/${f}`) } catch { continue }
    const A = new Map<string, any>(); for (const e of a.relationships ?? []) A.set(key(e), e)
    const B = new Map<string, any>(); for (const e of b.relationships ?? []) B.set(key(e), e)
    for (const [k, e] of A) if (!B.has(k)) {
      removed++
      removedByType.set(e.type, (removedByType.get(e.type) ?? 0) + 1)
      // justified iff the target is a loop variable or catch binding in the source
      const declared = new Set((a.symbols ?? []).map((s: any) => s.name))
      if (e.type !== "references" || !declared.has(e.target)) { unjust++; if (bad.length < 6) bad.push(`${f} ${e.type} ${e.source}->${e.target}`) }
    }
    for (const [k, e] of B) if (!A.has(k)) { added++; if (bad.length < 6) bad.push(`ADDED ${f} ${e.type} ${e.source}->${e.target}`) }
  }
  console.log(`files=${files.length}`)
  console.log(`removed=${removed}  added=${added}  unjustified=${unjust}`)
  console.log(`removed by type: ${[...removedByType].map(([t, n]) => `${t}=${n}`).join("  ")}`)
  for (const s of bad) console.log("  " + s)
}
main()
