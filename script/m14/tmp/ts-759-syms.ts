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
  const dts = 'declare module "lib" {\n  interface Readable { subscribe(fn: () => void): void }\n  interface Spring extends Readable { subscribe(fn: () => void): void }\n}\n'
  const s: any = az.analyze(parser.parse(dts).rootNode, dts, "index.d.ts")
  console.log("d.ts symbols: " + JSON.stringify(s.symbols.map((x: any) => x.name + ":" + x.kind + ":owner=" + x.ownerName)))
}
main().catch((e) => { console.error(e); process.exit(1) })
