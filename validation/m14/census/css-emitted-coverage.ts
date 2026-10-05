/**
 * DOES EVERY GRAMMAR CONSTRUCT AN EMITTED TYPE READ BECOME AN EDGE? — the pass-10 open
 * item, discharged for all five EMITTED types instead of only `imports`.
 *
 * ## Why this file exists
 *
 * Pass 10 found that `imports` had been reported EMITTED with 243 edges while the grammar
 * produced 250 `import_statement` nodes, and fixed the 7. Its own closing paragraph says
 * the other four EMITTED types have no such pairing in this lane's instruments and that
 * "no other type has a 7-edge gap" is therefore NOT a measurement. This file is that
 * measurement, or the closest thing to one that is honestly available.
 *
 * The defect class is specific: a lane that reports EMITTED has claimed COVERAGE, and
 * coverage of an emitted type is only a measured claim if the grammar-side count and the
 * published count are produced by two different code paths and then subtracted. Ten passes
 * of this lane quoted `imports 243` nine times without subtracting.
 *
 * ## The five EMITTED types are NOT five of the same question
 *
 * A grammar node maps onto an edge either ONE-TO-ONE, ONE-TO-MANY, or BY NAME MATCH, and
 * only the first kind makes a subtraction meaningful. Pretending all five are the same is
 * how a lane ends up reporting a "gap" that is really a fan-out. So each type declares its
 * own mapping here, and the printed table carries that declaration:
 *
 * | type        | grammar node                     | mapping                    | delta is a GAP candidate? |
 * | ----------- | -------------------------------- | -------------------------- | ------------------------- |
 * | `imports`   | `import_statement`               | 1:1 (one specifier each)   | yes |
 * | `references`| `call_expression` `var`          | 1:N (one edge per `--x` leaf argument) | yes |
 * | `overrides` | `keyframes_statement` grouped by name | 1:1 per (file, name, keyword) group with >= 2 members | yes |
 * | `contains`  | `media_statement` / `supports_statement` / scoped `at_rule` | 1:N (one edge per contained rule) | yes |
 * | `uses`      | value tokens inside `animation` / `font-family` | BY NAME MATCH — the edge requires a DECLARED target | NO, and the table says so |
 *
 * `uses` is the row that must not be subtracted: an `animation: spin 1s` naming a
 * `@keyframes spin` that the file never declares is correctly NOT an edge, because there
 * is no endpoint to name. The instrument therefore reports the candidate POOL and how much
 * of it matched, and calls the unmatched remainder "no declared target", which is a
 * property of the corpus, not a defect.
 *
 * ## The residual is bucketed by CAUSE, not just counted
 *
 * A raw subtraction cannot tell a dead branch from a store-key collapse from a construct
 * the analyzer deliberately refuses, and those three have different consequences. Every
 * non-zero bucket prints up to 8 concrete `file:line` examples with the node shape that
 * produced them, so each bucket can be read by hand against the file.
 *
 * ## Instrument
 *
 * B: parse-tree count plus production `parseFile`, so the two sides are counted by
 * DIFFERENT code paths. Node-type and named-child navigation only. NOT ONE REGULAR
 * EXPRESSION in this file: a pattern over raw text cannot tell `var(--x)` from the word
 * "var" in a comment, in a class name or in a `content:` value, and `css-extend-lexability.ts`
 * already settled that argument by measuring 46 of 46 `@extend` keywords.
 *
 * The analyzer's own reachability predicates are re-implemented here from its source
 * rather than imported, because importing them would make the comparison a tautology: the
 * instrument would be asking the analyzer whether the analyzer agrees with itself. Where a
 * predicate is subtle (`currentSelector` inheritance) the shape of the ENCLOSING nodes is
 * printed instead of a guessed boolean, so a wrong guess is visible.
 *
 * ## Admission rule
 *
 * Transcribed character-for-character from `css-import-coverage.ts`, which is
 * character-for-character `css-ontology-probe.ts`'s. Do NOT tidy it: the printed file
 * count is what catches admission drift, and it has caught it three times in this lane.
 * Compare the count below against the arbiter's 1,255 before believing anything else here.
 *
 * ## READ-ONLY
 *
 * Writes nothing unless `--json <path>` is given. Prints a report.
 *
 * Run: npx tsx validation/m14/census/css-emitted-coverage.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const jsonAt = argv.indexOf("--json")
const WASM = path.join(process.cwd(), "wasm", "tree-sitter-css.wasm")
const EXAMPLES = 8

// ------------------------------------------------------------------ corpus (transcribed)
const files: { repo: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR).sort()) {
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
    if (detectLanguageFromPath(abs, text) !== "css") continue
    files.push({ repo: e, rel, abs, text })
  }
}
files.sort((a, b) => (a.repo + a.rel < b.repo + b.rel ? -1 : 1))
const repos = new Set(files.map((f) => f.repo))

// ---------------------------------------------------------------------------- parser
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(WASM)))

// ---------------------------------------------------------------------------- shapes

/** Strip CSS quotes by walking the quote characters, not by pattern. */
function unquote(t: string): string {
  let s = t.trim()
  while (s.length >= 2) {
    const a = s.charAt(0)
    const b = s.charAt(s.length - 1)
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      s = s.slice(1, s.length - 1)
      continue
    }
    break
  }
  return s
}

const isDashed = (t: string): boolean => t.trim().startsWith("--")

/** The at-keyword a scoped `at_rule` carries, read from the `at_keyword` child. */
function atKeywordOf(n: any): string {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === "at_keyword") return c.text.trim().toLowerCase()
  }
  return ""
}

/** Direct named children of a node, as an array. */
function kids(n: any): any[] {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}

function isOpenChar(c: string): boolean {
  return c === "(" || c === "[" || c === "{"
}
function isCloseChar(c: string): boolean {
  return c === ")" || c === "]" || c === "}"
}

/**
 * Split a selector into its TOP-LEVEL comma-separated parts, each whitespace-collapsed.
 * Depth is tracked across (), [], {} and quotes so a comma nested inside `:has(a, b)`,
 * `:not(x, y)` or `[href="a,b"]` stays inside its part. Character walk, not a pattern.
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
    if (isOpenChar(c)) depth++
    else if (isCloseChar(c)) depth--
    else if (c === "," && depth === 0) {
      parts.push(collapseSpace(s.slice(start, i)))
      start = i + 1
    }
  }
  parts.push(collapseSpace(s.slice(start)))
  return parts
}

/**
 * The key the `contains` attribution test compares on: the comma group with EVERY space
 * removed from every part.
 *
 * ## Why the attribution test needs this, and why the first version was wrong
 *
 * This test asks whether a published `contains` edge's TARGET is a name this file also
 * publishes as a symbol. Comparing the two as plain strings reported 31,732 attributable
 * against 33,242 published — and the row was labelled "LOWER BOUND on the denominator".
 * A lower bound cannot be exceeded by the quantity it bounds, so the label was wrong and
 * so was the reading of the number built on it. PASS 11 reported the resulting interval
 * [31,732, 36,688] as a BRACKET and declared the branch UNSETTLED on the strength of it.
 *
 * The cause is that the two sides are not the same KIND of string. `real-css-analyzer.ts`
 * line 1522 publishes a group as `resolvedSelectors.join(", ")`, so a minified
 * `.container,.container-sm` is published as `.container, .container-sm`. The grammar's
 * `selectors` node text is the SOURCE text. String equality therefore fails on every
 * comma group in every minified stylesheet, by construction, however correct the edge is.
 * The same join lands inside a nested functional too, because the name is rebuilt from the
 * selectors node's children: `pico/css/pico.classless.indigo.min.css` reads
 * `:has(button:focus,[type=submit]:focus,...)` on the grammar side and
 * `:has(button:focus, [type=submit]:focus, ...)` as published.
 *
 * Collapsing whitespace RUNS is not enough — it was measured at 99.49% with 35 residual
 * edges. Removing every space is what closes it. Depth tracking still matters, so that a
 * part cannot be split in half and rejoined into a string that accidentally matches.
 *
 * What this does NOT do is replicate `processRuleSet`. It reads only the published name and
 * the grammar text, so it can still DISAGREE with the analyzer — which is the property the
 * instrument's header requires and the reason it is not simply an import.
 */
function selectorGroupKey(s: string): string {
  const joined = topLevelParts(s).join(" ")
  let out = ""
  for (const ch of joined) {
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f") continue
    out += ch
  }
  return out
}

/**
 * The scope SYMBOL NAME the analyzer publishes for a scoped at-rule: the keyword plus the
 * at-rule's own prelude — the source text between the keyword and the at-rule's block or
 * terminating `;`, whitespace-collapsed. Replicated from `processAtRule` rather than
 * imported, because the whole point of this instrument is that the two sides are counted
 * by different code. Node text is sliced by index, never matched by pattern.
 *
 * This is needed because the analyzer DEDUPES scope symbols by that name: 500 `@media
 * screen` blocks publish ONE `@media screen` symbol, so the published edge count is a count
 * of DISTINCT (scope symbol, rule symbol) pairs while a raw occurrence count is not.
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
 * The analyzer's OWN reachability predicate for a scope NAME, replicated from
 * `processMedia` / `processSupports`. A scoped at-rule with no matching query child
 * returns null, publishes no scope symbol, and its rules get NO `contains` edge — so the
 * occurrence count has to be filtered through this before it can be compared with the
 * published edge count. Type tests only.
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
      if (
        c.type !== "block" && c.type !== "at_keyword" && c.type !== "@supports" &&
        c.text.trim() !== "@supports"
      ) {
        return true
      }
    }
  }
  return false
}

/** Collapse runs of whitespace by walking characters, not by pattern. */
function collapseSpace(s: string): string {
  let out = ""
  let inSpace = false
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i)
    const isSpace = ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f"
    if (isSpace) {
      if (!inSpace) out += " "
      inSpace = true
    } else {
      out += ch
      inSpace = false
    }
  }
  return out.trim()
}

/**
 * The rule_sets a scoped at-rule CONTAINS. Measured through the `block` child, because
 * that is where the grammar puts them: `media_statement -> block -> rule_set`. The first
 * version of this instrument counted DIRECT `rule_set` children and read 0 against 31,879
 * published edges — a −31,879 "gap" that was entirely this file's bug. The tree shape is
 * printed by `validation/m14/tmp/css-tree-shape.ts`; a subtraction whose two sides are
 * measured with different tree walks is not a measurement.
 *
 * `deep` switches from DIRECT children to the whole subtree. The analyzer attributes a
 * rule to every scope ENCLOSING it, so `@media a { @supports b { .x {} } }` gives two
 * `contains` edges from two different scope symbols and only one direct `rule_set`; the
 * direct count is therefore the wrong denominator and the subtree count is the right one.
 */
function containedRuleSets(n: any, deep = false): any[] {
  const out: any[] = []
  if (deep) {
    const st: any[] = [n]
    while (st.length > 0) {
      const x = st.pop()
      if (x.type === "rule_set") out.push(x)
      for (let i = 0; i < x.namedChildCount; i++) {
        const k = x.namedChild(i)
        if (k) st.push(k)
      }
    }
    return out
  }
  for (const ch of kids(n)) {
    if (ch.type === "rule_set") out.push(ch)
    else if (ch.type === "block") for (const g of kids(ch)) if (g.type === "rule_set") out.push(g)
  }
  return out
}

/**
 * The construct that OWNS a `var()` when no `rule_set` does: the nearest enclosing
 * `keyframes_statement` or `at_rule`, named so a residual bucket is actionable rather
 * than a count. Prints the keyword and the name node's text; both are read from nodes.
 */
function ownerOf(n: any): string {
  let p = n.parent
  while (p) {
    if (p.type === "keyframes_statement") {
      const nm = kids(p).find((c) => c.type === "keyframes_name" || c.type === "identifier" || c.type === "string_value")
      return `keyframes_statement ${nm ? unquote(nm.text) : "(unnamed)"}`
    }
    if (p.type === "at_rule" || p.type === "postcss_statement" || p.type === "namespace_statement" || p.type === "scope_statement") {
      return `${p.type} ${atKeywordOf(p) || "(anonymous)"}`
    }
    if (p.type === "rule_set") return "rule_set (reachable)"
    p = p.parent
  }
  return "stylesheet root (no owner)"
}

/**
 * The enclosing chain of a node, nearest first, as a `type` string. This is what the
 * instrument prints instead of guessing the analyzer's `currentSelector` boolean: if the
 * bucket is wrong, the chain is right there in the example row.
 */
function enclosingChain(n: any, depth = 6): string {
  const chain: string[] = []
  let p = n.parent
  while (p && chain.length < depth) {
    chain.push(p.type)
    p = p.parent
  }
  return chain.join(" < ")
}

// ---------------------------------------------------------------------------- tallies

type Bucket = { n: number; files: Set<string>; examples: string[] }

const bucket = (m: Map<string, Bucket>, key: string, file: string, example: string) => {
  let b = m.get(key)
  if (!b) {
    b = { n: 0, files: new Set(), examples: [] }
    m.set(key, b)
  }
  b.n++
  b.files.add(file)
  if (b.examples.length < EXAMPLES) b.examples.push(example)
}

/** grammar-side facts, per file */
const g = {
  /** `import_statement` nodes */
  importStatements: 0,
  /** `call_expression` with function_name `var` */
  varCalls: 0,
  /** `--x` leaf arguments reachable from a `var()`'s `arguments` child */
  varDashedLeaves: 0,
  varNoArgsChild: 0,
  varNoDashedLeaf: 0,
  /** keyframes groups: (name, keyword) -> declaration lines in this file */
  keyframeGroups: new Map<string, { name: string; keyword: string; lines: number[]; label: string }>(),
  /** keyframes same-name declarations that differ in KEYWORD (correctly not an override) */
  keyframeCrossKeywordSeconds: 0,
  /** scoped at-rule -> direct rule_set children */
  scopePairs: { isMediaScope: 0, isSupportsScope: 0, isLayerScope: 0, isContainerScope: 0, isScopeScope: 0 } as Record<string, number>,
  /** scoped at-rule -> rule_sets at ANY depth: the analyzer attributes a rule to every
   *  ENCLOSING scope, so the subtree count is the denominator that matches its edges */
  scopePairsDeep: { isMediaScope: 0, isSupportsScope: 0, isLayerScope: 0, isContainerScope: 0, isScopeScope: 0 } as Record<string, number>,
  /** DISTINCT (scope symbol name, rule selector text) pairs — the analyzer dedupes scope
   *  symbols by name, so the published edge count is a count of distinct pairs, not of
   *  occurrences. This is the denominator that can actually match it. */
  distinctPairs: {
    isMediaScope: new Set<string>(), isSupportsScope: new Set<string>(), isLayerScope: new Set<string>(),
    isContainerScope: new Set<string>(), isScopeScope: new Set<string>(),
  } as Record<string, Set<string>>,
  /** rule_sets inside a scoped at-rule that DOES yield a scope name — the occurrence count
   *  filtered through the analyzer's own `queryNode` predicate */
  scopeReachable: { isMediaScope: 0, isSupportsScope: 0, isLayerScope: 0, isContainerScope: 0, isScopeScope: 0 } as Record<string, number>,
  /** scoped at-rules with NO reachable scope name, i.e. the rules they hold cannot be attributed */
  scopeNoName: { isMediaScope: 0, isSupportsScope: 0, isLayerScope: 0, isContainerScope: 0, isScopeScope: 0 } as Record<string, number>,
  /** rule_sets held by those name-less scopes — the occurrences that CANNOT become edges */
  scopeUnnamedRuleSets: { isMediaScope: 0, isSupportsScope: 0, isLayerScope: 0, isContainerScope: 0, isScopeScope: 0 } as Record<string, number>,
  /** rule_sets in a NAMED scope whose line IS covered by some published symbol: the
   *  occurrences that could have carried an edge */
  scopeAttributed: { isMediaScope: 0, isSupportsScope: 0, isLayerScope: 0, isContainerScope: 0, isScopeScope: 0 } as Record<string, number>,
  /** rule_sets in a NAMED scope that published NO symbol at all: the analyzer's guards
   *  declined them, so the missing edge is not a skipped edge */
  scopeNoSymbol: { isMediaScope: 0, isSupportsScope: 0, isLayerScope: 0, isContainerScope: 0, isScopeScope: 0 } as Record<string, number>,
  /** `--x` declarations with an enclosing rule_set */
  customPropDecls: 0,
  /** `--x` leaves under a `var()` with no rule_set, split by whether the enclosing
   *  construct publishes a symbol the edge can name */
  leavesOwnedByKeyframes: 0,
  leavesOwnerless: 0,
  /** candidate tokens for the two BY-NAME-MATCH `uses` branches */
  usesCandidates: { isAnimationRef: 0, isFontFamilyRef: 0 } as Record<string, number>,
}

const published = {
  isCssImport: 0,
  isSassModuleImport: 0,
  isVariableRef: 0,
  isKeyframeScopeRef: 0,
  isNamespaceRef: 0,
  isKeyframesRedefinition: 0,
  isPropertyReregistration: 0,
  isCustomPropertyRedefinition: 0,
  isMediaScope: 0,
  isSupportsScope: 0,
  isLayerScope: 0,
  isContainerScope: 0,
  isScopeScope: 0,
  isCustomPropertyScope: 0,
  isSelectorChain: 0,
  isNestedSelector: 0,
  isAnimationRef: 0,
  isFontFamilyRef: 0,
}
const publishedByType: Record<string, number> = {}
const perFilePublished: { label: string; isVariableRef: number; isCssImport: number }[] = []

/** residual buckets */
const resid = {
  /** a `--x` leaf under a `var()` whose enclosing chain carries no rule_set */
  varLeafNoRuleSet: new Map<string, Bucket>(),
  /** a `--x` leaf that SHOULD have produced an edge, bucketed by enclosing chain */
  varLeafResidual: new Map<string, Bucket>(),
  /** per-file shortfall: grammar dashed leaves minus published isVariableRef */
  varPerFileShortfall: new Map<string, Bucket>(),
  importResidual: new Map<string, Bucket>(),
  keyframeResidual: new Map<string, Bucket>(),
  containsResidual: new Map<string, Bucket>(),
  usesUnmatched: new Map<string, Bucket>(),
}

// ---------------------------------------------------------------------- the pass
let filesParsed = 0
let parseFailures = 0
let treeFailures = 0
let degraded = 0

for (const f of files) {
  const label = `${f.repo}/${f.rel}`

  // -- production side
  let r: any = null
  try {
    r = await parseFile(f.abs, path.dirname(f.abs))
  } catch {
    parseFailures++
    continue
  }
  if (!r) {
    parseFailures++
    continue
  }
  filesParsed++
  if (r.fallback === true) degraded++

  const syms: any[] = Array.isArray(r.symbols) ? r.symbols : []
  // Published symbol NAMES, used by the CONTAINS attribution test below. Deliberately
  // the PUBLISHED table rather than a re-implementation of `processRuleSet`'s six
  // early-return guards: re-implementing them would make this a copy of the analyzer, and
  // a copy cannot disagree with what it copies.
  //
  // Two sets, not one. `symbolNames` compares a name AS TEXT; `symbolNameKeys` compares it
  // on `selectorGroupKey`, which is what makes the attribution test survive the analyzer's
  // `join(", ")` normalisation. Both are kept and both are printed, because the gap between
  // them is the measurement: 31,732 attributable by text against 33,242 published was read
  // as a gap, and it is not one — see `selectorGroupKey`.
  const symbolNames = new Set<string>()
  const symbolNameKeys = new Set<string>()
  for (const sy of syms) {
    if (typeof sy.name === "string" && sy.name.length > 0) {
      symbolNames.add(collapseSpace(sy.name))
      symbolNameKeys.add(selectorGroupKey(sy.name))
    }
  }
  const rels: any[] = Array.isArray(r.relationships) ? r.relationships : []
  let pfVar = 0
  let pfImp = 0
  for (const rel of rels) {
    const t = String(rel.type ?? "")
    publishedByType[t] = (publishedByType[t] ?? 0) + 1
    const md = rel.metadata ?? {}
    for (const k of Object.keys(published)) {
      if (md[k] === true) published[k]++
    }
    if (md.isVariableRef === true) pfVar++
    if (md.isCssImport === true) pfImp++
  }
  perFilePublished.push({ label, isVariableRef: pfVar, isCssImport: pfImp })

  // -- grammar side
  let tree: any = null
  try {
    tree = parser.parse(f.text)
  } catch {
    treeFailures++
    continue
  }
  if (!tree) {
    treeFailures++
    continue
  }
  const root = tree.rootNode
  const labelOf = (n: any): string => `${label}:${n.startPosition.row + 1}`

  // walk once, collecting every grammar-side fact
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()

    switch (n.type) {
      case "import_statement": {
        g.importStatements++
        // The analyzer's reachability, replicated: pass 10 made `findImportNameNode` try
        // a DIRECT `string_value`/`call_expression` child first and then fall back to the
        // first such node at ANY depth whose row equals the `@import` KEYWORD's own row.
        // The first version of this file implemented only the direct-child half and so
        // reported 7 statements as "unreachable" that the published count proves are
        // reachable — a false residual manufactured by the instrument, which is the one
        // failure mode a reconciler cannot have.
        let reachable = false
        for (const c of kids(n)) {
          if (c.type === "string_value" || c.type === "call_expression") {
            reachable = true
            break
          }
        }
        if (!reachable) {
          const kw = kids(n).find((c) => c.type === "at_keyword")
          const kwRow = kw ? kw.startPosition.row : -1
          const st: any[] = [n]
          while (st.length > 0 && !reachable) {
            const x = st.pop()
            if (
              x !== n &&
              (x.type === "string_value" || x.type === "call_expression") &&
              x.startPosition.row === kwRow
            ) {
              reachable = true
              break
            }
            for (const c of kids(x)) st.push(c)
          }
        }
        if (!reachable) {
          bucket(
            resid.importResidual,
            `unreachable child shape: ${kids(n).map((c) => c.type).join("+") || "(no named children)"}`,
            label,
            `${labelOf(n)}  children=[${kids(n).map((c) => c.type).join(" ") || "none"}]`,
          )
        }
        break
      }
      case "call_expression": {
        const fn = kids(n).find((c) => c.type === "function_name" || c.type === "identifier")
        if (fn && fn.text.trim() === "var") {
          g.varCalls++
          const args = kids(n).find((c) => c.type === "arguments")
          if (!args) {
            g.varNoArgsChild++
            bucket(resid.varLeafResidual, "var() with NO arguments child", label, `${labelOf(n)}  ${enclosingChain(n)}`)
            break
          }
          // leaves of `arguments` whose text is a custom property name
          let dashed = 0
          const ast: any[] = [args]
          while (ast.length > 0) {
            const a = ast.pop()
            if (a.namedChildCount === 0 && isDashed(a.text)) dashed++
            for (const c of kids(a)) ast.push(c)
          }
          if (dashed === 0) {
            g.varNoDashedLeaf++
            bucket(resid.varLeafResidual, "var() whose arguments hold no `--x` leaf", label, `${labelOf(n)}  ${enclosingChain(n)}`)
            break
          }
          g.varDashedLeaves += dashed
          // does an enclosing rule_set exist? printed, not assumed.
          let p = n.parent
          let inRuleSet = false
          while (p) {
            if (p.type === "rule_set") {
              inRuleSet = true
              break
            }
            p = p.parent
          }
          if (!inRuleSet) {
            const owner = ownerOf(n)
            // Split by whether the owner is a construct the analyzer PUBLISHES a symbol
            // for. A `keyframes_statement` publishes its name, so a read inside one is
            // emitted from that name (the pass-11 fix); a CONSUMING at-rule publishes none
            // by ruling D10, so a read inside one still has no endpoint to name and the
            // leaf stays unattributed. Both numbers are counted here rather than left for a
            // reader to add up.
            if (owner.startsWith("keyframes_statement")) g.leavesOwnedByKeyframes += dashed
            else g.leavesOwnerless += dashed
            bucket(
              resid.varLeafNoRuleSet,
              `${owner.startsWith("keyframes_statement") ? "OWNED (emitted from the keyframes name)" : "OWNERLESS (no published symbol)"}: ${owner}  [${enclosingChain(n)}]`,
              label,
              `${labelOf(n)}  owner=${owner}`,
            )
          }
        }
        break
      }
      case "keyframes_statement": {
        const nameNode = kids(n).find(
          (c) => c.type === "keyframes_name" || c.type === "identifier" || c.type === "string_value",
        )
        if (nameNode) {
          const name = unquote(nameNode.text)
          const kwNode = kids(n).find((c) => c.type === "at_keyword")
          const keyword = kwNode ? kwNode.text.trim().toLowerCase() : "@keyframes"
          const key = `${f.abs} ${name} ${keyword}`
          let grp = g.keyframeGroups.get(key)
          if (!grp) {
            grp = { name, keyword, lines: [], label }
            g.keyframeGroups.set(key, grp)
          }
          grp.lines.push(n.startPosition.row + 1)
        }
        break
      }
      case "declaration": {
        const pn = kids(n).find((c) => c.type === "property_name")
        if (pn && isDashed(pn.text)) {
          let p = n.parent
          let inRuleSet = false
          while (p) {
            if (p.type === "rule_set") {
              inRuleSet = true
              break
            }
            p = p.parent
          }
          if (inRuleSet) g.customPropDecls++
        }
        // `uses` candidate pool: value tokens of an animation / font-family declaration
        const prop = pn ? unquote(pn.text).toLowerCase() : ""
        if (prop === "animation" || prop === "animation-name" || prop === "font-family") {
          const which = prop === "font-family" ? "isFontFamilyRef" : "isAnimationRef"
          const vst: any[] = [n]
          while (vst.length > 0) {
            const v = vst.pop()
            if (v !== n && (v.type === "plain_value" || v.type === "identifier" || v.type === "string_value")) {
              g.usesCandidates[which]++
            }
            for (const c of kids(v)) vst.push(c)
          }
        }
        break
      }
      case "media_statement":
      case "supports_statement": {
        const key = n.type === "media_statement" ? "isMediaScope" : "isSupportsScope"
        const deep = containedRuleSets(n, true)
        g.scopePairs[key] += containedRuleSets(n).length
        g.scopePairsDeep[key] += deep.length
        if (scopeHasName(n)) {
          g.scopeReachable[key] += deep.length
          for (const rs of deep) {
            const line = rs.startPosition.row + 1
            const selText = collapseSpace((kids(rs).find((c) => c.type === "selectors") ?? { text: "" }).text)
            if (symbolNames.has(selText)) g.scopeAttributed[key]++
            else if (symbolNameKeys.has(selectorGroupKey(selText))) g.scopeAttributed[key]++
            else {
              g.scopeNoSymbol[key]++
              bucket(
                resid.containsResidual,
                `rule_set in a NAMED ${n.type} whose selector NAME was never published (a processRuleSet early return, or a composed/nested name)`,
                label,
                `${label}:${line}  selector=${JSON.stringify(selText.slice(0, 70))}`,
              )
            }
          }
        } else {
          g.scopeNoName[key]++
          g.scopeUnnamedRuleSets[key] += deep.length
        }
        const scopeName = scopeSymbolName(n)
        for (const rs of deep) {
          const sel = kids(rs).find((c) => c.type === "selectors")
          g.distinctPairs[key].add(`${scopeName} ${sel ? collapseSpace(sel.text) : ""}`)
        }
        break
      }
      case "at_rule":
      case "scope_statement": {
        const kw = atKeywordOf(n)
        const key =
          kw === "@layer" ? "isLayerScope" : kw === "@container" ? "isContainerScope" : kw === "@scope" ? "isScopeScope" : ""
        if (key) {
          const deep = containedRuleSets(n, true)
          g.scopePairs[key] += containedRuleSets(n).length
          g.scopePairsDeep[key] += deep.length
          if (scopeHasName(n)) {
            g.scopeReachable[key] += deep.length
            for (const rs of deep) {
              const line = rs.startPosition.row + 1
              const selText = collapseSpace((kids(rs).find((c) => c.type === "selectors") ?? { text: "" }).text)
              if (symbolNames.has(selText)) g.scopeAttributed[key]++
              else if (symbolNameKeys.has(selectorGroupKey(selText))) g.scopeAttributed[key]++
              else {
                g.scopeNoSymbol[key]++
                bucket(
                  resid.containsResidual,
                  `rule_set in a NAMED ${kw} whose selector NAME was never published (a processRuleSet early return, or a composed/nested name)`,
                  label,
                  `${label}:${line}  selector=${JSON.stringify(selText.slice(0, 70))}`,
                )
              }
            }
          } else {
            g.scopeNoName[key]++
            g.scopeUnnamedRuleSets[key] += deep.length
          }
          const scopeName = scopeSymbolName(n)
          for (const rs of deep) {
            const sel = kids(rs).find((c) => c.type === "selectors")
            g.distinctPairs[key].add(`${scopeName} ${sel ? collapseSpace(sel.text) : ""}`)
          }
        }
        break
      }
    }

    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }

  // -- per-file residuals for the two 1:1 types
  const dashedHere = countDashedLeaves(root)
  const shortfall = dashedHere - pfVar
  if (shortfall !== 0) {
    bucket(
      resid.varPerFileShortfall,
      shortfall > 0 ? "grammar `--x` leaves EXCEED published edges" : "published edges EXCEED grammar `--x` leaves",
      label,
      `${label}  grammar=${dashedHere} published=${pfVar} delta=${shortfall > 0 ? "+" : ""}${shortfall}`,
    )
  }
}

/** Whole-tree count of `--x` leaves under a `var()`'s arguments, for the per-file subtraction. */
function countDashedLeaves(root: any): number {
  let n = 0
  const stack: any[] = [root]
  while (stack.length > 0) {
    const x = stack.pop()
    if (x.type === "call_expression") {
      const fn = kids(x).find((c) => c.type === "function_name" || c.type === "identifier")
      if (fn && fn.text.trim() === "var") {
        const args = kids(x).find((c) => c.type === "arguments")
        if (args) {
          const ast: any[] = [args]
          while (ast.length > 0) {
            const a = ast.pop()
            if (a.namedChildCount === 0 && isDashed(a.text)) n++
            for (const c of kids(a)) ast.push(c)
          }
        }
      }
    }
    for (let i = x.namedChildCount - 1; i >= 0; i--) {
      const c = x.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return n
}

// ---------------------------------------------------------------------- reconcile
type Rec = {
  type: string
  mapping: string
  grammar: number
  published: number
  delta: number
  gapCandidate: boolean
  note: string
}
const rec: Rec[] = []

// imports — 1:1
rec.push({
  type: "imports",
  mapping: "1:1 per `import_statement`",
  grammar: g.importStatements,
  published: published.isCssImport + published.isSassModuleImport,
  delta: g.importStatements - (published.isCssImport + published.isSassModuleImport),
  gapCandidate: true,
  note: "one specifier per statement; a statement whose specifier is unreachable is a dead branch",
})

// references — 1:N, one edge per `--x` leaf argument
rec.push({
  type: "references",
  mapping: "1:N per `var()` `--x` leaf argument",
  grammar: g.varDashedLeaves,
  published: published.isVariableRef + published.isNamespaceRef,
  delta: g.varDashedLeaves - (published.isVariableRef + published.isNamespaceRef),
  gapCandidate: true,
  note: "leaves under a `var()` with NO enclosing rule_set cannot be reached: `currentSelector` is empty there",
})

// overrides — 1:1 per (file, name, keyword) group with >= 2 members
let kfGroups = 0
let kfCrossKeyword = 0
{
  // same-name groups split by keyword: a group per keyword that has >= 2 declarations
  const byNameKeyword = new Map<string, { name: string; lines: number[]; label: string; keyword: string }[]>()
  for (const grp of g.keyframeGroups.values()) {
    const k = `${grp.label} ${grp.name}`
    const arr = byNameKeyword.get(k) ?? []
    arr.push(grp)
    byNameKeyword.set(k, arr)
  }
  for (const arr of byNameKeyword.values()) {
    let maxLines = 0
    for (const grp of arr) {
      if (grp.lines.length >= 2) maxLines++
      if (grp.lines.length === 1) kfCrossKeyword++
    }
    if (maxLines > 0) kfGroups += maxLines
    if (arr.length > 1) {
      bucket(
        resid.keyframeResidual,
        `same name under ${arr.length} different keyword(s)`,
        arr[0].label,
        `${arr[0].label}  ${arr[0].name}  keywords=${arr.map((x) => x.keyword).join(",")}`,
      )
    }
  }
}
rec.push({
  type: "overrides (keyframes branch)",
  mapping: "1:1 per (file, name, keyword) group with >= 2 declarations",
  grammar: kfGroups,
  published: published.isKeyframesRedefinition,
  delta: kfGroups - published.isKeyframesRedefinition,
  gapCandidate: true,
  note: `${kfCrossKeyword} same-name declarations sit under a DIFFERENT keyword, which the analyzer deliberately does not call an override`,
})

// contains — 1:N per contained rule. Reported against BOTH denominators, because the
// analyzer attributes a rule to every ENCLOSING scope: direct children under-count, and a
// single denominator cannot tell nesting from a gap.
const containsGrammar =
  g.scopePairs.isMediaScope + g.scopePairs.isSupportsScope + g.scopePairs.isLayerScope + g.scopePairs.isContainerScope + g.scopePairs.isScopeScope
const containsGrammarDeep =
  g.scopePairsDeep.isMediaScope + g.scopePairsDeep.isSupportsScope + g.scopePairsDeep.isLayerScope + g.scopePairsDeep.isContainerScope + g.scopePairsDeep.isScopeScope
const containsPublishedScope =
  published.isMediaScope + published.isSupportsScope + published.isLayerScope + published.isContainerScope + published.isScopeScope
rec.push({
  type: "contains (at-rule scope, direct)",
  mapping: "1:N per rule_set DIRECTLY inside a scoped at-rule",
  grammar: containsGrammar,
  published: containsPublishedScope,
  delta: containsGrammar - containsPublishedScope,
  gapCandidate: true,
  note: `superseded by the subtree row; kept because the direct count is what a reader reaches for first, and it is ${(containsGrammarDeep - containsGrammar).toLocaleString("en-US")} short of the subtree count`,
})
rec.push({
  type: "contains (at-rule scope, subtree)",
  mapping: "1:N per rule_set ANYWHERE inside a scoped at-rule",
  grammar: containsGrammarDeep,
  published: containsPublishedScope,
  delta: containsGrammarDeep - containsPublishedScope,
  gapCandidate: true,
  note: "the analyzer attributes a rule to every ENCLOSING scope, so the subtree is the occurrence count its edges are drawn from",
})
const SCOPE_KEYS = ["isMediaScope", "isSupportsScope", "isLayerScope", "isContainerScope", "isScopeScope"]
const containsDistinct = SCOPE_KEYS.reduce((t, k) => t + g.distinctPairs[k].size, 0)
const containsNamed = SCOPE_KEYS.reduce((t, k) => t + g.scopeReachable[k], 0)
const containsAttributed = SCOPE_KEYS.reduce((t, k) => t + g.scopeAttributed[k], 0)
rec.push({
  type: "contains (at-rule scope, ATTRIBUTABLE)",
  mapping: "1:N per rule_set in a named scope whose SELECTOR NAME was published as a symbol, compared on the comma group with whitespace removed",
  grammar: containsAttributed,
  published: containsPublishedScope,
  delta: containsAttributed - containsPublishedScope,
  gapCandidate: true,
  // Every number in this note is computed from the values on this row. The previous
  // version HAND-TYPED them, and three of the four notes on these rows disagreed with the
  // delta column printed beside them once the corpus moved: this row said 1,454 where the
  // column said 1,510, the NAMED row said 3,409 where the column said 3,446, and the
  // distinct row quoted a published count of 31,879 that was two corpus moves stale. A
  // note that restates a measurement instead of deriving it is a second number to keep
  // wrong, so these are template literals now and cannot drift from the column again.
  note:
    `the analyzer NORMALISES a selector group before publishing it (real-css-analyzer.ts joins with ", "), ` +
    `so comparing a published name to the grammar's raw text undercounts every comma group in a minified file. ` +
    `On \`selectorGroupKey\` this row is ${containsAttributed.toLocaleString("en-US")} against ${containsPublishedScope.toLocaleString("en-US")} published, ` +
    `a residual of ${(containsPublishedScope - containsAttributed).toLocaleString("en-US")}. ` +
    `This row was labelled "LOWER BOUND on the denominator" while published EXCEEDED it — a lower bound cannot be ` +
    `exceeded by the quantity it bounds, so the label and the interval PASS 11 reported from it were both wrong.`,
})
rec.push({
  type: "contains (at-rule scope, NAMED)",
  mapping: "1:N per rule_set inside a scoped at-rule that YIELDS A SCOPE NAME",
  grammar: containsNamed,
  published: containsPublishedScope,
  delta: containsNamed - containsPublishedScope,
  gapCandidate: true,
  note:
    `every rule_set in a named scope, including the ones processRuleSet declines at one of its six early returns. ` +
    `Published falls ${(containsNamed - containsPublishedScope).toLocaleString("en-US")} short of it. This is a true UPPER bound: ` +
    `it counts occurrences the analyzer had every opportunity to emit an edge for and did not.`,
})
rec.push({
  type: "contains (at-rule scope, distinct)",
  mapping: "1:1 per DISTINCT (scope symbol name, rule selector text)",
  grammar: containsDistinct,
  published: containsPublishedScope,
  delta: containsDistinct - containsPublishedScope,
  gapCandidate: true,
  note:
    `collapses far too hard (${containsDistinct.toLocaleString("en-US")} against ${containsPublishedScope.toLocaleString("en-US")} published), ` +
    `which is the measurement that shows the analyzer emits per OCCURRENCE and not per distinct pair — the store key ` +
    `collapses the repeats a minified file is made of.`,
})
rec.push({
  type: "contains (custom-property branch)",
  mapping: "1:1 per `--x` declaration under a rule_set",
  grammar: g.customPropDecls,
  published: published.isCustomPropertyScope,
  delta: g.customPropDecls - published.isCustomPropertyScope,
  gapCandidate: true,
  note: "one edge per (selector, custom property); a minified file can collapse pairs on the store key",
})

// uses — BY NAME MATCH, not subtracted
rec.push({
  type: "uses (animation branch)",
  mapping: "BY NAME MATCH — an edge needs a DECLARED @keyframes target",
  grammar: g.usesCandidates.isAnimationRef,
  published: published.isAnimationRef,
  delta: g.usesCandidates.isAnimationRef - published.isAnimationRef,
  gapCandidate: false,
  note: "the unmatched remainder names no @keyframes the file declares, so there is no endpoint to name",
})
rec.push({
  type: "uses (font-family branch)",
  mapping: "BY NAME MATCH — an edge needs a DECLARED @font-face target",
  grammar: g.usesCandidates.isFontFamilyRef,
  published: published.isFontFamilyRef,
  delta: g.usesCandidates.isFontFamilyRef - published.isFontFamilyRef,
  gapCandidate: false,
  note: "same: the unmatched remainder names no @font-face family",
})

// ---------------------------------------------------------------------- report
const out: string[] = []
const say = (s = "") => out.push(s)

say("css EMITTED-type coverage reconciliation — grammar construct vs published edge")
say(`corpus: ${files.length} admitted files across ${repos.size} repos`)
say(`production parseFile: ${filesParsed} parsed, ${parseFailures} failures, ${degraded} degraded`)
say(`tree-sitter: ${filesParsed - treeFailures} trees, ${treeFailures} failures`)
say()
say("A delta is a GAP CANDIDATE only where the mapping is 1:1 or 1:N. The BY NAME MATCH rows")
say("report a pool and a match count and are NOT subtracted — read the `mapping` column.")
say()
say("type                              mapping                                    grammar    published     delta  gap?")
say("-".repeat(120))
for (const r of rec) {
  say(
    `${r.type.padEnd(34)}${r.mapping.padEnd(42)}${String(r.grammar).padStart(8)}${String(r.published).padStart(12)}${String(r.delta > 0 ? "+" + r.delta : r.delta).padStart(10)}  ${r.gapCandidate ? "yes" : "no"}`,
  )
}
say()
for (const r of rec) say(`  ${r.type}: ${r.note}`)

const containsLo = containsAttributed
const containsHi = containsNamed
if (containsLo > containsPublishedScope) {
  say()
  say(`CONTAINS at-rule-scope, SETTLED: published ${containsPublishedScope} vs ${containsLo} attributable rule_sets whose selector name this file publishes.`)
  say(`Delta ${containsLo - containsPublishedScope}. The interval PASS 11 reported as a BRACKET is WITHDRAWN: its lower endpoint was this row,`)
  say(`labelled a lower bound while published exceeded it, which no lower bound can do. See \`selectorGroupKey\`.`)
  say(`The remaining ceiling is the NAMED row: ${containsHi - containsPublishedScope} rule_set occurrences sit in a named scope with no published edge.`)
} else {
  say()
  say(`CONTAINS at-rule-scope: published ${containsPublishedScope} sits inside [${containsLo}, ${containsHi}],`)
  say(`so this instrument CANNOT say whether the ${containsHi - containsPublishedScope} unattributed occurrences are declined rules or skipped edges.`)
  say(`Reported as UNSETTLED with both bounds. Closing it needs the published SELECTOR-NAME mapping, not another count.`)
}

say()
say("per-branch detail")
say("-".repeat(120))
say(`var() call_expressions on the tree:            ${g.varCalls} (in ${new Set(perFilePublished.filter((p) => p.isVariableRef > 0).map((p) => p.label)).size} files carrying a published edge)`)
say(`  with NO arguments child:                    ${g.varNoArgsChild}`)
say(`  whose arguments hold no --x leaf:           ${g.varNoDashedLeaf}`)
say(`  --x leaf arguments (the edge denominator):  ${g.varDashedLeaves}`)
// COUNTS var() CALLS, not leaves: one call can carry more than one `--x` argument, which
// is why the two OWNED/OWNERLESS lines below sum to slightly more than this one.
say(`  var() CALLS with NO enclosing rule_set:     ${sum(resid.varLeafNoRuleSet)}`)
say(`    OWNED by a @keyframes (emitted):           ${g.leavesOwnedByKeyframes}`)
say(`    OWNERLESS, no published symbol (D10):      ${g.leavesOwnerless}`)
say(`  published isKeyframeScopeRef edges:         ${published.isKeyframeScopeRef}`)
say(`import_statement nodes:                       ${g.importStatements}`)
say(`keyframes (file,name,keyword) groups >= 2:    ${kfGroups}`)
say(`same-name declarations under another keyword: ${kfCrossKeyword}`)
say(`scope at-rule -> rule_set pairs (subtree | named | attributable | published | attributable-published):`)
for (const k of ["isMediaScope", "isSupportsScope", "isLayerScope", "isContainerScope", "isScopeScope"]) {
  const dSub = g.scopePairsDeep[k] - published[k]
  say(
    `  ${k.padEnd(20)} subtree ${String(g.scopePairsDeep[k]).padStart(7)}   named ${String(g.scopeReachable[k]).padStart(7)}   attributable ${String(g.scopeAttributed[k]).padStart(7)}   published ${String(published[k]).padStart(7)}   attributable-published ${g.scopeAttributed[k] - published[k] > 0 ? "+" : ""}${g.scopeAttributed[k] - published[k]}`,
  )
}
say(`uses candidate tokens:  animation ${g.usesCandidates.isAnimationRef} -> ${published.isAnimationRef} matched;  font-family ${g.usesCandidates.isFontFamilyRef} -> ${published.isFontFamilyRef} matched`)

const dump = (title: string, m: Map<string, Bucket>) => {
  say()
  say(title)
  say("-".repeat(120))
  if (m.size === 0) {
    say("  (no residual)")
    return
  }
  const rows = [...m.entries()].sort((a, b) => b[1].n - a[1].n)
  for (const [k, b] of rows) {
    say(`  ${String(b.n).padStart(7)} in ${String(b.files.size).padStart(4)} files   ${k}`)
    for (const ex of b.examples) say(`            ${ex}`)
  }
}

dump("RESIDUAL: a `--x` leaf under a `var()` with NO enclosing rule_set, by owner", resid.varLeafNoRuleSet)
dump("RESIDUAL: `var()` shapes that yield no edge at all", resid.varLeafResidual)
dump("RESIDUAL: per-file shortfall, grammar `--x` leaves minus published isVariableRef", resid.varPerFileShortfall)
dump("RESIDUAL: import_statement shapes the analyzer cannot reach", resid.importResidual)
dump("RESIDUAL: same keyframes name under more than one keyword (NOT an override by design)", resid.keyframeResidual)

say()
say("published edges per type, from production parseFile:")
for (const [k, v] of Object.entries(publishedByType).sort((a, b) => b[1] - a[1])) say(`  ${k.padEnd(16)}${v}`)

say()
say("published per metadata flag:")
for (const [k, v] of Object.entries(published).sort((a, b) => b[1] - a[1])) say(`  ${k.padEnd(30)}${v}`)

const text = out.join("\n")
process.stdout.write(text + "\n")
if (jsonAt >= 0) {
  const p = argv[jsonAt + 1]
  if (p) {
    writeFileSync(
      p,
      JSON.stringify(
        {
          corpus: { files: files.length, repos: repos.size, parsed: filesParsed, failures: parseFailures, degraded },
          reconciliation: rec,
          grammar: {
            importStatements: g.importStatements,
            varCalls: g.varCalls,
            varDashedLeaves: g.varDashedLeaves,
            varNoArgsChild: g.varNoArgsChild,
            varNoDashedLeaf: g.varNoDashedLeaf,
            leavesOwnedByKeyframes: g.leavesOwnedByKeyframes,
            leavesOwnerless: g.leavesOwnerless,
            keyframeGroupsGe2: kfGroups,
            keyframeCrossKeywordSeconds: kfCrossKeyword,
            scopePairs: g.scopePairs,
            scopePairsDeep: g.scopePairsDeep,
            scopeReachable: g.scopeReachable,
            scopeNoName: g.scopeNoName,
            scopeUnnamedRuleSets: g.scopeUnnamedRuleSets,
            scopeAttributed: g.scopeAttributed,
            scopeNoSymbol: g.scopeNoSymbol,
            distinctPairs: Object.fromEntries(Object.entries(g.distinctPairs).map(([k, v]) => [k, v.size])),
            customPropDecls: g.customPropDecls,
            usesCandidates: g.usesCandidates,
          },
          published,
          publishedByType,
          residuals: Object.fromEntries(
            Object.entries(resid).map(([k, m]) => [
              k,
              [...m.entries()].map(([key, b]) => ({ bucket: key, n: b.n, files: b.files.size, examples: b.examples })),
            ]),
          ),
        },
        null,
        2,
      ),
    )
    say(`\nwrote ${p}`)
  }
}

function sum(m: Map<string, Bucket>): number {
  let t = 0
  for (const b of m.values()) t += b.n
  return t
}