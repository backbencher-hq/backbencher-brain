// What SHOULD `global::A.B` publish as? The answer is whatever the SAME declaration
// publishes when the qualifier is not written — otherwise one type has two spellings
// across a repo, which is the class R10 exists to catch. So measure both forms side by
// side, in the positions the class census found (instantiates 49, extends 2).
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const SNIPPET = [
  "namespace Probe;",
  "public class Qualified",
  "{",
  "  public object A() => new System.Text.StringBuilder();",
  "  public object B() => new global::System.Text.StringBuilder();",
  "}",
  "public class BasePlain : System.Collections.ArrayList { }",
  "public class BaseAlias : global::System.Collections.ArrayList { }",
  "public class BaseNested : Outer.Inner.Deep { }",
  "public class BaseAliasNested : global::Outer.Inner.Deep { }",
].join("\n")

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const tmp = path.join(ROOT, "script/m14/tmp/fixtures-probe/alias-rule.cs")
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  fs.writeFileSync(tmp, SNIPPET)
  const res: any = await ASTEngine.parseFile(tmp, SNIPPET)
  console.log("SIDE BY SIDE (qualified vs alias-qualified):")
  for (const r of res.relationships ?? []) {
    if (["instantiates", "extends", "implements", "references"].includes(String(r.type))) {
      console.log(`  ${String(r.type).padEnd(13)} ${String(r.source).padEnd(14)} -> ${r.target}`)
    }
  }
  fs.rmSync(tmp)

  // A REAL occurrence, so the synthetic case cannot be accused of being unrepresentative:
  // powershell has fully qualified `new A.B(` sites; fsharp has the global:: ones.
  const real = [
    "/home/ishaq2321/bb_tests/repositories/powershell/SysLogProvider.cs",
    "/home/ishaq2321/bb_tests/repositories/fsharp/vsintegration/src/FSharp.UIResources/Strings.Designer.cs",
  ]
  for (const f of real) {
    if (!fs.existsSync(f)) continue
    const src = fs.readFileSync(f, "utf8")
    const r: any = await ASTEngine.parseFile(f, src)
    const hits = (r.relationships ?? []).filter((x: any) => /ResourceManager|LogProvider|new/.test(String(x.target)) || String(x.target).includes("::"))
    console.log(`\nREAL FILE ${path.basename(f)} — instantiates/references targets of interest:`)
    for (const h of hits.slice(0, 8)) console.log(`  ${String(h.type).padEnd(13)} ${String(h.source).padEnd(16)} -> ${h.target}`)
  }
}
main()
