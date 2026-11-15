// #743 sizing: what fraction of C's real corpora parse without ERROR nodes, and
// how concentrated is the damage? Measures EVERY .c file under the three clones
// (no sampling) so "44.4% on jq" can be read against the lanes C actually claims.
import fs from "node:fs"
import path from "node:path"

const WTS: any = await import("web-tree-sitter")
const P = WTS.Parser ?? WTS.default ?? WTS
const L = WTS.Language ?? WTS.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const ROOT = "/home/ishaq2321/bb_tests/repositories"
const REPOS = ["sqlite", "jq", "zig"]

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".c")) out.push(p)
  }
  return out
}

for (const repo of REPOS) {
  const dir = path.join(ROOT, repo)
  if (!fs.existsSync(dir)) { console.log(`${repo}: (absent)`); continue }
  const files = walk(dir)
  let err = 0
  const errLines: number[] = []
  let bytes = 0
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    bytes += src.length
    const tree = parser.parse(src)
    if (tree.rootNode.hasError) {
      err++
      // how many physical lines does the damage touch?
      let n = 0
      const st: any[] = [tree.rootNode]
      while (st.length) {
        const x = st.pop()!
        if (x.type === "ERROR" || x.isMissing) n += x.endPosition.row - x.startPosition.row + 1
        for (let i = 0; i < x.namedChildCount; i++) st.push(x.namedChild(i))
      }
      errLines.push(n)
    }
  }
  errLines.sort((a, b) => a - b)
  const totalLines = errLines.reduce((a, b) => a + b, 0)
  console.log(
    `${repo}: ${files.length} .c files, ${err} with ERROR nodes (${((err / files.length) * 100).toFixed(1)}%)` +
    ` | damaged lines across those files: ${totalLines}` +
    (errLines.length ? ` (median ${errLines[Math.floor(errLines.length / 2)]}, max ${errLines[errLines.length - 1]})` : "") +
    ` | ${(bytes / 1024 / 1024).toFixed(1)} MB`,
  )
}
