import * as fs from "fs"
import { RealHaskellAnalyzer } from "../../../src/ast/real-haskell-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-haskell.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealHaskellAnalyzer()
  // function-call form (application in a function body) — does calls emit?
  const src = [
    "module M where",
    "",
    "helper :: Int -> Int",
    "helper x = x + 1",
    "",
    "run :: Int -> Int",
    "run n = helper n",
  ].join("\n") + "\n"
  const r: any = az.analyze(parser.parse(src).rootNode, src, "p.hs")
  process.stdout.write("rel: " + JSON.stringify((r.relationships ?? []).map((e: any) => (e.type ?? "?") + ":" + (e.source ?? "?") + "->" + (e.target ?? "?"))) + "\n")
  // line basis: name-on-line-3, body-on-line-4
  const src2 = "module L where\n\ntarget :: Int\ntarget = 1\n"
  const r2: any = az.analyze(parser.parse(src2).rootNode, src2, "p2.hs")
  const tg = (r2.symbols ?? []).find((s: any) => s.name === "target")
  process.stdout.write("target range: " + JSON.stringify(tg?.range) + "\n")
}
main().catch((e) => { console.error(e); process.exit(1) })
