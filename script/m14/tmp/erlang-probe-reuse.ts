// Is the 422-file gap a property of the FILES or of parser REUSE? The parse
// census creates a parser per file and reports 0 crashes; the dual-lens census
// reuses one parser across 4,326 files and 422 come back with no tree. Same
// files, two arms: one reused parser, one fresh parser per file.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const REPO_ROOT = "/home/sano/ishaq/bb_tests/repositories"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const wasm = fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))
  const lang = await L.load(wasm)

  const out: string[] = []
  const skip = new Set(["deps", "_build", "node_modules", ".git"])
  const walk = (cur: string) => {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(cur, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(cur, e.name)
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(p); continue }
      if (e.name.endsWith(".erl")) out.push(p)
    }
  }
  for (const c of ["rebar3", "cowboy", "otp"]) walk(path.join(REPO_ROOT, c))
  out.sort()
  // deterministic stride sample across the whole corpus
  const stride = 1
  const sample = out.filter((_, i) => i % stride === 0)
  const contents = sample.map(f => fs.readFileSync(f, "utf8"))
  console.log(`sample=${sample.length} of ${out.length}`)

  let reusedNull = 0
  const reused = new P()
  reused.setLanguage(lang)
  for (const c of contents) {
    let t: any
    try { t = reused.parse(c) } catch { reusedNull++; continue }
    if (!t) reusedNull++
  }
  console.log(`arm A (ONE reused parser): noTree=${reusedNull}`)

  let freshNull = 0
  const freshFailures: string[] = []
  for (let i = 0; i < contents.length; i++) {
    const p = new P()
    p.setLanguage(lang)
    let t: any
    try { t = p.parse(contents[i]) } catch { freshNull++; freshFailures.push(`THREW ${sample[i]} bytes=${contents[i].length}`); p.delete?.(); continue }
    if (!t) { freshNull++; freshFailures.push(`NULL  ${sample[i]} bytes=${contents[i].length}`) }
    p.delete?.()
  }
  console.log(`arm B (FRESH parser per file): noTree=${freshNull}`)
  for (const f of freshFailures.slice(0, 12)) console.log("  " + f)
  if (freshFailures.length > 12) console.log(`  ... ${freshFailures.length - 12} more`)
}
main()
