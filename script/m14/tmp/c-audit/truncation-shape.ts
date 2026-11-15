/**
 * C audit probe: the tree-sitter shape of the #916 macro-truncated declaration's
 * re-parsed sibling, for every spelling the regex at
 * src/ast/real-c-analyzer.ts:2656 currently accepts.
 *
 * The regex reads `/^([A-Za-z_][A-Za-z0-9_]*)\s*(=|\()/` off the sibling's TEXT.
 * Before replacing it with a structural read, the structure has to be MEASURED:
 * a replacement that assumes a shape the grammar does not produce is a fabrication
 * risk, which is the exact failure this file's history is made of.
 *
 *   bun run script/m14/tmp/c-audit/truncation-shape.ts
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..", "..")
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))

/** Each case: a bare ALL-CAPS macro truncates the declaration, then the real declarator. */
const CASES: Array<{ label: string; src: string }> = [
  { label: "variable with initializer", src: "static BtShared *SQLITE_WSD sqlite3SharedCacheList = 0;\nint after;\n" },
  { label: "function prototype", src: "static void SQLITE_NOINLINE f(Btree *p);\nint after;\n" },
  { label: "prototype, no params", src: "static void SQLITE_NOINLINE g(void);\nint after;\n" },
  { label: "variable, no initializer", src: "static int SQLITE_WSD counter;\nint after;\n" },
  { label: "array variable with initializer", src: "static int SQLITE_WSD table[4] = {1};\nint after;\n" },
  { label: "declaration ending at EOF", src: "static int SQLITE_WSD tail" },
  { label: "pointer deref initializer", src: "static int SQLITE_WSD *p;\nint after;\n" },
  { label: "multi-declarator", src: "static int SQLITE_WSD a, b = 2;\nint after;\n" },
  { label: "macro AFTER the declarator (control)", src: "static int real SQLITE_WSD = 3;\nint after;\n" },
  { label: "call expression statement", src: "int SQLITE_WSD after = f(1);\n" },
]

function sexp(n: any, depth = 0): string {
  const pad = "  ".repeat(depth)
  const named = n.isNamed ? "" : '"'
  let out = `${pad}${named}${n.type}${named}`
  if (n.isMissing) out += " (MISSING)"
  for (let i = 0; i < n.childCount; i++) out += "\n" + sexp(n.child(i), depth + 1)
  return out
}

for (const c of CASES) {
  const tree = parser.parse(c.src)
  const top = tree.rootNode.namedChildren.filter((n: any) => n.type !== "comment")
  console.log(`\n=== ${c.label} ===`)
  console.log(c.src.split("\n")[0])
  console.log(sexp(tree.rootNode))
  // What the regex would decide, and what a structural read sees.
  for (const n of top) {
    if (n.type !== "expression_statement") continue
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(=|\()/.exec(n.text.trim())
    const inner = n.namedChild(0)
    console.log(
      `  expression_statement text: ${JSON.stringify(n.text)}\n` +
        `    regex  -> ${m ? `name=${m[1]} callable=${m[2] === "("}` : "REFUSED"}\n` +
        `    inner  -> ${inner ? inner.type : "none"}` +
        (inner?.type === "assignment_expression"
          ? `  left=${inner.childForFieldName("left")?.type}:${JSON.stringify(inner.childForFieldName("left")?.text)}` +
            `  op=${JSON.stringify(inner.childForFieldName("operator")?.text ?? inner.childForFieldName("operator")?.type)}`
          : "") +
        (inner?.type === "call_expression"
          ? `  fn=${inner.childForFieldName("function")?.type}:${JSON.stringify(inner.childForFieldName("function")?.text)}`
          : ""),
    )
  }
}
