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
        // M49 closure-wave fix: the walk ascends from the regex LITERAL, so
        // the first call_expression it meets is `pattern.test(x)` — the
        // member_expression's OBJECT is the pattern, not the receiver. The
        // receiver is the call's ARGUMENT (or, for `x.match(/re/)` chains,
        // the object of the enclosing member call). Ascend past the pattern
        // call first; classify from what the regex actually runs against.
        // Old behavior mislabeled every `pattern.test(x)` as receiver = the
        // pattern itself ("literal" → unavoidable) — the scala analyzer's 5
        // node-type predicates carried the wrong label for waves.
        while (cursor) {
          if (cursor.type === "call_expression" && cursor.childForFieldName?.("function")?.type === "member_expression") {
            const fn = cursor.childForFieldName("function")
            const objNode = fn.childForFieldName?.("object")
            const objText = objNode ? content.slice(objNode.startIndex, objNode.endIndex) : ""
            if (objText === src || objText.endsWith("g") && objText.includes("/")) {
              // The object IS the regex literal (or a flag-suffixed form of
              // it): this is `pattern.test(x)` — descend the ARGUMENT side
              // instead by continuing upward from the call's arguments.
              const argsNode = cursor.childForFieldName?.("arguments")
              const arg0 = argsNode?.namedChild(0)
              if (arg0) {
                const argText = content.slice(arg0.startIndex, arg0.endIndex)
                receiver = argText.length < 120 ? argText : receiver
                if (arg0.type === "regex") {
                  // regex against regex — nothing to classify
                  receiver = "(regex)"
                } else {
                  // Walk the argument's own chain for a member call receiver.
                  let ac: any = arg0
                  while (ac) {
                    if (ac.type === "call_expression") {
                      const afn = ac.childForFieldName?.("function")
                      if (afn?.type === "member_expression") {
                        const aobj = afn.childForFieldName?.("object")
                        if (aobj) {
                          const at = content.slice(aobj.startIndex, aobj.endIndex)
                          if (at.length < 120) receiver = at
                        }
                        break
                      }
                    }
                    ac = ac.namedChild(0)
                    if (ac && ac.type !== "member_expression" && ac.type !== "call_expression" && ac.type !== "identifier" && ac.type !== "parenthesized_expression") break
                  }
                }
                operation = operation === "other" ? "test" : operation
                break
              }
            }
          }
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
