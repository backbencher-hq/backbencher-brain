/**
 * RUBY LANE — classify every MISSING `contains` edge by its TREE SHAPE. (M60)
 *
 * 374 MISSING `contains` remain and §37 attributed them to four named causes by
 * reading individual files, which is how the endless-def bug survived four rounds
 * of reading. This enumerates them instead: for each truth `contains` target the
 * analyzer does not publish, it locates the DECLARATION SITE in the tree and
 * reports the node type and its parent chain, so the distribution is a
 * measurement rather than an anecdote.
 *
 * The shapes it is looking for, and why each is a candidate for being wrong:
 *
 *   operator           `def <<(o)` — a `name` field of `operator` type
 *   singleton class    `class << self` — members of an unnamed singleton
 *   anonymous new      `X.new { }` / `Module.new { }` — a scope with no name
 *   named factory      `K = Class.new(Base) do` — named by the ASSIGNMENT
 *   block local        a member declared inside a block, not a class body
 *   writer             `output_buffer=` — a `name` ending in `=`
 *   attr               an `attr_*` argument
 *   reopen             a second `class Foo` in the same file
 *
 * Usage: npx tsx script/m14/tmp/rb-contains-missing.ts <corpus-root>... [--limit=N]
 */
import * as fs from "fs"
import * as path from "path"
import { Parser, Language } from "web-tree-sitter"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"
import { deriveRubyEdges } from "../../../script/m14/differential"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..")
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)

function listRubyFiles(root: string): string[] {
  const out: string[] = []
  const skip = new Set([".git", "node_modules", "vendor", "tmp", "log"])
  const walk = (d: string) => {
    let e: fs.Dirent[]
    try { e = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const x of e) {
      if (x.name.startsWith(".")) continue
      const p = path.join(d, x.name)
      if (x.isDirectory()) { if (!skip.has(x.name)) walk(p) }
      else if (x.name.endsWith(".rb")) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

/** Walk the tree and record, for every identifier/constant/symbol leaf, the node
 *  TYPE and the chain of ancestor types — enough to classify a declaration. */
function declarationSites(root: any) {
  const sites = new Map<string, Array<{ nodeType: string; chain: string[]; line: number }>>()
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()!
    const isNameLeaf = n.type === "identifier" || n.type === "constant" ||
      n.type === "simple_symbol" || n.type === "symbol"
    if (isNameLeaf) {
      const name = n.type === "simple_symbol" || n.type === "symbol"
        ? n.text.replace(/^:/, "") : n.text
      const chain: string[] = []
      let p = n.parent
      for (let d = 0; p && d < 6; d++) { chain.push(p.type); p = p.parent }
      const arr = sites.get(name) ?? []
      arr.push({ nodeType: n.type, chain, line: n.startPosition.row + 1 })
      sites.set(name, arr)
    }
    for (const c of n.children ?? []) st.push(c)
  }
  return sites
}

/** The classification, in priority order. Each rule is a STATEMENT about a shape,
 *  and the order matters only where two could both match. */
function classify(site: { nodeType: string; chain: string[] }): string {
  const c = site.chain
  const inMethod = c[0] === "method" || c[0] === "singleton_method"
  const inSingletonClass = c.includes("singleton_class")
  const inBlock = c.some((t) => t === "block" || t === "block_body")
  const inNewBlock = c.includes("call") && inBlock
  const inNamedFactory = inNewBlock && c[0] !== "method"
  if (site.nodeType === "operator") return "operator name (`def <<(o)`)"
  if (inMethod && inBlock) return "member inside a block within a method"
  if (inSingletonClass) return "member of `class << self` (unnamed singleton)"
  if (inNamedFactory) return "member of a `X.new { }` block"
  if (inBlock && !inMethod) return "member of a plain block (no enclosing method)"
  if (c[0] === "assignment") return "constant assigned at this scope"
  if (inMethod) return "plain method member"
  if (c.includes("class") || c.includes("module")) return "class/module name"
  return `other: ${c.slice(0, 3).join(">")}`
}

async function main() {
  await Parser.init()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  const parser = new Parser()
  parser.setLanguage(lang as any)

  let files = listRubyFiles(arg("corpus") ?? "/home/sano/ishaq/bb_tests/repositories")
  const LIMIT = Number(arg("limit") ?? 1500)
  if (files.length > LIMIT) {
    const stride = files.length / LIMIT
    files = Array.from({ length: LIMIT }, (_, i) => files[Math.floor(i * stride)])
  }

  const classes = new Map<string, number>()
  const examples = new Map<string, string[]>()
  let missing = 0, total = 0

  for (const f of files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let tree: any
    try { tree = parser.parse(content) } catch { continue }
    let res: any, truth: any[]
    try {
      res = new RealRubyAnalyzer().analyze(tree.rootNode, content, f)
      truth = deriveRubyEdges(tree.rootNode)
    } catch { continue }

    const published = new Set((res.relationships ?? [])
      .filter((r: any) => String(r.type) === "contains").map((r: any) => String(r.target)))
    const truthTargets = new Set(truth.filter((e: any) => e.label === "contains").map((e: any) => e.target))
    total += truthTargets.size
    const sites = declarationSites(tree.rootNode)

    for (const t of truthTargets) {
      if (published.has(t)) continue
      missing++
      const cand = sites.get(t)
      const shape = cand && cand.length ? classify(cand[0]) : "NOT FOUND as any name leaf in the tree"
      classes.set(shape, (classes.get(shape) ?? 0) + 1)
      const arr = examples.get(shape) ?? []
      if (arr.length < 3) {
        const line = cand?.[0]?.line ?? 0
        const body = content.split("\n")[Math.max(0, line - 1)]?.trim().slice(0, 90) ?? ""
        arr.push(`${path.relative(arg("corpus") ?? "/home/sano/ishaq/bb_tests/repositories", f)}:${line} -> ${t}\n         | ${body}`)
      }
      examples.set(shape, arr)
    }
  }

  console.log("=".repeat(94))
  console.log("M60 — MISSING `contains`, CLASSIFIED BY TREE SHAPE")
  console.log("=".repeat(94))
  console.log(`${files.length} files, ${total} truth contains targets, ${missing} not published by the analyzer\n`)
  for (const [shape, n] of [...classes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(5)}  ${((n / missing) * 100).toFixed(1).padStart(5)}%  ${shape}`)
    for (const e of examples.get(shape) ?? []) console.log(`        ${e}`)
  }

  fs.mkdirSync(path.join(ROOT, "validation", "m60", "results"), { recursive: true })
  fs.writeFileSync(path.join(ROOT, "validation", "m60", "results", "ruby-contains-missing.json"), JSON.stringify({
    at: new Date().toISOString(), filesParsed: files.length, truthContainsTargets: total, missing,
    classes: Object.fromEntries(classes), examples: Object.fromEntries(examples),
  }, null, 2))
  console.log("\nevidence: validation/m60/results/ruby-contains-missing.json")
}

main()