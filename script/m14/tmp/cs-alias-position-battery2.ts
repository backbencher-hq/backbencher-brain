// C2a probe battery, part 2: the TYPE-NAME POSITIONS the first battery did not exercise
// correctly or did not exercise at all — a constraint clause on a REAL generic declaration,
// a catch type, a conversion operator target, a plain `using global::A;`, a generic base and
// a generic type ARGUMENT. Each position is written TWICE: plain-qualified and alias-qualified,
// so the expected rule is read off the twin rather than assumed.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const SNIPPET = `
using global::System;
using System.Text;

namespace Probe
{
    public class PlainBase { }
    public class PlainGen<T> { }

    public class C1 : PlainBase { }
    public class C2 : global::Probe.PlainBase { }

    public class G1<T> where T : PlainBase { }
    public class G2<T> where T : global::Probe.PlainBase { }

    public class Conv
    {
        public static implicit operator string(Conv c) { return null; }
        public static implicit operator PlainBase(Conv c) { return null; }
    }
    public class Conv2
    {
        public static implicit operator global::System.String(Conv2 c) { return null; }
        public static implicit operator global::Probe.PlainBase(Conv2 c) { return null; }
    }

    public class Bodies
    {
        public void A() { try { } catch (PlainBase e) { } }
        public void B() { try { } catch (global::Probe.PlainBase e) { } }
        public void C() { var x = new PlainGen<PlainBase>(); }
        public void D() { var x = new global::Probe.PlainGen<global::Probe.PlainBase>(); }
    }
}
`

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const tmp = path.join(ROOT, "script/m14/tmp/fixtures-probe/alias-positions2.cs")
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  fs.writeFileSync(tmp, SNIPPET)
  const res: any = await ASTEngine.parseFile(tmp, SNIPPET)
  const lines = SNIPPET.split("\n")
  const rows = (res.relationships ?? []).map((r: any) => ({
    type: String(r.type), src: String(r.source ?? ""), tgt: String(r.target ?? ""),
    line: (lines[(r.line_number ?? 1) - 1] ?? "").trim().slice(0, 70),
  }))
  console.log(`published relationships: ${rows.length}`)
  const bad = rows.filter((r: any) => r.tgt.includes("::") || r.src.includes("::"))
  console.log(`\n=== STILL CARRYING "::": ${bad.length} ===`)
  for (const r of bad) console.log(`  ${r.type} ${r.src} -> ${r.tgt}   [${r.line}]`)
  const badSyms = (res.symbols ?? []).filter((s: any) => {
    const nm = String(s.name ?? ""), tp = String(s.returnType ?? s.metadata?.type ?? "")
    return nm.includes("::") || tp.includes("::") || JSON.stringify(s.metadata ?? {}).includes("::")
  })
  console.log(`\n=== SYMBOLS still carrying "::": ${badSyms.length} ===`)
  for (const s of badSyms) console.log(`  kind=${s.kind} name=${s.name} ret=${s.returnType ?? s.metadata?.type ?? "-"}`)
  console.log(`\n=== conversion-operator SYMBOL NAMES (the twins) ===`)
  for (const s of res.symbols ?? []) {
    if (/^(implicit|explicit)\b/.test(String(s.name ?? ""))) console.log(`  owner=${s.ownerName} name=${s.name}`)
  }
  console.log(`\n=== all rows whose source is C1/C2/G1/G2/Conv/Conv2/Bodies (the twins) ===`)
  for (const r of rows) {
    if (/^(C1|C2|G1|G2|Conv|Conv2|Bodies|Probe)/.test(r.src)) console.log(`  ${r.type.padEnd(13)} ${r.src.padEnd(14)} -> ${r.tgt.padEnd(28)} [${r.line}]`)
  }
  fs.rmSync(tmp)
}
main()
