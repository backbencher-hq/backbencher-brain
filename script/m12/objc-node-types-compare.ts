// M12.19 Objective-C: verify the analyzer's node-type references exist in the
// pinned grammar (shape-safety). Mirrors C/C++/Rust node-types-compare.
import { readFileSync } from "node:fs"

async function main() {
  const { ASTEngine } = await import("../../src/ast/engine")
  await ASTEngine.getParser("objective-c") // init engine + WASI shim first

  const { loadWebTreeSitter } = await import("../../src/util/wasm")
  const mod = await loadWebTreeSitter()
  const lang = await mod.Language.load("$HOME/mcp/backbencher-brain/wasm/tree-sitter-objc.wasm")
  const types = new Set<string>()
  for (let i = 0; i < lang.nodeTypeCount; i++) {
    const t = lang.nodeTypeForId(i)
    if (t) types.add(t)
  }

  const src = readFileSync("src/ast/real-objective-c-analyzer.ts", "utf8")
  const refs = new Set<string>()
  for (const m of src.matchAll(/\.type === "([a-z_]+)"/g)) refs.add(m[1])
  for (const m of src.matchAll(/n\.type === "([a-z_]+)"/g)) refs.add(m[1])

  const missing = [...refs].filter((r) => !types.has(r))
  console.log(`grammar node types: ${types.size}`)
  console.log(`analyzer refs: ${refs.size}`)
  console.log(`missing from grammar: ${missing.length}`)
  for (const m of missing) console.log(`  MISSING ${m}`)
  console.log(`\nall analyzer refs: ${[...refs].sort().join(", ")}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
