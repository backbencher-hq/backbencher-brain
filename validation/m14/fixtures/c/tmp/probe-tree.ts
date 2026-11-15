import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../../../src/ast/engine"

const p = "validation/m14/fixtures/c/instantiates-allocator-register-989.c"
const content = readFileSync(p, "utf8")
const res = await (ASTEngine as any).parseTree(p, content)
const root = res.tree.rootNode
function text(n: any): string {
  try { return String(n.text ?? "").replace(/\s+/g, " ").slice(0, 70) } catch { return "?" }
}
function walk(n: any, d = 0): void {
  if (!n) return
  if (n.type === "call_expression" || n.type === "sizeof_expression" || n.type === "function_definition") {
    console.log(" ".repeat(d) + n.type + " :: " + text(n))
    if (n.type === "call_expression") {
      const args = n.childForFieldName("arguments")
      console.log(" ".repeat(d + 1) + "args=" + (args ? args.type : "null") + " named=" + (args ? args.namedChildCount : 0))
      if (args) for (let i = 0; i < args.namedChildCount; i++) {
        const a = args.namedChild(i)
        console.log(" ".repeat(d + 2) + "arg[" + i + "] " + (a ? a.type : "null") + " :: " + text(a))
        if (a && a.type === "sizeof_expression") {
          const c = a.namedChild(0)
          console.log(" ".repeat(d + 3) + "sizeof child " + (c ? c.type : "null") + " :: " + text(c))
          if (c && c.type === "type_descriptor") {
            const t = c.childForFieldName("type")
            console.log(" ".repeat(d + 4) + "descriptor type " + (t ? t.type : "null") + " :: " + text(t))
          }
        }
      }
    }
  }
  for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), d + 1)
}
walk(root)
