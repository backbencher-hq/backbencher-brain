/**
 * VB TUPLE-DEFECT BLAST RADIUS — how much of the corpus does the missing
 * tuple-EXPRESSION production actually cost?
 *
 * ## The question
 *
 * `repro-cases/27-tuple-return-and-literal.vb` measures the defect on 24 lines:
 * 5 ERROR nodes and 1 MISSING node. That is a count of a defect, not a measure of
 * its cost, and it says nothing about which of the ten relationship types the
 * damage touches. This walks the corpus and reports four readings:
 *
 *   1. CLEAN%  — files with zero ERROR and zero MISSING. This is the metric
 *      `grammars/_vendored/vbnet/grammar-gate.sh` holds a floor for, so it is the
 *      number a repair has to be judged against. A repair that fixes tuples and
 *      drops clean% is a bad trade, and the gate is what catches it.
 *   2. SHAPE   — parenthesised expressions that CONTAIN a comma token, counted on
 *      the tree. In a correct grammar this is the tuple-literal population; in the
 *      current grammar every one of them is an ERROR, so this is the defect's
 *      corpus count. Counted by scanning children for the anonymous `,` — no text.
 *   3. BLAST   — a tuple expression does not merely fail, it pushes a MISSING node
 *      out to source_file scope (measured on case 27), so the interesting question
 *      is whether the damage stays inside the expression. A MISSING at the file's
 *      own root means the parse of everything after it is suspect, so a tuple
 *      return in the middle of a 2,000-line file can cost every declaration below
 *      it. This probe counts those files, because that is the number that decides
 *      whether the repair is cheap or load-bearing.
 *   4. POSITION — where the tuple literal sits (return / initializer / other),
 *      because `Return (a, b)` and `Dim q = (1, 2)` are the two VB spellings and
 *      they cost different amounts downstream.
 *
 * ## No regex
 *
 * Everything is a node-type test, a parent read, a child scan, and a comma check
 * written as `c.type === ","` — an ANONYMOUS TOKEN compared by equality with a
 * literal, which is grammar vocabulary rather than a pattern over source text.
 *
 * ## Population, and why it is CHUNKED
 *
 * Derived by directory walk and sorted, so the sample is stable across runs; every
 * count prints against it. `VB_NFILES` + `VB_OFFSET` take a window, and the window
 * is printed so a partial run can never be read as a whole-corpus number.
 *
 * The window exists because a single-process walk of the whole corpus DIES on this
 * machine: `RuntimeError: Out of bounds memory access (evaluating
 * 'C._ts_node_parent_wasm(this.tree[0])')` out of the tree-sitter wasm, at roughly
 * file 300. That is the hazard `resumable-walk.ts` records for nim, scss and hcl, and
 * the honest response is the one `vb-differential.ts` already uses — measure in
 * CHUNKS in separate processes and sum, rather than shrink the sample and report the
 * smaller number as though it were the whole.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const REPO = resolve(import.meta.dir, "../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const DIR = join(CORPUS_ROOT, process.env.VB_CORPUS ?? "roslyn-vb")
const LIMIT = Number(process.env.VB_NFILES ?? 0)
const OFFSET = Number(process.env.VB_OFFSET ?? 0)
/** Filename SUFFIXES to SKIP, compared with `endsWith`. One file in this corpus
 *  exhausts the tree-sitter wasm heap and takes the whole process with it —
 *  `DefaultInterfaceImplementationTests.vb`, 311,724 bytes, bisected by index. It
 *  PARSES; every node walk and `node.toString()` on it dies. Printed with the run,
 *  because a skip that is not printed is a smaller population wearing the larger
 *  one's numbers. */
const SKIP = (process.env.VB_SKIP ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0)

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
const matched = files
const usable = SKIP.length > 0 ? matched.filter((f) => !SKIP.some((k) => f.endsWith(k))) : matched
const window = LIMIT > 0 ? usable.slice(OFFSET, OFFSET + LIMIT) : usable.slice(OFFSET)

const { getParser } = await import(join(REPO, "src/ast/engine.ts"))
const parser = await getParser("vb")

/** Does this `(`...`)` node hold a comma between its open and close? That is a tuple literal. */
function hasCommaInside(n: any): boolean {
  let opened = false
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c.type === "(") { opened = true; continue }
    if (c.type === ")") return false
    if (opened && c.type === ",") return true
  }
  return false
}

interface Tally {
  parsed: number
  failed: number
  cleanFiles: number
  errorFiles: number
  errorNodes: number
  missingNodes: number
  rootMissingFiles: number
  parenExprs: number
  tupleLiterals: number
  tupleInReturn: number
  tupleAsInitializer: number
  tupleElsewhere: number
}

const t: Tally = {
  parsed: 0, failed: 0, cleanFiles: 0, errorFiles: 0, errorNodes: 0, missingNodes: 0,
  rootMissingFiles: 0, parenExprs: 0, tupleLiterals: 0, tupleInReturn: 0, tupleAsInitializer: 0, tupleElsewhere: 0,
}
const tupleFiles = new Set<string>()
const errFileSamples: string[] = []

/** Per-file census, walked over EVERY child including anonymous ones: an ERROR
 *  sitting between two named children is still a child, and a walk that stops at
 *  named children would report a clean file. */
const scan = (root: any): { e: number; m: number; rootMiss: number; tuples: number } => {
  const out = { e: 0, m: 0, rootMiss: 0, tuples: 0 }
  const rec = (n: any): void => {
    if (n.type === "ERROR") out.e++
    if (n.isMissing) {
      out.m++
      const p = n.parent
      if (p === null || p === undefined || p.type === "source_file") out.rootMiss++
    }
    if (n.type === "parenthesized_expression") {
      if (hasCommaInside(n)) {
        out.tuples++
        const pt = n.parent?.type ?? "(none)"
        if (pt === "return_statement") t.tupleInReturn++
        else if (pt === "variable_declarator" || pt === "assignment_statement") t.tupleAsInitializer++
        else t.tupleElsewhere++
      }
      t.parenExprs++
    }
    for (let i = 0; i < n.childCount; i++) rec(n.child(i))
  }
  rec(root)
  return out
}

for (const f of window) {
  let tree: any
  try {
    const src = readFileSync(f, "utf8")
    tree = (parser as any).parse(src, f)
  } catch { t.failed++; continue }
  t.parsed++
  const c = scan(tree.rootNode)
  // Not optional housekeeping: without the explicit delete the wasm node arena
  // grows for the life of the process and this walk dies with "Out of bounds
  // memory access" from `_ts_node_parent_wasm` — measured, at roughly file 300
  // and again inside the 1400-1599 window.
  try { tree.delete() } catch {}
  t.errorNodes += c.e
  t.missingNodes += c.m
  t.tupleLiterals += c.tuples
  t.rootMissingFiles += c.rootMiss
  if (c.tuples > 0) tupleFiles.add(f)
  if (c.e === 0 && c.m === 0) t.cleanFiles++
  else {
    t.errorFiles++
    if (errFileSamples.length < 12) errFileSamples.push(`${f.slice(DIR.length + 1)} (E${c.e} M${c.m})`)
  }
}

const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(2)}%`)

console.log(`population DERIVED: ${files.length} .vb files under ${DIR}`)
console.log(`VB_SKIP:  ${SKIP.length > 0 ? `${SKIP.join(", ")} — ${matched.length - usable.length} file(s) removed` : "(none)"}`)
console.log(`window ${window.length} files = offset ${OFFSET} + limit ${LIMIT > 0 ? LIMIT : "(all)"}${window.length < files.length ? "  — a WINDOW, not the whole corpus" : "  — whole population"}`)
console.log(`parsed ${t.parsed}   failed ${t.failed}`)
console.log("")
console.log(`clean files (0 ERROR, 0 MISSING): ${t.cleanFiles}/${t.parsed} = ${pct(t.cleanFiles, t.parsed)}`)
console.log(`error-bearing files:              ${t.errorFiles}/${t.parsed} = ${pct(t.errorFiles, t.parsed)}`)
console.log(`ERROR nodes total:                ${t.errorNodes}`)
console.log(`MISSING nodes total:              ${t.missingNodes}`)
console.log(`files whose parse escapes to source_file scope (a MISSING at the root): ${t.rootMissingFiles}/${t.parsed} = ${pct(t.rootMissingFiles, t.parsed)}`)
console.log("")
console.log(`parenthesized_expression nodes:   ${t.parenExprs}`)
console.log(`  of which contain a comma (tuple literal shape): ${t.tupleLiterals} in ${tupleFiles.size} files`)
console.log(`    as a RETURN expression:   ${t.tupleInReturn}`)
console.log(`    as an initializer:        ${t.tupleAsInitializer}`)
console.log(`    elsewhere:                ${t.tupleElsewhere}`)
console.log("")
console.log(`sample of error-bearing files:`)
for (const s of errFileSamples) console.log(`  ${s}`)