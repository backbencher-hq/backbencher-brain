// W17: which occurrence admits each name into the oracle's declaredNames?
// Replicate the decl filter for every occurrence of the 4 names.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const JQ = "/home/ishaq2321/bb_tests/repositories/jq"
const NAMES = new Set(["ROUND_BIASED", "Sudden_Underflow", "NO_HEX_FP", "emin"])
const DECL_PARENTS = new Set(["declaration", "parameter_declaration", "field_declaration", "init_declarator", "function_declarator", "pointer_declarator", "array_declarator", "type_definition", "enumerator", "preproc_def", "preproc_function_def"])

const isDirectiveConditionText = (n: any): boolean => {
  const p0 = n.parent
  if (p0 && (p0.type === "preproc_def" || p0.type === "preproc_function_def")) return false
  let cur: any = n.parent
  while (cur) {
    const t: string = cur.type
    if (/statement|declaration|definition|declarator|specifier|enumerator|compound/.test(t)) return false
    if (t.startsWith("preproc_")) return true
    cur = cur.parent
  }
  return false
}
const isFunctionLocal = (n: any): boolean => {
  let cur: any = n
  while (cur) { if (cur.type === "compound_statement" || cur.type === "parameter_list") return true; cur = cur.parent }
  return false
}
// decl-side ERROR suppression is NOT replicated here (needs span memo) —
// report its inputs instead.
const errInfo = (n: any): string => {
  let cur: any = n
  let inner: any = null
  while (cur) { if (cur.type === "ERROR") inner = cur; cur = cur.parent }
  return inner ? "in ERROR " + inner.startIndex + ".." + inner.endIndex : "no ERROR"
}

async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = fs.readFileSync(path.join(JQ, "src/jv_dtoa.c"), "utf8")
  const root = p.parse(src).rootNode
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "identifier" && NAMES.has(n.text)) {
      const par = n.parent
      const line = src.slice(0, n.startIndex).split("\n").length
      const declLike = par && DECL_PARENTS.has(par.type)
      if (declLike && !isDirectiveConditionText(n) && !isFunctionLocal(n)) {
        console.log("ADMITS " + n.text + " @L" + line + " parent=" + par.type + " | " + errInfo(n))
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
}
main()
