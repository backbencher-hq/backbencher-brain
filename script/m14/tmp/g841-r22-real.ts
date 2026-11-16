// #841 round 22: real-file probe — where does the innermost error sit?
import fs from "node:fs"
import path from "node:path"
const REPO = "<corpus-root>/bb_tests/repositories/grails-core"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2] ?? "wasm/tree-sitter-groovy.wasm"))
const parser = new P(); parser.setLanguage(lang)

const FILES = [
  "build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/SbomPlugin.groovy",
].map((f) => path.join(REPO, f))
// locate the other two
const find = (name: string, dir: string = REPO): string[] => {
  const out: string[] = []
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()!
    let ents: any[] = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of ents) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.name === name) out.push(p)
    }
  }
  return out
}
const all = [...FILES, ...find("LegacyCommandRegistryLoadingSpec.groovy"), ...find("ViewsTransform.groovy")]
for (const abs of all) {
  const src = fs.readFileSync(abs, "utf8")
  const root = parser.parse(src).rootNode
  const errs: Array<{ row: number; col: number; len: number; text: string }> = []
  const walk = (n: any): void => {
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex)
      errs.push({ row: n.startPosition.row + 1, col: n.startPosition.column, len: n.endIndex - n.startIndex, text: n.text.slice(0, 70) })
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
  errs.sort((a, b) => a.len - b.len)
  console.log(`=== ${path.basename(abs)}: ${errs.length} nonzero error node(s), first line=${src.split("\n").length}`)
  for (const e of errs.slice(0, 5)) console.log(`  [${e.row}:${e.col}] len=${e.len} ${JSON.stringify(e.text)}`)
}
