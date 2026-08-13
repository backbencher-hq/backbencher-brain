// Shared AST-driven regex scan core for M12.
// Parses each analyzer's own source with the project's tree-sitter TypeScript
// parser and walks the tree for regex literals and RegExp constructors.
// Used by both script/m12/regex-census.ts (generator) and
// script/m12/verify-regex-census.ts (regression gate) so the gate re-runs the
// exact same scan — never a duplicated approximation.
import { readFileSync, readdirSync } from "node:fs"
import { join, basename } from "node:path"

export interface RegexUsage {
  file: string
  line: number
  column: number
  source: string
  operation: "match" | "replace" | "test" | "split" | "search" | "exec" | "constructor" | "other"
  receiver: string
  receiverCategory: "raw_content" | "node_text" | "identifier" | "string_literal" | "literal" | "other"
  classification: "replaceable" | "unavoidable" | "normalization" | "needs_review"
  justification: string
}

export function analyzerFiles(dir = "src/ast"): string[] {
  return readdirSync(dir)
    .filter((f) => /^real-.+-analyzer\.ts$/.test(f))
    .sort()
}

function categoryOf(receiver: string): RegexUsage["receiverCategory"] {
  const r = receiver.trim()
  if (!r) return "other"
  // AST-derived text first — a receiver ending in .text is tree-sitter node
  // text regardless of what the base identifier is named.
  if (/\.text$/.test(r) || /\.text\./.test(r)) return "node_text"
  // Raw file/source content markers.
  if (r === "content" || r === "source" || r.includes("sourceText") || r.includes("fileContent") || r.endsWith("RawContent")) return "raw_content"
  if (/^["'`]/.test(r)) return "string_literal"
  if (/^(\/|\d+)/.test(r)) return "literal"
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(r)) return "identifier"
  return "other"
}

function classify(receiverCategory: RegexUsage["receiverCategory"]): RegexUsage["classification"] {
  switch (receiverCategory) {
    case "raw_content": return "replaceable"
    case "string_literal":
    case "literal": return "unavoidable"
    case "node_text": return "normalization"
    default: return "needs_review"
  }
}

export async function scanAnalyzers(dir = "src/ast"): Promise<RegexUsage[]> {
  const { getParser } = await import("../../src/ast/engine")
  const parser = await getParser("typescript")
  const out: RegexUsage[] = []

  for (const file of analyzerFiles(dir)) {
    const full = join(dir, file)
    const content = readFileSync(full, "utf8")
    const tree = parser.parse(content)

    const visit = (node: any, depth: number) => {
      if (depth > 60) return
      if (node.type === "regex") {
        const start = node.startPosition
        const src = content.slice(node.startIndex, node.endIndex)
        let cursor: any = node.parent
        let receiver = ""
        let operation: RegexUsage["operation"] = "other"
        while (cursor) {
          if (cursor.type === "call_expression") {
            const fnNode = cursor.childForFieldName?.("function")
            if (fnNode?.type === "member_expression") {
              const objNode = fnNode.childForFieldName?.("object")
              const propNode = fnNode.childForFieldName?.("property")
              if (objNode) {
                const objText = content.slice(objNode.startIndex, objNode.endIndex)
                if (objText.length < 120) receiver = objText
              }
              if (propNode) {
                const prop = content.slice(propNode.startIndex, propNode.endIndex)
                if (["match", "replace", "test", "split", "search", "exec"].includes(prop)) {
                  operation = prop as RegexUsage["operation"]
                }
              }
            }
            break
          }
          if (cursor.type === "new_expression") {
            operation = "constructor"
            break
          }
          cursor = cursor.parent
        }
        const category = categoryOf(receiver)
        out.push({
          file: basename(full),
          line: start.row + 1,
          column: start.column + 1,
          source: src.length > 200 ? src.slice(0, 200) + "…" : src,
          operation,
          receiver,
          receiverCategory: category,
          classification: classify(category),
          justification: "",
        })
        return
      }
      if (node.type === "call_expression" || node.type === "new_expression") {
        const fnNode = node.childForFieldName?.("function") ?? node.childForFieldName?.("constructor")
        if (fnNode) {
          const fnText = content.slice(fnNode.startIndex, fnNode.endIndex)
          if (fnText === "RegExp" || fnText.endsWith(".RegExp")) {
            const start = node.startPosition
            const src = content.slice(node.startIndex, node.endIndex)
            out.push({
              file: basename(full),
              line: start.row + 1,
              column: start.column + 1,
              source: src.length > 200 ? src.slice(0, 200) + "…" : src,
              operation: "constructor",
              receiver: "",
              receiverCategory: "other",
              classification: "needs_review",
              justification: "",
            })
            return
          }
        }
      }
      for (let i = 0; i < node.namedChildCount; i++) visit(node.namedChild(i), depth + 1)
    }
    visit(tree.rootNode, 0)
  }
  return out
}
