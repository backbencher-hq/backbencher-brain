// #905 focused probe on the issue's own site (scala3 Promise.scala):
//   (1) the refused edge Transformation.submitWithValue -> DefaultPromise.submitWithValue
//       must be GONE from truth (its base member is `private final def`);
//   (2) the file's other override truth must survive (the filter is not over-broad);
//   (3) the analyzer's own edges for this file must agree with the new truth.
// Compares against a pre-fix copy of the oracle (git show HEAD:...) so both
// sides of the change are measured, not asserted.
import fs from "node:fs"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILE = "<corpus-root>/bb_tests/repositories/scala3/library/src/scala/concurrent/impl/Promise.scala"
const diff: any = await import(path.join(ROOT, "script/m14/differential.ts"))
const pre: any = await import("/tmp/differential-prefix905.ts")
const ws: any = await import("web-tree-sitter")
const P: any = ws.Parser ?? ws.default ?? ws
const L: any = ws.Language ?? ws.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-scala.wasm")))
const parser = new P()
parser.setLanguage(lang)

const content = fs.readFileSync(FILE, "utf8")
const root = parser.parse(content).rootNode
const key = (e: any) => `${e.from} -> ${e.target}`
const after = new Set<string>(diff.deriveTreeEdges(root, "scala").filter((e: any) => e.label === "overrides").map(key))
const before = new Set<string>(pre.deriveTreeEdges(root, "scala").filter((e: any) => e.label === "overrides").map(key))
console.log(`overrides truth: before=${before.size} after=${after.size}`)
const removed = [...before].filter((x) => !after.has(x))
const added = [...after].filter((x) => !before.has(x))
console.log(`removed by the privacy filter (${removed.length}):\n  ${removed.sort().join("\n  ")}`)
console.log(`newly added (${added.length}): ${added.join(", ")}`)

const refused = [...before].includes("Transformation.submitWithValue -> DefaultPromise.submitWithValue")
console.log(`\n#905 refused edge present BEFORE: ${refused ? "yes (the defect)" : "NO — repro does not hold"}`)
console.log(`#905 refused edge present AFTER:  ${[...after].includes("Transformation.submitWithValue -> DefaultPromise.submitWithValue") ? "STILL PRESENT (fix failed)" : "no (fixed)"}`)

const eng: any = await import(path.join(ROOT, "src/ast/engine.ts"))
const res = await eng.ASTEngine.parseFile(FILE, content)
const aSet = new Set<string>((res.relationships ?? [])
  .filter((r: any) => String(r.type).toLowerCase().includes("override"))
  .map((r: any) => `${r.source} -> ${r.target}`))
const missing = [...after].filter((x) => !aSet.has(x))
const unexp = [...aSet].filter((x) => !after.has(x))
console.log(`\nanalyzer overrides=${aSet.size}`)
console.log(`MISSING(truth not in analyzer)=${missing.length} ${missing.join(", ")}`)
console.log(`UNEXPLAINED(analyzer not in truth)=${unexp.length} ${unexp.join(", ")}`)
