import { Parser, Language } from "web-tree-sitter"
import * as path from "path"
import { deriveRubyEdges } from "../../../script/m14/differential"
await Parser.init()
const ROOT = "/home/sano/ishaq/backbencher-brain"
const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
const parser = new Parser(); parser.setLanguage(lang as any)
const cases: Array<[string,string]> = [
  ["chained receiver", "class C\n  def go\n    a.b.new(1)\n  end\nend\n"],
  ["constant receiver", "class C\n  def go\n    Form::Batch.new(1)\n  end\nend\n"],
  ["lowercase identifier", "class C\n  def go\n    task_class.new(1)\n  end\nend\n"],
]
for (const [name, src] of cases) {
  const tree = parser.parse(src)
  const edges = deriveRubyEdges(tree.rootNode).filter((e) => e.label === "instantiates" || e.label === "calls")
  console.log(`  ${name.padEnd(24)} ${edges.map((e) => `${e.label}:${e.target}`).join("  ") || "(nothing)"}`)
  // what does the call node's named children look like?
  const st: any[] = [tree.rootNode]
  while (st.length) {
    const n = st.pop()!
    if (n.type === "call") {
      const m = n.childForFieldName?.("method")
      if (m?.text === "new") {
        console.log(`      call children: ${(n.children ?? []).map((c: any) => `${c.type}${c.id === m.id ? "*" : ""}`).join(", ")}`)
        break
      }
    }
    for (const c of n.children ?? []) st.push(c)
  }
}
