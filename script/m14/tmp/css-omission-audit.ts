// Review instrument: OMISSION AUDIT.
//
//   bun script/m14/tmp/css-omission-audit.ts
//
// The differential proves the analyzer agrees with `deriveCssEdges`. It does NOT
// prove that relationship extraction is COMPLETE, because the oracle derives its
// truth from the same parse tree the analyzer reads: if BOTH omit a class, the
// differential is silent and reports 100%. That is the shared blind spot, and it
// is the one question "MISSING=0" cannot answer.
//
// So this enumerates relationship-bearing constructs from the CSS LANGUAGE —
// not from the analyzer, and not from the oracle — and for each asks three
// separate questions:
//
//   occurs      how many real corpus files contain it (a construct that occurs
//               nowhere cannot be an omission in practice)
//   emitted     does the analyzer produce a symbol AND a relationship for it
//   oracle      does deriveCssEdges derive a truth row for it
//
// `emitted` and `oracle` are reported SEPARATELY on purpose. When both are "no",
// that is the interesting cell: a class nothing checks. When emitted is "no" and
// oracle is "yes", the differential already reports it as MISSING. Only the first
// cell is invisible to every existing gate, and it is the cell this instrument
// exists to make visible.

import { readFileSync, readdirSync } from "fs"
import { join } from "path"
import { Parser, Language } from "web-tree-sitter"
import { deriveCssEdges } from "../../../script/m14/differential"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = "<corpus-root>/bb_tests/repositories"
const REPOS = ["svelte", "grails-core", "scala3", "proxicall"]

await Parser.init()
const lang = await Language.load(readFileSync("wasm/tree-sitter-css.wasm"))
const p = new Parser()
p.setLanguage(lang)

function walk(d: string, out: string[] = []): string[] {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const f = join(d, e.name)
    if (e.isDirectory()) walk(f, out)
    else if (e.name.endsWith(".css") || e.name.endsWith(".scss") || e.name.endsWith(".less")) out.push(f)
  }
  return out
}

/**
 * Every construct in CSS that NAMES another thing, and therefore could in
 * principle be a relationship. `re` is matched per line so a file counts once.
 * `expect` is what the language says should be derivable — not what the analyzer
 * happens to do.
 */
const CANDIDATES: { id: string; re: RegExp; expect: string }[] = [
  { id: "font-family used vs @font-face declared", re: /^\s*font-family\s*:/im, expect: "`uses` from a rule to a @font-face it declares — the exact analogue of animation -> @keyframes, which IS emitted" },
  { id: "@font-face declaration", re: /@font-face/gi, expect: "a `variable` symbol for the family" },
  { id: "@font-face unicode-range", re: /unicode-range\s*:/i, expect: "payload; no endpoint" },
  { id: "@import", re: /@import\b/g, expect: "`imports` file -> target" },
  { id: "@import with a media query", re: /@import\s+[^\n]*\s(screen|print|all)\b/i, expect: "`imports`, plus the condition as payload" },
  { id: "@use (scss)", re: /@use\s+['\"]/g, expect: "`imports`" },
  { id: "@forward (scss)", re: /@forward\s+['\"]/g, expect: "`imports`" },
  { id: "@mixin declaration (scss)", re: /@mixin\s+[\w-]+/g, expect: "a `function` symbol" },
  { id: "@include (scss)", re: /@include\s+[\w-]+/g, expect: "`uses` -> the mixin" },
  { id: "@extend (scss)", re: /@extend\s+[%.\w-]+/g, expect: "`references` -> the extended selector" },
  { id: "%placeholder selector (scss)", re: /^\s*%[\w-]+/gm, expect: "a symbol for the placeholder" },
  { id: "$scss variable", re: /\$[\w-]+\s*:/g, expect: "a `variable` symbol (NOT parseable by this grammar — see CSS-L1)" },
  { id: "@media", re: /@media\b/g, expect: "a `module` scope symbol + `contains`" },
  { id: "@supports", re: /@supports\b/g, expect: "an `interface` scope symbol + `contains`" },
  { id: "@layer with a block", re: /@layer\s+[\w.-]+\s*\{/g, expect: "a `module` symbol + `contains`" },
  { id: "@layer statement (ordering)", re: /@layer\s+[^;{]+;/g, expect: "layer ORDER is a fact; no endpoint unless the layers are declared" },
  { id: "@container", re: /@container\b/g, expect: "a `module` scope symbol + `contains`" },
  { id: "@scope", re: /@scope\b/g, expect: "a scope symbol + `contains`" },
  { id: "@keyframes", re: /@keyframes\b/g, expect: "a `function` symbol for the name" },
  { id: "animation referencing it", re: /^\s*animation(-name)?\s*:/gim, expect: "`uses` -> a DECLARED keyframes only" },
  { id: "custom property declaration", re: /^\s*--[\w-]+\s*:/gm, expect: "a `variable` symbol + `contains`" },
  { id: "var() read", re: /var\(\s*--/g, expect: "`references` -> the property" },
  { id: "@property registration", re: /@property\b/g, expect: "a `variable` symbol; a var() read of it is still `references`" },
  { id: "@namespace", re: /@namespace\b/g, expect: "a `variable` symbol for the prefix" },
  { id: "grid line names", re: /\[[\w-]+\]/g, expect: "payload (CSS-D6); no endpoint" },
  { id: "@counter-style", re: /@counter-style\b/g, expect: "a symbol for the counter name" },
  { id: "@page", re: /@page\b/g, expect: "NONE — CSS-D9, not nameable" },
  { id: "@starting-style", re: /@starting-style\b/g, expect: "NONE — CSS-D9, not nameable" },
  { id: "@charset", re: /@charset\b/g, expect: "NONE — CSS-D5, an encoding declaration" },
  { id: "universal selector *", re: /^\s*\*\s*[,{]/gm, expect: "NONE — CSS-D5, matches everything" },
  { id: "@tailwind / @apply (build)", re: /@(tailwind|apply)\b/g, expect: "NONE — a build-tool directive, not a declaration" },
  { id: "@custom-media (postcss)", re: /@custom-media\b/g, expect: "a symbol for the named media" },
  { id: "@font-feature-values", re: /@font-feature-values\b/g, expect: "a symbol for the feature family" },
  { id: "composes (not css)", re: /composes\s*:/g, expect: "N/A — not a CSS construct" },
]

interface Row { id: string; expect: string; files: number; occurrences: number; symbols: number; rels: number; truthRows: number; egFile: string; verdict: string }
// every row exists BEFORE any pass reads it — created lazily, the second pass
// indexed into a row the first pass had not made yet
/**
 * The verdict for each construct, adjudicated by hand against a minimal
 * reproduction. Recorded HERE rather than left as a suspicion, because this
 * instrument's token heuristic produces BOTH false positives and false negatives:
 * it matches a construct's TEXT against symbol and target names, so `var( --x)`
 * scores 0 edges (the target is `--x`, which does not contain the word "var") even
 * though the lane emits 13,218 `var()` reference edges, and `@keyframes` scores 0
 * even though the lane emits 103 animation `uses`.
 *
 * So a "blind" cell from this script is a CANDIDATE, never a finding. This table
 * is what turns it into a record, and it is why two cells that read as blind are
 * listed as covered.
 */
const VERDICTS: Record<string, string> = {
  "font-family used vs @font-face declared": "COVERED — was an OMISSION until this audit: 135 files use a `font-family`, 21 declare an `@font-face`, and nothing connected them. Now 90 `uses` edges corpus-wide.",
  "@font-face declaration": "COVERED — 344 family symbols published; the `uses` edges that connect them were the omission this audit found.",
  "var() read": "COVERED — 13,218 `references` edges corpus-wide. The 0 here is the token heuristic: the target is `--bg-1`, which does not contain the word `var`.",
  "@keyframes": "COVERED — 103 `uses` edges corpus-wide; the symbol is named after the ANIMATION (`spin`), not the keyword, so the heuristic misses it.",
  "@import": "COVERED — 18 `imports` edges; the heuristic scores 0 because the target is `base.css`, not `@import`.",
  "@layer with a block": "COVERED — 7,601 `contains` edges; the heuristic scores 0 because the target is the rule (`.btn`), not the keyword.",
  "universal selector *": "RULED — CSS-D5. `*` matches every element, so a symbol named `*` is the anonymous-structural-tag noise the HTML lane already ruled out. Silent BY CONTRACT.",
  "@page": "RULED — CSS-D9. Not nameable by anything in CSS, so a `contains` edge from one would name a node that cannot exist.",
  "@starting-style": "RULED — CSS-D9, same reason.",
  "@charset": "RULED — CSS-D5. An encoding declaration, not a construct.",
  "@tailwind / @apply (build)": "RULED — a build-tool directive, not a declaration. D10: these were 71 FABRICATED `module` symbols in a 148-file sample before the ruling.",
  "$scss variable": "DECLARED LIMITATION — CSS-L1. The CSS grammar does not support SCSS: 42 of 244 real `.scss` files parse clean (17.2%), and 82.8% of the lane's routed files do not parse.",
  "@use (scss)": "DECLARED LIMITATION — CSS-L1, same cause. 0 occurrences in `.css` files.",
  "@forward (scss)": "DECLARED LIMITATION — CSS-L1.",
  "@mixin declaration (scss)": "DECLARED LIMITATION — CSS-L1.",
  "@include (scss)": "DECLARED LIMITATION — CSS-L1.",
  "@extend (scss)": "DECLARED LIMITATION — CSS-L1.",
  "%placeholder selector (scss)": "DECLARED LIMITATION — CSS-L1.",
  "@property registration": "COVERED — published under the property's OWN name (`--brand`) so a `var(--brand)` read resolves. Was a DANGLING endpoint until this audit: 273 registrations, every read dangling.",
  "@namespace": "COVERED — was PARTIAL until this pass. A selector using a DECLARED prefix now references the declaration: `svg|a` -> `@namespace svg url(…)`. Resolvable both ends, order-independent (prefixes pre-collected), and the shared M59 oracle learned the token rule with self-tests in both directions.",
  "grid line names": "RULED — CSS-D6. A named grid line is a layout name, not a declaration site; it rides the property's payload.",
  "@layer statement (ordering)": "COVERED — was an OMISSION until this pass. `@layer reset, base, components;` published ONE symbol named after the whole statement text (`@layer reset, base, components`): a name with no referent (M60 R7) that also DUPLICATED the individually declared layers. A layer is now ONE symbol however many times it is mentioned, the cascade position rides it as `layerIndex`, and the block form corrects the range to the block. Pinned per-name by `expectSymbolCount` in the layer fixture.",
  "@supports": "COVERED — was an OMISSION until the corpus rotation sampled it: 16 `@supports` scope symbols published and **0** `contains` edges, while `@media` emitted 2,921. `@supports` is a conditional scope, so it now emits the same `contains` edge (1,376 of them) with its own `isSupportsScope` metadata.",
  "@media": "COVERED — 2,921 `contains` edges, 100% both-endpoint resolution.",
  "@supports": "COVERED — 1,390 `interface` scope symbols.",
  "custom property declaration": "COVERED — 3,999 `contains` edges into `variable` symbols.",
  "animation referencing it": "COVERED — 103 `uses` edges, and only for keyframes the file DECLARES.",
  "imports": "COVERED — see `@import`.",
  "@import with a media query": "COVERED — 9 `imports` edges; the condition rides the edge's metadata.",
  "@container": "COVERED — 11 `contains` edges; note a NAMED `@container` does not parse (a catalogued residual).",
  // These four were NO OCCURRENCE and a probe then found THREE of them broken. The
  // label was not a claim of correctness, it was an admission that the corpus is
  // silent — and it was read as an all-clear long enough for a real defect class
  // (a declaring at-rule that publishes nothing) to sit in the lane unfixed. Each
  // verdict below names the FIX and the fixture that now exercises it, so the cell
  // is answered by evidence rather than by the corpus's silence.
  "@counter-style": "COVERED (was NO OCCURRENCE, and was BROKEN) — the census cannot speak about it, so a probe did: it declared a named, referable thing and published no symbol at all, so `list-style: thumbs` had no endpoint. Now publishes `variable` + isCounterStyleDeclaration, and `list-style`/`list-style-type` emit a `uses` edge. Pinned by validation/m14/fixtures/css/declarations-the-corpus-never-uses.",
  "@custom-media (postcss)": "COVERED (was NO OCCURRENCE, and was BROKEN TWICE) — published no symbol, AND the pinned grammar could not parse it at all (4 errors; the grammar contains 0 mentions of `custom-media`, because an at-rule prelude had to be a comma-separated query list). Grammar patch 4/4 allows a leading identifier run, aliased to `keyword_query` so no visible node type is added; A/B 0 regressed / 0 collateral / 0 shape deltas. Now publishes `variable` named `--narrow` (the ident, not the condition) and `@media (--narrow)` emits `references`. Same fixture.",
  "@font-feature-values": "COVERED (was NO OCCURRENCE, and was BROKEN TWICE) — published no symbol, and the grammar could not parse it (6 errors). Same grammar patch 4/4. Now publishes `variable` + isFontFeatureValuesDeclaration, and a `font-feature-settings` inside a `@font-face` emits `uses`. A RULE-level one deliberately does not, because which family's feature it names depends on the cascade. Same fixture.",
  "@scope": "COVERED (was NO OCCURRENCE, but was already working) — the analyzer handled it (isScopeScope); the corpus simply has none, so it was unexercised rather than verified. Now exercised by the same fixture, so 'unexercised' is no longer a category anything sits in.",
  "@font-face unicode-range": "RULED — payload on the `@font-face` declaration; no endpoint.",
  "composes (not css)": "N/A — not a CSS construct.",
}

const rows: Row[] = CANDIDATES.map((c) => ({
  id: c.id, expect: c.expect, files: 0, occurrences: 0, symbols: 0, rels: 0, truthRows: 0, egFile: "",
  verdict: VERDICTS[c.id] ?? "UNADJUDICATED — a construct with no verdict is a cell this audit has not settled.",
}))
const rowOf = (id: string): Row => rows.find((r) => r.id === id)!
const filesByCandidate = new Map<string, Set<string>>()
for (const c of CANDIDATES) filesByCandidate.set(c.id, new Set())

let scannedCss = 0
for (const repo of REPOS) {
  for (const f of walk(join(ROOT, repo))) {
    const src = readFileSync(f, "utf8")
    if (!src.trim()) continue
    const isCss = f.endsWith(".css")
    if (isCss) scannedCss++
    const rel = f.replace(ROOT + "/", "")
    for (const c of CANDIDATES) {
      c.re.lastIndex = 0
      const m = src.match(c.re)
      if (m && m.length) {
        const set = filesByCandidate.get(c.id)!
        if (!set.has(rel)) { set.add(rel); }
        const row = rowOf(c.id)
        row.occurrences += m.length
        if (!row.egFile) row.egFile = rel
      }
    }
  }
}

// now the analyzer + oracle pass, css files only
for (const repo of REPOS) {
  for (const f of walk(join(ROOT, repo))) {
    if (!f.endsWith(".css")) continue
    const src = readFileSync(f, "utf8")
    if (!src.trim()) continue
    const rel = f.replace(ROOT + "/", "")
    let r: any
    try { r = await ASTEngine.parseFile(f, src) } catch { continue }
    const symNames = new Set((r.symbols ?? []).map((s: any) => String(s.name)))
    const rels = r.relationships ?? []
    const tree = p.parse(src)
    const mod = f.split("/").pop() || "styles"
    const truth = deriveCssEdges(tree.rootNode, mod)
    tree.delete?.()

    for (const c of CANDIDATES) {
      if (!filesByCandidate.get(c.id)?.has(rel)) continue
      const row = rowOf(c.id)
      // Does a SYMBOL for the construct's name exist, and does a RELATIONSHIP
      // involve it? Both are counted, because "emitted" means the analyzer
      // published the construct, not that it invented an edge for it.
      for (const s of r.symbols ?? []) {
        const n = String(s.name)
        if (n.includes("@font-face") || n.includes("@property") || n.includes("@counter-style") || n.includes("@namespace") || n.includes("@custom-media") || n.includes("@font-feature-values")) {
          if (/font|propert|counter|namespace|media|feature/i.test(n)) symNames.add(n)
        }
      }
      const cRe = CANDIDATES.find((x) => x.id === c.id)!.re
      cRe.lastIndex = 0
      const hits = src.match(cRe) ?? []
      // count, per file, how many of the construct's occurrences produced a symbol
      // whose name shares a token with the construct
      for (const s of r.symbols ?? []) {
        const n = String(s.name)
        for (const h of hits.slice(0, 40)) {
          const key = h.replace(/[@$%{}()\s:;,.'"\\]+/g, "")
          if (key.length >= 2 && n.includes(key)) { row.symbols++; break }
        }
      }
      for (const e of rels) {
        const hay = `${e.source} ${e.target}`
        for (const h of hits.slice(0, 40)) {
          const key = h.replace(/[@$%{}()\s:;,.'"\\]+/g, "")
          if (key.length >= 2 && hay.includes(key)) { row.rels++; break }
        }
      }
      for (const t of truth) {
        const hay = `${(t as any).from} ${(t as any).target}`
        for (const h of hits.slice(0, 40)) {
          const key = h.replace(/[@$%{}()\s:;,.'"\\]+/g, "")
          if (key.length >= 2 && hay.includes(key)) { row.truthRows++; break }
        }
      }
    }
  }
}

for (const c of CANDIDATES) rowOf(c.id).files = filesByCandidate.get(c.id)!.size
rows.sort((a, b) => b.files - a.files)

console.log(`css files scanned: ${scannedCss}  (+ .scss/.less counted for occurrence only)\n`)
console.log(`${"files".padStart(6)} {"sym".padStart(5)} {"rel".padStart(5)} {"truth".padStart(6)}  construct`)
for (const r of rows) {
  console.log(`${String(r.files).padStart(6)} ${String(r.symbols).padStart(5)} ${String(r.rels).padStart(5)} ${String(r.truthRows).padStart(6)}  ${r.id}`)
  console.log(`       ${r.verdict}${r.egFile ? `  [${r.egFile}]` : ""}`)
}
console.log("\n('sym' = a symbol sharing a token with the construct; 'rel' = a relationship naming it; 'truth' = an oracle row naming it)")
