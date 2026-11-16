// #841 round 14: verify the recovered class names and implements-gain lines
// against the source text. Nothing here trusts the analyzer.
import { readFileSync } from "node:fs"
import path from "node:path"

const CORPUS = "<corpus-root>/bb_tests/repositories"
const after: Record<string, { symbols: string[]; rels: string[] }> = JSON.parse(readFileSync("/tmp/g841-r14-after.json", "utf8"))
const base: Record<string, { symbols: string[]; rels: string[] }> = JSON.parse(readFileSync("/tmp/g841-r14-base.json", "utf8"))

const IMPL_LINES: Array<{ file: string; line: number }> = [
  { file: "grails-core/build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/CompilePlugin.groovy", line: 41 },
  { file: "grails-core/build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/GrailsJacocoPlugin.groovy", line: 44 },
  { file: "grails-core/build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/GroovydocEnhancerPlugin.groovy", line: 34 },
  { file: "grails-core/build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/PublishPlugin.groovy", line: 53 },
  { file: "grails-core/build-logic/plugins/src/main/groovy/org/apache/grails/buildsrc/TestTaskShardingPlugin.groovy", line: 38 },
  { file: "grails-core/grails-gradle/plugins/src/main/groovy/org/grails/gradle/plugin/commands/GrailsCliArtifactGradlePlugin.groovy", line: 76 },
  { file: "grails-core/grails-gradle/plugins/src/main/groovy/org/grails/gradle/plugin/core/GrailsGradlePlugin.groovy", line: 84 },
  { file: "grails-core/grails-gradle/plugins/src/main/groovy/org/grails/gradle/plugin/exploded/GrailsExplodedPlugin.groovy", line: 44 },
  { file: "grails-core/grails-gradle/plugins/src/main/groovy/org/grails/gradle/plugin/profiles/GrailsProfileGradlePlugin.groovy", line: 52 },
  { file: "grails-core/grails-spring-security/ui/plugin/grails-app/services/grails/plugin/springsecurity/ui/SpringSecurityUiService.groovy", line: 52 },
  { file: "grails-core/grails-spring-security/ui/plugin/grails-app/services/grails/plugin/springsecurity/ui/SpringSecurityUiService.groovy", line: 53 },
]

console.log("=== implements-gain lines ===")
for (const c of IMPL_LINES) {
  const src = readFileSync(path.join(CORPUS, c.file), "utf8").split("\n")
  const text = (src[c.line - 1] ?? "").trim()
  const ok = /\bimplements\b/.test(text)
  console.log(`${ok ? "OK " : "BAD"}  L${c.line}  ${text.slice(0, 100)}`)
}

console.log("\n=== recovered class symbols (in after, absent in base) ===")
for (const k of Object.keys(after).sort()) {
  const b = base[k]
  if (!b) continue
  const bS = new Set(b.symbols)
  for (const s of after[k].symbols) {
    if (bS.has(s)) continue
    const p = s.split("|")
    if (p[2] !== "class") continue
    const rel = k.split("|").slice(1).join("|")
    const src = readFileSync(path.join(CORPUS, rel), "utf8").split("\n")
    const at = (src[Number(p[4]) - 1] ?? "").trim().slice(0, 90)
    // confirm the class name appears on that line
    const ok = at.includes(p[1])
    console.log(`${ok ? "OK " : "BAD"}  ${rel.split("/").pop()}  class=${p[1]} L${p[4]}  ${at}`)
  }
}
