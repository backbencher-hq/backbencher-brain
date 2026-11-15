import * as fs from "fs"
import * as path from "path"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const src = `fn f() void {
  if (opt) |v| { _ = v; }
  for (items) |x| { _ = x; }
  while (cond) |e| { _ = e; }
  switch (u) { else => |t| { _ = t; } }
  const y = foo catch |err| err;
}
`
  const root = await parse(src)
  console.log("hasError=" + root.hasError)
  const d = (n: any, dp: number): void => {
    if (dp > 4) return
    console.log("  ".repeat(dp) + n.type + " :: " + JSON.stringify(n.text.slice(0, 30)))
    for (let i = 0; i < n.namedChildCount; i++) d(n.namedChild(i), dp + 1)
  }
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
    return out
  }
  for (const t of ["payload", "if_statement", "for_statement", "while_statement", "switch_prong", "catch_expression"]) {
    const ns = findAll(root, (n) => n.type === t)
    console.log("=== " + t + " x" + ns.length)
    if (ns[0]) d(ns[0], 0)
  }
}
main()
