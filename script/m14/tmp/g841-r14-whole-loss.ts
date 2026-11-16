// Round 14, step 2d: extraction-level loss on whole-file-ERROR files.
// The parser recovers into sibling-level shapes, but the analyzer's scope stack
// may never push class/method contexts from these malformed trees. Measure:
//   symbols, contains-edges, calls/uses, and whether the class/method names appear.
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CORPUS = "/home/ishaq256/bb_tests/repositories/grails-core".replace("/ishaq256/", "/ishaq2321/")

const FILES = [
  "build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/CompilePlugin.groovy",
  "build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/GrailsJacocoPlugin.groovy",
  "build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/GroovydocEnhancerPlugin.groovy",
  "build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/PublishPlugin.groovy",
  "build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/TestTaskShardingPlugin.groovy",
]

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { RealGroovyAnalyzer } = await import(path.join(ROOT, "src/ast/real-groovy-analyzer.ts"))
const parser = await ASTEngine.getParser("groovy" as any)

for (const f of FILES) {
  const src = readFileSync(path.join(CORPUS, f), "utf8")
  const t = parser.parse(src)
  const a = new RealGroovyAnalyzer()
  const res = await (a as any).analyze(t.rootNode, src, f)
  const syms = res.symbols ?? []
  const rels = res.relationships ?? []
  const classes = syms.filter((s: any) => s.kind === "class")
  const methods = syms.filter((s: any) => s.kind === "method")
  const contains = rels.filter((r: any) => r.type === ASTEngine.RelationshipType.Contains)
  const calls = rels.filter((r: any) => r.type === ASTEngine.RelationshipType.Calls)
  const uses = rels.filter((r: any) => r.type === ASTEngine.RelationshipType.Uses)
  console.log(`${f.split("/").pop().padEnd(34)} sym=${String(syms.length).padStart(3)} class=${classes.length} method=${String(methods.length).padStart(2)} contains=${String(contains.length).padStart(3)} calls=${String(calls.length).padStart(3)} uses=${String(uses.length).padStart(3)}`)
  if (classes.length) console.log(`   classes: ${classes.map((s: any) => s.name).join(", ")}`)
  if (methods.length) console.log(`   methods: ${methods.slice(0, 6).map((s: any) => s.name).join(", ")}${methods.length > 6 ? " …" : ""}`)
}
