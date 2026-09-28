// M12.19 Objective-C: compare pinned tree-sitter-objc wasm vs npm 3.0.2 wasm
// on the corpus (Clyde@8fec41dd) — CSS/Svelte/C/C++/Rust grammar-upgrade
// precedent.
import { readFileSync, statSync } from "node:fs"
import { execSync } from "node:child_process"

const ROOT = "$HOME/fixtures/repositories/Clyde"
const NEW_WASM = "/tmp/ts-objc-npm/package/tree-sitter-objc.wasm"
const MIN_BYTES = 256

async function loadParser(wasmPath: string) {
  const { loadWebTreeSitter } = await import("../../src/util/wasm")
  const mod = await loadWebTreeSitter()
  const lang = await mod.Language.load(wasmPath)
  const p = new mod.Parser()
  p.setLanguage(lang)
  return p
}

async function main() {
  const out = execSync("git ls-files '*.m' '*.h'", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const files = out.split("\n").filter((f) => f.trim().length > 0)
  const candidates: string[] = []
  for (const f of files) {
    try {
      const st = statSync(`${ROOT}/${f}`)
      if (st.size >= MIN_BYTES) candidates.push(f)
    } catch {}
  }

  const { ASTEngine } = await import("../../src/ast/engine")
  const oldParser = await ASTEngine.getParser("objective-c")
  const newParser = await loadParser(NEW_WASM)

  let oldErr = 0, newErr = 0
  const oldOnly: string[] = []
  const newOnly: string[] = []
  const both: string[] = []
  for (const f of candidates) {
    const src = readFileSync(`${ROOT}/${f}`, "utf8")
    const o = oldParser.parse(src).rootNode.hasError
    const n = newParser.parse(src).rootNode.hasError
    if (o) oldErr++
    if (n) newErr++
    if (o && !n) oldOnly.push(f)
    else if (!o && n) newOnly.push(f)
    else if (o && n) both.push(f)
  }
  console.log(`sample=${candidates.length} oldErr=${oldErr} newErr=${newErr}`)
  console.log(`oldOnly (fixed by new): ${oldOnly.length}`)
  for (const f of oldOnly.slice(0, 20)) console.log(`  FIXED ${f}`)
  console.log(`newOnly (regressed): ${newOnly.length}`)
  for (const f of newOnly.slice(0, 10)) console.log(`  REGRESS ${f}`)
  console.log(`both still error: ${both.length}`)
  for (const f of both.slice(0, 15)) console.log(`  BOTH ${f}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
