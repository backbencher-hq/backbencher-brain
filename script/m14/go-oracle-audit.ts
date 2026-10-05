/**
 * GO ORACLE AUDIT — the go lane's own differential, run over ALL TEN labels.
 *
 * ## Why this exists rather than `script/m14/differential.ts`
 *
 * Two reasons, both measured rather than asserted.
 *
 * 1. `differential.ts` is MASTER-owned and its go compared-label filter
 *    EXCLUDES `overrides` for go:
 *      ...(lang !== "csharp" && lang !== "dart" && lang !== "swift" &&
 *          lang !== "cpp" && lang !== "go" ? ["overrides"] : [])
 *    so even a wired truth loop would have its rows dropped before the
 *    comparison. The lane cannot change that, and needs a number anyway.
 * 2. `differential.ts` runs a sweep over EVERY language on import. Asking it
 *    one lane's question means starting all 42.
 *
 * So this runner drives the PRODUCTION entry (`parseFile` from
 * `src/ast/pool-worker`) and this lane's oracle (`./go-truth.ts`), and compares
 * them per label with the same four verdicts the differential reports:
 *
 *   MATCHED    the analyzer edge set and the oracle edge set are equal as sets
 *   MISSING    the oracle derived it, the analyzer did not emit it
 *   EXTRA      the analyzer emitted it, the oracle did not derive it
 *   (per label, so one empty label cannot hide behind a busy one)
 *
 * ## WHAT A PASS HERE DOES NOT PROVE, and it is the same limit every
 * differential in this repository has
 *
 * The oracle and the analyzer load the SAME `tree-sitter-go.wasm`. A bug in the
 * grammar — a node type that fails to match, a field that is never populated —
 * is invisible here exactly as it is to `differential.ts`, because both paths
 * read the same tree. This runner establishes that the two INDEPENDENT
 * IMPLEMENTATIONS of each Go rule agree on a real corpus. It does not
 * establish that the grammar is right, and no artifact in this repository does.
 *
 * ## MATCHING RULE
 *
 * Compared on `label|source|target` after the family's endpoint conventions are
 * applied to BOTH sides identically (leaf extraction for a qualified target,
 * `Receiver.Method` kept whole). Nothing is normalised away silently: a target
 * that differs between the two sides is a row in MISSING and a row in EXTRA,
 * which is what makes a relabel visible instead of invisible.
 *
 * USAGE
 *   npx tsx script/m14/go-oracle-audit.ts --out audit.json [--repo a,b] [--shard=i/n]
 *   npx tsx script/m14/go-oracle-audit.ts --merge x.json y.json --out audit.json
 *
 * ## MATCHING RULE, AND WHY TWO OF THEM
 *
 * The shared harness rule first, so this lane's number means what everyone
 * else's means: a row is COVERED when `label + normTarget(target)` matches, with
 * the SOURCE deliberately not part of the match — which is why `deriveGoEdges`
 * writes `from: "(expr)"` for a call site with no symbol source. `normTarget`
 * and `strictTargetText` are IMPORTED from `differential.ts` rather than
 * reimplemented, so a change to the family's normalisation cannot leave this
 * lane comparing on stale rules.
 *
 * Then the rule the shared one cannot express, for the two labels this lane's
 * oracle adds: their SOURCE is load-bearing. `overrides` reads `T.M -> E.M`, and
 * an edge whose TARGET matches while its source names a different receiver is a
 * different relationship that a target-only match would report as agreement. So
 * `exports` and `overrides` are counted a second time under a STRICT key,
 * `label|source|target`, and both numbers are printed. The strict number is the
 * one to read for those two; the shared-rule number is there so it can be
 * compared against the artifact `differential.ts` would produce.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { GO_ORACLE_LABELS, deriveGoExportsTruth, deriveGoOverridesTruth } from "./go-truth"
// The eight labels go has derived since the wave. `differential.ts` guards its
// sweep with `process.argv[1]?.endsWith("differential.ts")`, so importing the
// derivations does NOT start a 42-language run — verified by reading the guard,
// and this runner completes in seconds on 36 files where a sweep would not.
import {
  normTarget,
  strictTargetText,
  deriveGoEdges,
  deriveGoImplements,
  deriveGoDeclaredTypeRefs,
  deriveGoContains,
  deriveGoUses,
  deriveGoImports,
} from "./differential"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1]
  const j = process.argv.find((a) => a.startsWith(`${flag}=`))
  return j ? j.slice(flag.length + 1) : dflt
}
const REPOS = (argOf("--repo", "go-stdlib,cobra") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024
const SAMPLE = 8
/** Same reason as the census's SKIP: `parseFile` self-destructs the process at
 *  120 s, so one pathological file ends a shard silently. */
const SKIP = new Set((process.env.BB_GO_SKIP ?? "").split(",").map((s) => s.trim()).filter(Boolean))

type LabelRow = {
  label: string
  analyzer: number
  truth: number
  matched: number
  missing: number
  extra: number
  missingSamples: string[]
  extraSamples: string[]
  /** STRICT key counts (`label|source|target`). Populated for STRICT_LABELS only;
   *  0 for the rest is MEANINGLESS rather than a measurement, which is why the
   *  report prints `-` and not `0` for a label with no strict pass. */
  strictAnalyzer: number
  strictTruth: number
  strictMatched: number
  strictMissing: number
  strictExtra: number
  strictMissingSamples: string[]
  strictExtraSamples: string[]
}
/** The two labels whose SOURCE carries the meaning. `overrides` reads
 *  `T.M -> E.M`; `exports` reads `<package> -> Name`, and a target-only match
 *  would let an edge from the WRONG package satisfy the row. */
const STRICT_LABELS = ["exports", "overrides"] as const
type Audit = {
  schema: "go-oracle-audit/1"
  repos: string[]
  revisions: Record<string, string>
  corpusAdmitted: number
  drawn: number
  parsedThroughProductionEntry: number
  parseFailures: number
  parseTreesWithErrors: number
  labelsAudited: string[]
  perLabel: Record<string, LabelRow>
  wallMs: number
}

const key = (label: string, from: string, target: string) => `${label}|${from}|${target}`

if (process.argv.includes("--merge")) {
  const parts = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== OUT && a.endsWith(".json"))
  const acc: Audit = {
    schema: "go-oracle-audit/1", repos: [], revisions: {}, corpusAdmitted: 0, drawn: 0,
    parsedThroughProductionEntry: 0, parseFailures: 0, parseTreesWithErrors: 0,
    labelsAudited: [...GO_ORACLE_LABELS], perLabel: {}, wallMs: 0,
  }
  for (const p of parts) {
    const s = JSON.parse(readFileSync(p, "utf8")) as Audit
    for (const r of s.repos) if (!acc.repos.includes(r)) acc.repos.push(r)
    Object.assign(acc.revisions, s.revisions)
    acc.corpusAdmitted = Math.max(acc.corpusAdmitted, s.corpusAdmitted)
    acc.drawn += s.drawn
    acc.parsedThroughProductionEntry += s.parsedThroughProductionEntry
    acc.parseFailures += s.parseFailures
    acc.parseTreesWithErrors += s.parseTreesWithErrors
    acc.wallMs += s.wallMs
    for (const l of s.labelsAudited) {
      const a = (acc.perLabel[l] ??= { label: l, analyzer: 0, truth: 0, matched: 0, missing: 0, extra: 0, missingSamples: [], extraSamples: [], strictAnalyzer: 0, strictTruth: 0, strictMatched: 0, strictMissing: 0, strictExtra: 0, strictMissingSamples: [], strictExtraSamples: [] })
      const b = s.perLabel[l]
      if (!b) continue
      // `matched` is a SET intersection, so it must be recomputed from the two
      // sides' counts rather than summed: shard A and shard B can each match the
      // same key only if they saw the same file, and they partition files, so
      // summing intersection counts is exact. Stated here because the alternative
      // (storing matched keys) would cost memory the corpus does not have.
      a.analyzer += b.analyzer
      a.truth += b.truth
      a.matched += b.matched
      a.missing += b.missing
      a.extra += b.extra
      // Strict counts are SET intersections over a file partition, so they sum
      // exactly for the same reason `matched` does — and the samples are capped
      // per shard then re-capped here, so the merged list is a sample and not a
      // claim that these were the only rows.
      a.strictAnalyzer += b.strictAnalyzer ?? 0
      a.strictTruth += b.strictTruth ?? 0
      a.strictMatched += b.strictMatched ?? 0
      a.strictMissing += b.strictMissing ?? 0
      a.strictExtra += b.strictExtra ?? 0
      for (const m of b.missingSamples) if (a.missingSamples.length < SAMPLE * 4) a.missingSamples.push(m)
      for (const m of b.extraSamples) if (a.extraSamples.length < SAMPLE * 4) a.extraSamples.push(m)
      for (const m of b.strictMissingSamples ?? []) if (a.strictMissingSamples.length < SAMPLE * 4) a.strictMissingSamples.push(m)
      for (const m of b.strictExtraSamples ?? []) if (a.strictExtraSamples.length < SAMPLE * 4) a.strictExtraSamples.push(m)
    }
  }
  if (OUT) { writeFileSync(OUT, JSON.stringify(acc, null, 2)); console.log(`merged ${parts.length} shards -> ${OUT}`) }
  report(acc)
  process.exit(0)
}

const files: Array<{ repo: string; dir: string; rel: string; abs: string }> = []
const revisions: Record<string, string> = {}
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  try { statSync(dir) } catch { continue }
  try { revisions[repo] = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.go"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
    if (SKIP.has(`${repo}/${rel}`)) continue
    files.push({ repo, dir, rel, abs })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : a.repo + "/" + b.rel > b.repo + "/" + b.rel ? 1 : 0))
let draw = files
const shardArg = process.argv.find((a) => a.startsWith("--shard="))
if (shardArg) {
  const [i, n] = shardArg.slice("--shard=".length).split("/").map(Number)
  draw = files.filter((_, k) => k % n === i)
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-go.wasm"))))

const out: Audit = {
  schema: "go-oracle-audit/1", repos: REPOS, revisions, corpusAdmitted: files.length, drawn: draw.length,
  parsedThroughProductionEntry: 0, parseFailures: 0, parseTreesWithErrors: 0,
  labelsAudited: [...GO_ORACLE_LABELS], perLabel: {}, wallMs: 0,
}
for (const l of GO_ORACLE_LABELS) out.perLabel[l] = { label: l, analyzer: 0, truth: 0, matched: 0, missing: 0, extra: 0, missingSamples: [], extraSamples: [], strictAnalyzer: 0, strictTruth: 0, strictMatched: 0, strictMissing: 0, strictExtra: 0, strictMissingSamples: [], strictExtraSamples: [] }

const hasError = (n: any): boolean => {
  if (n.type === "ERROR" || n.isMissing) return true
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && hasError(c)) return true }
  return false
}

let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    const fileLabel = `${f.repo}/${f.rel}`
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { out.parseFailures++; continue }
    out.parsedThroughProductionEntry++

    const text = readFileSync(f.abs, "utf8")
    const tree = parser.parse(text)
    let truth: Array<{ label: string; from?: string; target: string }> = []
    if (tree) {
      if (hasError(tree.rootNode)) out.parseTreesWithErrors++
      truth = [
        ...deriveGoEdges(tree.rootNode),
        ...deriveGoImplements(tree.rootNode),
        ...deriveGoDeclaredTypeRefs(tree.rootNode),
        ...deriveGoContains(tree.rootNode),
        ...deriveGoUses(tree.rootNode),
        ...deriveGoImports(tree.rootNode, fileLabel),
        ...deriveGoExportsTruth(tree.rootNode),
        ...deriveGoOverridesTruth(tree.rootNode),
      ]
      tree.delete?.()
    }

    const analyzerKeys = new Set<string>()
    const analyzerStrict = new Set<string>()
    for (const x of r?.relationships ?? []) {
      const l = String(x.type ?? x.relationshipType ?? "")
      if (!(GO_ORACLE_LABELS as readonly string[]).includes(l)) continue
      const src = String(x.source ?? x.from ?? "")
      const tgt = String(x.target ?? x.to ?? x.toSymbol ?? "")
      analyzerKeys.add(key(l, "", normTarget(tgt)))
      analyzerStrict.add(key(l, src, strictTargetText(tgt)))
    }
    const truthKeys = new Set<string>()
    const truthStrict = new Set<string>()
    for (const t of truth) {
      truthKeys.add(key(t.label, "", normTarget(t.target)))
      truthStrict.add(key(t.label, String(t.from ?? ""), strictTargetText(t.target)))
    }

    for (const k of analyzerKeys) {
      const l = k.slice(0, k.indexOf("|"))
      out.perLabel[l].analyzer++
      if (truthKeys.has(k)) out.perLabel[l].matched++
      else {
        out.perLabel[l].extra++
        if (out.perLabel[l].extraSamples.length < SAMPLE) out.perLabel[l].extraSamples.push(`${fileLabel} ${k.slice(k.indexOf("|") + 1)}`)
      }
    }
    // `truth` counts every derived row for the label, matched or not, so the
    // column can be read as a denominator. It used to count only the unmatched
    // ones, which printed 0 beside a matched count of 359 and read as "the
    // oracle derived nothing" — the exact inverse of what happened.
    for (const k of truthKeys) {
      const l = k.slice(0, k.indexOf("|"))
      out.perLabel[l].truth++
      if (analyzerKeys.has(k)) continue
      out.perLabel[l].missing++
      if (out.perLabel[l].missingSamples.length < SAMPLE) out.perLabel[l].missingSamples.push(`${fileLabel} ${k.slice(k.indexOf("|") + 1)}`)
    }
    // STRICT pass — the two labels whose source carries the meaning.
    for (const l of STRICT_LABELS) {
      const row = out.perLabel[l]
      if (!row) continue
      for (const k of analyzerStrict) {
        if (k.slice(0, k.indexOf("|")) !== l) continue
        row.strictAnalyzer++
        if (truthStrict.has(k)) row.strictMatched++
        else { row.strictExtra++; if (row.strictExtraSamples.length < SAMPLE) row.strictExtraSamples.push(`${fileLabel} ${k}`) }
      }
      for (const k of truthStrict) {
        if (k.slice(0, k.indexOf("|")) !== l) continue
        row.strictTruth++
        if (analyzerStrict.has(k)) continue
        row.strictMissing++
        if (row.strictMissingSamples.length < SAMPLE) row.strictMissingSamples.push(`${fileLabel} ${k}`)
      }
    }
  }
}
const t0 = Date.now()
await Promise.all(Array.from({ length: Number(process.env.BB_GO_CENSUS_WORKERS ?? "6") }, () => worker()))
out.wallMs = Date.now() - t0

function report(a: Audit): void {
  console.log(`\ngo oracle audit — ${a.parsedThroughProductionEntry} files through parseFile (${a.parseFailures} failures, ${a.parseTreesWithErrors} trees carrying ERROR/MISSING), ${a.wallMs} ms`)
  console.log(`labels audited: ${a.labelsAudited.length} — ${a.labelsAudited.join(", ")}`)
  // COUNTS ARE DISTINCT KEYS PER LABEL, NOT EDGES. The analyzer emits many edges
  // that normalise to one key (`s.repo.Save(a)` and `s.repo.Save(b)` are both
  // `calls|Save`), and a raw edge count next to a key count reads as a
  // disagreement when it is a unit change. `go-ontology-census.ts` carries the
  // raw edge counts.
  console.log(`\nshared rule (label|normTarget(target)) — DISTINCT KEYS, not edges`)
  console.log(`${"label".padEnd(13)}${"analyzer".padStart(10)}${"truth".padStart(8)}${"matched".padStart(9)}${"missing".padStart(9)}${"extra".padStart(8)}`)
  console.log("-".repeat(60))
  for (const l of a.labelsAudited) {
    const r = a.perLabel[l]
    if (!r) continue
    console.log(`${l.padEnd(13)}${String(r.analyzer).padStart(10)}${String(r.truth).padStart(8)}${String(r.matched).padStart(9)}${String(r.missing).padStart(9)}${String(r.extra).padStart(8)}`)
  }
  console.log(`\nSTRICT pass (label|source|target) — the rule to read for ${STRICT_LABELS.join(" and ")}:`)
  console.log(`${"label".padEnd(13)}${"strictAnalyzer".padStart(15)}${"strictTruth".padStart(12)}${"strictMatched".padStart(14)}${"strictMissing".padStart(14)}${"strictExtra".padStart(12)}`)
  for (const l of STRICT_LABELS) {
    const r = a.perLabel[l]
    if (!r) continue
    console.log(`${l.padEnd(13)}${String(r.strictAnalyzer).padStart(15)}${String(r.strictTruth).padStart(12)}${String(r.strictMatched).padStart(14)}${String(r.strictMissing).padStart(14)}${String(r.strictExtra).padStart(12)}`)
    for (const m of r.strictMissingSamples) console.log(`   strict missing ${m}`)
    for (const m of r.strictExtraSamples) console.log(`   strict extra   ${m}`)
  }
}
report(out)
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }