// C2a battery 5: the remaining SINGLE-SEGMENT alias positions, plain vs qualified twins.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const SNIPPET = `
using System;
using global::System;

namespace Probe
{
    public class Root { }

    [Root]
    public class PlainAttributed { }

    [global::Root]
    public class AliasAttributed { }

    public class Twins
    {
        public Root FieldPlain;
        public global::Root FieldAlias;

        public Root PropPlain { get; set; }
        public global::Root PropAlias { get; set; }

        public event System.EventHandler EvPlain;
        public event global::System.EventHandler EvAlias;

        public void ParamsPlain(Root r) { }
        public void ParamsAlias(global::Root r) { }

        public void Locals() { Root a = null; global::Root b = null; }

        public void Catches() { try { } catch (Root e) { } try { } catch (global::Root e) { } }

        public void Constraints<T>() where T : Root { }
        public void ConstraintsAlias<T2>() where T2 : global::Root { }
    }
}
`

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const tmp = path.join(ROOT, "script/m14/tmp/fixtures-probe/alias-last.cs")
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  fs.writeFileSync(tmp, SNIPPET)
  const res: any = await ASTEngine.parseFile(tmp, SNIPPET)
  const lines = SNIPPET.split("\n")
  console.log("imports:", JSON.stringify((res.imports ?? []).map((i: any) => i.module)))
  for (const r of res.relationships ?? []) {
    console.log(`  ${String(r.type).padEnd(13)} ${String(r.source ?? "").padEnd(18)} -> ${String(r.target).padEnd(20)} [${(lines[(r.line_number ?? 1) - 1] ?? "").trim().slice(0, 58)}]`)
  }
  console.log(`decorators on PlainAttributed / AliasAttributed:`)
  for (const s of res.symbols ?? []) if (/Attributed/.test(s.name)) console.log(`  ${s.name}: ${JSON.stringify(s.decorators ?? [])} meta.annotations=${JSON.stringify(s.metadata?.annotations ?? null)}`)
  fs.rmSync(tmp)
}
main()
