/**
 * Why does probe-overrides-carriers BLOCK B read 0.0%?
 * Dump the actual node types under `R6Class(..., public = list(...))`.
 */
import * as fs from "node:fs"
import * as path from "node:path"

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(fs.readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-r.wasm"))))

const f = "/home/ishaq2321/bb_tests/repositories/R6/tests/testthat/test-portable-inheritance.R"
const text = fs.readFileSync(f, "utf8")
const tree = parser.parse(text)

function unquote(s: string): string {
  const t = s.trim()
  if (t.startsWith("`") && t.endsWith("`")) return t.slice(1, -1)
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1)
  return t
}

let printed = 0
const visit = (n: any, depth: number): void => {
  if (n.type === "call") {
    const f2 = n.childForFieldName?.("function")
    const callee = f2 ? String(f2.text) : ""
    if (callee === "R6Class") {
      const args = n.childForFieldName?.("arguments")
      console.log("=== R6Class call at line", n.startPosition.row + 1, "arguments node type:", args?.type)
      if (args) {
        for (let i = 0; i < args.childCount; i++) {
          const a = args.child(i)
          const named = a.isNamed
          if (!named) { console.log(`   [${i}] (anon) ${a.type}  ${JSON.stringify(String(a.text).slice(0, 60))}`); continue }
          const nm = a.childForFieldName?.("name")
          console.log(`   [${i}] named type=${a.type} fieldName=${nm ? unquote(String(nm.text)) : "(none)"} valueType=${a.childForFieldName?.("value")?.type ?? "(none)"}  head=${JSON.stringify(String(a.text).slice(0, 70))}`)
        }
      }
      printed++
      if (printed >= 2) return
    }
  }
  if (printed >= 2) return
  for (let i = 0; i < n.childCount; i++) visit(n.child(i), depth + 1)
}
visit(tree.rootNode, 0)

// Now: what does the probe's own argsOf + assignmentKeys see?
console.log("\n=== probe helpers on the FIRST R6Class call ===")
function calleeOf(n: any): string { const f2 = n.childForFieldName?.("function"); return f2 ? String(f2.text) : "" }
function argsOf(n: any): Array<[string, any]> {
  const out: Array<[string, any]> = []
  const args = n.childForFieldName?.("arguments")
  if (!args) return out
  for (let i = 0; i < args.namedChildCount; i++) {
    const a = args.namedChild(i)
    if (!a || a.type !== "argument") { console.log("   argsOf: SKIPPED named child type =", a?.type); continue }
    const nm = a.childForFieldName?.("name")
    if (!nm) { console.log("   argsOf: argument with NO name field, text =", JSON.stringify(String(a.text).slice(0,60))); continue }
    out.push([unquote(String(nm.text)), a.childForFieldName?.("value")])
  }
  return out
}
function assignmentKeys(valueNode: any): string[] {
  const out: string[] = []
  const v = (n: any): void => {
    if (n.type === "argument") { const nm = n.childForFieldName?.("name"); if (nm) { out.push(unquote(String(nm.text))); return } }
    if (n.type === "binary_operator" && String(n.childForFieldName?.("operator")?.text) === "=") {
      const lhs = n.childForFieldName?.("lhs"); if (lhs) { out.push(unquote(String(lhs.text))); return }
    }
    for (let i = 0; i < n.childCount; i++) v(n.child(i))
  }
  v(valueNode)
  return out
}
let done = false
const v2 = (n: any): void => {
  if (done) return
  if (n.type === "call" && calleeOf(n) === "R6Class") {
    for (const [an, av] of argsOf(n)) {
      console.log(`  arg "${an}" valueType=${av?.type} keys=${JSON.stringify(av ? assignmentKeys(av) : [])}`)
    }
    done = true
    return
  }
  for (let i = 0; i < n.childCount; i++) v2(n.child(i))
}
v2(tree.rootNode)