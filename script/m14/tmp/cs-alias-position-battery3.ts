// C2a battery 4: the DECLARED-TYPE positions, each written twice (plain vs single-segment alias).
// The declared-type graph publishes for the plain form everywhere; the question is whether the
// alias form is published too. A position that publishes for the plain form and stays silent for
// the alias form loses a real dependency, which is a worse failure than a wrong spelling.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const SNIPPET = `
using global::System;

namespace Probe
{
    public class Root { }
    public class Gen<T> { }

    [PlainAttrib]
    public class PlainAttributed { }

    [global::Probe.AliasAttrib]
    public class AliasAttributed { }

    public class PlainAttrib : System.Attribute { }
    public class AliasAttrib : System.Attribute { }

    public class Twins
    {
        public Root RetPlain() { return null; }
        public global::Root RetAlias() { return null; }

        public void ParamsPlain(Root r) { }
        public void ParamsAlias(global::Root r) { }

        public Root PropPlain { get; set; }
        public global::Root PropAlias { get; set; }

        public Root IndexPlain(int i) => null;
        public global::Root IndexAlias(int i) => null;

        public event System.EventHandler EvPlain;
        public event global::System.EventHandler EvAlias;

        public void Locals()
        {
            Root plain = null;
            global::Root alias = null;
            Gen<Root> genPlain = null;
            Gen<global::Root> genAlias = null;
        }

        public void Catches()
        {
            try { } catch (Root e) { }
            try { } catch (global::Root e) { }
        }

        public void Constraints<T>()
            where T : Root { }
        public void ConstraintsAlias<T2>()
            where T2 : global::Root { }
    }
}
`

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const tmp = path.join(ROOT, "script/m14/tmp/fixtures-probe/alias-declared.cs")
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  fs.writeFileSync(tmp, SNIPPET)
  const res: any = await ASTEngine.parseFile(tmp, SNIPPET)
  const lines = SNIPPET.split("\n")
  const rows = (res.relationships ?? []).map((r: any) => `${String(r.type).padEnd(13)} ${String(r.source ?? "").padEnd(22)} -> ${String(r.target).padEnd(20)} [${(lines[(r.line_number ?? 1) - 1] ?? "").trim().slice(0, 62)}]`)
  console.log(`relationships: ${rows.length}`)
  for (const r of rows) console.log("  " + r)
  console.log(`\nstill carrying "::": ${(res.relationships ?? []).filter((r: any) => String(r.target).includes("::")).length}`)
  fs.rmSync(tmp)
}
main()
