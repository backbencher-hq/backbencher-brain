/**
 * VB ERROR-NODE SHAPE CENSUS — what does the grammar actually fail on?
 *
 * ## Why
 *
 * `repro-cases/27-tuple-return-and-literal.vb` and the handover's "tuple return"
 * claim establish ONE defect class. The whole-corpus walk finds 3,900 ERROR nodes in
 * a single 200-file window and files like `SourceMethodSymbol.vb` carrying 545 of
 * them in one file — a count that no single one-token production explains. A count of
 * errors is not a diagnosis. This probe turns the count into a SHAPE census: for
 * every ERROR (or MISSING) node, the triple
 *
 *     (kind, parent node type, the named sibling immediately before it,
 *      the named sibling immediately after it, the MISSING token's type)
 *
 * which is enough to name the production that failed without reading source text.
 * Two errors inside `member_access_expression` between two `identifier`s are one
 * defect seen twice; an error inside a `parameter_list` is another. Grouped by
 * triple and sorted by count, the census says where the grammar's remaining work
 * is, with a number behind each claim — which is the only thing that distinguishes
 * "this construct is missing" from "this construct is malformed and the rest is
 * noise".
 *
 * ## Chunking, and why there is a merge mode
 *
 * A single-process walk of the whole corpus DIES on this machine:
 * `RuntimeError: Out of bounds memory access (evaluating
 * 'C._ts_node_parent_wasm(this.tree[0])')` out of the tree-sitter wasm at roughly
 * file 300. That is the hazard `resumable-walk.ts` records for nim, scss and hcl.
 * So the census is measured in chunks in separate processes and the chunks are
 * SUMMED by this same file (`--merge`), rather than the sample being shrunk and the
 * smaller number reported as though it were the whole. The file-count arithmetic is
 * done by adding the fields, not by parsing the printed text — a merge that
 * re-derived numbers out of its own output would inherit every formatting bug in
 * that output.
 *
 * ## No regex
 *
 * Node types are compared with `===` and the triples are grouped in a `Map` keyed by
 * the five fields. `VB_MATCH` filters on a filename SUFFIX with `endsWith`. Nothing
 * here reads source text, so a comma inside a string literal cannot be counted as a
 * tuple and the word `Class` inside a comment cannot be counted as a declaration.
 *
 * ## Population
 *
 * Derived by walking the corpus directory. The window and its offset are printed with
 * every run, because a census over a slice read as a census over the corpus is the
 * failure this instrument exists to make hard.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const REPO = resolve(import.meta.dir, "../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const DIR = join(CORPUS_ROOT, process.env.VB_CORPUS ?? "roslyn-vb")
const LIMIT = Number(process.env.VB_NFILES ?? 0)
const OFFSET = Number(process.env.VB_OFFSET ?? 0)
const TOP = Number(process.env.VB_TOP ?? 30)
/** Filename SUFFIXES, comma-separated, compared with `endsWith`. A path filter, not
 *  a source-text pattern: it narrows the census to named files so a single
 *  worst-file diagnosis is one command rather than an offset hunt. */
const MATCH = (process.env.VB_MATCH ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0)
/** Filename SUFFIXES to SKIP, compared with `endsWith`. Exists because one file in
 *  this corpus exhausts the tree-sitter wasm heap and takes the process with it —
 *  bisected to `DefaultInterfaceImplementationTests.vb` (311,724 bytes, 11,521
 *  lines): it PARSES, and then every node walk and `node.toString()` on it dies
 *  with "Out of bounds memory access". A skip that is printed with the run is a
 *  measurement decision; a silent skip would be a smaller population wearing the
 *  larger one's numbers. */
const SKIP = (process.env.VB_SKIP ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0)
const JSON_OUT = process.env.VB_JSON ?? ""
const MERGE = (() => {
  const i = process.argv.indexOf("--merge")
  return i >= 0 ? process.argv.slice(i + 1) : []
})()

interface Row {
  parent: string
  before: string
  after: string
  kind: string
  missingType: string
  count: number
  files: string[]
  example: string
  line: number
}
interface Chunk {
  offset: number
  limit: number
  window: number
  population: number
  parsed: number
  failed: number
  rows: Row[]
}

function shapeKey(parent: string, before: string, after: string, kind: string, missingType: string): string {
  return [kind, parent, before, after, missingType].join("")
}

function print(rows: Row[], head: string[]): void {
  const total = rows.reduce((a, r) => a + r.count, 0)
  const fileSet = new Set<string>()
  for (const r of rows) for (const f of r.files) fileSet.add(f)
  const sorted = [...rows].sort((a, b) => b.count - a.count)
  for (const line of head) console.log(line)
  console.log(`ERROR+MISSING nodes ${total} in ${fileSet.size} files   distinct shapes ${rows.length}`)
  console.log("")
  console.log("count | files | kind     | parent                       | named sibling before -> after | missing")
  for (const r of sorted.slice(0, TOP)) {
    console.log(
      `${String(r.count).padStart(6)} | ${String(r.files.length).padStart(5)} | ${r.kind.padEnd(7)} | ${r.parent.padEnd(28)} | ${r.before} -> ${r.after.padEnd(22)} | ${r.missingType}`,
    )
    console.log(`         first seen: ${r.example}:${r.line}`)
  }
  if (sorted.length > TOP) console.log(`\n… ${sorted.length - TOP} further shapes not printed (VB_TOP=${TOP})`)
}

if (MERGE.length > 0) {
  const merged = new Map<string, Row>()
  let parsed = 0
  let failed = 0
  let population = 0
  let window = 0
  const offsets: number[] = []
  for (const p of MERGE) {
    const c: Chunk = JSON.parse(readFileSync(p, "utf8"))
    parsed += c.parsed
    failed += c.failed
    population = c.population
    window += c.window
    offsets.push(c.offset)
    for (const r of c.rows) {
      const k = shapeKey(r.parent, r.before, r.after, r.kind, r.missingType)
      const cur = merged.get(k)
      if (!cur) {
        merged.set(k, { ...r, files: [...r.files] })
        continue
      }
      cur.count += r.count
      // file lists are sets in substance; a chunk cannot repeat a file for one shape,
      // and duplicates across chunks are removed rather than counted twice.
      const seen = new Set(cur.files)
      for (const f of r.files) if (!seen.has(f)) { cur.files.push(f); seen.add(f) }
    }
  }
  offsets.sort((a, b) => a - b)
  let contiguous = true
  for (let i = 1; i < offsets.length; i++) if (offsets[i] <= offsets[i - 1]) contiguous = false
  print(
    [...merged.values()],
    [
      `VB ERROR SHAPE CENSUS — MERGED over ${MERGE.length} chunk artifacts`,
      `population DERIVED (from the chunks): ${population} .vb files under ${DIR}`,
      `chunks cover ${window} files, offsets ${offsets[0]}..${offsets[offsets.length - 1]}, contiguous=${contiguous}`,
      `parsed ${parsed}   failed ${failed}`,
    ],
  )
  process.exit(0)
}

function hasSuffix(s: string, suffix: string): boolean {
  return s.length >= suffix.length && s.lastIndexOf(suffix) === s.length - suffix.length
}

function walk(dir: string, out: string[]): void {
  let ents: import("node:fs").Dirent[]
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) { walk(p, out); continue }
    if (hasSuffix(e.name, ".vb")) {
      try { if (statSync(p).size < 400_000) out.push(p) } catch {}
    }
  }
}

const files: string[] = []
walk(DIR, files)
files.sort()
const matched = MATCH.length > 0 ? files.filter((f) => MATCH.some((m) => f.endsWith(m))) : files
const picked = SKIP.length > 0 ? matched.filter((f) => !SKIP.some((k) => f.endsWith(k))) : matched
const skipped = matched.length - picked.length
const window = LIMIT > 0 ? picked.slice(OFFSET, OFFSET + LIMIT) : picked.slice(OFFSET)

const { getParser } = await import(join(REPO, "src/ast/engine.ts"))
const parser = await getParser("vb")

const rows = new Map<string, Row>()
const errorFiles: Array<{ f: string; n: number }> = []
let parsed = 0
let failed = 0

const rec = (n: any, f: string, tally: { n: number }): void => {
  if (n.type === "ERROR" || n.isMissing) {
    const p = n.parent
    const parentType = p ? p.type : "(root)"
    // the nearest NAMED sibling on each side: the anonymous `.` and `,` between a
    // member and its accessor say nothing about which production failed.
    let before = "(none)"
    let after = "(none)"
    if (p) {
      let seen = false
      for (let i = 0; i < p.childCount; i++) {
        const c = p.child(i)
        if (c.id === n.id) { seen = true; continue }
        if (!seen) { if (c.isNamed) before = c.type }
        else if (c.isNamed) { after = c.type; break }
      }
    }
    const kind = n.isMissing ? "MISSING" : "ERROR"
    const missingType = n.isMissing ? n.type : ""
    const k = shapeKey(parentType, before, after, kind, missingType)
    let row = rows.get(k)
    if (!row) {
      row = {
        parent: parentType, before, after, kind, missingType, count: 0, files: [],
        example: f.slice(DIR.length + 1), line: (n.startPosition?.row ?? 0) + 1,
      }
      rows.set(k, row)
    }
    row.count++
    row.files.push(f)
    tally.n++
  }
  for (let i = 0; i < n.childCount; i++) rec(n.child(i), f, tally)
}

for (const f of window) {
  let tree: any
  try {
    const src = readFileSync(f, "utf8")
    tree = (parser as any).parse(src, f)
  } catch { failed++; continue }
  parsed++
  const tally = { n: 0 }
  rec(tree.rootNode, f, tally)
  if (tally.n > 0) errorFiles.push({ f, n: tally.n })
  // `tree.delete()` is not optional housekeeping here: without it the wasm's node
  // arena grows for the life of the process and this walk dies with
  // "Out of bounds memory access" from `_ts_node_parent_wasm` around file 300.
  try { tree.delete() } catch {}
}

const chunk: Chunk = {
  offset: OFFSET,
  limit: LIMIT,
  window: window.length,
  population: files.length,
  parsed,
  failed,
  rows: [...rows.values()],
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(chunk, null, 1))

print(
  [...rows.values()],
  [
    `population DERIVED: ${files.length} .vb files under ${DIR}`,
    `VB_MATCH: ${MATCH.length > 0 ? MATCH.join(", ") : "(none — whole population)"}`,
    `VB_SKIP:  ${SKIP.length > 0 ? `${SKIP.join(", ")} — ${skipped} file(s) removed from the population` : "(none)"}`,
    `window ${window.length} = offset ${OFFSET} + limit ${LIMIT > 0 ? LIMIT : "(all)"}${window.length < picked.length ? "  — a WINDOW, not the whole population" : ""}`,
    `parsed ${parsed}   failed ${failed}`,
  ],
)

const worst = errorFiles.sort((a, b) => b.n - a.n).slice(0, 10)
console.log("")
console.log("worst files by error count:")
for (const w of worst) console.log(`  ${String(w.n).padStart(5)}  ${w.f.slice(DIR.length + 1)}`)