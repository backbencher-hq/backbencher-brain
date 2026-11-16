/**
 * script/m14/tmp/fsharp-ab-regression-probe.ts
 *
 * The wired/unpatched A/B over the lane's 400-file sample found exactly ONE file
 * that the patched grammar damages while unpatched 0.3.11 parses clean:
 * `tests/EndToEndBuildTests/BasicProvider/BasicProvider/BasicProvider.Runtime.fs`
 * (1 ERROR node vs 0). This probe shows where that ERROR sits, so the pin's
 * regression note names a site rather than a count.
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dir ?? path.dirname(Bun.main), "..", "..", "..")
const HOME = process.env.HOME ?? ""
const FILE = "<corpus-root>/bb_tests/repositories/fsharp/tests/EndToEndBuildTests/BasicProvider/BasicProvider/BasicProvider.Runtime.fs"
const GRAMMARS = [
  { label: "wired", file: path.join(ROOT, "wasm/tree-sitter-fsharp.wasm") },
  { label: "npm-0.3.11-unpatched", file: path.join(HOME, ".bun/install/cache/tree-sitter-fsharp@0.3.11@@@1/tree-sitter-fsharp.wasm") },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const src = fs.readFileSync(FILE, "utf8")
  console.log(`file: ${path.relative("<corpus-root>/bb_tests/repositories/fsharp", FILE)} (${src.length} bytes)`)
  for (const g of GRAMMARS) {
    const lang = await Language.load(fs.readFileSync(g.file))
    const p = new ParserClass()
    p.setLanguage(lang)
    const tree = p.parse(src)
    const root = tree.rootNode
    const found: any[] = []
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()
      if (n.type === "ERROR" || n.isMissing) {
        const line = src.slice(0, n.startIndex).split("\n").length
        found.push({ type: n.type, missing: n.isMissing, line, text: n.text.slice(0, 160) })
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
    console.log(`\n--- ${g.label}: ${found.length} ERROR/MISSING node(s)`)
    for (const f of found) console.log(`    line ${f.line} ${f.missing ? "MISSING" : f.type}: ${JSON.stringify(f.text)}`)
    tree.delete?.()
    p.delete?.()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
