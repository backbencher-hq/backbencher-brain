/**
 * PERL ORACLE PARITY — are the lane's oracle and the differential's copy the SAME derivation?
 *
 * ## WHY THIS FILE EXISTS, AND WHY IT HAD TO BE MEASURED RATHER THAN ASSUMED
 *
 * There are TWO perl oracles in this tree, and until now nobody had said whether they agree:
 *
 *   1. `script/m14/perl-truth.ts` — the LANE's own oracle, which closed the lane's derivation
 *      debt (the `script/m60/rel-type-coverage-gate.ts` CHECK 1 report that `calls` and
 *      `contains` were un-audited). It exports `derivePerlTruth` and `PERL_ORACLE_LABELS`.
 *   2. `derivePerlEdges` INSIDE `script/m14/differential.ts` — the copy the D4 actually runs,
 *      "RESTORED 2026-10-12" per the differential's own comment.
 *
 * The lane's oracle header says the differential still needs "two `derivePerl*Truth` calls in
 * its `lang === "perl"` block" — so the intent is for the D4 to RUN THE LANE'S ORACLE. **Until
 * that lands, the price of the differential's allowlist entry is the price of oracle (2), not
 * the price of oracle (1) — and the lane measured the price with oracle (1) ✓✓.** If the two
 * derivations disagree, the lane's measurement does not transfer, and the Lead would be
 * applying a two-line edit against a number that was measured somewhere else.
 *
 * **SO THE FIRST QUESTION IS NOT "WHAT SHOULD THE ORACLE DERIVE" BUT "DO THESE TWO ALREADY
 * AGREE" — and the answer has to be MEASURED, because the two files were written and
 * maintained separately and one of them was RESTORED through a merge ✓✓.**
 *
 * ## WHAT IT DOES, AND WHAT IT DOES NOT
 *
 * It parses the same files with the same grammar, runs BOTH oracles over the same tree, and
 * compares the edge SETS exactly (label, from, target — the harness's own key). It reports:
 *
 *   · the per-label edge counts of each oracle;
 *   · the rows each oracle has and the other does not, with samples;
 *   · the shape of the differences, because a difference is a FINDING and a shape is a
 *     RECONCILIATION PLAN.
 *
 * It does NOT edit either oracle, and it does not run the analyzer: it is a pure
 * oracle-against-oracle comparison, so its answer does not depend on the analyzer at all ✓✓.
 *
 * ## WHY THE SAMPLES ARE THE POINT
 *
 * Two oracles that differ by 12 rows out of 12,000 and two that differ in SHAPE (one derives
 * attributes, the other does not) are different problems with different prices, and a bare
 * count cannot tell them apart ✓✓. So the report carries the rows themselves, and a reader
 * can see which side is wrong without re-running anything.
 *
 * Usage:
 *   bun script/m14/perl-oracle-parity.mts [--limit N] [--out json]
 */
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const LIMIT = (() => { const i = process.argv.indexOf("--limit"); return i >= 0 ? Number(process.argv[i + 1]) : 0 })()
const argOut = (() => { const i = process.argv.indexOf("--out"); return i >= 0 ? process.argv[i + 1] : undefined })()
const OUT = argOut ?? path.join(ROOT, "validation", "m14", "measurements", "perl-oracle-parity.json")

const { derivePerlTruth, PERL_ORACLE_LABELS } = await import(path.join(ROOT, "script/m14/perl-truth.ts"))
const { derivePerlEdges } = await import(path.join(ROOT, "script/m14/differential.ts"))
const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection.ts"))
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })

// ── THE POPULATION, by the LANE's own rule (the same one perl-truth-run.ts uses) ──
// The corpus is a farm of SYMLINKS, so the walk follows them with statSync —
// `readdirSync(...).isDirectory()` silently drops every symlinked repo ✓✓.
const EXTS = [".pl", ".pm", ".t", ".pod", ".perl"]
const files: { repo: string; rel: string; abs: string }[] = []
const perRepo: Record<string, number> = {}
for (const repo of readdirSync(CR).sort()) {
  const dir = path.join(CR, repo)
  try {
    if (!statSync(dir).isDirectory()) continue
  } catch { continue }
  const repoFiles: string[] = []
  const walk = (d: string) => {
    let entries: string[] = []
    try { entries = readdirSync(d) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { walk(p); continue }
      if (!st.isFile()) continue
      if (st.size > 512 * 1024) continue
      const rel = path.relative(dir, p)
      if (!EXTS.some(x => rel.toLowerCase().endsWith(x))) continue
      let head = ""
      try { head = readFileSync(p, "utf8").slice(0, 4096) } catch { continue }
      if (detectLanguageFromPath(rel, head) !== "perl") continue
      repoFiles.push(p)
    }
  }
  walk(dir)
  if (repoFiles.length) {
    perRepo[repo] = repoFiles.length
    for (const abs of repoFiles) files.push({ repo, rel: path.relative(dir, abs), abs })
  }
}
const chosen = LIMIT > 0 ? files.slice(0, LIMIT) : files

// ── THE PARSER, and the two oracles over the same tree ──
const wasmPath = path.join(ROOT, "wasm", "tree-sitter-perl.wasm")
const grammar = await Language.load(readFileSync(wasmPath))
const parser = new ParserClass()
parser.setLanguage(grammar)

const key = (e: { label: string; from?: string; target: string }) => `${e.label}|${e.from ?? ""}|${e.target}`

const lane = new Map<string, number>()
const diff = new Map<string, number>()
const onlyLane: string[] = []
const onlyDiff: string[] = []
let parsed = 0
let threw = 0

for (const f of chosen) {
  let tree: any
  try {
    tree = parser.parse(readFileSync(f.abs, "utf8"))
  } catch { threw++; continue }
  if (!tree?.rootNode) { threw++; continue }
  parsed++
  const a = derivePerlTruth(tree.rootNode)
  const b = derivePerlEdges(tree.rootNode)
  for (const e of a) {
    const k = key(e as any)
    lane.set(e.label, (lane.get(e.label) ?? 0) + 1)
    if (!diff.has(e.label)) diff.set(e.label, 0)
  }
  for (const e of b) diff.set(e.label, (diff.get(e.label) ?? 0) + 1)
  const kb = new Set(b.map(key))
  const ka = new Set(a.map(key))
  for (const e of a) if (!kb.has(key(e as any))) onlyLane.push(`${f.repo}/${f.rel}  ${key(e as any)}`)
  for (const e of b) if (!ka.has(key(e as any))) onlyDiff.push(`${f.repo}/${f.rel}  ${key(e as any)}`)
}

const labels = [...new Set([...lane.keys(), ...diff.keys()])].sort()
const out = {
  generated: "2026-10-21",
  corpusRoot: CR,
  population: { admittedFiles: chosen.length, parsed, threwOnParse: threw, repos: perRepo },
  laneOracleLabels: [...PERL_ORACLE_LABELS],
  differentialOracleLabels: labels,
  perLabel: labels.map(l => ({ label: l, laneOracle: lane.get(l) ?? 0, differentialOracle: diff.get(l) ?? 0 })),
  onlyInLaneOracle: { count: onlyLane.length, samples: onlyLane.slice(0, 40) },
  onlyInDifferentialOracle: { count: onlyDiff.length, samples: onlyDiff.slice(0, 40) },
  // THE FULL SET DIFFERENCE, PER LABEL ✓✓.
  //
  // The two lists above are SAMPLED (40 rows each ✓✓), and a sample that happens
  // to be forty `calls` rows says NOTHING about the `overrides` label ✗✗ — which
  // is exactly what happened on the first run of this probe: the per-label counts
  // said `overrides` 4 against 329 ✓✓ and the samples showed nothing ✗✗, because
  // the sample was capped and the difference was not in it ✗✗.
  //
  // **A CONTROL THAT CANNOT SEE ITS OWN DIFFERENCE IS BLIND ✓✓ — SO THE DIFFERENCE IS
  // COUNTED PER LABEL ✓✓, IN FULL ✓✓, WITH SAMPLES BESIDE EACH COUNT ✓✓.** The count
  // is the measurement ✓✓; the samples are the reader's way into it ✓✓.
  byLabel: labels.map((l) => {
    // The sample line is `<repo>/<rel>  <label>|<from>|<target>` — the LABEL IS THE
    // KEY'S FIRST FIELD ✓✓, not a field between pipes ✓✓, and the first version of
    // this filter looked for it between pipes ✓✓ and so counted ZERO for every
    // label ✓✓ while the per-label counts said `overrides` 4 against 329 ✓✓.
    // **A CONTROL THAT FILTERS WRONGLY IS WORSE THAN NO CONTROL ✓✓, because it
    // reports a difference of zero where there is one ✓✓.**
    const labelOf = (r: string): string => {
      const keyPart = r.slice(r.indexOf("  ") + 2)
      return keyPart.split("|")[0] ?? ""
    }
    const inLane = onlyLane.filter((r) => labelOf(r) === l)
    const inDiff = onlyDiff.filter((r) => labelOf(r) === l)
    return {
      label: l,
      onlyInLaneOracle: { count: inLane.length, samples: inLane.slice(0, 12) },
      onlyInDifferentialOracle: { count: inDiff.length, samples: inDiff.slice(0, 12) },
    }
  }),
  verdict: onlyLane.length === 0 && onlyDiff.length === 0
    ? "THE TWO ORACLES AGREE on every admitted file — the lane's measurement transfers to the D4 as it stands"
    : "THE TWO ORACLES DISAGREE — the lane's measurement does NOT transfer, and the Lead's two-line edit must point at the reconciled oracle",
}
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")

console.log(`PARITY over ${chosen.length} file(s) (parsed ${parsed}, threw ${threw})`)
console.log(`  label          lane oracle   differential oracle`)
for (const l of labels) {
  console.log(`  ${l.padEnd(14)}${String(lane.get(l) ?? 0).padStart(10)}${String(diff.get(l) ?? 0).padStart(22)}`)
}
console.log(`  only in the LANE's oracle      : ${onlyLane.length}`)
console.log(`  only in the DIFFERENTIAL's      : ${onlyDiff.length}`)
console.log(`  ${out.verdict}`)
console.log(`WROTE ${OUT}`)
