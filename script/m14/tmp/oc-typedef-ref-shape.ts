// script/m14/tmp/oc-typedef-ref-shape.ts — the M12 objc truth carries two rows the
// audit never described: `rel:user_config.h:references:global:UserRole` (on
// `} UserRole;`) and `rel:user_config.h:references:global:UserId` (on
// `typedef NSString *UserId;`). user_config.h has no class markers, so the shared
// C-family path parses it — the same path c.json/cpp.json pin. This probe asks the
// C analyzer the same question the c lane answered with `typedef struct Point Point;`
// -> `references:global:Point`: what does each typedef shape emit, and is the target
// the TYPE that is referenced or the alias that is being declared?
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const cLang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-c-analyzer"))
  const cases: Array<[string, string]> = [
    ["explicit-struct forward self", `typedef struct Point Point;\nstruct Point { int x; };\n`],
    ["named struct alias", `typedef struct Node NodeT;\nstruct Node { int v; };\n`],
    ["opaque pointer alias", `typedef struct HandleImpl *Handle;\n`],
    ["anonymous enum named by typedef", `typedef enum {\n  A = 0,\n  B = 1,\n} UserRole;\n`],
    ["plain alias", `typedef int Foo;\n`],
    ["two-word alias (the objc case)", `typedef NSString *UserId;\n`],
    ["struct dot alias", `typedef struct Book Book2;\n`],
  ]
  for (const [label, src] of cases) {
    const p = new P(); p.setLanguage(cLang)
    const r: any = await new mod.RealCAnalyzer().analyze(p.parse(src).rootNode, src, "t.c")
    const syms = (r.symbols ?? []).map((s: any) => `${s.kind}:${s.name}@${s.range?.startLine}`)
    const rels = (r.relationships ?? []).map((e: any) => `${e.type} ${e.source} -> ${e.target} (conf ${e.confidence}, ${(e.metadata ?? {}).relationshipType ?? ""})`)
    console.log(`-- ${label}: ${JSON.stringify(src)}`)
    console.log(`   symbols: ${syms.join(", ")}`)
    for (const e of rels) console.log(`   ${e}`)
  }
}
main()
