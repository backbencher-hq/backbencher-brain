/**
 * SCSS — for every `@extend`, which node carries the target, is that name nameable, and is
 * a nameable referent reachable inside it?
 *
 * ## The finding this measures
 *
 * `scss-other-bucket.ts` measured 81 unresolved `OTHER` targets / 100 edges, 99 of them
 * `extends`, of the shape `"%block; background-color: cv.getVar"`. `scss-tree-dump.ts`
 * attributed them to one condition in `real-scss-analyzer.ts`:
 *
 *     // :1074
 *     if (sel.type === "placeholder" && !isReadablePlaceholder(name)) return undefined
 *
 * `findDescendant` (:339) is BREADTH-first, so on
 *
 *     extend_statement [2283,2358]  "@extend %skeleton-pulsation; height: cv.getVar(...)"
 *       ERROR         [2291,2334]   "%skeleton-pulsation; height: cv.getVar("
 *         class_selector [2291,2333]  "%skeleton-pulsation; height: cv.getVar"
 *           placeholder   [2291,2310]  "%skeleton-pulsation"      <- the real referent
 *
 * it returns the `class_selector` at step 4, not the `placeholder` at step 5, and the guard
 * is keyed on the node TYPE, so it does not fire.
 *
 * ## Why the question is "is a referent reachable", not "is the text trimmable"
 *
 * The obvious repair is to cut the name at the first `;`. `scss-other-bucket.ts` measured
 * that counterfactual and it recovers 6 of 81 (7%), and those 6 are already emitted as
 * clean targets — so trimming DUPLICATES rather than recovers. The alternative is to keep
 * walking and take the narrowest node inside the bad one whose text IS a readable
 * placeholder. That is only sound if such a node exists, so this instrument counts it:
 * `recoverable` is the number of statements for which a nameable referent exists, and it
 * is the number the fix can actually act on. If it were 0, the honest repair would be to
 * SUPPRESS the edge.
 *
 * READ-ONLY. Writes nothing.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/scss/scss-extend-node-shape.ts [fileCount]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import type { Node } from "web-tree-sitter"

const COUNT = Number(process.argv[2] ?? 600)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const files = execFileSync("bash", ["-lc", `find ${CR} -name '*.scss' -type f | sort | head -${COUNT}`], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .trim()
  .split("\n")
  .filter(Boolean)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-scss.wasm"))))

/** the predicate extendedSelectorName uses, verbatim from :1063 */
const isTargetNode = (n: Node) =>
  n.type === "class_selector" || n.type === "id_selector" || n.type === "plain_value" || n.type === "placeholder"

/** isReadablePlaceholder, verbatim from :145 */
function isReadablePlaceholder(name: string): boolean {
  if (name.length < 2) return false
  if (name.charCodeAt(0) !== 37 /* % */) return false
  const wc = (c: number) => (c === 95 || c === 45 || (c >= 48 && c <= 57) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90))
  if (!wc(name.charCodeAt(name.length - 1))) return false
  for (let i = 1; i < name.length - 1; i++) {
    const code = name.charCodeAt(i)
    if (code === 45 || wc(code)) continue
    return false
  }
  return true
}

/**
 * A target is usable when it is a selector: no statement/block delimiter anywhere.
 *
 * A CSS selector cannot contain `;`, `{` or `}` — those separate declarations and blocks.
 * One spelling: the first draft of this file also carried an `unnameable` that folded in a
 * whitespace test, which is a different property (a selector may contain a space) and made
 * the two predicates disagree on nothing the corpus exercises. Deleted rather than left
 * behind a `void`.
 */
const hasDelimiter = (t: string) => /[;{}]/.test(t)

function walk(n: Node, fn: (n: Node) => void): void {
  fn(n)
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c) walk(c, fn)
  }
}

/** the exact BFS findDescendant performs, so the number is the number the analyzer sees */
function bfsFirst(node: Node, pred: (n: Node) => boolean): Node | undefined {
  const queue: Node[] = [node]
  while (queue.length > 0) {
    const n = queue.shift() as Node
    if (pred(n)) return n
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) queue.push(c)
    }
  }
  return undefined
}

/** every node under `node`, in tree order, matching pred */
function allUnder(node: Node, pred: (n: Node) => boolean): Node[] {
  const out: Node[] = []
  walk(node, (n) => {
    if (n !== node && pred(n)) out.push(n)
  })
  return out
}

const collapse = (t: string) => t.replace(/\s+/g, " ").trim()

const firstTypes = new Map<string, number>()
let stmts = 0
let clean = 0
let badName = 0
let badByType = new Map<string, number>()
let recoverable = 0
let notRecoverable = 0
const recoverExamples: string[] = []
const noRecoverExamples: string[] = []
const dupTarget = new Map<string, number>()

for (const f of files) {
  let tree: any
  try {
    tree = parser.parse(readFileSync(f, "utf8"))
  } catch {
    continue
  }
  if (!tree) continue
  walk(tree.rootNode as Node, (n) => {
    // both entry paths into emitExtend: the real node type, and the recovered ERROR
    let entry: Node | undefined
    if (n.type === "extend_statement") entry = n
    else if (n.type.startsWith("ERROR")) {
      let kw = false
      let blocked = false
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c?.type === "@extend") { kw = true; break }
        if (c?.isNamed && c.type !== "comment") { blocked = true; break }
      }
      if (kw && !blocked) entry = n
    }
    if (!entry) return
    stmts++
    const sel = bfsFirst(entry, isTargetNode)
    if (!sel) return
    const name = collapse(String(sel.text ?? ""))
    const type = sel.type
    firstTypes.set(type, (firstTypes.get(type) ?? 0) + 1)
    const usable = !hasDelimiter(name) && name.length > 0
    if (usable && !(type === "placeholder" && !isReadablePlaceholder(name))) {
      clean++
      dupTarget.set(name, (dupTarget.get(name) ?? 0) + 1)
      return
    }
    // UNUSABLE under the current guard, OR usable-looking but rejected by the placeholder guard
    badName++
    badByType.set(type, (badByType.get(type) ?? 0) + 1)
    // is a readable placeholder reachable INSIDE the node the BFS returned?
    const inner = allUnder(sel, (m) => m.type === "placeholder" && isReadablePlaceholder(collapse(String(m.text ?? ""))))
    if (inner.length) {
      recoverable++
      if (recoverExamples.length < 6) recoverExamples.push(`${name}  ->  ${collapse(String(inner[0].text ?? ""))}`)
    } else {
      notRecoverable++
      if (noRecoverExamples.length < 6) noRecoverExamples.push(`${name}  [${type}]`)
    }
  })
  tree.delete?.()
}

console.log(`SCSS — @extend target extraction, by node shape`)
console.log(`population: find *.scss | sort | head -${COUNT}   files ${files.length}`)
console.log(`@extend statements reached (extend_statement + recovered ERROR) ${stmts}`)
console.log(`published under the CURRENT rule ${clean}`)
console.log(`target NOT a nameable selector   ${badName}\n`)
console.log(`node type the BFS returns first:`)
for (const [t, c] of [...firstTypes].sort((a, b) => b[1] - a[1])) console.log(`   ${t.padEnd(20)} ${String(c).padStart(5)}`)
console.log(`\nunusable targets by that node type:`)
for (const [t, c] of [...badByType].sort((a, b) => b[1] - a[1])) console.log(`   ${t.padEnd(20)} ${String(c).padStart(5)}`)
console.log(`\nrecoverable — a readable placeholder exists INSIDE the bad node: ${recoverable}`)
console.log(`not recoverable — no readable placeholder anywhere inside:          ${notRecoverable}`)
console.log(`\nexamples recovered:`)
for (const e of recoverExamples) console.log(`   ${e}`)
console.log(`examples with no referent:`)
for (const e of noRecoverExamples) console.log(`   ${e}`)
console.log(`\nduplicate check — targets the CURRENT rule already publishes:`)
const dups = [...dupTarget].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1])
console.log(`   distinct clean targets ${dupTarget.size}   appearing more than once ${dups.length}`)
for (const [t, c] of dups.slice(0, 8)) console.log(`   ${JSON.stringify(t)} x${c}`)
