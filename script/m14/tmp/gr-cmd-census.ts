// The command-expression ambiguity, measured. The pinned groovy grammar reads a
// command expression whose argument is a BARE NAME — `println filtered`, the
// most common statement in Groovy scripts and specs — as a Java-style
// declaration `println filtered;` (type_identifier + variable_declarator), so the
// analyzer publishes a fabricated `references -> println` declared_type edge and
// loses the call AND the read of the argument. Minimal reproducer:
// script/m14/tmp/gr-cmd-probe2.ts.
//
// How much of the corpus carries it? A `local_variable_declaration` whose type
// text is ALSO a callee name somewhere in the same file is a declaration the
// language never had — the type is a call. Structural test, no regex over text:
// callee names come from juxt_function_call / method_invocation nodes, the
// candidate types from local_variable_declaration type nodes.
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

const CORPUS = "<corpus-root>/bb_tests/repositories"
const REPOS = ["grails-core", "geb"]
const EXTS = [".groovy", ".gradle"]

const parser = await ASTEngine.getParser("groovy" as any)
let files = 0
let filesHit = 0
let sites = 0
let analyzerDeclaredTypeOnLocal = 0
const samples: string[] = []
const byName = new Map<string, number>()

for (const repo of REPOS) {
  const rootDir = path.join(CORPUS, repo)
  const stack = [rootDir]
  const found: string[] = []
  while (stack.length) {
    const d = stack.pop()!
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) stack.push(p) }
      else if (EXTS.some((x) => e.name.endsWith(x))) found.push(p)
    }
  }
  found.sort()
  for (const rel of found) {
    files++
    let content: string
    try { content = fs.readFileSync(rel, "utf8") } catch { continue }
    const tree = parser.parse(content)
    const root = tree.rootNode
    const callees = new Set<string>()
    const decls: Array<{ typeName: string; line: number }> = []
    const walk = (n: any): void => {
      if (n.type === "juxt_function_call" || n.type === "method_invocation") {
        const first = n.namedChild(0)
        if (first && (first.type === "identifier" || first.type === "field_access")) {
          const leaf = first.type === "identifier" ? first.text : String(first.text).split(".").pop()
          if (leaf) callees.add(leaf)
        }
      }
      if (n.type === "local_variable_declaration") {
        const t = n.namedChild(0)
        const d = n.namedChild(1)
        // a declaration with a BARE type and a declarator with no initialiser is
        // the ambiguous shape; `Foo x = y` (initialiser) is a real declaration.
        const declarator = d && d.type === "variable_declarator" ? d : null
        const hasInit = declarator ? declarator.namedChildCount > 1 : true
        if (t && t.type === "type_identifier" && declarator && !hasInit && /^[a-z_][A-Za-z0-9_]*$/.test(t.text)) {
          decls.push({ typeName: t.text, line: n.startPosition.row + 1 })
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(root)
    const hit = decls.filter((d) => callees.has(d.typeName))
    if (hit.length > 0) {
      filesHit++
      sites += hit.length
      for (const h of hit) {
        byName.set(h.typeName, (byName.get(h.typeName) ?? 0) + 1)
        if (samples.length < 10) samples.push(`${path.relative(rootDir, rel)}:${h.line} :: <${h.typeName}> ${h.typeName} <name>`)
      }
    }
  }
}
console.log(`files=${files}  filesWithAmbiguousDeclaration=${filesHit}  sites=${sites}`)
console.log(`top names: ${[...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k}=${v}`).join(" ")}`)
for (const s of samples) console.log(`  ${s}`)
process.exit(0)
