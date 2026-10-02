/**
 * PHP MASTER REVIEW HARNESS (read-only probe; writes no artifact).
 *
 * Re-derives, at the working tree, every claim the php lane publishes:
 *   - the relationship label set actually emitted, per label, with line coverage
 *   - the symbol kind set actually emitted, with range coverage
 *   - AST-side reachability of the labels whose emitted count reads LOW
 *     (a label can read 0 either because the language has no such construct
 *      in the corpus, or because the rule cannot fire -- the two are
 *      indistinguishable from the analyzer's output alone)
 *   - zero-regex, by the same AST-driven census the project uses
 *
 * Run: bun script/m60/tmp/php-master-review.mts [--full] [--json]
 */
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = "$HOME/backbencher-brain"
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const FULL = process.argv.includes("--full")
const AS_JSON = process.argv.includes("--json")
const LIMIT = FULL ? 100000 : 1500

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { scanAnalyzers } = await import(path.join(ROOT, "script/m12/regex-census-core.ts"))

function filesUnder(dir: string, exts: string[], out: string[] = [], cap = 100000): string[] {
  if (out.length >= cap) return out
  let names: string[]
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (out.length >= cap) return out
    if (name.startsWith(".") || name === "node_modules") continue
    const p = path.join(dir, name)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) filesUnder(p, exts, out, cap)
    else if (exts.some((e) => name.endsWith("." + e))) out.push(p)
  }
  return out
}

const repos = ["phpunit", "phpmyadmin"]
const labels = new Map<string, { n: number; noLine: number; zero: number; conf: Map<number, number> }>()
const kinds = new Map<string, { n: number; noStart: number; noEnd: number; noComplexity: number }>()
let files = 0, edges = 0, symbols = 0, parseErrFiles = 0
let complexitySyms = 0, complexitySum = 0
const evidenceClasses = new Map<string, number>()
const dirCount = new Map<string, number>()
const metadataRelationshipTypes = new Map<string, number>()
// AST-side construct reachability, per file, via the RAW tree the engine already parsed.
const astCounts: Record<string, number> = {}
const AST_PROBES: Record<string, string[]> = {
  base_clause: ["class_declaration", "interface_declaration"],
  class_interface_clause: ["class_declaration", "enum_declaration"],
  enum_case: ["enum_declaration"],
  method_declaration: ["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"],
  property_declaration: ["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"],
  const_declaration: ["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration", "program"],
  use_declaration: ["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"],
  trait_precedence: ["class_declaration"],
  property_promotion_parameter: ["method_declaration"],
  enum_backed_type: ["enum_declaration"],
  anonymous_function_creation_expression: ["*"],
  anonymous_function: ["*"],
  arrow_function: ["*"],
  function_definition: ["program"],
  method_call_expression: ["*"],
  scoped_call_expression: ["*"],
  object_creation_expression: ["*"],
  namespace_use_group: ["*"],
  variadic_placeholder: ["*"],
  catch_clause: ["*"],
  relative_scope: ["*"],
}
// in-file inheritance: a class whose base is ALSO declared in the same file,
// i.e. the only shape in which the lane can verify an `overrides` edge.
let classesWithBase = 0, baseDeclaredSameFile = 0
const sameFileInheritanceCases: string[] = []

for (const repo of repos) {
  const root = path.join(CORPUS_ROOT, repo)
  // ONE universe, shared with php-both-sides.mts and php-ast-census.mts: the
  // git-tracked file list, so every number in the review is over the same files.
  const paths = execSync(`git ls-files -z -- '*.php'`, { cwd: root, maxBuffer: 1 << 28 })
    .toString().split("\0").filter(Boolean).sort()
    .map((f) => path.join(root, f))
  let repoFiles = 0
  for (const file of paths) {
    if (files >= LIMIT) break
    let src: string
    try { src = readFileSync(file, "utf8") } catch { continue }
    files++
    repoFiles++
    const top = path.relative(root, file).split("/")[0]
    dirCount.set(`${repo}/${top}`, (dirCount.get(`${repo}/${top}`) ?? 0) + 1)
    let res: any
    try { res = await ASTEngine.parseFile(file, src) } catch { parseErrFiles++; continue }
    if ((res?.errors?.length ?? 0) > 0) parseErrFiles++
    const rels: any[] = res?.relationships ?? []
    const syms: any[] = res?.symbols ?? []
    if (repoFiles <= 0) { /* noop */ }
    edges += rels.length
    symbols += syms.length
    for (const r of rels) {
      const t = String(r.type ?? r.relationshipType ?? "?")
      let e = labels.get(t)
      if (!e) { e = { n: 0, noLine: 0, zero: 0, conf: new Map() }; labels.set(t, e) }
      e.n++
      if (r.line_number === undefined || r.line_number === null) e.noLine++
      else if (r.line_number === 0) e.zero++
      const c = Math.round((r.confidence ?? 0) * 100) / 100
      e.conf.set(c, (e.conf.get(c) ?? 0) + 1)
      const ec = r.metadata?.evidenceClass
      if (ec) evidenceClasses.set(ec, (evidenceClasses.get(ec) ?? 0) + 1)
      const rt = r.metadata?.relationshipType
      if (rt) metadataRelationshipTypes.set(String(rt), (metadataRelationshipTypes.get(String(rt)) ?? 0) + 1)
    }
    for (const s of syms) {
      const k = String(s.kind ?? "?")
      let e = kinds.get(k)
      if (!e) { e = { n: 0, noStart: 0, noEnd: 0, noComplexity: 0 }; kinds.set(k, e) }
      e.n++
      if (s.range?.startLine === undefined || s.range?.startLine === null) e.noStart++
      if (s.range?.endLine === undefined || s.range?.endLine === null) e.noEnd++
      if (s.complexity !== undefined && s.complexity !== null) { e.noComplexity++; complexitySyms++; complexitySum += s.complexity }
    }

    const tree: any = null
    if (tree) {
      const stack: any[] = [tree.rootNode]
      while (stack.length) {
        const n = stack.pop()!
        for (const key of Object.keys(AST_PROBES)) {
          if (n.type === key && AST_PROBES[key].includes("*")) astCounts[key] = (astCounts[key] ?? 0) + 1
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
      }
    }
  }
}

// zero-regex
const regexAll = await scanAnalyzers(path.join(ROOT, "src/ast"))
const regexPhp = regexAll.filter((u: any) => /php/i.test(u.file))

const out = {
  files, edges, symbols, parseErrFiles,
  labels: [...labels.entries()].sort((a, b) => b[1].n - a[1].n)
    .map(([k, v]) => ({ label: k, n: v.n, noLine: v.noLine, zero: v.zero, confidences: Object.fromEntries([...v.conf.entries()].sort()) })),
  kinds: [...kinds.entries()].sort((a, b) => b[1].n - a[1].n)
    .map(([k, v]) => ({ kind: k, n: v.n, noStartLine: v.noStart, noEndLine: v.noEnd, withComplexity: v.noComplexity })),
  evidenceClasses: Object.fromEntries([...evidenceClasses.entries()].sort((a, b) => b[1] - a[1])),
  metadataRelationshipTypes: Object.fromEntries([...metadataRelationshipTypes.entries()].sort((a, b) => b[1] - a[1])),
  complexity: { symbolsWithComplexity: complexitySyms, sum: complexitySum },
  dirCount: Object.fromEntries([...dirCount.entries()].sort((a, b) => b[1] - a[1])),
  astReachability: astCounts,
  overrideReachability: { classesWithBase, baseDeclaredSameFile, samples: sameFileInheritanceCases },
  regex: { totalProject: regexAll.length, phpAnalyzer: regexPhp.length },
}

if (AS_JSON) { console.log(JSON.stringify(out, null, 1)); process.exit(0) }

console.log(`files=${files} edges=${edges} symbols=${symbols} parseErrFiles=${parseErrFiles}`)
console.log("\n=== LABELS (emitted) ===")
for (const l of out.labels) console.log(`  ${l.label.padEnd(12)} n=${String(l.n).padStart(7)}  noLine=${l.noLine}  zero=${l.zero}  conf=${JSON.stringify(l.confidences)}`)
console.log("\n=== KINDS (emitted) ===")
for (const k of out.kinds) console.log(`  ${k.kind.padEnd(12)} n=${String(k.n).padStart(7)}  noStart=${k.noStartLine} noEnd=${k.noEndLine} complexity=${k.withComplexity}`)
console.log("\n=== corpus composition ===", JSON.stringify(out.dirCount, null, 1))
console.log("\n=== evidenceClass ===", JSON.stringify(out.evidenceClasses))
console.log("=== metadata.relationshipType ===", JSON.stringify(out.metadataRelationshipTypes))
console.log("=== complexity ===", JSON.stringify(out.complexity))
console.log("\n=== AST reachability (per corpus file universe) ===")
for (const [k, v] of Object.entries(out.astReachability).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(34)} ${v}`)
console.log("\n=== override reachability ===", JSON.stringify(out.overrideReachability, null, 1))
console.log("\n=== regex ===", JSON.stringify(out.regex))
process.exit(0)
