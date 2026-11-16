// #841 round 22: structural dump around the innermost error — ancestors + siblings
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2] ?? "wasm/tree-sitter-groovy.wasm"))
const parser = new P(); parser.setLanguage(lang)

const SRC = fs.readFileSync("<corpus-root>/bb_tests/repositories/grails-core/grails-core-cli-legacy/src/test/groovy/org/apache/grails/core/cli/LegacyCommandRegistryLoadingSpec.groovy", "utf8")
const root = parser.parse(SRC).rootNode

// find the innermost error at line 316
let target: any = null
const walk = (n: any): void => {
  if ((n.type === "ERROR" || n.isMissing) && n.startPosition.row === 315 && !target) target = n
  for (let i = 0; i < n.childCount; i++) walk(n.child(i))
}
walk(root)
if (!target) { console.log("no error at line 316?!"); process.exit(0) }
console.log(`target: ${target.type} [${target.startPosition.row + 1}:${target.startPosition.column}] len=${target.endIndex - target.startIndex}`)

// print ancestors bottom-up with their siblings
let node = target
let depth = 0
while (node && depth < 10) {
  const p = node.parent
  const sib: string[] = []
  if (p) {
    for (let i = 0; i < p.childCount; i++) {
      const c = p.child(i)
      if (!c) continue
      const mark = c.id === node.id ? ">>>" : "   "
      const txt = c.type === "ERROR" ? "ERROR<" + c.text.slice(0, 30).replace(/\n/g, "\\n") + ">" : JSON.stringify(c.text.slice(0, 28).replace(/\n/g, "\\n"))
      sib.push(`${mark} ${c.type} ${c.id === node.id ? "" : txt}`)
    }
  }
  console.log(`\n--- depth ${depth}: ${node.type} [${node.startPosition.row + 1}:${node.startPosition.column}]`)
  for (const s of sib.slice(0, 14)) console.log("  " + s)
  node = p
  depth++
}
