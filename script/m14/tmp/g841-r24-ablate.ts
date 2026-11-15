// #841 r24: ABLATION on the full RestOauthService.groovy — full-file parse after
// each single neutralization. Only full-file parses count (prefix bisects lie at
// multi-line constructs).
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
const parser = new P(); parser.setLanguage(lang)
const FILE = "/home/ishaq2321/bb_tests/repositories/grails-core/grails-spring-security/rest/core/grails-app/services/grails/plugin/springsecurity/rest/RestOauthService.groovy"
const orig = fs.readFileSync(FILE, "utf8")

function errInfo(src: string): string {
  const t = parser.parse(src).rootNode
  let n = 0, first = "", maxLen = 0
  const walk = (x: any): void => {
    if ((x.type === "ERROR" || x.isMissing) && x.endIndex > x.startIndex) {
      n++
      const len = x.endIndex - x.startIndex
      if (len > maxLen) { maxLen = len; first = `${x.type}@r${x.startPosition.row + 1}` }
    }
    for (let i = 0; i < x.childCount; i++) walk(x.child(i))
  }
  walk(t)
  return n === 0 ? "CLEAN" : `${n} nodes, biggest ${first} len=${maxLen}`
}

const EDITS: Array<[string, RegExp, string]> = [
  ["neutralize line-61 initializer", /clientCache = CacheBuilder\.newBuilder\(\)\.<String, IndirectClient> build \{ String provider ->/, "clientCache = null // ABLATED { String provider ->"],
  ["drop explicit generic, keep closure", /\.newBuilder\(\)\.<String, IndirectClient> build \{/, ".newBuilder().build {"],
  ["keep generic, parenthesize call", /\.newBuilder\(\)\.<String, IndirectClient> build \{/, ".newBuilder().<String, IndirectClient> build({"],
  ["remove transient modifiers", /\btransient\b/g, ""],
]
console.log("ORIGINAL:", errInfo(orig))
for (const [name, re, rep] of EDITS) {
  if (!re.test(orig)) { console.log(`${name.padEnd(36)} — pattern not found`); continue }
  const out = orig.replace(re, rep)
  console.log(`${name.padEnd(36)} ${errInfo(out)}`)
}
