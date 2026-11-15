// FS006 — WHOLE-FILE ERROR COLLAPSE: how many real F# files lose their top-level
// structure to ONE grammar gap, and what the analyzer consequently loses with it.
//
// WHY THIS IS ITS OWN INSTRUMENT
// The lane already knows (reviews/m60-fsharp-grammar-0312-refused.md) that its grammar
// misses `not null` / `and`-joined constraints. What was never measured is the BLAST
// RADIUS: tree-sitter does not fail gracefully there, it collapses the file into a
// root-level ERROR node. Everything the analyzer derives from the FILE-LEVEL structure —
// the `namespace` scope — is then gone, while every symbol inside still parses. So the
// file reports symbols with no owner, `contains` edges sourced from `Global`, and a
// differential that sees "both sides equally wrong".
//
// WHAT IT MEASURES, per file
//   collapse     : root is ERROR (or the root's only child is one ERROR covering >=99%
//                 of the file's byte range) — the file lost its structure.
//   lostScope    : the file declares a `namespace` (its own text, or a namespace node
//                 that survives somewhere) but ZERO symbols carry an owner — the
//                 structural consequence, measured on the ANALYZER's output.
//   unowned      : count of member-kind symbols with no ownerName.
//   firstError   : the SMALLEST ERROR/MISSING node's line and text — a recovery point,
//                 and the rank key for triage (a 1900-line ERROR with a 1-token inner
//                 error is ONE bad token, not 1900 lines of damage).
//
// Run:
//   bun script/m14/tmp/fs006-collapse-census.ts --all --limit 400
//   bun script/m14/tmp/fs006-collapse-census.ts --all --limit 400 --json out.json --explain
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
const LIMIT = parseInt(argOf("--limit") ?? "400")
const EXT = (argOf("--ext") ?? "fs,fsi,fsx").split(",")
const ALL = process.argv.includes("--all")
const EXPLAIN = process.argv.includes("--explain")
const REPOS = ALL ? fs.readdirSync(CORPUS_ROOT).filter((d) => { try { return fs.statSync(path.join(CORPUS_ROOT, d)).isDirectory() } catch { return false } }) : [argOf("--repo") ?? "fsharp"]

function walk(dir: string, exts: string[], out: string[], cap: number): string[] {
  if (out.length >= cap) return out
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return out }
  for (const n of names) {
    if (out.length >= cap) return out
    if (n === ".git" || n === "node_modules" || n === "bin" || n === "obj") continue
    const p = path.join(dir, n)
    let st: fs.Stats
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, exts, out, cap)
    else if (exts.includes(path.extname(n).slice(1).toLowerCase())) out.push(p)
  }
  return out
}

const NS_RE = /^\s*namespace\s+([A-Za-z_][\w.]*)/m

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm")))
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  const rows: any[] = []
  const perRepo: Record<string, any> = {}
  let files = 0, collapsed = 0, lostScope = 0, unownedTotal = 0
  const shapeRank = new Map<string, number>()

  for (const repo of REPOS) {
    const repoDir = path.join(CORPUS_ROOT, repo)
    const list = walk(repoDir, EXT, [], LIMIT)
    let rFiles = 0, rCollapsed = 0, rLost = 0
    for (const file of list) {
      if (files >= LIMIT) break
      let src: string
      try { src = fs.readFileSync(file, "utf8") } catch { continue }
      files++; rFiles++
      const rel = path.relative(CORPUS_ROOT, file)
      const parser = new P()
      try { parser.setLanguage(grammar) } catch { continue }
      let tree: any
      try { tree = parser.parse(src) } catch { /* count as collapsed with no tree */ }
      const root = tree?.rootNode
      let isCollapsed = false
      let coverPct = 0
      let firstError: { line: number; col: number; text: string; type: string; span: number } | null = null
      let errNodes = 0
      if (root) {
        const st: any[] = [root]
        let smallest: any = null
        while (st.length) {
          const n = st.pop()
          if (n.type === "ERROR" || n.isMissing) {
            errNodes++
            const span = n.endIndex - n.startIndex
            if (n.type === "ERROR" && (!smallest || span < (smallest.endIndex - smallest.startIndex))) smallest = n
            if (!firstError) firstError = { line: n.startPosition.row + 1, col: n.startPosition.column + 1, text: n.text.slice(0, 60).replace(/\n/g, "\\n"), type: n.isMissing ? "MISSING" : "ERROR", span }
          }
          for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
        }
        if (root.type === "ERROR") { isCollapsed = true; coverPct = 100 }
        else if (root.namedChildCount === 1 && root.namedChild(0)?.type === "ERROR") {
          const e = root.namedChild(0)
          const pct = ((e.endIndex - e.startIndex) / Math.max(1, src.length)) * 100
          if (pct >= 99) { isCollapsed = true; coverPct = pct }
        }
      }
      // the analyzer's structural consequence
      let res: any = null
      try { res = await ASTEngine.parseFile(file, src) } catch { /* recorded by fs002 */ }
      const MEMBER = new Set(["method", "property", "field", "enum_member", "constructor", "accessor"])
      const unowned = (res?.symbols ?? []).filter((s: any) => MEMBER.has(String(s.kind)) && !s.ownerName && !s.owner).length
      const hasNsText = NS_RE.test(src)
      const nsSymbol = (res?.symbols ?? []).some((s: any) => String(s.kind) === "namespace")
      const lost = isCollapsed && hasNsText && !nsSymbol
      if (isCollapsed) { collapsed++; rCollapsed++ }
      if (lost) { lostScope++; rLost++ }
      unownedTotal += unowned
      if (firstError) {
        const key = firstError.text.replace(/\s+/g, " ").trim().slice(0, 40)
        shapeRank.set(key, (shapeRank.get(key) ?? 0) + 1)
      }
      rows.push({ repo, file: rel, collapsed, isCollapsed, coverPct, lostScope: lost, unowned, symbols: (res?.symbols ?? []).length, hasNsText, nsSymbol, errNodes, firstError })
      parser.delete()
    }
    perRepo[repo] = { files: rFiles, collapsed: rCollapsed, lostScope: rLost }
  }

  const out = { at: new Date().toISOString(), repos: REPOS, limit: LIMIT, ext: EXT, files, collapsed, lostScope, unownedTotal, perRepo, rows, firstErrorShapes: [...shapeRank.entries()].sort((a, b) => b[1] - a[1]) }
  const jp = argOf("--json")
  if (jp) { fs.mkdirSync(path.dirname(jp), { recursive: true }); fs.writeFileSync(jp, JSON.stringify(out, null, 1)) }

  console.log(`files ${files}  collapsed ${collapsed} (${((collapsed / Math.max(1, files)) * 100).toFixed(1)}%)  namespace-lost ${lostScope}  unowned members ${unownedTotal}`)
  console.log(`\n== per repo ==`)
  for (const [k, v] of Object.entries(perRepo)) console.log(`  ${k.padEnd(14)} files ${String(v.files).padStart(4)}  collapsed ${String(v.collapsed).padStart(4)}  ns-lost ${String(v.lostScope).padStart(4)}`)
  console.log(`\n== first-error shapes (recovery points), top 30 ==`)
  for (const [k, v] of [...shapeRank.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`  ${String(v).padStart(4)}  ${JSON.stringify(k)}`)
  if (EXPLAIN) {
    console.log(`\n== collapsed files, ranked by unowned members ==`)
    for (const r of rows.filter((x) => x.isCollapsed).sort((a, b) => b.unowned - a.unowned).slice(0, 40)) {
      console.log(`  ${String(r.unowned).padStart(4)} unowned  ${r.file}  cover=${r.coverPct.toFixed(0)}%  errNodes=${r.errNodes}  first=${r.firstError ? `${r.firstError.line}:${r.firstError.col} ${JSON.stringify(r.firstError.text)}` : "-"}`)
    }
  }
}
void main()
