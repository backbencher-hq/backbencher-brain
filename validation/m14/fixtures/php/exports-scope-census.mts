/**
 * PHP `exports` — WHAT THE LANE EMITS, AND WHAT A WIDER READING WOULD ADD, both counted.
 *
 * ## Why this exists
 *
 * The lane's `exports` rule is `define()`-only, and PHPD33 says why: a `define()`d name is
 * "the only publication form that is not already a symbol in the file". Every other
 * publication form — `class Foo`, `function bar()`, `const BAZ` — IS a symbol the file already
 * publishes, so an `exports` edge beside it would restate `contains`.
 *
 * That is a REASON, and a reason is not a size. The family convention is BROADER: ruby emits
 * `exports` for `fileUnit -> symbol` (and counts `exportDuplicateOfContains` rather than
 * avoiding it), python for its module-level names, go for every capitalized declaration. So a
 * reader of the fleet sees php emitting 58 `exports` edges where ruby emits one per file-level
 * symbol, and cannot tell whether that is a boundary or an omission.
 *
 * This instrument counts BOTH readings over the whole admitted population, so the boundary is
 * priced:
 *
 *   EMITTED     file-scope `define('NAME', ...)` with a literal name — the lane's rule, and
 *               the population `script/m14/oracles/php-exports.ts` models (58 edges over the
 *               18 files that carry one; the crosscheck proves analyzer == oracle 58/58)
 *   WIDER       every NAMED file-level declaration a consumer could import: class, interface,
 *               trait, enum, function, and `const`. Counted separately per kind so the size of
 *               each candidate widening is visible rather than lumped.
 *
 * Nothing here changes the analyzer. The number is the price of the boundary, and it belongs in
 * the spec beside the ruling so the next reader can decide with it instead of re-deriving it.
 *
 * BOUND: file-level means a direct child of `program` or of a `namespace_definition` body —
 * the same positions the analyzer publishes as file-scope symbols. A declaration nested in a
 * callable is NOT counted (it is not a file-level publication; PHPD37 covers that shape).
 *
 * Run: npx tsx validation/m14/fixtures/php/exports-scope-census.mts
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024

const files: { abs: string; repo: string; rel: string }[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(".php")) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push({ abs, repo: name, rel })
  }
}
files.sort((a, b) => (a.abs < b.abs ? -1 : 1))

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm"))))

const DECL_KINDS = new Set([
  "class_declaration", "interface_declaration", "trait_declaration", "enum_declaration",
  "function_definition", "const_declaration",
])
/** Scope nodes that make a declaration NOT file-level. Deliberately the analyzer's own SCOPE
 *  set from `emitDefineExports` — the question is about the same boundary, so it must be the
 *  same boundary. */
const SCOPE = new Set([
  "function_definition", "method_declaration", "anonymous_function", "arrow_function",
  "class_declaration", "interface_declaration", "trait_declaration", "enum_declaration",
  "function_static_declaration",
])

const byKind = new Map<string, number>()
const filesByKind = new Map<string, Set<string>>()
let definitionsFileLevel = 0
const defineFiles = new Set<string>()
const defineSitesByFile = new Map<string, number>()
let defineCalls = 0
let parsed = 0

for (const f of files) {
  let tree: any
  try { tree = parser.parse(readFileSync(f.abs, "utf8")) } catch { continue }
  parsed++
  const root = tree.rootNode
  // THE WIDER READING: a NAMED declaration that is a file-level statement. `walk` visits every
  // node; the `isFileLevel` test is the analyzer's own ancestor walk, so the two readings are
  // measured against one definition of "file level".
  const isFileLevel = (n: any): boolean => {
    let a = n.parent, guard = 0
    while (a && guard++ < 64) {
      if (a.type === "program") return true
      if (SCOPE.has(a.type)) return false
      a = a.parent
    }
    return false
  }
  const walk = (n: any) => {
    if (DECL_KINDS.has(n.type) && n.childForFieldName("name") && isFileLevel(n)) {
      definitionsFileLevel++
      byKind.set(n.type, (byKind.get(n.type) ?? 0) + 1)
      let s = filesByKind.get(n.type)
      if (!s) filesByKind.set(n.type, (s = new Set()))
      s.add(f.rel)
    }
    if (n.type === "function_call_expression") {
      const fn = n.childForFieldName("function")
      const shape = fn?.text === "define" || fn?.text === "\\define"
      if (shape && isFileLevel(n)) {
        const args = n.namedChildCount > 0 ? [...Array(n.namedChildCount)].map((_, i) => n.namedChild(i)).find((c: any) => c?.type === "arguments") : null
        const wrapper = args?.namedChild(0)
        const value = wrapper && wrapper.type === "argument"
          ? [...Array(wrapper.namedChildCount)].map((_, i) => wrapper.namedChild(i)).find((c: any) => c?.type === "encapsed_string" || c?.type === "string")
          : wrapper
        if (value && (value.type === "string" || value.type === "encapsed_string")) {
          const nm = String(value.text).slice(1, -1)
          if (nm.length > 0 && nm.trim().length > 0) {
            defineCalls++
            // KEYED `<repo>/<rel>` — the committed audit's own spelling, so the control below
            // compares keys and not two different conventions, and so two repos that both carry
            // `tests/bootstrap.php` are two files rather than one collapsed key.
            const key = `${f.repo}/${f.rel}`
            defineFiles.add(key)
            defineSitesByFile.set(key, (defineSitesByFile.get(key) ?? 0) + 1)
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(root)
  tree.delete?.()
}

console.log(`admitted .php files ${files.length}, parsed ${parsed}\n`)
console.log("=== exports: the emitted population vs each wider reading ===")
console.log(`EMITTED  file-scope define('NAME', ...) literal   ${defineCalls} sites in ${defineFiles.size} files   <- the analyzer's whole applicable set`)
let widerTotal = 0
for (const k of DECL_KINDS) {
  const n = byKind.get(k) ?? 0
  widerTotal += n
  console.log(`WIDER    ${k.padEnd(22)} ${String(n).padStart(6)} sites in ${(filesByKind.get(k)?.size ?? 0)} files`)
}
console.log(`WIDER TOTAL named file-level declarations        ${widerTotal}`)
console.log(`\nthe boundary is ${widerTotal} declarations wide: a declaration-based reading would emit ${widerTotal} more edges`)
console.log(`(of which ${(byKind.get("class_declaration") ?? 0) + (byKind.get("interface_declaration") ?? 0) + (byKind.get("trait_declaration") ?? 0) + (byKind.get("enum_declaration") ?? 0)} type declarations, ${byKind.get("function_definition") ?? 0} functions, ${byKind.get("const_declaration") ?? 0} const statements)`)

writeFileSync(path.join(ROOT, "validation/m14/fixtures/php/exports-scope-census.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  corpusRoot: CR,
  population: { admitted: files.length, parsed },
  emitted: { defineSites: defineCalls, files: defineFiles.size },
  wider: Object.fromEntries([...DECL_KINDS].map((k) => [k, { sites: byKind.get(k) ?? 0, files: filesByKind.get(k)?.size ?? 0 }])),
  widerTotal,
}, null, 2))
console.log(`\nartifact: validation/m14/fixtures/php/exports-scope-census.json`)

// ---------------------------------------------------------------- CONTROL: the committed audit
// `validation/m60/php/exports-probe.json` is the lane's own whole-population define-audit: 58
// publications over 18 files. A denominator that disagrees with it is a second opinion, so this
// control RE-DERIVES that list file by file with the same walker used above and prints every
// file whose count differs. `mismatching files 0` is what makes the boundary number trustworthy.
const auditPath = path.join(ROOT, "validation/m60/php/exports-probe.json")
if (existsSync(auditPath)) {
  const audit = JSON.parse(readFileSync(auditPath, "utf8"))
  const pubs: { file: string }[] = audit?.defineAudit?.publications ?? []
  const auditByFile = new Map<string, number>()
  for (const p of pubs) auditByFile.set(p.file, (auditByFile.get(p.file) ?? 0) + 1)
  let mismatching = 0
  for (const [rel, n] of auditByFile) {
    const mine = defineSitesByFile.get(rel) ?? 0
    if (mine !== n) { mismatching++; console.log(`  CONTROL DIFF audit=${n} mine=${mine}  ${rel}`) }
  }
  const auditTotal = pubs.length
  const mineTotal = [...auditByFile.keys()].reduce((a, k) => a + (defineSitesByFile.get(k) ?? 0), 0)
  console.log(`\nCONTROL vs the committed audit (validation/m60/php/exports-probe.json):`)
  console.log(`  audit files ${auditByFile.size}, publications ${auditTotal}; this walker over THOSE files: ${mineTotal} sites in ${[...auditByFile.keys()].filter((k) => (defineSitesByFile.get(k) ?? 0) > 0).length} files`)
  console.log(`  files whose per-file count differs: ${mismatching}`)
  console.log(`  whole-corpus totals: audit publications ${auditTotal}, this walker ${defineCalls} (the walker's population is the filesystem; the audit's is the admitted list)`)
} else {
  console.log(`\nCONTROL SKIPPED — ${auditPath} is absent, so nothing checks this walker against the lane's own audit`)
}
