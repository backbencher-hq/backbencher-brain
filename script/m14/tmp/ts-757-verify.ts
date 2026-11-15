// #757 + #759 verify-before-fix — live behavior at HEAD.
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(require("fs").readFileSync("wasm/tree-sitter-typescript.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealTypeScriptAnalyzer()
  const run = (src: string, file: string) => az.analyze(parser.parse(src).rootNode, src, file)
  // 1: async expression-bodied arrow (the claim: returnType "void")
  const s1: any = run("const f = async () => 1;\n", "a.ts")
  const f = s1.symbols.find((s: any) => s.name === "f")
  console.log("1 async arrow:  returnType=" + JSON.stringify(f?.returnType) + " isAsync=" + f?.isAsync)
  // 2: CONTROL sync arrow (T3 precedent: number)
  const s2: any = run("const g = () => 1;\n", "a.ts")
  console.log("2 sync arrow:   returnType=" + JSON.stringify(s2.symbols.find((s: any) => s.name === "g")?.returnType))
  // 3: async block-bodied arrow with return
  const s3: any = run("const h = async () => { return \"x\"; };\n", "a.ts")
  console.log("3 async block:  returnType=" + JSON.stringify(s3.symbols.find((s: any) => s.name === "h")?.returnType))
  // 4: bracket-form taint (claim: invisible)
  const s4: any = run("const b = req['body'];\n", "a.ts")
  console.log("4 bracket taint: " + JSON.stringify(s4.symbols.find((s: any) => s.name === "b")?.taintSources))
  // 5: CONTROL dotted taint
  const s5: any = run("const b2 = req.body;\n", "a.ts")
  console.log("5 dotted taint:  " + JSON.stringify(s5.symbols.find((s: any) => s.name === "b2")?.taintSources))
  // 6: CONTROL interface heritage same-name member in plain .ts
  const s6: any = run("interface Readable { subscribe(fn: () => void): void }\ninterface Spring extends Readable { subscribe(fn: () => void): void }\n", "a.ts")
  console.log("6 .ts iface overrides: " + JSON.stringify((s6.relationships ?? []).filter((e: any) => e.type === "overrides").map((e: any) => e.source + "->" + e.target)))
  // 7: #759 claim — same shape inside .d.ts declare module
  const dts = 'declare module "lib" {\n  interface Readable { subscribe(fn: () => void): void }\n  interface Spring extends Readable { subscribe(fn: () => void): void }\n}\n'
  const s7: any = run(dts, "index.d.ts")
  console.log("7 .d.ts iface overrides: " + JSON.stringify((s7.relationships ?? []).filter((e: any) => e.type === "overrides").map((e: any) => e.source + "->" + e.target)))
}
main().catch((e) => { console.error(e); process.exit(1) })
