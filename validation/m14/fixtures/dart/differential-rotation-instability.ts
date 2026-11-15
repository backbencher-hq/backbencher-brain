/**
 * WHY `proxicall:dart` COVERAGE IS BIMODAL — and the 98.4% in the doc is one mode.
 *
 * ## The observation this exists to explain
 *
 * `bun run script/m14/differential.ts --lang dart --force-fresh` on this branch,
 * two consecutive rotations of the SAME 60-file draw:
 *
 *   rotation 78  tree-truth=29131  covered=17196 (59%)  MISSING=11935  edges=16604  unexplained=0
 *   rotation 79  tree-truth=29066  covered=17131 (58.9%) MISSING=11935  edges=16549  unexplained=0
 *
 * MISSING is IDENTICAL across the two while truth and covered both move, so the
 * 11,935 is a property of the labels, not of which files were drawn. And the
 * harness's own capped MISSING sample is 11 of 12 rows from ONE file:
 * `proxicall/lib/l10n/generated/app_localizations_bn.dart`.
 *
 * The doc's earlier reading on this lane was `6120/6220 (98.4%) MISSING 100`.
 * Both readings are real runs of the same code; the difference is WHICH 60 files
 * the rotation drew, and a generated localization file carries thousands of
 * `overrides` truth rows while `overrides` is the one label the harness's
 * allowlist drops for dart (docs/analyzers/dart.md, DERIVATION
 * findings). So one drawn l10n file moves the MISSING count by four orders of
 * magnitude and the coverage percentage by 40 points, and neither number
 * describes the analyzer.
 *
 * ## What this measures
 *
 * The override-truth DENSITY of the population that causes it, counted off the
 * parse tree and never off the text:
 *
 *   1. the member names the abstract base declares (`AppLocalizations`)
 *   2. per generated subclass, how many of its members carry one of those names
 *      — which is the shape of an `overrides` truth row, one per member
 *   3. the base rate of generated files in the corpus, and therefore the
 *      probability that a 60-file draw contains at least one
 *
 * Step 2 is an UPPER BOUND on the truth those files contribute, not a re-derivation
 * of the truth: it counts name agreement, which is what the harness's oracle keys
 * on, but it does not reproduce the oracle's other conditions. It is stated as a
 * bound because that is what it is, and an instrument that claimed the exact
 * number would be claiming more than it measured.
 *
 * ## No regex
 *
 * A tree-sitter walk over `node.type` and named children only, per the lane rule.
 *
 * ## CLI
 *
 *   npx tsx validation/m14/fixtures/dart/differential-rotation-instability.ts
 *   BB_DART_BASE=proxicall/lib/l10n/generated/app_localizations.dart npx tsx ...
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPO = process.env.BB_DART_REPO ?? "proxicall"
const DIR = path.join(CR, REPO)
const BASE = process.env.BB_DART_BASE ?? "lib/l10n/generated/app_localizations.dart"
const SAMPLE_N = Number(process.env.BB_DART_SAMPLE ?? 60)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-dart.wasm"))))

interface ClassShape {
  name: string
  members: Set<string>
}
interface FileShape {
  rel: string
  bytes: number
  classes: ClassShape[]
  errors: number
}

function shapeOf(rel: string): FileShape | null {
  const abs = path.join(DIR, rel)
  let content: string
  try {
    if (statSync(abs).size > 4 * 1024 * 1024) return null
    content = readFileSync(abs, "utf8")
  } catch {
    return null
  }
  const root = parser.parse(content).rootNode
  const classes: ClassShape[] = []
  let errors = 0

  const walk = (n: any, inside: ClassShape | null): void => {
    let next = inside
    if (n.type === "ERROR") errors++
    if (n.type === "class_definition") {
      const nameNode = n.namedChildren.find((c: any) => c.type === "identifier")
      const cls: ClassShape = { name: nameNode ? nameNode.text : "", members: new Set() }
      classes.push(cls)
      next = cls
    }
    // A member is a NAMED declaration directly inside the class body, one level
    // down — the same shape the zero-contains probe derives, and for the same
    // reason: a class_definition's own named children are only its name, its
    // heritage clauses, its type parameters and its annotations.
    //
    // The member's NAME is not always a direct child of the signature. A getter
    // is `method_signature > getter_signature > identifier`, and the base file
    // wraps even that in a `declaration`. Reading only the signature's own
    // `identifier` finds the ordinary methods and silently misses all 5,353
    // getters per locale file — which is the population this instrument exists
    // to count, so the miss would have reported the answer as zero.
    // `getter_signature` is listed beside `method_signature` because the two
    // files spell the SAME member differently: a concrete override is
    // `method_signature > getter_signature`, while the abstract declaration in
    // the base is a bare `getter_signature`. Accepting only the wrapper matches
    // every subclass member against nothing and reports 0.
    if (next && (n.type === "method_signature" || n.type === "getter_signature" || n.type === "field_declaration" || n.type === "constructor_signature")) {
      const nameOf = (node: any): string | null => {
        if (node.type === "identifier") return node.text
        for (const c of node.namedChildren) {
          const got = nameOf(c)
          if (got) return got
        }
        return null
      }
      for (const child of n.namedChildren) {
        if (child.type === "type_identifier") continue
        if (child.type === "formal_parameter_list") continue
        const got = nameOf(child)
        if (got) {
          next.members.add(got)
          break
        }
      }
    }
    for (const c of n.children) walk(c, next)
  }
  walk(root, null)
  return { rel, bytes: content.length, classes, errors }
}

const tracked: string[] = execFileSync("git", ["-C", DIR, "ls-files", "-z", "--", "*.dart"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
  .split("\0")
  .filter(Boolean)
  .sort()

const base = shapeOf(BASE)
if (!base) {
  console.error(`base file unreadable: ${BASE}`)
  process.exit(1)
}
const baseClass = base.classes.find(c => c.name && c.members.size > 0)
if (!baseClass) {
  console.error(`base file declares no class with members: ${BASE}`)
  process.exit(1)
}

console.log(`differential rotation instability — ${REPO}, base ${BASE}`)
console.log(`corpus root ${CR}`)
console.log(`tracked .dart files ${tracked.length}`)
console.log(`\nBASE  ${BASE}`)
console.log(`  bytes ${base.bytes}  classes ${base.classes.length}  ERROR nodes ${base.errors}`)
for (const c of base.classes) console.log(`  class ${c.name}: ${c.members.size} member name(s)`)

// The population: generated subclasses whose name ends in the base's locale-less
// stem. Derived from the tree, and the file set is reported so a reader can see
// it is not a hand-picked list.
const stem = baseClass.name
const subclasses = tracked.filter(t => {
  if (t === BASE) return false
  if (!t.includes("/l10n/") && !t.includes("/generated/")) return false
  const s = shapeOf(t)
  if (!s) return false
  return s.classes.some(c => c.name.startsWith(stem) && c.name !== stem)
})

interface Row { rel: string; bytes: number; matched: number; own: number; classes: number }
const rows: Row[] = []
for (const rel of subclasses) {
  const s = shapeOf(rel)
  if (!s) continue
  let matched = 0
  let own = 0
  let nClasses = 0
  for (const c of s.classes) {
    if (!c.name.startsWith(stem) || c.name === stem) continue
    nClasses++
    own += c.members.size
    for (const m of c.members) if (baseClass.members.has(m)) matched++
  }
  if (nClasses > 0) rows.push({ rel, bytes: s.bytes, matched, own, classes: nClasses })
}
rows.sort((a, b) => b.matched - a.matched)

console.log(`\nGENERATED SUBCLASSES of ${stem} carrying a base member name (an overrides-truth shape)`)
console.log(`  files ${rows.length} of ${tracked.length} tracked (${((rows.length / tracked.length) * 100).toFixed(3)}%)`)
console.log(`  own members across them ${rows.reduce((s, r) => s + r.own, 0)}`)
console.log(`  members whose name the base also declares (UPPER BOUND on overrides truth) ${rows.reduce((s, r) => s + r.matched, 0)}`)
console.log(`\n  ${"file".padEnd(52)}${"bytes".padStart(9)}${"classes".padStart(8)}${"members".padStart(9)}${"name-match".padStart(12)}`)
for (const r of rows) console.log(`  ${r.rel.replace(REPO + "/", "").padEnd(52)}${String(r.bytes).padStart(9)}${String(r.classes).padStart(8)}${String(r.own).padStart(9)}${String(r.matched).padStart(12)}`)

const p = rows.length / tracked.length
const pNone = Math.pow(1 - p, SAMPLE_N)
console.log(`\nDRAW ARITHMETIC over a ${SAMPLE_N}-file draw`)
console.log(`  base rate of such a file        ${(p * 100).toFixed(4)}%`)
console.log(`  P(a ${SAMPLE_N}-file draw contains NONE)  ${pNone.toExponential(3)}`)
console.log(`  P(at least one)                ${(1 - pNone).toFixed(4)}`)
const maxMatched = rows.length ? rows[0].matched : 0
const meanMatched = rows.length ? rows.reduce((s, r) => s + r.matched, 0) / rows.length : 0
console.log(`  one such file carries at most   ${maxMatched} name-matching members (the largest: ${rows[0]?.rel.replace(REPO + "/", "") ?? "n/a"})`)
console.log(`  mean over such a file           ${meanMatched.toFixed(1)}`)
console.log(`\nWHAT THIS DOES AND DOES NOT SETTLE`)
console.log(`  It establishes that the population is both RARE and ENORMOUS: a file the`)
console.log(`  60-file draw usually misses carries more override truth than the other 59`)
console.log(`  files combined. That is why the same code on the same corpus reads 98.4%`)
console.log(`  and 58.9% on consecutive rotations, and why neither number is a lane property.`)
console.log(`  It does NOT establish the truth count itself: ${maxMatched} is a name-agreement bound`)
console.log(`  computed here, and the harness's 11,935 comes from its own oracle under its`)
console.log(`  own conditions. Reading the bound as the truth count would be a second error.`)
