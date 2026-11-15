/**
 * WHAT THE SHARED NOISE FILTER COSTS THIS LANE — julia, lane-owned.
 *
 * ## Why this exists
 *
 * `script/m14/oracles/julia-exports.ts` derives an `exports` edge to `<:` in
 * `julia/base/boot.jl:222` and `julia/base/exports.jl:4`. The analyzer emits the name into its
 * `ExportInfo[]` payload and NOT into the relationship, which is the shape of a filter rather than of
 * a missing branch — so the filter was read.
 *
 * It is `filterNoiseRelationships` in `src/ast/pool-worker.ts:654`:
 *
 *     if (/[{}`<>\n\r\t]/.test(leaf)) return false
 *
 * A target whose LEAF contains `<` or `>` is deleted. The rule is there to block HTML-ish garbage
 * (`<tag>`, `<div>`) and it does that job. It also deletes every relationship whose target is a
 * COMPARISON or SHIFT OPERATOR, because in julia `<`, `<=`, `<:`, `<<`, `>>` and `>=` are all real
 * bindings with real call sites — `sort!(v, by = <)` calls `<`; `julia/base/exports.jl` exports `<:`.
 *
 * This script measures the cost with the filter's OWN logic rather than an approximation of it, and
 * separates the deletions into the two kinds that look identical in a count and are opposite findings:
 *
 *   LEGITIMATE — the target is a julia binding the analyzer published a symbol for. Deleting it is a
 *                false positive and the edge is gone from the graph.
 *   SNIPPET    — the target is a source fragment (multi-line, or carrying `:`/`(`/`,`/spaces). The
 *                filter is RIGHT to delete it, and it was already going to be caught by the length
 *                and newline rules above the character class. Counting these as filter damage would
 *                be the wrong conclusion in the direction that flatters the finding.
 *
 * ## Why the lane's own census could not have found this
 *
 * `census.ts`, `arbiter-census-diff.ts` and the firing check all read the production path — which is
 * correct for what they measure, and it means a filter INSIDE that path is invisible to all of them
 * by construction: the filter and the measurement are on the same side. The oracles read the TREE, so
 * they see what the filter removed. That is the whole argument for keeping a tree-side instrument
 * beside a production-path one, and it is why this finding arrived at all.
 *
 * ## The limit
 *
 * It measures what `RealJuliaAnalyzer.analyze()` emits against what `filterNoiseRelationships` keeps,
 * which is the filter's own decision boundary. It does not measure what the INDEXER does downstream of
 * that filter, and it cannot say whether the edge that was deleted would have resolved. The
 * `declaredNames` set the filter also consults is language-dependent and is NOT re-derived here; a
 * target dropped only because of `declaredNames` is not counted as filter damage, which makes this a
 * LOWER bound on what the shared path costs and not an upper one.
 *
 * READ-ONLY. Writes nothing.
 *
 *   npx tsx validation/m14/fixtures/julia/shared-filter-cost.ts [--files 2000]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { RealJuliaAnalyzer } from "../../../../src/ast/real-julia-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const LIMIT = Number(argv[argv.indexOf("--files") + 1]) || 0

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-julia.wasm"))))

// ---- the admitted population, discovered and sorted exactly as the census and the differential
// discover it.
const files: { label: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "julia") continue
    files.push({ label: `${e}/${rel}`, abs })
  }
}
files.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
const population = files.length
if (LIMIT) files.length = Math.min(files.length, LIMIT)

/**
 * `filterNoiseRelationships`'s own leaf extraction, transcribed. Copied rather than imported because
 * the function is exported but its leaf rule is INTERNAL to it, and a second implementation is the
 * only way to ask "what would this rule decide" without running the whole production pipeline.
 * Transcription is stated so a reader can diff it against `pool-worker.ts:601-655`.
 */
const extractLeaf = (name: string): string => {
  const noLine = name.replace(/:\d+$/, "")
  const segments = noLine.split(":").filter((s) => s.length > 0)
  const last = segments[segments.length - 1] ?? ""
  const dotParts = last.split(".")
  return dotParts[dotParts.length - 1]
}

/**
 * WHY each row is deleted, using the filter's own ordered rules.
 *
 * The distinction that matters is not "deleted" but "deleted BY WHICH RULE", because the rules split
 * into two groups with opposite verdicts:
 *
 *   `length` / `newline` / `leaf-length` — the target is a SOURCE FRAGMENT. The filter is right, and the
 *       underlying defect is upstream: `RealJuliaAnalyzer` published a symbol whose NAME is a fragment
 *       (a `contains` edge's target is by construction a name this analyzer published, so a
 *       fragment-named symbol shows up here as a legitimate-looking `contains` row and is not filter
 *       damage at all).
 *   `angle-bracket` — the target is a WELL-FORMED token containing `<` or `>`. Nothing else in the
 *       filter would have dropped it. This is the filter's own rule acting alone, and for julia it
 *       deletes real operator bindings.
 *   `whitespace` — a well-formed target with layout whitespace, which the filter also blocks.
 */
type Verdict = "kept" | "length" | "newline" | "leaf-length" | "angle-bracket" | "whitespace"
function filterVerdict(target: string): Verdict {
  if (!target) return "kept"
  if (target.length > 200) return "length"
  if (target.includes("\n")) return "newline"
  const leaf = extractLeaf(target)
  if (leaf.length > 80 || leaf.length < 1) return "leaf-length"
  if (/[{}`<>\n\r\t]/.test(leaf)) return "angle-bracket"
  if (leaf.startsWith(" ") || leaf.includes("  ")) return "whitespace"
  return "kept"
}

/** A NAME that is a plausible julia binding rather than a fragment of source. */
function isWellFormedName(target: string): boolean {
  if (!target || target.length > 200) return false
  if (target.includes("\n") || target.includes("\r") || target.includes("\t")) return false
  if (target.includes("  ")) return false
  return true
}

/**
 * Does the target name something this analyzer PUBLISHED in this file?
 *
 * Decided from the file's own symbol table, so it is not a judgement about how operator-ish the string
 * looks. Note what this test does and does not establish for `contains`: a `contains` edge's target is
 * by construction a published symbol, so membership is trivially true there and carries no
 * information — which is why the buckets below are cut by REASON first and by membership second, and
 * why a `contains` row can only land in the fragment bucket.
 */
const analyzer = new RealJuliaAnalyzer()
type Bucket = { count: number; published: number; examples: Set<string>; files: Set<string> }
const byTypeReason = new Map<string, Bucket>()
const fragmentNames = new Map<string, Bucket>()
let emitted = 0
let keptCount = 0

const bucketFor = (m: Map<string, Bucket>, k: string): Bucket => {
  let b = m.get(k)
  if (!b) { b = { count: 0, published: 0, examples: new Set(), files: new Set() }; m.set(k, b) }
  return b
}
const show = (t: string): string => (t.length > 44 ? `${JSON.stringify(t.slice(0, 44))}…` : JSON.stringify(t))
const FRAGMENT_REASONS = new Set<Verdict>(["length", "newline", "leaf-length"])

for (const f of files) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(text) } catch { continue }
  if (!tree) continue
  let r: any
  try { r = analyzer.analyze(tree.rootNode, text, f.abs) } catch { continue }
  const declared = new Set((r?.symbols ?? []).map((s: any) => String(s?.name ?? "")).filter(Boolean))
  for (const rel of (r?.relationships ?? []) as any[]) {
    emitted++
    const target = String(rel.target ?? "")
    const v = filterVerdict(target)
    if (v === "kept") { keptCount++; continue }
    const label = String(rel.type ?? "?")
    // Each edge lands in EXACTLY ONE (type, reason) bucket, and `published` inside it is a flag
    // rather than a second bucket — an earlier version counted not-published rows as their own bucket
    // and so double-counted every one of them, which is the arithmetic error this comment is here to
    // stop being reintroduced.
    const b = bucketFor(byTypeReason, `${label} | ${v}`)
    b.count++
    if (declared.has(target) || declared.has(extractLeaf(target))) b.published++
    if (b.examples.size < 6) b.examples.add(show(target))
    if (b.files.size < 6) b.files.add(f.label)
    if (FRAGMENT_REASONS.has(v)) {
      const fn = bucketFor(fragmentNames, label)
      fn.count++
      if (fn.examples.size < 4) fn.examples.add(show(target))
    }
  }
  // Free the tree, AFTER every read above. `analyzer.analyze` returns plain records, but it is
  // called with `tree.rootNode` and this loop parses the whole admitted population in one process,
  // so the tree must outlive the read of `r` and not one line more. Measured by
  // `validation/m14/fixtures/julia/tree-lifetime-probe.ts`: unfreed trees make the third pass over
  // 1,985 files throw `Aborted()` on 1,928 of them, and a throw here is a silent `continue` — so
  // the leak would have shown up as a smaller population on the `analysed` line with no other sign.
  try { tree.delete?.() } catch { /* already released */ }
}

const totalDeleted = emitted - keptCount
let byReason = 0
let charClassTotal = 0
let charClassPublished = 0
for (const [k, b] of byTypeReason) {
  byReason += b.count
  if (k.endsWith("angle-bracket") || k.endsWith("whitespace")) { charClassTotal += b.count; charClassPublished += b.published }
}
let fragmentTotal = 0
for (const b of fragmentNames.values()) fragmentTotal += b.count

console.log(`SHARED NOISE FILTER COST — julia`)
console.log(`corpus root ${CR}`)
console.log(`population ${population} · analysed ${files.length}${LIMIT ? ` (--files ${LIMIT})` : " (no sampling)"}`)
console.log(`relationships emitted by analyze(): ${emitted} · kept by filterNoiseRelationships: ${keptCount} · DELETED: ${totalDeleted} (bucketed: ${byReason})`)
console.log()
console.log(`  ${charClassTotal}  deleted by the ANGLE-BRACKET / WHITESPACE rules alone — a well-formed target that no other`)
console.log(`                 rule in the filter would have touched. Of those, ${charClassPublished} name a symbol this analyzer`)
console.log(`                 PUBLISHED in the same file, so the edge pointed at a real declaration.`)
console.log(`  ${fragmentTotal}  deleted by the LENGTH / NEWLINE / LEAF-LENGTH rules, i.e. the target is a source FRAGMENT`)
console.log(`                 rather than a name. For those the filter is right and the defect is upstream:`)
console.log(`                 \`contains\` rows carry a published symbol's name by construction, so a symbol whose NAME is a`)
console.log(`                 multi-line fragment arrives here looking like a legitimate containment edge.`)
console.log()
console.log(`=== every deleted bucket, by type and by the rule that fired (each edge counted once) ===`)
for (const [k, b] of [...byTypeReason.entries()].sort()) {
  const [type, reason] = k.split(" | ")
  console.log(`  ${type.padEnd(10)} ${reason.padEnd(14)} ${String(b.count).padStart(4)} deleted, ${String(b.published).padStart(4)} published-symbol · ${[...b.examples].slice(0, 3).join(" ")}`)
}
console.log()
console.log(`=== the character-class deletions in full, per type ===`)
for (const [k, b] of [...byTypeReason.entries()].sort()) {
  if (!k.endsWith("angle-bracket") && !k.endsWith("whitespace")) continue
  const [type, reason] = k.split(" | ")
  console.log(`  ${type.padEnd(10)} ${reason.padEnd(14)} ${String(b.count).padStart(4)} deleted, ${String(b.published).padStart(4)} published-symbol`)
  console.log(`    targets: ${[...b.examples].join(" ")}`)
  console.log(`    files:   ${[...b.files].join(", ")}`)
}