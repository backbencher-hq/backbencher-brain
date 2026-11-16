// Census of the residual c finding: a function whose HEADER is wrapped by a
// function-like macro (`CMPP__EXPORT(int, cmpp_stream)(args){ … }`) parses with
// its body as a `compound_statement` inside an ERROR at file scope, so the
// analyzer never enters a Function scope — the body's reads are attributed to
// `global` and its locals/enum members leak as file-scope symbols.
//
// Run: bun script/m14/tmp/c916-scopeleak-census.ts <repoDir>
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const { parseFile } = await import(path.join(ROOT, "src/ast/engine.ts"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm")))

const repoDir = process.argv[2]
const files = execSync("git ls-files", { cwd: repoDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\n").map((f) => f.trim()).filter((f) => /\.(c|h)$/.test(f)).sort()

let filesWithShape = 0
let bodiesTotal = 0
let globalAttributedReads = 0
const examples: string[] = []
const parser = new P()
parser.setLanguage(lang)
for (const rel of files) {
  const abs = path.join(repoDir, rel)
  const src = readFileSync(abs, "utf8")
  const root = parser.parse(src).rootNode
  // Body-shaped compound_statement whose nearest function_definition ancestor is absent.
  const st: any[] = [root]
  let bodies = 0
  while (st.length) {
    const n = st.pop()
    if (n.type === "compound_statement") {
      let w: any = n.parent
      let inFn = false
      while (w) {
        if (w.type === "function_definition") inFn = true
        w = w.parent
      }
      if (!inFn) {
        bodies++
        if (examples.length < 6 && !examples.some((e) => e.startsWith(rel))) {
          examples.push(`${rel}:${n.startPosition.row + 1}`)
        }
      }
    }
    for (let k = 0; k < n.namedChildCount; k++) st.push(n.namedChild(k))
  }
  if (bodies > 0) {
    filesWithShape++
    bodiesTotal += bodies
    const res: any = await parseFile(abs, src, { language: "c" })
    globalAttributedReads += (res.relationships ?? []).filter(
      (r: any) => r.type === "uses" && r.source === "global",
    ).length
  }
}
console.log(`repo=${path.basename(repoDir)} files=${files.length}`)
console.log(`files with a body outside any function_definition: ${filesWithShape}`)
console.log(`such bodies: ${bodiesTotal}`)
console.log(`analyzer 'uses' edges attributed to source=global in those files: ${globalAttributedReads}`)
console.log(`examples: ${examples.join(", ")}`)
