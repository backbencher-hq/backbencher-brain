// Do DISTINCT scala declarations ever collapse onto one symbol name within a file?
//
// The anonymous-class collision was found by asking about anonymous names alone. The
// general question is wider: the graph is keyed by name, so ANY two declarations the
// analyzer publishes under the same name in one file are ONE node. That is sometimes
// correct — a `def f` and its overloads, a case class and its companion — and
// sometimes a merge of two real things. This measures every duplicate and separates
// the families, because "some duplicates are correct" is not an answer.
//
// It also checks the shadowing case specifically: a local `val x` inside a method and
// a field `x` on the class are two different declarations, and publishing both as `x`
// attributes the local's references to the field.
import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS_ROOT = "<corpus-root>/bb_tests/repositories"
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".scala")) out.push(p)
  }
  return out
}
async function main(): Promise<void> {
  const repo = process.argv[2] ?? "scala3"
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P(); parser.setLanguage(gl)
  const analyzer = new RealScalaAnalyzer()
  const files = walk(path.join(CORPUS_ROOT, repo))
  let filesWithDup = 0, dupNames = 0, dupSymbols = 0
  // classify each duplicate by the pair of (kind, owner) signatures
  const families = new Map<string, number>()
  const ex: string[] = []
  const indistEx: string[] = []
  let indistinct = 0
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    let res: any
    try { res = analyzer.analyze(parser.parse(src).rootNode, src, f) } catch { continue }
    const by = new Map<string, any[]>()
    for (const s of res.symbols ?? []) {
      const k = String(s.name ?? "")
      if (!k) continue
      if (!by.has(k)) by.set(k, [])
      by.get(k)!.push(s)
    }
    let any = false
    for (const [k, v] of by) {
      if (v.length < 2) continue
      any = true
      dupNames++
      dupSymbols += v.length
      // family: same kind+owner (a true merge of two declarations) vs different
      const sigs = new Set(v.map((x) => `${x.kind}|${x.ownerName ?? "-"}`))
      // Same owner and kind is only a MERGE if the declarations are also
      // indistinguishable. Scala allows a method to be OVERLOADED, and the analyzer
      // carries the parameter signature in metadata precisely so those stay
      // separable, so two same-named methods with DIFFERENT signatures are one
      // overloaded method and not a lost declaration. Two with the SAME signature
      // are two declarations the graph cannot tell apart.
      if (sigs.size === 1) {
        const params = new Set(v.map((x) => JSON.stringify(x.parameters ?? x.metadata?.params ?? x.signature ?? null)))
        if (params.size > 1) { families.set("SAME owner+kind, DIFFERENT signature — an OVERLOAD, correctly one method", (families.get("SAME owner+kind, DIFFERENT signature — an OVERLOAD, correctly one method") ?? 0) + 1); continue }
        families.set("**SAME owner+kind AND signature — INDISTINGUISHABLE, a true merge**", (families.get("**SAME owner+kind AND signature — INDISTINGUISHABLE, a true merge**") ?? 0) + 1)
        if (indistEx.length < 14) indistEx.push(`${path.relative(path.join(CORPUS_ROOT, repo), f)}  ${k}  lines ${v.map((x) => x.range?.startLine).join(",")}  kind=${v[0].kind} owner=${v[0].ownerName ?? "-"}`)
        indistinct++
        continue
      }
      const fam = `different owner/kind — ${[...sigs].slice(0,3).join(" + ")}`
      const key = fam
      families.set(key, (families.get(key) ?? 0) + 1)

    }
    if (any) filesWithDup++
  }
  console.log(`# scala duplicate symbol names — ${repo}\n`)
  console.log(`- files: ${files.length}`)
  console.log(`- files with a duplicate name: ${filesWithDup}`)
  console.log(`- duplicate names: ${dupNames}  (symbols involved: ${dupSymbols})`)
  console.log(`\n## families`)
  for (const [k, v] of [...families].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`)
  console.log(`\n- **INDISTINGUISHABLE same-owner+kind+signature duplicates: ${indistinct}**`)
  if (indistEx.length) { console.log(`\n## indistinguishable duplicates — examples`); for (const e of indistEx) console.log(`  ${e}`) }
}
main().catch((e) => { console.error(e); process.exit(1) })
