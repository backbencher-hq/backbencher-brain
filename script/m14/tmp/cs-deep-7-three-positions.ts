// CS-DEEP-7 — three candidate defects, each isolated to ONE position and measured
// against a control that the lane already handles.
//
//   A. GENERIC ATTRIBUTE, PLAIN NAME — publishes NO decorator at all.
//      `extractAttributes` selects the attribute's name node by predicate
//      (identifier | qualified_name | alias_qualified_name). A generic attribute's
//      name child is a `generic_name`, which is in none of the three, so the whole
//      decorator is dropped. The `global::`-qualified twin of the SAME attribute DOES
//      publish — as the whole generic spelling, because a qualified_name's text
//      carries the arguments. One shape, two wrong answers.
//
//   B. THE DECLARED-TYPE GRAPH LOSES ITS TYPE ARGUMENTS.
//      The R9 header states the contract: "`List<Dep>` emits BOTH `List` and `Dep`
//      (rust and java do; kotlin, python and typescript emit only the base and so lose
//      the dependency that actually matters). The argument is the real dependency, so
//      it is here." The probe uses a REAL (non-predefined) argument so the loss cannot
//      be mistaken for the documented `predefined_type` silence.
//
//   C. CONVERSION OPERATOR whose target type is written generically — the member NAME
//      carries the whole generic spelling.
//
// Every case runs through the production path and prints the control beside it.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const CASES: Array<{ name: string; src: string }> = [
  // --- A. generic attributes -------------------------------------------------
  { name: "A1-generic-attribute-plain", src: `[Marker<int>] public class C { }` },
  { name: "A2-generic-attribute-plain-real-arg (control: a real type arg)", src: `[Marker<Widget>] public class C { } public class Widget { }` },
  { name: "A3-generic-attribute-qualified", src: `[System.Marker<int>] public class C { }` },
  { name: "A4-generic-attribute-global-qualified", src: `[global::Marker<string, int>] public class C { }` },
  { name: "A5-plain-attribute (control)", src: `[Marker] public class C { }` },
  { name: "A6-qualified-attribute (control)", src: `[System.Marker] public class C { }` },
  { name: "A7-generic-attribute-on-member", src: `public class C { [Marker<int>] public int P { get; set; } }` },
  { name: "A8-two-generic-attributes", src: `[A<int>] [B<string>] public class C { }` },
  // --- B. declared-type graph arguments --------------------------------------
  { name: "B1-dt-real-argument", src: `public class Holder { System.Collections.Generic.Dictionary<string, Widget> _m; } public class Widget { }` },
  { name: "B2-dt-two-real-arguments", src: `public class Holder { System.Collections.Generic.Dictionary<Widget, Gadget> _m; } public class Widget { } public class Gadget { }` },
  { name: "B3-dt-nested-generic-argument", src: `public class Holder { System.Collections.Generic.List<System.Collections.Generic.List<Widget>> _m; } public class Widget { }` },
  { name: "B4-dt-parameter-argument", src: `public class C { public void M(System.Collections.Generic.Dictionary<string, Widget> d) { } } public class Widget { }` },
  { name: "B5-dt-return-argument", src: `public class C { public System.Collections.Generic.Dictionary<string, Widget> M() => null!; } public class Widget { }` },
  { name: "B6-dt-attribute-argument (declared position)", src: `public class C { [Marker<Widget>] public int P { get; set; } } public class Widget { }` },
  // --- C. conversion operator with a generic target --------------------------
  { name: "C1-conversion-generic-target", src: `public class P { public static explicit operator System.Collections.Generic.List<int>(int x) => new(); }` },
  { name: "C2-conversion-plain-target (control)", src: `public class P { public static explicit operator int(long x) => (int)x; }` },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  for (const c of CASES) {
    const file = path.join(ROOT, "script", "m14", "tmp", `csdeep7-${c.name.split("-")[0]}.cs`)
    fs.writeFileSync(file, c.src + "\n")
    const tree = parser.parse(c.src + "\n")
    const res: any = await ASTEngine.parseFile(file, c.src + "\n")
    console.log(`\n=== ${c.name}`)
    console.log(`   src: ${c.src}`)
    console.log(`   parse errors: ${tree.rootNode.hasError ? "YES" : "none"}`)
    for (const s of res.symbols ?? []) {
      const dec = s.decorators !== undefined ? ` decorators=${JSON.stringify(s.decorators)}` : ""
      console.log(`   symbol  ${s.kind.padEnd(10)} ${JSON.stringify(s.name)}${dec}`)
    }
    for (const r of res.relationships ?? []) {
      const t = r.type ?? r.relationshipType
      if (t === "references" || t === "contains") {
        console.log(`   edge    ${r.source} -[${t}]-> ${JSON.stringify(r.target)} ${t === "references" ? `md=${JSON.stringify(r.metadata)}` : ""}`)
      }
    }
  }
}

if (import.meta.main) await main()
