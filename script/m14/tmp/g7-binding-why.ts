// The analyzer emits nothing for `"/browse/town/$town"(...)` in
// RestfulResourceMappingSpec.groovy, but every reduced shape emits the read. So the
// silencer must be the local-binding gate. This replicates the analyzer's own
// boundNamesOf/locallyBoundNames for that exact node and prints the set, plus which
// scope contributed the name — so the cause is named rather than guessed.
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const F = "/home/ishaq2321/bb_tests/repositories/grails-core/grails-web-url-mappings/src/test/groovy/grails/web/mapping/RestfulResourceMappingSpec.groovy"
const SCOPES = new Set(["method_declaration", "constructor_declaration", "function_definition", "lambda_expression", "closure", "program"])
const BOUNDARIES = new Set(["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"])

async function main(): Promise<void> {
  const content = readFileSync(F, "utf8")
  const parser = await ASTEngine.getParser("groovy" as any)
  const root = parser.parse(content).rootNode!
  const boundNamesOf = (scope: any): Set<string> => {
    const out = new Set<string>()
    const work: any[] = []
    for (let i = 0; i < scope.namedChildCount; i++) { const c = scope.namedChild(i); if (c) work.push(c) }
    while (work.length > 0) {
      const n = work.pop()
      if (n.type === "formal_parameter" || n.type === "catch_formal_parameter") {
        const nm = n.childForFieldName?.("name"); if (nm && nm.type === "identifier") out.add(nm.text)
      } else if (n.type === "variable_declarator") {
        const nm = n.childForFieldName?.("name"); if (nm && nm.type === "identifier") out.add(nm.text)
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) work.push(c) }
    }
    if (scope.type === "closure") out.add("it")
    return out
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "interpolated_identifier" && n.text === "$town") {
      console.log(`node: ${n.text} at line ${n.startPosition.row + 1}`)
      let p: any = n.parent, guard = 0, hop = 0
      while (p && guard++ < 24) {
        hop++
        const contributing = SCOPES.has(p.type)
        const names = contributing ? boundNamesOf(p) : new Set<string>()
        console.log(`  hop ${String(hop).padStart(2)} ${p.type.padEnd(26)}${contributing ? ` SCOPE (${names.size} names)${names.has("town") ? "  <== CONTRIBUTES town" : ""}` : ""}`)
        if (names.has("town")) {
          // which declarator/parameter in that scope is named town?
          const work: any[] = []
          for (let i = 0; i < p.namedChildCount; i++) { const c = p.namedChild(i); if (c) work.push(c) }
          while (work.length > 0) {
            const m = work.pop()
            if ((m.type === "formal_parameter" || m.type === "catch_formal_parameter" || m.type === "variable_declarator")) {
              const nm = m.childForFieldName?.("name")
              if (nm && nm.text === "town") console.log(`      SOURCE: ${m.type} "${m.text.replace(/\s+/g, " ").slice(0, 90)}" at line ${m.startPosition.row + 1}`)
            }
            for (let i = 0; i < m.namedChildCount; i++) { const c = m.namedChild(i); if (c) work.push(c) }
          }
        }
        if (BOUNDARIES.has(p.type)) { console.log("  stop: type boundary"); break }
        p = p.parent
      }
      break
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
