/**
 * WHICH `contains` (at-rule scope) OCCURRENCES PUBLISH NO EDGE, AND WHY.
 *
 * ## The question pass 12 left open
 *
 * `css-emitted-coverage.ts` reports, per scoped at-rule, an ATTRIBUTABLE count
 * (rule_set occurrences in a NAMED scope whose selector name this file publishes
 * as a symbol) against the PUBLISHED edge count:
 *
 *   isMediaScope      attributable 34,798   published 32,224   -2,574
 *   isSupportsScope   attributable  1,188   published    368   -  820
 *   isLayerScope      attributable    329   published    508   +  179
 *   isContainerScope  attributable    142   published    142     -  0
 *
 * `isContainerScope` reconciles exactly and `isLayerScope` over-publishes, so the
 * instrument's two sides DO share a denominator. The media and supports deficits
 * are therefore a real absence of edges, not a definitional gap — 3,394
 * occurrences sit in a named scope, carry a name this file publishes, and produce
 * no edge.
 *
 * The census COLLECTS those occurrences into `containsResidual` but, until this
 * pass, never printed that map: five residual maps were dumped and the sixth —
 * the largest — was not, which is why the deficit survived twelve passes with a
 * number attached and no shape.
 *
 * ## What is being told apart
 *
 * Each unmatched occurrence is classified by the earliest reason that explains
 * it, so the classes are disjoint and sum to the deficit:
 *
 *   NAME-MISMATCH      the scope's symbol name this file publishes is not the one
 *                      the occurrence was attributed under (a name the analyzer
 *                      built differently)
 *   SAME-NAME-REPEAT   an edge for this (scope, selector) pair exists, so this
 *                      occurrence collapsed onto it — the analyzer emits per
 *                      OCCURRENCE and the store key is what deduplicates
 *   COMPOSED           the occurrence's own selector carries a nesting `&`, so the
 *                      name the analyzer publishes is the RESOLVED one and cannot
 *                      equal the as-written text
 *   NO-SCOPE-EDGE      none of the above: a real absence
 *
 * The classifier reads only the published symbol/edge sets and the grammar tree.
 * It does NOT replicate `processRuleSet`'s guards, so it can disagree with the
 * analyzer — which is the property an attribution instrument must keep.
 *
 * ## Rules honoured
 *
 * PRODUCTION `parseFile` for the published side. Zero regular expressions: every
 * split, trim and comparison is a character walk or a node-type test.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const LIMIT = Number(process.argv[2] ?? 120)
const SIZE_CAP = 512 * 1024
const WASM = path.join(process.cwd(), "wasm", "tree-sitter-css.wasm")

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

function isOpen(c: string): boolean {
  return c === "(" || c === "[" || c === "{"
}
function isClose(c: string): boolean {
  return c === ")" || c === "]" || c === "}"
}

/** Top-level comma parts, depth-tracked across (), [], {} and quotes. */
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

/** The comma group as published-vs-source reconciliation key: every space removed. */
function groupKey(s: string): string {
  const joined = topLevelParts(s).join(" ")
  let out = ""
  for (const ch of joined) {
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f") continue
    out += ch
  }
  return out
}

/** Does this selector text carry a nesting `&` outside any bracket/quote? */
function hasNestingAmp(s: string): boolean {
  let depth = 0
  let quote = ""
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
    else if (c === "&" && depth === 0) return true
  }
  return false
}

function kids(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

/**
 * The at-rule's own keyword.
 *
 * Two node shapes, and reading only one of them is what made the first version of
 * this probe report NAME-MISMATCH on 4,757 of 4,757 occurrences — a round 100%,
 * which is the signature of the instrument disagreeing with itself rather than a
 * finding about the analyzer.
 *
 *   at_rule / layer_statement   a NAMED `at_keyword` child holds "@layer"
 *   media_statement             NO named keyword child exists. Measured on
 *   supports_statement          `@media (min-width:768px){…}`: the children are
 *                               `feature_query`, `block` — the `@media` token is
 *                               ANONYMOUS. An `at_keyword`-only reader returns ""
 *                               and then builds the name as `"" + " " + prelude`,
 *                               i.e. `" @media (min-width:768px)"`, which matches no
 *                               published symbol in any file. It is a comma query
 *                               that shows the splice outright: a `keyword_query`
 *                               reader produced
 *                               `"print a screen and (min-width: 769px),print"`.
 *
 * So the keyword is taken from the first child INCLUDING anonymous ones, and is
 * accepted only when it begins with `@` — a character test, no pattern.
 */
function atKeywordOf(n: any): string {
  for (const c of kids(n)) {
    if (c.type === "at_keyword") return c.text.trim().toLowerCase()
  }
  const first = n.child(0)
  if (first) {
    const t = first.text.trim().toLowerCase()
    if (t.length > 0 && t.charAt(0) === "@") return t
  }
  return ""
}

/**
 * The scope SYMBOL NAME, replicated from `processAtRule`: the keyword plus the
 * at-rule's own prelude — source text between the keyword and its block or `;`.
 */
function scopeSymbolName(n: any): string {
  const kw = atKeywordOf(n)
  const text = n.text
  let cut = text.length
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i)
    if (ch === "{" || ch === ";") {
      cut = i
      break
    }
  }
  const prelude = collapseSpace(text.slice(kw.length, cut))
  return prelude.length > 0 ? `${kw} ${prelude}` : kw
}

/**
 * The analyzer's own reachability predicate for a scope NAME: the at-rule has a
 * child that is a QUERY. A scoped at-rule with no query child returns null,
 * publishes no scope symbol, and its rules get no `contains` edge.
 *
 * For `@supports` the test is the complement — any child that is not the block,
 * the at_keyword or a bare `@supports` marker. That asymmetry is the analyzer's,
 * and it is replicated rather than smoothed, because smoothing it would change
 * the denominator this probe is measured against.
 */
function scopeHasName(n: any): boolean {
  const isMedia = n.type === "media_statement"
  for (const c of kids(n)) {
    if (isMedia) {
      if (
        c.type === "keyword_query" || c.type === "binary_query" || c.type === "feature_query" ||
        c.type === "parenthesized_query" || c.type === "unary_query" || c.type === "selector_query"
      ) {
        return true
      }
    } else {
      if (c.type !== "block" && c.type !== "at_keyword" && c.type !== "@supports" && c.text.trim() !== "@supports") {
        return true
      }
    }
  }
  return false
}

/** Every rule_set in this node's subtree, INCLUDING itself if it is one. */
function deepRuleSets(n: any): any[] {
  const out: any[] = []
  const stack: any[] = [n]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (cur.type === "rule_set") out.push(cur)
    const cs = kids(cur)
    for (let i = cs.length - 1; i >= 0; i--) stack.push(cs[i])
  }
  return out
}

/** The `selectors` child's text, or "" when the node has none. */
function selectorsText(rs: any): string {
  for (const c of kids(rs)) if (c.type === "selectors") return c.text
  return ""
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

console.log(`css at-rule-scope shortfall probe — attributable occurrences that publish no edge`)
console.log(`corpus ${files.length} css files; stride sample ${picked.length} (stride ${stride})\n`)

interface Bucket {
  n: number
  files: Set<string>
  examples: string[]
}
const buckets = new Map<string, Bucket>()
const perFile: { repo: string; rel: string; counts: Record<string, number> }[] = []
const EXAMPLES = 3

function bucket(key: string, file: string, example: string) {
  let b = buckets.get(key)
  if (!b) {
    b = { n: 0, files: new Set(), examples: [] }
    buckets.set(key, b)
  }
  b.n++
  b.files.add(file)
  if (b.examples.length < EXAMPLES) b.examples.push(example)
}

let parsed = 0
let failures = 0
let degraded = 0
let attributable = 0
let publishedScopeEdges = 0

for (const f of picked) {
  const label = `${f.repo}/${f.rel}`
  const src = readFileSync(f.abs, "utf8")
  let res: any
  try {
    res = await parseFile(f.abs, src, "css")
  } catch {
    failures++
    continue
  }
  parsed++
  if (res?.symbols?.[0]?.metadata?.fallback === true || (res as any)?.degraded === true) degraded++

  const syms: any[] = (res?.symbols ?? []) as any[]
  const rels: any[] = ((res as any)?.relationships ?? []) as any[]

  // The scope-name set is built from TWO sources because NEITHER alone is sufficient,
  // and two earlier versions of this probe each used one and were wrong:
  //
  //   symbol.metadata   EMPTY. Measured on
  //                     `Documenter.jl/assets/html/themes/catppuccin-mocha.css`:
  //                     2,614 symbols, and every scope symbol's `metadata` is `{}` —
  //                     `parseFile` keeps a RELATIONSHIP's metadata and drops the
  //                     symbol's. Keying on it yields an EMPTY set, so all 600
  //                     occurrences read as NAME-MISMATCH against `(none)`, which is
  //                     exactly what the third run printed.
  //   symbol.kind       a scope symbol is `module` (@media/@layer/@container) or
  //                     `interface` (@supports). Kinds DO survive parseFile.
  //
  // The edge SOURCES are added as well, so a scope whose block published no rule of
  // its own is still recognised as published instead of reading as absent.
  const publishedScopeNames = new Set<string>()
  const publishedSelNames = new Set<string>()
  const edgePairs = new Set<string>()
  for (const s of syms) {
    const nm = typeof s?.name === "string" ? s.name : ""
    if (nm.length === 0) continue
    publishedSelNames.add(groupKey(nm))
    if ((s.kind === "module" || s.kind === "interface") && nm.charAt(0) === "@") publishedScopeNames.add(nm)
  }
  for (const r of rels) {
    const m = r?.metadata ?? {}
    if (!(m.isMediaScope || m.isSupportsScope || m.isLayerScope || m.isContainerScope || m.isScopeScope)) continue
    publishedScopeEdges++
    if (typeof r.source === "string" && r.source.charAt(0) === "@") publishedScopeNames.add(r.source)
    edgePairs.add(`${r.source}\u0000${groupKey(r.target ?? "")}`)
  }

  const tree = parser.parse(src)
  const counts: Record<string, number> = {}

  function visit(n: any) {
    if (n.type === "media_statement" || n.type === "supports_statement") {
      if (scopeHasName(n)) {
        const scopeName = scopeSymbolName(n)
        const key = n.type === "media_statement" ? "isMediaScope" : "isSupportsScope"
        for (const rs of deepRuleSets(n)) {
          const raw = selectorsText(rs)
          if (raw.length === 0) continue
          const gk = groupKey(raw)
          if (!publishedSelNames.has(gk)) continue // not attributable; counted by the census
          attributable++
          if (edgePairs.has(`${scopeName}\u0000${gk}`)) continue
          // ---- the occurrence is attributable and has no edge: classify it
          const line = rs.startPosition.row + 1
          const where = `${label}:${line}`
          // The scope names this file ACTUALLY published, so a NAME-MISMATCH row can be
          // read against what the analyzer produced rather than only asserting a
          // disagreement. Without it the class is a claim; with it, it is a diff.
          const actual: string[] = []
          for (const nm of publishedScopeNames) if (actual.length < 4) actual.push(nm)
          const actualTxt = actual.length === 0 ? "(none)" : actual.map((x) => JSON.stringify(x.slice(0, 46))).join(", ")
          if (!publishedScopeNames.has(scopeName)) {
            counts["NAME-MISMATCH"] = (counts["NAME-MISMATCH"] ?? 0) + 1
            bucket(`${key} NAME-MISMATCH — scope name "${scopeName}" is not a symbol this file publishes`, where,
              `${where}\n                 expected=${JSON.stringify(scopeName.slice(0, 60))}\n                 published=${actualTxt}\n                 selector=${JSON.stringify(raw.slice(0, 50))}`)
          } else if (hasNestingAmp(raw)) {
            counts["COMPOSED"] = (counts["COMPOSED"] ?? 0) + 1
            bucket(`${key} COMPOSED — occurrence carries a nesting "&", so the published name is the RESOLVED one`, where,
              `${where}  scope=${JSON.stringify(scopeName.slice(0, 40))} selector=${JSON.stringify(raw.slice(0, 50))}`)
          } else {
            counts["NO-SCOPE-EDGE"] = (counts["NO-SCOPE-EDGE"] ?? 0) + 1
            bucket(`${key} NO-SCOPE-EDGE — attributable, scope name published, selector as written: no edge`, where,
              `${where}  scope=${JSON.stringify(scopeName.slice(0, 40))} selector=${JSON.stringify(raw.slice(0, 50))}`)
          }
        }
      }
    }
    const cs = kids(n)
    for (let i = 0; i < cs.length; i++) visit(cs[i])
  }
  // `tree` is a Tree, not a Node: the root must be taken explicitly. Reading the
  // root off the tree object is what an earlier version of the sibling probe
  // failed to do, and it reported a clean 0 for that reason.
  visit(tree.rootNode)

  if (Object.keys(counts).length > 0) perFile.push({ repo: f.repo, rel: f.rel, counts })
}

console.log(`parsed ${parsed}/${picked.length}, failures ${failures}, degraded ${degraded}`)
console.log(`attributable occurrences in named media/supports scopes: ${attributable}`)
console.log(`published at-rule-scope edges on the same sample:          ${publishedScopeEdges}\n`)

const keys = ["NAME-MISMATCH", "COMPOSED", "NO-SCOPE-EDGE"]
const totals: Record<string, number> = { "NAME-MISMATCH": 0, COMPOSED: 0, "NO-SCOPE-EDGE": 0 }
for (const [k, b] of buckets) {
  const cls = k.indexOf("NAME-MISMATCH") >= 0 ? "NAME-MISMATCH" : k.indexOf("COMPOSED") >= 0 ? "COMPOSED" : "NO-SCOPE-EDGE"
  totals[cls] += b.n
}
console.log("deficit by class (disjoint, earliest reason wins):")
for (const k of keys) console.log(`  ${k.padEnd(16)}${totals[k]}`)
console.log(`  ${"TOTAL".padEnd(16)}${keys.reduce((a, k) => a + totals[k], 0)}`)

console.log("\ndeficit by bucket:")
const rows = [...buckets.entries()].sort((a, b) => b[1].n - a[1].n)
for (const [k, b] of rows) {
  console.log(`  ${String(b.n).padStart(6)} in ${String(b.files.size).padStart(3)} files   ${k}`)
  for (const ex of b.examples) console.log(`             ${ex}`)
}

console.log("\nfiles carrying the deficit, largest first:")
perFile.sort((a, b) => {
  const sa = Object.values(a.counts).reduce((x, y) => x + y, 0)
  const sb = Object.values(b.counts).reduce((x, y) => x + y, 0)
  return sb - sa
})
for (const f of perFile.slice(0, 15)) {
  const parts: string[] = []
  for (const [k, v] of Object.entries(f.counts)) parts.push(`${k}=${v}`)
  console.log(`  ${f.repo}/${f.rel}  ${parts.join(" ")}`)
}
console.log(`  (${perFile.length} files carry at least one unmatched attributable occurrence)`)