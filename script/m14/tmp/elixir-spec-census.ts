/**
 * EX spec-census — the question F8 (verify-corpus-census.ts) asks, answered
 * here without the hard-coded corpus root and without the analyzer: does
 * script/m14/spec/elixir-completeness.json's classification of the grammar's
 * node types actually cover every node type the pinned grammar EMITS on real
 * Elixir code?
 *
 * A type in the corpus that the spec classifies nowhere is a spec gap (the file
 * claims a closed census); a type the spec classifies that no corpus file emits
 * is a spec claim with no live site. Both directions are printed. Tree-only:
 * no analyzer, no oracle, no regexes.
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const SPEC = path.join(ROOT, "script/m14/spec/elixir-completeness.json")
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const REPOS = (arg("repos") ?? "elixir,phoenix,ecto,ecto_sql,ash,wallaby").split(",")
const LIMIT = Number(arg("per-repo") ?? "120")

function walk(d: string, out: string[] = []): string[] {
  let e: fs.Dirent[]
  try { e = fs.readdirSync(d, { withFileTypes: true }) } catch { return out }
  for (const x of e) {
    if ([".git", "_build", "deps", "node_modules"].includes(x.name)) continue
    const p = path.join(d, x.name)
    if (x.isDirectory()) walk(p, out)
    else if (x.name.endsWith(".ex") || x.name.endsWith(".exs")) out.push(p)
  }
  return out
}

async function main() {
  const spec = JSON.parse(fs.readFileSync(SPEC, "utf8"))
  const handled = new Set<string>(spec.handled_verified.types as string[])
  const silent = new Set<string>(spec.internal_silent.types as string[])
  const classified = new Set([...handled, ...silent])
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
  const p = new P(); p.setLanguage(g)
  const seen = new Map<string, { n: number; ex: string }>()
  let files = 0
  let errFiles = 0
  for (const repo of REPOS) {
    const dir = path.join(CORPUS_ROOT, repo)
    if (!fs.existsSync(dir)) { console.log(`[skip] ${repo} not present`); continue }
    const all = walk(dir).sort()
    const picked = all.slice(0, LIMIT)
    for (const f of picked) {
      const text = fs.readFileSync(f, "utf8")
      const tree = p.parse(text)
      if (tree.rootNode.hasError) errFiles++
      files++
      const stack: any[] = [tree.rootNode]
      while (stack.length) {
        const n = stack.pop()
        const cur = seen.get(n.type)
        if (cur) cur.n++
        else seen.set(n.type, { n: 1, ex: `${repo}/${path.relative(dir, f)}:${n.startPosition.row + 1}` })
        for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) stack.push(c) }
      }
    }
  }
  const unclassified = [...seen.keys()].filter((t) => !classified.has(t)).sort()
  const unobserved = [...classified].filter((t) => !seen.has(t)).sort()
  console.log(JSON.stringify({
    repos: REPOS, filesPerRepo: LIMIT, filesParsed: files, filesWithParseError: errFiles,
    distinctNodeTypesObserved: seen.size,
    specClassified: classified.size,
    observedButUnclassified: unclassified.map((t) => ({ type: t, count: seen.get(t)!.n, ex: seen.get(t)!.ex })),
    classifiedButUnobserved: unobserved,
  }, null, 1))
}
main().catch((e) => { console.error(e); process.exit(1) })
