/**
 * A ONE-FILE ORACLE DIFF — `deriveTomlEdges` against production `parseFile`,
 * for the two corpus files the toml lane's own differential corpus never drew.
 *
 * ## Why this exists
 *
 * `script/m14/differential.ts` routes toml at `cargo` (primary) and `ripgrep`
 * (second). The 1,140-file census found two containment defects, and BOTH live
 * outside those two repositories:
 *
 *   - `pb-grpc/pyproject.toml` publishes the symbol name `tool.setuptools.package-dir.`
 *     — a TRAILING DOT, from `[tool.setuptools.package-dir]` followed by `"" = "…"`.
 *   - `ansible/pyproject.toml` declares `[tool.setuptools.dynamic]` on line 45 and
 *     `[tool.setuptools]` on line 49, so the first is filed under the MODULE.
 *
 * The lane's own header states the reason a differential cannot catch this class:
 * the analyzer and the oracle are two walkers over one grammar, so a type absent
 * from BOTH agrees with itself perfectly. Here the divergence is narrower and
 * more embarrassing — the oracle is RIGHT and the analyzer is wrong, and the
 * differential never saw the file. So the evidence is produced here, on the two
 * files, with both sides run for real.
 *
 * Usage: npx tsx validation/m14/fixtures/toml/oracle-diff.ts [file ...]
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { deriveTomlEdges } from "../../../../script/m14/differential"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const DEFAULTS = ["pb-grpc/pyproject.toml", "ansible/pyproject.toml"]
const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULTS

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-toml.wasm"))))

let totalTruth = 0
let totalCovered = 0
let totalMissing = 0
let totalUnexplained = 0

for (const rel of targets) {
  const abs = path.join(CR, rel)
  const dir = path.dirname(abs)
  const text = readFileSync(abs, "utf8")
  const tree = parser.parse(text)
  if (!tree) {
    console.log(`${rel}: no tree`)
    continue
  }
  const moduleName = (rel.split("/").pop() ?? "document").replace(/\.[^.]+$/, "") || "document"
  const truth = deriveTomlEdges(tree.rootNode, moduleName)
  const r: any = await parseFile(abs, dir)
  // The same filter the toml lane is comparable under: `contains` and nothing
  // else, because `deriveTomlEdges` derives `contains` and nothing else.
  const actual = (r.relationships ?? []).filter((x: any) => String(x.type) === "contains").map((x: any) => `contains|${x.source}|${x.target}`)
  // THE FILE-SCOPED IDENTITY IS APPLIED TO THE TRUTH SIDE, not read off the analyzer. The
  // analyzer now spells every endpoint `<module>.<document path>` (see the header note in
  // src/ast/real-toml-analyzer.ts): a document-relative target names N declarations as soon
  // as a project holds two manifests with the same shape, and the resolver binds only an
  // exact qualified-name match. `parseFile` here is handed NO project root, so the scope is
  // empty and the module is the stem — which is exactly what this prefix encodes. The tree
  // WALK below is still the oracle's own, so agreement remains evidence about the document.
  const q = (n: string): string => (n === moduleName ? moduleName : `${moduleName}.${n}`)
  const actualSet = new Set(actual)
  const truthSet = new Set(truth.map((e) => `${e.label}|${q(e.from)}|${q(e.target)}`))
  const missing = [...truthSet].filter((k) => !actualSet.has(k))
  const unexplained = [...actualSet].filter((k) => !truthSet.has(k))
  totalTruth += truthSet.size
  totalCovered += truthSet.size - missing.length
  totalMissing += missing.length
  totalUnexplained += unexplained.length

  console.log("")
  console.log(`${rel}`)
  console.log(`  truth ${truthSet.size}   analyzer ${actualSet.size}   MISSING ${missing.length}   unexplained ${unexplained.length}`)
  for (const m of missing) console.log(`    MISSING     ${m}`)
  for (const u of unexplained) console.log(`    unexplained ${u}`)
  const syms = (r.symbols ?? []).map((s: any) => s.name).filter((n: string) => n.endsWith(".") || n.startsWith(".") || n.includes(".."))
  if (syms.length > 0) console.log(`  symbols with an empty path segment: ${syms.map((s: string) => JSON.stringify(s)).join(", ")}`)
  tree.delete?.()
}

console.log("")
console.log(`TOTAL truth ${totalTruth}  covered ${totalCovered}  MISSING ${totalMissing}  unexplained ${totalUnexplained}`)
process.exitCode = totalMissing + totalUnexplained === 0 ? 0 : 1