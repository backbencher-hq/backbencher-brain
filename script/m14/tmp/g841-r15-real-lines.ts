// #841 round 15: raw first-error lines + context for the top genuine families.
import fs from "node:fs"
import path from "node:path"

const REPO = "<corpus-root>/bb_tests/repositories/grails-core"
const CENSUS = "<corpus-root>/mcp/backbencher-brain/validation/m12/results/groovy-corpus-errors.json"
const ORACLE = "<corpus-root>/mcp/backbencher-brain/validation/m59/results/g841-groovy-oracle.json"

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

function firstError(src: string): { row: number; len: number; type: string } | null {
  const root = parser.parse(src).rootNode
  const hits: Array<{ row: number; len: number; type: string }> = []
  const walk = (n: any): void => {
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) {
      hits.push({ row: n.startPosition.row + 1, len: n.endIndex - n.startIndex, type: n.isMissing ? `MISSING(${n.type})` : "ERROR" })
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
  const isWrapper = (h: any) => h.row === 1 && h.len >= src.length * 0.9
  const specific = hits.filter((h) => !isWrapper(h)).sort((a, b) => a.row - b.row)
  return specific[0] ?? null
}

const WANT = (process.argv[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const seen = new Set<string>()
for (const rel of files) {
  const abs = path.join(REPO, rel)
  if (!fs.existsSync(abs) || !accepted.has(rel)) continue
  const src = fs.readFileSync(abs, "utf8")
  const h = firstError(src)
  if (!h) continue
  const lines = src.split("\n")
  const sig = (lines[h.row - 1] ?? "").trim()
  const key = sig.replace(/\s+/g, " ").slice(0, 40)
  if (WANT.length && !WANT.some((w) => key.includes(w))) continue
  const shortFile = rel.split("/").slice(-2).join("/")
  console.log(`\n=== ${shortFile}:${h.row}  [${h.type}]`)
  for (let r = Math.max(0, h.row - 4); r < Math.min(lines.length, h.row + 2); r++) {
    console.log(`${r + 1 === h.row ? ">>" : "  "} ${String(r + 1).padStart(4)}  ${lines[r]}`)
  }
  seen.add(key)
  if (seen.size >= 12) break
}
