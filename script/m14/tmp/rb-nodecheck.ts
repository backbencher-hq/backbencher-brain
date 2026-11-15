import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-ruby.wasm"))
  const count = (LANG as any).nodeTypeCount as number
  const found = new Set<string>()
  for (let id = 0; id < count; id++) {
    try {
      const t = (LANG as any).nodeTypeForId(id)
      const nm = typeof t === "string" ? t : t?.type
      if (nm) found.add(nm)
    } catch { /* ignore */ }
  }
  for (const w of ["command", "command_call", "parameters", "method_parameters", "undef", "unary", "setter", "block_parameters", "lambda_parameters"]) {
    console.log(`${w}: ${found.has(w) ? "DEFINED" : "ABSENT"}`)
  }
  const p = new P(); p.setLanguage(LANG)
  for (const src of [`foo bar\n`, `foo(bar)\n`, `puts "hi"\n`]) {
    const root = p.parse(src).rootNode
    console.log(JSON.stringify(src.trim()), "->", root.namedChild(0)?.type)
  }
}
main()
