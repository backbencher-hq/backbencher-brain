#!/usr/bin/env bun
/**
 * CLEAN lane — the differential's residual, ADJUDICATED BY CLASS.
 *
 * The differential's `missing`/`unexplained` are not a defect count: they are the gap between the
 * lane's analyzer and the lane's OWN oracle, and a floor for section E must name the classes that
 * gap consists of before an owner can rule on it. This instrument reads the differential's own
 * sample dump (`BB_F5_SAMPLES_JSON`, every row, not the printed 40) and classifies each row by the
 * DECLARED KIND of the target in the row's own project:
 *
 *   - MISSING `instantiates` — the oracle's lexical rule (an uppercase application is a constructor
 *     application) against the analyzer's resolution. A target declared `function`/`method` is an
 *     UPPERCASE FUNCTION, and labelling it instantiation is the ORACLE's error, not a missing edge.
 *   - UNEXPLAINED `references` — a type mention the oracle does not derive. `type` targets are the
 *     signature-type class; a function target would be a different finding.
 *   - UNEXPLAINED `calls` — the same split in the other direction, plus the label-pair count (a row
 *     whose (from,target) also appears as MISSING `instantiates`: the two sides agree an edge exists
 *     and disagree only on its label).
 *   - UNEXPLAINED `overrides` — the lane DECLARES no overrides truth (`label_coverage.declared_no_truth`),
 *     so these are a declared gap, counted apart rather than called a fabrication.
 *   - UNEXPLAINED `implements` — class-like targets vs others.
 *
 * Usage:
 *   BB_F5_SAMPLE_CAP=5000 BB_F5_SAMPLES_JSON=/tmp/clean-diff.json bun run script/m14/differential.ts --lang clean
 *   bun validation/m14/fixtures/clean/differential-adjudication.mts --json=/tmp/clean-diff.json \
 *       --out=validation/m14/measurements/clean/differential-adjudication-2026-10-29.json
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../../src/ast/pool-worker"

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const IN = arg("json")
const OUT = arg("out")
const CORPUS = arg("corpus") ?? process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
if (!IN) {
  console.error("usage: --json=<BB_F5_SAMPLES_JSON dump> [--out=<file>]")
  process.exit(2)
}

type Kind = "constructor" | "function" | "type" | "other" | "not-declared"
const CONSTRUCTOR = new Set(["constructor", "enum_member", "case_function"])
const FUNCTION = new Set(["function", "method"])
const TYPE = new Set(["type", "class", "interface", "trait", "struct", "enum", "generic", "type_alias", "abstract_class", "protocol"])

const kindOf = (kind: string): Kind => {
  const k = kind.toLowerCase()
  if (CONSTRUCTOR.has(k)) return "constructor"
  if (FUNCTION.has(k)) return "function"
  if (TYPE.has(k)) return "type"
  return "other"
}

/** repo root -> symbol name -> kinds declared anywhere in that project */
const projectKinds = new Map<string, Map<string, Set<string>>>()

async function kindsFor(repoRoot: string): Promise<Map<string, Set<string>>> {
  const hit = projectKinds.get(repoRoot)
  if (hit) return hit
  const m = new Map<string, Set<string>>()
  projectKinds.set(repoRoot, m)
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 26 })
      .split("\0").filter((f) => /\.(icl|dcl)$/.test(f))
  } catch { return m }
  for (const rel of tracked) {
    let r: any
    try { r = await parseFile(path.join(repoRoot, rel), repoRoot, { projectRoot: repoRoot } as any) } catch { continue }
    for (const s of r?.symbols ?? []) {
      const n = String(s?.name ?? "")
      if (!n) continue
      let set = m.get(n)
      if (!set) m.set(n, (set = new Set()))
      set.add(String(s?.kind ?? ""))
    }
  }
  return m
}

const dump = JSON.parse(fs.readFileSync(IN, "utf8"))
const out: any = { instrument: "validation/m14/fixtures/clean/differential-adjudication.mts", corpus: CORPUS, lanes: {} }

for (const [lane, v] of Object.entries<any>(dump)) {
  const repo = lane.split(":")[0]
  const repoRoot = path.join(CORPUS, repo)
  const kinds = await kindsFor(repoRoot)
  const classify = (target: string): Kind => {
    const ks = kinds.get(target)
    if (!ks || ks.size === 0) return "not-declared"
    // ONE target, ONE class. A name declared under two different kinds (a constructor and a
    // function of the same spelling, an instance member beside its class) is `other` — the row's
    // own pair cannot be assigned from a name alone, and guessing one would be the defect this
    // instrument exists to avoid.
    const kindsSet = new Set([...ks].map(kindOf))
    if (kindsSet.size !== 1) return "other"
    return [...kindsSet][0] as Kind
  }
  const rows = [...(v.samples ?? []), ...(v.heuristicSamples ?? [])]
  const pairs = new Set(rows.filter((r: any) => r.dir === "MISSING" && r.label === "instantiates").map((r: any) => `${r.from}|${r.target}`))
  const buckets: any = {}
  for (const r of rows) {
    const key = `${r.dir}/${r.label}`
    // NO PROTOTYPE: a plain `{}` makes `byTargetKind["constructor"]` resolve to `Object` (the
    // constructor FUNCTION), so the constructor bucket counted `function Object() { [native code] }1`
    // — the first form of this instrument published that. A null-prototype map has no inherited keys.
    const b = (buckets[key] ??= { rows: 0, byTargetKind: Object.create(null) as Record<string, number>, labelPair: 0, examples: [] as string[] })
    b.rows++
    const k = classify(r.target)
    b.byTargetKind[k] = (b.byTargetKind[k] ?? 0) + 1
    if (r.dir === "UNEXPLAINED" && r.label === "calls" && pairs.has(`${r.from}|${r.target}`)) b.labelPair++
    if (b.examples.length < 6) b.examples.push(`${r.file} ${r.from ?? "?"} -> ${r.target}`)
  }
  out.lanes[lane] = {
    files: v.files,
    row: v.row,
    buckets,
    declaredNoTruth: lane.startsWith("Clyde") || lane.startsWith("clean-stdlib") ? "clean's spec declares `overrides` no-truth, so UNEXPLAINED/overrides is a declared gap" : undefined,
  }
}

console.log("CLEAN differential adjudication — rows classified by the target's declared kind")
for (const [lane, v] of Object.entries<any>(out.lanes)) {
  console.log(`\n== ${lane}  files=${v.files}  missing=${v.row.missingInAnalyzer} unexplained=${v.row.unexplainedInAnalyzer}`)
  for (const [key, b] of Object.entries<any>(v.buckets).sort((a, b) => b[1].rows - a[1].rows)) {
    const kinds = Object.entries(b.byTargetKind).sort((a: any, b: any) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(" ")
    console.log(`  ${key.padEnd(26)} ${String(b.rows).padStart(4)}  ${kinds}${b.labelPair ? `  label-pair=${b.labelPair}` : ""}`)
    for (const e of b.examples.slice(0, 3)) console.log(`      ${e}`)
  }
}
if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`\nreceipt: ${OUT}`)
}
