// #841 r24: analyzer-level extraction for the five row-1 whole-program-ERROR files
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const FILES = [
  "grails-data-mongodb/core/src/test/groovy/org/apache/grails/data/mongo/core/GrailsDataMongoTckManager.groovy",
  "grails-datastore-core/src/main/groovy/org/grails/datastore/mapping/config/ConfigurationBuilder.groovy",
  "grails-spring-security/plugin/src/main/groovy/grails/plugin/springsecurity/SpringSecurityCoreGrailsPlugin.groovy",
  "grails-spring-security/plugin/src/main/groovy/grails/plugin/springsecurity/web/filter/DebugFilter.groovy",
  "grails-spring-security/rest/core/grails-app/services/grails/plugin/springsecurity/rest/RestOauthService.groovy",
]
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const fs = await import("node:fs")
for (const f of FILES) {
  const p = `/home/ishaq2321/bb_tests/repositories/grails-core/${f}`
  const text = fs.readFileSync(p, "utf8")
  const res = await (ASTEngine as any).parseFile(p, text)
  const syms = res.symbols ?? []
  const rels = res.relationships ?? []
  const kinds: Record<string, number> = {}
  for (const s of syms) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1
  const relKinds: Record<string, number> = {}
  for (const r of rels) relKinds[r.type] = (relKinds[r.type] ?? 0) + 1
  console.log(`${f.split("/").pop().padEnd(40)} syms=${String(syms.length).padStart(3)} rels=${String(rels.length).padStart(3)}  kinds=${JSON.stringify(kinds)} relKinds=${JSON.stringify(relKinds)}`)
}
