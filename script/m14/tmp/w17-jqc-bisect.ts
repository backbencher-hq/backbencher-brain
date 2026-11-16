// W17 jq:bisect: which REAL construct breaks the analyzer's function-local
// suppression? Case A = exact gen_last_1 shape; B = array-of-struct local with
// sizeof read + for-loop; C = nested bare blocks with assignment.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)

  const cases: Record<string, string> = {
    A_gen_last_1_shape: [
      "typedef int block;",
      "#define STOREV 1",
      "#define LOADVN 2",
      "#define DUP 3",
      "#define BACKTRACK 4",
      "#define FORK 5",
      "#define JUMP_F 6",
      "#define gen_op_simple(x) 7",
      "#define gen_op_var_fresh(x,y) 8",
      "#define gen_op_bound(x,y) 9",
      "#define gen_op_target(x,y) 10",
      "#define gen_const(x) 11",
      "#define gen_call(a,b) 12",
      "#define gen_noop() 13",
      "#define gen_param(x) 14",
      "#define gen_function(a,b,c) 15",
      "#define jv_null() 16",
      "#define jv_true() 17",
      "#define jv_false() 18",
      "#define BLOCK(...) 19",
      "static block gen_last_1(void) {",
      "  block last_var = gen_op_var_fresh(STOREV, \"last\");",
      "  block is_empty_var = gen_op_var_fresh(STOREV, \"is_empty\");",
      "  block init = BLOCK(gen_op_simple(DUP),",
      "                     gen_const(jv_null()),",
      "                     last_var,",
      "                     gen_op_simple(DUP),",
      "                     gen_const(jv_true()),",
      "                     is_empty_var);",
      "  block call_arg = BLOCK(gen_call(\"arg\", gen_noop()),",
      "                         gen_op_simple(DUP),",
      "                         gen_op_bound(STOREV, last_var),",
      "                         gen_const(jv_false()),",
      "                         gen_op_bound(STOREV, is_empty_var),",
      "                         gen_op_simple(BACKTRACK));",
      "  block if_empty = gen_op_simple(BACKTRACK);",
      "  return BLOCK(init,",
      "               gen_op_target(FORK, call_arg),",
      "               call_arg,",
      "               BLOCK(gen_op_bound(LOADVN, is_empty_var),",
      "                     gen_op_target(JUMP_F, if_empty),",
      "                     if_empty,",
      "                     gen_op_bound(LOADVN, last_var)));",
      "}",
    ].join("\n") + "\n",
    B_array_struct_local: [
      "struct bb { const char* name; int code; };",
      "int bindbb(void) {",
      "  int builtins = 0;",
      "  {",
      "    struct bb builtin_defs[] = { {\"empty\", 1}, {\"not\", 2} };",
      "    for (unsigned i = 0; i < sizeof(builtin_defs) / sizeof(builtin_defs[0]); i++) {",
      "      builtins = builtins + builtin_defs[i].code;",
      "    }",
      "  }",
      "  return builtins;",
      "}",
    ].join("\n") + "\n",
    C_nested_blocks_assign: [
      "int f(void) {",
      "  int acc = 0;",
      "  {",
      "    int inner = 5;",
      "    acc = inner + 1;",
      "  }",
      "  return acc;",
      "}",
    ].join("\n") + "\n",
  }
  for (const [name, src] of Object.entries(cases)) {
    const root = p.parse(src).rootNode
    const err = root.hasError ? " [HAS ERROR]" : ""
    const out: any = new RealCAnalyzer().analyze(root, src, "probe/" + name + ".c")
    const rels = (out.relationships ?? []).map((r: any) => r.type + ":" + (r.from ?? r.source) + "->" + r.target)
    console.log("== " + name + " ==" + err)
    console.log(rels.join("\n") || "(none)")
  }
}
main()
