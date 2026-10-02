/**
 * F1 MEASUREMENT — derivePhpContainsEdges vs the analyzer's `contains`, both
 * directions, on the full pinned corpus, BEFORE the allowlist is touched.
 *
 * The differential's per-file match is (label, target), site-agnostic, with
 * duplicates collapsed. This reports the same comparison as two sets so a
 * disagreement is visible in both directions rather than as a count that could
 * be hiding either.
 */
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import * as path from "node:path"
const ROOT = "$HOME/backbencher-brain"
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { derivePhpContainsEdges } = await import(path.join(ROOT, "script/m14/differential.ts"))
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const grammar = await (wts as any).Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm")))
const parser = new P(); parser.setLanguage(grammar)

let files = 0
let truthRows = 0, anRows = 0
const truthOnly: string[] = [], anOnly: string[] = []
let perFileBothZero = 0
for (const repo of ["phpunit", "phpmyadmin"]) {
  const dir = path.join("$HOME/fixtures/repositories", repo)
  for (const f of execSync(`git ls-files -z -- '*.php'`, { cwd: dir, maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean).sort()) {
    let src: string, root: any
    try { src = readFileSync(path.join(dir, f), "utf8"); root = parser.parse(src).rootNode } catch { continue }
    files++
    const truth = new Set(derivePhpContainsEdges(root).map((e: any) => `${e.from}|${e.target}`))
    let res: any
    try { res = await ASTEngine.parseFile(path.join(dir, f), src) } catch { continue }
    const an = new Set<string>((res.relationships ?? []).filter((r: any) => r.type === "contains").map((r: any) => `${r.source}|${r.target}`))
    truthRows += truth.size; anRows += an.size
    if (!truth.size && !an.size) perFileBothZero++
    for (const k of truth) if (!an.has(k) && truthOnly.length < 60) truthOnly.push(`${repo}/${f}  TRUTH-ONLY  ${k}`)
    for (const k of an) if (!truth.has(k) && anOnly.length < 60) anOnly.push(`${repo}/${f}  ANALYZER-ONLY  ${k}`)
  }
}
console.log(`files=${files}  files with no contains on either side=${perFileBothZero}`)
console.log(`truth rows (distinct owner|member per file) = ${truthRows}`)
console.log(`analyzer contains edges                    = ${anRows}`)
console.log(`\nTRUTH-ONLY (would read MISSING)   : ${truthOnly.length}${truthOnly.length >= 60 ? "+" : ""}`)
for (const s of truthOnly) console.log("   " + s)
console.log(`\nANALYZER-ONLY (would read UNEXPLAINED) : ${anOnly.length}${anOnly.length >= 60 ? "+" : ""}`)
for (const s of anOnly) console.log("   " + s)
process.exit(0)
