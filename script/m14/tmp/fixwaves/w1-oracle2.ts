// Oracle uses derivation — spawn-isolated to dodge the wasm crash.
import { spawnSync } from "child_process"
const script = `
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const js = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
const mod: any = await import("<corpus-root>/mcp/backbencher-brain/script/m14/differential.ts")
const src = \`const config = { inner: { deeper: { leaf: 1 } } };\nfunction read() {\n  return config.inner.deeper.leaf;\n}\nfunction bare() {\n  return config;\n}\n\`
const p2 = new P(); p2.setLanguage(js)
const edges = mod.deriveTreeEdges(p2.parse(src).rootNode, "javascript")
for (const e of edges.filter((x) => x.label === "uses")) console.log("ORACLE_USES " + JSON.stringify(e))
`
const r = spawnSync("bun", ["-e", script], { cwd: "<corpus-root>/mcp/backbencher-brain", encoding: "utf8", timeout: 60000 })
console.log(r.stdout)
if (r.stderr) console.error("STDERR:", r.stderr.slice(0, 400))
