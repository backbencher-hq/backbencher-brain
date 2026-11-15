// CS-DEEP-19 — RULED, NOT A DEFECT (2026-09-28). Read this before "fixing" anything here.
//
// The finding this probe was written to chase: `resolveOverrides`' Pass 3 ("first hierarchy
// parent") fires whenever the exact-signature BFS misses, and Pass 3 does not check that the
// parent DECLARES the member — so in principle it can publish `Owner.m -> Base.m` where `Base`
// declares no `m`. Case N5 below is exactly that shape:
//
//   public class C : Unrelated, A { public override string M(int x) => ""; }
//   //                                    Unrelated declares nothing; A declares M()
//
// and it publishes `C.M -> Unrelated.M` — a target naming a member that exists nowhere in the
// file.
//
// BUT N5 IS NOT VALID C#. `C` overrides nothing: C# raises CS0115 ("no suitable method found to
// override") because neither `Unrelated` nor `A` declares `M(int)`. So the probe convicts the
// analyzer only on code that cannot compile.
//
// AND ON CODE THAT COMPILES THE DEFECT IS ABSENT — measured, not argued:
// `script/m14/tmp/cs-deep-20-override-fabrication.ts` over 400 real roslyn files, 642 emitted
// `overrides` edges: **642 (100.0%)** name a member that IS declared in the same file, **0** name
// one that is not.
//
// WHY IT CANNOT BE A DEFECT ON VALID C#, which is the part that makes the measurement a ruling
// rather than a coincidence: C# guarantees an `override` member comes from the BASE CLASS, and
// the base class is by language rule the FIRST base-list entry. So for a single base — and for
// a multi-base list, whose first entry is still the base class — Pass 3's first-parent default
// is not a guess, it is the only possible answer. The remaining cases (N1, N2, N4, N6) resolve
// through Pass 1's BFS and are right: `symbolMap` is keyed TWICE (FQN and `RawName.name(sig)`),
// which is what lets the BFS match a base written unqualified inside a namespace.
//
// DISPOSITION: no analyzer change. The boundary is recorded in
// `docs/analyzers/csharp.md` as "on code that does not compile, `overrides` can
// name a member no declaration provides — measured 0 on 400 real files; the probe uses CS0115
// input". The probe is kept in the tree because a ruling with its measurement and its refuting
// case is stronger than a ruling stated in prose.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const CASES: Array<{ name: string; src: string }> = [
  {
    name: "N1-namespace, SINGLE base declaring the method (Pass 1 would be the only correct answer)",
    src: `namespace Ns {
  public class Base { public virtual string M() => ""; }
  public class Derived : Base { public override string M() => ""; }
}`,
  },
  {
    name: "N2-namespace, base written QUALIFIED (the CSD9/qualified spelling)",
    src: `namespace Ns {
  public class Base { public virtual string M() => ""; }
  public class Derived : Other.Base { public override string M() => ""; }
  namespace Other { public class Base { public virtual string M() => ""; } }
}`,
  },
  {
    name: "N3-NO namespace, single base (the shape where Pass 1 CAN hit)",
    src: `public class Base { public virtual string M() => ""; }
public class Derived : Base { public override string M() => ""; }`,
  },
  {
    name: "N4-namespace, TWO bases where the SECOND declares the method",
    src: `namespace Ns {
  public class Unrelated { }
  public class Base { public virtual string M() => ""; }
  public class Derived : Unrelated, Base { public override string M() => ""; }
}`,
  },
  {
    name: "N5-namespace, OVERLOADS split across two bases",
    src: `namespace Ns {
  public class Unrelated { }
  public class A { public virtual string M() => ""; }
  public class B { public virtual string M(int x) => ""; }
  public class C : Unrelated, A { public override string M(int x) => ""; }
}`,
  },
  {
    name: "N6-namespace, INHERITED override (a grand-parent declares it)",
    src: `namespace Ns {
  public class Root { public virtual string M() => ""; }
  public class Mid : Root { }
  public class Leaf : Mid { public override string M() => ""; }
}`,
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
    const file = path.join(ROOT, "script", "m14", "tmp", `csdeep19-${c.name.split("-")[0]}.cs`)
    fs.writeFileSync(file, c.src + "\n")
    const tree = parser.parse(c.src + "\n")
    const res: any = await ASTEngine.parseFile(file, c.src + "\n")
    const edges = (res.relationships ?? [])
      .filter((r: any) => (r.type ?? r.relationshipType) === "overrides")
      .map((r: any) => `${r.source} -> ${r.target}  (line ${r.line_number})`)
    console.log(`\n=== ${c.name}`)
    console.log(`   parse errors: ${tree.rootNode.hasError ? "YES" : "none"}`)
    console.log(`   overrides: ${edges.length === 0 ? "(none)" : edges.join(" ; ")}`)
  }
}

if (import.meta.main) await main()
