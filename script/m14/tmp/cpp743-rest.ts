// #743 cpp: what shapes remain in the `expression_statement > MISSING ";"` class
// after the bare-macro-statement rule? Print the offending line for each, so the
// next lever is chosen from evidence (a call-shaped macro vs a bare identifier).
//   bun script/m14/tmp/cpp743-rest.ts [--wasm <path>] [repo ...]
import fs from "node:fs"
import path from "node:path"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const WASM = process.argv.includes("--wasm") ? process.argv[process.argv.indexOf("--wasm") + 1] : "wasm/tree-sitter-cpp.wasm"
const REPOS = process.argv.slice(2).filter((a, i, arr) => a !== "--wasm" && arr[i - 1] !== "--wasm")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(WASM))
const MAX = 400
const rows: Array<{ key: string; text: string; file: string; line: number; shape: string }> = []
for (const repo of (REPOS.length ? REPOS : ["fmt", "nlohmann-json"])) {
  const parser = new P()
  parser.setLanguage(lang)
  const repoDir = path.join(CORPUS, repo)
  const files: string[] = []
  const collect = (dir: string) => {
    if (files.length >= MAX) return
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (files.length >= MAX) return
      const p = path.join(dir, e.name)
      if (e.isDirectory()) collect(p)
      else if (/\.(cpp|cc|cxx|hpp|hh|h)$/.test(e.name)) files.push(p)
    }
  }
  collect(repoDir)
  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    const lines = src.split("\n")
    const st: any[] = [parser.parse(src).rootNode]
    while (st.length) {
      const n = st.pop()!
      // the MISSING ";" is a child of the expression_statement that lacks it
      if (n.type === "expression_statement") {
        let missing = false
        for (let i = 0; i < n.childCount; i++) { const ch = n.child(i); if (ch?.isMissing) missing = true }
        if (missing) {
          const first = n.child(0)
          const shape = first ? first.type : "(empty)"
          rows.push({
            key: shape,
            text: (lines[n.startPosition.row] ?? "").trim().slice(0, 90),
            file: path.relative(CORPUS, f),
            line: n.startPosition.row + 1,
            shape,
          })
        }
      }
      for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    }
  }
}
const byShape = new Map<string, number>()
for (const r of rows) byShape.set(r.shape, (byShape.get(r.shape) ?? 0) + 1)
console.log(`remaining expression_statement>MISSING ";": ${rows.length} site(s)`)
console.log(`shapes: ${[...byShape.entries()].sort((a, b) => b[1] - a[1]).map(([s, c]) => `${s}×${c}`).join(", ")}`)
for (const r of rows.slice(0, 45)) console.log(`  ${r.shape.padEnd(22)} ${r.file}:${r.line}  ${r.text}`)
