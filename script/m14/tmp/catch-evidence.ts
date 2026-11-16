import * as fs from "fs"
import { execSync } from "child_process"
import * as WTS from "web-tree-sitter"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const TARGETS = ["script/cpp-review/d5-fnparam.ts", "ide/vscode/src/extension.ts", "ide/vscode/src/auto-index.ts"]
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load(`${ROOT}/wasm/tree-sitter-typescript.wasm`)
  for (const f of TARGETS) {
    const src = fs.readFileSync(`${ROOT}/${f}`, "utf8")
    const p = new P(); p.setLanguage(lang); const tree = p.parse(src)
    const r: any = await new (await import(`${ROOT}/src/ast/real-typescript-analyzer`)).RealTypeScriptAnalyzer().analyze(tree.rootNode, src, `${ROOT}/${f}`)
    const declared = new Set((r.symbols ?? []).map((s: any) => s.name))
    const caught = new Set<string>()
    const st: any[] = [tree.rootNode]
    while (st.length > 0) {
      const n = st.pop()!
      if (n.type === "catch_clause") {
        const walk = (x: any): void => {
          if (!x) return
          if (x.type === "identifier") caught.add(x.text)
          for (let i = 0; i < x.namedChildCount; i++) walk(x.namedChild(i))
        }
        walk(n.namedChild(0))
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
    }
    const shadow = [...caught].filter((c) => declared.has(c))
    console.log(`\n${f}`)
    console.log(`  catch binds: ${[...caught].join(", ") || "-"}   shadowing: ${shadow.join(", ") || "-"}`)
    for (const rel of (r.relationships ?? []).filter((x: any) => x.type === "references" && shadow.includes(x.target) && x.source !== x.target)) {
      console.log(`  FALSE?  ${rel.source} -> ${rel.target}`)
    }
  }
}
main()
