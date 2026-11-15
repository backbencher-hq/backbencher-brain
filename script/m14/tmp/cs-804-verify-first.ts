// script/m14/tmp/cs-804-verify-first.ts — M49.CS1 (#804) verify-first, focused on the
// two claims in reviews/csharp/*.md that NO gate holds. The rest of that wave's tally
// is already re-verified every run: all ten fixtures it names exist and pass, and all
// ten mutants it names are CAUGHT (the csharp mutant run prints them one by one).
//
//   CLAIM 1 (master-review, "Ruled"): "C# declared-type references (param/return/field
//   types): absent like pre-R13 rust — recorded gap for its own wave". A recorded gap
//   is a claim about HEAD, so it is checked at HEAD: does a declared type emit any
//   `references` edge?
//
//   CLAIM 2 (CS-C2, and the "hardening" section): "tree-sitter-csharp spells ALL type
//   names plain `identifier` — there is no `type_identifier` or `field_identifier`
//   node" (13 + 4 dead disjuncts removed on that basis). A grammar claim is checkable
//   against the grammar rather than trusted: walk the trees of every type-bearing
//   shape and report whether those node types occur at all.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const DECLARED_TYPE_SRC = `
namespace N
{
    public class Dep { }

    public class Holder
    {
        private Dep _field;

        public Dep Return();
    }
}
`

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const tmp = path.join(ROOT, "script/m14/tmp/_probe-804.cs")
  fs.writeFileSync(tmp, DECLARED_TYPE_SRC)
  const res: any = await ASTEngine.parseFile(tmp, DECLARED_TYPE_SRC)
  fs.unlinkSync(tmp)

  console.log("=== CLAIM 1: declared-type references ===")
  for (const r of res.relationships ?? []) {
    console.log("   ALL", JSON.stringify({ type: r.type, src: r.source, tgt: r.target, line: r.line_number }))
  }
  const refs = (res.relationships ?? []).filter((r: any) => r.type === "references")
  console.log(`references edges: ${refs.length}`)
  for (const r of refs) console.log("   ", JSON.stringify({ src: r.source, tgt: r.target, line: r.line_number }))
  // The claim is about declared-type REFERENCES: no edge of any type may connect a
  // member or its declaring type to the type written in its declaration. (`contains
  // N -> Dep` is the namespace holding the class `Dep` itself, which is not that.)
  const fromMembers = (res.relationships ?? []).filter(
    (r: any) => String(r.source) === "Holder" && String(r.target) === "Dep",
  )
  console.log(`edges Holder -> Dep (field type / return type / param type): ${fromMembers.length}`)
  console.log(
    refs.length === 0 && fromMembers.length === 0
      ? "VERDICT: the recorded gap SURVIVES at HEAD — no declared-type reference edge is emitted"
      : "VERDICT: the gap is CLOSED — the doc's 'recorded gap' is stale",
  )

  console.log("\n=== CLAIM 2: the grammar vocabulary ===")
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c_sharp.wasm")))
  const p = new P()
  p.setLanguage(LANG)
  const SRC = [
    "class C { Dep _f; public Dep M(Dep a, System.Text.Dep b) { Dep x = null; return x; } }",
    "class C<T> where T : Dep { T _t; }",
    "interface I { Dep P { get; } }",
    "class C { (Dep a, int b) Tuple() => default; }",
  ]
  const seen = new Set<string>()
  let typedIdentifier = 0
  for (const src of SRC) {
    const root = p.parse(src).rootNode
    const stack = [root]
    while (stack.length) {
      const n = stack.pop()!
      seen.add(n.type)
      if (n.type === "type_identifier" || n.type === "field_identifier") typedIdentifier++
      for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
    }
  }
  console.log(`node types seen: ${[...seen].sort().join(", ")}`)
  console.log(`type_identifier/field_identifier occurrences: ${typedIdentifier}`)
  console.log(
    typedIdentifier === 0
      ? "VERDICT: the doc's grammar claim HOLDS — type names are plain `identifier` in this grammar version"
      : "VERDICT: the claim is FALSE — the grammar does expose those node types, so the removed disjuncts were not dead",
  )
}

main()
