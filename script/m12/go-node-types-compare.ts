// M12.22 Go: shape-safety — every node type string the Go analyzer references
// must exist in the pinned tree-sitter-go grammar's node-types.json. Missing
// types are dead defensive branches (never fire); live types are the ones the
// differential proves fire on real fixtures.
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const ANALYZER = readFileSync("src/ast/real-go-analyzer.ts", "utf8")

// Extract string literals used in node-type comparisons: `.type === "x"`
// (direct or after current/node/child), `inArray([...], node.type)` entries,
// and `child?.type === "x"` forms.
const quoted: string[] = []
const re = /(?:node|current|child|parent|functionNode|typeSpec|fieldDecl|spec|param|method|structNode|typeNode|nameNode|object|field|operand)\.type\s*===?\s*["']([a-z_][a-z0-9_]*)['"]|inArray\s*\(\s*\[([^\]]*)\],/g
let m: RegExpExecArray | null
while ((m = re.exec(ANALYZER)) !== null) {
  if (m[1]) quoted.push(m[1])
  if (m[2]) {
    for (const s of m[2].split(",")) {
      const t = s.trim().replace(/["']/g, "")
      if (/^[a-z_][a-z0-9_]*$/.test(t)) quoted.push(t)
    }
  }
}
const refs = [...new Set(quoted)].sort()

// Load the pinned grammar's node types
const wasmDir = "/tmp"
const nodeTypesCandidates = [
  "/tmp/ts-go-npm/package/src/node-types.json",
  join(process.cwd(), "wasm", "tree-sitter-go", "node-types.json"),
]
let nodeTypes: string[] = []
for (const c of nodeTypesCandidates) {
  try {
    const data = JSON.parse(readFileSync(c, "utf8"))
    nodeTypes = data.map((n: any) => n.type)
    console.log(`loaded node-types from ${c} (${nodeTypes.length} types)`)
    break
  } catch {}
}
if (nodeTypes.length === 0) {
  console.log("no node-types.json found for the pinned grammar — generating from npm grammar.js")
  const grammarSrc = readFileSync("/tmp/ts-go-npm/package/grammar.js", "utf8")
  const named = grammarSrc.match(/[\w_]+:\s*(?:seq|choice|field|token|alias)/g) || []
  nodeTypes = [...new Set(named.map((s) => s.split(":")[0].trim()))]
}

const missing = refs.filter((r) => !nodeTypes.includes(r))
const live = refs.filter((r) => nodeTypes.includes(r))
console.log(`refs=${refs.length} live=${live.length} missing=${missing.length}`)
if (missing.length > 0) {
  console.log("--- missing (dead defensive alternatives) ---")
  for (const r of missing) console.log(`  ${r}`)
}
