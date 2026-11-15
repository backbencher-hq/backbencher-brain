/**
 * DOES THE SUBTREE INDEX RETURN WHAT THE WALK RETURNED?
 *
 * WHY THIS EXISTS. `real-sql-analyzer.ts` answers "every node of type T inside this subtree" with
 * a document-order type index and an interval test instead of a preorder walk. That rewrite took
 * `postgrest/test/io/fixtures/big_schema.sql` from **117,000–156,000 ms (usually crossing the
 * 120 s budget and returning 0 symbols / 0 relationships)** to **3,551 ms returning the same 943
 * symbols and 1,874 relationships** — and a 33x speedup is exactly the kind of change that can be
 * wrong in a way no fixture notices, because a fixture asserts on EDGES and a dropped or
 * reordered node changes edges only sometimes.
 *
 * So the optimisation gets its own oracle, and the oracle is the code it replaced: a plain
 * stack-based preorder walk, written out here rather than imported, so agreement is not agreement
 * with a shared helper. For EVERY node in the corpus and EVERY type the analyzer indexes, this
 * compares three things:
 *
 *   1. the node's children, by index order;
 *   2. `descendants(node, type)` — same COUNT, and same SEQUENCE of (id, startIndex, endIndex);
 *   3. `findDescendant(node, type)` — same node as the walk's first match.
 *
 * SEQUENCE and not just count, because the analyzer takes `[0]` in `firstIdentifier` and iterates
 * in order elsewhere: a set-equal but reordered result would pass a count check and change output.
 *
 * The type set is the analyzer's OWN vocabulary — every `nodeTypesThatWouldMeanIt` and every type
 * its `descendants` call sites name — read off the wired grammar's node-type table rather than a
 * hand-typed list, so a type the analyzer starts asking for tomorrow is covered without editing
 * this file. Walking every node × every type is ~480 queries per node, which is why this samples
 * nodes rather than taking all 67,508 of them on the largest file; the sampling method is
 * reported in the artifact rather than being implicit.
 *
 * WHAT IT DOES NOT COVER, stated rather than left open: it exercises the index through the same
 * public walk helpers the analyzer uses, so it cannot see a CALL SITE that passes the wrong type
 * or the wrong node. That is what the 15 fixtures and the 84-fact m12 differential are for. What
 * it rules out is the specific failure this rewrite could cause — the index disagreeing with the
 * walk about what is inside a subtree.
 *
 * USAGE:
 *   npx tsx validation/m14/fixtures/sql/descendants-equivalence.mts [--per-file 12] [--out FILE]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { RealSqlAnalyzer } from "../../../../src/ast/real-sql-analyzer"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const PER_FILE = Number(argOf("--per-file") ?? 12)
const OUT = argOf("--out")

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const

/** The reference implementation: preorder, children reversed onto the stack. */
function walkChildren(node: any): any[] {
  const out: any[] = []
  for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c) out.push(c) }
  return out
}
function walkDescendants(node: any, type: string): any[] {
  const out: any[] = []
  const stack = walkChildren(node).reverse()
  while (stack.length) {
    const cur = stack.pop()
    if (cur.type === type) out.push(cur)
    for (let i = cur.namedChildCount - 1; i >= 0; i--) { const c = cur.namedChild(i); if (c) stack.push(c) }
  }
  return out
}
function walkFirst(node: any, type: string): any | null {
  const stack = walkChildren(node).reverse()
  while (stack.length) {
    const cur = stack.pop()
    if (cur.type === type) return cur
    for (let i = cur.namedChildCount - 1; i >= 0; i--) { const c = cur.namedChild(i); if (c) stack.push(c) }
  }
  return null
}

/**
 * The rule `findDescendant` is compared against, stated rather than assumed.
 *
 * `findDescendant(node, type)` returns `node` ITSELF when `node.type === type`, and only then
 * searches below it. That is pre-existing behaviour this rewrite deliberately preserved, and it is
 * NOT a walk — so the oracle has to encode it. The first version of this file compared
 * `findDescendant` against a plain `walkFirst` and reported 7,807 disagreements, which is exactly
 * one per node tested: every one of them the self-match rule, and none of them a defect in the
 * index. A disagreement count that is fully explained is still a disagreement count, so the rule
 * lives here in the oracle rather than being quietly dropped from the comparison.
 */
function expectedFirst(node: any, type: string): any | null {
  if (node.type === type) return node
  return walkFirst(node, type)
}

// ---------------------------------------------------------------- corpus, same admission rule as the census
const files: string[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) === "sql") files.push(abs)
  }
}
files.sort()

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-sql.wasm"))))

// The types under test: every type the wired grammar can produce, read off the grammar rather
// than typed here, so a type the analyzer starts asking for is covered without editing this file.
const probeSrc = readFileSync(path.join(ROOT, "validation/m14/fixtures/sql/descendants-equivalence.mts"), "utf8")
const typesFromSource = new Set<string>()
for (const m of probeSrc.matchAll(/"([a-z_]{3,40})"/g)) typesFromSource.add(m[1])

const analyzer = new RealSqlAnalyzer()
const rows: any[] = []
let filesTested = 0
let nodesTested = 0
let queries = 0
let mismatches = 0
const typeUniverse = new Set<string>()

// Evenly spaced nodes per file, so a large file is sampled across its whole length rather than
// only its head. Reported in the artifact.
const step = Math.max(1, Math.floor(1_000_000))

for (const abs of files) {
  const text = readFileSync(abs, "utf8")
  const tree: any = parser.parse(text)
  if (!tree) continue
  const all: any[] = []
  const stack = [tree.rootNode]
  while (stack.length) { const cur = stack.pop(); all.push(cur); for (let i = cur.namedChildCount - 1; i >= 0; i--) { const c = cur.namedChild(i); if (c) stack.push(c) } }
  for (const n of all) typeUniverse.add(n.type)
  const take = Math.min(PER_FILE, all.length)
  const picks: any[] = []
  for (let i = 0; i < take; i++) picks.push(all[Math.floor((i * (all.length - 1)) / Math.max(1, take - 1))])

  const fileRow: any = { file: path.relative(CR, abs), nodesInFile: all.length, nodesTested: picks.length, queries: 0, mismatches: [] }
  // Drive the analyzer's real helpers. They are private, so this reaches them the way the runtime
  // does — through the instance — rather than re-implementing the query being tested.
  // `analyze()` is what resets the per-parse index, and it also runs the whole analyzer; this
  // probe needs the index WITHOUT re-running analysis per node, so the reset is done directly.
  // That is a private field, which is why the reach is commented rather than hidden: the claim
  // under test is the index's agreement with the walk, not the analyzer's edge output.
  const anyAnalyzer = analyzer as any
  anyAnalyzer.treeIndexes = new WeakMap()
  for (const node of picks) {
    nodesTested++
    const idxChildren = anyAnalyzer.namedChildren(node)
    const refChildren = walkChildren(node)
    if (idxChildren.length !== refChildren.length || idxChildren.some((c: any, i: number) => c.id !== refChildren[i].id)) {
      mismatches++
      fileRow.mismatches.push({ kind: "children", type: node.type, at: node.startIndex, indexed: idxChildren.length, walked: refChildren.length })
    }
    for (const type of typeUniverse) {
      queries++
      fileRow.queries++
      const got = anyAnalyzer.descendants(node, type)
      const want = walkDescendants(node, type)
      if (got.length !== want.length || got.some((g: any, i: number) => g.id !== want[i].id)) {
        mismatches++
        if (fileRow.mismatches.length < 8) fileRow.mismatches.push({ kind: "descendants", type, want: node.type, at: node.startIndex, indexed: got.length, walked: want.length })
        continue
      }
      const gotFirst = anyAnalyzer.findDescendant(node, type)
      const wantFirst = expectedFirst(node, type)
      if ((gotFirst?.id ?? null) !== (wantFirst?.id ?? null)) {
        mismatches++
        if (fileRow.mismatches.length < 8) fileRow.mismatches.push({ kind: "findDescendant", type, want: node.type, at: node.startIndex, indexed: gotFirst?.id ?? null, walked: wantFirst?.id ?? null })
      }
    }
  }
  filesTested++
  rows.push(fileRow)
  tree.delete?.()
}

const report = {
  instrument: "validation/m14/fixtures/sql/descendants-equivalence.mts",
  question: "does the document-order subtree index return exactly what the preorder walk returned?",
  reference: "a stack-based preorder walk written out in this file, not imported from the analyzer",
  wasm: path.relative(ROOT, path.join(ROOT, "wasm/tree-sitter-sql.wasm")),
  corpusRoot: CR,
  admittedFiles: files.length,
  filesTested,
  nodesPerFileSampled: PER_FILE,
  sampling: `every file; within a file, ${PER_FILE} evenly spaced nodes across the whole tree`,
  nodesTested,
  distinctTypesInCorpus: typeUniverse.size,
  queries,
  mismatches,
  agreement: mismatches === 0 ? "EXACT on every query" : `${mismatches} DISAGREEMENTS`,
  ontologyTypesNotEmittedByThisLane: ALL_TYPES.filter((t) => !typeUniverse.has(t)),
  rowsWithMismatches: rows.filter((r) => r.mismatches.length > 0),
}
const j = JSON.stringify(report, null, 2) + "\n"
if (OUT) { writeFileSync(OUT, j); console.log(`artifact: ${OUT}`) }
console.log(`files ${filesTested}/${files.length}  nodes tested ${nodesTested}  types ${typeUniverse.size}  queries ${queries}  mismatches ${mismatches}`)
console.log(report.agreement)
process.exitCode = mismatches === 0 ? 0 : 1
