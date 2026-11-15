// Deep review probe round 4 — regex-vs-AST + import/export join (2026-09-26)
import * as WTS from "web-tree-sitter"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load("wasm/tree-sitter-javascript.wasm")
  const p = new P(); p.setLanguage(lang)
  const a = new RealJavaScriptAnalyzer() as any
  const run = async (name: string, src: string, checks: (r: any) => void) => {
    const root = p.parse(src).rootNode
    const r = await a.analyze(root, src, "T.js", undefined)
    try { checks(r); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  const rels = (r: any, t: string) => (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === t)
  const exps = (r: any) => (r.exports ?? []).map((e: any) => e.name)

  console.log("=== G1: the deep-CJS-export path is a TEXT micro-parse — computed access breaks it ===")
  await run("G1a module.exports deep chain (documented path)", `module.exports.a.b.c = 1;`, (r) => {
    console.log("   exports=" + JSON.stringify(exps(r)))
  })
  await run("G1b same chain via COMPUTED access", `module["exports"].a.b = 1;`, (r) => {
    console.log("   exports=" + JSON.stringify(exps(r)))
    const n = exps(r)
    if (n.some((x: string) => x.includes("[") || x.includes('"')))
      throw new Error("computed member chain produced a garbage export name: " + JSON.stringify(n))
  })
  await run("G1c exports.a.b via computed", `exports["a"].b = 1;`, (r) => {
    console.log("   exports=" + JSON.stringify(exps(r)))
  })
  await run("G1d optional chain", `module?.exports?.a = 1;`, (r) => {
    console.log("   exports=" + JSON.stringify(exps(r)))
  })

  console.log("=== G2: the same member_expression IS walked structurally at line ~1982 ===")
  await run("G2a deep chain also yields structural field-access uses", `module.exports.a.b.c = 1;`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses").map((x: any) => `${x.source}->${x.target}`)))
    console.log("   (proves the AST path exists for this exact node type)")
  })

  console.log("=== G3: import->export join feasibility (the two pinned conventions) ===")
  await run("G3a exporter of an aliased name", `const alpha = 1;\nexport { alpha as beta };`, (r) => {
    console.log("   exports=" + JSON.stringify(exps(r)) + " rels=" + JSON.stringify(rels(r, "exports").map((x: any) => x.target)))
  })
  await run("G3b importer of the same name", `import { beta } from "./m";`, (r) => {
    console.log("   imports=" + JSON.stringify(rels(r, "imports").map((x: any) => x.target)))
  })
  await run("G3c importer via the LOCAL alias", `import { beta as local } from "./m";`, (r) => {
    console.log("   imports=" + JSON.stringify(rels(r, "imports").map((x: any) => x.target)))
    console.log("   -> exporter offers 'beta', importer asks for 'local'")
  })
  await run("G3d default both ways", `export default class X {}`, (r) => {
    console.log("   exports=" + JSON.stringify(rels(r, "exports").map((x: any) => `${x.target}:${JSON.stringify(x.metadata)}`)))
  })

  console.log("=== G4: import edge line for a default specifier ===")
  await run("G4a wrapped import clause", `import {
  Def,
  named
} from "./m";`, (r) => {
    console.log("   imports=" + JSON.stringify((r.imports ?? []).map((i: any) => i.items)))
    console.log("   rels=" + JSON.stringify(rels(r, "imports").map((x: any) => `${x.target}@${x.line_number}`)))
  })

  console.log("=== G5: module.exports object with a SHORTHAND METHOD is dropped from the surface ===")
  await run("G5a", `module.exports = { run(){ helper() }, plain: 1, [dyn]: 2, ...rest };`, (r) => {
    console.log("   exports=" + JSON.stringify(exps(r)))
    const n = exps(r)
    if (!n.includes("run")) throw new Error("shorthand method dropped from the CJS export surface: " + JSON.stringify(n))
  })
  await run("G5b whole-module rebind with a method", `exports = { run(){} };`, (r) => {
    console.log("   exports=" + JSON.stringify(exps(r)))
  })
}
main().catch((e) => { console.error(e); process.exit(1) })
