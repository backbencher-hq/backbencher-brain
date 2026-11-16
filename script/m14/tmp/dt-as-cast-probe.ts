// script/m14/tmp/dt-as-cast-probe.ts — the oracle-only `calls -> as` residual.
//
// Full extent (dart-http, 335/335 files): the truth oracle derives exactly one
// edge the analyzer does not — `calls -> as`. The source shape is the FFI
// bindings' redirecting constructor: `NSCondition() : this.as(new$().object$);`
// (the `as` is a DECLARED named constructor used as the redirect target, and it
// is also the spelling of the `as` operator). This probe reproduces the shape in
// isolation and prints both sides, so the ruling (refuse the keyword, emit the
// redirect) is made on the text.
import * as fs from "node:fs"
import * as path from "node:path"
import { RealDartAnalyzer } from "../../../src/ast/real-dart-analyzer"
import { deriveDartEdges, deriveDartBareUses } from "../differential"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

const SRC = `class C {
  final Object o;
  C() : this.as(1);
  C.as(this.o);
  C.other() : this.named(2);
  C.named(this.o);
}

class D {
  final Object o;
  D(this.o);
  Object cast(Object x) => x as C;
}
`

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root: any = p.parse(SRC).rootNode
  const res: any = await new RealDartAnalyzer().analyze(root, SRC, "probe.dart")
  console.log("--- analyzer symbols")
  for (const s of res.symbols ?? []) console.log(`  ${s.kind} ${s.name} owner=${s.ownerName} line=${s.range?.startLine} ${JSON.stringify(s.metadata ?? {})}`)
  console.log("--- analyzer relationships")
  for (const r of res.relationships ?? []) console.log(`  ${r.type} ${r.source} -> ${r.target} conf=${r.confidence} line=${r.line_number} ${JSON.stringify(r.metadata ?? {})}`)
  console.log("--- oracle edges")
  for (const e of [...deriveDartEdges(root), ...deriveDartBareUses(root, res.symbols ?? [])]) console.log(`  ${e.label} ${e.target}`)
}
main().then(() => process.exit(0))
