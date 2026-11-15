/**
 * DEAD BRANCHES — does the analyzer contain a branch keyed on a node-type shape
 * this corpus never produces?
 *
 * ## The question, and why it is the sharpest one left in this lane
 *
 * Rounds 12 and 13 both found the same CLASS of defect, twice, and it is a class
 * that no edge count can see:
 *
 *   round 12  the assignment handler read an LHS as a direct `variable_name` child,
 *             and the grammar holds `subscript > variable_name` for `name[i]=v`.
 *             Correct for the shape it named; dead for the other shape.
 *   round 13  the shape census found `function_definition` in 427 nodes whose name
 *             field sits inside an ERROR span — and the analyzer published all 427.
 *
 * Both were found by asking what the GRAMMAR HAS, not what the corpus SHOWED. The
 * natural generalisation is the question this file answers, and it is a question
 * about the analyzer rather than about a count:
 *
 *   every node type the analyzer branches on — which of them does the corpus ever
 *   produce?
 *
 * A branch keyed on a node type the corpus never produces is not wrong; it is
 * UNVERIFIED. It may be unreachable defensive code, it may be correct for a form
 * this corpus happens not to use, and it may be round 12 again. The only honest
 * way to tell those apart is to enumerate the branches and adjudicate each one by
 * name, so this file prints every branch the corpus never exercises and refuses to
 * exit 0 while any of them is unadjudicated.
 *
 * ## How the branches are read, and why not with a pattern
 *
 * The 28 node-type names are extracted from `src/ast/real-bash-analyzer.ts` with
 * the TypeScript compiler API, by walking the AST for a comparison whose operator
 * is `===` or `!==`, one side of which is a string literal and the other a property
 * access named `type`. That is exact rather than approximate: there is no helper in
 * the analyzer that takes a node-type name (`grep` for `OfType` finds none), so
 * every node-type comparison is inline and every one is found. A pattern over the
 * source would also match the same names inside comments and inside this lane's own
 * prose, and it would keep matching after a rewrite that changed the code without
 * changing the behaviour.
 *
 * The node types are then checked against TWO sets, and the difference between
 * those two sets is the whole point:
 *
 *   vocabulary  all 280 symbols the pinned wasm was compiled with, read from the
 *               binary through web-tree-sitter's own API. Corpus-independent.
 *   observed    the node types 4,185 corpus files actually produce, walked here
 *               with THIS FILE'S OWN `web-tree-sitter` handle — never the engine's,
 *               because two owners of one parser handle is what makes the shared
 *               coverage gate's per-type totals wobble between runs (limitation 15).
 *
 * A branch on a type in `vocabulary` but not in `observed` is dead on this corpus.
 * A branch on a type in NEITHER is a defect in the analyzer: it is naming something
 * the grammar cannot produce.
 *
 * No regex anywhere in this file.
 *
 *   npx tsx validation/m14/fixtures/bash/probe-bash-dead-branches.mts [--sample N]
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readdirSync, statSync } from "node:fs"
import ts from "typescript"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const ROOT = process.cwd()
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ANALYZER = path.join(ROOT, "src/ast/real-bash-analyzer.ts")
const argv = process.argv.slice(2)
const num = (flag: string, dflt: number): number => {
  const i = argv.indexOf(flag)
  return i >= 0 ? Number(argv[i + 1]) : dflt
}
const ALL = argv.includes("--all")
const SAMPLE = ALL ? Number.MAX_SAFE_INTEGER : num("--sample", 400)

// ---------------------------------------------------------------- 1. the branches

interface Branch {
  type: string
  sites: number[]
}

/** Every `x.type === "T"` / `x.type !== "T"` in the analyzer, via the TS AST. */
function branchesInSource(file: string): Branch[] {
  const text = readFileSync(file, "utf8")
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const found = new Map<string, number[]>()

  const record = (literal: ts.StringLiteral | undefined): void => {
    if (!literal) return
    const value = literal.text
    const line = sf.getLineAndCharacterOfPosition(literal.getStart(sf)).line + 1
    const arr = found.get(value) ?? []
    arr.push(line)
    found.set(value, arr)
  }

  const isTypeAccess = (e: ts.Expression): boolean =>
    ts.isPropertyAccessExpression(e) && e.name.text === "type"

  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      const isEq = op === ts.SyntaxKind.EqualsEqualsEqualsToken
      const isNeq = op === ts.SyntaxKind.ExclamationEqualsEqualsToken
      if (isEq || isNeq) {
        if (isTypeAccess(node.left) && ts.isStringLiteral(node.right)) record(node.right)
        else if (isTypeAccess(node.right) && ts.isStringLiteral(node.left)) record(node.left)
      }
    }
    if (ts.isSwitchStatement(node) && isTypeAccess(node.expression)) {
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause)) record(clause.expression as ts.StringLiteral)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return [...found.entries()].map(([type, sites]) => ({ type, sites })).sort((a, b) => a.type.localeCompare(b.type))
}

const branches = branchesInSource(ANALYZER)
console.log(`dead-branch census — every node type the analyzer branches on`)
console.log(`  analyzer                : ${path.relative(ROOT, ANALYZER)}`)
console.log(`  distinct node types read: ${branches.length} across ${branches.reduce((a, b) => a + b.sites.length, 0)} comparison sites`)
console.log(`  ${branches.map((b) => b.type).join(" ")}`)
console.log("")

// ---------------------------------------------------------------- 2. the vocabulary

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-bash.wasm")))
const vocabulary = new Set<string>()
for (let i = 0; i < lang.nodeTypeCount; i++) vocabulary.add(lang.nodeTypeForId(i))

const parser = new WSP()
parser.setLanguage(lang)

// ---------------------------------------------------------------- 3. the corpus

interface Admitted {
  repo: string
  rel: string
  abs: string
  text: string
}
const admitted: Admitted[] = []
let reposSeen = 0
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  reposSeen++
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
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
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    admitted.push({ repo: e, rel, abs, text })
  }
}
admitted.sort((a, b) => {
  const ha = createHash("sha256").update(`${a.repo}/${a.rel}`).digest("hex")
  const hb = createHash("sha256").update(`${b.repo}/${b.rel}`).digest("hex")
  return ha < hb ? -1 : ha > hb ? 1 : 0
})
const sample = ALL ? admitted : admitted.slice(0, SAMPLE)

const observed = new Map<string, number>()
let parsed = 0
let errorNodes = 0
for (const f of sample) {
  let t: any
  try {
    t = parser.parse(f.text)
  } catch {
    continue
  }
  if (!t) continue
  parsed++
  const stack: any[] = [t.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "ERROR") errorNodes++
    observed.set(n.type, (observed.get(n.type) ?? 0) + 1)
    for (let k = 0; k < n.childCount; k++) stack.push(n.child(k))
  }
  t.delete?.()
}

console.log(`  corpus root             : ${CR}`)
console.log(`  repos / admitted        : ${reposSeen} / ${admitted.length}`)
console.log(`  measured                : ${parsed} files${ALL ? " (--all)" : ` (hash-order sample of ${SAMPLE})`}, ERROR nodes ${errorNodes}`)
console.log(`  distinct node types seen: ${observed.size} of ${vocabulary.size} the grammar can produce`)
console.log("")

// ---------------------------------------------------------------- 4. adjudicate

/**
 * Each branch the corpus never exercises, with the reason it is not a defect.
 *
 * The key is the node type. A type listed here with a reason has been READ and
 * judged; a branch absent from this table that the corpus never produces is
 * UNADJUDICATED and the probe exits 5. The table is therefore the record, and
 * deleting an entry turns the probe red rather than silently green — which is the
 * only way this file can keep its claim.
 */
const ADJUDICATION: Record<string, string> = {
  ERROR:
    "not a construct this analyzer reads, a marker it GUARDS on. `after.type !== 'ERROR' && !after.isMissing` is a damage test (:1372), and an ERROR node is produced 195 times in this sample and 427 function definitions sit inside one corpus-wide, so this is the most-exercised branch in the file.",
}

const dead = branches.filter((b) => !observed.has(b.type))
// A branch names an impossible node type only when the corpus never produces it
// EITHER. `nodeTypeForId` does not enumerate the reserved error symbol, so `ERROR`
// is absent from `vocabulary` while the parser emits it constantly — the first
// version of this file flagged its own `ERROR` guard as a defect in the same run
// that counted 148 ERROR nodes, which is the enumeration's limit, not a finding.
// Observation overrides the vocabulary, and the vocabulary is not treated as
// complete.
const notInGrammar = branches.filter((b) => !vocabulary.has(b.type) && !observed.has(b.type))

console.log(`branches the corpus never exercises (${dead.length} of ${branches.length}):`)
if (dead.length === 0) console.log("  none — every node type the analyzer branches on was produced at least once")
const unadjudicated: string[] = []
for (const b of dead) {
  const reason = ADJUDICATION[b.type]
  if (reason === undefined) unadjudicated.push(b.type)
  console.log(`  ${b.type.padEnd(24)} ${String(observed.get(b.type) ?? 0).padStart(6)} occurrences · lines ${b.sites.join(", ")}`)
  console.log(`  ${"".padEnd(24)} ${reason ?? "UNADJUDICATED — read this branch and record why the corpus never reaches it"}`)
}
console.log("")

console.log(`branches naming a node type the grammar cannot produce (${notInGrammar.length}):`)
if (notInGrammar.length === 0) console.log("  none — every branch names a symbol the pinned wasm was compiled with")
for (const b of notInGrammar) console.log(`  ${b.type} · lines ${b.sites.join(", ")}`)
console.log("")

const neverSeen = [...vocabulary].filter((t) => !observed.has(t))
console.log(`node types the grammar can produce that this corpus never produced: ${neverSeen.length}`)
console.log(
  `  An analyzer branching on one of those would be dead here, and rounds 12 and 13 are both instances of`,
)
console.log(
  `  that. ${neverSeen.length} of ${vocabulary.size} is the standing size of the unexercised grammar.`,
)

if (notInGrammar.length > 0) {
  console.log("")
  console.log(`${notInGrammar.length} branch(es) name a node type the pinned grammar cannot emit. That is a defect.`)
  process.exit(4)
}
if (unadjudicated.length > 0) {
  console.log("")
  console.log(`${unadjudicated.length} branch(es) are UNADJUDICATED: ${unadjudicated.join(", ")}`)
  console.log("Read each one, then record the reason in this file's ADJUDICATION table.")
  process.exit(5)
}
console.log("")
console.log(`Every branch the corpus never exercises is adjudicated: ${Object.keys(ADJUDICATION).length} recorded.`)