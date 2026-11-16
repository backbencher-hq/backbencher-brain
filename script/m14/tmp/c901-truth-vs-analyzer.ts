import { readFileSync } from "node:fs"
import { parseFile } from "../../../src/ast/pool-worker"
import { deriveCCalls } from "../differential"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P(); parser.setLanguage(lang)
const F = "<corpus-root>/bb_tests/repositories/jq/src/parser.c"
const src = readFileSync(F, "utf8")
const root = parser.parse(src).rootNode
const truth = deriveCCalls(root, src).filter((e: any) => e.target === "YY_INITIAL_VALUE" || e.target === "YYDPRINTF")
console.log("TRUTH rows:", truth.map((e: any) => `${e.label} ${e.from} -> ${e.target}`).join(" | ") || "(none)")
const r: any = await parseFile(F, "<corpus-root>/bb_tests/repositories/jq")
const mine = (r.relationships ?? []).filter((x: any) => String(x.target) === "YY_INITIAL_VALUE" || String(x.target) === "YYDPRINTF")
console.log("ANALYZER rows:", mine.map((x: any) => `${x.type} ${x.source} -> ${x.target}`).join(" | ") || "(none)")
