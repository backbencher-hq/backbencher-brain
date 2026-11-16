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
  let filesWithCatch = 0, boundFiles = 0, shadowHits = 0
  const samples: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(`${ROOT}/${f}`, "utf8")
    const p = new P(); p.setLanguage(lang); const tree = p.parse(src)
    const r: any = await new (await import(`${ROOT}/src/ast/real-typescript-analyzer`)).RealTypeScriptAnalyzer().analyze(tree.rootNode, src, `${ROOT}/${f}`)
    const declared = new Set((r.symbols ?? []).map((s: any) => s.name))
    const st: any[] = [tree.rootNode]; const bound = new Set<string>(); let anyCatch = false
    while (st.length > 0) {
      const n = st.pop()!
      if (n.type === "catch_clause") {
        anyCatch = true
        const first = n.namedChild(0)
        // the binding is the first named child ONLY when it is not the body
        if (first && first.type !== "statement_block") {
          const walk = (x: any): void => {
            if (!x) return
            if (x.type === "identifier") bound.add(x.text)
            for (let i = 0; i < x.namedChildCount; i++) walk(x.namedChild(i))
          }
          walk(first)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
    }
    if (!anyCatch) continue
    filesWithCatch++
    if (bound.size === 0) continue
    boundFiles++
    const hit = [...bound].filter((b) => declared.has(b))
    for (const h of hit) {
      const rels = (r.relationships ?? []).filter((x: any) => x.type === "references" && x.target === h && x.source !== h)
      if (rels.length > 0) {
        shadowHits += rels.length
        if (samples.length < 6) samples.push(`${f}  catch binds [${[...bound].join(",")}] -> ${rels.map((x: any) => `${x.source}->${x.target}`).join(", ")}`)
      }
    }
  }
  console.log(`files=${files.length}  with a catch clause=${filesWithCatch}  with a catch BINDING=${boundFiles}`)
  console.log(`references edges where the target is a catch binding that shadows a file-level symbol=${shadowHits}`)
  for (const s of samples) console.log("  " + s)
}
main()
