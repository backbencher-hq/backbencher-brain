// M12.17 C++: compare pinned tree-sitter-cpp wasm vs npm 0.23.4 wasm on the
// corpus (zig@738d2be9) — following the CSS/Svelte/C grammar-upgrade precedent.
import { readFileSync, statSync } from "node:fs"
import { execSync } from "node:child_process"

const ROOT = "$HOME/fixtures/repositories/zig"
const NEW_WASM = "/tmp/ts-cpp-npm/package/tree-sitter-cpp.wasm"
const MIN_BYTES = 1024

async function loadParser(wasmPath: string) {
  const { loadWebTreeSitter } = await import("../../src/util/wasm")
  const mod = await loadWebTreeSitter()
  const lang = await mod.Language.load(wasmPath)
  const p = new mod.Parser()
  p.setLanguage(lang)
  return p
}

async function main() {
  const out = execSync("git ls-files '*.cpp' '*.cc' '*.cxx' '*.hpp'", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const files = out.split("\n").filter((f) => f.trim().length > 0)
  const candidates: string[] = []
  for (const f of files) {
    try {
      const st = statSync(`${ROOT}/${f}`)
      if (st.size >= MIN_BYTES) candidates.push(f)
    } catch {}
  }
  const sample = candidates.slice(0, 218)

  const { ASTEngine } = await import("../../src/ast/engine")
  const oldParser = await ASTEngine.getParser("cpp")
  const newParser = await loadParser(NEW_WASM)

  let oldErr = 0, newErr = 0
  const oldOnly: string[] = []
  const newOnly: string[] = []
  const both: string[] = []
  for (const f of sample) {
    const src = readFileSync(`${ROOT}/${f}`, "utf8")
    const o = oldParser.parse(src).rootNode.hasError
    const n = newParser.parse(src).rootNode.hasError
    if (o) oldErr++
    if (n) newErr++
    if (o && !n) oldOnly.push(f)
    else if (!o && n) newOnly.push(f)
    else if (o && n) both.push(f)
  }
  console.log(`sample=${sample.length} oldErr=${oldErr} newErr=${newErr}`)
  console.log(`oldOnly (fixed by new): ${oldOnly.length}`)
  for (const f of oldOnly.slice(0, 25)) console.log(`  FIXED ${f}`)
  console.log(`newOnly (regressed): ${newOnly.length}`)
  for (const f of newOnly.slice(0, 10)) console.log(`  REGRESS ${f}`)
  console.log(`both still error: ${both.length}`)
  for (const f of both.slice(0, 20)) console.log(`  BOTH ${f}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
