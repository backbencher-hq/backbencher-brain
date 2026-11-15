// #834 web pre-check: TS T7 analog — hook warnings 1-based (fixture expects startLine 4 for source line 4)
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
// Direct question: with a React file, is the helper's warning at 1-based row 4?
// The recert probe showed startLine: 3 for source line 4 — 0-based? That would
// contradict the T7 fix (hook rows 1-based) AND the fixture expectation (4).
// But parseFile may differ from the fixture harness. Check the fixture expectation.
const fx = JSON.parse(fs.readFileSync("validation/m14/fixtures/typescript/hook-react.expectation.json", "utf8"))
console.log("fixture expects:", JSON.stringify(fx.expectErrors ?? fx))
