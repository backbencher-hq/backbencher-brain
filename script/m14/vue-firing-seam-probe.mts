/**
 * VUE — THE SFC SEAM IS THE WHOLE DIFFERENCE BETWEEN 1/10 AND 6/10.
 *
 * The question this file answers, and why it needed its own instrument.
 *
 * `script/m14/firing-check-v2.mjs` grades the VUE lane at **1/10** (REVIEW-2026-10-04
 * §3, reproduced: `NFILES=200 bun script/m14/firing-check-v2.mjs VUE` → `1/10`,
 * `imports[] 0`). The lane doc and the previous generation both attributed that to
 * the corpus (`vuejs` holds 11 `.vue` files). Both explanations were asserted; this
 * file measures the third possibility, which nobody tested.
 *
 * THE SEAM. `RealVueAnalyzer.analyze()` reads the SFC skeleton from the
 * tree-sitter-vue tree and delegates every `<script>` block body to the JS/TS
 * analyzer — but only through `context.sfcScriptTrees`, which
 * `ASTEngine.parseFile` BUILDS (`src/ast/engine.ts:1587-1619`: it locates each
 * block with `extractSfcScriptBlocks`, re-parses each body with the js/ts/tsx
 * grammar, and hands the trees over). `analyze()` cannot build them itself: it is
 * synchronous and cannot load a parser.
 *
 * So calling `new RealVueAnalyzer().analyze(root, content, file)` — which is
 * exactly what firing-check-v2.mjs:247 does — runs the analyzer with
 * `context === undefined`, `scriptTreeCount === 0`, and therefore SKIPS THE
 * WHOLE SCRIPT PASS: no imports, no delegated symbols, no delegated calls, no
 * Options-API extraction (it hangs off `defaultObject`, which comes from a script
 * tree), no `extends`, no `overrides`, no `contains` from `ownerName`, no
 * `defineProps`/`defineEmits` contract, no `provide`/`inject`.
 *
 * Everything firing-check-v2 can still see on a `.vue` file is the TEMPLATE pass:
 * `instantiates`, plus template-expression `uses` (which resolve against a member
 * set that is empty without the script pass, so they vanish too).
 *
 * This file runs BOTH shapes over the SAME files with the SAME analyzer instance
 * class and prints both tallies side by side, so the number is attributable
 * rather than argued. No regex: string includes and the tree/node API only.
 *
 * WHAT IT DOES NOT CLAIM. It does not claim the production path is healthy, only
 * that the two paths differ, by how much, and on which labels. The per-type
 * verdicts come from `vue-ontology-census.ts`, which drives `parseFile`.
 *
 * CLI: npx tsx script/m14/vue-firing-seam-probe.mts [--repo vuejs,element-plus] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "path"
import { RealVueAnalyzer } from "../../src/ast/real-vue-analyzer"
import { ASTEngine } from "../../src/ast/engine"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "vuejs") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024

// The population is DERIVED (git ls-files), never a hand-written list: a
// hand-written file list rots silently and keeps reporting a stale N.
const files: Array<{ repo: string; dir: string; rel: string; abs: string; text: string }> = []
for (const e of REPOS) {
  const dir = path.join(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories", e)
  let tracked: string[]
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".vue")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vue") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const commits: Record<string, string> = {}
for (const d of new Set(files.map((f) => f.dir))) {
  try { commits[d] = execFileSync("git", ["-C", d, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { commits[d] = "unknown" }
}
console.log(`vue seam probe — repos ${[...new Set(files.map((f) => f.repo))].join(",")}  .vue admitted ${files.length}`)
console.log(`corpus commits: ${JSON.stringify(commits)}`)

const PROD = [...new Set(Object.values(ASTEngine.RelationshipType))]
const FMT = (t: string) => (t === "brain_import" ? "imports" : t)

type Shape = { relTally: Map<string, number>; imports: number; exports: number; symbols: number; filesWithScript: number }
const shapes: Record<string, Shape> = {
  "A: analyze(root, content, file)  — NO context  (firing-check-v2.mjs:247)": { relTally: new Map(), imports: 0, exports: 0, symbols: 0, filesWithScript: 0 },
  "B: ASTEngine.parseFile(file, content) — WITH the SFC seam": { relTally: new Map(), imports: 0, exports: 0, symbols: 0, filesWithScript: 0 },
}

const tally = (r: any, into: Shape): void => {
  into.symbols += (r?.symbols ?? []).length
  into.imports += (r?.imports ?? []).length
  into.exports += (r?.exports ?? []).length
  if ((r?.imports ?? []).length > 0 || (r?.exports ?? []).length > 0) into.filesWithScript++
  for (const x of r?.relationships ?? []) {
    const t = String(x.type ?? x.relationshipType ?? "")
    if (t.length === 0) continue
    into.relTally.set(t, (into.relTally.get(t) ?? 0) + 1)
  }
}

const tallyA = shapes["A: analyze(root, content, file)  — NO context  (firing-check-v2.mjs:247)"]
const tallyB = shapes["B: ASTEngine.parseFile(file, content) — WITH the SFC seam"]

for (const f of files) {
  // Shape A: getParser -> parse -> analyze, the firing-check-v2 sequence verbatim,
  // including the absence of a context argument.
  try {
    const parser = await ASTEngine.getParser("vue")
    const pr = await parser.parse(f.text)
    if (!pr) continue
    tally(new RealVueAnalyzer().analyze(pr.rootNode, f.text, f.abs), tallyA)
  } catch {}
  // Shape B: the production entry, which builds the seam.
  try { tally(await parseFile(f.abs, f.dir), tallyB) } catch {}
}

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log("\n" + "=".repeat(112))
console.log("PER-TYPE, both shapes, same files, same analyzer, production wasm")
console.log("=".repeat(112))
console.log(`${w("type", 15)}${w("A: no context", 16)}${w("B: parseFile", 16)}${w("B fires?", 12)}verdict`)
console.log("-".repeat(112))
const rows: Array<{ type: string; a: number; b: number; verdict: string }> = []
for (const t of PROD) {
  const key = FMT(t)
  const a = tallyA.relTally.get(key) ?? 0
  const b = tallyB.relTally.get(key) ?? 0
  const verdict = a > 0 ? "fires WITHOUT the seam" : b > 0 ? "fires only WITH the seam" : "fires on neither shape"
  rows.push({ type: key, a, b, verdict })
  console.log(`${w(key, 15)}${w(String(a), 16)}${w(String(b), 16)}${w(b > 0 ? "yes" : "NO", 12)}${verdict}`)
}
console.log("-".repeat(112))
for (const [k, s] of Object.entries(shapes)) {
  const fired = PROD.filter((t) => s.relTally.has(FMT(t)))
  console.log(`${k}`)
  console.log(`   ${fired.length}/10 fired · symbols ${s.symbols} · relationships ${[...s.relTally.values()].reduce((a, b) => a + b, 0)} · imports[] ${s.imports} · exports[] ${s.exports} · files publishing an import/export ${s.filesWithScript}`)
  console.log(`   labels seen: ${[...s.relTally.entries()].sort((x, y) => y[1] - x[1]).map(([t, n]) => `${t}:${n}`).join("  ") || "(none)"}`)
}
const aFired = PROD.filter((t) => tallyA.relTally.has(FMT(t)))
const bFired = PROD.filter((t) => tallyB.relTally.has(FMT(t)))
console.log(`\nA (no context)  ${aFired.length}/10 : ${aFired.join(" ") || "(none)"}`)
console.log(`B (parseFile)   ${bFired.length}/10 : ${bFired.join(" ") || "(none)"}`)
console.log(`labels ONLY the seam can produce: ${bFired.filter((t) => !aFired.includes(t)).join(" ") || "(none)"}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    schemaVersion: 1,
    at: new Date().toISOString(),
    corpus: { repos: [...new Set(files.map((f) => f.repo))], admittedVueFiles: files.length, commits, rule: "sorted git ls-files, .vue only, <=512KB, detectLanguageFromPath==vue" },
    shapeA_noContext: { fired: aFired.map(FMT), tally: Object.fromEntries(tallyA.relTally), symbols: tallyA.symbols, importsChannel: tallyA.imports, exportsChannel: tallyA.exports },
    shapeB_parseFile: { fired: bFired.map(FMT), tally: Object.fromEntries(tallyB.relTally), symbols: tallyB.symbols, importsChannel: tallyB.imports, exportsChannel: tallyB.exports },
    perType: rows,
    note: "shape A reproduces script/m14/firing-check-v2.mjs:247 verbatim; shape B is the production entry. The delta is what the SFC seam (engine.ts:1587-1619) contributes.",
  }, null, 2))
  console.log(`\nevidence: ${OUT}`)
}
