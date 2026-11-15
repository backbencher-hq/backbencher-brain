// CS-DEEP-2 — probe battery for the two shape convictions the deep census raised
// over 400 roslyn files (M12/M14/M37/M49/M60 round).
//
//   A. A `using` ALIAS whose target is a GENERIC type publishes the WHOLE generic
//      spelling as the module — and, when the type argument is a TUPLE, the tuple's
//      ELEMENT NAMES come with it:
//        using PropertiesMap = ImmutableDictionary<(UnusedValuePreference preference,
//                                                   bool isUnusedLocalAssignment,
//                                                   bool isRemovableAssignment), ...>;
//        -> references -> "ImmutableDictionary<(UnusedValuePreference preference,bool
//            isUnusedLocalAssignment,bool isRemovableAssignment),...>"
//      The name-position twins (`using System.Collections.Generic;`, `class C :
//      Base<int>`, `new List<int>()`) all publish a NAME. This is the R10 class
//      "a target no source can name", at its largest measured size.
//
//   B. A conversion operator's member NAME carries whitespace
//      (`explicit CSharpAnalyzerOptionsProvider`) and is published as a `contains`
//      target. C2b ruled that a whitespace-bearing OPERATOR member name is a naming
//      convention, not a fabrication — this probe re-derives the ruling's boundary
//      rather than re-litigating it, by showing the same spelling in the symbol table
//      (so the containment edge is truthful to the symbol) and the plain-type twin.
//
// Every case is run through the PRODUCTION path (ASTEngine.parseFile), never the
// analyzer class directly, so the published payload is what a user would see.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const CASES: Array<{ name: string; src: string }> = [
  {
    name: "A1-alias-generic-target",
    src: `using System.Collections.Generic;
using Map = System.Collections.Generic.Dictionary<string, int>;
public class C { }`,
  },
  {
    name: "A2-alias-tuple-argument-target (the census line)",
    src: `using PropertiesMap = ImmutableDictionary<(UnusedValuePreference preference, bool isUnusedLocalAssignment, bool isRemovableAssignment), ImmutableDictionary<string, string?>>;
public class C { }`,
  },
  {
    name: "A3-alias-nested-generic-target",
    src: `using M = System.Collections.Generic.Dictionary<string, System.Collections.Generic.List<System.Text.StringBuilder>>;
public class C { }`,
  },
  {
    name: "A4-plain-using-generic-root (control: a path is a name)",
    src: `using System.Collections.Generic;
public class C { }`,
  },
  {
    name: "A5-heritage-generic (control: the same type as a base)",
    src: `public class Base<T> { }
public class D : Base<int> { }`,
  },
  {
    name: "A6-creation-generic (control)",
    src: `using System.Collections.Generic;
public class C { public object M() => new List<int>(); }`,
  },
  {
    name: "B1-conversion-operator-name",
    src: `public class P { public static explicit operator P(int x) => new P(); }
public class Q { }`,
  },
  {
    name: "B2-arithmetic-operator-name",
    src: `public class V { public static V operator +(V a, V b) => a; }`,
  },
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
    const file = path.join(ROOT, "script", "m14", "tmp", `csdeep-${c.name.split(" ")[0]}.cs`)
    fs.writeFileSync(file, c.src + "\n")
    const tree = parser.parse(c.src + "\n")
    const res: any = await ASTEngine.parseFile(file, c.src + "\n")
    console.log(`\n=== ${c.name}`)
    console.log(`   parse errors: ${tree.rootNode.hasError ? "YES" : "none"}`)
    if (c.src.includes("using") || c.name.startsWith("A")) {
      for (const im of res.imports ?? []) console.log(`   import  module=${JSON.stringify(im.module)}`)
    }
    for (const s of res.symbols ?? []) {
      console.log(`   symbol  ${s.kind.padEnd(11)} name=${JSON.stringify(s.name)} owner=${s.ownerName ?? "-"}`)
    }
    for (const r of res.relationships ?? []) {
      const t = r.type ?? r.relationshipType
      if (t === "contains" || t === "references" || t === "extends" || t === "implements" || t === "instantiates") {
        console.log(`   edge    ${String(r.source)} -[${t}]-> ${JSON.stringify(r.target)}`)
      }
    }
  }
}

if (import.meta.main) await main()
