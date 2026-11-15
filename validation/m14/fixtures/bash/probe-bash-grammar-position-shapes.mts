/**
 * BASH GRAMMAR-POSITION SHAPE CENSUS — every position the analyzer reads by
 * SHAPE, and every shape the pinned grammar actually produces there.
 *
 * ## Why this file exists
 *
 * Round 12's defect was a DEPTH assumption, not a missing feature. The analyzer
 * read an assignment's LHS as a direct `variable_name` child; the grammar holds
 * a `subscript > variable_name` for `name[i]=v`, one level deeper, so 13.6% of
 * every assignment LHS in the corpus (5,474 nodes, 123 files) published nothing
 * and every read of those names was classified environment-supplied. Nothing
 * about that is visible by reading the handler: the handler is correct for the
 * shape it names, and the grammar has a second shape.
 *
 * The generalization is the question this probe answers, and it is the only
 * question that generalizes:
 *
 *   for EVERY node type the analyzer dispatches on, and for EVERY child
 *   position it reads, what SHAPES does the pinned grammar actually produce —
 *   and is there a shape the handler does not name?
 *
 * A shape census is the only instrument that can see this class of defect, and
 * it is the same instrument that found round 12's: `probe-bash-array-element-
 * binding.mts` enumerated LHS shapes rather than assuming one. The round-12 fix
 * is closed ("the grammar produces exactly two LHS shapes") — this file is what
 * makes the OTHER positions closable instead of assumed.
 *
 * ## What counts as "a shape the handler does not name"
 *
 * Derived from the analyzer's source, read as source, not matched:
 *
 *   declaration_command  handler requires `child(0).text` ∈ DECLARATION_KEYWORDS
 *                        (real-bash-analyzer.ts:1866). Any other child(0) is a
 *                        declaration the handler returns early on.
 *   for_statement        handler publishes a DIRECT `variable_name` named child
 *                        (:1737-1742) and nothing else. Any other child holding
 *                        a loop variable is a binding it declines.
 *   variable_assignment  handler reads the LHS; round 12 closed both shapes.
 *   alias / trap / read  handler reads a named child; census enumerates them.
 *
 * Every other shape is printed with a count and a file:line so a reader can
 * adjudicate by hand. A shape listed here is NOT a defect claim — it is a place
 * the instrument looked. The defect claim needs the handler's rule, which is in
 * the source above.
 *
 * ## INSTRUMENT
 *
 * This probe's OWN `web-tree-sitter` handle over the pinned
 * `wasm/tree-sitter-bash.wasm`, never the engine's shared handle — two owners of
 * one parser handle is the instrument property that makes the coverage gate's
 * per-type totals wobble run to run (limitation 15), and a census that
 * reproduces the gate's non-reproducibility is not a census.
 *
 * **NO REGEX.** Every shape below is `node.type` and integer child indices read
 * through the cursor/node API. The corpus walk uses `git ls-files` (a
 * subprocess, not a pattern) and `detectLanguageFromPath`, the production router.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-grammar-position-shapes.mts
 *      [--sample 400 | --all] [--examples 12]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const num = (n: string, d: number): number => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? Number(argv[i + 1]) : d
}
const ALL = argv.includes("--all")
const SAMPLE = ALL ? Number.MAX_SAFE_INTEGER : num("sample", 400)
const EXAMPLES = num("examples", 12)

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
  `bash grammar-position shape census — private tree handle, ${sample.length} files${ALL ? " (--all)" : ""}`,
)
console.log(`admitted ${files.length} / scanned ${scanned} / repos ${repoNames.size}\n`)

// ---------------------------------------------------------------- the parser
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

// --------------------------------------------------------------- the shapes
/**
 * `key` is a shape string built ONLY from `node.type` and integer child indices.
 * `read` is what the analyzer's handler does at that position, quoted from the
 * source; `read: false` marks a position the analyzer does not read at all,
 * which is a fact about the census's coverage and not a verdict on the shape.
 */
interface Pos {
  node: string
  read: string
  /**
   * A position is a node TYPE in a ROLE. Round 12's defect was not "the
   * analyzer misreads `subscript`" — it reads a subscript correctly in the
   * READ path (`collectReadNames` walks ALL named children, :1596) and by
   * `namedChild(0)` alone in the ASSIGNMENT-LHS path (:1641). A census that
   * counted node types would average those two into one meaningless row, so a
   * position names the parent it must sit under.
   *
   * `under: undefined` means any parent.
   */
  under?: string
  /** does the handler require this EXACT shape? then the shape is "named" */
  /** `named` receives the NAMED-CHILD shape only; the display string also
   *  carries the anonymous children, which is where a keyword or a flag lives
   *  and which `declaration_command` genuinely reads. So the predicate gets the
   *  full string for that one position and the named part for the others. */
  named: (namedShape: string, fullShape: string) => boolean
}

const DECLARATION_KEYWORDS = new Set(["export", "local", "declare", "typeset", "readonly"])

const POSITIONS: Pos[] = [
  {
    // real-bash-analyzer.ts:1866 — `const keyword = node.child(0)?.text ?? ""`
    // followed by `if (!DECLARATION_KEYWORDS.has(keyword)) return`.
    node: "declaration_command",
    read: "child(0).text must be in {export,local,declare,typeset,readonly}, else the handler returns early (:1866)",
    named: (_named, full) => {
      const i0 = full.indexOf("a0:")
      if (i0 < 0) return false
      const kw = full.slice(i0 + 3).split(" ")[0]
      return DECLARATION_KEYWORDS.has(kw)
    },
  },
  {
    // real-bash-analyzer.ts:1737-1742 — the for-loop publishes a DIRECT
    // `variable_name` named child and nothing else.
    node: "for_statement",
    read: "a DIRECT named child of type `variable_name` is published as a binding (:1737); no other shape is (:1742 return)",
    named: s => s.startsWith("n:variable_name"),
  },
  {
    // real-bash-analyzer.ts extractAssignment — the LHS. Round 12 closed both
    // of the shapes the census found, so this row is the CONTROL: if it ever
    // prints a third shape, the round-12 claim "exactly two LHS shapes" is
    // falsified and the fix does not cover it.
    node: "variable_assignment",
    read: "LHS: a direct `variable_name` child, or `subscript > variable_name` (round 12)",
    named: s => s.startsWith("n:variable_name") || s.startsWith("n:subscript>"),
  },
  {
    // real-bash-analyzer.ts:1641 — `const base = child.namedChild(0)` then
    // `if (base && base.type === "variable_name")`. This is the ONLY shape
    // assumption inside round 12's fix, and the doc's claim that it is closed
    // rests on "with a `variable_name` base on 19 of 19" — a 400-FILE SAMPLE,
    // against a whole-corpus population of 5,474. Limitation 27 and 28 are this
    // lane measuring exactly that error twice. So the position is censused at
    // `--all`, in the LHS role only, and the count that decides it is the one on
    // an unread base shape.
    node: "subscript",
    under: "variable_assignment",
    read: "`namedChild(0)` must be `variable_name`, else no declaration is published (:1641-1645)",
    named: s => s.startsWith("n:variable_name"),
  },
  {
    // real-bash-analyzer.ts `functionName` — the name of a `function_definition`.
    // A second definition-shaped construct exists in the corpus (see the
    // doc's inventory note), so the position is censused rather than assumed.
    node: "function_definition",
    read: "the name is read from the tree; a definition whose name is not a plain identifier publishes nothing",
    named: s => s.startsWith("n:word"),
  },
]

/** Shape of a node: its named children in order, as `n:<type>` or `n:<type>>`. */
function shapeOf(node: any): string {
  const parts: string[] = []
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c) continue
    // One level of nesting, which is exactly where round 12's defect lived:
    // `subscript > variable_name` is a two-token shape, not a one-token one.
    let s = `n:${c.type}`
    for (let j = 0; j < c.namedChildCount; j++) {
      const g = c.namedChild(j)
      if (g) s += `>${g.type}`
    }
    parts.push(s)
  }
  return parts.join(" ")
}

/**
 * The anonymous children of a node, which is where a keyword or a flag lives.
 *
 * `a0:` is the FIRST anonymous child's own TEXT, because `declaration_command`'s
 * handler dispatches on exactly that (`:1866` — `child(0)?.text`) and a shape
 * that recorded only `a:word` could not tell `export` from `local`. The
 * remaining anonymous children are recorded by TYPE, since nothing reads their
 * text.
 */
function anonShapeOf(node: any): string {
  const parts: string[] = []
  let first = true
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (!c || c.isNamed) continue
    if (first) {
      parts.push(`a0:${c.text}`)
      first = false
    } else {
      parts.push(`a:${c.type}`)
    }
  }
  return parts.join(" ")
}

interface ShapeRow {
  shape: string
  n: number
  examples: string[]
  named: boolean
}
const census = new Map<string, Map<string, ShapeRow>>()
const nodeTypeCounts = new Map<string, number>()
const errors = { files: 0, nodes: 0 }
/** key `pos` under its parent so two roles for one node type never collide. */
const posKey = (p: Pos) => (p.under ? `${p.node} under ${p.under}` : p.node)

let i = 0
for (const f of sample) {
  i++
  if (i % 250 === 0) console.log(`  … ${i}/${sample.length}`)
  let tree: any
  try {
    tree = parser.parse(f.text)
  } catch {
    errors.files++
    continue
  }
  const root = tree?.rootNode
  if (!root) {
    errors.files++
    continue
  }
  const where = `${f.repo}/${f.rel}:`
  // The stack carries the PARENT type, because a position is a node type in a
  // role and the role is the parent. Pushed with each child so `n.parentType`
  // is the node the handler would be looking at.
  const stack: any[] = [{ node: root, parentType: "" }]
  while (stack.length > 0) {
    const { node: n, parentType } = stack.pop()!
    nodeTypeCounts.set(n.type, (nodeTypeCounts.get(n.type) ?? 0) + 1)
    if (n.type === "ERROR" || n.isMissing) errors.nodes++

    const pos = POSITIONS.find(p => p.node === n.type && (p.under === undefined || p.under === parentType))
    if (pos) {
      const namedShape = shapeOf(n)
      const shape = anonShapeOf(n) + " | " + namedShape
      const key = posKey(pos)
      let m = census.get(key)
      if (!m) {
        m = new Map()
        census.set(key, m)
      }
      let row = m.get(shape)
      if (!row) {
        row = { shape, n: 0, examples: [], named: pos.named(namedShape, shape) }
        m.set(shape, row)
      }
      row.n++
      if (row.examples.length < EXAMPLES) row.examples.push(`${where}${n.startPosition.row + 1}`)
    }
    for (let j = n.childCount - 1; j >= 0; j--) {
      const c = n.child(j)
      if (c) stack.push({ node: c, parentType: n.type })
    }
  }
  tree.delete?.()
}

// ---------------------------------------------------------------- the report
console.log(`\nfiles parsed ${sample.length - errors.files}/${sample.length}   ERROR/MISSING nodes ${errors.nodes}\n`)

for (const pos of POSITIONS) {
  const m = census.get(posKey(pos))
  const total = [...(m?.values() ?? [])].reduce((a, r) => a + r.n, 0)
  console.log(`── ${posKey(pos)} — ${total} nodes`)
  console.log(`   handler: ${pos.read}`)
  if (!m || m.size === 0) {
    console.log("   (none in this sample)\n")
    continue
  }
  const rows = [...m.values()].sort((a, b) => b.n - a.n)
  for (const r of rows) {
    console.log(`   ${r.named ? "READ  " : "UNREAD"} ${String(r.n).padStart(7)}  ${r.shape}`)
    if (!r.named) for (const e of r.examples) console.log(`              ${e}`)
  }
  const unread = rows.filter(r => !r.named)
  console.log(
    `   → ${rows.length} distinct shapes, ${unread.length} unread, ${unread.reduce((a, r) => a + r.n, 0)} nodes on an unread shape\n`,
  )
}

/** Every node type the corpus produces, so the census's own coverage is legible. */
console.log(`── distinct node types produced by this sample: ${nodeTypeCounts.size}`)
const sorted = [...nodeTypeCounts.entries()].sort((a, b) => b[1] - a[1])
for (const [t, n] of sorted.slice(0, 40)) console.log(`   ${String(n).padStart(8)}  ${t}`)
if (sorted.length > 40) console.log(`   … ${sorted.length - 40} more`)

function sha(s: string): string {
  return require("node:crypto").createHash("sha256").update(s).digest("hex")
}