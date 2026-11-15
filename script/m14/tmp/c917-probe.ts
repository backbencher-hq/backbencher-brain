// #917: what does the tree look like for a macro-wrapped function header?
import fs from "node:fs"

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const CASES: Array<[string, string]> = [
  [
    "single, file scope",
    `MACRO_EXPORT(int, foo)(int a, int b){
  int rc = 0;
  enum { BufSize = 1024 * 4 };
  unsigned char buf[BufSize];
  return rc;
}
`,
  ],
  [
    "single, with trailing clean fn",
    `MACRO_EXPORT(int, foo)(int a, int b){
  int rc = 0;
  enum { BufSize = 1024 * 4 };
  unsigned char buf[BufSize];
  return rc;
}

int after_clean(int x){ return x; }
`,
  ],
  [
    "one-line void form",
    `CMPP__EXPORT(void, cleanup)(cmpp_outputer *o){
  if( o->cleanup ){
    o->cleanup( o );
  }
}
`,
  ],
  [
    "prototype form with ;",
    `CMPP__EXPORT(int, err_set)(cmpp *pp, int rc, char const *zFmt, ...);
`,
  ],
  [
    "all on one line",
    `CMPP__EXPORT(bool, isspace)(int ch){
`,
  ],
]

function dump(node: any, src: string, depth: number, maxDepth = 6): string {
  const pad = "  ".repeat(depth)
  const head = node.isError
    ? "ERROR"
    : node.isMissing
      ? `MISSING ${node.type}`
      : node.type + (node.childCount === 0 || !node.namedChildCount ? ` "${(node.text || "").slice(0, 40)}"` : "")
  let out = `${pad}${head}  [${node.startPosition.row}:${node.startPosition.column}-${node.endPosition.row}:${node.endPosition.column}]\n`
  if (depth < maxDepth) {
    for (let i = 0; i < node.childCount; i++) {
      out += dump(node.child(i), src, depth + 1, maxDepth)
    }
  }
  return out
}

for (const [label, src] of CASES) {
  const tree = parser.parse(src)
  console.log(`\n######## ${label}  root.hasError=${tree.rootNode.hasError}`)
  console.log(dump(tree.rootNode, src, 0, 5))
}

// Now the real file region.
const REAL = "/home/ishaq2321/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c"
const realSrc = fs.readFileSync(REAL, "utf8")
const realTree = parser.parse(realSrc)
function findAt(node: any, line: number): any[] {
  const hits: any[] = []
  const stack = [node]
  while (stack.length) {
    const n = stack.pop()
    if (n.startPosition.row <= line && n.endPosition.row >= line) {
      hits.push(n)
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
  }
  return hits
}
console.log(`\n######## REAL libcmpp.c L8748 (body)` )
const chain = findAt(realTree.rootNode, 8751).map((n) => `${n.type}${n.isError ? " (ERROR)" : ""}`)
console.log("ancestor chain (deepest first):", chain.join(" < "))
