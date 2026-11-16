import * as fs from "fs"
import { execSync } from "child_process"
import * as WTS from "web-tree-sitter"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load(`${ROOT}/wasm/tree-sitter-typescript.wasm`)
  const files = execSync("git ls-files '*.ts' | rg -v '^node_modules/|^dist/|^wasm/' | head -800", { encoding: "utf8", cwd: ROOT }).trim().split("\n").filter(Boolean)
  let catchFiles = 0, shadowed = 0
  const samples: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(`${ROOT}/${f}`, "utf8")
    const p = new P(); p.setLanguage(lang)
    const r: any = await new (await import(`${ROOT}/src/ast/real-typescript-analyzer`)).RealTypeScriptAnalyzer().analyze(p.parse(src).rootNode, src, `${ROOT}/${f}`)
    const names = new Set((r.symbols ?? []).map((s: any) => s.name))
    // catch bindings, straight off the parse
    const caught: string[] = []
    const st: any[] = [p.parse(src).rootNode]
    while (st.length > 0) {
      const n = st.pop()!
      if (n.type === "catch_clause") {
        const prm = n.namedChild(0)
        const walkPat = (x: any): void => {
          if (!x) return
          if (x.type === "identifier") caught.push(x.text)
          for (let i = 0; i < x.namedChildCount; i++) walkPat(x.namedChild(i))
        }
        walkPat(prm)
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
    }
    if (caught.length === 0) continue
    catchFiles++
    const hit = caught.filter((c) => names.has(c))
    if (hit.length) {
      shadowed += hit.length
      if (samples.length < 8) samples.push(`${f}  catch binds [${[...new Set(caught)].join(",")}] shadowing a declared [${[...new Set(hit)].join(",")}]`)
    }
  }
  console.log(`files scanned=${files.length}  files with a catch binding=${catchFiles}  catch bindings shadowing a file-level symbol=${shadowed}`)
  for (const s of samples) console.log("  " + s)
}
main()
