import * as fs from "fs"
import * as path from "path"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-c.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const cases: [string, string][] = [
    ["unbalanced-open", `int f( {\nint v = 1;\n`],
    ["ifdef-noclose", `#ifdef FOO\nint f(int x) { return x; }\nint v = 2;\n`],
    ["stray-else", `int f(void) { if (1) return 1; else if (2) return 2; }\n#ifdef X\n#else\nint v = 3;\n`],
    ["wsd-like", `static FOO struct Bar {\nint m;\n};\nint v = 4;\n`],
    ["broken-proto", `int broken(;\nint v = 5;\n`],
    ["semi-soup", `;;;\nint ;\nint v = 6;\n`],
  ]
  for (const [name, src] of cases) {
    const root = await parse(src)
    const out: any[] = []
    const walk = (n: any): void => {
      if (n.type === "ERROR" || n.isMissing) out.push(n.type + "@" + n.startIndex + "-" + n.endIndex + ":" + JSON.stringify(n.text.slice(0, 40)))
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(root)
    console.log(name, "hasError=" + root.hasError, JSON.stringify(out))
  }
}
main()
