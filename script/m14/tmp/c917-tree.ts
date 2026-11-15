// #917: tree dump under a chosen grammar wasm.
//   bun script/m14/tmp/c917-tree.ts <wasm> [file]
import fs from "node:fs"

const WASM = process.argv[2] ?? "wasm/tree-sitter-c.wasm"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(WASM))
const parser = new P()
parser.setLanguage(lang)
const USE_LANG = WASM.includes("cpp") ? undefined : undefined

function dump(node: any, depth: number, maxDepth = 7): string {
  const pad = "  ".repeat(depth)
  const label = node.isError ? "ERROR" : node.isMissing ? `MISSING ${node.type}` : node.type
  const leaf = node.namedChildCount === 0 ? ` "${(node.text || "").slice(0, 46)}"` : ""
  let out = `${pad}${label}${leaf}  [${node.startPosition.row + 1}:${node.startPosition.column}]\n`
  if (depth < maxDepth) for (let i = 0; i < node.childCount; i++) out += dump(node.child(i), depth + 1, maxDepth)
  return out
}

const file = process.argv[3]
if (file) {
  const src = fs.readFileSync(file, "utf8")
  const tree = parser.parse(src)
  const root = tree.rootNode
  console.log(`#### ${file}  hasError=${root.hasError}`)
  let errs = 0
  const stack: any[] = [root]
  while (stack.length) { const n = stack.pop()!; if (n.isError) errs++; for (let i = 0; i < n.childCount; i++) stack.push(n.child(i)) }
  console.log(`ERROR nodes: ${errs}`)
  // print only the region around the first wrapped definition if any, else the first 60 lines of tree
  const wanted = Number(process.env.BB_AT_LINE ?? 0)
  if (wanted) {
    const hits: any[] = []
    const st: any[] = [root]
    while (st.length) {
      const n = st.pop()!
      if (n.startPosition.row + 1 <= wanted && n.endPosition.row + 1 >= wanted) { hits.push(n); for (let i = 0; i < n.childCount; i++) st.push(n.child(i)) }
    }
    const deepest = hits[hits.length - 1]
    console.log("deepest at line:", deepest?.type)
    // find the enclosing top-level item
    let item = deepest
    while (item && item.parent && item.parent.type !== "translation_unit" && item.parent.type !== "ERROR") item = item.parent
    console.log(dump(item, 0, 5))
  }
} else {
  const CASES: Array<[string, string]> = [
    ["wrapped, 2 args", `MACRO_EXPORT(int, foo)(int a, int b){\n  int rc = 0;\n  enum { BufSize = 1024 * 4 };\n  unsigned char buf[BufSize];\n  return rc;\n}\n`],
    ["wrapped + clean after", `CMPP__EXPORT(void, cleanup)(cmpp_outputer *o){\n  if( o->cleanup ) o->cleanup( o );\n}\nint after_clean(int x){ return x; }\n`],
    ["call chain, NOT a definition (must stay a call)", `handler(1, 2)(3, 4);\n`],
    ["call chain in a body (must stay two statements)", `int f(void){\n  cb(1)(2);\n  { int nested = 1; return nested; }\n}\n`],
    ["prototype only (no body)", `CMPP__EXPORT(int, err_set)(cmpp *pp, int rc, ...);\n`],
    ["macro specifier shapes must be untouched", `MSC_ATTRIBUTE(1) int x;\nMacroSpec int y;\n`],
    ["variadic wrapped", `EXPORT(int, vf)(const char *fmt, ...){\n  return 0;\n}\n`],
    ["empty params", `EXPORT(void, noargs)(){\n  return;\n}\n`],
  ]
  for (const [label, src] of CASES) {
    const tree = parser.parse(src)
    console.log(`\n######## ${label}   hasError=${tree.rootNode.hasError}`)
    console.log(dump(tree.rootNode, 0, 5))
  }
}
