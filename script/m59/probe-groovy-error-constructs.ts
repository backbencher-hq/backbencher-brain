// M59 / M49 G9 (#841 residual): rank the remaining groovy parse failures by the
// construct that actually fails, not by the census's "first error line".
//
// Why this exists. The m12 census derives `firstErrorLineSignatures` from the
// FIRST ERROR node in document order. When tree-sitter cannot recover, it wraps
// the rest of the file in a single ERROR node that STARTS AT THE FILE START, so
// the reported first-error line is the file's opening line — for 35 of the 370
// failing files that is the license header's `/*`. That signature is an artifact
// of the recovery wrapper, not the construct at fault, and 40 such signatures
// were being read as 40 failure classes. The honest rule, measured here: ignore
// ERROR nodes that span from the file start, and rank by the first ERROR /
// MISSING node that names a position.
//
// Usage: bun script/m59/probe-groovy-error-constructs.ts [--top=N] [--examples=N]
import * as fs from "fs"
import * as path from "path"

const CENSUS = "validation/m12/results/groovy-corpus-errors.json"
const REPO = "$HOME/fixtures/repositories/grails-core"

function argNum(flag: string, dflt: number): number {
  const hit = process.argv.find((a) => a.startsWith(flag))
  return hit ? Number(hit.split("=")[1]) : dflt
}

// Names in a line are replaced so that two occurrences of the same CONSTRUCT
// group together; strings and numbers are collapsed for the same reason.
function normalize(line: string): string {
  let s = line.trim().replace(/\s+/g, " ")
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, "'S'").replace(/'(?:[^'\\]|\\.)*'/g, "'S'")
  s = s.replace(/\b\d+(\.\d+)?\b/g, "N")
  s = s.replace(/\b[A-Z][A-Za-z0-9_]*\b/g, "T") // capitalized -> type-ish
  s = s.replace(/\b[a-z_][A-Za-z0-9_]*\b/g, "id")
  return s.slice(0, 120)
}

async function main(): Promise<void> {
  const top = argNum("--top", 25)
  const examples = argNum("--examples", 3)
  const census = JSON.parse(fs.readFileSync(CENSUS, "utf8"))
  const files: string[] = census.errorFileList.map((f: any) => f.file)

  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P()
  parser.setLanguage(lang)

  type Row = { sig: string; kind: string; files: string[]; wrapperOnly: boolean }
  const bySig = new Map<string, Row>()
  let wrapped = 0
  let noSpecific = 0

  for (const rel of files) {
    const abs = path.join(REPO, rel)
    if (!fs.existsSync(abs)) continue
    const src = fs.readFileSync(abs, "utf8")
    const lines = src.split("\n")
    const root = parser.parse(src).rootNode
    const hits: Array<{ kind: string; row: number; col: number; len: number }> = []
    const walk = (n: any): void => {
      if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) {
        hits.push({
          kind: n.isMissing ? `MISSING(${n.type})` : "ERROR",
          row: n.startPosition.row + 1,
          col: n.startPosition.column + 1,
          len: n.endIndex - n.startIndex,
        })
      }
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    walk(root)
    // The recovery wrapper: an ERROR that consumes the whole file from index 0.
    const isWrapper = (h: { row: number; len: number }) => h.row === 1 && h.len >= src.length * 0.9
    if (hits.some(isWrapper)) wrapped++
    const specific = hits.filter((h) => !isWrapper(h)).sort((a, b) => a.row - b.row || a.col - b.col)
    if (specific.length === 0) {
      noSpecific++
      continue
    }
    const first = specific[0]
    const line = lines[first.row - 1] ?? ""
    const sig = normalize(line)
    const key = `${first.kind} :: ${sig}`
    const row = bySig.get(key) ?? { sig, kind: first.kind, files: [], wrapperOnly: false }
    row.files.push(rel)
    bySig.set(key, row)
  }

  const rows = [...bySig.values()].sort((a, b) => b.files.length - a.files.length)
  console.log(`files in census errorFileList: ${files.length}`)
  console.log(`files whose first ERROR spans from the file start (recovery wrapper): ${wrapped}`)
  console.log(`files with no specific (non-wrapper) ERROR or MISSING node: ${noSpecific}`)
  console.log(`distinct specific-construct signatures: ${rows.length}\n`)
  for (const r of rows.slice(0, top)) {
    console.log(`${String(r.files.length).padStart(4)}  ${r.kind} :: ${r.sig}`)
    for (const f of r.files.slice(0, examples)) console.log(`        ${f}`)
  }
}
main()
