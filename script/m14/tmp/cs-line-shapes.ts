// script/m14/tmp/cs-line-shapes.ts — the grammar shapes the csharp line round
// (M59.A7) must stamp from. PROBE FIRST, assume second: every stamp in the
// analyzer has to name a node that (a) exists and (b) carries the target token
// on its own line, which is what script/m59/oracle-callsite.ts re-derives.
import * as fs from "fs"
import * as path from "path"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P()
  p.setLanguage(LANG)

  const dumpAll = (n: any, dp: number, max: number): void => {
    if (!n || dp > max) return
    console.log(
      "  ".repeat(dp) +
        `${n.type} [${n.startPosition.row + 1}..${n.endPosition.row + 1}] named=${n.isNamed} :: ${JSON.stringify((n.text ?? "").slice(0, 40))}`,
    )
    for (let i = 0; i < n.childCount; i++) dumpAll(n.child(i), dp + 1, max)
  }
  const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
    if (!n) return out
    if (pred(n)) out.push(n)
    for (let i = 0; i < n.childCount; i++) findAll(n.child(i), pred, out)
    return out
  }
  const block = (label: string, src: string, pred: (x: any) => boolean, max = 2) => {
    console.log(`\n===== ${label} =====`)
    const root = p.parse(src).rootNode
    const hits = findAll(root, pred)
    if (hits.length === 0) { console.log("  (no node matched)"); return }
    dumpAll(hits[0], 1, max)
  }

  // 1. constructor_initializer: `: base(x)` / `: this()` — where does the
  //    target token actually live, and can the colon and the keyword split lines?
  block("constructor_initializer (same line)", `class B { public B(int x) { } } class C : B { public C(int x) : base(x) { } }`, (x) => x.type === "constructor_initializer")
  block("constructor_initializer (wrapped)", `class B { public B(int x) { } } class C : B {\n  public C(int x)\n    :\n      base(x)\n  { }\n}`, (x) => x.type === "constructor_initializer")
  block("constructor_initializer this()", `class C { public C() : this(1) { } public C(int x) { } }`, (x) => x.type === "constructor_initializer")

  // 2. base_list children for the three primary shapes the analyzer handles.
  block("class : Base, IFoo", `class D : Base, IFoo { }`, (x) => x.type === "base_list")
  block("interface : IA, IB", `interface I : IA, IB { }`, (x) => x.type === "base_list")
  block("record primary ctor", `record P(int A) : Base(A), IFoo { }`, (x) => x.type === "base_list")
  block("wrapped base list", `class D :\n  Base,\n  IFoo { }`, (x) => x.type === "base_list")

  // 3. invocation function field shape (member access chain, generic, bare).
  block("invocation member chain", `class C { void M() { this.list.Add(item); } }`, (x) => x.type === "invocation_expression")
  block("invocation generic", `class C { void M() { Foo.Gen<int>(1); } }`, (x) => x.type === "invocation_expression")
  block("invocation wrapped callee", `class C { void M() { helper\n    .Strip(); } }`, (x) => x.type === "invocation_expression")

  // 4. object_creation_expression type node.
  block("object creation", `class C { void M() { var a = new Widget(); } }`, (x) => x.type === "object_creation_expression")

  // 5. implicit (target-typed) new + where the declared type is written.
  block("implicit new same line", `class C { List<int> _items = new(); }`, (x) => x.type === "implicit_object_creation_expression")
  block("implicit new wrapped declaration", `class C {\n  List<int> _items =\n    new();\n}`, (x) => x.type === "implicit_object_creation_expression")
  block("implicit new wrapped declaration (declarator)", `class C {\n  List<int> _items =\n    new();\n}`, (x) => x.type === "variable_declarator")

  // 6. using directives — plain, alias, static, global.
  block("using plain", `using System.Collections.Generic;`, (x) => x.type === "using_directive")
  block("using alias", `using A = B.C;`, (x) => x.type === "using_directive")
  block("using aliased qualified", `using Config = System.Text.Json.JsonSerializerOptions;`, (x) => x.type === "using_directive")

  // 7. member access name field (the field-access Uses stamp).
  block("member access chain rewrapped", `class C { void M() { var v = obj\n    .Radius; } }`, (x) => x.type === "member_access_expression")

  // 8. override declaration + explicit interface implementation.
  block("override decl", `class B { public virtual void Greet() { } } class D : B { public override void Greet() { } }`, (x) => x.type === "method_declaration")
}

main()
