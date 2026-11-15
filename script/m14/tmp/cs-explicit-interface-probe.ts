// The one shape the unscanned-shape census reported for csharp:
//   method_declaration > explicit_interface_specifier  ("IVsProjectFlavorCfg.get_CfgType", real corpus)
// The analyzer never names `explicit_interface_specifier`, so this measures what it publishes for the
// construct today — symbols AND edges — and what the same member looks like when the interface is
// implemented IMPLICITLY (the control: if the implicit form publishes nothing either, this is a lane
// convention rather than a shape-specific gap).
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()
const SNIPPET = `
namespace Probe
{
    public interface IThing { string GetName(); int Count { get; } }

    public class Implicit : IThing
    {
        public string GetName() => "x";
        public int Count => 1;
    }

    public class Explicit : IThing
    {
        string IThing.GetName() => "x";
        int IThing.Count => 1;
    }
}
`

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const tmp = path.join(ROOT, "script/m14/tmp/fixtures-probe/explicit-iface.cs")
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  fs.writeFileSync(tmp, SNIPPET)
  const res: any = await ASTEngine.parseFile(tmp, SNIPPET)
  console.log("symbols:")
  for (const s of res.symbols) console.log(`  kind=${s.kind} name=${JSON.stringify(s.name)} owner=${s.ownerName ?? "-"} ret=${s.returnType ?? s.metadata?.type ?? "-"}`)
  console.log("relationships:")
  for (const r of res.relationships) console.log(`  ${String(r.type).padEnd(13)} ${String(r.source).padEnd(16)} -> ${r.target}`)
  fs.rmSync(tmp)

  // The real corpus site, so the synthetic case cannot be called unrepresentative.
  const real = "/home/ishaq2321/bb_tests/repositories/fsharp/vsintegration/src/FSharp.ProjectSystem.Base/ProjectConfig.cs"
  const src = fs.readFileSync(real, "utf8")
  const r2: any = await ASTEngine.parseFile(real, src)
  const hits = (r2.symbols ?? []).filter((s: any) => /CfgType|BuildableProjectCfg|IVsProjectFlavorCfg/.test(String(s.name)))
  console.log(`\nREAL FILE ${path.basename(real)} — symbols naming get_CfgType / the interface:`)
  for (const h of hits.slice(0, 12)) console.log(`  kind=${h.kind} name=${h.name} owner=${h.ownerName ?? "-"}`)
  const edges = (r2.relationships ?? []).filter((r: any) => /CfgType|IVsProjectFlavorCfg/.test(String(r.target) + String(r.source)))
  console.log(`REAL FILE — edges mentioning them (${edges.length}):`)
  for (const e of edges.slice(0, 12)) console.log(`  ${e.type} ${e.source} -> ${e.target}`)
}
main()
