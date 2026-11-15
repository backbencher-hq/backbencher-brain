/**
 * PY-RULED-PROBE-CHECK — proves the figure `python-ruled.ts` publishes for its
 * instrument-B table is the figure that table actually produces.
 *
 * ## Why this file exists
 *
 * `script/m14/ontology-coverage-gate.ts` does NOT compare a ruling's `publishedCount`
 * against the hits its own walk produced — it prints whatever it measured and moves on.
 * So a ruling can carry a number that is simply wrong and the arbiter will not notice.
 *
 * The julia table records the same trap from the other side: a probe that hardcoded its
 * own figure reported MISMATCH while exiting 0, which is a gate that can neither fail nor
 * be right. Neither failure is acceptable for a number a ruling stands on, so this runs
 * the ruling's own `countOnTree` over the same population `implements-probe.ts` uses and
 * fails loudly if the two disagree.
 *
 * It also asserts the SHAPE of the instrument-A table's claim — that none of the 17
 * candidate node types is produced by the grammar over that population — because
 * instrument A is the registered verdict and an unverified "0 present" is the same
 * defect one level up.
 *
 * No regex: tree navigation only, matching the probe it checks.
 *
 * Usage:
 *   bun run validation/m14/fixtures/python/ruled-probe-check.ts
 *   bun run validation/m14/fixtures/python/ruled-probe-check.ts --json
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import * as wts from "web-tree-sitter"
import { PYTHON_RULED, PYTHON_RULED_INSTRUMENT_B, PYTHON_SUPERTYPE_NODE_TYPES } from "../../../../script/m14/python-ruled"

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const PY_CORPUS = path.join(CR, "python-corpus")

await wts.Parser.init({
  locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const parser = new wts.Parser()
parser.setLanguage(await wts.Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-python.wasm"))))

// ---- population: DERIVED, identical rule to implements-probe.ts so the two agree on
// what they are talking about. A check against a different population proves nothing.

function isCheckout(dir: string): boolean {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function population(): string[] {
  const out: string[] = []
  for (const name of readdirSync(PY_CORPUS).sort()) {
    const dir = path.join(PY_CORPUS, name)
    try {
      if (!statSync(dir).isDirectory() || !isCheckout(dir)) continue
    } catch {
      continue
    }
    let tracked: string[] = []
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
      if (!rel.endsWith(".py") && !rel.endsWith(".pyi")) continue
      const p = path.join(dir, rel)
      try {
        if (statSync(p).size > 0 && statSync(p).size <= 512 * 1024) out.push(p)
      } catch {
        /* unreadable */
      }
    }
  }
  return out
}

const files = population()
if (files.length === 0) {
  console.error(`ruled-probe-check: no corpus under ${PY_CORPUS}`)
  console.error(`Refusing to print 0. An empty population and a construct that never occurs`)
  console.error(`are the same number and they mean opposite things.\n`)
  process.exit(2)
}

const bEntry = PYTHON_RULED_INSTRUMENT_B.find((r) => r.type === "implements")
const aEntry = PYTHON_RULED.find((r) => r.type === "implements")
if (!bEntry || !aEntry || !bEntry.countOnTree) {
  console.error("ruled-probe-check: python-ruled.ts does not carry both tables")
  process.exit(2)
}

const hits: string[] = []
const hitFiles = new Set<string>()
const grammarNodeTypes = new Map<string, number>()
let parsed = 0
let failed = 0

for (const f of files) {
  let tree: any
  try {
    tree = parser.parse(readFileSync(f, "utf8"))
  } catch {
    failed++
    continue
  }
  if (!tree) {
    failed++
    continue
  }
  parsed++
  const label = path.relative(PY_CORPUS, f)
  const before = hits.length
  bEntry.countOnTree(tree.rootNode, label, hits)
  if (hits.length > before) hitFiles.add(label)
  const v = (n: any): void => {
    grammarNodeTypes.set(n.type, (grammarNodeTypes.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.childCount; i++) v(n.child(i))
  }
  v(tree.rootNode)
  tree.delete?.()
}

const aPresent = PYTHON_SUPERTYPE_NODE_TYPES.filter((n) => grammarNodeTypes.has(n))

const rows = [
  {
    check: "instrument-B countOnTree occurrences",
    published: bEntry.publishedCount ?? null,
    measured: hits.length,
    match: (bEntry.publishedCount ?? null) === hits.length,
  },
  {
    check: "instrument-B countOnTree files",
    published: bEntry.publishedFiles ?? null,
    measured: hitFiles.size,
    match: (bEntry.publishedFiles ?? null) === hitFiles.size,
  },
  {
    check: "instrument-A candidate node types PRESENT in the grammar",
    published: 0,
    measured: aPresent.length,
    match: aPresent.length === 0,
  },
]
const allMatch = rows.every((r) => r.match)

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ corpusRoot: PY_CORPUS, population: files.length, parsed, failed, grammarNodeTypesObserved: grammarNodeTypes.size, rows, allMatch, examples: hits.slice(0, 5) }, null, 1))
} else {
  console.log(`python ruling probe check`)
  console.log(`corpus: ${PY_CORPUS}`)
  console.log(`POPULATION: ${files.length} tracked .py/.pyi  parsed ${parsed}  unread ${failed}`)
  console.log(`grammar: ${grammarNodeTypes.size} distinct node types\n`)
  for (const r of rows) {
    console.log(`  ${r.check.padEnd(52)} published ${String(r.published).padStart(5)}  measured ${String(r.measured).padStart(5)}  ${r.match ? "MATCH" : "MISMATCH"}`)
  }
  if (aPresent.length) console.log(`\n  instrument A is FALSIFIED — the grammar DOES produce: ${aPresent.join(" ")}`)
  for (const h of hits.slice(0, 5)) console.log(`  e.g. ${h}`)
  console.log(`\nresult: ${allMatch ? "every published figure reproduces" : "MISMATCH — a published figure does not reproduce"}`)
}
if (!allMatch) process.exit(1)