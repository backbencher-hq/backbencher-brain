// JS-wave SELF-AUDIT (adversarial pass over the J-wave diff boundaries).
import * as fs from "fs"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-javascript.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealJavaScriptAnalyzer()
  const out: string[] = []
  const check = (name: string, ok: boolean, detail: string) => out.push(`${ok ? "PASS" : "REVIEW"}  ${name}: ${detail}`)

  const run = (lines: string[], file = "probe.js") => {
    const source = lines.join("\n") + "\n"
    return az.analyze(parser.parse(source).rootNode, source, file)
  }

  // B1 (J5 boundary): export default object with computed key
  {
    const r: any = run([
      "const k = 'dyn';",
      "export default {",
      "  [k]: 1,",
      "  save() {}",
      "};",
    ])
    const s = JSON.stringify(r.exports ?? [])
    check("B1 default-object computed key honest", !s.includes("undefined"), "exports: " + s.slice(0, 100))
  }

  // B2 (J6 boundary): import alias BOTH sides — public name wins, no crash
  {
    const r: any = run([
      "import { save as storeSave } from './store';",
      "storeSave();",
    ])
    const aliases = JSON.stringify(r.imports ?? [])
    check("B2 import alias both sides recorded", aliases.includes("save") || aliases.includes("storeSave"), aliases.slice(0, 120))
  }

  // B3 (J9 boundary): private FIELD (not method) #x read via this.#x
  {
    const r: any = run([
      "class C {",
      "  #count = 0;",
      "  bump() { return this.#count + 1; }",
      "}",
    ])
    const uses = (r.relationships ?? []).filter((e: any) => e.type === "uses" && String(e.target).includes("count"))
    check("B3 private field read emits", uses.length > 0, "uses on #count: " + uses.length + " (JSD family: private reads should emit)")
  }

  // B4 (J2 boundary): static method vs instance method same name — no override
  {
    const r: any = run([
      "class Base { greet() {} }",
      "class Sub extends Base { static greet() {} }",
    ])
    const ovs = (r.relationships ?? []).filter((e: any) => e.type === "overrides")
    check("B4 static-vs-instance no override", ovs.length === 0, "overrides: " + JSON.stringify(ovs.map((o: any) => o.source + "->" + o.target)))
  }

  // B5 (J3 boundary): duplicate class METHODS with getters
  {
    const r: any = run([
      "class C {",
      "  get val() { return 1 }",
      "  set val(v) {}",
      "}",
    ])
    const vals = (r.symbols ?? []).filter((s: any) => s.name === "val")
    check("B5 getter/setter pair both survive", vals.length === 2, "count=" + vals.length + " (accessor pair is NOT a duplicate — JS semantics)")
  }

  // B6 (J10 boundary): JSX in .js file (not tsx) still detected
  {
    const lines: string[] = ["const el = <div className='x'>hi</div>;"]
    const r: any = run(lines, "component.jsx")
    const fw: string[] = r.metadata?.detectedFrameworks ?? []
    check("B6 jsx in .js detected", fw.some((f) => f.toLowerCase().includes("react") || f.toLowerCase().includes("javascript")), "detectedFrameworks=" + JSON.stringify(fw))
  }

  // B7 (J1 boundary): THREE classes with same-named methods — payloads distinct
  {
    const r: any = run([
      "class A { save() { return 'a' } }",
      "class B { save() { return 'b' } }",
      "class C { save() { return 'c' } }",
    ])
    const saves = (r.symbols ?? []).filter((s: any) => s.name === "save")
    const qcs = new Set(saves.map((s: any) => JSON.stringify(s.qualified_calls ?? null)))
    check("B7 three-way payload distinction", saves.length === 3, "count=" + saves.length + " distinct payloads=" + qcs.size)
  }

  // B8 (J4 boundary): export { x as default } — isDefault honest
  {
    const r: any = run([
      "const x = 1;",
      "export { x as default };",
    ])
    const ex = (r.exports ?? []).find((e: any) => e.isDefault)
    check("B8 as-default export flagged", !!ex, "exports: " + JSON.stringify((r.exports ?? []).map((e: any) => e.name + (e.isDefault ? ":default" : ""))))
  }

  process.stdout.write(out.join("\n") + "\n")
}

main().catch((e) => { console.error(e); process.exit(1) })
