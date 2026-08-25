/**
 * #419 — Grammar-derived completeness inventory (java pilot)
 *
 * Mechanically enumerates every named node type in tree-sitter-java,
 * classifies into: DECLARATIONS / TYPES / STATEMENTS / EXPRESSIONS /
 * MODIFIERS-ANNOTATIONS / MISC, then maps each to REQUIRED emission
 * from the spec table.
 *
 * Output: inventory JSON + gap list (spec-required vs analyzer-handled).
 */
import fs from "fs"
import path from "path"

const ROOT = process.cwd()
const WASM = path.join(ROOT, "wasm", "tree-sitter-java.wasm")

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(WASM))
  p2(g)
}

function p2(g: any) {
  const named: string[] = []
  for (let i = 0; i < g.nodeTypeCount; i++) {
    if (!g.nodeTypeIsNamed(i)) continue
    const n = g.nodeTypeForId(i)
    if (n && !n.startsWith("_")) named.push(n)
  }
  console.log(`java grammar: ${named.length} public named node types`)
  fs.writeFileSync(path.join(__dirname, "java-nodetypes.json"), JSON.stringify(named, null, 1))
}
main().catch(e => { console.error(e); process.exit(1) })
