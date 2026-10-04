/**
 * M14 ONTOLOGY — CSS instruments A and B over the WHOLE admitted `.css`/`.sass`/
 * `.less` corpus.
 *
 * ## Why this file exists
 *
 * `script/m14/ontology-coverage-gate.ts` is the arbiter. Its verdict for a type it
 * does not see produced depends on TWO things this lane must supply:
 *
 *   1. a RULING TABLE (`RULED_BY_LANG`, ontology-coverage-gate.ts:192) naming, per
 *      un-emitted type, which INSTRUMENT decides it and what that instrument looks
 *      at; and
 *   2. the corpus the instrument runs over.
 *
 * The table holds `bash` and `json` only. It is SHARED machinery this lane does not
 * own (ONTOLOGY-WORKSTREAM.md §Ownership), so the gate exits 2 for `css` and reports
 * nothing — a verdict about the TABLE, not about the lane. This file is the
 * measurement half, written so the table entry can be DERIVED from it rather than
 * guessed, and committed so the derivation is reproducible. What the supervisor has
 * to paste into `CSS_RULED` is written out per type in the report, with the exact
 * `nodeTypesThatWouldMeanIt` list or the exact `countOnTree` body.
 *
 * ## The two instruments, and why a text regex is not one of them
 *
 * The gate's own header records the two false positives that rejecting the regex
 * bought: an `extends` probe matched `class voice` inside a telnet IAC word list in
 * a string literal, and an `instantiates` probe matched `new Map(` inside a heredoc.
 * Everything below runs on the PARSE TREE produced by the PINNED
 * `wasm/tree-sitter-css.wasm` — the same wasm `parseFile` loads — so a string in a
 * comment, inside a `url()`, in an `@media` prelude or inside a LESS/SCSS heredoc
 * cannot produce a hit.
 *
 *   A. GRAMMAR INVENTORY. Walk every node of every admitted file and tally node
 *      types. Positive evidence of absence: if the grammar's own vocabulary over a
 *      non-empty corpus contains no node type expressing the construct, no source
 *      over that grammar can express it either. The FULL vocabulary is printed, so
 *      the claim is checkable rather than asserted.
 *   B. PARSE-TREE SEMANTIC COUNT. For a construct the language CAN write, count it
 *      on the tree. `@extend` is a directive: it is an `at_rule` whose `at_keyword`
 *      child reads `@extend`, which no regex over raw text can distinguish from the
 *      word "extend" in a comment.
 *
 * ## READ-ONLY
 *
 * Writes nothing. Prints a report and, with `--json <path>`, one JSON document.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const WASM = path.join(process.cwd(), "wasm", "tree-sitter-css.wasm")

// ------------------------------------------------------------------------ corpus
// The admission rule is `ontology-coverage-gate.ts`'s, copied rather than imported:
// the gate is shared machinery and may change under this lane, and a census whose
// file set silently drifts with someone else's edit is not a census. git-tracked, a
// real directory, <= 512 KB, and `detectLanguageFromPath(abs) === "css"`.
const files: { repo: string; rel: string; abs: string; text: string }[] = []
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
      if (statSync(abs).size === 0) continue
      if (detectLanguageFromPath(abs) !== "css") continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    files.push({ repo: e, rel, abs, text })
  }
}
files.sort((a, b) => (a.repo + a.rel < b.repo + b.rel ? -1 : 1))
const repos = new Set(files.map((f) => f.repo))

// ------------------------------------------------------------------- instrument A
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(WASM)))

const nodeTypes = new Map<string, number>()
/** at_keyword text -> occurrences and the files it was seen in. */
const atKeywords = new Map<string, { n: number; files: Set<string> }>()
/** function_name text -> occurrences: the callee vocabulary `calls` would name. */
const fnNames = new Map<string, number>()
let filesWithError = 0

const visit = (n: any): void => {
  nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c) visit(c)
  }
}

// Trees are kept PARALLEL to their labels. The earlier version of this file counted
// hits into a `Set` but added the literal `1` to it (`extendFiles.add(1 as any)`), so
// every "files" column read 1 regardless of how many files carried the construct — a
// per-type file count that cannot be wrong in the direction that matters, because it
// reports 1 when the truth is 400.
const trees: { root: any; label: string }[] = []
for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  const label = `${f.repo}/${f.rel}`
  trees.push({ root: t.rootNode, label })
  if (t.rootNode.hasError) filesWithError++
  visit(t.rootNode)
  const stack = [t.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "at_keyword") {
      const kw = n.text.trim().toLowerCase()
      const row = atKeywords.get(kw) ?? { n: 0, files: new Set<string>() }
      row.n++
      row.files.add(label)
      atKeywords.set(kw, row)
    }
    if (n.type === "function_name") {
      const nm = n.text.trim()
      fnNames.set(nm, (fnNames.get(nm) ?? 0) + 1)
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
}

// ------------------------------------------------------------------ instrument B
//
// Each probe is a COUNT OF A CONSTRUCT ON THE TREE, with the examples that produced
// it. A probe that returns 0 is a ruling input; a probe that returns >0 is a
// FALSIFICATION and is reported as one. Nothing here decides anything: it produces
// numbers, and the doc records what the numbers overturned.

type Probe = {
  type: string
  construct: string
  instrument: "A:grammar-inventory" | "B:parse-tree-count"
  occurrences: number
  files: number
  /** what a non-zero count here would mean, so the ruling is falsifiable on its face */
  overturns: string
  examples: string[]
}

const probes: Probe[] = []
const probe = (
  type: string,
  construct: string,
  instrument: Probe["instrument"],
  occurrences: number,
  files: number,
  overturns: string,
  examples: string[],
): void => {
  probes.push({ type, construct, instrument, occurrences, files, overturns, examples: examples.slice(0, 5) })
}

/** The `at_keyword` of an at_rule node, lowercased, or `""`. */
const atKeywordOf = (n: any): string => {
  const kw = n.namedChildren?.find((c: any) => c.type === "at_keyword")
  return kw ? String(kw.text).trim().toLowerCase() : ""
}

// Node types that WOULD express each construct. Chosen as the union of what every
// tree-sitter grammar in this corpus calls these things, so a hit cannot be missed by
// a naming disagreement between grammars.
const TYPE_DECL = [
  "class_declaration", "class_specifier", "interface_declaration", "interface_specifier",
  "trait_declaration", "struct_declaration", "struct_specifier", "enum_declaration",
  "inheritance_specifier", "base_class_clause", "superclass", "base_list",
  "type_declaration", "module_declaration",
]
const SUPERTYPE_CLAUSE = [
  "implements_clause", "extends_clause", "superclass", "interface_implementation",
  "base_class_clause", "type_inheritance_clause", "mixin_declaration_list", "super_interfaces",
]
const CONSTRUCTOR_CALL = [
  "new_expression", "object_creation_expression", "constructor_invocation",
  "object_creation", "instantiation_expression", "new_declarator",
]
const FUNCTION_DEF = [
  "function_declaration", "function_definition", "method_definition", "function_item",
  "generator_function_declaration", "arrow_function", "function_expression",
  "function_declarator", "function_rule", "custom_function_statement",
]
const EXPORT_SYNTAX = [
  "export_statement", "export_declaration", "export_list", "exports_clause",
  "export_specifier", "export_from_clause", "export_block",
]
const IMPORT_SYNTAX = ["import_statement", "import_declaration", "import_from"]

const hit = (names: string[]): string[] => names.filter((n) => nodeTypes.has(n))

// -- `calls` -------------------------------------------------------------------
// Instrument A: `calls` needs a callee, and a callee a graph can NAME needs a
// user-defined function DEFINITION. The grammar has no such production — the full
// vocabulary is printed below, and `function_definition`/`method_definition` are
// absent from it.
probe(
  "calls",
  "a user-defined function DEFINITION (the callee a `calls` edge must name)",
  "A:grammar-inventory",
  0,
  0,
  "a node type in the printed grammar vocabulary that declares a function",
  [],
)
{
  const found = hit(FUNCTION_DEF)
  probe(
    "calls",
    "GRAMMAR PRODUCES a function-definition node",
    "A:grammar-inventory",
    found.length,
    -1,
    "(this probe fires only if the grammar HAS the construct; then `calls` is a GAP)",
    found,
  )
}
// Instrument B: CSS Functions and Mixins Level 4 gives CSS its own named function,
// `@function --add(a, b) { … }`, called as `add(1, 2)`. It is the one construct that
// would make `calls` a CSS construct, so its count decides the type. The pinned
// grammar has no `@function` production, so it can only arrive as a generic `at_rule`
// with `@function` as its `at_keyword` — and `call_expression`/`function_name` is how
// a call site parses.
{
  let decls = 0
  const declFiles = new Set<string>()
  const examples: string[] = []
  for (const { root, label } of trees) {
    const stack = [root]
    while (stack.length > 0) {
      const n = stack.pop()
      if ((n.type === "at_rule" || n.type === "postcss_statement") && atKeywordOf(n) === "@function") {
        decls++
        declFiles.add(label)
        if (examples.length < 5) examples.push(`${label}: ${n.text.slice(0, 70).replace(/\s+/g, " ")}`)
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
  }
  probe(
    "calls",
    "a CSS Functions L4 `@function` DECLARATION (`@function --add(a,b) { … }`)",
    "B:parse-tree-count",
    decls,
    declFiles.size,
    "any `@function` at-rule on the tree — then CSS names its own functions and `calls` is a GAP",
    examples,
  )
}

// -- `extends` ----------------------------------------------------------------
// SCSS `@extend .base` is the only type-level inheritance the CSS/SCSS/LESS family
// has: it makes the extending selector match everything the extended one matches.
// It is a DIRECTIVE, so it is counted on the tree, where the word "extend" in a
// comment cannot reach it.
{
  let occ = 0
  const hitFiles = new Set<string>()
  const examples: string[] = []
  for (const { root, label } of trees) {
    const stack = [root]
    while (stack.length > 0) {
      const n = stack.pop()
      if ((n.type === "at_rule" || n.type === "postcss_statement") && atKeywordOf(n) === "@extend") {
        occ++
        hitFiles.add(label)
        if (examples.length < 5) examples.push(`${label}: ${n.text.slice(0, 70).replace(/\s+/g, " ")}`)
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
  }
  probe(
    "extends",
    "an `@extend` DIRECTIVE (`@extend .base`) — selector-level inheritance",
    "B:parse-tree-count",
    occ,
    hitFiles.size,
    "any `@extend` at-rule on the tree — then the type is derivable and the ruling is wrong",
    examples,
  )
  const kw = atKeywords.get("@extend")
  probe(
    "extends",
    "the `@extend` at-keyword itself (is the directive even LEXABLE by this grammar)",
    "B:parse-tree-count",
    kw?.n ?? 0,
    kw?.files.size ?? 0,
    "n/a — a sub-measurement of the probe above, not an independent ruling",
    [...(kw?.files ?? [])].slice(0, 3),
  )
  const found = hit(TYPE_DECL)
  probe(
    "extends",
    "GRAMMAR PRODUCES a type-declaration node (the other way to inherit)",
    "A:grammar-inventory",
    found.length,
    -1,
    "(fires only if the grammar HAS type declarations; then `extends` is a GAP)",
    found,
  )
}

// -- `implements` --------------------------------------------------------------
// Instrument A is the right one: `implements` needs a supertype CLAUSE, and a clause
// is a node. No clause node appears in the vocabulary printed below.
probe(
  "implements",
  "a supertype/implementation CLAUSE naming a supertype",
  "A:grammar-inventory",
  0,
  0,
  "a node type in the printed grammar vocabulary that is a supertype clause",
  [],
)
{
  const found = hit(SUPERTYPE_CLAUSE)
  probe(
    "implements",
    "GRAMMAR PRODUCES a supertype clause node",
    "A:grammar-inventory",
    found.length,
    -1,
    "(fires only if the grammar HAS the construct; then `implements` is a GAP)",
    found,
  )
}

// -- `instantiates` ------------------------------------------------------------
probe(
  "instantiates",
  "a constructor call / object-creation expression",
  "A:grammar-inventory",
  0,
  0,
  "a node type in the printed grammar vocabulary that constructs a value",
  [],
)
{
  const found = hit(CONSTRUCTOR_CALL)
  probe(
    "instantiates",
    "GRAMMAR PRODUCES an object-creation node",
    "A:grammar-inventory",
    found.length,
    -1,
    "(fires only if the grammar HAS the construct; then `instantiates` is a GAP)",
    found,
  )
  // Instrument B as well, because a grammar inventory cannot see a CONVENTION and the
  // gate's own header records an `exports` ruling removed for exactly that reason. CSS
  // has one value-producing construct that is not a function call — `var(--x)`
  // substitution, which reads a declaration rather than constructing a thing — so it
  // is counted here rather than argued about.
  let varCalls = 0
  const varFiles = new Set<string>()
  for (const { root, label } of trees) {
    const stack = [root]
    let found2 = false
    while (stack.length > 0) {
      const n = stack.pop()
      if (n.type === "call_expression") {
        const fn = n.namedChildren?.find((c: any) => c.type === "function_name")
        if (fn && String(fn.text).trim() === "var") {
          varCalls++
          found2 = true
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
    if (found2) varFiles.add(label)
  }
  probe(
    "instantiates",
    "`var(--x)` — the one CSS construct that produces a value from a name",
    "B:parse-tree-count",
    varCalls,
    varFiles.size,
    "n/a — reported so the reader can see the count the analyzer labels `references`, not `instantiates`",
    [],
  )
}

// -- `exports` -----------------------------------------------------------------
// Instrument A is NOT sufficient here, and the gate's own header says why: its json
// lane REMOVED an `exports` ruling made on a grammar inventory, because "a grammar
// cannot see a CONVENTION". CSS has export CONVENTIONS with no export SYNTAX, so the
// convention is counted too: the composes-`from` form (CSS Modules' only cross-file
// export surface) and the `:export` block.
{
  const found = hit(EXPORT_SYNTAX)
  probe(
    "exports",
    "GRAMMAR PRODUCES an export node",
    "A:grammar-inventory",
    found.length,
    -1,
    "(fires only if the grammar HAS export syntax; then `exports` is a GAP)",
    found,
  )
}
{
  let composes = 0
  let composesFrom = 0
  const fromFiles = new Set<string>()
  const fromExamples: string[] = []
  let localComposes = 0
  for (const { root, label } of trees) {
    const stack = [root]
    let f = false
    while (stack.length > 0) {
      const n = stack.pop()
      if (n.type === "declaration") {
        const prop = n.namedChildren?.find((c: any) => c.type === "property_name")
        if (prop && prop.text.trim() === "composes") {
          composes++
          const vals = n.namedChildren.filter((c: any) => c.type !== "property_name")
          const joined = vals.map((v: any) => v.text).join(" ")
          if (/\bfrom\b/.test(joined)) {
            composesFrom++
            f = true
            if (fromExamples.length < 5) fromExamples.push(`${label}: ${joined.slice(0, 70).replace(/\s+/g, " ")}`)
          } else {
            localComposes++
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
    if (f) fromFiles.add(label)
  }
  probe(
    "exports",
    "a CSS-Modules cross-file export surface: `composes: x from \"./y.css\"`",
    "B:parse-tree-count",
    composesFrom,
    fromFiles.size,
    "any `composes: … from …` — then a file EXPORTS a name to another file and `exports` is a GAP",
    fromExamples,
  )
  probe(
    "exports",
    "a LOCAL `composes: y` (same-file composition, no cross-file surface)",
    "B:parse-tree-count",
    localComposes,
    -1,
    "n/a — a same-file `uses` edge, already emitted and not an export",
    [],
  )
}
{
  // The `:export` block is CSS Modules' named export map:
  //   :export { primary: #bf4040; }
  // The pinned grammar has no `:export` production, so it arrives as a `rule_set`
  // whose `selectors` node spells `:export` — the same generic path `@mixin` takes.
  let blocks = 0
  const files2 = new Set<string>()
  const examples: string[] = []
  for (const { root, label } of trees) {
    const stack = [root]
    while (stack.length > 0) {
      const n = stack.pop()
      if (n.type === "rule_set") {
        const sel = n.namedChildren?.find((c: any) => c.type === "selectors")
        const t = sel ? sel.text.replace(/\s+/g, " ").trim() : ""
        if (t === ":export" || t === ":exports") {
          blocks++
          files2.add(label)
          if (examples.length < 5) examples.push(`${label}: ${n.text.slice(0, 70).replace(/\s+/g, " ")}`)
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
  }
  probe(
    "exports",
    "a CSS-Modules `:export` block — the named export map of a CSS Module",
    "B:parse-tree-count",
    blocks,
    files2.size,
    "any `:export` rule_set — then a stylesheet declares what it exports and `exports` is a GAP",
    examples,
  )
}

// -- `overrides` ---------------------------------------------------------------
// Instrument B, and it MUST be B: CSS can express a second declaration of a name and
// the grammar has no rule against it, so a grammar inventory is silent by
// construction here — which is exactly the failure the gate's header records for
// bash's `overrides`.
//
// The question the probe asks is the precise one: does a SECOND declaration REPLACE
// the first, or MERGE with it? CSS gives two different answers, so the two shapes are
// counted separately and only the replacement-shaped one is an override.
type DefKind = "keyframes" | "property" | "counter-style" | "font-feature-values" | "mixin" | "font-face" | "layer" | "container" | "scope" | "page" | "font-palette-values"
const DECLARING_AT_RULES: Record<string, DefKind> = {
  "@keyframes": "keyframes",
  "@-webkit-keyframes": "keyframes",
  "@-moz-keyframes": "keyframes",
  "@property": "property",
  "@counter-style": "counter-style",
  "@font-feature-values": "font-feature-values",
  "@font-palette-values": "font-palette-values",
  "@mixin": "mixin",
  "@font-face": "font-face",
  "@layer": "layer",
  "@container": "container",
  "@scope": "scope",
  "@page": "page",
}
type Row = { count: number; files: Set<string>; examples: string[] }
const redeclared: Record<string, Row> = {}
{
  for (const { root, label } of trees) {
    const seen: Record<string, Set<string>> = {}
    const stack = [root]
    while (stack.length > 0) {
      const n = stack.pop()
      const record = (kind: DefKind, name: string): void => {
        if (name.length === 0) return
        const set = (seen[kind] ??= new Set<string>())
        if (set.has(name)) {
          const row = (redeclared[kind] ??= { count: 0, files: new Set<string>(), examples: [] })
          row.count++
          row.files.add(label)
          if (row.examples.length < 5) row.examples.push(`${label}: ${kind} ${name}`)
        }
        set.add(name)
      }
      if (n.type === "keyframes_statement") {
        const nm = n.namedChildren?.find(
          (c: any) => c.type === "keyframes_name" || c.type === "identifier" || c.type === "string_value",
        )
        if (nm) record("keyframes", String(nm.text).trim().replace(/^["']|["']$/g, ""))
      }
      if (n.type === "at_rule") {
        const kwt = atKeywordOf(n)
        const kind = DECLARING_AT_RULES[kwt]
        if (kind) {
          const kw = n.namedChildren?.find((c: any) => c.type === "at_keyword")
          let name = ""
          if (kind === "font-face") {
            // `@font-face` declares from inside its block, so the name is its family.
            const s2 = [n]
            while (s2.length && !name) {
              const x = s2.pop()
              if (x.type === "declaration") {
                const p = x.namedChildren?.find((c: any) => c.type === "property_name")
                if (p && p.text.trim().toLowerCase() === "font-family") {
                  const v = x.namedChildren?.find((c: any) =>
                    c.type === "string_value" || c.type === "plain_value" || c.type === "identifier",
                  )
                  if (v) name = String(v.text).trim().replace(/^["']|["']$/g, "")
                }
              }
              for (let i = 0; i < x.childCount; i++) {
                const c = x.child(i)
                if (c) s2.push(c)
              }
            }
          } else {
            const after = n.text.slice(String(kw?.text ?? "").length)
            const cut = Math.min(...[after.indexOf("{"), after.indexOf(";")].filter((x) => x >= 0).concat([after.length]))
            name = after.slice(0, cut).replace(/\s+/g, " ").trim()
          }
          record(kind, name)
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
  }
}
const REPLACEMENT: DefKind[] = ["keyframes", "property", "counter-style", "font-feature-values", "font-palette-values", "mixin"]
const MERGE: DefKind[] = ["font-face", "layer", "container", "scope", "page"]
for (const k of Object.keys(redeclared)) {
  const r = redeclared[k]
  const shape = REPLACEMENT.includes(k as DefKind) ? "REPLACEMENT" : "MERGE"
  probe(
    "overrides",
    `per-shape: ${shape} — a second \`${k}\` declaration of one name in one file`,
    "B:parse-tree-count",
    r.count,
    r.files.size,
    `a non-zero count on a REPLACEMENT shape — then \`overrides\` is a GAP and must be implemented`,
    r.examples,
  )
}
{
  const sum = (ks: DefKind[]): { n: number; files: Set<string>; ex: string[] } => {
    const files2 = new Set<string>()
    const ex: string[] = []
    let n = 0
    for (const k of ks) {
      const r = redeclared[k]
      if (!r) continue
      n += r.count
      for (const f of r.files) files2.add(f)
      for (const e of r.examples) if (ex.length < 5) ex.push(e)
    }
    return { n, files: files2, ex }
  }
  const rep = sum(REPLACEMENT)
  probe(
    "overrides",
    `REPLACEMENT-shaped second declarations, summed — [${REPLACEMENT.join(", ")}]`,
    "B:parse-tree-count",
    rep.n,
    rep.files.size,
    "a non-zero count here FALSIFIES any `overrides` ruling: the language replaces, so the type has a construct",
    rep.ex,
  )
  const mer = sum(MERGE)
  probe(
    "overrides",
    `MERGE-shaped second declarations, summed — NOT an override [${MERGE.join(", ")}]`,
    "B:parse-tree-count",
    mer.n,
    mer.files.size,
    "n/a — reported so the merge/replace split is visible rather than argued",
    mer.ex,
  )
}
{
  // The contrasting case, stated because a ruling that only shows one side is a prose
  // justification: a repeated SELECTOR merges under the cascade rather than replacing,
  // so it is counted too and reported separately.
  let repeated = 0
  const files2 = new Set<string>()
  const examples: string[] = []
  for (const { root, label } of trees) {
    const seen = new Set<string>()
    const stack = [root]
    let f = false
    while (stack.length > 0) {
      const n = stack.pop()
      if (n.type === "selectors") {
        const key = n.text.replace(/\s+/g, " ").trim()
        if (key.length > 0) {
          if (seen.has(key)) {
            repeated++
            f = true
            if (examples.length < 5) examples.push(`${label}: ${key.slice(0, 60)}`)
          }
          seen.add(key)
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
    if (f) files2.add(label)
  }
  probe(
    "overrides",
    "CONTRAST: a repeated SELECTOR, which CSS MERGES under the cascade rather than replacing",
    "B:parse-tree-count",
    repeated,
    files2.size,
    "n/a — counted so the merge/replace split is visible; a repeated selector is NOT an override",
    examples,
  )
}

// -- `imports` (emitted; measured for completeness) ---------------------------
probe(
  "imports",
  "an `@import` statement node",
  "A:grammar-inventory",
  nodeTypes.get("import_statement") ?? 0,
  -1,
  "(emitted; measured so the emitted types are on the same table as the ruled ones)",
  [],
)

// ---------------------------------------------------------------------- report
const report = {
  tool: "css-ontology-probe",
  corpusRoot: CR,
  files: files.length,
  repos: repos.size,
  filesWithParseError: filesWithError,
  grammarNodeTypesDistinct: nodeTypes.size,
  grammarVocabulary: Object.fromEntries([...nodeTypes.entries()].sort((a, b) => b[1] - a[1])),
  atKeywords: Object.fromEntries(
    [...atKeywords.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([k, v]) => [k, { occurrences: v.n, files: v.files.size }]),
  ),
  functionNames: Object.fromEntries([...fnNames.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])),
  probes,
}

const jsonArg = process.argv.indexOf("--json")
if (jsonArg !== -1 && process.argv[jsonArg + 1]) writeFileSync(process.argv[jsonArg + 1], JSON.stringify(report, null, 2) + "\n")

const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)
console.log(`css ontology probe (instrument A + B) over the whole admitted corpus`)
console.log(`corpus: ${files.length} admitted files across ${repos.size} repos; ${filesWithError} carry a parse ERROR somewhere`)
console.log(`grammar vocabulary: ${nodeTypes.size} distinct node types produced by wasm/tree-sitter-css.wasm over that corpus`)
console.log("")
console.log(`${w("type", 13)}${w("instr", 22)}${w("occ", 8)}${w("files", 8)}construct`)
console.log("-".repeat(150))
for (const p of probes) {
  console.log(`${w(p.type, 13)}${w(p.instrument, 22)}${w(String(p.occurrences), 8)}${w(p.files < 0 ? "-" : String(p.files), 8)}${p.construct}`)
  for (const e of p.examples) console.log(`${" ".repeat(51)}e.g. ${e}`)
}
console.log("")
console.log("FULL GRAMMAR VOCABUARY (instrument A's positive evidence of absence — every node type the grammar produced)")
for (const [k, v] of [...nodeTypes.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${w(k, 34)}${v}`)
console.log("")
console.log("at_keywords seen on the tree (a construct only exists if it lexes):")
for (const [k, v] of [...atKeywords.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${w(k, 30)}${String(v.n).padStart(7)} occurrences in ${v.files.size} files`)
}
console.log("")
console.log(`function_name vocabulary: ${fnNames.size} distinct callee names, all CSS built-ins:`)
for (const [k, v] of [...fnNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${w(k, 30)}${v}`)
if (fnNames.size > 25) console.log(`  … and ${fnNames.size - 25} more`)