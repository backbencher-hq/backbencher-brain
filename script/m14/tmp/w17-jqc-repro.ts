// W17 jq:c repro: does the analyzer suppress uses of function-locals declared
// with a typedef'd type (`block last_var = ...`) and read inside macro-call
// args (`BLOCK(..., last_var, ...)`)? And the anonymous-enum enumerator case?
// Decides which side (analyzer vs oracle) must move for the jq:c 1.6% residual.
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
    local_typedef_read: [
      "typedef int block;",
      "static block gen_last_1(void) {",
      "  block last_var = 1;",
      "  return last_var;",
      "}",
    ].join("\n") + "\n",
    macro_arg_read: [
      "typedef int block;",
      "#define BLOCK(...) 0",
      "static block gen_last_1(void) {",
      "  block last_var = 1;",
      "  block init = BLOCK(last_var);",
      "  return init;",
      "}",
    ].join("\n") + "\n",
    anon_enum: [
      "enum { ITER_FINISHED = -2 };",
      "int done(int i) { return i != ITER_FINISHED; }",
    ].join("\n") + "\n",
    for_init_local: [
      "int f(void) {",
      "  int s = 0;",
      "  for (unsigned i = 0; i < 3; i++) s += (int)i;",
      "  return s;",
      "}",
    ].join("\n") + "\n",
  }
  for (const [name, src] of Object.entries(cases)) {
    const root = p.parse(src).rootNode
    const out: any = new RealCAnalyzer().analyze(root, src, "probe/" + name + ".c")
    const rels = (out.relationships ?? []).map((r: any) => r.type + ":" + (r.from ?? r.source) + "->" + r.target)
    console.log("== " + name + " ==")
    console.log(rels.join("\n") || "(none)")
  }
}
main()
