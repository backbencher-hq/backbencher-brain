import * as fs from "fs"
import * as path from "path"
import { RealCSharpAnalyzer } from "../../../src/ast/real-csharp-analyzer"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const dumpAll = (n: any, dp: number, max: number): void => {
    if (!n || dp > max) return
    console.log("  ".repeat(dp) + (n.isNamed ? n.type : `"${n.type}"`) + " :: " + JSON.stringify((n.text ?? "").slice(0, 26)))
    for (let i = 0; i < (n.childCount ?? 0); i++) dumpAll(n.child(i), dp + 1, max)
  }
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (!n) return out
    if (pred(n)) out.push(n)
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) findAll(n.namedChild(i), pred, out)
    return out
  }
  {
    const root = await parseSrc(`class A { bool M(object o) { return o is Point(1, int y); } }`)
    const isp = findAll(root, (x) => x.type === "is_pattern_expression")[0]
    console.log("=== positional is_pattern:"); dumpAll(isp, 1, 4)
  }
  for (const [nm, src] of [["typeof", `class A { Type T() { return typeof(Point); } }`], ["default", `class A { Point M() { return default(Point); } }`]] as const) {
    const root = await parseSrc(src)
    const kinds = new Set<string>()
    const walk = (n: any): void => { if (!n) return; kinds.add(n.type); for (let i = 0; i < (n.namedChildCount ?? 0); i++) walk(n.namedChild(i)) }
    walk(root)
    console.log(`=== ${nm}: has typeof_expression=${[...kinds].filter((k) => /typeof|default/.test(k)).join(",")}`)
  }
  {
    const root = await parseSrc(`class A { void M() { Helper(out x, ref y, in z); } }`)
    for (const a of findAll(root, (x) => x.type === "argument")) { console.log("--- arg:"); dumpAll(a, 1, 2) }
  }
  {
    const root = await parseSrc(`class A { int count; string N() { var s = nameof(count); return s; } }`)
    const r: any = await new RealCSharpAnalyzer().analyze(root, `class A { int count; string N() { var s = nameof(count); return s; } }`, "x.cs")
    console.log("=== nameof emission:", JSON.stringify((r.relationships ?? []).map((x: any) => `${x.type}[${x.source}->${x.target}]`)))
  }
}
main()
