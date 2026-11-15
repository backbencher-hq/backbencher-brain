/**
 * CSS IMPORTS COUNT — DECOMPOSED INTO ANALYZER AND FILTER, so a moved count is attributed
 * rather than bisected blind.
 *
 * WHY. The gate read `imports` 178 edges / 51 ambiguous at 00:52 and 127 edges / 1 ambiguous at
 * 01:0x — the EDGE COUNT moved, which is not a reclassification: edges stopped surviving. Three
 * candidate mechanisms were named (a population/extension change, this lane's guard retirement,
 * and the fleet-wide move of the worker's length budget from the target to its LEAF), and a
 * `git bisect` would settle it only by checking out revisions in a SHARED checkout, which is not
 * something one lane may do to twenty others' tree.
 *
 * So this measures the two halves directly, in one pass and without moving the tree:
 *
 *   ANALYZER half   the analyzer's own `imports` edges, before any filter
 *   FILTER half     the same edges after `filterNoiseRelationships` — the worker's own function,
 *                   imported rather than re-implemented, with the file's published names
 *
 * If the analyzer half is unchanged and the filter half is smaller, the move is a FILTER fact
 * (and the dropped targets name which rule did it); if both halves moved, it is the analyzer or
 * the file set. Either answer is a fact about the fleet's instruments rather than about css, and
 * that is why it is worth one run.
 *
 * Usage: npx tsx validation/m14/fixtures/css/imports-count-decomposition.ts
 */
import { readFileSync, statSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { getParser } from "../../../../src/ast/engine"
import { filterNoiseRelationships } from "../../../../src/ast/pool-worker"
import { RealCssAnalyzer } from "../../../../src/ast/real-css-analyzer"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")

// THE LANE'S DECLARED POPULATION IS `css,less`, not `.css`. `d43a5fa4d` (the population gate)
// found css measuring a fraction of its own language — the router maps `.less` to css — and set
// the lane to BOTH extensions in `incoming-gate.ts` and `residual-gate.ts`. This instrument
// walked `.css` only until 2026-10-10, which is why it read `imports` 127 where the gate reads
// 178: a POPULATION difference, not a parse difference. Override with BB_CSS_EXTS.
const LANE_EXTS = (process.env.BB_CSS_EXTS ?? "css,less").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

function admitted(): string[] {
  const out: string[] = []
  for (const e of readdirSync(CR).sort()) {
    const dir = path.join(CR, e)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean) } catch { continue }
    for (const rel of tracked) {
      if (!LANE_EXTS.some((x) => rel.toLowerCase().endsWith("." + x))) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue }
      out.push(abs)
    }
  }
  return out.sort()
}

const files = admitted()
const parser = await getParser("css")
const analyzer = new RealCssAnalyzer()
let preFilter = 0, postFilter = 0
const dropped: { target: string; shape: string }[] = []
const shapeOf = (t: string): string =>
  t.includes("://") ? "url" : t.startsWith("@") ? "npm/at" : t.includes("/") ? "path" : t.includes(".") ? "extension-name" : "bare"
const shapes: Record<string, number> = {}
for (const f of files) {
  const content = readFileSync(f, "utf8")
  const res: any = analyzer.analyze(parser.parse(content).rootNode, content, f)
  const rels = (res.relationships ?? []).filter((r: any) => String(r.relationshipType ?? r.type) === "imports")
  preFilter += rels.length
  const declared = new Set((res.symbols ?? []).map((s: any) => String(s.name)))
  const kept = filterNoiseRelationships(rels, "css", declared)
  postFilter += kept.length
  const keptKeys = new Set(kept.map((r: any) => String(r.target)))
  for (const r of rels) {
    const t = String(r.target ?? "")
    if (keptKeys.has(t)) { shapes[shapeOf(t)] = (shapes[shapeOf(t)] ?? 0) + 1; continue }
    if (dropped.length < 12) dropped.push({ target: t, shape: shapeOf(t) })
  }
}
console.log("css imports count — analyzer half vs filter half, whole admitted population")
console.log(`files ${files.length}`)
console.log(`  ANALYZER  ${preFilter} imports edges (before any filter)`)
console.log(`  FILTER    ${postFilter} survive filterNoiseRelationships (dropped ${preFilter - postFilter})`)
console.log(`  shapes among survivors: ${Object.entries(shapes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")}`)
if (dropped.length) {
  console.log(`  dropped samples (${preFilter - postFilter} total):`)
  for (const d of dropped) console.log(`    ${d.shape.padEnd(15)} ${d.target.slice(0, 90)}`)
}
console.log(`\nREADING: ${preFilter === postFilter ? `${preFilter} edges reach the gate — the filter drops none, so a moved count is the ANALYZER or the FILE SET` : `the filter removes ${preFilter - postFilter}, so a moved count can be a FILTER fact`}`)
