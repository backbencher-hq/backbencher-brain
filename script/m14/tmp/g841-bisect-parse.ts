// Bisect probe: parse corpus files under a specified wasm and report error nodes.
// Usage: bun g841-bisect-parse.ts <wasmPath> <file1> [file2...]
import * as fs from "fs"
async function main() {
  const [, , wasmArg, ...files] = process.argv
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync(wasmArg))
  const parser = new P(); parser.setLanguage(lang)
  const ROOT = "<corpus-root>/bb_tests/repositories/grails-core"
  for (const f of files) {
    const src = fs.readFileSync(ROOT + "/" + f, "utf8")
    const tree = parser.parse(src)
    const nodes: string[] = []
    const walk = (n: any) => {
      if (n.type === "ERROR" || n.isMissing) nodes.push(`${n.startPosition.row + 1}:${n.startPosition.column} ${n.isMissing ? "MISSING " : ""}${n.type} :: ${JSON.stringify((n.text || "").split("\n")[0].slice(0, 60))}`)
      for (let i = 0; i < n.childCount; i++) { const ch = n.child(i); if (ch) walk(ch) }
    }
    walk(tree.rootNode)
    console.log(`${(tree.rootNode as any).hasError ? "FAIL" : "OK  "} ${f} (${nodes.length} nodes)`)
    for (const r of nodes.slice(0, 3)) console.log("   " + r)
  }
}
main()
