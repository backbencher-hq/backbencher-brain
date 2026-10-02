/**
 * How many rows does php's TRUTH side actually derive, per label?
 *
 * The differential's allowlist says a label is "audited" when the oracle derives
 * it. A label both sides emit ZERO rows of is audited in the same sense as a
 * label nobody wrote: the comparison runs and compares nothing. This measures
 * the oracle's own per-label row count over the full corpus, so "audited" and
 * "audited against something" are different numbers.
 *
 * Run: bun script/m60/tmp/php-oracle-label-census.mts
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

const { derivePhpEdges, derivePhpDeclaredTypeEdges } = await import(path.join(ROOT, "script/m14/differential.ts"))

const counts = new Map<string, number>()
const overrideSamples: string[] = []
const containsTruth = new Map<string, number>()
let files = 0
for (const repo of CORPORA) {
  const dir = path.join("$HOME/fixtures/repositories", repo)
  const all = execSync(`git ls-files -z -- '*.php'`, { cwd: dir, maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean)
  for (const f of all) {
    let root: any
    try { root = parser.parse(readFileSync(path.join(dir, f), "utf8")).rootNode } catch { continue }
    files++
    const edges = [...derivePhpEdges(root)]
    // The declared-type half needs symbols; drive it with an empty symbol list
    // (it only reads the analyzer's class metadata for `parent` resolution).
    for (const e of edges) {
      counts.set(e.label, (counts.get(e.label) ?? 0) + 1)
      if (e.label === "overrides" && overrideSamples.length < 15) overrideSamples.push(`${repo}/${f}: ${e.from} -> ${e.target}`)
    }
    if (derivePhpDeclaredTypeEdges) {
      for (const e of derivePhpDeclaredTypeEdges(root, [] as any)) counts.set(e.label, (counts.get(e.label) ?? 0) + 1)
    }
  }
}
console.log(`files=${files}`)
console.log("\n=== TRUTH-side (derivePhpEdges) rows per label, both corpora ===")
for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${v}`)
console.log("\n=== overrides truth rows (the label the lane emits 0 of) ===")
console.log(`  ${counts.get("overrides") ?? 0} rows`)
for (const s of overrideSamples) console.log(`    ${s}`)
console.log("\n=== contains truth rows ===", counts.get("contains") ?? 0)
process.exit(0)
