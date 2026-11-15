/**
 * RUBY LANE — the 113 `contains` edges whose SOURCE does not resolve. (M60)
 *
 * §25 claimed `contains` and `overrides` resolve at 100% "because both sides are
 * declared symbols". Re-measured with a corrected instrument, that is true of
 * `overrides` (5,483/5,483) and FALSE of `contains` (10,657/10,770 — 99.0%).
 * 113 containment edges have a target that resolves and a SOURCE that does not.
 *
 * `contains` is the parent -> member edge, so an unresolvable source is a
 * containment whose PARENT is not a declared symbol: the file-scope owner
 * sentinel, a dynamic/eval scope, or a name the analyzer invented. Each is a
 * different defect with a different owner, so this enumerates them rather than
 * counting them.
 *
 * Usage:
 *   npx tsx script/m14/tmp/rb-contains-source.ts <corpus-root>... [--limit N]
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

async function main() {
  await Parser.init()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  const parser = new Parser()
  parser.setLanguage(lang as any)

  const limitAt = process.argv.indexOf("--limit")
  const LIMIT = limitAt >= 0 ? parseInt(process.argv[limitAt + 1]) : Infinity
  const roots = process.argv.slice(2).filter((a, i) => !a.startsWith("--") && !(i > 0 && process.argv[i - 1] === "--limit"))
  if (roots.length === 0) { console.error("usage: rb-contains-source.ts <corpus-root>... [--limit N]"); process.exit(2) }
  let files: string[] = []
  for (const r of roots) files = files.concat(listRubyFiles(path.resolve(r)))
  const corpusTotal = files.length
  // Same even-stride discipline as the other probes: a prefix of `rails` is almost
  // entirely activerecord/lib and reads that directory's shape as the corpus's.
  if (Number.isFinite(LIMIT) && files.length > LIMIT) {
    const stride = files.length / LIMIT
    const picked: string[] = []
    for (let i = 0; i < LIMIT; i++) picked.push(files[Math.floor(i * stride)])
    files = picked
  }

  // The corpus's declared names, the SAME resolution rule the reachability probe
  // uses, so a name called unresolvable here is unresolvable there too. Two
  // instruments must not disagree about what resolves.
  const declaredNames = new Set<string>()
  const declaredQualified = new Set<string>()
  const parsed: Array<{ res: any; file: string }> = []
  for (const f of files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let tree: any
    try { tree = parser.parse(content) } catch { continue }
    let res: any
    try { res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f) } catch { continue }
    for (const s of res.symbols ?? []) {
      declaredNames.add(String(s.name))
      if (s.ownerName) declaredQualified.add(`${s.ownerName}.${s.name}`)
    }
    parsed.push({ res, file: path.relative(roots[0], f) })
  }

  interface Case { file: string; source: string; target: string; line: number; shape: string; body: string }
  const cases: Case[] = []
  for (const { res, file } of parsed) {
    for (const r of res.relationships ?? []) {
      if (String(r.type ?? "") !== "contains") continue
      const src = String(r.source ?? "")
      const tgt = String(r.target ?? "")
      const sLeaf = src.split(".").pop() ?? src
      if (src === "Global" || declaredNames.has(src) || declaredNames.has(sLeaf)) continue
      cases.push({ file, source: src, target: tgt, line: r.line_number ?? 0, shape: "", body: "" })
    }
  }

  // Classify each unresolvable parent by what it LOOKS like, and read the source
  // line so the classification can be checked rather than believed.
  const classes = new Map<string, Case[]>()
  for (const c of cases) {
    let body = ""
    try {
      const full = path.join(roots[0], c.file)
      body = fs.readFileSync(full, "utf8").split("\n")[Math.max(0, c.line - 1)]?.trim() ?? ""
    } catch { /* corpus root mismatch: classification falls back to the name */ }
    c.body = body.slice(0, 110)
    const s = c.source
    let shape: string
    if (/^[A-Z]/.test(s) && /[:#]/.test(s)) shape = "qualified constant (Klass#member / Klass::CONST)"
    else if (/^[A-Z]/.test(s)) shape = "bare Constant (ClassName) — a class the parser did not declare"
    else if (/\(/.test(s)) shape = "synthetic with parens"
    else if (/^#</.test(s)) shape = "operator method (#<=)"
    else if (/[A-Z]/.test(s)) shape = "mixed-case / ivar-like"
    else shape = "lowercase or other"
    c.shape = shape
    if (!classes.has(shape)) classes.set(shape, [])
    classes.get(shape)!.push(c)
  }

  console.log("=".repeat(94))
  console.log("M60 — `contains` EDGES WHOSE SOURCE DOES NOT RESOLVE")
  console.log("=".repeat(94))
  console.log(`corpus: ${corpusTotal} .rb files, ${files.length} read, ${parsed.length} parsed`)
  console.log(`declared names: ${declaredNames.size}`)
  console.log(`contains edges with an unresolvable PARENT: ${cases.length}\n`)

  for (const [shape, list] of [...classes.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${String(list.length).padStart(4)}  ${shape}`)
    // Distinct files and distinct parents, because 90 copies of one bug is one bug.
    const filesN = new Set(list.map((c) => c.file)).size
    const parents = new Set(list.map((c) => c.source))
    console.log(`      ${filesN} files, ${parents.size} distinct parents`)
    for (const c of list.slice(0, 4)) console.log(`      ${c.file}:${c.line}  parent=${c.source}  child=${c.target}\n         | ${c.body}`)
    console.log()
  }

  const summary = Object.fromEntries([...classes.entries()].map(([k, v]) => [k, {
    n: v.length, files: new Set(v.map((c) => c.file)).size, parents: [...new Set(v.map((c) => c.source))].slice(0, 20),
  }]))
  fs.mkdirSync(path.join(ROOT, "validation", "m60", "results"), { recursive: true })
  fs.writeFileSync(path.join(ROOT, "validation", "m60", "results", "ruby-contains-source.json"), JSON.stringify({
    at: new Date().toISOString(), corpusTotal, filesRead: files.length, declaredNames: declaredNames.size,
    unresolvedContainsSources: cases.length, classes: summary,
    cases: cases.slice(0, 400),
  }, null, 2))
  console.log("evidence: validation/m60/results/ruby-contains-source.json")
}

main()
