// M12.16 C: compare node-types between pinned tree-sitter-c wasm and npm
// 0.24.1 wasm; check the analyzer's expected node shapes survive the swap.
import { readFileSync } from "node:fs"

async function main() {
  const { ASTEngine } = await import("../../src/ast/engine")
  await ASTEngine.getParser("c") // init engine + WASI shim first

  const { loadWebTreeSitter } = await import("../../src/util/wasm")
  const mod = await loadWebTreeSitter()
  const oldLang = await mod.Language.load("/tmp/bb-wasm_tree-sitter-c_tree-sitter-c.wasm")
  const newLang = await mod.Language.load("/tmp/ts-c-npm/package/tree-sitter-c.wasm")
  const newTypes = new Set<string>()
  for (let i = 0; i < newLang.nodeTypeCount; i++) {
    const t = newLang.nodeTypeForId(i)
    if (t) newTypes.add(t)
  }

  const oldTypes = new Set<string>()
  for (let i = 0; i < oldLang.nodeTypeCount; i++) {
    const t = oldLang.nodeTypeForId(i)
    if (t) oldTypes.add(t)
  }
  console.log(`old types: ${oldTypes.size}, new types: ${newTypes.size}`)

  const added = [...newTypes].filter((t) => !oldTypes.has(t)).sort()
  const removed = [...oldTypes].filter((t) => !newTypes.has(t)).sort()
  console.log(`\n=== ADDED by new grammar (${added.length}) ===`)
  console.log(added.join(", "))
  console.log(`\n=== REMOVED by new grammar (${removed.length}) ===`)
  console.log(removed.join(", "))

  // Check analyzer node-type usage
  const src = readFileSync("src/ast/real-c-analyzer.ts", "utf8")
  const typeRefs = new Set<string>()
  for (const m of src.matchAll(/node\.type === "([a-z_0-9]+)"/g)) typeRefs.add(m[1])
  for (const m of src.matchAll(/type === "([a-z_0-9]+)"/g)) typeRefs.add(m[1])
  console.log(`\n=== analyzer node-type references (${typeRefs.size}) ===`)
  const missing = [...typeRefs].filter((t) => !newTypes.has(t))
  console.log(`missing in NEW grammar: ${missing.length ? missing.join(", ") : "NONE"}`)
  const missingOld = [...typeRefs].filter((t) => !oldTypes.has(t))
  console.log(`missing in OLD grammar: ${missingOld.length ? missingOld.join(", ") : "NONE"}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
