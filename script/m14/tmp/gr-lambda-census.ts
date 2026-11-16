// Is the `lambda_expression` node reachable in REAL groovy code, or only in the
// arrow form no Groovy version produces? M14.0.F6 reported it uncovered, and the
// fixture that answers it must say what the analyzer does with the node — so the
// first question is which roles the node actually plays in the pinned corpora.
// Prints occurrence count, parent types, and a sample of file:line sites.
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

const CORPUS = "<corpus-root>/bb_tests/repositories"
const REPOS = ["grails-core", "geb"]
const EXTS = [".groovy", ".gradle"]

const parser = await ASTEngine.getParser("groovy" as any)
let files = 0
let withNode = 0
let occurrences = 0
const parents = new Map<string, number>()
const samples: string[] = []

for (const repo of REPOS) {
  const root = path.join(CORPUS, repo)
  const stack = [root]
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
  for (const f of found) {
    files++
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    const root2 = parser.parse(content).rootNode
    const stack2: any[] = [root2]
    let hit = 0
    while (stack2.length) {
      const n = stack2.pop()!
      if (n.type === "lambda_expression") {
        hit++
        occurrences++
        const pt = n.parent?.type ?? "(root)"
        parents.set(pt, (parents.get(pt) ?? 0) + 1)
        if (samples.length < 8) samples.push(`${path.relative(root, f)}:${n.startPosition.row + 1} parent=${pt} :: ${n.text.split("\n")[0].slice(0, 90)}`)
      }
      for (let i = 0; i < n.namedChildCount; i++) stack2.push(n.namedChild(i))
    }
    if (hit > 0) withNode++
  }
}
console.log(`files=${files}  filesWithLambdaExpression=${withNode}  occurrences=${occurrences}`)
console.log(`parent types: ${[...parents.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`)
for (const s of samples) console.log(`  ${s}`)
process.exit(0)
