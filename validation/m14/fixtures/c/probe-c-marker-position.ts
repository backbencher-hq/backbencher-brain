/**
 * probe-c-marker-position — WHAT DOES THE GRAMMAR DO WITH A MARKER IN MARKER POSITION?
 *
 * Author: Muhammad Ishaq Khan. Probe, not production code. READ-ONLY.
 *
 * THE QUESTION. The c `exports` class rule (`isExportMarker`) accepts a marker whose own token
 * names a visibility boundary. Two shapes in the lane's own fixtures decide whether that rule can
 * be applied at all, and neither can be settled by reading the expectation file:
 *
 *   S1  `SELFREF_EXPORT SELFREF_EXPORT attr_selfref_decl(void);`
 *       — two markers in a row, and the fixture FORBIDS `exports` from `attr_selfref_decl`.
 *       What does the declarator chain actually reach: the real name, or a marker?
 *
 *   S2  `CMPP__EXPORT(void *, cmpp_mrealloc)(void * p, size_t n){ ... }`
 *       — the fixture forbids `exports` from `void`, and `exportedDeclarationName` is documented
 *       to refuse an ERROR node. Does it, on THIS shape?
 *
 * The probe prints the parse tree of each shape and what the analyzer's own
 * `exportedDeclarationName` / `macroPrefixName` would read from it — the analyzer's real methods,
 * called on the real tree, so the answer is the analyzer's answer and not a prediction.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../../../src/ast/engine"
import { RealCAnalyzer } from "../../../../src/ast/real-c-analyzer"

const HERE = path.resolve(import.meta.dirname ?? ".")

function tree(node: any, depth = 0, out: string[] = []): string[] {
  const label = node.type === "identifier" || node.type === "field_identifier" ? `${node.type}("${node.text}")` : node.type
  out.push(`${"  ".repeat(depth)}${label}${node.isNamed ? "" : " (anon)"}`)
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c) tree(c, depth + 1, out)
  }
  return out
}

async function main(): Promise<void> {
  const parser = await getParser("c" as any)
  const analyzer = new (RealCAnalyzer as any)()

  const SHAPES: Array<{ id: string; file: string; line: number }> = [
    { id: "S1 SELFREF_EXPORT x2", file: "exports-attribute-989.c", line: 101 },
    { id: "S2 CMPP__EXPORT (definition)", file: "export-marker-class-965.c", line: 105 },
    { id: "S3 E2 function-pointer", file: "export-marker-class-965.c", line: 122 },
    { id: "S4 E3 bare-marker declarator", file: "export-marker-class-965.c", line: 130 },
    { id: "S5 SQLITE_API empty marker", file: "export-marker-class-965.c", line: 39 },
    { id: "S6 HIDDEN_API negative attribute", file: "exports-attribute-989.c", line: 84 },
  ]

  for (const shape of SHAPES) {
    const full = path.join(HERE, shape.file)
    const raw = readFileSync(full, "utf8")
    const root = parser.parse(raw).rootNode
    console.log(`── ${shape.id}  (${shape.file}:${shape.line}) ──`)

    // find the deepest node starting on that line
    let found: any = null
    const walk = (n: any): void => {
      if (n.startPosition.row + 1 === shape.line && (n.type === "declaration" || n.type === "function_definition")) {
        if (!found) found = n
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(root)
    if (!found) {
      console.log("  (no declaration/definition node on that line)")
      console.log("")
      continue
    }
    console.log("  parse tree:")
    for (const l of tree(found)) console.log("  " + l)
    let prefix: string | null = null
    let exported: string | null = null
    try {
      prefix = analyzer.macroPrefixName(found)
      const idNode = analyzer.exportedDeclarationName(found)
      exported = idNode ? idNode.text.trim() : null
    } catch (e: any) {
      console.log(`  (helper threw: ${e?.message})`)
    }
    console.log(`  macroPrefixName        : ${prefix === null ? "null" : JSON.stringify(prefix)}`)
    console.log(`  exportedDeclarationName: ${exported === null ? "null" : JSON.stringify(exported)}`)
    console.log("")
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
