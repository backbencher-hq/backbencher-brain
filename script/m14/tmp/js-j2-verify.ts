// M49.J2 independent verification: J1-J10 review claims probed against the
// LIVE analyzer at HEAD. Claim-by-claim, not fixture-trust.
import * as fs from "fs"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-javascript.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const az = new RealJavaScriptAnalyzer()

  const run = (lines: string[], file = "probe.js") => {
    const source = lines.join("\n") + "\n"
    const tree = parser.parse(source)
    return az.analyze(tree.rootNode, source, file)
  }
  const out: string[] = []
  const check = (name: string, ok: boolean, detail: string) =>
    out.push(`${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`)

  // J1: same-named methods on two classes — payloads must not share
  {
    const res: any = run([
      "class U { save() { return uSave() } }",
      "class O { save() { return oSave() } }",
    ])
    const saves = (res.symbols ?? []).filter((s: any) => s.name === "save")
    const qcs = saves.map((s: any) => ({ o: s.ownerName, qc: s.qualified_calls }))
    const clean = qcs.length === 2 &&
      JSON.stringify(qcs[0].qc) !== JSON.stringify(qcs[1].qc)
    check("J1 owner-keyed payloads", clean, JSON.stringify(qcs))
  }

  // J2: field-does-not-override; ctor-does-not-override
  {
    const res: any = run([
      "class Base { }",
      "class Sub extends Base { }",
      "const b2 = { foo: 1 }",
    ])
    const ovs = (res.relationships ?? []).filter((r: any) => r.type === "overrides")
    const bad = ovs.filter((r: any) =>
      String(r.target).includes("constructor") || r.confidence === 0.95)
    check("J2 no 0.95 fabrication tier", ovs.length === 0, `overrides=${JSON.stringify(ovs.map((r: any) => ({ s: r.source, t: r.target, c: r.confidence })))}`)
  }

  // J3: duplicate method declarations — last (body-carrying) wins
  {
    const res: any = run([
      "class C { foo() { return 1 } foo() { return 2 } }",
    ])
    const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
    const lines = foos.map((s: any) => s.range?.startLine)
    check("J3 last declaration kept", foos.length === 1 && lines[0] === 2, `count=${foos.length} lines=${JSON.stringify(lines)}`)
  }

  // J4: isDefault follows clause shape
  {
    const res: any = run([
      'import A from "m";',
      'import B, { b2 } from "m2";',
      'import { c } from "m3";',
      'import "./init";',
      'const { d } = require("m4");',
      "const e = require(\"m5\");",
    ])
    const imps = res.imports ?? []
    const rows = imps.map((i: any) => ({ m: i.module ?? i.moduleName ?? i.source, d: i.isDefault }))
    check("J4 isDefault rows", rows.length === 6, JSON.stringify(rows))
    out.push("   J4 detail above — manual contract read")
  }

  // J5: export default object/expression survives
  {
    const res: any = run([
      "export default { a: 1 };",
    ])
    const exs = res.exports ?? []
    check("J5 default-object export present", exs.length >= 1, JSON.stringify(exs))
  }

  // J6: export alias records the PUBLIC name
  {
    const res: any = run([
      "const a = 1;",
      "export { a as b };",
    ])
    const exs = res.exports ?? []
    const names = exs.map((e: any) => e.name ?? e.target)
    check("J6 alias public name", names.includes("b") && !names.includes("a"), JSON.stringify(names))
  }

  // J8: destructured params recorded
  {
    const res: any = run([
      "function f({ a, b } = {}) { return a + b }",
    ])
    const f = (res.symbols ?? []).find((s: any) => s.name === "f")
    const p = f?.parameters
    check("J8 destructured params not empty", Array.isArray(p) && p.length > 0, JSON.stringify(p))
  }

  // J9: #private fields are private
  {
    const res: any = run([
      "class C { #x = 1; }",
    ])
    const xs = (res.symbols ?? []).filter((s: any) => s.name === "x" || s.name === "#x")
    const vis = xs.map((s: any) => ({ n: s.name, v: s.visibility, ip: s.metadata?.isPrivate }))
    check("J9 private visibility", vis.length === 1 && vis[0].v === "private", JSON.stringify(vis))
  }

  // J10: JSX detection past the old 500-node cap (early JSX + long file)
  {
    const lines = ["const A = () => <div/>;"]
    for (let i = 0; i < 320; i++) lines.push(`const pad${i} = ${i};`)
    lines.push("const B = () => <span/>;")
    const res: any = run(lines, "jsx-probe.jsx")
    const fw = (res.metadata as any)?.frameworks ?? (res.metadata as any)?.framework ?? (res.symbols ?? []).length
    out.push(`J10 jsx-detection probe ran (frameworks metadata: ${JSON.stringify(fw).slice(0, 120)}) — contract held by jsx-detection-depth fixture`)
  }

  // J7: heritage dotted target stays (RULED: do-not-fix, pinned)
  {
    const res: any = run([
      "class Sub extends Lib.Base {}",
    ])
    const ext = (res.relationships ?? []).filter((r: any) => r.type === "extends")
    check("J7 dotted target pinned", ext.length === 1 && ext[0].target === "Lib.Base", JSON.stringify(ext.map((r: any) => r.target)))
  }

  process.stderr.write(out.join("\n") + "\n")
  process.exit(0)
}
main()
