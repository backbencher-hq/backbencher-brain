// go #914 — the exact `type_alias` tree shape on the PINNED grammar, and what
// the analyzer publishes for it. Proves the field names the oracle may read.
// Run: bun script/m14/tmp/go-914-alias-tree.ts
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
import { deriveGoImplements } from "../differential"

const cases: [string, string][] = [
  ["alias-of-interface", `package p\ntype ( A = interface { M() }\n T interface { A }\n S struct{}\n)\nfunc (S) M() {}\n`],
  ["alias-of-struct", `package p\ntype B = struct { X int }\ntype ( E struct { B }\n I interface { M() }\n)\nfunc (B) M() {}\nfunc (E) M() {}\n`],
  ["named-iface", `package p\ntype C interface { M() }\ntype S struct{}\nfunc (S) M() {}\n`],
]
for (const [label, src] of cases) {
  const parser = await ASTEngine.getParser("go" as any)
  const tree = parser.parse(src)
  console.log(`===== ${label}`)
  const dump = (n: any, d = 0) => {
    if (d > 5) return
    const f = ["name", "type", "value"].map((k) => `${k}=${n.childForFieldName?.(k)?.text ?? "-"}`).join(" ")
    console.log(`${"  ".repeat(d)}${n.type}  [${f}]`)
    for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), d + 1)
  }
  dump(tree.rootNode)
  const a: any = new RealGoAnalyzer()
  const res: any = await a.analyze(tree.rootNode, src, "t.go")
  console.log("  analyzer symbols:", (res.symbols ?? []).map((s: any) => `${s.kind}:${s.name}${s.ownerName ? "@" + s.ownerName : ""}`).join(" "))
  console.log("  analyzer impls:", (res.relationships ?? []).filter((r: any) => String(r.type) === "implements").map((r: any) => `${r.source}->${r.target}`).join(" "))
  console.log("  oracle impls:", deriveGoImplements(tree.rootNode).map((e) => `${e.from}->${e.target}`).join(" "))
}
