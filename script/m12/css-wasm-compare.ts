// Compare pinned CSS wasm vs npm 0.25.0 wasm on the error corpus
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = "$HOME/fixtures/repositories/svelte/packages/svelte/tests/css/samples"
const NEW_WASM = "/tmp/ts-css-npm/package/tree-sitter-css.wasm"

async function loadParser(wasmPath: string) {
  const { loadWebTreeSitter } = await import("../../src/util/wasm")
  const mod = await loadWebTreeSitter()
  const lang = await mod.Language.load(wasmPath)
  const p = new mod.Parser()
  p.setLanguage(lang)
  return p
}

async function main() {
  const { readdirSync } = await import("node:fs")
  const dirs = readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  const files: { name: string; src: string }[] = []
  for (const dir of dirs) {
    const p = join(ROOT, dir, "expected.css")
    try {
      const src = readFileSync(p, "utf8")
      if (src.trim()) files.push({ name: dir, src })
    } catch {}
  }

  const { ASTEngine } = await import("../../src/ast/engine")
  const oldParser = await ASTEngine.getParser("css")
  const newParser = await loadParser(NEW_WASM)

  let oldErr = 0, newErr = 0
  const oldOnly: string[] = []
  const newOnly: string[] = []
  const both: string[] = []
  for (const f of files) {
    const o = oldParser.parse(f.src).rootNode.hasError
    const n = newParser.parse(f.src).rootNode.hasError
    if (o) oldErr++
    if (n) newErr++
    if (o && !n) oldOnly.push(f.name)
    else if (!o && n) newOnly.push(f.name)
    else if (o && n) both.push(f.name)
  }
  console.log(`files=${files.length} oldErr=${oldErr} newErr=${newErr}`)
  console.log(`oldOnly (fixed by new): ${oldOnly.length}`, oldOnly.slice(0, 30).join(", "))
  console.log(`newOnly (regressed): ${newOnly.length}`, newOnly.slice(0, 10).join(", "))
  console.log(`both still error: ${both.length}`)
  for (const b of both.slice(0, 25)) console.log(`  BOTH ${b}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
