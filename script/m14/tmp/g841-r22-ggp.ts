// #841 round 22: GrailsGradlePlugin divergence — where do methods vanish?
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })

const SRC = fs.readFileSync("/home/ishaq2321/bb_tests/repositories/grails-core/grails-gradle/plugins/src/main/groovy/org/grails/gradle/plugin/core/GrailsGradlePlugin.groovy", "utf8")

for (const W of ["/tmp/x22-base.wasm", process.argv[2] ?? "/tmp/x22j.wasm"]) {
  const lang = await L.load(fs.readFileSync(W))
  const parser = new P(); parser.setLanguage(lang)
  const root = parser.parse(SRC).rootNode
  // collect: errors, method_declaration lines, closure spans > 30 lines
  const errs: string[] = []
  const methods: number[] = []
  const bigClosures: string[] = []
  const walk = (n: any): void => {
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) errs.push(`${n.type}[${n.startPosition.row + 1}:${n.startPosition.column}] len=${n.endIndex - n.startIndex} ${JSON.stringify(n.text.slice(0, 40))}`)
    if (n.type === "method_declaration" || n.type === "function_definition") {
      const id = n.childForFieldName?.("name")
      methods.push(id ? id.startPosition.row + 1 : n.startPosition.row + 1)
    }
    if (n.type === "closure" && (n.endPosition.row - n.startPosition.row) > 25) bigClosures.push(`closure@${n.startPosition.row + 1}..${n.endPosition.row + 1}`)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
  console.log(`\n===== ${W}`)
  console.log(`methods: ${methods.length}  errors: ${errs.length}`)
  console.log("method lines:", methods.slice(0, 30).join(","))
  console.log("errors:", errs.slice(0, 5).join(" | ") || "none")
  console.log("big closures:", bigClosures.slice(0, 8).join(", ") || "none")
}
