import * as fs from "fs"
import * as path from "path"
async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-rust.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const arm = await parseSrc(`fn f(x: u32) u32 { match x { v => v, _ => 0, } }`)
  const dump = (n: any, dp: number): void => {
    if (dp > 6) return
    const fld = (n as any).parent ? "" : ""
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify(n.text.slice(0, 18)))
    for (let i = 0; i < n.namedChildCount; i++) dump(n.namedChild(i), dp + 1)
  }
  const find = (n: any, t: string): any => {
    if (n.type === t) return n
    for (let i = 0; i < n.namedChildCount; i++) { const r = find(n.namedChild(i), t); if (r) return r }
    return null
  }
  const ma = find(arm, "match_arm")
  console.log("--- match_arm fields: pattern =", ma.childForFieldName("pattern")?.type, "value =", ma.childForFieldName("value")?.type)
  dump(ma, 0)
  const clo = await parseSrc(`fn f() { let h = |G| G + 1; }`)
  const cp = find(clo, "closure_parameters")
  console.log("--- closure_parameters children:", Array.from({length: cp.namedChildCount}, (_, i) => cp.namedChild(i)?.type + ":" + JSON.stringify(cp.namedChild(i)?.text.slice(0,8))).join(" | "))
}
main()
