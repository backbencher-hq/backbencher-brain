/**
 * RUBY LANE — two identity findings that only became visible once `contains`
 * was audited (M60 deep round 4).
 *
 * `contains` was in NO audited label set, so ~30% of the rails payload had no
 * independent derivation. Deriving it (`mirror D` in the staged oracle) turned
 * two long-standing questions from "nobody has looked" into counts:
 *
 *   FINDING 1 — a multi-segment reopen is not leaf-normalised.
 *     `class A::B::C` splits on the FIRST `::`, so the symbol is named `B::C`
 *     with owner `A`. RUBD13 promised that a reopen and the nested spelling are
 *     ONE identity — `module A; module B; class C` gives owner chain A>B, name
 *     `C`. For a 2-segment reopen (`class M::Inner`) first and last coincide, so
 *     the ruling held; for 3+ segments it does not, and the two spellings of the
 *     same class never unify. The file's own `leafName` helper uses lastIndexOf,
 *     so the analyzer contains both rules and the two disagree.
 *
 *   FINDING 2 — a dynamic method name is published as a symbol.
 *     `define_method("#{sym}?")` is accepted by the `define_method` branch
 *     because it takes any `string` argument, so the graph gains a symbol whose
 *     NAME is a template, `#{sym}?`, which resolves to no method in any file.
 *
 * Both are counted over real corpora rather than asserted from a reading.
 *
 * Usage: npx tsx script/m14/tmp/rb-identity-census.ts <corpus-root> [--limit N]
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"

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
  const { RealRubyAnalyzer } = await import(path.join(ROOT, "src", "ast", "real-ruby-analyzer.ts"))
  await Parser.init()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  const parser = new Parser()
  parser.setLanguage(lang as any)

  const limitAt = process.argv.indexOf("--limit")
  const LIMIT = limitAt >= 0 ? parseInt(process.argv[limitAt + 1]) : Infinity
  const roots = process.argv.slice(2).filter((a, i) => !a.startsWith("--") && !(i > 0 && process.argv[i - 1] === "--limit"))
  let files: string[] = []
  for (const r of roots) files = files.concat(listRubyFiles(path.resolve(r)))
  if (Number.isFinite(LIMIT) && files.length > LIMIT) {
    const stride = files.length / LIMIT
    files = Array.from({ length: LIMIT }, (_, i) => files[Math.floor(i * stride)])
  }

  let nonLeaf = 0, nonLeafFiles = 0, dynamicNames = 0, dynamicFiles = 0, symbols = 0
  const exNonLeaf: any[] = []
  const exDynamic: any[] = []
  for (const f of files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let tree: any
    try { tree = parser.parse(content) } catch { continue }
    let res: any
    try { res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f) } catch { continue }
    let a = 0, b = 0
    for (const s of res.symbols ?? []) {
      symbols++
      if ((s.kind === "class" || s.kind === "module") && String(s.name).includes("::")) {
        a++; nonLeaf++
        if (exNonLeaf.length < 8) {
          exNonLeaf.push({ file: path.relative(roots[0], f), name: s.name, owner: s.ownerName, line: s.range?.startLine })
        }
      }
      // A name containing interpolation is a TEMPLATE, not a name.
      if (String(s.name).includes("#{")) {
        b++; dynamicNames++
        if (exDynamic.length < 8) {
          exDynamic.push({ file: path.relative(roots[0], f), name: s.name, owner: s.ownerName, line: s.range?.startLine })
        }
      }
    }
    if (a) nonLeafFiles++
    if (b) dynamicFiles++
  }

  console.log(`corpus: ${roots.join(", ")}   files=${files.length}   symbols=${symbols}`)
  console.log(`FINDING 1  class/module symbol whose NAME is not a leaf ("A::B::C" -> "B::C"): ${nonLeaf} in ${nonLeafFiles} files`)
  console.log(`FINDING 2  symbol whose NAME is an interpolation template: ${dynamicNames} in ${dynamicFiles} files`)
  for (const e of exNonLeaf) console.log(`   non-leaf : ${e.file}:${e.line}  name=${e.name}  owner=${e.owner}`)
  for (const e of exDynamic) console.log(`   template : ${e.file}:${e.line}  name=${e.name}  owner=${e.owner}`)
  fs.writeFileSync(
    path.join(ROOT, "validation", "m60", "results", "ruby-identity-census.json"),
    JSON.stringify({
      generatedAt: new Date().toISOString(), corpus: roots, files: files.length, symbols,
      nonLeafNames: { count: nonLeaf, files: nonLeafFiles, examples: exNonLeaf },
      dynamicTemplateNames: { count: dynamicNames, files: dynamicFiles, examples: exDynamic },
    }, null, 2),
  )
}

main()
