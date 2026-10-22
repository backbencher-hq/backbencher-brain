/**
 * PYTHON HERITAGE BLIND-SPOT PROBE — the LANE'S OWN instrument, because the SHARED probe
 * (`script/m14/heritage-blindspot-probe.ts`) measures a SHAPE LIST and python's analyzer
 * resolves rather than shape-matches.
 *
 * WHAT IT MEASURES. For every base-class clause in the whole admitted population — every
 * argument of every `class_definition`'s `superclasses` argument_list — it asks TWO questions:
 *
 *   1. WHAT SHAPE IS THE CLAUSE? (read from the PARSE TREE, never from text)
 *   2. DOES THE CLAUSE PUBLISH AN EDGE? (read from the analyzer's OWN emitted relationships)
 *
 * AND THE SECOND QUESTION IS ASKED AGAINST THE ANALYZER'S OWN RESOLUTION, NOT A COPY OF IT:
 * the probe calls the analyzer's own private `baseClassLeaf(node)` — the very function
 * `src/ast/real-python-analyzer.ts:1975` uses, and which returns `undefined` for any shape it
 * does not know, at which point the emitter `continue`s and NO `extends`/`implements` EDGE IS
 * PUBLISHED. ⇒ A SHAPE TABLE COULD NOT STAND IN FOR THAT RESOLUTION, and a copy of the
 * function would be a copy that can drift from the function — so the probe calls the function.
 *
 * WHY IT EXISTS. The javascript lane measured 802 of 2,572 `class_heritage` clauses publishing
 * NO EDGE AT ALL, because its lookup names two shapes while 726 clauses are
 * `parenthesized_expression` and 76 are `call_expression`. A python base clause is exactly
 * where a lookup pair can miss a shape: `class C(Base)` is an `identifier`, `class C(mod.Base)`
 * is an `attribute`, `class C(Generic[T])` is a `subscript`, and `class C(Base())` is a `call`
 * — and the analyzer's `baseClassLeaf` names `identifier`, `subscript` and `attribute` ONLY.
 * ⇒ THE PROBE COUNTS THE CLAUSES OF THE OTHER SHAPES AND MEASURES WHAT THEY COST.
 *
 * THE POPULATION RULE IS THE GATE'S, copied not shared (`script/m14/incoming-gate.ts` is the
 * LEAD's file and this lane does not edit it), and the rule is PRINTED beside the count:
 *
 *   · the corpus root is `BB_CORPUS_ROOT` (the FARM root, `$PWD/.corpus`) or the gate's
 *     default root; the ABSOLUTE path is printed;
 *   · a corpus entry is a REPO only if it is a directory AND a real git checkout;
 *   · the file set is `git ls-files` (TRACKED paths), not a filesystem walk;
 *   · an admitted file is `.py` / `.pyi` / `.pyw` AND at or under the engine's 1 MB full-AST
 *     limit; the over-cap and absent counts are PRINTED, never silently dropped;
 *   · a symlinked corpus entry IS a repository (`statSync` FOLLOWS the link) and the number
 *     followed is PRINTED.
 *
 * NO REGEX. The extension test is a suffix comparison; the path rules are path operations;
 * every count is read from the tree or from the analyzer's own output.
 *
 * Usage:
 *   bun run script/m14/python-heritage-probe.ts --out <path.json>
 *   bun run script/m14/python-heritage-probe.ts --repo <name> --out <path.json>
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"

import { getParser } from "../../src/ast/engine"
import { RealPythonAnalyzer } from "../../src/ast/real-python-analyzer"

const CORPUS_ROOT = path.resolve(
  process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories",
)
const ADMITTED_EXTENSIONS = [".py", ".pyi", ".pyw"]
const SIZE_CAP = 1024 * 1024

interface Population {
  admitted: string[]
  total: number
  repos: number
  absent: number
  overCap: number
  overCapLargest: number
  symlinkedRepos: number
  nonGitEntries: number
  rule: string
}

function discover(): Population {
  const found: string[] = []
  const repos = new Set<string>()
  let absent = 0
  let overCap = 0
  let overCapLargest = 0
  let symlinkedRepos = 0
  let nonGitEntries = 0
  let entries: string[]
  try {
    entries = readdirSync(CORPUS_ROOT)
  } catch {
    return {
      admitted: [], total: 0, repos: 0, absent: 0, overCap: 0, overCapLargest: 0,
      symlinkedRepos: 0, nonGitEntries: 0, rule: "corpus root unreadable",
    }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CORPUS_ROOT, name)
    // `statSync` FOLLOWS a symlink, so a symlinked corpus entry is a directory.
    let isDir = false
    try {
      isDir = statSync(dir).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    try {
      const isLink = statSync(dir).isSymbolicLink()
      if (isLink) symlinkedRepos++
    } catch {
      /* the directory test already succeeded; the link test cannot change the verdict */
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files"], {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      }).split("\n")
    } catch {
      nonGitEntries++
      continue
    }
    const seen = new Set<string>()
    for (const rel of tracked) {
      if (!rel) continue
      const abs = path.join(dir, rel)
      if (!ADMITTED_EXTENSIONS.some((e) => rel.endsWith(e))) continue
      let size = 0
      try {
        size = statSync(abs).size
      } catch {
        absent++
        continue
      }
      if (size > SIZE_CAP) {
        overCap++
        if (size > overCapLargest) overCapLargest = size
        continue
      }
      if (seen.has(abs)) continue
      seen.add(abs)
      found.push(abs)
      repos.add(name)
    }
  }
  return {
    admitted: found,
    total: found.length + absent + overCap,
    repos: repos.size,
    absent,
    overCap,
    overCapLargest,
    symlinkedRepos,
    nonGitEntries,
    rule:
      "the gate's population rule: git ls-files TRACKED paths per corpus entry; a corpus entry " +
      "is a REPO only if it is a directory and a real git checkout; admitted = extension in " +
      "{.py,.pyi,.pyw} AND size <= 1 MiB (the engine's own full-AST limit); a symlinked corpus " +
      "entry IS a repository (statSync follows the link)",
  }
}

function repoOf(abs: string, pop: Population): string {
  const rest = abs.slice(CORPUS_ROOT.length + 1)
  const i = rest.indexOf("/")
  return i === -1 ? rest : rest.slice(0, i)
}

/** THE CLAUSE SHAPES THE ANALYZER'S OWN LOOKUP NAMES — read from the analyzer's source
 *  comment, not assumed: `baseClassLeaf` accepts `identifier`, recurses into a `subscript`'s
 *  first named child, and takes an `attribute`'s LAST named child. The probe CALLS the
 *  function; this list is only used to label the uncovered clauses. */
const KNOWN_SHAPES = new Set(["identifier", "subscript", "attribute"])

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const OUT_INDEX = argv.indexOf("--out")
  const OUT = OUT_INDEX === -1 ? "" : argv[OUT_INDEX + 1]
  const REPO_INDEX = argv.indexOf("--repo")
  const REPO_ONLY = REPO_INDEX === -1 ? "" : argv[REPO_INDEX + 1]

  const pop = discover()
  console.log("PYTHON HERITAGE BLIND-SPOT PROBE — the lane's own instrument")
  console.log(`  corpus root   : ${CORPUS_ROOT}`)
  console.log(`  population    : ${pop.total} tracked · ${pop.repos} repos · ${pop.admitted.length} ADMITTED`)
  console.log(`  absent ${pop.absent} · over-cap ${pop.overCap} (largest ${pop.overCapLargest}) · symlinked repos ${pop.symlinkedRepos} · non-git entries ${pop.nonGitEntries}`)
  console.log(`  rule          : ${pop.rule}`)

  const parser = await getParser("python")
  const analyzer = new RealPythonAnalyzer()
  const anyAnalyzer = analyzer as any
  // THE ANALYZER'S OWN RESOLUTION, CALLED — NOT COPIED.
  const baseClassLeaf = (node: any): string | undefined => anyAnalyzer.baseClassLeaf(node)

  let parsed = 0
  let failed = 0
  let degraded = 0
  let totalClauses = 0
  let covered = 0
  let uncovered = 0
  let lookupMissed = 0
  let coveredButNoEdge = 0
  let classes = 0
  const byShape = new Map<string, { total: number; covered: number; uncovered: number; lookupMissed: number }>()
  const uncoveredShapes = new Map<string, number>()
  const uncoveredExamples: string[] = []
  const coveredExamples: string[] = []

  const bump = (shape: string, kind: "total" | "covered" | "uncovered" | "lookupMissed") => {
    let row = byShape.get(shape)
    if (!row) {
      row = { total: 0, covered: 0, uncovered: 0, lookupMissed: 0 }
      byShape.set(shape, row)
    }
    row[kind]++
  }

  for (const abs of pop.admitted) {
    if (REPO_ONLY && !abs.includes(`/${REPO_ONLY}/`)) continue
    let content: string
    try {
      content = readFileSync(abs, "utf8")
    } catch {
      failed++
      continue
    }
    let tree: any
    try {
      tree = parser.parse(content)
    } catch {
      failed++
      continue
    }
    if (!tree) { failed++; continue }
    parsed++
    let result: any
    try {
      result = analyzer.analyze(tree.rootNode, content, abs)
    } catch (e) {
      degraded++
      if (degraded <= 3) {
        console.log(`  DEGRADED: ${abs} — ${String((e as any)?.message ?? e).slice(0, 200)}`)
      }
      continue
    }
    const rels: any[] = Array.isArray(result?.relationships) ? result.relationships : []
    // THE ANALYZER'S OWN EMITTED EDGES — the source endpoint is `source` (NOT `from`, which
    // is undefined on the engine's relationship object — reading `rel.from` classifies ZERO
    // rows with no error anywhere, which is how the first version of the lane's direction
    // instrument reported a movement of 0).
    const emitted = new Set<string>()
    for (const r of rels) {
      const t = String(r?.type ?? "")
      if (t !== "extends" && t !== "implements") continue
      emitted.add(`${String(r?.source ?? "")} ${String(r?.target ?? "")}`)
    }

    // THE CLAUSES, read from the TREE.
    const visit = (node: any): void => {
      if (node?.type === "class_definition") {
        classes++
        const nameNode = node.childForFieldName?.("name")
        const className = nameNode?.text ?? ""
        const sup = node.childForFieldName?.("superclasses")
        if (sup) {
          for (let i = 0; i < sup.namedChildCount; i++) {
            const clause = sup.namedChild(i)
            if (!clause) continue
            totalClauses++
            const shape = String(clause.type ?? "UNKNOWN")
            bump(shape, "total")
            const leaf = baseClassLeaf(clause)
            if (!leaf) {
              // THE LOOKUP ITSELF MISSES THIS SHAPE ⇒ THE EMITTER `continue`s ⇒ NO EDGE.
              lookupMissed++
              uncovered++
              bump(shape, "uncovered")
              bump(shape, "lookupMissed")
              uncoveredShapes.set(shape, (uncoveredShapes.get(shape) ?? 0) + 1)
              if (uncoveredExamples.length < 20) {
                uncoveredExamples.push(`${shape}: ${abs.replace(CORPUS_ROOT + "/", "")} :: ${clause.text?.slice(0, 80)}`)
              }
              continue
            }
            if (emitted.has(`${className} ${leaf}`)) {
              covered++
              bump(shape, "covered")
              if (coveredExamples.length < 10) {
                coveredExamples.push(`${shape}: ${abs.replace(CORPUS_ROOT + "/", "")} :: ${className} -> ${leaf}`)
              }
            } else {
              // THE LOOKUP RESOLVED, BUT NO EDGE WAS PUBLISHED — a DIFFERENT defect class:
              // the emitter decided not to publish it (e.g. a base equal to the class itself).
              coveredButNoEdge++
              uncovered++
              bump(shape, "uncovered")
              uncoveredShapes.set(shape, (uncoveredShapes.get(shape) ?? 0) + 1)
            }
          }
        }
      }
      for (let i = 0; i < (node?.namedChildCount ?? 0); i++) {
        const c = node.namedChild(i)
        if (c) visit(c)
      }
    }
    visit(tree.rootNode)
    // THE TREE IS FREED: web-tree-sitter keeps ONE parse buffer per parser, and a walk that
    // holds every tree alive exhausts the parser — the next parse THROWS, silently, into the
    // `failed` counter.
    try { (tree as any)?.delete?.() } catch { /* a tree that cannot be freed is not an error here */ }
  }

  const shapeRows = [...byShape.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([shape, r]) => ({
      shape,
      inTheAnalyzersLookup: KNOWN_SHAPES.has(shape),
      total: r.total,
      covered: r.covered,
      uncovered: r.uncovered,
      lookupMissed: r.lookupMissed,
    }))

  console.log("")
  console.log("THE HERITAGE CLAUSES — SHAPE AGAINST THE ANALYZER'S OWN RESOLUTION")
  console.log(`  classes ${classes} · clauses ${totalClauses} · covered ${covered} · UNCOVERED ${uncovered}`)
  console.log(`  of the uncovered: the lookup itself returned no leaf ${lookupMissed} · the lookup resolved but no edge was published ${coveredButNoEdge}`)
  console.log("  shape                          in-lookup  total   covered  uncovered  lookup-missed")
  for (const r of shapeRows) {
    console.log(
      `  ${r.shape.padEnd(28)}  ${String(r.inTheAnalyzersLookup).padEnd(10)}  ${String(r.total).padStart(6)}  ${String(r.covered).padStart(7)}  ${String(r.uncovered).padStart(9)}  ${String(r.lookupMissed).padStart(12)}`,
    )
  }
  if (uncoveredShapes.size > 0) {
    console.log("")
    console.log("THE UNCOVERED CLAUSES BY SHAPE (the near-miss census)")
    for (const [shape, n] of [...uncoveredShapes.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${shape.padEnd(28)} ${n}`)
    }
  }
  if (uncoveredExamples.length > 0) {
    console.log("")
    console.log("EXAMPLES OF THE UNCOVERED (the first 20)")
    for (const e of uncoveredExamples) console.log("  " + e)
  }

  const artifact = {
    instrument: "script/m14/python-heritage-probe.ts",
    population: {
      files: parsed,
      repos: pop.repos,
      absent: pop.absent,
      overCap: pop.overCap,
      root: CORPUS_ROOT,
      rule: pop.rule,
    },
    digests: {
      head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      analyzer: execFileSync("git", ["hash-object", "src/ast/real-python-analyzer.ts"], { encoding: "utf8" }).trim(),
      probe: execFileSync("git", ["hash-object", "script/m14/python-heritage-probe.ts"], { encoding: "utf8" }).trim(),
    },
    classes,
    clauses: totalClauses,
    covered,
    uncovered,
    lookupMissed,
    coveredButNoEdge,
    byShape: shapeRows,
    uncoveredExamples,
    coveredExamples,
    parsed,
    failed,
    degraded,
  }
  if (OUT) {
    writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")
    console.log("")
    console.log(`wrote ${OUT}`)
  }
  // THE FALSIFIER: an uncovered clause whose SHAPE the analyzer's lookup names is a defect in
  // the EMITTER; an uncovered clause whose shape the lookup does NOT name is a fact about the
  // grammar. The exit code says which, so a reader never has to guess.
  if (uncovered > 0) process.exit(5)
}

await main()
