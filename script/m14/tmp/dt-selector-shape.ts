/**
 * SCRATCH PROBE (dart lane): the raw node shapes under `selector`, so the qualifier arms
 * in `real-dart-analyzer.ts` are grounded in the grammar rather than guessed.
 *
 * Prints, for every selector, its parent and its previous SIBLING (raw and named) — the
 * two things a target-qualification arm has to read to know whether the source spelled an
 * owner at all.
 *
 * Run: npx tsx script/m14/tmp/dt-selector-shape.ts
 */
import * as WTS from "web-tree-sitter"
import { resolveWasmAsset } from "../../../src/util/wasm"

const wasm = resolveWasmAsset("tree-sitter-dart/tree-sitter-dart.wasm")
await (WTS as any).Parser.init()
const Lang = await (WTS as any).Language.load(wasm)
const p = new (WTS as any).Parser()
p.setLanguage(Lang)

const src = `class C extends Base {
  void run(P p, Bar? q) {
    var x = Widget();
    Baz y = Baz();
    final z = q.buzz();
    Widget? w = null;
    x.alpha();
    y.beta();
    p.gamma();
    z.delta();
    w.epsilon();
  }
}
void other(List<int> xs) { xs.add(1); }`

const tree = p.parse(src)!
const stack: any[] = [tree.rootNode]
while (stack.length > 0) {
  const n = stack.pop()
  if (["initialized_variable_definition", "declaration", "local_variable_declaration", "formal_parameter"].includes(n.type)) {
    const show = (x: any) => (x ? `${x.type}:${JSON.stringify(x.text)}` : "null")
    console.log(
      `DECL ${n.type.padEnd(30)} type=${show(n.childForFieldName("type"))} name=${show(n.childForFieldName("name"))} value=${show(n.childForFieldName("value"))}`,
    )
  }
  if (n.type === "selector") {
    const prev = n.previousSibling
    const prevN = n.previousNamedSibling
    const show = (x: any) => (x ? `${x.type}:${JSON.stringify(x.text)}` : "null")
    console.log(
      `parent=${String(n.parent?.type).padEnd(26)} raw=[${n.text.padEnd(18)}] prevSib=${show(prev).padEnd(22)} prevNamed=${show(prevN)}`,
    )
  }
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c) stack.push(c)
  }
}
