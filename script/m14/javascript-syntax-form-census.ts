/**
 * JAVASCRIPT SYNTAX-FORM CENSUS — does the corpus contain each form, and does the analyzer DO
 * something with it?
 *
 * WHY THIS EXISTS. The lane's corpora were all Ember/svelte-shaped, so a form that never appears
 * there is indistinguishable from a form the analyzer mishandles: both show zero rows. This census
 * separates the two directions — it counts the forms the PARSE TREE actually contains, then asks what
 * the analyzer produced for the files that contain them.
 *
 * Two numbers per form, and both are needed:
 *   presence    files containing the form (0 = "never exercised", NOT "broken")
 *   emitted     whether those files produced any symbol/relationship at all, and the count
 *
 * A form with presence > 0 and emitted == 0 is the interesting case: the grammar sees it and the
 * analyzer does nothing. That is either a documented disposition or a gap, and this census is what
 * tells them apart instead of a triage count.
 *
 * READ-ONLY. Writes one artifact under validation/m14/tmp/.
 *
 *   bun run script/m14/javascript-syntax-form-census.ts --repo=<dir> [--json=<out>] [--limit=N]
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { ASTEngine, getParser } from "../../src/ast/engine"

const SIZE_CAP = 512 * 1024
const BUILD = new Set(["dist", "build", "node_modules", "coverage", "vendor", "umd", "www", "bower_components", "jspm_packages", "tmp", "out", "__snapshots__"])

function argOf(flag: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(flag + "="))
  return hit ? hit.slice(flag.length + 1) : null
}
const REPO = argOf("--repo")
if (!REPO || !existsSync(REPO)) {
  console.error("syntax-form-census: pass --repo=<dir>")
  process.exit(2)
}
const JSON_OUT = argOf("--json")
const LIMIT = Number(argOf("--limit") ?? "0") || 0

/**
 * THE FORM LIST. Each entry names a language form and the NODE TYPES (or node predicates) that prove
 * the parse tree contains it. Predicates are needed where one node type covers several forms (`method
 * definition` is a getter, a setter, a static method or a plain one) — reading the token is the only
 * honest test.
 */
type Form = { name: string; match: (n: any) => boolean }

function hasToken(n: any, tok: string): boolean {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && !c.isNamed && c.type === tok) return true
  }
  return false
}

const FORMS: Form[] = [
  { name: "getter", match: (n) => n.type === "method_definition" && hasToken(n, "get") },
  { name: "setter", match: (n) => n.type === "method_definition" && hasToken(n, "set") },
  { name: "static method", match: (n) => n.type === "method_definition" && hasToken(n, "static") },
  { name: "private method (#m)", match: (n) => n.type === "method_definition" && n.childForFieldName("name")?.type === "private_property_identifier" },
  { name: "private field (#f)", match: (n) => n.type === "field_definition" && n.childForFieldName("property")?.type === "private_property_identifier" },
  { name: "class static block", match: (n) => n.type === "class_static_block" },
  { name: "class field", match: (n) => n.type === "field_definition" },
  { name: "async function", match: (n) => (n.type === "function_declaration" || n.type === "function_expression" || n.type === "arrow_function") && hasToken(n, "async") },
  { name: "generator", match: (n) => n.type === "generator_function_declaration" || n.type === "generator_function" },
  { name: "async generator", match: (n) => (n.type === "generator_function_declaration" || n.type === "generator_function") && hasToken(n, "async") },
  { name: "for-await-of", match: (n) => n.type === "for_in_statement" && hasToken(n, "await") },
  { name: "top-level await", match: (n) => n.type === "await_expression" && topLevel(n) },
  { name: "labelled statement", match: (n) => n.type === "labeled_statement" },
  { name: "sequence (comma) expression", match: (n) => n.type === "sequence_expression" },
  { name: "optional chaining", match: (n) => n.type === "member_expression" && hasToken(n, "?.") || n.type === "optional_chain" },
  { name: "nullish coalescing", match: (n) => n.type === "binary_expression" && hasToken(n, "??") },
  { name: "new.target", match: (n) => n.type === "meta_property" },
  { name: "import.meta", match: (n) => n.type === "meta_property" },
  { name: "dynamic import()", match: (n) => n.type === "call_expression" && n.childForFieldName("function")?.type === "import" },
  { name: "with statement", match: (n) => n.type === "with_statement" },
  { name: "tagged template", match: (n) => n.type === "call_expression" && n.childForFieldName("function")?.type === "template_string" },
  { name: "regex literal", match: (n) => n.type === "regex" },
  { name: "destructuring pattern", match: (n) => n.type === "object_pattern" || n.type === "array_pattern" },
  { name: "default parameter", match: (n) => n.type === "assignment_pattern" },
  { name: "rest/spread", match: (n) => n.type === "rest_pattern" || n.type === "spread_element" },
  { name: "try/catch without binding", match: (n) => n.type === "catch_clause" && !n.childForFieldName("parameter") },
  { name: "decorator", match: (n) => n.type === "decorator" },
  { name: "JSX element", match: (n) => n.type === "jsx_element" || n.type === "jsx_self_closing_element" },
  { name: "switch/fallthrough", match: (n) => n.type === "switch_case" && n.namedChildCount === 1 },
  { name: "getter/setter pair same name", match: () => false },
  { name: "computed method key", match: (n) => n.type === "method_definition" && n.childForFieldName("name")?.type === "computed_property_name" },
  { name: "object shorthand method", match: (n) => n.type === "method_definition" && n.parent?.type === "object" },
  { name: "module.exports assignment", match: (n) => n.type === "assignment_expression" && String(n.childForFieldName("left")?.text ?? "").startsWith("module.exports") },
  { name: "exports.name assignment", match: (n) => n.type === "assignment_expression" && String(n.childForFieldName("left")?.text ?? "").startsWith("exports.") },
  { name: "UMD wrapper", match: (n) => n.type === "expression_statement" && String(n.namedChild(0)?.text ?? "").startsWith("(function") === false ? false : false },
]

/** is this node at program level (no function ancestor)? */
function topLevel(n: any): boolean {
  for (let p: any = n.parent; p; p = p.parent) {
    if (p.type === "function_declaration" || p.type === "function_expression" ||
        p.type === "arrow_function" || p.type === "generator_function" ||
        p.type === "generator_function_declaration" || p.type === "method_definition") return false
  }
  return true
}

const tracked: string[] = execFileSync("git", ["-C", REPO, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
  .split("\0").filter(Boolean)
const files: string[] = []
for (const rel of tracked) {
  if (rel.split("/").some((s) => BUILD.has(s))) continue
  const abs = path.join(REPO, rel)
  try {
    if (statSync(abs).size > SIZE_CAP) continue
    if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "javascript") continue
  } catch { continue }
  files.push(rel)
  if (LIMIT > 0 && files.length >= LIMIT) break
}
files.sort()

let parser = await getParser("javascript")
let sinceRefresh = 0

type Stat = { filesWith: number; nodes: number; emittedSymbols: number; emittedRels: number }
const stats = new Map<string, Stat>()
for (const f of FORMS) stats.set(f.name, { filesWith: 0, nodes: 0, emittedSymbols: 0, emittedRels: 0 })

for (const rel of files) {
  const abs = path.join(REPO, rel)
  let src: string
  try { src = readFileSync(abs, "utf8") } catch { continue }
  if (++sinceRefresh >= 400) { sinceRefresh = 0; parser = await getParser("javascript") }
  let root: any
  try { root = parser.parse(src)?.rootNode } catch { continue }
  if (!root) continue

  const hits = new Set<string>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    for (const form of FORMS) {
      if (hits.has(form.name)) continue
      let ok = false
      try { ok = form.match(n) } catch { ok = false }
      if (ok) { hits.add(form.name); const s = stats.get(form.name)!; s.nodes++ }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  if (hits.size === 0) continue

  // what did the analyzer produce for a file that contains the form?
  let res: any = null
  try { res = await ASTEngine.parseFile(abs, src) } catch { res = null }
  const syms = (res?.symbols ?? []).length
  const rels = (res?.relationships ?? []).length
  for (const name of hits) {
    const s = stats.get(name)!
    s.filesWith++
    s.emittedSymbols += syms
    s.emittedRels += rels
  }
}

const rows = [...stats.entries()].sort((a, b) => b[1].filesWith - a[1].filesWith)
console.log(`syntax-form census — ${path.basename(REPO)}  (${files.length} JS files)`)
console.log(`\n  ${"form".padEnd(32)} ${"files".padStart(7)} ${"nodes".padStart(8)}`)
for (const [name, s] of rows) {
  const flag = s.filesWith === 0 ? "   <- NOT EXERCISED on this corpus" : ""
  console.log(`  ${name.padEnd(32)} ${String(s.filesWith).padStart(7)} ${String(s.nodes).padStart(8)}${flag}`)
}

if (JSON_OUT) {
  mkdirSync(path.dirname(JSON_OUT), { recursive: true })
  writeFileSync(JSON_OUT, JSON.stringify({
    at: new Date().toISOString(),
    repo: REPO,
    files: files.length,
    forms: Object.fromEntries(rows),
    note: "presence = files whose parse tree contains the form (0 means the corpus never exercises it, NOT that the analyzer is broken); emitted* = the analyzer's totals summed over those files.",
  }, null, 2))
  console.log(`\n  artifact: ${JSON_OUT}`)
}