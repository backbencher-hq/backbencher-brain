// #841 round 14 follow-up: rank construct families among the GENUINE gaps
// (oracle-accepted files) only. Same signature logic as
// script/m59/probe-groovy-error-constructs.ts, no new instrument.
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
  return s.slice(0, 120)
}

const census = JSON.parse(fs.readFileSync(CENSUS, "utf8"))
const oracle = JSON.parse(fs.readFileSync(ORACLE, "utf8"))
const accepted = new Set<string>(oracle.acceptedFiles)
const rejected = new Set<string>(oracle.rejectedFiles)
const files: string[] = census.errorFileList.map((f: any) => f.file)

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-groovy.wasm"))
const parser = new P()
parser.setLanguage(lang)

const bySig = new Map<string, { sig: string; kind: string; files: string[] }>()
let wrapperOnly = 0
for (const rel of files) {
  const abs = path.join(REPO, rel)
  if (!fs.existsSync(abs)) continue
  if (!accepted.has(rel)) continue
  const src = fs.readFileSync(abs, "utf8")
  const lines = src.split("\n")
  const root = parser.parse(src).rootNode
  const hits: Array<{ kind: string; row: number; len: number }> = []
  const walk = (n: any): void => {
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) {
      hits.push({ kind: n.isMissing ? `MISSING(${n.type})` : "ERROR", row: n.startPosition.row + 1, len: n.endIndex - n.startIndex })
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
  const isWrapper = (h: { row: number; len: number }) => h.row === 1 && h.len >= src.length * 0.9
  const specific = hits.filter((h) => !isWrapper(h)).sort((a, b) => a.row - b.row)
  if (specific.length === 0) { wrapperOnly++; continue }
  const first = specific[0]
  const sig = normalize(lines[first.row - 1] ?? "")
  const key = `${first.kind} :: ${sig}`
  const row = bySig.get(key) ?? { sig, kind: first.kind, files: [] }
  row.files.push(rel)
  bySig.set(key, row)
}

const rows = [...bySig.values()].sort((a, b) => b.files.length - a.files.length)
console.log(`oracle-accepted files in census: ${files.filter((f) => accepted.has(f)).length}`)
console.log(`of those, no specific (non-wrapper) ERROR: ${wrapperOnly}`)
console.log(`distinct signatures: ${rows.length}\n`)
for (const r of rows.slice(0, 20)) {
  console.log(`${String(r.files.length).padStart(3)}  ${r.kind} :: ${r.sig}`)
  for (const f of r.files.slice(0, 2)) console.log(`        ${f}`)
}
console.log(`\nrejected (policy) files in census: ${files.filter((f) => rejected.has(f)).length}`)
