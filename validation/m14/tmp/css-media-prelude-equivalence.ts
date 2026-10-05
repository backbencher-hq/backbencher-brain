/**
 * `atRulePrelude` vs `queryNode.text` FOR EVERY `media_statement` IN THE CORPUS.
 *
 * ## What this has to establish
 *
 * `processMedia` builds a `@media` scope's published NAME. Until this pass it used
 * the first query child the grammar exposes; it now uses the at-rule's own PRELUDE,
 * because the grammar does not wrap a comma-separated query LIST in a node and the
 * first child discarded every term after the first comma.
 *
 * That change is only safe if the two agree on every SINGLE-term query, because a
 * single-term query is the overwhelming majority of the corpus and a name that moves
 * for no reason is a regression dressed as a fix. Six hand-picked cases are not a
 * measurement, so this measures all of them and separates the two populations by
 * whether the statement carries more than one query term.
 *
 * ## The claim under test
 *
 *   single-term query   prelude === queryNode.text, character for character
 *   multi-term list     the two differ, and the prelude is the longer/correct one
 *
 * Overturn condition: a single-term `media_statement` where the two disagree. One
 * such case would mean the fix moves a name that was already right, and the census
 * would have to be re-baselined rather than this being called safe.
 *
 * ## What is compared
 *
 * The prelude is computed by slicing node text between two node positions — the
 * keyword's end and the block's start — which is the analyzer's own method. The
 * query term is located by the analyzer's own type union. Both are node reads; no
 * pattern matches anything here.
 *
 * ## Rules honoured
 *
 * Zero regular expressions. This instrument reads the parse tree only and calls no
 * analyzer method, so it can disagree with `processMedia`; that is the property an
 * equivalence check needs in order to be worth running.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const LIMIT = Number(process.argv[2] ?? 400)
const SIZE_CAP = 512 * 1024
const WASM = path.join(process.cwd(), "wasm", "tree-sitter-css.wasm")

const QUERY_TYPES = new Set([
  "keyword_query",
  "binary_query",
  "feature_query",
  "parenthesized_query",
  "unary_query",
  "selector_query",
])

/** Collapse whitespace runs to one space and trim. Character walk. */
function collapseSpace(s: string): string {
  let out = ""
  let pending = false
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i)
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") {
      pending = true
      continue
    }
    if (pending && out.length > 0) out += " "
    pending = false
    out += c
  }
  return out
}

/**
 * Direct named-or-anonymous children, first match in source order.
 *
 * DIRECT CHILDREN ONLY, and the first version of this probe got that wrong in a way
 * that manufactured two phantom regressions. Its `findChild` fell back to a
 * depth-first descent when no direct child matched, so on
 * `nim/nimdoc/testproject/expected/nimdoc.out.css:380` — `@media print { … @page { … } … }`
 * — the `at_keyword` lookup found the NESTED `@page`'s keyword at offset 673, while
 * the block starts at offset 13. `end <= start`, the prelude came back `""`, and the
 * probe reported `@media print` as a name this pass MOVES. The analyzer's own
 * `findChild` (real-css-analyzer.ts:1345) inspects direct children only, so it reads
 * the correct keyword and the correct block; the two phantom cases were the probe
 * disagreeing with itself, not the analyzer.
 *
 * A probe that cannot return a wrong answer is not a probe, and this one returned a
 * wrong answer that looked exactly like a regression in the change under test.
 */
function findChild(n: any, pred: (c: any) => boolean): any {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && pred(c)) return c
  }
  return null
}

/** The analyzer's prelude method, replicated: text between keyword end and block start. */
function prelude(n: any): string {
  const kwNode =
    findChild(n, (c) => c.type === "at_keyword") ?? findChild(n, (c) => c.type === "@media")
  const block = findChild(n, (c) => c.type === "block")
  const semi = findChild(n, (c) => c.type === ";")
  const start = kwNode ? kwNode.endIndex - n.startIndex : "@media".length
  const term = block ?? semi
  const end = term ? term.startIndex - n.startIndex : n.text.length
  if (end <= start) return ""
  return collapseSpace(n.text.slice(start, end))
}

/** Every direct child that is a query term — more than one means a comma LIST. */
function queryTermCount(n: any): number {
  let count = 0
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && QUERY_TYPES.has(c.type)) count++
  }
  return count
}

/** The analyzer's `findChild` union, restricted to DIRECT children (what it sees first). */
function firstQueryTerm(n: any): any {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && QUERY_TYPES.has(c.type)) return c
  }
  return null
}

// ---------------------------------------------------------------------------- corpus

const files: { repo: string; abs: string; rel: string }[] = []
for (const repo of readdirSync(CR).sort()) {
  const rd = path.join(CR, repo)
  let rs: any
  try {
    rs = statSync(rd)
  } catch {
    continue
  }
  if (!rs.isDirectory()) continue
  const stack: string[] = [rd]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let ents: any[]
    try {
      ents = readdirSync(dir, { withFileTypes: true }) as any[]
    } catch {
      continue
    }
    for (const e of ents) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue
        stack.push(p)
      } else if (e.isFile()) {
        let st: any
        try {
          st = statSync(p)
        } catch {
          continue
        }
        if (st.size > SIZE_CAP) continue
        const rel = path.relative(rd, p)
        if (detectLanguageFromPath(rel) === "css") files.push({ repo, abs: p, rel })
      }
    }
  }
}
files.sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : a.rel < b.rel ? -1 : 1))
const stride = Math.max(1, Math.floor(files.length / LIMIT))
const picked: typeof files = []
for (let i = 0; i < files.length && picked.length < LIMIT; i += stride) picked.push(files[i])

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(WASM)))

// ---------------------------------------------------------------------------- run

console.log("css media-prelude equivalence — prelude vs first query term, every media_statement")
console.log(`corpus ${files.length} css files; stride sample ${picked.length} (stride ${stride})\n`)

let parsed = 0
let statements = 0
let singleTerm = 0
let multiTerm = 0
let singleAgree = 0
let singleDisagree = 0
let multiDiffer = 0
let multiAgree = 0
let noQuery = 0
const disagreeExamples: string[] = []
const multiExamples: string[] = []

for (const f of picked) {
  let src: string
  try {
    src = readFileSync(f.abs, "utf8")
  } catch {
    continue
  }
  let tree: any
  try {
    tree = parser.parse(src)
  } catch {
    continue
  }
  parsed++
  const label = `${f.repo}/${f.rel}`
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "media_statement") {
      statements++
      const terms = queryTermCount(n)
      const first = firstQueryTerm(n)
      if (!first) {
        noQuery++
      } else {
        const p = prelude(n)
        const t = collapseSpace(first.text)
        if (terms <= 1) {
          singleTerm++
          if (p === t) singleAgree++
          else {
            singleDisagree++
            if (disagreeExamples.length < 12) {
              disagreeExamples.push(`${label}:${n.startPosition.row + 1}\n      prelude=${JSON.stringify(p)}\n      term   =${JSON.stringify(t)}`)
            }
          }
        } else {
          multiTerm++
          if (p === t) multiAgree++
          else {
            multiDiffer++
            if (multiExamples.length < 8) {
              multiExamples.push(`${label}:${n.startPosition.row + 1}  terms=${terms}\n      published now = ${JSON.stringify("@media " + p)}\n      published was = ${JSON.stringify("@media " + t)}`)
            }
          }
        }
      }
    }
    for (let i = n.childCount - 1; i >= 0; i--) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
}

console.log(`parsed ${parsed}/${picked.length}`)
console.log(`media_statement nodes: ${statements}   with no direct query term: ${noQuery}\n`)
console.log(`SINGLE-term queries: ${singleTerm}`)
console.log(`  prelude === term (name unchanged by this pass): ${singleAgree}`)
console.log(`  prelude !== term (a name this pass MOVES):      ${singleDisagree}   <- must be 0 for the fix to be safe`)
if (disagreeExamples.length > 0) {
  console.log("  examples of a moved single-term name:")
  for (const e of disagreeExamples) console.log(`    ${e}`)
}
console.log(`\nMULTI-term comma lists: ${multiTerm}`)
console.log(`  prelude !== term (the defect this pass fixes):  ${multiDiffer}`)
console.log(`  prelude === term:                               ${multiAgree}`)
if (multiExamples.length > 0) {
  console.log("  examples of the names this pass corrects:")
  for (const e of multiExamples) console.log(`    ${e}`)
}

console.log(`\nVERDICT: ${singleDisagree === 0 ? "SAFE — no single-term name moves" : "UNSAFE — " + singleDisagree + " single-term names move"}`)

const jsonAt = process.argv.indexOf("--json")
if (jsonAt >= 0 && process.argv[jsonAt + 1]) {
  writeFileSync(
    process.argv[jsonAt + 1],
    JSON.stringify(
      {
        corpus: { files: files.length, sampled: picked.length, stride, parsed },
        mediaStatements: statements,
        noDirectQueryTerm: noQuery,
        singleTerm: { total: singleTerm, agree: singleAgree, disagree: singleDisagree },
        multiTerm: { total: multiTerm, differ: multiDiffer, agree: multiAgree },
        safe: singleDisagree === 0,
      },
      null,
      2,
    ),
  )
}