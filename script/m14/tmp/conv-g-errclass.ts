import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const files = fs.readdirSync("/home/ishaq2321/bb_tests/repositories/grails-core", { recursive: true }).filter((f: string) => f.endsWith(".groovy"))
  let shown = 0
  for (const f of files) {
    const src = fs.readFileSync("/home/ishaq2321/bb_tests/repositories/grails-core/" + f, "utf8")
    const tree = parser.parse(src)
    if (!(tree.rootNode as any).hasError) continue
    const errs: any[] = []
    const walk = (n: any): void => {
      if (n.type === "ERROR" || n.isMissing) errs.push(n)
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(tree.rootNode)
    const first = errs[0]
    if (first && shown < 8) {
      const line = first.startPosition.row
      const lineText = src.split("\n")[line] ?? ""
      process.stdout.write(f + "  @" + (line + 1) + " (" + errs.length + " errs): " + lineText.trim().slice(0, 90) + "\n")
      shown++
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
