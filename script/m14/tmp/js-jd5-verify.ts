// JD5 verification — a shorthand METHOD in a CJS export object reaches the
// module's public surface. (2026-09-26)
import * as WTS from "web-tree-sitter"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-javascript.wasm")
  const p = new P(); p.setLanguage(lang)
  const a = new RealJavaScriptAnalyzer() as any
  let fail = 0
  const check = async (label: string, src: string, expect: string[]) => {
    const r = await a.analyze(p.parse(src).rootNode, src, "T.js", undefined)
    const got = (r.exports ?? []).map((e: any) => e.name)
    const rels = (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "exports").map((x: any) => x.target)
    const ok = JSON.stringify(got) === JSON.stringify(expect)
    if (!ok) fail++
    console.log(`   ${ok ? "ok  " : "FAIL"} ${label.padEnd(44)} exports=${JSON.stringify(got)} edges=${JSON.stringify(rels)}`)
  }

  console.log("=== the reported gap: shorthand methods ===")
  await check("module.exports = { run(){} }", `module.exports = { run(){ helper() } };`, ["run"])
  await check("exports = { run(){} } (rebind)", `exports = { run(){} };`, ["run"])
  await check("mixed method + pair + shorthand",
    `module.exports = { run(){ helper() }, plain: 1, ref };`, ["run", "plain", "ref"])
  await check("getter/setter in the CJS object",
    `module.exports = { get val(){ return 1 }, set val(v){}, data(){} };`, ["val", "data"])

  console.log("\n=== no regression: the pre-existing fixture shapes ===")
  await check("commonjs-module shape", `class Widget {}\nmodule.exports = { Widget };`, ["Widget"])
  await check("exports-rebind shape", `exports = { alpha: 1, beta: 2 };`, ["alpha", "beta"])
  await check("deep-cjs-exports shapes",
    `module.exports.tag = 1\nmodule.exports.sub = { a: 1 }\nexports.direct = 2`, ["tag", "sub", "direct"])
  await check("CJS export of a class expression", `module.exports = class {};`, ["default"])

  console.log("\n=== declined, not guessed (no fabricated names) ===")
  await check("computed key", `module.exports = { [dyn]: 1, run(){} };`, ["run"])
  await check("object spread", `const base = {}\nmodule.exports = { ...base, run(){} };`, ["run"])
  await check("async method", `module.exports = { async load(){}, *gen(){} };`, ["load", "gen"])
  await check("async arrow property", `module.exports = { load: async () => {} };`, ["load"])

  console.log(`\n${fail === 0 ? "ALL PASS" : fail + " FAILED"}`)
  if (fail > 0) process.exitCode = 1
}
main().catch((e) => { console.error(e); process.exit(1) })
