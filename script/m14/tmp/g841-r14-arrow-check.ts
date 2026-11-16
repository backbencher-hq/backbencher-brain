// #841 round 14: is the `->` token present after the misparse juxt? If yes, the
// guard has a sound structural discriminator (a real juxt call has no arrow).
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS = "<corpus-root>/bb_tests/repositories"

const CASES: Array<{ f: string; line: number; kind: string }> = [
  // closure-first
  { f: "grails-core/build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/CompilePlugin.groovy", line: 75, kind: "closure-first" },
  { f: "grails-core/grails-async/rxjava2/src/main/groovy/org/grails/async/factory/rxjava2/RxPromiseFactory.groovy", line: 83, kind: "closure-first" },
  // lambda-sibling
  { f: "grails-core/grails-core/src/test/groovy/grails/plugins/GrailsPluginSorterSpec.groovy", line: 139, kind: "lambda-sibling" },
  // other (ERROR parent)
  { f: "grails-core/build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/GrailsJacocoPlugin.groovy", line: 63, kind: "other-ERROR" },
  { f: "grails-core/grails-gradle/plugins/src/main/groovy/org/grails/gradle/plugin/commands/GrailsCliArtifactGradlePlugin.groovy", line: 137, kind: "other-block" },
]

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

for (const c of CASES) {
  const src = readFileSync(path.join(CORPUS, c.f), "utf8")
  const tree = parser.parse(src)
  const found: any[] = []
  const walk = (node: any) => {
    if (node.type === "juxt_function_call") {
      const line = node.startPosition.row + 1
      if (Math.abs(line - c.line) <= 0 && node.childForFieldName("name")) found.push(node)
    }
    for (let i = 0; i < node.namedChildCount; i++) { const ch = node.namedChild(i); if (ch) walk(ch) }
  }
  walk(tree.rootNode)
  console.log(`\n== ${c.kind}  ${c.f.split("/").pop()}:${c.line}`)
  console.log(`   src: ${(src.split("\n")[c.line - 1] ?? "").trim().slice(0, 100)}`)
  for (const node of found) {
    const parent = node.parent
    console.log(`   parent=${parent?.type}  juxt span L${node.startPosition.row + 1}-${node.endPosition.row + 1} cols ${node.startPosition.column}-${node.endPosition.column}`)
    // all children of the parent in order, with named/anonymous flags
    const kids: string[] = []
    for (let i = 0; i < parent.childCount; i++) {
      const ch = parent.child(i)
      if (!ch) continue
      const mark = ch.id === node.id ? "*" : ch.isNamed ? "n" : "a"
      kids.push(`${mark}:${ch.type}[${ch.startPosition.column}-${ch.endPosition.column}]`)
    }
    console.log(`   parent children: ${kids.join(" ")}`)
    // siblings after the juxt
    console.log(`   juxt nextSibling=${node.nextSibling?.type}  nextNamed=${node.nextNamedSibling?.type}`)
  }
  if (found.length === 0) console.log("   (no juxt at that line)")
}
