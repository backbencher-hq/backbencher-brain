// W17: valueless-#define mention inside an ERROR-dissolved #ifdef line.
// Which side emits an edge? Settles the fix locus (oracle-only vs both).
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"
import { deriveCCalls } from "../differential"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)

  // Shape A: clean parse (no glue) — the mention is a real preproc_ifdef child
  const clean = "#define NO_HEX_FP\n#ifdef NO_HEX_FP\nint f(void) { return 1; }\n#endif\nint main(void) { return f(); }\n"
  // Shape B: mimic jv_dtoa.c glue — a function list initializer that breaks
  // the parse and dissolves the #ifdef line into ERROR content
  const glue = [
    "typedef struct { void (*fn)(void); const char* name; } CFUNC;",
    "static const CFUNC function_list[] = {",
    "#define NO_HEX_FP",
    "#include \"libm.h\"",
    "};",
    "#ifdef NO_HEX_FP",
    "static int g = 1;",
    "#endif",
  ].join("\n") + "\n"

  for (const [name, src] of Object.entries({ A_clean: clean, B_glue: glue })) {
    const root = p.parse(src).rootNode
    const out: any = new RealCAnalyzer().analyze(root, src, "probe/" + name + ".c")
    const aEdges = (out.relationships ?? []).filter((r: any) => r.target === "NO_HEX_FP").map((r: any) => r.type)
    const truth = deriveCCalls(root).filter(e => e.target === "NO_HEX_FP").map(e => e.label)
    console.log(name + (root.hasError ? " [ERR]" : "") + " :: analyzer=" + JSON.stringify(aEdges) + " oracle=" + JSON.stringify(truth))
  }
}
main()
