/**
 * SCSS PARSE HEALTH — the measurement that bounds every other number this lane reports.
 *
 * ## Why this exists
 *
 * The firing sweep reads `scss 5/10 fired, 510 edges, 120/120 files, DEGRADED`, and the
 * obvious reading is that the analyzer is thin. The reading is wrong. The corpus sample
 * is dominated by framework stylesheets that interpolate into custom properties:
 *
 *     // bootstrap/scss/_accordion.scss, L7 — valid SCSS
 *     --#{$prefix}accordion-color: #{$accordion-color};
 *
 * and the PINNED `wasm/tree-sitter-scss.wasm` cannot read that line. Measured on that
 * one file: `rootNode.hasError === true`, 456 error nodes, 1104 root children, and
 * `analyze()` returns **0 relationships from 2 symbols**.
 *
 * So an edge count on this lane is a count of what survived a parse, and the honest
 * question is not "how many edges does the analyzer emit" but "how much of the language
 * does the pinned grammar reach". This file answers that, and it separates three
 * different quantities that all read as "the same number" in a firing sweep:
 *
 *   FILES CLEAN      the grammar produced a tree with no error at all
 *   CONSTRUCTS IN ERROR  the construct EXISTS in the source but the grammar put it
 *                     inside an ERROR subtree, so it is only reachable by recovery
 *   CONSTRUCTS CLEAN  the grammar modelled it properly
 *
 * The middle row is the one that decides whether a type is EMITTED or merely
 * recoverable: `@extend` is the live case — 99 `extend_statement` nodes against 676
 * `@extend` tokens, i.e. 85% of the tokens sit in `block > ERROR > "@extend"` where the
 * statement's own node type never appears. An analyzer that reads only clean nodes
 * emits 0 `extends` and looks correct; one that recovers gets 414 of them.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import * as wts from "web-tree-sitter"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SAMPLE = Number(process.argv[2] ?? 400)

const WSP: any = (wts as any).Parser ?? (wts as any).default
const WSL: any = (wts as any).Language ?? (wts as any).default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-scss.wasm"))))

const SCSS_ONLY = [
  "mixin_statement", "function_statement", "include_statement",
  "use_statement", "forward_statement", "extend_statement",
  "each_statement", "for_statement", "while_statement", "if_statement",
  "at_root_statement", "return_statement",
]

const all: string[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) all.push(path.join(dir, rel))
}
const admitted: string[] = []
for (const abs of all) {
  let text: string
  try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
  if (detectLanguageFromPath(abs, text) !== "scss") continue
  admitted.push(abs)
}
admitted.sort()
const step = Math.max(1, Math.floor(admitted.length / SAMPLE))
const sample = admitted.filter((_, i) => i % step === 0).slice(0, SAMPLE)

let clean = 0
let dirty = 0
let parseFail = 0
let totalErrNodes = 0
const cleanCt = new Map<string, number>()
const errCt = new Map<string, number>()
const errParentCt = new Map<string, number>()
const worst: string[] = []

for (const abs of sample) {
  let text: string
  try { text = readFileSync(abs, "utf8") } catch { parseFail++; continue }
  const t = parser.parse(text)
  if (!t) { parseFail++; continue }
  const root = t.rootNode
  if (root.hasError) dirty++
  else clean++

  let errs = 0
  const visit = (n: any, inError: boolean): void => {
    const isErr = n.type === "ERROR" || n.isMissing === true
    if (isErr) errs++
    if (SCSS_ONLY.includes(n.type)) {
      const bucket = inError || isErr ? errCt : cleanCt
      bucket.set(n.type, (bucket.get(n.type) ?? 0) + 1)
      if (inError || isErr) {
        // What the statement's parent actually IS when the grammar lost it. This is the
        // shape the @extend recovery has to read: `block > ERROR > "@extend", …`.
        const key = `${n.type} under ${n.parent?.type ?? "?"}`
        errParentCt.set(key, (errParentCt.get(key) ?? 0) + 1)
      }
    }
    const next = inError || isErr
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) visit(c, next) }
  }
  visit(root, false)
  totalErrNodes += errs
  if (root.hasError) worst.push(`${errs}\t${path.relative(CR, abs)}`)
  t.delete?.()
}

console.log(`scss parse health — pinned wasm/tree-sitter-scss.wasm`)
console.log(`admitted ${admitted.length}; sampled ${sample.length} (every ${step}th); parse failures ${parseFail}\n`)
console.log(`files with a CLEAN tree  ${clean} / ${sample.length}  (${((clean / sample.length) * 100).toFixed(1)}%)`)
console.log(`files with >=1 ERROR     ${dirty} / ${sample.length}  (${((dirty / sample.length) * 100).toFixed(1)}%)`)
console.log(`ERROR nodes total        ${totalErrNodes.toLocaleString()}\n`)

console.log(`${"node type".padEnd(22)}${"clean".padStart(9)}${"in ERROR".padStart(10)}${"% recoverable".padStart(15)}`)
console.log("-".repeat(56))
for (const k of SCSS_ONLY) {
  const c = cleanCt.get(k) ?? 0
  const e = errCt.get(k) ?? 0
  const tot = c + e
  const pct = tot === 0 ? "-" : `${(((e / tot) * 100)).toFixed(1)}%`
  console.log(`${k.padEnd(22)}${String(c).padStart(9)}${String(e).padStart(10)}${pct.padStart(15)}`)
}
console.log(`\nshape of the recovered nodes (parent actually present):`)
for (const [k, v] of [...errParentCt].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`)
console.log(`\nworst 12 files by ERROR-node count:`)
for (const line of worst.sort((a, b) => Number(b.split("\t")[0]) - Number(a.split("\t")[0])).slice(0, 12)) console.log(`  ${line}`)
