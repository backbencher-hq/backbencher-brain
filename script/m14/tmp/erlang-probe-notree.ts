// Why do some corpus files yield no tree at all? The dual-lens census counted
// 4,326 files read but only 3,904 parsed, so 422 never reached either lens.
// This probe reproduces the count and buckets the failures.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const REPO_ROOT = "/home/sano/ishaq/bb_tests/repositories"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))
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
  let read = 0, noTree = 0, threw = 0
  const samples: string[] = []
  const sizes: number[] = []
  for (const f of out) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    read++
    let tree: any
    try { tree = parser.parse(content) } catch { threw++; if (samples.length < 5) samples.push(`THREW  ${f}`); continue }
    if (!tree) {
      noTree++
      sizes.push(content.length)
      if (samples.length < 8) samples.push(`NULL   ${f} bytes=${content.length}`)
    }
  }
  console.log(`read=${read} noTree=${noTree} threw=${threw}`)
  if (sizes.length) {
    sizes.sort((a, b) => a - b)
    console.log(`noTree size: min=${sizes[0]} median=${sizes[sizes.length >> 1]} max=${sizes[sizes.length - 1]}`)
  }
  for (const s of samples) console.log(s)
}
main()
