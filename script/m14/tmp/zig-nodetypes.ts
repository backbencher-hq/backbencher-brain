import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-zig.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const want = new Set(["argument_list","field_declaration","return_statement","return_expression","arguments","parameter","container_field","variable_declaration","call_expression","block","block_expression","error_type"])
  const seen: Record<string, number> = {}
  const files: string[] = []
  for (const repo of ["/home/ishaq2321/bb_tests/repositories/zig", "/home/ishaq2321/bb_tests/repositories/zls"]) {
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) { if (!/^(\.|node_modules|build|target|zig-cache)/.test(e.name)) walk(q) } else if (e.name.endsWith(".zig")) files.push(q) } }
    walk(repo)
  }
  for (const f of files.slice(0, 400)) {
    const root = p.parse(fs.readFileSync(f, "utf8")).rootNode
    const w: any[] = [root]
    while (w.length) { const n = w.pop()!; if (want.has(n.type)) seen[n.type] = (seen[n.type] ?? 0) + 1; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) w.push(c) } }
  }
  for (const k of [...want].sort()) console.log(k.padEnd(24), seen[k] ?? 0)
}
main()
