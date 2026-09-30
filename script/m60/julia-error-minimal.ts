// script/m60/julia-error-minimal.ts — for each file Julia accepts and tree-sitter rejects, the
// SMALLEST failing span. That is where the defect is; the FIRST error is not.
//
// WHY "FIRST" IS THE WRONG PLACE TO LOOK
// --------------------------------------
// The first version of this reported the first ERROR node's start line, and 121 of the 185
// defect files pointed at **line 1** — because when a construct wrecks a region, the ERROR node
// tree-sitter builds often starts at the top of the file and spans most of it. So the "first
// error" was a statement about where the WRECKAGE BEGAN, and clustering on it produced 15
// clusters of which 9 were the Julia licence header. A tool that localises a defect to the line
// before the licence comment has not localised it at all.
//
// The SMALLEST ERROR node is the opposite and is the right one: it is the tightest piece of
// source the grammar could not read, which is usually exactly the construct, and it is short
// enough to paste into a minimal probe. The corpus differential established THAT there are 185
// such files; this establishes WHAT is in them, and it is the step between "185 files fail" and
// a grammar patch that fixes a named construct rather than a guess.
//
// Method, and its one bias, stated: for each defect file, every ERROR node is collected, the
// smallest by byte span wins, and its text is normalised (identifiers to X, literals to S/N) so
// near-identical shapes cluster. The bias is that a construct which wrecks a LARGE region hides
// every smaller error inside it, so a file whose only damage is one file-wide span still yields
// a large span here. That is why the counts are reported per cluster and not treated as a
// per-construct incidence.
//
// Usage: bun run script/m60/julia-error-minimal.ts [--top=N]
// Writes: validation/m60/results/julia-error-minimal.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { loadWebTreeSitter } from "../../src/util/wasm"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT = path.join(ROOT, "validation/m60/results/julia-error-minimal.json")
const CORPUS_ROOT = path.join("$HOME/fixtures/repositories", "julia")
const DIFF = path.join(ROOT, "validation/m12/results/julia-differential.json")
const arg = (f: string, d: number) => { const a = process.argv.find((x) => x.startsWith(`--${f}=`)); return a ? Number(a.slice(f.length + 3)) : d }
const argTop = arg("top", 18)

/** The Julia licence header, which is where a file-wide error span STARTS and is not a defect. */
const LICENCE = /This file is a part of Julia|part of Julia and is licensed|License is MIT/

function normalise(text: string): string {
  let t = text.replace(/"""[\s\S]*?"""/g, 'TRIPLE').replace(/r"[^"]*"/g, 'RAW').replace(/"[^"]*"/g, "S")
  t = t.replace(/`[^`]*`/g, "CMD").replace(/'[^']*'/g, "CHR")
  t = t.replace(/0x[0-9a-fA-F]+|\b\d+\b/g, "N")
  t = t.replace(/[A-Za-z_][\w!]*/g, "X")
  t = t.replace(/[ \t]+/g, " ").replace(/\n+/g, " ⏎ ").trim()
  return t.slice(0, 120)
}

async function main() {
  await ASTEngine.getParser("objective-c")
  const mod = await loadWebTreeSitter()
  const parser = new mod.Parser()
  parser.setLanguage(await mod.Language.load(path.join(ROOT, "wasm/tree-sitter-julia.wasm")))

  const diff = JSON.parse(readFileSync(DIFF, "utf8"))
  const defectFiles: string[] = (diff.defectClass ?? []).map((r: any) => r.file)
  if (!defectFiles.length) {
    console.error("no defect files in the differential artifact — run script/m12/julia-differential.ts first")
    process.exit(2)
  }

  const rows: any[] = []
  const clusters = new Map<string, { n: number; files: string[]; examples: string[]; spans: number[] }>()
  let licenceHeaderOnly = 0, noFile = 0

  for (const f of defectFiles) {
    const abs = path.join(CORPUS_ROOT, f)
    if (!fs.existsSync(abs)) { noFile++; continue }
    const src = readFileSync(abs, "utf8")
    const tree = parser.parse(src)
    const errs: { s: number; e: number; row: number; text: string }[] = []
    const st: any[] = [tree.rootNode]
    while (st.length) {
      const n = st.pop()!
      if (n.type === "ERROR") {
        const text = src.slice(n.startIndex, n.endIndex)
        errs.push({ s: n.startIndex, e: n.endIndex, row: n.startPosition.row, text })
      }
      for (let i = n.childCount - 1; i >= 0; i--) st.push(n.child(i))
    }
    if (!errs.length) continue
    errs.sort((a, b) => (a.e - a.s) - (b.e - b.s))
    const smallest = errs[0]!
    // A file-wide span whose text is the licence header is a wreck that starts at line 1, and
    // the smallest error IS the header only when the header is genuinely what failed — which it
    // is not. Recorded as such rather than clustered as a construct.
    const isLicenceOnly = LICENCE.test(smallest.text) && smallest.text.trim().split("\n").filter((l) => l.trim()).length <= 3
    if (isLicenceOnly) { licenceHeaderOnly++; continue }
    // The smallest span is often ONE token, and "one token" does not name a construct: `,` is a
    // comma, and a comma is not a defect. So the cluster key carries ±24 characters of SURROUNDING
    // context, which is what turns "a comma failed" into "a comma failed after a `where` clause".
    // The first version keyed on the span alone and produced 15 clusters led by 9 copies of the
    // licence header, because line 1 is where a file-wide wreck begins.
    const ctxStart = Math.max(0, smallest.s - 24)
    const ctxEnd = Math.min(src.length, smallest.e + 24)
    const withCtx = src.slice(ctxStart, ctxEnd)
    const norm = normalise(withCtx)
    if (!clusters.has(norm)) clusters.set(norm, { n: 0, files: [], examples: [], spans: [] })
    const c = clusters.get(norm)!
    c.n++; c.files.push(f); c.spans.push(smallest.e - smallest.s)
    if (c.examples.length < 3) {
      const line = withCtx.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? ""
      c.examples.push(`${f}:${smallest.row + 1}  …${line.slice(0, 120)}…`)
    }
    rows.push({ file: f, errorNodes: errs.length, smallestSpanBytes: smallest.e - smallest.s, smallestLine: smallest.row + 1, smallestText: smallest.text.slice(0, 200), shape: norm })
  }

  const shapeRows = [...clusters.entries()].map(([shape, c]) => ({
    shape, files: c.n,
    medianSpanBytes: c.spans.sort((a: any, b: any) => a - b)[Math.floor(c.spans.length / 2)],
    examples: c.examples,
  })).sort((a, b) => b.files - a.files)

  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    rule: "the SMALLEST failing span per defect file, clustered",
    generatedAt: new Date().toISOString(),
    method:
      "for every file the differential found Julia accepts and tree-sitter rejects, collect all ERROR nodes and keep the " +
      "smallest by byte span; normalise it (identifiers to X, literals to S/N) and cluster. The FIRST error is the wrong " +
      "thing to localise on: when a construct wrecks a region the ERROR node often starts at the top of the file, so 121 of " +
      "185 defect files pointed at line 1 and clustering produced 15 clusters of which 9 were the Julia licence header.",
    bias: "a construct that wrecks a LARGE region hides every smaller error inside it, so a file whose only damage is one file-wide span still yields a large span here. Cluster counts are therefore per-shape incidences, not per-construct prevalence.",
    defectFiles: defectFiles.length,
    resolved: rows.length,
    licenceHeaderOnly,
    missingOnDisk: noFile,
    distinctShapes: shapeRows.length,
    top: argTop,
    shapes: shapeRows,
    rows: rows.sort((a, b) => b.files - a.files ? 0 : a.smallestSpanBytes - b.smallestSpanBytes),
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")

  console.log(`defect files ${defectFiles.length}   resolved ${rows.length}   licence-header-only ${licenceHeaderOnly}   missing ${noFile}`)
  console.log(`distinct shapes: ${shapeRows.length}\n`)
  for (const s of shapeRows.slice(0, argTop)) {
    console.log(`--- ${s.files} file(s)  median span ${s.medianSpanBytes}B ---`)
    for (const e of s.examples) console.log(`    ${e}`)
  }
  console.log(`\n-> ${path.relative(ROOT, OUT)}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
