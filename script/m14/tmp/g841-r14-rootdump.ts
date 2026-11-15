// Round 14, step 2c: why do 5+ files produce a WHOLE-FILE root ERROR starting at
// the `/*` license header? Dump the root children of each to see how far the
// parse got and what the error spans.
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = "/home/ishaq2321/bb_tests/repositories/grails-core"
const FILES = [
  "build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/CompilePlugin.groovy",
  "build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/GrailsJacocoPlugin.groovy",
  "build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/GroovydocEnhancerPlugin.groovy",
  "build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/PublishPlugin.groovy",
  "build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/TestTaskShardingPlugin.groovy",
]

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

for (const f of FILES) {
  const src = readFileSync(path.join(CORPUS, f), "utf8")
  const t = parser.parse(src)
  const lines = src.split("\n")
  console.log(`\n===== ${f.split("/").pop()} (errNodes=${t.rootNode.children.filter((c: any) => c.type === "ERROR").length}) =====`)
  for (const c of t.rootNode.children) {
    const txt = (c.text ?? "").split("\n")
    const head = (txt[0] ?? "").slice(0, 80)
    const tail = txt.length > 1 ? ` … ${txt[txt.length - 1].slice(0, 60)}` : ""
    console.log(`  ${c.type}  L${c.startPosition.row + 1}-${c.endPosition.row + 1}  ${head}${tail}`)
  }
  // last non-empty line of file for comparison
  const lastLine = lines.map((l, i) => [l, i] as [string, number]).filter(([l]) => l.trim()).pop()
  if (lastLine) console.log(`  (file's last non-empty line: L${lastLine[1] + 1}: ${lastLine[0].trim().slice(0, 80)})`)
}
