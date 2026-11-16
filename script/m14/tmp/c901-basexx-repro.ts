// #901 basexx.c exact-shape repro: a bare identifier STATEMENT at top level,
// inside an `#ifndef` region, whose `#define` comes AFTER the read.
// Run: bun script/m14/tmp/c901-basexx-repro.ts
import { readFileSync } from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("/tmp/bb-wasm_tree-sitter-c_tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const CASES: Array<[string, string]> = [
  ["A: exact basexx shape (read before define, in #ifndef)", `#ifndef GUARD\n# include "sqlite3ext.h"\nSQLITE_EXTENSION_INIT1;\n#endif\n\n#undef SQLITE_EXTENSION_INIT1\n#define SQLITE_EXTENSION_INIT1 /* */\n`],
  ["B: same, no include, define after", `#ifndef GUARD\nMACRO_X;\n#endif\n#define MACRO_X\n`],
  ["C: bare ident statement, define BEFORE, top level", `#define MACRO_Y\nMACRO_Y;\n`],
  ["D: bare ident statement top level, define before, no region", `#define MACRO_Z 1\nMACRO_Z;\n`],
  ["E: ident in an expression (assignment)", `#define MACRO_W 1\nint g = MACRO_W;\n`],
]
for (const [label, src] of CASES) {
  const tree = parser.parse(src)
  console.log(`\n=== ${label} ===`)
  console.log(tree.rootNode.toString().replace(/\n/g, " | "))
}
// Also dump the exact real file region
const real = readFileSync("<corpus-root>/bb_tests/repositories/sqlite/ext/misc/basexx.c", "utf8")
const REAL_CASE = `#ifndef G\n# include "sqlite3ext.h"\nSQLITE_EXTENSION_INIT1;\n#endif\n`
console.log("\n=== REAL region tree (no undef/define) ===")
console.log(parser.parse(REAL_CASE).rootNode.toString().replace(/\n/g, " | "))
void real
