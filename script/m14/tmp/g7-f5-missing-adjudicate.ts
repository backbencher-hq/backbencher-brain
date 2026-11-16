// F5 reported grails-core:groovy missing=8, all `uses` on interpolation-shaped
// names. `truth` for groovy is the generic deriveTreeEdges walker PLUS
// deriveGroovyEdges, so before any of it can be blamed on the G7 mirror, this
// splits the two and compares each against the analyzer on the exact files the
// artifact names.
import { readFileSync } from "node:fs"
import path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"
import { deriveGroovyEdges, deriveTreeEdges } from "../differential"

const REPO = "<corpus-root>/bb_tests/repositories/grails-core"
const FILES = [
  "grails-gsp/plugin/src/test/groovy/org/grails/web/mapping/RootUrlMappingTests.groovy",
  "grails-data-hibernate5/core/src/test/groovy/grails/gorm/tests/AddToManagedEntitySpec.groovy",
  "grails-data-hibernate7/dbmigration/src/cli/groovy/org/apache/grails/data/hibernate7/dbmigration/cli/DatabaseMigrationCommand.groovy",
  "grails-events/core/src/main/groovy/org/grails/events/EventSubscriberTrigger.groovy",
]

const norm = (t: string): string => String(t ?? "").replace(/^(this\.|self\.)/, "").replace(/\s/g, "")

async function main(): Promise<void> {
  const parser = await ASTEngine.getParser("groovy" as any)
  const analyzer = new RealGroovyAnalyzer()
  for (const rel of FILES) {
    const f = path.join(REPO, rel)
    const content = readFileSync(f, "utf8")
    const root = parser.parse(content).rootNode!
    const res: any = await analyzer.analyze(root, content, rel)
    const rels = (res.relationships ?? []).map((r: any) => ({ label: String(r.type), target: String(r.target ?? "") }))
    const mirror = deriveGroovyEdges(root)
    const full = deriveTreeEdges(root, "groovy") as any[]
    const mirrorKeys = new Set(mirror.map((e: any) => `${e.label}|${norm(e.target)}`))
    const flags: string[] = []
    for (const te of full) {
      const hit = rels.some((r: any) => r.label === te.label && norm(r.target) === norm(te.target))
      if (hit) continue
      const fromMirror = mirrorKeys.has(`${te.label}|${norm(te.target)}`)
      flags.push(`    ${te.label}->${te.target}  source=${fromMirror ? "MY MIRROR (deriveGroovyEdges)" : "generic deriveTreeEdges walker"}`)
    }
    console.log(`\n=== ${rel}`)
    console.log(`  hasError=${root.hasError}  analyzerEdges=${rels.length}  mirrorEdges=${mirror.length}  fullTruth=${full.length}`)
    console.log(flags.length ? flags.join("\n") : "    (no oracle-only edges)")
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
