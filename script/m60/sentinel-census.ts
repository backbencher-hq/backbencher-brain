// script/m60/sentinel-census.ts — the "no unknown symbols" census.
//
// Owner standard (2026-09-21, reviews/m60-oo-family-plan.md §3.7/R2): no analyzer
// may NAME something with a placeholder literal. When a fallback has nothing
// truthful to say, the honest state is ABSENCE (`undefined`), not the string
// `"unknown"` — because a literal in a name-bearing field becomes a symbol (or an
// edge endpoint) that does not exist in the source. `source: owner || "unknown"`
// in the ruby analyzer emits a `calls` edge attributed to a symbol named
// "unknown"; the pipeline then has a name it can match, count and display, and
// none of it is in the file.
//
// WHY A CENSUS AND NOT A GREP
// ---------------------------
// The obvious grep is `"unknown"` and it is wrong in both directions. It reports
// 14 analyzers and they are NOT one class:
//
//   * `source: owner || "unknown"`                  a fabricated symbol NAME  -> violation
//   * `type: typeNode ? typeNode.text : "unknown"`  a fabricated type value  -> violation
//   * `source: "explicit" | "inferred" | "unknown"` a DECLARED enum member   -> not a violation
//   * `if (info.type !== "unknown")`                a comparison             -> not a violation
//   * `// a guessed line reads as "unknown"`        prose in a comment       -> not a violation
//
// This repo has already paid for the loose version: #873 was filed against
// "8 analyzers" whose only real count was 2, because the census grepped `line:`
// without requiring the key to be in property position (the R6 header records
// it). So classification here is by SYNTACTIC POSITION in a real parse, never by
// substring presence — which is also why this script uses tree-sitter and not a
// char walk: a hand-rolled walk that masks comments and then re-finds literals
// pairs quotes TWICE (once to mask, once to collect) and the two pairings
// disagree the moment a regex literal or an odd quote appears. That bug was
// written, measured (it silently missed all four ruby sites) and deleted.
//
// Every occurrence lands in exactly one named shape, so an unclassified one is
// visible rather than dropped.
//
// BOUNDARIES, DISCLOSED
// ---------------------
//   * The sources scanned are the analyzers themselves (`src/ast/real-*-analyzer.ts`),
//     parsed as TypeScript. A file whose own source does not parse is REPORTED
//     (`parseErrors`) and contributes zero sites — never silently.
//   * Comments (tree-sitter `comment` nodes) are not string nodes, so prose is
//     excluded by construction: no masking step exists to get wrong.
//   * Template literals are deliberately not a marker site (`` `unknown` `` is not
//     a fallback shape); the same goes for a marker inside a regex literal.
//   * This is a STATIC census: it proves a source site exists and what shape it
//     has, not that the site fires. The runtime half — no emitted row may carry a
//     placeholder as a name — is recorded as outstanding in the register
//     (`runtimeOwed`), not implied here.
//
// Run: bun script/m60/sentinel-census.ts [--emit]
//   default: print the census summary + self-tests
//   --emit:  write validation/m60/results/symbol-sentinels.json
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const AST_DIR = path.join(ROOT, "src/ast")
const WASM_DIR = path.join(ROOT, "wasm")
const OUT = path.join(ROOT, "validation/m60/results/symbol-sentinels.json")

/** A placeholder marker: the literal names an UNKNOWN state. */
const MARKER = /^(?:<|\()?unknown(?:\)|>)?$/i

export type SentinelShape =
  | "or-fallback"       // `x || "unknown"` / `x ?? "unknown"`
  | "ternary-branch"    // `cond ? x : "unknown"` (either branch)
  | "bare-return"       // `return "unknown"`
  | "bare-assign"       // `const n = "unknown"` / `n = "unknown"` / `f(p = "unknown")`
  | "property-value"    // `key: "unknown"` with no fallback around it
  | "union-member"      // `"a" | "b" | "unknown"` — a DECLARED state
  | "type-position"     // `"unknown"` used as a type
  | "compare"           // `=== "unknown"` / `!== "unknown"`
  | "unclassified"      // anything else — reported, never silent

export type SentinelVerdict = "violation" | "declared-state" | "compare" | "unclassified"

/** Fields whose value is a NAME the graph will match on (the violation class). */
const NAME_KEYS = new Set([
  "name", "symbolName", "source", "target", "owner", "ownerName", "module", "moduleName",
  "qualifiedName", "alias", "aliasedTo", "className", "methodName", "paramName", "receiver",
  "parent", "parentName", "namespace", "package",
])

/** Fields whose value is PAYLOAD TEXT — a fabricated one is still a fabrication. */
const VALUE_KEYS = new Set([
  "type", "returnType", "valueType", "paramType", "signature", "hclValueKind", "baseType",
])

const COMPARE_OPS = new Set(["===", "!==", "==", "!="])
const FALLBACK_OPS = new Set(["||", "??"])

export interface SentinelSite {
  file: string
  line: number
  marker: string
  shape: SentinelShape
  verdict: SentinelVerdict
  /** The property/variable the literal feeds, when the node has one. */
  key: string | null
  /** Whitespace-collapsed source of the enclosing statement — the register key. */
  statement: string
}

/** Walk every node, parents first. */
function walk(node: any, cb: (n: any) => void): void {
  cb(node)
  for (const child of node.children ?? []) walk(child, cb)
}

/** Skip parentheses: `("unknown")` inside a ternary is still the ternary's branch. */
function unwrap(node: any): any {
  let n = node
  while (n.parent && n.parent.type === "parenthesized_expression") n = n.parent
  return n
}

/**
 * Classify one string-literal node by its syntactic position.
 *
 * `key` is read from the node's own field, never from a colon in the text: in
 * `name: pName ? pName.text : "unknown"` the nearest colon belongs to the
 * ternary, which is exactly the property-position trap R6 documents.
 */
/**
 * The nearest enclosing binding a literal feeds, when its own parent is not one.
 * Without this, `{ source: owner || "unknown" }` reports key `null` and the
 * register cannot say WHICH field is poisoned — the single most useful thing it
 * could say. Bounded to four levels so a distant field name is never claimed.
 */
function enclosingKey(node: any): string | null {
  let n = unwrap(node).parent
  for (let depth = 0; n && depth < 4; depth++, n = n.parent) {
    if (n.type === "pair") {
      const k = n.childForFieldName("key")?.text
      if (k) return k.replace(/^["'`]|["'`]$/g, "")
    }
    if (n.type === "variable_declarator" || n.type === "public_field_definition") {
      const k = n.childForFieldName("name")?.text
      if (k) return k
    }
    if (n.type === "assignment_expression") {
      const k = n.childForFieldName("left")?.text
      if (k && k.length < 40) return k
    }
  }
  return null
}

export function classifyNode(node: any): { shape: SentinelShape; verdict: SentinelVerdict; key: string | null } {
  const parent = unwrap(node).parent
  const cls = (shape: SentinelShape, verdict: SentinelVerdict, key: string | null = null) => ({ shape, verdict, key })
  if (!parent) return cls("unclassified", "unclassified")

  const isField = (field: string) => parent.childForFieldName(field)?.id === node.id

  switch (parent.type) {
    case "binary_expression": {
      const op = parent.childForFieldName("operator")?.text ?? ""
      if (FALLBACK_OPS.has(op)) return cls("or-fallback", "violation", enclosingKey(node))
      if (COMPARE_OPS.has(op)) return cls("compare", "compare", enclosingKey(node))
      if (op === "|") return cls("union-member", "declared-state", enclosingKey(node))
      return cls("unclassified", "unclassified", enclosingKey(node) ?? parent.childForFieldName("left")?.text?.slice(0, 40) ?? null)
    }
    case "ternary_expression":
      return cls("ternary-branch", "violation", enclosingKey(node))
    case "return_statement":
      return cls("bare-return", "violation", enclosingKey(node))
    case "variable_declarator": {
      const key = parent.childForFieldName("name")?.text ?? null
      return cls("bare-assign", "violation", key)
    }
    case "assignment_expression":
      return cls("bare-assign", "violation", parent.childForFieldName("left")?.text?.slice(0, 40) ?? null)
    case "assignment_pattern":
      return cls("bare-assign", "violation", parent.childForFieldName("left")?.text ?? null)
    case "pair": {
      const key = parent.childForFieldName("key")?.text ?? null
      const bare = key ? key.replace(/^["'`]|["'`]$/g, "") : null
      if (bare && (NAME_KEYS.has(bare) || VALUE_KEYS.has(bare))) return cls("property-value", "violation", bare)
      return cls("unclassified", "unclassified", bare)
    }
    case "union_type":
    case "intersection_type":
      return cls("union-member", "declared-state")
    case "literal_type": {
      // A literal inside a union is a MEMBER of that union (`"a" | "b" | "unknown"`
      // wraps each member in its own `literal_type`), and the distinction matters
      // to the register even though both are declared states.
      const gp = parent.parent
      if (gp && (gp.type === "union_type" || gp.type === "intersection_type")) {
        return cls("union-member", "declared-state")
      }
      return cls("type-position", "declared-state")
    }
    case "type_annotation":
    case "type_alias_declaration":
    case "predefined_type":
      return cls("type-position", "declared-state")
    case "switch_case":
      return cls("compare", "compare")
    default:
      return cls("unclassified", "unclassified", parent.type)
  }
}

export interface SentinelCensus {
  files: number
  occurrences: number
  parseErrors: string[]
  byShape: Record<string, number>
  byVerdict: Record<string, number>
  byLanguage: Record<string, { violations: number; declared: number; other: number }>
  sites: SentinelSite[]
}

async function makeParser(): Promise<any> {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const language = await L.load(readFileSync(path.join(WASM_DIR, "tree-sitter-typescript.wasm")))
  const parser = new P()
  parser.setLanguage(language)
  return parser
}

/** Every marker site in one analyzer source. */
export function sitesIn(parser: any, file: string, src: string): { sites: SentinelSite[]; parseError: boolean } {
  const tree = parser.parse(src)
  if (!tree || tree.rootNode.hasError) return { sites: [], parseError: true }
  const sites: SentinelSite[] = []
  walk(tree.rootNode, (n: any) => {
    if (n.type !== "string") return
    const text = n.text.replace(/^["'`]|["'`]$/g, "")
    if (!MARKER.test(text)) return
    const line = n.startPosition.row + 1
    const cls = classifyNode(n)
    // The enclosing statement: from the nearest statement-boundary ancestor down.
    // The enclosing statement: walk out to the nearest binding/statement node and
    // INCLUDE it, so the text carries the field the literal feeds. The earlier
    // version stopped one node short and, on a type alias, ran all the way to the
    // program root — whose first 200 characters are the file's banner comment, so
    // the register key for that site was a licence header. Keys must be stable
    // and readable, not merely unique.
    const BOUNDARY =
      /statement|declarator|declaration|pair|assignment_pattern|field_definition|property_signature|arguments|type_annotation|parameter|object|array/
    let anc = unwrap(n)
    while (anc.parent && !BOUNDARY.test(anc.parent.type)) anc = anc.parent
    if (anc.parent && BOUNDARY.test(anc.parent.type)) anc = anc.parent
    sites.push({
      file,
      line,
      marker: text,
      ...cls,
      statement: anc.text.replace(/\s+/g, " ").trim().slice(0, 200),
    })
  })
  return { sites, parseError: false }
}

export async function census(root: string = ROOT, parser?: any): Promise<SentinelCensus> {
  const p = parser ?? (await makeParser())
  const dir = path.join(root, "src/ast")
  const files = readdirSync(dir).filter((f) => /^real-.*-analyzer\.ts$/.test(f)).sort()
  const sites: SentinelSite[] = []
  const parseErrors: string[] = []
  for (const f of files) {
    const r = sitesIn(p, f, readFileSync(path.join(dir, f), "utf8"))
    if (r.parseError) parseErrors.push(f)
    sites.push(...r.sites)
  }
  const byShape: Record<string, number> = {}
  const byVerdict: Record<string, number> = {}
  const byLanguage: Record<string, { violations: number; declared: number; other: number }> = {}
  for (const s of sites) {
    byShape[s.shape] = (byShape[s.shape] ?? 0) + 1
    byVerdict[s.verdict] = (byVerdict[s.verdict] ?? 0) + 1
    const lang = s.file.replace(/^real-/, "").replace(/-analyzer\.ts$/, "")
    const row = (byLanguage[lang] ??= { violations: 0, declared: 0, other: 0 })
    if (s.verdict === "violation") row.violations++
    else if (s.verdict === "compare" || s.verdict === "declared-state") row.declared++
    else row.other++
  }
  return { files: files.length, occurrences: sites.length, parseErrors, byShape, byVerdict, byLanguage, sites }
}

// ============================================================================
// Self-tests: the classifier must discriminate, or its census means nothing.
// ============================================================================
// Each case is a real source shape; `expect` is the shape the classifier must
// return for the SINGLE marker site in it (or `none` when the shape must not be
// a site at all). A case whose parse produces a different number of sites fails.
const SELF_TESTS: { name: string; src: string; expect: SentinelShape | "none" }[] = [
  { name: "`||` fallback is a violation", src: `const a = x || "unknown"`, expect: "or-fallback" },
  { name: "`??` fallback is a violation", src: `const b = c ?? "unknown"`, expect: "or-fallback" },
  { name: "ternary alternate is a violation", src: `const d = cond ? x : "unknown"`, expect: "ternary-branch" },
  { name: "a bare return is a violation", src: `function f() { return "unknown" }`, expect: "bare-return" },
  { name: "a variable default is a violation", src: `let n = "unknown"`, expect: "bare-assign" },
  { name: "an assignment is a violation", src: `let n; n = "unknown"`, expect: "bare-assign" },
  { name: "a name-keyed property is a violation", src: `const o = { source: "unknown" }`, expect: "property-value" },
  { name: "a type-keyed property is a violation", src: `const o = { type: "unknown" }`, expect: "property-value" },
  { name: "an unknown-keyed property is NOT silently a violation", src: `const o = { note: "unknown" }`, expect: "unclassified" },
  { name: "a declared union member is not a violation", src: `type S = "explicit" | "inferred" | "unknown"`, expect: "union-member" },
  { name: "a comparison is not a violation", src: `if (x !== "unknown") { y() }`, expect: "compare" },
  { name: "a type position is not a violation", src: `type T = { a: "unknown" }`, expect: "type-position" },
  { name: "prose in a comment is not a site", src: `// a guessed line reads as "unknown"\nconst z = 1`, expect: "none" },
  { name: "a template literal is not a site", src: "const t = `unknown`", expect: "none" },
  { name: "a call argument is unclassified, not dropped", src: `foo("unknown")`, expect: "unclassified" },
]

export interface SelfTestResult { cases: number; failures: string[] }

export async function selfTest(parser?: any): Promise<SelfTestResult> {
  const p = parser ?? (await makeParser())
  const failures: string[] = []
  for (const t of SELF_TESTS) {
    const { sites, parseError } = sitesIn(p, "self-test.ts", t.src)
    if (parseError) { failures.push(`${t.name}: probe did not parse`); continue }
    if (t.expect === "none") {
      if (sites.length !== 0) failures.push(`${t.name}: expected no site, got ${sites.length} (${sites[0]?.shape})`)
      continue
    }
    if (sites.length !== 1) { failures.push(`${t.name}: expected 1 site, got ${sites.length}`); continue }
    if (sites[0].shape !== t.expect) failures.push(`${t.name}: expected ${t.expect}, got ${sites[0].shape}`)
  }
  return { cases: SELF_TESTS.length, failures }
}

async function main() {
  const parser = await makeParser()
  const c = await census(ROOT, parser)
  const st = await selfTest(parser)
  const violations = c.sites.filter((s) => s.verdict === "violation")
  console.log(`sentinel census: ${c.occurrences} occurrence(s) in ${c.files} analyzers; ${violations.length} violation(s)`)
  console.log(`  byShape:   ${JSON.stringify(c.byShape)}`)
  console.log(`  byVerdict: ${JSON.stringify(c.byVerdict)}`)
  for (const [lang, v] of Object.entries(c.byLanguage).sort()) {
    if (v.violations || v.other) console.log(`  ${lang}: violations=${v.violations} declared=${v.declared} other=${v.other}`)
  }
  if (c.parseErrors.length) console.log(`  parseErrors: ${c.parseErrors.join(", ")}`)
  console.log(`  self-tests: ${st.cases - st.failures.length}/${st.cases} passed`)
  for (const f of st.failures) console.log(`    FAIL: ${f}`)
  if (process.argv.includes("--emit")) {
    mkdirSync(path.dirname(OUT), { recursive: true })
    writeFileSync(
      OUT,
      JSON.stringify(
        {
          gate: "M60.R7",
          at: new Date().toISOString(),
          method:
            "tree-sitter walk over src/ast/real-*-analyzer.ts; every string literal matching the marker rule is classified by its parent node's type and field (or-fallback, ternary-branch, bare-return, bare-assign, property-value, union-member, type-position, compare, unclassified). Comments are not string nodes, so prose cannot be counted; `unclassified` is a reported shape, never a silent drop.",
          markerRule: "^(<|\\()?unknown(\\)|>)?$ (case-insensitive)",
          files: c.files,
          occurrences: c.occurrences,
          violations: violations.length,
          parseErrors: c.parseErrors,
          byShape: c.byShape,
          byVerdict: c.byVerdict,
          byLanguage: c.byLanguage,
          selfTests: { cases: st.cases, passed: st.cases - st.failures.length, failures: st.failures },
          sites: c.sites,
        },
        null,
        2,
      ) + "\n",
    )
    console.log(`  -> ${path.relative(ROOT, OUT)}`)
  }
  if (st.failures.length) process.exit(2)
}

if (process.argv[1] && path.basename(process.argv[1]) === "sentinel-census.ts") {
  main()
}
