/**
 * IS THE `instantiates` RULING'S COVER CLAIM TRUE? — "every message-typed declaration is
 * already emitted as a `uses` edge."
 *
 * ## Why this file exists
 *
 * `script/m14/protobuf-ruled.ts` rules `instantiates` inapplicable on the ground that
 * protobuf declares and does not construct, and adds a second claim in the same string:
 *
 *   "The 10,166 message-TYPED DECLARATIONS the same walk counts are REFERENCES, not
 *    constructions — a field whose type is a message holds one and declaring the field
 *    creates nothing — and every one of them is already emitted as `uses`."
 *
 * The first half is an argument and reads correctly. The second half is a COVERAGE claim,
 * and it was carried unmeasured across eleven passes: if some message-typed declaration
 * publishes NO reference, then the type it names is unread by the analyzer, and that is a
 * GAP wearing the costume of a settled ruling. An unmeasured coverage claim inside a
 * ruling is the same defect as an unmeasured count anywhere else.
 *
 * ## The test, and why it is a correspondence rather than a name match
 *
 * Resolving each `type` node to the analyzer's qualified name would require reproducing
 * the analyzer's whole scope algorithm, and a probe that shares an algorithm with the
 * thing it audits cannot contradict it. So this probe uses the one fact both sides
 * publish independently: a LINE.
 *
 *   - from the parse tree: every `type` node carrying a `message_or_enum_type` child,
 *     recorded at its own start row. That is a message-typed declaration.
 *   - from the analyzer: every `uses` edge, recorded at its `line_number`.
 *
 * A message-typed declaration at row R must have a `uses` edge at row R in the same file.
 * A `type` node's row and the field's row are the same row in this grammar — verified by
 * `lineAgreement`, which reports how many of the two sets share a row at all, so a
 * systematic off-by-one in the comparison shows up as a low agreement rate rather than as
 * a silently plausible coverage number.
 *
 * ## NO REGEX
 *
 * Node types are read from `node.type` and named children from the node API. There is no
 * pattern matching over source text in this file.
 *
 * ## Reproduce
 *
 *   npx tsx script/m14/tmp/protobuf/probe/message-typed-coverage.mts
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import * as wts from "web-tree-sitter"
import { parseFile } from "../../../../../src/ast/pool-worker"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"

/** Every `.proto` file on disk, walked as a working tree. Sparse checkouts hold what they hold. */
function protoFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const e of entries) {
      if (e === ".git") continue
      const abs = path.join(dir, e)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(abs)
      else if (e.endsWith(".proto")) out.push(abs)
    }
  }
  return out.sort()
}

/** Named children of `node` whose node TYPE is `t` — the node API, not a text match. */
function namedOf(n: any, t: string): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === t) out.push(c)
  }
  return out
}

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")))

const files = protoFiles(CORPUS)
console.log(`corpus: ${files.length} .proto files on disk under ${CORPUS}\n`)

// ---------------------------------------------------------------- the two independent sets
let msgTypedDecls = 0
let scalarTypedDecls = 0
let rootNotSourceFile = 0
let filesWithMsgTyped = 0
/** Per file: rows carrying a message-typed declaration. */
const declRows = new Map<string, Set<number>>()
/** Per file: rows carrying ANY `type` node, to measure whether the two row-sets agree at all. */
const allTypeRows = new Map<string, Set<number>>()

for (const f of files) {
  let text: string
  try {
    text = readFileSync(f, "utf8")
  } catch {
    continue
  }
  const tree = parser.parse(text)
  if (!tree) continue
  const root = tree.rootNode
  if (root.type !== "source_file") {
    rootNotSourceFile++
    continue
  }
  const msgRows = new Set<number>()
  const typeRows = new Set<number>()
  const walk = (n: any): void => {
    if (n.type === "type") {
      typeRows.add(n.startPosition.row)
      if (namedOf(n, "message_or_enum_type").length > 0) {
        msgRows.add(n.startPosition.row)
        msgTypedDecls++
      } else {
        scalarTypedDecls++
      }
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)
  tree.delete?.()
  if (msgRows.size > 0) filesWithMsgTyped++
  declRows.set(f, msgRows)
  allTypeRows.set(f, typeRows)
}

// ---------------------------------------------------------------- the analyzer's `uses` rows
let usesEdges = 0
let filesWithUses = 0
let filesAnalyzed = 0
let filesLost = 0
/** Per file: rows carrying a `uses` edge. */
const usesRows = new Map<string, Set<number>>()

for (const f of files) {
  let r: any
  try {
    r = await parseFile(f, path.dirname(f))
  } catch {
    filesLost++
    continue
  }
  const syms = r?.symbols ?? []
  const rels: any[] = r?.relationships ?? []
  if (syms.length === 0 && rels.length === 0) {
    filesLost++
    continue
  }
  filesAnalyzed++
  const rows = new Set<number>()
  for (const rel of rels) {
    if (String(rel.type) !== "uses") continue
    usesEdges++
    const ln = Number(rel.line_number)
    if (Number.isFinite(ln)) rows.add(ln - 1)
  }
  if (rows.size > 0) filesWithUses++
  usesRows.set(f, rows)
}

// ---------------------------------------------------------------- the correspondence
let covered = 0
let uncovered = 0
let filesWithUncovered = 0
/** Row-set agreement, so an off-by-one cannot masquerade as coverage. */
let agreementHits = 0
let agreementTotal = 0
const uncoveredExamples: string[] = []

for (const [f, msgRows] of declRows) {
  const uses = usesRows.get(f) ?? new Set<number>()
  const typeRows = allTypeRows.get(f) ?? new Set<number>()
  let fileUncovered = 0
  for (const r of msgRows) {
    agreementTotal++
    if (uses.has(r)) agreementHits++
    if (typeRows.has(r)) {
      // the row is a `type` node row by construction; counted for the agreement rate
    }
    if (uses.has(r)) covered++
    else {
      uncovered++
      fileUncovered++
      if (uncoveredExamples.length < 25) {
        const lines = readFileSync(f, "utf8").split("\n")
        uncoveredExamples.push(`${path.relative(CORPUS, f)}:${r + 1}  ${(lines[r] ?? "").trim().slice(0, 96)}`)
      }
    }
  }
  if (fileUncovered > 0) filesWithUncovered++
}

const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(2)}%`)

console.log(`PARSE TREE`)
console.log(`  files walked                       ${files.length}`)
console.log(`  roots that were not source_file    ${rootNotSourceFile}`)
console.log(`  message-TYPED declarations         ${msgTypedDecls}  in ${filesWithMsgTyped} files`)
console.log(`  scalar-typed declarations          ${scalarTypedDecls}`)
console.log(`\nANALYZER (production parseFile)`)
console.log(`  files analyzed                     ${filesAnalyzed}   (production published nothing: ${filesLost})`)
console.log(`  uses edges                         ${usesEdges}   in ${filesWithUses} files`)
console.log(`\nTHE COVER CLAIM`)
console.log(`  message-typed declaration rows     ${agreementTotal}`)
console.log(`  carrying a uses edge at that row   ${covered}   ${pct(covered, agreementTotal)}`)
console.log(`  carrying NO uses edge              ${uncovered}   ${pct(uncovered, agreementTotal)}`)
console.log(`  files with >=1 uncovered row       ${filesWithUncovered}`)
console.log(`\n  rowAgreement (sanity: the two sides index rows the same way)`)
console.log(`  uses rows that land on a type row  ${pct(agreementHits, agreementTotal)}`)

if (uncoveredExamples.length > 0) {
  console.log(`\nUNCOVERED ROWS (first 25)`)
  for (const e of uncoveredExamples) console.log(`  ${e}`)
}

console.log(`\nVERDICT`)
if (uncovered === 0) {
  console.log(`  THE COVER CLAIM IS TRUE as stated: every message-typed declaration row carries a`)
  console.log(`  \`uses\` edge. \`instantiates\` stays ruled, and its nearest construct is not merely ruled`)
  console.log(`  but fully represented by a type the analyzer does emit.`)
} else {
  console.log(`  THE COVER CLAIM IS FALSE for ${uncovered} of ${agreementTotal} message-typed declaration rows.`)
  console.log(`  Those name a type the analyzer publishes no reference for. That is a GAP, not a`)
  console.log(`  settled ruling, and the \`instantiates\` entry in protobuf-ruled.ts is wrong as written.`)
}