// rust #798 — what the where-clause arm emits NOW vs what it emitted BEFORE the
// R16 fix, on the same tree. The pre-fix rule is applied verbatim from
// `git show HEAD:src/ast/real-rust-analyzer.ts` (target = the predicate's FIRST
// named child's raw text, excluded only by the FIRST enclosing item's params),
// so a fixture forbid written from this output provably FAILS on revert.
//
// Run: bun script/m14/tmp/rust-798-wherebounds.ts <file.rs>
import * as fs from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RealRustAnalyzer } from "../../../src/ast/real-rust-analyzer"

const file = process.argv[2]
const content = fs.readFileSync(file, "utf8")
const parser = await ASTEngine.getParser("rust" as any)
const root: any = parser.parse(content).rootNode

const analyzer = new RealRustAnalyzer()
const res: any = await analyzer.analyze(root, content, file)
console.log("=== CURRENT analyzer, whereBound rows ===")
for (const r of res.relationships ?? []) {
  if ((r.metadata ?? {}).whereBound) console.log(`  ${r.source} -> references -> ${JSON.stringify(r.target)}  line=${r.line_number}`)
}

// ---- pre-fix rule, verbatim ----
const PRE: Array<{ src: string; target: string }> = []
const walk = (node: any, parent: any) => {
  if (node.type === "where_clause") {
    const genericParams = new Set<string>()
    let gcur: any = node.parent
    while (gcur) {
      if (
        gcur.type === "function_item" || gcur.type === "trait_item" ||
        gcur.type === "struct_item" || gcur.type === "enum_item" ||
        gcur.type === "type_item" || gcur.type === "impl_item"
      ) {
        const tp = gcur.childForFieldName("type_parameters")
        if (tp) {
          const pw: any[] = [tp]
          while (pw.length > 0) {
            const m = pw.pop()!
            if (m.type === "type_identifier" || m.type === "identifier") genericParams.add(m.text)
            for (let k = 0; k < m.namedChildCount; k++) pw.push(m.namedChild(k))
          }
        }
        break
      }
      gcur = gcur.parent
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "where_predicate") {
        const left = c.namedChild(0)
        if (left && !genericParams.has(left.text)) {
          PRE.push({ src: parent?.name || "global", target: left.text })
        }
      }
    }
  }
  for (let i = 0; i < node.namedChildCount; i++) walk(node.namedChild(i), node.type === "function_item" || node.type === "function_signature_item" || node.type === "impl_item" ? node : parent)
}
walk(root, null)
console.log("=== PRE-FIX rule, whereBound rows ===")
for (const p of PRE) console.log(`  ${p.src} -> references -> ${JSON.stringify(p.target)}`)
