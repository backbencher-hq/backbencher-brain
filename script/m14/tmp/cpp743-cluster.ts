// #743 (cpp half): where does the pinned cpp grammar actually fail? Cluster every
// ERROR node in the two cpp corpora by a SIGNATURE of its own first line, so the
// next grammar wave attacks a measured construct instead of a guess. Reports, per
// cluster: files/sites, the ERROR's line count, and a sample site.
//
//   bun script/m14/tmp/cpp743-cluster.ts [--wasm <path>] [repo ...]
import fs from "node:fs"
import path from "node:path"

const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const WASM = process.argv.includes("--wasm")
  ? process.argv[process.argv.indexOf("--wasm") + 1]
  : "wasm/tree-sitter-cpp.wasm"
const REPOS = process.argv.slice(2).filter((a, i, arr) => a !== "--wasm" && arr[i - 1] !== "--wasm")

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(WASM))

const MAX = 400

/** Signature of an ERROR's first line: identifiers kept, literals/punctuation folded. */
function signature(line: string): string {
  let s = line.trim()
  s = s.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "")
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, '"S"').replace(/'(?:[^'\\]|\\.)*'/g, "'C'")
  s = s.replace(/\b\d[\d.]*\b/g, "N")
  s = s.replace(/\b[A-Za-z_]\w*\b/g, (m) => m) // keep identifiers
  s = s.replace(/\s+/g, " ").trim()
  return s.slice(0, 110)
}

const clusters = new Map<string, { files: Set<string>; sites: number; lines: number; sample: string; kinds: Map<string, number> }>()

for (const repo of REPOS) {
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
    const root = parser.parse(src).rootNode
    const rel = path.relative(CORPUS, f)
    const st: any[] = [root]
    while (st.length) {
      const n = st.pop()!
      if (n.isError || (n.type === "ERROR")) {
        const line = src.split("\n")[n.startPosition.row] ?? ""
        const sig = signature(line)
        const key = sig || "(blank)"
        const c = clusters.get(key) ?? { files: new Set<string>(), sites: 0, lines: 0, sample: `${rel}:${n.startPosition.row + 1}`, kinds: new Map<string, number>() }
        c.files.add(rel)
        c.sites++
        c.lines += n.endPosition.row - n.startPosition.row + 1
        const parent = n.parent?.type ?? "(root)"
        c.kinds.set(parent, (c.kinds.get(parent) ?? 0) + 1)
        clusters.set(key, c)
      }
      // MISSING tokens are the other half of "cannot parse" — count them by parent
      for (let i = 0; i < n.childCount; i++) {
        const ch = n.child(i)
        if (ch?.isMissing) {
          const sig = `${n.type} > MISSING ${JSON.stringify(ch.type)}`
          const c = clusters.get(sig) ?? { files: new Set<string>(), sites: 0, lines: 0, sample: `${rel}:${n.startPosition.row + 1}`, kinds: new Map<string, number>() }
          c.files.add(rel); c.sites++; c.lines++
          c.kinds.set(n.type, (c.kinds.get(n.type) ?? 0) + 1)
          clusters.set(sig, c)
        }
        st.push(ch)
      }
    }
  }
}

const rows = [...clusters.entries()].sort((a, b) => b[1].sites - a[1].sites)
const totalSites = rows.reduce((a, [, v]) => a + v.sites, 0)
console.log(`total sites=${totalSites}  clusters=${rows.length}`)
for (const [sig, v] of rows.slice(0, 30)) {
  const kinds = [...v.kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k}×${n}`).join(", ")
  console.log(`${String(v.sites).padStart(5)} sites  ${String(v.files.size).padStart(4)} files  ${String(v.lines).padStart(6)} lines  parents[${kinds}]`)
  console.log(`        ${sig}`)
  console.log(`        eg ${v.sample}`)
}
