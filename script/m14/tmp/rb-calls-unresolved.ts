/**
 * RUBY LANE — why do 56% of `calls` not resolve? (M60)
 *
 * §28 left this open on purpose. Of the 49.5% of the ruby graph no query can
 * return, the identified causes are external gem requires, ivar/value targets
 * and implicit namespaces. The `calls` gap is the largest slice and the least
 * examined: 74,372 emitted, 32,635 resolve, **41,737 do not**.
 *
 * A `calls` target that names no declared symbol has a small number of possible
 * causes, and they are NOT the same defect:
 *
 *   - a method defined in a file OUTSIDE the sample. The probe indexes declared
 *     names across the whole sample, so a cross-file call is unresolved for a
 *     sampling reason, not an analyzer reason. This must be separated FIRST or
 *     everything else is measured against a false denominator — the same mistake
 *     that made §27's first run report its own sampling as a language fact.
 *   - a BUILTIN or a method on an included/prepended module.
 *   - a method Ruby defines by DSL: `attr_accessor`, `define_method`, `delegate_to`.
 *   - a receiver-less call to a method defined later in the file (forward ref).
 *   - a DYNAMIC dispatch: `send`, `public_send`, `method(:x).call`.
 *   - a name the analyzer got wrong — a genuine defect, and the only class worth
 *     a parser fix.
 *
 * The last one is what makes this worth running: the first five are facts, and a
 * fix aimed at any of them would be a fix that damages the analyzer. So the
 * probe separates them and only the residue is a candidate defect.
 *
 * Usage:
 *   npx tsx script/m14/tmp/rb-calls-unresolved.ts <corpus-root>... [--limit N]
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")

function listRubyFiles(root: string): string[] {
  const out: string[] = []
  const skip = new Set([".git", "node_modules", "vendor", "tmp", "log"])
  const walk = (d: string) => {
    let ents: fs.Dirent[]
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (e.name.startsWith(".")) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(p) }
      else if (e.isFile() && e.name.endsWith(".rb")) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

/** Ruby's own builtin method names. A target here is not a missing symbol in this
 *  project; it is a method the runtime provides. Kept explicit and small rather
 *  than guessed, because an over-broad builtin list would excuse real defects. */
const BUILTINS = new Set([
  "puts", "print", "p", "pp", "require", "require_relative", "load", "loop", "lambda", "proc",
  "raise", "fail", "catch", "throw", "freeze", "frozen?", "dup", "clone", "tap", "then", "yield",
  "block_given?", "caller", "binding", "caller_locations", "define_method", "instance_variable_get",
  "instance_variable_set", "attr_accessor", "attr_reader", "attr_writer", "private", "public",
  "protected", "module_function", "extend", "include", "prepend", "new", "send", "__send__",
  "public_send", "respond_to?", "is_a?", "kind_of?", "instance_of?", "nil?", "class", "to_s", "inspect",
  "hash", "freeze", "frozen?", "eql?", "equal?", "==", "!=", "equal?", "method", "methods",
  "instance_methods", "define_singleton_method", "singleton_class", "extend", "name", "superclass",
  "ancestors", "const_get", "const_set", "const_defined?", "display", "extend", "format", "sprintf",
  "warn", "abort", "at_exit", "sleep", "exit", "gets", "open", "system", "`", "sleep",
])

/** Method names a DSL creates without a visible `def`, so no `def` site can be
 *  found for them and no analyzer can be at fault for missing one. */
const DSL_GENERATED = /^(attr_(reader|writer|accessor)|delegate_to|delegate|has_(many|one)|belongs_to|before_|after_|around_|scope|validates|include_|extend_|define_method|mattr_|cattr_|concerning|helper_method|resource|belongs_to)/

const DYNAMIC = /^(send|public_send|__send__|method|define_method|instance_eval|class_eval|module_eval|eval)$/

async function main() {
  await Parser.init()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  const parser = new Parser()
  parser.setLanguage(lang as any)

  const limitAt = process.argv.indexOf("--limit")
  const LIMIT = limitAt >= 0 ? parseInt(process.argv[limitAt + 1]) : Infinity
  const roots = process.argv.slice(2).filter((a, i) => !a.startsWith("--") && !(i > 0 && process.argv[i - 1] === "--limit"))
  if (roots.length === 0) { console.error("usage: rb-calls-unresolved.ts <corpus-root>... [--limit N]"); process.exit(2) }

  let allFiles: string[] = []
  for (const r of roots) allFiles = allFiles.concat(listRubyFiles(path.resolve(r)))
  const corpusTotal = allFiles.length
  // The denominator is the CORPUS, not the sample — §27's second bug. Declared
  // names are gathered from every file, then only PARSING is sampled, so a call
  // into an unsampled file is attributed to sampling instead of to the analyzer.
  const fullNames = new Set<string>()
  for (const f of allFiles) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    if (content.length > 400_000) continue
    let tree: any
    try { tree = parser.parse(content) } catch { continue }
    let res: any
    try { res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f) } catch { continue }
    for (const s of res.symbols ?? []) fullNames.add(String(s.name))
  }

  let files = allFiles
  if (Number.isFinite(LIMIT) && files.length > LIMIT) {
    const stride = files.length / LIMIT
    const picked: string[] = []
    for (let i = 0; i < LIMIT; i++) picked.push(files[Math.floor(i * stride)])
    files = picked
  }

  const classes = new Map<string, number>()
  // If the unexplained class were a scatter of many distinct names, the analyzer
  // would be inventing targets. If it is a few dozen names, they are FRAMEWORK
  // methods the corpus does not declare - a fact, not a defect. The frequency is
  // the whole question, so it is measured rather than argued.
  const topUnexplained = new Map<string, number>()
  const samples = new Map<string, Array<{ file: string; line: number; target: string; source: string; body: string }>>()
  const bump = (k: string, c: { file: string; line: number; target: string; source: string; body: string }) => {
    classes.set(k, (classes.get(k) ?? 0) + 1)
    const arr = samples.get(k) ?? []
    if (arr.length < 5) { arr.push(c); samples.set(k, arr) }
  }

  let emitted = 0, resolved = 0, unresolved = 0
  for (const f of files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let tree: any
    try { tree = parser.parse(content) } catch { continue }
    let res: any
    try { res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f) } catch { continue }
    const rel = path.relative(roots[0], f)
    for (const r of res.relationships ?? []) {
      if (String(r.type ?? "") !== "calls") continue
      emitted++
      const tgt = String(r.target ?? "")
      const leaf = tgt.includes("::") ? tgt.slice(tgt.lastIndexOf("::") + 2) : tgt
      const member = leaf.split(".").pop() ?? leaf
      if (fullNames.has(tgt) || fullNames.has(leaf) || fullNames.has(member)) { resolved++; continue }
      unresolved++
      const line = r.line_number ?? 0
      const body = content.split("\n")[Math.max(0, line - 1)]?.trim().slice(0, 100) ?? ""
      const ctx = { file: rel, line, target: tgt, source: String(r.source ?? ""), body }
      if (DYNAMIC.test(member)) bump("DYNAMIC dispatch (send/eval/method(:x))", ctx)
      else if (BUILTINS.has(member)) bump("RUBY BUILTIN — runtime-provided, not a project symbol", ctx)
      else if (DSL_GENERATED.test(member)) bump("DSL-GENERATED (attr_*/belongs_to/scope/...) — no def site exists", ctx)
      else if (/^[A-Z]/.test(tgt)) bump("Constant receiver — a class the sample does not declare", ctx)
      else if (/^(self|@|\$)/.test(tgt)) bump("self / ivar / gvar target", ctx)
      else if (/\(|\)/.test(tgt)) bump("synthetic name with parens", ctx)
      else if (/^[a-z_]+[?!]?$/.test(member)) { bump("UNEXPLAINED plain method name — candidate defect", ctx); topUnexplained.set(member, (topUnexplained.get(member) ?? 0) + 1) }
      else bump("other shape", ctx)
    }
  }

  const pct = (n: number) => emitted === 0 ? "0.0%" : ((n / emitted) * 100).toFixed(1) + "%"
  console.log("=".repeat(96))
  console.log("M60 — WHY DO CALLS NOT RESOLVE?")
  console.log("=".repeat(96))
  console.log(`corpus: ${corpusTotal} .rb files, ${files.length} parsed, ${fullNames.size} declared names (corpus-wide)`)
  console.log(`calls emitted ${emitted}   resolved ${resolved} (${pct(resolved)})   UNRESOLVED ${unresolved} (${pct(unresolved)})\n`)
  console.log("classification of the unresolved — only the last class is a candidate analyzer defect\n")
  for (const [k, n] of [...classes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(6)}  ${pct(n).padStart(6)}  ${k}`)
    for (const s of samples.get(k) ?? []) console.log(`           ${s.file}:${s.line}  ${s.target}   | ${s.body}`)
  }

  const top = [...topUnexplained.entries()].sort((a, b) => b[1] - a[1])
  const topSum = top.reduce((a, [, n]) => a + n, 0)
  const unexpl = classes.get("UNEXPLAINED plain method name — candidate defect") ?? 0
  console.log(`\n  the unexplained class: ${top.length} DISTINCT target names across ${unexpl} edges`)
  console.log(`  the top 25 carry ${top.slice(0, 25).reduce((a, [, n]) => a + n, 0)} of them (${((top.slice(0, 25).reduce((a, [, n]) => a + n, 0) / unexpl) * 100).toFixed(1)}%)\n`)
  for (const [name, n] of top.slice(0, 25)) console.log(`    ${String(n).padStart(5)}  ${name}`)

  fs.mkdirSync(path.join(ROOT, "validation", "m60", "results"), { recursive: true })
  fs.writeFileSync(path.join(ROOT, "validation", "m60", "results", "ruby-calls-unresolved.json"), JSON.stringify({
    at: new Date().toISOString(), corpusTotal, filesParsed: files.length, corpusDeclaredNames: fullNames.size,
    emitted, resolved, unresolved, classes: Object.fromEntries(classes), samples: Object.fromEntries(samples),
    unexplainedDistinctTargets: topUnexplained.size, topUnexplained: Object.fromEntries(top),
  }, null, 2))
  console.log("\nevidence: validation/m60/results/ruby-calls-unresolved.json")
}

main()
