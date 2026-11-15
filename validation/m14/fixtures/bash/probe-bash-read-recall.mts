/**
 * BASH READ RECALL — does every variable READ the grammar produces become a `uses` edge?
 *
 * ## Why this probe exists
 *
 * Every other number in this lane measures edges: how many there are, how they
 * resolve, whether they are labelled correctly. None of them asks the recall
 * question in the read direction — *is there a read the analyzer never turned
 * into an edge?* — because that question cannot be answered from the edge list
 * alone. An absent edge is invisible in a census: the census tallies what
 * arrived, and a construct that contributes nothing arrives as nothing.
 *
 * The project's own sharpest instance of that failure is a construct that read 0
 * for a structural reason (`emitInlineUses` resolving a setext heading's own
 * inline through a direct-child lookup, so every setext heading returned early).
 * Hand-written fixtures did not catch it and a source count could not see it. A
 * population that misses an edge is therefore invisible to every other instrument
 * this lane had, which is why this one exists.
 *
 * The method is the grammar's own: walk the parse tree, find every node that
 * NAMES a variable, and ask whether a `uses` edge naming it was published. A node
 * type that exists in the tree, in a context that is a read, with no edge, is a
 * missed read — and the probe prints the file, the line, the source line and the
 * ancestor path, so each one can be adjudicated by hand rather than counted and
 * forgotten.
 *
 * ## WHAT COUNTS AS A BINDING, AND WHERE THAT LIST COMES FROM
 *
 * `BINDING_CONTEXT` is the analyzer's OWN dispatch, read out of
 * `real-bash-analyzer.ts`: a `variable_assignment` name, a `declaration_command`
 * name, a `function_definition` name and a `for` loop variable each publish a
 * SYMBOL and a `contains` edge, not a `uses` edge, so counting them as missed
 * reads would measure this probe's list rather than the analyzer. `for_statement`
 * is in that list for the loop variable only — the same node also carries the
 * list being iterated, and those names ARE reads. The probe therefore decides by
 * the node's POSITION inside its parent, not by the parent's type alone: on a
 * `for_statement` a `variable_name` that is a direct named child is the loop
 * variable and is excluded, and anything else under it is a read.
 *
 * ## INSTRUMENT
 *
 * Edges: production `parseFile` from `src/ast/pool-worker.ts`. Trees: this probe's
 * OWN `web-tree-sitter` instance over the same pinned `wasm/tree-sitter-bash.wasm`
 * on the same bytes. Two parser handles, one per owner, never shared — the round-8
 * defect was a probe and a gate interleaving ONE handle, so this opens its own and
 * keeps it private. A tree is a pure function of (bytes, wasm), so the two parses
 * cannot disagree about shape, and every NUMBER quoted here is a node count or an
 * edge count, never an analyzer-side derivation.
 *
 * NO REGEX. Contexts are `node.type` and named children via the cursor API.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-read-recall.mts
 *      [--sample 400 | --all] [--examples 24]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const num = (n: string, d: number): number => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? Number(argv[i + 1]) : d
}
const ALL = argv.includes("--all")
const SAMPLE = ALL ? Number.MAX_SAFE_INTEGER : num("sample", 400)
const EXAMPLES = num("examples", 24)

interface F {
  repo: string
  rel: string
  abs: string
  text: string
  hash: string
}
const files: F[] = []
let scanned = 0
const repoNames = new Set<string>()
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    scanned++
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    repoNames.add(e)
    files.push({ repo: e, rel, abs, text, hash: createHash("sha256").update(`${e}/${rel}`).digest("hex") })
  }
}
files.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
const sample = ALL ? files : files.slice(0, SAMPLE)

console.log(
  `bash read-recall probe — production parseFile + private tree handle, ${sample.length} files${ALL ? " (--all)" : ""}`,
)
console.log(`admitted ${files.length} / scanned ${scanned} / repos ${repoNames.size}\n`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const parser = new WSP()
parser.setLanguage(
  await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-bash.wasm"))),
)

/** A `variable_name` directly under one of these publishes a SYMBOL (a binding),
 *  not a `uses` edge. Same list as the analyzer's dispatch. */
const BINDING_PARENT = new Set([
  "variable_assignment",
  "declaration_command",
  "function_definition",
])

/** Positional parameters and shell punctuation. The grammar hands `$1` back as a
 *  `simple_expansion` over a `variable_name`, so these are indistinguishable from
 *  a named read by node type alone; the contract routes `$1..$9` and `$@`/`$*` to
 *  `parameters` and excludes `$0`. Character-code test, no regex. */
const isPositional = (text: string): boolean => {
  if (text.length === 0) return false
  const c = text.charCodeAt(0)
  if (c >= 48 && c <= 57 && text.length === 1) return true
  return text === "@" || text === "*" || text === "#" || text === "?" || text === "!"
}

interface Miss {
  file: string
  line: number
  name: string
  context: string
  path: string
  src: string
}

const ctxRows = new Map<string, { nodes: number; hit: number; miss: number }>()
const misses: Miss[] = []
let totalNodes = 0
let totalHit = 0
let specialSkipped = 0
let bindingSkipped = 0
let positionalSkipped = 0
let degraded = 0
let emptyNames = 0

const bump = (ctx: string, kind: "nodes" | "hit" | "miss"): void => {
  let row = ctxRows.get(ctx)
  if (!row) ctxRows.set(ctx, (row = { nodes: 0, hit: 0, miss: 0 }))
  row[kind]++
}

for (const f of sample) {
  const r: any = await parseFile(f.abs)
  if (r?.fallback) degraded++

  const used = new Set<string>()
  for (const rel of r.relationships ?? []) {
    if (rel.type !== "uses") continue
    used.add(`${String(rel.target)}${rel.line_number}`)
  }

  const lines = f.text.split("\n")
  const tree = parser.parse(f.text)
  const cursor = tree.walk()
  const stack: string[] = []

  const walk = (): void => {
    const node = cursor.currentNode
    // `stack` holds the ancestors from root to this node's PARENT at entry, so the
    // parent is the LAST element. Reading one slot lower is the grandparent, which
    // is how the first version of this probe counted 2,345 assignment LHSes as
    // missed reads and 0 of 557 declared names as anything but missing.
    const parent = stack[stack.length - 1]
    stack.push(node.type)
    try {
      if (node.type === "special_variable_name") {
        // `$?` `$$` `$#` … shell bookkeeping, which the contract does not emit.
        specialSkipped++
      } else if (node.type === "variable_name") {
        const text = node.text
        const isForLoopVar = parent === "for_statement"
        if (text.length === 0) {
          emptyNames++
        } else if (isPositional(text)) {
          // `$1`..`$9` populate `parameters`, which the contract keeps out of `uses`.
          positionalSkipped++
        } else if (BINDING_PARENT.has(parent ?? "") || isForLoopVar) {
          bindingSkipped++
        } else {
          const line = node.startPosition.row + 1
          const context = parent ?? "(root)"
          totalNodes++
          bump(context, "nodes")
          if (used.has(`${text}${line}`)) {
            totalHit++
            bump(context, "hit")
          } else {
            bump(context, "miss")
            misses.push({
              file: `${f.repo}/${f.rel}`,
              line,
              name: text,
              context,
              path: stack
                .slice(0, 6)
                .reverse()
                .join(" > "),
              src: (lines[line - 1] ?? "").trim().slice(0, 110),
            })
          }
        }
      }
      if (cursor.gotoFirstChild()) {
        do {
          walk()
        } while (cursor.gotoNextSibling())
        cursor.gotoParent()
      }
    } finally {
      stack.pop()
    }
  }
  walk()
  tree.delete()
}

const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(2)}%`)

console.log(`files sampled            : ${sample.length}`)
console.log(`degraded parses          : ${degraded}`)
console.log(`empty variable_name text : ${emptyNames}`)
console.log(`special_variable_name    : ${specialSkipped}  (contract: not emitted)`)
console.log(`binding sites skipped    : ${bindingSkipped}  (publish a symbol, not a uses edge)`)
console.log(`positional params skipped: ${positionalSkipped}  (route to parameters, not uses)`)
console.log(`\ncandidate READ nodes    : ${totalNodes}`)
console.log(`  became a uses edge    : ${totalHit}  (${pct(totalHit, totalNodes)} recall)`)
console.log(`  published nothing      : ${misses.length}  (${pct(misses.length, totalNodes)})`)

const rows = [...ctxRows.entries()].sort((a, b) => b[1].miss - a[1].miss || b[1].nodes - a[1].nodes)
console.log(`\nper IMMEDIATE PARENT of the variable_name node, misses first:`)
console.log("parent".padEnd(30) + "nodes".padStart(9) + "edge".padStart(9) + "miss".padStart(9) + "miss%".padStart(9))
for (const [ctx, row] of rows) {
  if (row.miss === 0 && row.nodes < 100) continue
  console.log(
    ctx.padEnd(30) +
      String(row.nodes).padStart(9) +
      String(row.hit).padStart(9) +
      String(row.miss).padStart(9) +
      pct(row.miss, row.nodes).padStart(9),
  )
}

const byCtx = new Map<string, Miss[]>()
for (const m of misses) {
  const list = byCtx.get(m.context)
  if (list) list.push(m)
  else byCtx.set(m.context, [m])
}
const ordered = [...byCtx.entries()].sort((a, b) => b[1].length - a[1].length)
let shown = 0
console.log(`\nmissed reads by context (showing up to ${EXAMPLES} total):`)
for (const [ctx, list] of ordered) {
  console.log(`\n  --- ${ctx}: ${list.length} missed, ${new Set(list.map((m) => m.file)).size} files`)
  for (const m of list.slice(0, Math.max(4, Math.ceil(EXAMPLES / ordered.length)))) {
    console.log(`    ${m.file}:${m.line}  $${m.name}`)
    console.log(`      | ${m.src}`)
    console.log(`      ${m.path}`)
    shown++
    if (shown >= EXAMPLES) break
  }
  if (shown >= EXAMPLES) break
}
console.log(`\ntotal missed reads: ${misses.length} across ${new Set(misses.map((m) => m.file)).size} files`)
parser.delete()
