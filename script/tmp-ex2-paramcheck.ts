// tmp-ex2-paramcheck.ts — U4 corpus metric: for every parameterized type
// declaration (`@type name(p) :: …`, the LHS is a call node), does a Type
// symbol with that name exist? And does any Type symbol carry a PARAMETER
// name (the fabrication class)? Run before + after the fix.
// Usage: bun run script/tmp-ex2-paramcheck.ts <before|after>
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const MODE = process.argv[2] ?? "run"
const REPOS: Record<string, string> = {
  elixir: "$HOME/fixtures/repositories/elixir",
  phoenix: "$HOME/fixtures/repositories/phoenix",
}
const CAP = 250

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
const parser = new ParserClass()
parser.setLanguage(g)
const mod: any = await import("../src/ast/real-elixir-analyzer")
const analyzer = new mod.RealElixirAnalyzer()

function findChild(n: any, pred: (c: any) => boolean): any {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && pred(c)) return c
  }
  return null
}
function collectParamDecls(root: any): { name: string; params: string[] }[] {
  const out: { name: string; params: string[] }[] = []
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "unary_operator" && n.child(0)?.text === "@" && n.child(1)?.type === "call") {
      const id = findChild(n.child(1), (c: any) => c.type === "identifier")
      if (id && (id.text === "type" || id.text === "typep" || id.text === "opaque")) {
        const args = findChild(n.child(1), (c: any) => c.type === "arguments")
        const binOp = args ? findChild(args, (c: any) => c.type === "binary_operator") : null
        const lhs = binOp ? binOp.child(0) : null
        if (lhs?.type === "call") {
          const nameNode = findChild(lhs, (c: any) => c.type === "identifier")
          const params: string[] = []
          const pargs = findChild(lhs, (c: any) => c.type === "arguments")
          if (pargs) {
            for (let i = 0; i < pargs.namedChildCount; i++) {
              const p = pargs.namedChild(i)
              if (p?.type === "identifier") params.push(p.text)
            }
          }
          if (nameNode) out.push({ name: nameNode.text, params })
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return out
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    const fp = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "_build" || e.name === "deps") continue
      walk(fp, acc)
    } else if (e.name.endsWith(".ex") || e.name.endsWith(".exs")) acc.push(fp)
  }
  return acc
}

const out: any = { mode: MODE, at: new Date().toISOString(), repos: {} }
for (const [name, repo] of Object.entries(REPOS)) {
  const files = walk(repo).sort().slice(0, CAP)
  let paramDecls = 0, covered = 0, phantoms = 0
  const missingSamples: string[] = [], phantomSamples: string[] = []
  for (const f of files) {
    let res: any, tree: any
    try {
      const src = fs.readFileSync(f, "utf8")
      tree = parser.parse(src)
      res = analyzer.analyze(tree.rootNode, src, f)
    } catch { continue }
    const rel = f.replace(/^.*repositories\//, "")
    const decls = collectParamDecls(tree.rootNode)
    const typeNames: string[] = res.symbols.filter((s: any) => s.kind === "type").map((s: any) => s.name)
    for (const d of decls) {
      paramDecls++
      if (typeNames.includes(d.name)) covered++
      else if (missingSamples.length < 8) missingSamples.push(`${rel}: @type ${d.name}(${d.params.join(",")}) — no symbol`)
    }
    const paramSet = new Set<string>()
    for (const d of decls) for (const p of d.params) paramSet.add(p)
    for (const t of typeNames) {
      const isDeclName = decls.some((d) => d.name === t)
      if (paramSet.has(t) && !isDeclName) {
        phantoms++
        if (phantomSamples.length < 8) phantomSamples.push(`${rel}: type ${t} (fabricated from ?? parameter position)`)
      }
    }
  }
  out.repos[name] = { files: files.length, paramDecls, covered, missing: paramDecls - covered, missingSamples, phantoms, phantomSamples }
}
const dest = path.join("/tmp/bb-ex2", `paramcheck-${MODE}.json`)
fs.writeFileSync(dest, JSON.stringify(out, null, 1))
console.log(JSON.stringify(out, null, 1))
console.log(`\n(written to ${dest})`)
process.exit(0)
