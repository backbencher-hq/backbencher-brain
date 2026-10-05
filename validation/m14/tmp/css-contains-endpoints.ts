/**
 * WHY PUBLISHED `contains` (at-rule scope) EXCEEDS THE "ATTRIBUTABLE" COUNT,
 * AND WHETHER THAT SURPLUS IS REAL.
 *
 * ## The question
 *
 * validation/m14/census/css-emitted-coverage.ts labels its ATTRIBUTABLE row
 * "LOWER BOUND on the denominator" and reports 31,732 against 33,242
 * published. A lower bound cannot be exceeded by the quantity it bounds. So
 * either the label is wrong, or the count is not measuring the same thing on
 * both sides. This probe decides which.
 *
 * ## The candidate explanation, and it is in the analyzer
 *
 * `real-css-analyzer.ts:1522` publishes a comma group as
 * `resolvedSelectors.join(", ")` — always comma-then-space. The grammar's
 * `selectors` node text is the SOURCE text, so in a minified file it reads
 * `.container,.container-sm` with no space. The census compares those two
 * strings for equality, so every comma group in a minified stylesheet is
 * counted as unattributable BY CONSTRUCTION, no matter how correct the edge is.
 *
 * If that is the whole story the surplus is a MEASUREMENT artifact. If it is
 * not, the surplus is fabricated edges, which is a different finding entirely.
 *
 * ## The test, and why it does not re-implement the analyzer
 *
 * Comparing strings would only reproduce the disagreement. This compares
 * COMMA GROUPS as ordered part lists, each part trimmed — so it agrees with the
 * analyzer on `.a,.b` and `.a, .b` both, without copying the join. A part is
 * split only at TOP-LEVEL commas, tracked by bracket/paren/quote depth, so
 * `:not(a, b)` and `[href="a,b"]` survive intact.
 *
 * The census's own header rule applies here: it must be able to DISAGREE with
 * the analyzer. A test that replicated `processRuleSet`'s guards could not.
 * This one reads only the published name and the grammar text.
 *
 * ## Rules honoured
 *
 * PRODUCTION parseFile for the published side. Zero regular expressions — every
 * split is a character walk.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const LIMIT = Number(process.argv[2] ?? 120)
const SIZE_CAP = 512 * 1024
const WASM = path.join(process.cwd(), "wasm", "tree-sitter-css.wasm")

const SCOPE_FLAGS = ["isMediaScope", "isSupportsScope", "isLayerScope", "isContainerScope", "isScopeScope"]

/** Collapse every whitespace run to one space and trim. Character walk, not a pattern. */
function collapseSpace(s: string): string {
  let out = ""
  let pending = false
  for (const ch of s) {
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f") {
      pending = true
      continue
    }
    if (pending && out.length > 0) out += " "
    pending = false
    out += ch
  }
  return out
}

/** Is this one of the characters that opens or closes a nesting level? */
function isOpen(c: string): boolean {
  return c === "(" || c === "[" || c === "{"
}
function isClose(c: string): boolean {
  return c === ")" || c === "]" || c === "}"
}

/**
 * Split a selector into its top-level comma-separated parts, each trimmed.
 * Depth is tracked across (), [], {} and quotes, so a comma nested inside any
 * of them stays inside its part.
 */
function topLevelParts(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ""
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i)
    if (quote !== "") {
      if (c === "\\") {
        i++
        continue
      }
      if (c === quote) quote = ""
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (isOpen(c)) depth++
    else if (isClose(c)) depth--
    else if (c === "," && depth === 0) {
      parts.push(collapseSpace(s.slice(start, i)))
      start = i + 1
    }
  }
  parts.push(collapseSpace(s.slice(start)))
  return parts
}

/**
 * The comparison key: the comma group as parts joined by one space, with every
 * space removed from each part.
 *
 * Removing ALL whitespace — not merely collapsing runs — is what the evidence
 * demands, and the first two versions of this probe each proved one half of
 * that. `real-css-analyzer.ts:1522` joins a group with `", "`, so a minified
 * `.container,.container-sm` is published as `.container, .container-sm` and
 * collapsing runs is not enough to reconcile it. But the same join also lands
 * INSIDE a nested functional, because the analyzer rebuilds the name from the
 * selectors node's own children: in `pico.classless.indigo.min.css` the
 * grammar reads `:has(button:focus,[type=submit]:focus,...)` and the published
 * name reads `:has(button:focus, [type=submit]:focus, ...)`. Both differences
 * are the analyzer normalising, and neither is an edge that does not belong.
 *
 * Depth tracking still matters: it keeps the split at top level only, so a part
 * cannot be silently broken in half and re-joined into a different string.
 */
function groupKey(s: string): string {
  const joined = topLevelParts(s).join(" ")
  let out = ""
  for (const ch of joined) {
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f") continue
    out += ch
  }
  return out
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
      ents = readdirSync(dir, { withFileTypes: true }) as any
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

console.log(`css contains at-rule-scope endpoint probe — is the ATTRIBUTABLE surplus real?`)
console.log(`corpus ${files.length} css files; stride sample ${picked.length} (stride ${stride})\n`)

let parsed = 0
let failures = 0
let degraded = 0
let published = 0
let verbatim = 0
let groupMatched = 0
let filesWithResidual = 0
const residualShape = new Map<string, number>()
const examples: string[] = []

for (const f of picked) {
  let r: any
  try {
    r = await parseFile(f.abs, "css")
  } catch {
    failures++
    continue
  }
  if (!r) {
    failures++
    continue
  }
  if (r.fallback === true) {
    degraded++
    continue
  }
  parsed++

  const publishedNames = new Set<string>()
  for (const sy of (Array.isArray(r.symbols) ? r.symbols : []) as any[]) {
    if (typeof sy.name === "string" && sy.name.length > 0) publishedNames.add(collapseSpace(sy.name))
  }

  const scopeTargets: string[] = []
  for (const rel of (Array.isArray(r.relationships) ? r.relationships : []) as any[]) {
    if (rel.type !== "contains") continue
    const md = rel.metadata ?? {}
    if (!SCOPE_FLAGS.some((k) => md[k] === true)) continue
    scopeTargets.push(String(rel.target ?? ""))
  }
  published += scopeTargets.length

  let tree: any = null
  try {
    tree = parser.parse(readFileSync(f.abs, "utf8"))
  } catch {
    continue
  }
  if (!tree) continue

  const rawTexts: string[] = []
  const walk = (n: any): void => {
    const kn: any[] = []
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) kn.push(c)
    }
    if (n.type === "rule_set") {
      for (const c of kn) {
        if (c.type === "selectors") {
          rawTexts.push(collapseSpace(c.text))
          break
        }
      }
    }
    for (const c of kn) walk(c)
  }
  walk(tree.rootNode)

  const rawSet = new Set(rawTexts)
  const keySet = new Set(rawTexts.map(groupKey))
  let fileVerbatim = 0
  let fileGroup = 0
  const residualHere: string[] = []
  for (const t of scopeTargets) {
    if (rawSet.has(t)) {
      fileVerbatim++
      fileGroup++
      continue
    }
    if (keySet.has(groupKey(t))) {
      fileGroup++
      continue
    }
    residualHere.push(t)
  }
  verbatim += fileVerbatim
  groupMatched += fileGroup

  if (residualHere.length > 0) {
    filesWithResidual++
    for (const t of residualHere) {
      const isPub = publishedNames.has(t)
      const parts = topLevelParts(t)
      const shape = !isPub
        ? "target is NOT a published symbol name in this file"
        : parts.length > 1
          ? `COMPOSED group of ${parts.length} parts, none matching a grammar selector group`
          : "single-part name, no grammar selector group matches"
      residualShape.set(shape, (residualShape.get(shape) ?? 0) + 1)
    }
    if (examples.length < 30) {
      examples.push(`  ${f.repo}/${f.rel}`)
      examples.push(`      published=${scopeTargets.length} verbatim=${fileVerbatim} groupMatched=${fileGroup} residual=${residualHere.length}`)
      for (const o of residualHere.slice(0, 3)) {
        examples.push(`      residual=${JSON.stringify(o.slice(0, 100))}  publishedSymbol=${publishedNames.has(o)}`)
      }
    }
  }
}

console.log(`parsed ${parsed}  failures ${failures}  degraded ${degraded}`)
console.log(`\npublished scope edges        ${published}`)
console.log(`attributable, STRING equality ${verbatim}   (${pct(verbatim, published)})`)
console.log(`attributable, COMMA-GROUP key ${groupMatched}   (${pct(groupMatched, published)})`)
console.log(`residual after group keying   ${published - groupMatched}`)
console.log(`files with any residual       ${filesWithResidual}`)
if (residualShape.size > 0) {
  console.log(`\nWHAT THE RESIDUAL TARGETS ARE`)
  for (const [k, v] of [...residualShape.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`)
}
if (examples.length > 0) {
  console.log(`\nEXAMPLES`)
  for (const e of examples) console.log(e)
}

function pct(a: number, b: number): string {
  if (b === 0) return "n/a"
  return ((a / b) * 100).toFixed(2) + "%"
}
// ---------------------------------------------------------------------------- store key
//
// The remaining step is from 36,457 attributable occurrences down to 33,242 published
// edges. Two mechanisms could account for it: the analyzer DEDUPES on a store key, or it
// drops occurrences. Counting DISTINCT (source, target) pairs among the PUBLISHED edges
// separates them, and it is a measurement rather than a guess: if published edges are
// already distinct, no collapse happened and the 3,215 were dropped.
console.log(`\nSTORE-KEY TEST — are published scope edges already distinct?`)
let pEdges = 0
let pDistinct = 0
let filesWithDupes = 0
for (const f of picked) {
  let r: any
  try {
    r = await parseFile(f.abs, "css")
  } catch {
    continue
  }
  if (!r || r.fallback === true) continue
  const pairs = new Set<string>()
  let n = 0
  for (const rel of (Array.isArray(r.relationships) ? r.relationships : []) as any[]) {
    if (rel.type !== "contains") continue
    const md = rel.metadata ?? {}
    if (!SCOPE_FLAGS.some((k) => md[k] === true)) continue
    n++
    pairs.add(`${String(rel.source ?? "")}\u0000${String(rel.target ?? "")}`)
  }
  pEdges += n
  pDistinct += pairs.size
  if (pairs.size < n) filesWithDupes++
}
console.log(`  published scope edges      ${pEdges}`)
console.log(`  DISTINCT (source, target)  ${pDistinct}`)
console.log(`  duplicate rows             ${pEdges - pDistinct}`)
console.log(`  files carrying duplicates  ${filesWithDupes} of ${picked.length}`)
console.log(`  => ${pEdges === pDistinct ? "NO COLLAPSE: every published edge is a distinct pair, so the residual is DROPPED OCCURRENCES" : "COLLAPSE PRESENT: the store key merges repeats"}`)
