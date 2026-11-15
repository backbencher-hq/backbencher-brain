// CS-DEEP-29 — why does the bare-uses truth MISS 17 real reads?
//
// The reconciler narrowed to 17 TRUTH-only / 19 ANALYZER-only, and one family explains most of
// both directions:
//
//   truth MISSES   `TryAnalyzeStatementForCollectionExpression -> SemanticModel`
//   analyzer HAS   the same row
//   and the same file has the mirror shape: `UpdateExpressionState -> SemanticModel`
//
// and the source says why. UpdateExpressionState.cs declares
//
//     public readonly SemanticModel SemanticModel = semanticModel;
//
// so every `SemanticModel.GetSymbolInfo(...)` in the file is a REAL read of a member, and the
// analyzer emits them. The truth emits none. So the truth is SHADOWING the name, and the only
// thing in that file that could shadow it is the class's own primary constructor:
//
//     internal sealed class X(SemanticModel semanticModel, ...)
//
// If `paramName()` falls back to "first named identifier child" when the `name` FIELD is absent,
// it returns the TYPE `SemanticModel` instead of the variable `semanticModel` -- and every read
// of the member then looks shadowed. That is a type being bound as a value, the exact defect
// class this lane calls D7, reproduced in the instrument that was written to detect it.
//
// This probe prints the grammar's actual field names for `parameter`, so the question is answered
// by the tree rather than by my recollection of the grammar.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new P()
  parser.setLanguage(grammar)

  const file = "/home/sano/ishaq/bb_tests/repositories/roslyn/src/Analyzers/Core/Analyzers/UseCollectionInitializer/UpdateExpressionState.cs"
  const src = fs.readFileSync(file, "utf8")
  const root = parser.parse(src).rootNode

  const stack: any[] = [root]
  let shown = 0
  while (stack.length > 0 && shown < 3) {
    const n = stack.pop()!
    if (n.type === "parameter_list" && n.parent?.type !== "method_declaration") {
      console.log(`parameter_list (of ${n.parent?.type}) at line ${n.startPosition.row + 1}:`)
      for (let i = 0; i < n.namedChildCount; i++) {
        const p = n.namedChild(i)
        if (!p || p.type !== "parameter") continue
        const nf = p.childForFieldName("name")
        const tf = p.childForFieldName("type")
        const firstNamed = p.namedChildCount > 0 ? p.namedChild(0) : null
        console.log(`   parameter  \`${p.text.replace(/\s+/g, " ").slice(0, 44)}\``)
        console.log(`      field "name": ${nf ? `"${nf.text}" (${nf.type})` : "ABSENT"}`)
        console.log(`      field "type": ${tf ? `"${tf.text}" (${tf.type})` : "ABSENT"}`)
        console.log(`      first named child: ${firstNamed ? `"${firstNamed.text}" (${firstNamed.type})` : "none"}`)
        console.log(`      => paramName() would return: "${nf?.text ?? firstNamed?.text ?? "(none)"}"`)
        shown++
      }
      console.log("")
      if (shown >= 3) break
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  if (shown === 0) console.log("no primary-constructor parameter_list found; probe the method form instead")
}

if (import.meta.main) await main()
