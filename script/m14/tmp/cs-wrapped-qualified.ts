// script/m14/tmp/cs-wrapped-qualified.ts — can a qualified name be WRAPPED
// (dot at end of line / start of next) in a using directive or a base list, and
// where does the analyzer's stamp land? Measured, because the stamp is the
// qualified_name node's start line and the oracle checks the TOKEN (the last
// segment), which a wrapped form writes on a different line.
import * as fs from "fs"
import * as path from "path"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P()
  p.setLanguage(LANG)
  const ROOT = process.cwd()
  const { RealCSharpAnalyzer } = await import(path.join(ROOT, "src/ast/real-csharp-analyzer"))

  const cases: Array<[string, string]> = [
    ["using wrapped before dot", `using System\n    .Collections.Generic;\nclass C { }`],
    ["using wrapped after dot", `using System.\n    Collections.Generic;\nclass C { }`],
    ["base wrapped before dot", `class C :\n    System.\n        IDisposable\n{ }`],
    ["base wrapped after dot", `class C : System\n    .Collections.IEnumerable\n{ }`],
    ["alias using wrapped target", `using G = System.\n    Collections.Generic;\nclass C { }`],
  ]
  for (const [label, src] of cases) {
    const root = p.parse(src).rootNode
    const errs: string[] = []
    const walk = (n: any) => {
      if (n.type === "ERROR" || n.isMissing) errs.push(`${n.type}@${n.startPosition.row + 1}`)
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    walk(root)
    for (let i = 0; i < root.namedChildCount; i++) {
      const c = root.namedChild(i)
      if (c.type === "using_directive") {
        const q = c.namedChildren.find((x: any) => x.type === "qualified_name")
        console.log(`\n[${label}] using_directive ${c.startPosition.row + 1}..${c.endPosition.row + 1}; qualified_name ${q ? `${q.startPosition.row + 1}..${q.endPosition.row + 1} text=${JSON.stringify(q.text)}` : "(none)"}`)
      }
      if (c.type === "class_declaration") {
        const bl = c.namedChildren.find((x: any) => x.type === "base_list")
        if (bl) console.log(`\n[${label}] base_list ${bl.startPosition.row + 1}..${bl.endPosition.row + 1}; first base ${bl.namedChild(0)?.type} ${bl.namedChild(0)?.startPosition.row + 1}..${bl.namedChild(0)?.endPosition.row + 1} text=${JSON.stringify(bl.namedChild(0)?.text)}`)
      }
    }
    if (errs.length) console.log(`  ERROR nodes: ${errs.join(",")}`)
    const res: any = await new RealCSharpAnalyzer().analyze(root, src, "x.cs")
    const lines = src.split("\n")
    for (const r of res.relationships ?? []) {
      if (r.type === "references" || r.type === "extends" || r.type === "implements") {
        const ln = r.line_number
        console.log(`  ${r.type} ${r.source} -> ${r.target} line=${ln ?? "-"} ${JSON.stringify((lines[(ln ?? 1) - 1] ?? "").trim())}`)
      }
    }
  }
}

main()
