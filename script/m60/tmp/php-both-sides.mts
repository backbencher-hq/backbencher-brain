/**
 * php analyzer vs php oracle on ONE file universe (git ls-files, both corpora),
 * per label, with the analyzer's line coverage.
 *
 * The comparison the differential makes is (label, target) only. This records
 * both sides' row counts per label on the identical file list, so a label that
 * reads "audited" but has 0 rows on one or both sides is visible as such.
 *
 * Run: bun script/m60/tmp/php-both-sides.mts
 */
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import * as path from "node:path"

const ROOT = "$HOME/backbencher-brain"
const CORPORA = ["phpunit", "phpmyadmin"]
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const grammar = await (wts as any).Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm")))
const parser = new P(); parser.setLanguage(grammar)

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { derivePhpEdges, derivePhpDeclaredTypeEdges } = await import(path.join(ROOT, "script/m14/differential.ts"))

type Cell = { n: number; noLine: number; zero: number }
const A = new Map<string, Cell>(), T = new Map<string, Cell>()
const bump = (m: Map<string, Cell>, k: string, noLine = 0, zero = 0) => {
  let c = m.get(k); if (!c) { c = { n: 0, noLine: 0, zero: 0 }; m.set(k, c) }
  c.n++; c.noLine += noLine; c.zero += zero
}
let files = 0, parseErr = 0
const overridesSamples: string[] = []
const truthOnly: string[] = []

for (const repo of CORPORA) {
  const dir = path.join("$HOME/fixtures/repositories", repo)
  const all = execSync(`git ls-files -z -- '*.php'`, { cwd: dir, maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean).sort()
  for (const f of all) {
    let src: string
    try { src = readFileSync(path.join(dir, f), "utf8") } catch { continue }
    let root: any
    try { root = parser.parse(src).rootNode } catch { continue }
    files++
    const edges: any[] = [...derivePhpEdges(root)]
    if (derivePhpDeclaredTypeEdges) edges.push(...(derivePhpDeclaredTypeEdges(root, [] as any) as any[]))
    const truthTargets = new Set<string>()
    for (const e of edges) { bump(T, e.label); truthTargets.add(e.label + "|" + e.target) }
    let res: any
    try { res = await ASTEngine.parseFile(path.join(dir, f), src) } catch { parseErr++; continue }
    if ((res?.errors?.length ?? 0) > 0) parseErr++
    for (const r of res.relationships ?? []) {
      const l = String(r.type ?? "?")
      bump(A, l, (r.line_number === undefined || r.line_number === null) ? 1 : 0, r.line_number === 0 ? 1 : 0)
      if (l === "overrides" && overridesSamples.length < 10) overridesSamples.push(`ANALYZER ${repo}/${f}: ${r.source} -> ${r.target}`)
    }
    // truth rows the analyzer does not carry, per label
    const anTargets = new Set<string>((res.relationships ?? []).map((r: any) => String(r.type) + "|" + r.target))
    for (const k of truthTargets) if (!anTargets.has(k) && truthOnly.length < 40) truthOnly.push(`${repo}/${f}  ${k}`)
  }
}

const labels = [...new Set([...A.keys(), ...T.keys()])].sort()
console.log(`files=${files} parseErrFiles=${parseErr}\n`)
console.log("label".padEnd(14), "analyzer".padStart(9), "noLine".padStart(8), "zero".padStart(6), "truth".padStart(8), "  verdict")
for (const l of labels) {
  const a = A.get(l) ?? { n: 0, noLine: 0, zero: 0 }
  const t = T.get(l) ?? { n: 0, noLine: 0, zero: 0 }
  let verdict = ""
  if (t.n === 0 && a.n > 0) verdict = "ANALYZER-ONLY: no second implementation"
  else if (a.n === 0 && t.n === 0) verdict = "BOTH ZERO: audited against nothing"
  else if (a.n === 0) verdict = "TRUTH-ONLY"
  else if (t.n === 0) verdict = "TRUTH-ONLY (label unaudited)"
  console.log(l.padEnd(14), String(a.n).padStart(9), String(a.noLine).padStart(8), String(a.zero).padStart(6), String(t.n).padStart(8), " ", verdict)
}
console.log("\n=== analyzer overrides samples ===")
console.log(overridesSamples.length ? overridesSamples.map((s) => "  " + s).join("\n") : "  (none — the analyzer emitted 0 overrides edges on this universe)")
console.log("\n=== truth rows the analyzer does not carry (first 40) ===")
console.log(truthOnly.map((s) => "  " + s).join("\n"))
process.exit(0)
