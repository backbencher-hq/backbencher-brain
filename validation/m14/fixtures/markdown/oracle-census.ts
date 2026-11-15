/**
 * MARKDOWN ORACLE CENSUS — the whole-repo version of the F5 differential's 60-file draw.
 *
 * ## Why this file exists
 *
 * `script/m14/differential.ts --lang markdown` compares on a rotating 60-file draw per
 * repo, and this run's draw on `kubernetes` reads **MISSING=0 / unexplained=2** — two
 * analyzer `uses` edges the independent oracle does not derive. The harness prints a
 * count for `unexplained` and no samples, so those two edges cannot be identified from
 * its output, and a 60-file draw out of 557 corpus files is not a census of them.
 *
 * This file answers the same question over EVERY markdown file of a repo, using the
 * harness's own exported matching (`normTarget`, `strictKey`) so the numbers are
 * comparable with the F5 line rather than a private definition of "the same edge".
 * `deriveMarkdownEdges` is imported from `script/m14/markdown-oracle.ts` — the oracle,
 * not the analyzer — so the two sides stay independently derived.
 *
 * It exists because the pass-2 brief asks for the six questions answered
 * ADVERSARARIALLY, and "Correct" (#3) means finding the cases where the oracle and the
 * analyzer disagree, not confirming the count they agree on.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/markdown/oracle-census.ts --repo kubernetes [--repo scala3]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import { deriveMarkdownEdges } from "../../../../script/m14/markdown-oracle"
import { normTarget, strictKey } from "../../../../script/m14/differential"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const repos: string[] = []
for (let i = 0; i < argv.length; i++) if (argv[i] === "--repo" && argv[i + 1]) repos.push(argv[i + 1])
const OUT = (() => {
  const i = argv.indexOf("--out")
  return i >= 0 && argv[i + 1] ? argv[i + 1] : ""
})()
if (repos.length === 0) repos.push("kubernetes", "scala3")

// The block grammar, loaded once. The oracle needs a `rootNode`, and it takes the
// COMPANION inline sub-parse itself rather than reading the engine's — that is the
// point of it, and reusing the engine's pre-parse here would make the census a mirror.
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-markdown.wasm"))))

type Row = { label: string; target: string; from: string }
const out: any = { instrument: "markdown oracle census (validation/m14/fixtures/markdown/oracle-census.ts)", corpusRoot: CR, repos: {} }

for (const repo of repos) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { out.repos[repo] = { error: "not a git repository" }; continue }
  const md = tracked.filter((t) => /\.(md|markdown)$/i.test(t))
  const perLabel = new Map<string, { truth: number; edges: number; missing: number; unexplained: number }>()
  const bump = (l: string) => {
    let r = perLabel.get(l)
    if (!r) { r = { truth: 0, edges: 0, missing: 0, unexplained: 0 }; perLabel.set(l, r) }
    return r
  }
  const missingSamples: string[] = []
  const unexplainedSamples: string[] = []
  /**
   * WHY each missing row is missing, bucketed by the rule that would have rejected it.
   *
   * `filterNoiseRelationships` in `src/ast/pool-worker.ts` runs on the production
   * `parseFile` path and applies a UNIVERSAL identifier sanitizer to every relationship
   * target, exempting only json/yaml/hcl/terraform/graphql and two path-shaped bash
   * labels. Its `extractLeaf` splits a target on `:` and takes the last segment, which
   * is right for a qualified identifier (`ns::member`, `a.b`) and wrong for a PROSE name:
   * a markdown heading is the author's own text, and a heading like
   * `### CVE-2021-25735: Validating Admission Webhook` yields the leaf
   * `" Validating Admission Webhook"`, which the rule `leaf.startsWith(" ")` then rejects.
   *
   * Re-derived here — not copied — so the bucket names the rule rather than asserting
   * the cause. The fix is `src/ast/pool-worker.ts`'s and is a supervisor item
   * (workstream §8); this file only measures the cost.
   */
  const sanitizerRule = (t: string): string | null => {
    const noLine = t.replace(/:\d+$/, "")
    const segments = noLine.split(":").filter((s) => s.length > 0)
    const last = segments[segments.length - 1] ?? ""
    const leaf = last.split(".").pop() ?? last
    if (t.length > 200 || t.includes("\n")) return "target-longer-than-200-or-has-newline"
    if (leaf.length > 80) return "leaf-longer-than-80"
    if (leaf.length < 1) return "leaf-empty"
    if (/[{}`<>\n\r\t]/.test(leaf)) return "leaf-carries-brace-angle-or-backtick"
    if (leaf.startsWith(" ") || leaf.includes("  ")) return "leaf-starts-with-space"
    return null
  }
  const missingByRule = new Map<string, number>()
  const missingByRuleExamples = new Map<string, string[]>()
  let files = 0
  let parseFailures = 0
  let truthTotal = 0
  let edgeTotal = 0
  let i = 0
  async function worker() {
    while (true) {
      const k = i++
      if (k >= md.length) return
      const rel = md[k]
      const abs = path.join(dir, rel)
      let content: string
      try { if (statSync(abs).size > 512 * 1024) continue; content = readFileSync(abs, "utf8") } catch { continue }
      let tree: any
      try { tree = parser.parse(content) } catch { parseFailures++; continue }
      if (!tree) { parseFailures++; continue }
      let truth: Row[] = []
      try { truth = (await deriveMarkdownEdges(tree.rootNode, content)) as Row[] } catch { parseFailures++; continue }
      let res: any
      try { res = await parseFile(abs, dir) } catch { parseFailures++; tree.delete?.(); continue }
      files++

      const truthKeys = new Set<string>()
      // The RAW target, keyed by the harness's normalised one. The rule attribution has
      // to read the RAW string: `normTarget` already takes the last `.`-segment, so a
      // heading ending in a full stop arrives here as `Some heading` with the stop gone
      // — and the shared sanitizer's `leaf-empty` rule, which fires precisely BECAUSE
      // the trailing stop leaves an empty last segment, becomes invisible. The first
      // run of this file made that mistake and reported 6 rows as unexplained by the
      // sanitizer when all 6 are `leaf-empty`.
      const rawTargetFor = new Map<string, string>()
      for (const t of truth) {
        const row = bump(t.label)
        row.truth++
        truthTotal++
        const key = `${t.label}|${normTarget(t.target)}`
        truthKeys.add(key)
        if (!rawTargetFor.has(key)) rawTargetFor.set(key, String(t.target))
      }
      const edgeKeys = new Set<string>()
      for (const e of (res?.relationships ?? []) as any[]) {
        const label = String(e?.type ?? e?.relationshipType ?? "")
        if (!label) continue
        const b = bump(label)
        b.edges++
        edgeTotal++
        edgeKeys.add(`${label}|${normTarget(String(e.target ?? ""))}`)
      }
      for (const key of truthKeys) {
        if (edgeKeys.has(key)) continue
        const [label, target] = key.split("|")
        bump(label).missing++
        if (missingSamples.length < 40) missingSamples.push(`${repo}/${rel}: ${label} -> ${target}`)
        const rule = sanitizerRule(rawTargetFor.get(key) ?? target)
        const bucket = rule ?? "NOT-EXPLAINED-BY-THE-SANITIZER"
        missingByRule.set(bucket, (missingByRule.get(bucket) ?? 0) + 1)
        const ex = missingByRuleExamples.get(bucket) ?? []
        if (ex.length < 4) { ex.push(`${repo}/${rel}: ${label} -> ${target.slice(0, 90)}`); missingByRuleExamples.set(bucket, ex) }
      }
      for (const key of edgeKeys) {
        if (truthKeys.has(key)) continue
        const [label, target] = key.split("|")
        bump(label).unexplained++
        if (unexplainedSamples.length < 40) unexplainedSamples.push(`${repo}/${rel}: ${label} -> ${target} (strict ${strictKey(label, target)})`)
      }
      tree.delete?.()
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()))
  out.repos[repo] = {
    markdownFiles: md.length,
    filesCompared: files,
    parseFailures,
    truthRows: truthTotal,
    analyzerEdges: edgeTotal,
    byLabel: Object.fromEntries([...perLabel.entries()].sort()),
    missingBySharedSanitizerRule: Object.fromEntries([...missingByRule.entries()].sort((a2, b2) => b2[1] - a2[1])),
    missingByRuleExamples: Object.fromEntries(missingByRuleExamples),
    missingSamples,
    unexplainedSamples,
  }
  const r = out.repos[repo]
  console.log(`--- ${repo}: ${r.markdownFiles} markdown files, ${files} compared, truth=${truthTotal} edges=${edgeTotal}`)
  for (const [l, v] of [...perLabel.entries()].sort()) {
    console.log(`    ${l.padEnd(12)} truth=${String(v.truth).padStart(6)} edges=${String(v.edges).padStart(6)} missing=${v.missing} unexplained=${v.unexplained}`)
  }
  if (r.unexplainedSamples.length) { console.log("    unexplained samples:"); for (const s of r.unexplainedSamples.slice(0, 12)) console.log(`      ${s}`) }
  console.log("    missing rows, attributed to the shared sanitizer rule that would reject them:")
  for (const [rule, n] of [...missingByRule.entries()].sort((x, y) => y[1] - x[1])) {
    console.log(`      ${String(n).padStart(5)}  ${rule}   e.g. ${(missingByRuleExamples.get(rule) ?? [])[0] ?? ""}`)
  }
}

if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`wrote ${OUT}`) }