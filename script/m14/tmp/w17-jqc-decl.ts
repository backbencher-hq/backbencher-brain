// W17: is ITER_FINISHED in the ORACLE's declaredNames? Direct experiment on
// the shape: `enum { ITER_FINISHED = -2 };` sits inside a top-level ERROR
// span in jv.c. Extract the oracle pre-pass logic minimally: check
// isDeclaringIdentifier(enumerator child) AND isSuppressedErrorDecl.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const SRC = fs.readFileSync("/home/ishaq2321/bb_tests/repositories/jq/src/jv.c", "utf8")
const DECL_PARENT_TYPES = new Set([
  "declaration", "parameter_declaration", "field_declaration", "init_declarator",
  "function_declarator", "pointer_declarator", "array_declarator", "type_definition",
  "enumerator", "preproc_def", "preproc_function_def",
])
async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(SRC).rootNode
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.text === "ITER_FINISHED" && n.parent?.type === "enumerator") {
      // oracle rules:
      const isDecl = DECL_PARENT_TYPES.has(n.parent.type)
      // ERROR ancestor?
      let cur: any = n; let innermost: any = null
      while (cur) { if (cur.type === "ERROR") innermost = cur; cur = cur.parent }
      console.log("isDeclaringIdentifier:", isDecl)
      console.log("inside ERROR span:", !!innermost, innermost ? `L${SRC.slice(0, innermost.startIndex).split("\n").length}` : "")
      // isMacroName? isFunctionLocal? isBareFdGlueName?
      let inFn = false; cur = n
      while (cur) { if (cur.type === "function_definition") { inFn = true; break } cur = cur.parent }
      console.log("function-local:", inFn)
      break
    }
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
}
main().catch(e => { console.error(e); process.exit(1) })
