// #743 cpp A/B census: per-file ERROR/MISSING counts with a CHOSEN wasm, so two
// grammars can be compared file by file (the F10 gate only reports lane totals;
// a wave needs to know WHICH files moved, and in which direction).
//   bun script/m14/tmp/cpp743-census.ts <wasm> <out.json> [repo ...] [--ext c|cpp]
import fs from "node:fs"
import path from "node:path"

const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const EXT_CPP = /\.(cpp|cc|cxx|hpp|hh|h)$/
const EXT_C = /\.(c|h)$/
const extArg = process.argv.includes("--ext") ? process.argv[process.argv.indexOf("--ext") + 1] : "cpp"
const FILE_RE = extArg === "c" ? EXT_C : EXT_CPP
const wasmPath = process.argv[2]
const outPath = process.argv[3]
const repos = process.argv.slice(4).filter((a, i, arr) => a !== "--ext" && arr[i - 1] !== "--ext" && a !== "c" && a !== "cpp")
if (!wasmPath || !outPath) {
  console.error("usage: cpp743-census.ts <wasm> <out.json> [repo ...]")
  process.exit(2)
}

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(wasmPath))
const parser = new P()
parser.setLanguage(lang)

const MAX = 400
const out: Record<string, any> = {}
for (const repo of repos) {
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
      else if (FILE_RE.test(e.name)) files.push(p)
    }
  }
  collect(repoDir)
  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    const root = parser.parse(src).rootNode
    let errorSites = 0
    let missingSites = 0
    let errorLines = 0
    const st: any[] = [root]
    while (st.length) {
      const n = st.pop()!
      if (n.isError || n.type === "ERROR") {
        errorSites++
        errorLines += n.endPosition.row - n.startPosition.row + 1
      }
      for (let i = 0; i < n.childCount; i++) {
        const ch = n.child(i)
        if (ch?.isMissing) missingSites++
        st.push(ch)
      }
    }
    const rel = path.relative(CORPUS, f)
    if (errorSites || missingSites) out[rel] = { errorSites, missingSites, errorLines }
  }
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 0))
const files = Object.keys(out).length
const sites = Object.values(out).reduce((a: number, v: any) => a + v.errorSites, 0)
const missing = Object.values(out).reduce((a: number, v: any) => a + v.missingSites, 0)
console.log(`${path.basename(wasmPath)}: ${files} damaged file(s), errorSites=${sites}, missingSites=${missing}`)
