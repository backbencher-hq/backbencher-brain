/**
 * RUBY LANE — why do 75% of `implements` not resolve? (M60)
 *
 * §29 closed `calls` and left `extends` (67.6%) and `implements` (25.0%) as the
 * largest unexamined surface. `implements` is the sharper of the two: only 579
 * edges, so a defect is CONCENTRATED rather than diluted, and 434 unresolved is
 * a small enough population to enumerate.
 *
 * `implements` comes from exactly one construct: `include Foo` and
 * `prepend Foo` with a constant argument (the analyzer deliberately declines a
 * dynamic one — see the comment on the mixin branch in the analyzer, which
 * documents a real fabrication it already prevents). So the target is always a
 * constant, and the question is whether that constant is a module the project
 * actually declares.
 *
 * The likely causes, in the order they would matter:
 *   - the mixin is defined in a file the ANALYZER never turned into symbols;
 *   - the mixin is a GEM module (Rails' own mixins are overwhelmingly this) —
 *     a fact, not a defect;
 *   - the constant is a `Struct`/`module` the analyzer does not model;
 *   - the analyzer reads the wrong name out of a `scope_resolution` — a defect.
 *
 * Usage:
 *   npx tsx script/m14/tmp/rb-implements.ts <corpus-root>... [--limit N]
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
    let e: fs.Dirent[]; try { e = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const x of e) { if (x.name.startsWith(".")) continue; const p = path.join(d, x.name)
      if (x.isDirectory()) { if (!skip.has(x.name)) walk(p) } else if (x.isFile() && x.name.endsWith(".rb")) out.push(p) }
  }
  walk(root); return out.sort()
}

/** One pass over the whole corpus that collects BOTH sets the classifier needs:
 *  every `module X` / `class X` NAME, and every analyzer symbol name.
 *
 *  Two passes — one to walk the tree for `module X`, one to run the analyzer —
 *  aborted the tree-sitter WASM heap with "Aborted()" at 8,528 files, because
 *  each pass re-parses every file and holds every tree. The two sets are
 *  independent questions about the SAME tree, so they are asked together: half
 *  the parses, half the live trees, and the classification needs both anyway.
 */
async function corpusIndex(files: string[], parser: Parser) {
  const modules = new Set<string>()
  const definedIn = new Map<string, string>()
  const symbolNames = new Set<string>()
  for (const f of files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    if (content.length > 400_000) continue
    let tree: any
    try { tree = parser.parse(content) } catch { continue }
    const stack: any[] = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "module" || n.type === "class") {
        const nameNode = n.childForFieldName?.("name")
        const t = nameNode?.text
        if (t) { modules.add(t); if (!definedIn.has(t)) definedIn.set(t, f) }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.child(i); if (c) stack.push(c) }
    }
    let res: any
    try { res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f) } catch { continue }
    for (const s of res.symbols ?? []) symbolNames.add(String(s.name))
    tree = null
  }
  return { modules, definedIn, symbolNames }
}

async function main() {
  await Parser.init()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  const parser = new Parser(); parser.setLanguage(lang as any)

  const limitAt = process.argv.indexOf("--limit")
  const LIMIT = limitAt >= 0 ? parseInt(process.argv[limitAt + 1]) : Infinity
  const roots = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  if (roots.length === 0) { console.error("usage: rb-implements.ts <corpus-root>... [--limit N]"); process.exit(2) }
  let allFiles: string[] = []
  for (const r of roots) allFiles = allFiles.concat(listRubyFiles(path.resolve(r)))
  const corpusTotal = allFiles.length

  // `module X` sites across the WHOLE corpus — the §29 lesson, applied up front
  // rather than rediscovered: a mixin defined in an unsampled file must not be
  // scored as "the project does not define it".
  const { modules, definedIn, symbolNames } = await corpusIndex(allFiles, parser)

  let files = allFiles
  if (Number.isFinite(LIMIT) && files.length > LIMIT) {
    const stride = files.length / LIMIT
    files = Array.from({ length: LIMIT }, (_, i) => files[Math.floor(i * stride)])
  }

  const classes = new Map<string, number>()
  const top = new Map<string, number>()
  const samples = new Map<string, any[]>()
  const bump = (k: string, name: string, c: any) => {
    classes.set(k, (classes.get(k) ?? 0) + 1)
    top.set(name, (top.get(name) ?? 0) + 1)
    const a = samples.get(k) ?? []; if (a.length < 6) { a.push(c); samples.set(k, a) }
  }

  let emitted = 0, resolved = 0
  for (const f of files) {
    let content: string; try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let tree: any; try { tree = parser.parse(content) } catch { continue }
    let res: any; try { res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f) } catch { continue }
    const rel = path.relative(roots[0], f)
    for (const r of res.relationships ?? []) {
      if (String(r.type ?? "") !== "implements") continue
      emitted++
      const tgt = String(r.target ?? "")
      const leaf = tgt.includes("::") ? tgt.slice(tgt.lastIndexOf("::") + 2) : tgt
      if (symbolNames.has(tgt) || symbolNames.has(leaf) || modules.has(tgt) || modules.has(leaf)) { resolved++; continue }
      const line = r.line_number ?? 0
      const ctx = { file: rel, line, target: tgt, source: String(r.source ?? ""),
        body: content.split("\n")[Math.max(0, line - 1)]?.trim().slice(0, 100) ?? "" }
      // A `module X` for this name ANYWHERE in the corpus means the mixin IS the
      // project's and the analyzer's SYMBOL pass failed to produce it — a defect.
      // No `module X` anywhere means it is a gem's module — a fact.
      if (modules.has(tgt) || modules.has(leaf)) bump("DEFINED in corpus as a module/class, but no symbol — analyzer symbol gap", leaf, ctx)
      else if (/^[A-Z][A-Za-z0-9_]*$/.test(tgt) && tgt.split("::").length > 1) bump("qualified constant, no `module X` in corpus — external gem mixin", tgt, ctx)
      else if (/^[A-Z]/.test(tgt)) bump("bare constant, no `module X` in corpus — external gem mixin", tgt, ctx)
      else bump("non-constant target — the analyzer documents declining these, so investigate", tgt, ctx)
    }
  }

  console.log("=".repeat(94))
  console.log("M60 — WHY DO `implements` NOT RESOLVE?")
  console.log("=".repeat(94))
  console.log(`corpus: ${corpusTotal} .rb files, ${files.length} parsed`)
  console.log(`corpus-wide: ${modules.size} distinct \`module X\`/\`class X\` names, ${symbolNames.size} analyzer symbol names`)
  console.log(`implements emitted ${emitted}   resolved ${resolved} (${emitted ? ((resolved / emitted) * 100).toFixed(1) : "0"}%)\n`)
  for (const [k, n] of [...classes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(5)}  ${emitted ? ((n / emitted) * 100).toFixed(1).padStart(5) : "  0.0"}%  ${k}`)
    for (const s of samples.get(k) ?? []) console.log(`         ${s.file}:${s.line}  ${s.target}   | ${s.body}`)
  }
  const topList = [...top.entries()].sort((a, b) => b[1] - a[1])
  console.log(`\n  ${topList.length} distinct unresolved targets; top 20:`)
  for (const [n, c] of topList.slice(0, 20)) console.log(`    ${String(c).padStart(4)}  ${n}`)

  fs.mkdirSync(path.join(ROOT, "validation", "m60", "results"), { recursive: true })
  fs.writeFileSync(path.join(ROOT, "validation", "m60", "results", "ruby-implements.json"), JSON.stringify({
    at: new Date().toISOString(), corpusTotal, filesParsed: files.length, corpusModules: modules.size, corpusSymbolNames: symbolNames.size,
    emitted, resolved, classes: Object.fromEntries(classes), topTargets: Object.fromEntries(topList), samples: Object.fromEntries(samples),
  }, null, 2))
  console.log("\nevidence: validation/m60/results/ruby-implements.json")
}
main()
