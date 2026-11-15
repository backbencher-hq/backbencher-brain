// #743 reducer: minimal reconstructions of the measured classes, each parsed
// through a named wasm. A case is CONFIRMED when it produces an ERROR node.
//
// Usage: bun script/m14/tmp/c743-repro.ts <wasm> [lang]
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const wasmPath = process.argv[2]
const LANG = process.argv[3] ?? "c"

const CASES: Array<[string, string]> = [
  // ── class A: a macro identifier where a declaration-specifier is expected ──
  ["A1 static MACRO struct", `static WSD struct S { int a; };\n`],
  ["A1c static struct (control)", `static struct S { int a; };\n`],
  ["A2 MACRO struct at file scope", `WSD struct S { int a; };\n`],
  ["A3 static MACRO union", `static ALIGN128 union U { int a; };\n`],
  ["A4 static int MACRO f(void)", `static int TCLAPI f(void) { return 0; }\n`],
  ["A4c static int f (control)", `static int f(void) { return 0; }\n`],
  ["A5 int MACRO f(void)", `int TCLAPI f(void) { return 0; }\n`],
  ["A6 MACRO void f(void)", `SQLITE_API void f(void) {}\n`],
  ["A7 void MACRO *f(void)", `void TCLAPI *f(void) { return 0; }\n`],
  ["A8 static MACRO int f(void)", `static TCLAPI int f(void) { return 0; }\n`],
  ["A9 MACRO struct file scope, no static", `SQLITE_WSD struct S { int a; };\n`],
  ["A10 static MACRO enum", `static WSD enum E { A };\n`],
  ["A11 MACRO typedef", `APIDEF typedef int myint;\n`],
  ["A12 extern MACRO int f(void)", `extern TCLAPI int f(void);\n`],
  ["A13 struct field with MACRO type", `struct S { TCLAPI int x; };\n`],
  ["A14 storage macro both sides", `static WSD int a;\n`],
  ["A15 MACRO after return type, pointer return", `static char *TCLAPI f(void);\n`],
  // ── class B: preprocessor inside an initializer list ──
  ["B1 ifdef inside initializer", `int a[] = {\n#ifdef X\n  1,\n#endif\n  2\n};\n`],
  ["B2 ifdef inside function-body array", `void f(void) {\n  int a[] = {\n#ifdef X\n    1,\n#endif\n    2\n  };\n}\n`],
  // ── class C: #else inside a compound statement ──
  ["C1 else inside body", `void f(void) {\n  int a = 0;\n#if X\n  a = 1;\n#else\n  a = 2;\n#endif\n}\n`],
  // ── class D: ms_declspec modifier ──
  ["D1 declspec macro call", `void f(void) {\n  MSC_ATTRIBUTE(1) int x = 0;\n}\n`],
  ["D2 declspec-like", `__declspec(align(16)) struct S { int a; };\n`],
  // ── class S: switch/case shapes (the window.c regression) ──
  ["S1 switch with two case labels", `void f(int op){\n  switch(op){\n    case TK_A:\n      break;\n    case TK_B:\n      break;\n  }\n}\n`],
  ["S2 case label then local declaration", `void f(int op){\n  switch(op){\n    case TK_A:\n      if( op ){\n        break;\n      }else{\n        Win *pWin;\n        for(pWin=0; pWin; pWin=pWin->next){\n          if( pWin==pWin ) return;\n        }\n      }\n    case TK_B:\n    case TK_C: {\n      int iCol = -1;\n      break;\n    }\n  }\n}\n`],
  ["S3 fallthrough comment between cases", `void f(int op){\n  switch(op){\n    case TK_A:\n      break;\n      /* no break */ deliberate_fall_through\n\n    case TK_B:\n      break;\n  }\n}\n`],
  ["S4 case with macro constant", `void f(int op){\n  switch(op){\n    case TK_IF_NULL_ROW:\n      break;\n  }\n}\n`],
  // ── class E: attribute macros before a declarator ──
  ["E1 attribute macro before function", `NOINLINE static void f(void) {}\n`],
  ["E2 attribute macro between", `static void NOINLINE f(void) {}\n`],
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({
    locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
  })
  const lang = await Language.load(readFileSync(wasmPath))
  const parser = new Parser()
  parser.setLanguage(lang)

  let confirmed = 0
  for (const [name, src] of CASES) {
    const tree = parser.parse(src)
    const root: any = tree.rootNode
    let err: any = null
    const stack = [root]
    while (stack.length) {
      const n = stack.pop()
      if (n.type === "ERROR" && !err) err = n
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
    const hasMiss = (() => {
      let m = false
      const st = [root]
      while (st.length) {
        const n = st.pop()
        if (n.isMissing) m = true
        for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
      }
      return m
    })()
    const verdict = err ? "ERROR" : hasMiss ? "MISSING-only" : "clean"
    if (err) confirmed++
    const where = err ? ` @row ${err.startPosition.row + 1}:${err.startPosition.column}` : ""
    console.log(`${verdict.padEnd(12)} ${name}${where}`)
    tree.delete()
  }
  console.log(`\n# ${confirmed}/${CASES.length} cases produce an ERROR node with ${path.basename(wasmPath)} [${LANG}]`)
}

main().catch((e) => {
  console.error("c743-repro failed:", e)
  process.exit(1)
})
