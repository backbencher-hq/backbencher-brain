// #841 round 15: rank census files by their INNERMOST (smallest) error node —
// first-error lines are recovery points, the smallest node is the real cause.
import fs from "node:fs"
import path from "node:path"

const REPO = "<corpus-root>/bb_tests/repositories/grails-core"
const CENSUS = "<corpus-root>/mcp/backbencher-brain/validation/m12/results/groovy-corpus-errors.json"
const ORACLE = "<corpus-root>/mcp/backbencher-brain/validation/m59/results/g841-groovy-oracle.json"

function normalize(line: string): string {
  let s = line.trim().replace(/\s+/g, " ")
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, "'S'").replace(/'(?:[^'\\]|\\.)*'/g, "'S'")
  s = s.replace(/\b\d+(\.\d+)?\b/g, "N")
  s = s.replace(/\b[A-Z][A-Za-z0-9_]*\b/g, "T")
  s = s.replace(/\b[a-z_][A-Za-z0-9_]*\b/g, "id")
  return s.slice(0, 110)
}

const census = JSON.parse(fs.readFileSync(CENSUS, "utf8"))
const oracle = JSON.parse(fs.readFileSync(ORACLE, "utf8"))
const accepted = new Set<string>(oracle.acceptedFiles)
const files: string[] = census.errorFileList.map((f: any) => f.file)

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-groovy.wasm"))
const parser = new P()
parser.setLanguage(lang)

const bySig = new Map<string, { sig: string; kind: string; files: string[]; sample: { file: string; row: number; raw: string } }>()
for (const rel of files) {
  const abs = path.join(REPO, rel)
  if (!fs.existsSync(abs) || !accepted.has(rel)) continue
  const src = fs.readFileSync(abs, "utf8")
  const lines = src.split("\n")
  const root = parser.parse(src).rootNode
  let smallest: any = null
  const walk = (n: any): void => {
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) {
      const len = n.endIndex - n.startIndex
      if (!smallest || len < smallest.len) smallest = { len, row: n.startPosition.row + 1, type: n.isMissing ? `MISSING(${n.type})` : "ERROR" }
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
  if (!smallest) continue
  const sig = normalize(lines[smallest.row - 1] ?? "")
  const key = `${smallest.type} :: ${sig}`
  const row = bySig.get(key) ?? { sig, kind: smallest.type, files: [], sample: { file: rel, row: smallest.row, raw: (lines[smallest.row - 1] ?? "").trim().slice(0, 130) } }
  row.files.push(rel)
  bySig.set(key, row)
}

const rows = [...bySig.values()].sort((a, b) => b.files.length - a.files.length)
console.log(`files with an inner error: ${[...bySig.values()].reduce((s, r) => s + r.files.length, 0)}; distinct inner signatures: ${rows.length}\n`)
for (const r of rows.slice(0, 16)) {
  console.log(`[${String(r.files.length).padStart(3)}] ${r.kind} :: ${r.sig}`)
  console.log(`        ${r.sample.file.split("/").slice(-1)[0]}:${r.sample.row}  ${r.sample.raw}`)
}
