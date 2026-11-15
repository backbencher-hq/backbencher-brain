// #841 r24: minimal multi-arg command value repro at HEAD
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
const parser = new P(); parser.setLanguage(lang)
function verdict(src: string): string {
  const t = parser.parse(src).rootNode
  const errs: string[] = []
  const walk = (n: any): void => {
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex)
      errs.push(`${n.type}@r${n.startPosition.row + 1} len=${n.endIndex - n.startIndex}`)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(t)
  return errs.length === 0 ? "CLEAN" : `ERR ${errs.slice(0, 2).join(",")}`
}
const CASES: Array<[string, string]> = [
  ["M1 two-arg command value", `def u = grailsLinkGenerator.link controller: 'restOauth', action: 'callback'\n`],
  ["M2 two-arg + map", `def u = grailsLinkGenerator.link controller: 'x', params: [provider: p]\n`],
  ["M3 single-arg control (r17 landed)", `def u = to UploadPage\n`],
  ["M4 two-arg control, statement", `println 'a', 'b'\n`],
  ["M5 method-call parens + map", `def u = grailsLinkGenerator.link(controller: 'x', action: 'y')\n`],
]
for (const [n, s] of CASES) console.log(`${n.padEnd(36)} ${verdict(s)}`)
