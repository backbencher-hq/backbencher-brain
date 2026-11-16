// #841 r24: COMPLETE-prefix bisect — prefix[k] = lines[0..k]. The first erroring
// prefix identifies the killer line as the one just added.
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
const parser = new P(); parser.setLanguage(lang)
const FILE = process.argv[2] ?? "<corpus-root>/bb_tests/repositories/grails-core/grails-spring-security/rest/core/grails-app/services/grails/plugin/springsecurity/rest/RestOauthService.groovy"
const lines = fs.readFileSync(FILE, "utf8").split("\n")

function errors(src: string): Array<[string, number]> {
  const t = parser.parse(src).rootNode
  const out: Array<[string, number]> = []
  const walk = (n: any): void => {
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) out.push([n.type, n.startPosition.row + 1])
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(t)
  return out
}

// coarse-to-fine: find first erroring prefix by scan with stride, then bisect
let lo = 0, hi = lines.length
// quick check: full file errors?
const full = errors(lines.join("\n"))
if (full.length === 0) { console.log("full file CLEAN — nothing to bisect"); process.exit(0) }
// binary search smallest erroring prefix length (in lines)
// invariant: prefix(lo) clean, prefix(hi) errors
while (hi - lo > 1) {
  const mid = Math.floor((lo + hi) / 2)
  if (errors(lines.slice(0, mid).join("\n")).length > 0) hi = mid
  else lo = mid
}
console.log(`prefix through line ${lo} (1-indexed) CLEAN; adding line ${hi} introduces error`)
console.log(`error kinds at full length: ${full.length}`)
for (const [k, r] of full.slice(0, 4)) console.log(`   ${k}@row${r}`)
console.log(`\nkilling line ${hi}:`)
for (let i = Math.max(0, hi - 4); i < Math.min(lines.length, hi + 3); i++)
  console.log(`  ${i + 1}${i + 1 === hi ? " >>" : "   "} ${lines[i]?.slice(0, 110)}`)
