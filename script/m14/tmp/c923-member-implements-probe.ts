// #923 — the member-level implements edge: WHAT DOES THE FAMILY ALREADY DO?
//
// The csharp lane publishes no edge between an interface member and its
// implementation, in either the EXPLICIT form (`int IFoo.get_X()`, where the
// interface is written in the source) or the IMPLICIT one. The unscanned-shape
// census reported the same node shape for csharp and noted that "java's
// `Member -> Interface.member` shows the family has the class" — so before
// designing anything, measure what java ACTUALLY emits for the mirror-image
// snippet, and what csharp emits for the same three shapes. The decision is the
// family's; this probe is the input to it.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()

const JAVA = `
package probe;
interface IThing {
    String getName();
    int getCount();
}
abstract class Base { public abstract String label(); }
class Impl extends Base implements IThing {
    public String getName() { return "n"; }
    public int getCount() { return 1; }
    public String label() { return "l"; }
}
`

const CSHARP = `
namespace Probe
{
    public interface IThing { string GetName(); int Count { get; } }
    public abstract class Base { public abstract string Label(); }

    public class Implicit : Base, IThing
    {
        public string GetName() => "n";
        public int Count => 1;
        public override string Label() => "l";
    }

    public class Explicit : IThing
    {
        string IThing.GetName() => "n";
        int IThing.Count => 1;
    }

    public class ExplicitBase : Base
    {
        public override string Label() => "l";
    }
}
`

async function dump(lang: string, snippet: string, file: string) {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const tmp = path.join(ROOT, "script/m14/tmp/fixtures-probe", file)
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  fs.writeFileSync(tmp, snippet)
  const res: any = await ASTEngine.parseFile(tmp, snippet)
  console.log(`\n===== ${lang} (${file}) — ${res.relationships.length} edges, ${res.symbols.length} symbols`)
  const interesting = (res.relationships ?? []).filter((r: any) =>
    ["implements", "extends", "overrides", "contains"].includes(String(r.type)))
  for (const r of interesting) console.log(`  ${String(r.type).padEnd(11)} ${String(r.source).padEnd(22)} -> ${r.target}`)
  const methods = (res.symbols ?? []).filter((s: any) => s.kind === "method")
  console.log("  method symbols:", methods.map((s: any) => `${s.ownerName ?? "?"}.${s.name}${s.isInterface ? " [iface]" : ""}`).join(", "))
  fs.rmSync(tmp)
}

await dump("java", JAVA, "probe-iface.java")
await dump("csharp", CSHARP, "probe-iface.cs")
