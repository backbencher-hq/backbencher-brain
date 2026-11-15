// C2a battery 3: the SINGLE-SEGMENT alias shape. `global::System.Text.StringBuilder` parses as a
// `qualified_name` wrapping an `alias_qualified_name`, which is why the corpus shapes publish at
// all — but `global::Foo` IS an `alias_qualified_name` with no wrapping qualified name. Every
// position is written twice again (single-segment alias vs the same name unqualified), and the
// question is which of them publish NOTHING.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const SNIPPET = `
using global::System;
using Single = global::Root;
using SingleAlias = Root;

namespace Probe
{
    public class Root { }

    public class PlainBase : Root { }
    public class AliasBase : global::Root { }

    public class Conv
    {
        public static implicit operator Root(Conv c) => null;
        public static implicit operator global::Root(Conv c) => null;
    }

    public class Bodies
    {
        public object PlainNew() => new Root();
        public object AliasNew() => new global::Root();

        public object PlainDeclared() { Root r = new(); return r; }
        public object AliasDeclared() { global::Root r = new(); return r; }

        public Root field1;
        public global::Root field2;
    }
}
`

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const tmp = path.join(ROOT, "script/m14/tmp/fixtures-probe/alias-single.cs")
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  fs.writeFileSync(tmp, SNIPPET)
  const res: any = await ASTEngine.parseFile(tmp, SNIPPET)
  const lines = SNIPPET.split("\n")
  console.log("=== all relationships ===")
  for (const r of res.relationships ?? []) {
    console.log(`  ${String(r.type).padEnd(13)} ${String(r.source ?? "").padEnd(16)} -> ${String(r.target).padEnd(24)} [${(lines[(r.line_number ?? 1) - 1] ?? "").trim().slice(0, 60)}]`)
  }
  console.log("=== symbols ===")
  for (const s of res.symbols ?? []) console.log(`  kind=${s.kind} name=${s.name} owner=${s.ownerName ?? "-"}`)
  fs.rmSync(tmp)
}
main()
