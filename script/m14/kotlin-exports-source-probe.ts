/**
 * KOTLIN EXPORTS/IMPORTS SOURCE PROBE — the measurement that decides the two
 * emission rules, both of which are LANGUAGE rules rather than conventions, and
 * both of which a source reading gets wrong.
 *
 * WHY IT DRIVES `analyze()` AND NOT `parseFile`. The two see different shapes and
 * the difference decided the whole design:
 *
 *   parseFile (pool-worker) projects a symbol to a flat record and fills
 *     `ownerName: s.ownerName || s.scope`. For a kotlin top-level declaration
 *     `ownerName` is undefined in the analyzer and `scope` is the PACKAGE, so the
 *     projection reports a top-level class as owned by `org.jetbrains.kotlin.…`.
 *   analyze() (the analyzer's own ParseResult) leaves `ownerName` undefined and
 *     puts the package in `scope`, and keeps `range.startLine`.
 *
 *   A probe built on parseFile therefore sees 4 ownerless top-level symbols in 937
 *   package-bearing production files and would have concluded the export population
 *   is nearly empty. It is not: the analyzer emits them with the package in
 *   `scope`, which is exactly the string an `exports` edge wants as its SOURCE.
 *   Recorded here because the mistake is available to the next lane.
 *
 * THE THREE QUESTIONS.
 *   Q1 Is "no ownerName" the same predicate as "top-level declaration"? A class
 *      declared inside a function body has no owner in this analyzer
 *      (`isMemberPosition` is false outside a class_body), so it satisfies
 *      "no ownerName" while being LOCAL — unimportable by anything. Measured by
 *      re-reading the tree at the symbol's own declaration line, because the
 *      symbol alone cannot tell the two apart.
 *   Q2 What does requiring a non-empty package cost? The corpus is 71%
 *      `testData/` fragments, which legitimately have no package header, so a
 *      lexicographic window over-reports them. Both populations are reported.
 *   Q3 How many `import_header` declarations sit in a package-less file — the
 *      population that decides whether `imports` needs a root-package source.
 *
 * CLI: npx tsx script/m14/kotlin-exports-source-probe.ts [--sample N] [--out f]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { RealKotlinAnalyzer } from "../../src/ast/real-kotlin-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const SAMPLE = parseInt(argOf("--sample", "1000") ?? "1000")
const OUT = argOf("--out")
const DIR = path.join(CR, "kotlin")

const files: { rel: string; abs: string; text: string }[] = []
{
  const tracked = execFileSync("git", ["-C", DIR, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  for (const rel of tracked) {
    const abs = path.join(DIR, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "kotlin") continue
    files.push({ rel, abs, text })
  }
}
files.sort((a, b) => (a.rel < b.rel ? -1 : 1))
const admitted = SAMPLE > 0 ? files.slice(0, SAMPLE) : files

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-kotlin.wasm"))))

const BODY_NODES = new Set(["function_body", "lambda_literal", "anonymous_initializer", "secondary_constructor", "class_body", "object_literal", "catch_block", "do_while_statement", "while_statement", "for_statement"])
const DECL_NODES = new Set(["class_declaration", "object_declaration", "function_declaration", "property_declaration", "type_alias"])

/**
 * Locality of the DECLARATION node containing `offset`.
 *
 * Downward walk to the innermost node containing the offset, then up to the first
 * DECLARATION ancestor, then up again looking for a body. The first version of
 * this took the first ancestor whose TEXT contained the symbol name — which is
 * `source_file`, for every symbol — so it answered "top-level" 64 times out of 64
 * and would have certified a fabricated export rule as measured. A symbol with no
 * DECLARATION ancestor is `unknown`, never guessed into `top`.
 */
function locality(t: any, offset: number): "top" | "local" | "unknown" {
  let node: any = t.rootNode
  if (offset < node.startIndex || offset >= node.endIndex) return "unknown"
  for (;;) {
    let next: any = null
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.startIndex <= offset && offset < c.endIndex) { next = c; break }
    }
    if (!next) break
    node = next
  }
  let p: any = node
  while (p && !DECL_NODES.has(p.type)) p = p.parent
  if (!p) return "unknown"
  p = p.parent
  while (p) {
    if (BODY_NODES.has(p.type)) return "local"
    if (DECL_NODES.has(p.type)) return "top"
    p = p.parent
  }
  return "top"
}

/** 1-based line -> character offset of that line's first character. */
function offsetOfLine(text: string, line1: number): number {
  if (!line1 || line1 <= 1) return 0
  let seen = 1
  for (let k = 0; k < text.length; k++) {
    if (text.charCodeAt(k) === 10) { seen++; if (seen === line1) return k + 1 }
  }
  return 0
}

const analyzer = new RealKotlinAnalyzer()
type Counters = {
  ownerless_public: number
  ownerless_public_top: number
  ownerless_public_local: number
  ownerless_public_unknown: number
  top_with_pkg: number
  top_root_pkg: number
  top_no_scope_at_all: number
  local_examples: string[]
  top_examples: string[]
  root_pkg_examples: string[]
  unknown_examples: string[]
  by_kind: Record<string, number>
  by_visibility: Record<string, number>
  exportinfo_rows: number
  files_pkg: number
  files_no_pkg: number
  imports_total: number
  imports_pkg_file: number
  imports_root_file: number
  prod_files: number
  prod_pkg_files: number
  prod_top: number
  prod_top_root_pkg: number
  testdata_files: number
  testdata_top: number
  testdata_top_root_pkg: number
}
const q: Counters = {
  ownerless_public: 0, ownerless_public_top: 0, ownerless_public_local: 0, ownerless_public_unknown: 0,
  top_with_pkg: 0, top_root_pkg: 0, top_no_scope_at_all: 0,
  local_examples: [], top_examples: [], root_pkg_examples: [], unknown_examples: [],
  by_kind: {}, by_visibility: {}, exportinfo_rows: 0,
  files_pkg: 0, files_no_pkg: 0,
  imports_total: 0, imports_pkg_file: 0, imports_root_file: 0,
  prod_files: 0, prod_pkg_files: 0, prod_top: 0, prod_top_root_pkg: 0,
  testdata_files: 0, testdata_top: 0, testdata_top_root_pkg: 0,
}

let i = 0
async function worker(): Promise<void> {
  while (true) {
    const k = i++
    if (k >= admitted.length) return
    const f = admitted[k]
    const label = `kotlin/${f.rel}`
    const isTestData = /(^|\/)testData\//.test(f.rel)
    let t: any
    try { t = parser.parse(f.text) } catch { continue }
    if (!t) continue
    let r: any
    try { r = analyzer.analyze(t.rootNode, f.text, f.abs) } catch { t.delete?.(); continue }
    const hasPkg = (t.rootNode.namedChildren ?? []).some((c: any) => c.type === "package_header")
    if (hasPkg) q.files_pkg++
    else q.files_no_pkg++
    if (isTestData) q.testdata_files++
    else { q.prod_files++; if (hasPkg) q.prod_pkg_files++ }
    q.exportinfo_rows += (r.exports ?? []).length
    for (const s of r.symbols ?? []) {
      if (s.ownerName) continue
      if (s.metadata?.isPhantom || s.metadata?.isAnonymousObject) continue
      q.by_visibility[String(s.visibility)] = (q.by_visibility[String(s.visibility)] ?? 0) + 1
      if (s.visibility !== undefined && s.visibility !== "public") continue
      q.ownerless_public++
      q.by_kind[String(s.kind)] = (q.by_kind[String(s.kind)] ?? 0) + 1
      const loc = locality(t, offsetOfLine(f.text, s.range?.startLine ?? 0))
      if (loc === "local") {
        q.ownerless_public_local++
        if (q.local_examples.length < 6) q.local_examples.push(`${label}:${s.range?.startLine} ${s.kind} ${s.name}`)
        continue
      }
      if (loc === "unknown") {
        q.ownerless_public_unknown++
        if (q.unknown_examples.length < 6) q.unknown_examples.push(`${label}:${s.range?.startLine} ${s.kind} ${s.name} scope=${s.scope ?? ""}`)
        continue
      }
      q.ownerless_public_top++
      if (q.top_examples.length < 5) q.top_examples.push(`${label}:${s.range?.startLine} ${s.kind} ${s.name} scope=${s.scope ?? ""}`)
      if (!s.scope) { q.top_no_scope_at_all++; continue }
      if (hasPkg) {
        q.top_with_pkg++
        if (isTestData) q.testdata_top++
        else q.prod_top++
      } else {
        q.top_root_pkg++
        if (q.root_pkg_examples.length < 4) q.root_pkg_examples.push(`${label}:${s.range?.startLine} ${s.kind} ${s.name}`)
        if (isTestData) q.testdata_top_root_pkg++
        else q.prod_top_root_pkg++
      }
    }
    const walk = (n: any) => {
      if (n.type === "import_header") { q.imports_total++; if (hasPkg) q.imports_pkg_file++; else q.imports_root_file++ }
      for (let c = 0; c < n.childCount; c++) walk(n.child(c))
    }
    walk(t.rootNode)
    t.delete?.()
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

const out = { lane: "kotlin", instrument: "script/m14/kotlin-exports-source-probe.ts", files: admitted.length, ...q }
const pct = (a: number, b: number) => (b ? `${a} (${((a / b) * 100).toFixed(1)}%)` : `${a}`)
console.log(`kotlin exports/imports source probe — ${admitted.length} files, analyzer output shape\n`)
console.log(`Q1 ownerless + public symbols ............ ${q.ownerless_public}`)
console.log(`   top-level (an exports edge) ........... ${q.ownerless_public_top}`)
console.log(`   LOCAL in a body (must NOT export) ..... ${q.ownerless_public_local}  e.g. ${q.local_examples.slice(0, 3).join(" | ") || "none"}`)
console.log(`   locality undecidable .................. ${q.ownerless_public_unknown}  e.g. ${q.unknown_examples.slice(0, 2).join(" | ") || "none"}`)
console.log(`   by kind ${JSON.stringify(q.by_kind)}   by visibility ${JSON.stringify(q.by_visibility)}`)
console.log(`\nQ2 of the top-level ones: ${q.top_with_pkg} in a package-bearing file, ${q.top_root_pkg} in the ROOT package, ${q.top_no_scope_at_all} with no scope at all`)
console.log(`   packages: ${q.files_pkg} files with a package_header, ${q.files_no_pkg} without`)
console.log(`   production (non-testData): ${q.prod_files} files / ${q.prod_pkg_files} with a package; ${q.prod_top} top-level public symbols, ${q.prod_top_root_pkg} of them root-package`)
console.log(`   testData fragments: ${q.testdata_files} files; ${q.testdata_top} top-level public symbols, ${q.testdata_top_root_pkg} of them root-package`)
console.log(`   root-package examples: ${q.root_pkg_examples.slice(0, 3).join(" | ") || "none"}`)
console.log(`\n   ParseResult.exports rows (the ExportInfo list the doc calls the exports surface): ${q.exportinfo_rows}`)
console.log(`\nQ3 import_header declarations: ${q.imports_total} — ${q.imports_pkg_file} in package-bearing files, ${q.imports_root_file} in root-package files`)
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log(`\nwrote ${OUT}`) }
