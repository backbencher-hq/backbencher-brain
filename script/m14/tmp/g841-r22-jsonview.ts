// #841 round 22: DefaultGrailsJsonViewHelper region 420-440 at both builds
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const SRC = fs.readFileSync("/home/ishaq2321/bb_tests/repositories/grails-core/grails-views-gson/src/main/groovy/grails/plugin/json/view/api/internal/DefaultGrailsJsonViewHelper.groovy", "utf8")
const lines = SRC.split("\n")
console.log("SOURCE 424-438:")
for (let i = 424; i <= 438; i++) console.log(`${i + 1} | ${lines[i]}`)
for (const W of ["/tmp/x22-base.wasm", process.argv[2] ?? "/tmp/x22j.wasm"]) {
  const lang = await L.load(fs.readFileSync(W))
  const parser = new P(); parser.setLanguage(lang)
  const root = parser.parse(SRC).rootNode
  // summarize errors overlapping lines 420-445
  const lo = (() => { let i = 0; for (const l of lines.slice(0, 419)) i += l.length + 1; return i })()
  const hi = (() => { let i = 0; for (const l of lines.slice(0, 446)) i += l.length + 1; return i })()
  const inRegion: string[] = []
  let calls = 0, juxts = 0, typedClosures = 0
  const walk = (n: any): void => {
    if (n.endIndex > lo && n.startIndex < hi) {
      if (n.type === "ERROR" || n.isMissing) inRegion.push(`${n.type}[${n.startPosition.row + 1}] len=${n.endIndex - n.startIndex}`)
      if (n.type === "method_invocation") calls++
      if (n.type === "juxt_function_call") juxts++
      if (n.type === "closure") {
        // typed? first named child before '->'
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && c.type === "->") { typedClosures++; break }
          if (c && (c.type === "identifier" || c.type === "type_identifier" || c.type === "generic_type")) continue
          if (c && c.type === "{") continue
          break
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
  console.log(`\n===== ${W}`)
  console.log(`region nodes: ERROR/MISSING=${inRegion.length ? inRegion.slice(0, 4).join(", ") : "none"}; method_invocation=${calls} juxt=${juxts} closures-with-arrow=${typedClosures}`)
}
