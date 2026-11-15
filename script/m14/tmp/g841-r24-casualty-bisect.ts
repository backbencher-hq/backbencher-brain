// #841 r24: which statement in LegacyCommandRegistryLoadingSpec regressed at x24b?
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(process.argv[2] ?? "/tmp/x24b.wasm")
const parser = new P(); parser.setLanguage(lang)
const FILE = process.argv[3] ?? "/home/ishaq2321/bb_tests/repositories/grails-core/grails-core-cli-legacy/src/test/groovy/org/apache/grails/core/cli/LegacyCommandRegistryLoadingSpec.groovy"
const lines = fs.readFileSync(FILE, "utf8").split("\n")
function isClean(src: string): boolean {
  const t = parser.parse(src).rootNode
  let bad = false
  const walk = (n: any): void => {
    if (n.type === "ERROR" || n.isMissing) bad = true
    for (let i = 0; i < n.childCount && !bad; i++) walk(n.child(i))
  }
  walk(t)
  return !bad
}
const winners: number[] = []
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === "") continue
  const out = lines.slice(0, i).concat(lines.slice(i + 1)).join("\n")
  if (isClean(out)) winners.push(i + 1)
}
console.log("single-line removals that restore CLEAN:", winners.length ? winners.join(",") : "NONE")
for (const w of winners.slice(0, 8)) console.log(`  ${w}: ${lines[w - 1]?.slice(0, 110)}`)
