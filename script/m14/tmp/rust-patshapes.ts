import * as fs from "fs"
import * as path from "path"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-rust.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const src = `const RED: u8 = 1;\nstruct S { x: i32 }\nenum E { V(i32) }\nfn f() {\n  let (a, b) = (1, 2);\n  let S { x: y } = S { x: 3 };\n  let Some(v) = Some(1);\n  let RED2 = RED;\n  let ref r = &b;\n  let mut m = 1;\n  match Some(2) { Some(w) => w, E::V(z) => z, _ => 0 };\n}\n`
  const root = await parse(src)
  console.log("hasError=" + root.hasError)
  const d = (n: any, dp: number): void => {
    if (dp > 4) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify(n.text.slice(0, 26)))
    for (let i = 0; i < n.namedChildCount; i++) d(n.namedChild(i), dp + 1)
  }
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  for (const ld of findAll(root, (n) => n.type === "let_declaration").slice(0, 6)) { console.log("=== let:"); d(ld, 0) }
  const ma = findAll(root, (n) => n.type === "match_arm")[0]
  if (ma) { console.log("=== arm:"); d(ma, 0) }
}
main()
