/**
 * probe-angle-filter.ts — how many R relationships does `filterNoiseRelationships` delete?
 *
 * ## The finding
 *
 * `src/ast/pool-worker.ts:652` drops any relationship whose target LEAF matches
 *
 *     /[{}`<>\n\r\t]/
 *
 * The intent is template-literal garbage: a `calls` target of `${var}`. But R's replacement
 * functions for the two indexing operators are NAMED with angle brackets, in base R, and R
 * packages dispatch to them constantly:
 *
 *     `$<-.data.frame`      `[[<-.data.frame`      `$<-.AC`      `[[<-.AC`
 *
 * So the rule deletes real R edges. Measured on the admitted corpus below.
 *
 * ## Why the analyzer is right and the filter is wrong here
 *
 * `real-r-analyzer.ts` emits `$<-.AC -implements-> $<-` correctly: `` `$<-` `` is R's own name for
 * the `$` replacement generic, `name.indexOf(".") > 0` holds for `$<-.AC`, and the dotted-name
 * convention splits at the first dot to give the generic `$<-`. The edge is a parse fact. It is
 * deleted one stage later, on the way to the index, which is why every R measurement taken
 * through `analyze()` sees it and every measurement taken through production `parseFile` does not.
 *
 * This is the same defect class the filter's own comment beside `NOISE_TARGETS` already records
 * for the name `type` ("an edge whose target is a name this file DECLARES is a real node in the
 * graph"), and the same class the bash lane recorded for `${rootfsDir}`. The existing exemption
 * covers `json | yaml | hcl | terraform | graphql`; R is not in it.
 *
 * ## What this probe measures
 *
 * For every admitted file: the analyzer's RAW relationship list, and what
 * `filterNoiseRelationships` (imported from `src/ast/pool-worker.ts`, the real function, not a
 * copy of its rule) returns for that list. The delta is the loss. Names, types and files are
 * printed so the cost is checkable rather than asserted.
 *
 *     npx tsx validation/m14/fixtures/r/probe-angle-filter.ts
 *     BB_R_LIMIT=400 npx tsx validation/m14/fixtures/r/probe-angle-filter.ts
 */

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { filterNoiseRelationships } from "../../../../src/ast/pool-worker"
import { RealRAnalyzer } from "../../../../src/ast/real-r-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.env.BB_R_LIMIT ?? 0)
const WORKERS = 4
const MAX_SHOW = 25

interface Admitted { repo: string; abs: string; text: string }
const admitted: Admitted[] = []
const reposWithR: Record<string, number> = {}
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "r") continue
    admitted.push({ repo: e, abs, text })
    reposWithR[e] = (reposWithR[e] ?? 0) + 1
  }
}
const covered = LIMIT > 0 ? admitted.slice(0, LIMIT) : admitted

console.log("R angle-bracket filter probe — filterNoiseRelationships(src/ast/pool-worker.ts:652) vs the analyzer's raw output")
console.log(`corpus root: ${CR}`)
console.log(`admitted files: ${admitted.length} across ${Object.keys(reposWithR).length} repositories`)
console.log(`files walked: ${covered.length}${LIMIT > 0 ? " (BB_R_LIMIT prefix)" : " (whole population, no sampling)"}\n`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-r.wasm"))))

interface Loss { file: string; type: string; source: string; target: string; conf: number; reason: string }
const losses: Loss[] = []
let rawTotal = 0
let keptTotal = 0
let filesWithLoss = 0
let idx = 0
let parseFailures = 0

/** The rule at pool-worker.ts:652, named so a report can cite it instead of paraphrasing it. */
const ANGLE = /[{}`<>\n\r\t]/
const leafOf = (name: string): string => {
  const noLine = name.replace(/:\d+$/, "")
  const segs = noLine.split(":").filter((s) => s.length > 0)
  const last = segs[segs.length - 1] ?? ""
  const dotParts = last.split(".")
  return dotParts[dotParts.length - 1]
}
/** Which of the filter's rules fired, so the angle rule is separated from the others. */
function whichRule(target: string): string | null {
  if (!target) return null
  if (target.length > 200 || target.includes("\n")) return "length-or-newline"
  const leaf = leafOf(target)
  if (leaf.length > 80 || leaf.length < 1) return "leaf-length"
  if (ANGLE.test(leaf)) return "ANGLE-BRACKET (pool-worker.ts:652)"
  if (leaf.startsWith(" ") || leaf.includes("  ")) return "whitespace"
  return null
}

async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= covered.length) return
    const a = covered[i]
    const lab = `${a.repo}/${path.relative(path.join(CR, a.repo), a.abs)}`
    let tree: any
    try { tree = parser.parse(a.text) } catch { parseFailures++; continue }
    let raw: any
    try {
      raw = new RealRAnalyzer().analyze(tree.rootNode, a.text, a.abs)
    } catch { tree.delete?.(); continue }
    const rels: any[] = raw?.relationships ?? []
    rawTotal += rels.length
    const declared = new Set((raw?.symbols ?? []).map((s: any) => String(s?.name ?? "")).filter(Boolean))
    const kept = filterNoiseRelationships(rels, "r", declared)
    keptTotal += kept.length
    let fileLoss = 0
    for (const r of rels) {
      const target = String(r.target ?? "")
      const rule = whichRule(target)
      if (!rule) continue
      // Only count what the filter actually removed, so a rule that fires on a KEPT edge
      // (the NOISE_TARGETS declaration carve-out) is not counted as a loss.
      if (kept.includes(r)) continue
      fileLoss++
      losses.push({ file: lab, type: String(r.type), source: String(r.source), target, conf: Number(r.confidence), reason: rule })
    }
    if (fileLoss) filesWithLoss++
    tree.delete?.()
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker))

const bar = (s: string) => "=".repeat(126)
console.log(bar())
console.log("RESULT")
console.log(bar())
console.log(`analyzer raw relationships:            ${rawTotal.toLocaleString()}`)
console.log(`after filterNoiseRelationships("r"):   ${keptTotal.toLocaleString()}`)
console.log(`DELETED:                               ${(rawTotal - keptTotal).toLocaleString()}  (${(((rawTotal - keptTotal) / rawTotal) * 100).toFixed(2)}%)`)
console.log(`files contributing at least one loss:  ${filesWithLoss}`)

const byReason = new Map<string, Loss[]>()
for (const l of losses) {
  let m = byReason.get(l.reason)
  if (!m) byReason.set(l.reason, m = [])
  m.push(l)
}
console.log(`\n${bar()}`)
console.log("BY RULE")
console.log(bar())
for (const [reason, ls] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${reason.padEnd(38)} ${String(ls.length).padStart(7)}`)
}

const angle = byReason.get("ANGLE-BRACKET (pool-worker.ts:652)") ?? []
const leafLen = byReason.get("leaf-length") ?? []

console.log(`\n${bar()}`)
console.log(`THE LEAF-LENGTH LOSS — every target whose leaf is EMPTY, so the name resolves to nothing`)
console.log(bar())
const leafLenTargets = new Map<string, number>()
for (const l of leafLen) leafLenTargets.set(l.target, (leafLenTargets.get(l.target) ?? 0) + 1)
for (const [t, n] of [...leafLenTargets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`  ${JSON.stringify(t).padEnd(22)} ${String(n).padStart(6)}`)
}
const leafLenTypes = new Map<string, number>()
for (const l of leafLen) leafLenTypes.set(l.type, (leafLenTypes.get(l.type) ?? 0) + 1)
console.log(`  by type: ${[...leafLenTypes.entries()].map(([t, n]) => `${t} ${n}`).join(" · ")}`)
console.log(`  examples:`)
for (const l of leafLen.slice(0, 8)) console.log(`    ${l.file}: ${l.source} -${l.type}-> ${JSON.stringify(l.target)}  conf=${l.conf}`)

console.log(`\n${bar()}`)
console.log("THE ANGLE-BRACKET LOSS, by relationship type")
console.log(bar())
const byType = new Map<string, number>()
for (const l of angle) byType.set(l.type, (byType.get(l.type) ?? 0) + 1)
for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(16)} ${String(n).padStart(6)}`)
}

console.log(`\n${bar()}`)
console.log("THE ANGLE-BRACKET LOSS, by target name — every one is an R function R itself names")
console.log(bar())
const byTarget = new Map<string, number>()
for (const l of angle) byTarget.set(l.target, (byTarget.get(l.target) ?? 0) + 1)
for (const [t, n] of [...byTarget.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  console.log(`  ${JSON.stringify(t).padEnd(22)} ${String(n).padStart(6)}`)
}

console.log(`\n${bar()}`)
console.log(`EVERY DELETED EDGE (${angle.length} total, up to ${MAX_SHOW} shown)`)
console.log(bar())
for (const l of angle.slice(0, MAX_SHOW)) {
  console.log(`  ${l.file}: ${l.source} -${l.type}-> ${l.target}  conf=${l.conf}`)
}

console.log(`\n${bar()}`)
console.log("LIMITATIONS")
console.log(bar())
console.log(`  This reads the analyzer DIRECTLY, not production parseFile, because production parseFile has`)
console.log(`  already applied the filter — the deleted edges are invisible there by construction. That is the`)
console.log(`  point: a measurement taken through parseFile cannot see this class of loss at all, which is`)
console.log(`  why every other number in this lane's evidence was consistent with the analyzer being right.`)
console.log(`  It compares the analyzer's output against the REAL exported filter, not a copy of its rule,`)
console.log(`  so a change to the filter moves these numbers. It says nothing about whether any`)
console.log(`  SURVIVING edge is correct. src/ast/pool-worker.ts is shared machinery: the finding is`)
console.log(`  reported, not fixed here.`)
console.log(`parse failures: ${parseFailures}`)
