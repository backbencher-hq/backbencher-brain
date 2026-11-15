// #841 r24: bisect the whole-program-ERROR file by line prefixes
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
const parser = new P(); parser.setLanguage(lang)
const FILE = "/home/ishaq2321/bb_tests/repositories/grails-core/grails-spring-security/rest/core/grails-app/services/grails/plugin/springsecurity/rest/RestOauthService.groovy"
const lines = fs.readFileSync(FILE, "utf8").split("\n")

function hasError(src: string): boolean {
  const t = parser.parse(src).rootNode
  let bad = false
  const walk = (n: any): void => {
    if (n.type === "ERROR" || n.isMissing) bad = true
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(t)
  return bad
}

// binary search the smallest prefix (in lines) that errors — but a prefix cuts
// mid-construct; instead find the FIRST line k such that lines[k..k+40] parsed
// in isolation errors AND prefix[0..k-1] is clean. Sliding window over the file.
let firstKill = -1
for (let k = 0; k < lines.length - 5; k++) {
  const chunk = lines.slice(k, k + 6).join("\n")
  if (chunk.trim().length < 10) continue
  if (hasError(chunk)) {
    firstKill = k
    break
  }
}
console.log("first 6-line window that errors:", firstKill + 1)
for (let i = Math.max(0, firstKill - 4); i < Math.min(lines.length, firstKill + 10); i++) {
  console.log(`  ${i + 1}: ${lines[i]?.slice(0, 110)}`)
}
// shrink the window to the minimal erroring 1-liner
if (firstKill >= 0) {
  for (let w = 1; w <= 6; w++) {
    for (let s = Math.max(0, firstKill - w + 1); s <= firstKill; s++) {
      const chunk = lines.slice(s, s + w).join("\n")
      if (chunk.trim().length < 5) continue
      if (hasError(chunk)) {
        console.log(`\nminimal erroring window: lines ${s + 1}-${s + w}`)
        for (let i = s; i < s + w; i++) console.log(`  ${i + 1}: ${lines[i]}`)
        process.exit(0)
      }
    }
  }
}
