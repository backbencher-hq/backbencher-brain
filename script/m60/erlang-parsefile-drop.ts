/**
 * ERLANG — what `parseFile` DELIVERS that `analyze()` does not, over the whole corpus.
 *
 *   bun script/m60/erlang-parsefile-drop.ts [--out path] [--repos otp,elixir]
 *
 * ## Why this probe exists
 *
 * The workstream's EMITTED verdict is defined against the PRODUCTION ENTRY —
 * `src/ast/pool-worker.parseFile` — and `parseFile` is not a pass-through. It runs every
 * relationship through `filterNoiseRelationships` (pool-worker.ts), a shared sanitizer
 * whose job is to delete fabricated targets before they reach the index.
 *
 * That sanitizer is right about what it was written for and wrong about Erlang, because
 * an Erlang **quoted atom is a real function name and may contain anything the language
 * allows**: `'#=@: difficult_case_name_äöå'`, `'\x{aaa}memory'`, `erlang:'>='`,
 * `erlang:'<'`. Three of its rules eat them:
 *
 *   `/[{}`<>\n\r\t]/` on the leaf          — `\x{400}` and `erlang:'>='` carry a brace or
 *                                           an angle bracket inside a legitimate name
 *   `leaf.length > 80`                    — OTP's dialyzer suites have test functions whose
 *                                           names are whole English sentences
 *   `leaf.startsWith(" ")` after the `:` split — `'#=@: difficult_…'` leaves a segment
 *                                           that begins with a space
 *
 * None of these is visible from the analyzer, from the fixtures, or from the oracle: the
 * oracle derives the row, the analyzer emits it, and `parseFile` is silent. This probe
 * therefore runs BOTH paths per file and reports the difference, which is the only place
 * the class is visible at all.
 *
 * ## WHAT IT MEASURES
 *
 * For every admitted file, the analyzer is invoked DIRECTLY on the tree and its
 * relationships are keyed by (label, source, target, line, published identity); the same
 * key set is built from `parseFile`'s output; a key present in the first and absent from
 * the second is a row the production entry does not deliver. `analyzer-direct` is also
 * what the pre-fix note in pool-worker.ts calls "the known-zeros gap" — the m12 corpus
 * measurement read `analyze()` and not `parseFile`, which is why the class survived.
 *
 * Keys include `metadata.callArity ?? metadata.arity`, matching `pushRel`'s own identity,
 * so a same-line multi-arity pair is two rows on both sides and the comparison is fair.
 *
 * ## THE VERDICT
 *
 * A non-zero `deliveredShortfall` is a shared-filter defect and it is NOT fixed here:
 * `src/ast/pool-worker.ts` is master-owned, and widening an exemption for one language in
 * a sanitizer fifteen other languages depend on is the owner's call. What this probe does
 * is make the class a number instead of a story, and it names the exact rows so the fix
 * is a three-line change rather than an investigation.
 *
 * READ-ONLY apart from the artifact it writes.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { RealErlangAnalyzer } from "../../src/ast/real-erlang-analyzer"
import { getParser } from "../m14/run-fixtures"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const argOf = (n: string, d?: string): string | undefined => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d)
const OUT = argOf("out")
const REPOS = (argOf("repos", "otp,elixir")).split(",").map((s) => s.trim()).filter(Boolean)
const ROOT = resolve((import.meta as any).dirname ?? dirname(process.argv[1] ?? "."), "..", "..")

const files: { repo: string; abs: string; rel: string }[] = []
for (const repo of REPOS) {
  const dir = join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked.sort()) {
    if (!rel.endsWith(".erl") && !rel.endsWith(".hrl")) continue
    const abs = join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
      if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "erlang") continue
    } catch { continue }
    files.push({ repo, abs, rel: `${repo}/${rel}` })
  }
}
files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))

/** `pushRel`'s own published identity, so both sides are keyed the same way. */
const keyOf = (r: any): string =>
  `${r.type}|${r.source}|${r.target}|${r.line_number ?? ""}|${(r.metadata as any)?.callArity ?? (r.metadata as any)?.arity ?? ""}`

/** Which rule of the shared sanitizer ate it, named from the rule that fires. Re-derives
 *  the leaf the way `extractLeaf` does, so the attribution is the filter's own logic and
 *  not a guess about it. */
function whichRule(target: string): string {
  const noLine = target.replace(/:\d+$/, "")
  const segments = noLine.split(":").filter((s) => s.length > 0)
  const last = segments[segments.length - 1] ?? ""
  const dotParts = last.split(".")
  const leaf = dotParts[dotParts.length - 1]
  if (target.length > 200 || target.includes("\n")) return "length>200 or newline"
  if (leaf.length > 80) return `leaf.length>80 (${leaf.length})`
  if (leaf.length < 1) return "empty leaf"
  if (/[{}`<>\n\r\t]/.test(leaf)) return "brace/angle-bracket ban"
  if (leaf.startsWith(" ") || leaf.includes("  ")) return "leading or double space"
  return "another rule not enumerated here"
}

const parser = await getParser("erlang")
let emitted = 0
let delivered = 0
let filesWithDrops = 0
const droppedByLabel = new Map<string, number>()
const droppedByRule = new Map<string, number>()
const byLabel = new Map<string, number>()
const examples: { label: string; file: string; target: string; source: string; rule: string }[] = []

for (const f of files) {
  const src = readFileSync(f.abs, "utf8")
  const tree = parser.parse(src)
  if (!tree) continue
  const direct: any = await (new RealErlangAnalyzer() as any).analyze(tree.rootNode, src, f.abs, {})
  const prod: any = await parseFile(f.abs, f.repo)
  const prodKeys = new Set((prod.relationships ?? []).map(keyOf))
  delivered += prodKeys.size
  const seen = new Set<string>()
  let here = 0
  for (const r of direct.relationships ?? []) {
    const k = keyOf(r)
    if (seen.has(k)) continue
    seen.add(k)
    emitted++
    byLabel.set(r.type, (byLabel.get(r.type) ?? 0) + 1)
    if (prodKeys.has(k)) continue
    here++
    const rule = whichRule(String(r.target ?? ""))
    droppedByLabel.set(r.type, (droppedByLabel.get(r.type) ?? 0) + 1)
    droppedByRule.set(rule, (droppedByRule.get(rule) ?? 0) + 1)
    if (examples.length < 30) {
      examples.push({ label: r.type, file: f.rel, target: String(r.target), source: String(r.source), rule })
    }
  }
  if (here) filesWithDrops++
  tree.delete?.()
}

const artifact = {
  at: new Date().toISOString(),
  script: "erlang-parsefile-drop",
  productionEntry: "src/ast/pool-worker.parseFile; the comparison side is RealErlangAnalyzer.analyze on the same tree",
  sharedFilter: "src/ast/pool-worker.ts filterNoiseRelationships",
  corpus: { root: CR, repos: REPOS, files: files.length },
  key: "(type, source, target, line, metadata.callArity ?? metadata.arity) — pushRel's own identity",
  analyzerDirectDistinctEdges: emitted,
  parseFileDeliveredDistinctEdges: delivered,
  deliveredShortfall: emitted - delivered,
  filesWithAtLeastOneDroppedEdge: filesWithDrops,
  emittedByLabel: Object.fromEntries([...byLabel].sort()),
  droppedByLabel: Object.fromEntries([...droppedByLabel].sort()),
  droppedByFilterRule: Object.fromEntries([...droppedByRule].sort()),
  examples,
  verdict:
    emitted - delivered === 0
      ? "parseFile delivers every relationship the analyzer emits"
      : `parseFile drops ${emitted - delivered} of ${emitted} analyzer relationships in ${filesWithDrops} files — the shared sanitizer in src/ast/pool-worker.ts is not erlang-aware for QUOTED ATOMS. Master-owned; reported, not fixed here.`,
}

console.log("=".repeat(96))
console.log("ERLANG — parseFile DELIVERANCE vs the analyzer")
console.log("=".repeat(96))
console.log(`corpus                     : ${files.length} admitted files (${REPOS.join(" + ")})`)
console.log(`analyzer, distinct edges   : ${emitted.toLocaleString()}`)
console.log(`parseFile, distinct edges   : ${delivered.toLocaleString()}`)
console.log(`SHORTFALL                  : ${(emitted - delivered).toLocaleString()}  in ${filesWithDrops} files`)
console.log("")
if (droppedByLabel.size) {
  console.log("dropped by label:")
  for (const [k, v] of [...droppedByLabel].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${v}`)
  console.log("dropped by the filter rule that fires (re-derived from filterNoiseRelationships' own leaf logic):")
  for (const [k, v] of [...droppedByRule].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(30)} ${v}`)
  console.log("")
  for (const e of examples.slice(0, 14)) {
    console.log(`  ${e.label.padEnd(12)} ${e.file}  ${e.source} -> ${JSON.stringify(e.target).slice(0, 70)}   [${e.rule}]`)
  }
}
console.log("")
console.log(`verdict: ${artifact.verdict}`)

if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`)
  console.log(`\nartifact: ${OUT}`)
}
