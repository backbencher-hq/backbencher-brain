// script/m60/measure-grammar-recovery.ts — measure what SURVIVES a parse error.
//
// WHY THIS INSTRUMENT EXISTS. Adjudicating tree-sitter-sql's first candidate
// (@l1xnan 0.4.7, reviews/m60-sql-grammar-l1xnan-047-refused.md) produced a finding
// the gate chain had no way to state:
//
//   For a grammar that already fails on most of its corpus, error RECOVERY is the
//   product. A file that does not parse is not a file the analyzer skips — the
//   structure that survives recovery is the only output there will ever be.
//
// and a finding about the gate chain itself:
//
//   No gate measures recovery. F10 counts damaged files. F1 checks that node NAMES
//   exist in the grammar. F11's G1 counts sites and error lines. G2 inspects only
//   files clean under BOTH grammars, so on a badly-damaged lane it is nearly blind.
//   G3 measures the analyzer's output and caught the sql candidate — but by ordering,
//   not by design, and only after a full A/B.
//
// The refused candidate IMPROVED the count-level metrics on one of its two corpora
// (sites 2504→2271, MISSING 19→17) while destroying 84 symbols and 150
// relationships. Counting cannot tell those apart. This instrument can, and it costs
// one parse per file per grammar — no analyzer run, no fixtures.
//
// THE MEASUREMENT. Files are split by whether the PINNED grammar already damages
// them, because the two populations mean different things:
//
//   clean-under-pinned  the grammar is not the bottleneck; a candidate can only
//                       re-shape these, and that is G2's job, not this one's.
//   damaged-under-pinned  everything the product will ever know about these files
//                       IS the recovery. So the metric is the count of SURVIVING
//                       named nodes, per structural category, on this population.
//
// A candidate that improves error counts while collapsing surviving structure is
// the failure this exists to catch, and on the damaged population it is visible
// without running the analyzer at all.
//
// IT IS NOT A GATE. Nothing here is pass/fail, because "how much structure is
// enough" is a judgement the F11 gates make against an analyzer's real output. This
// is a screening signal, cheap enough to run on every candidate of every lane, and
// it is the column the survey's `aheadCandidates` ranking was missing.
//
// AGGREGATE COUNTS ARE THE WRONG STATISTIC, and this instrument's first version
// proved it by being validated against an already-adjudicated verdict. Run against
// the refused @l1xnan 0.4.7 on the same 314 damaged files, the aggregate read
// "no collapse": named nodes -1.4%, identifiers -3.3%, members -4.6%. F11, on the
// same candidate and the same files, found 100 symbols VANISHED and 245 pairs LOST
// — and reported "files changed 37". The two are consistent only if the loss is
// CONCENTRATED: roughly one file in nine collapses and the rest are untouched, and
// a mean over 314 files cannot see that. So the summary statistics here are the
// DISTRIBUTION — how many files lose material structure, and the worst of them —
// with the aggregate kept only for contrast. A screening signal that averages away
// the failure it exists to catch is a decoration.
//
// PROVENANCE OF THE CORPUS LIST. Read out of script/m14/verify-grammar-leaves.ts's
// own `LANES` map by parsing it, not copied. A screening instrument that silently
// measured a different corpus than the gate it is screening for would be worse than
// none, and a hand-maintained second list is exactly the drift this milestone
// closed. A lane absent from LANES is refused rather than defaulted.
//
// Usage:
//   bun run script/m60/measure-grammar-recovery.ts --lang sql --candidate /path/cand.wasm
//   bun run script/m60/measure-grammar-recovery.ts --lang sql --candidate /path/cand.wasm --repo postgrest
//   bun run script/m60/measure-grammar-recovery.ts --lang sql --candidate /path/cand.wasm --json
//
// Writes: nothing. Read-only, no tree mutation, safe to run against a live tree.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const argv = process.argv.slice(2)
const argValue = (a: string, d?: string) => (argv.includes(a) ? argv[argv.indexOf(a) + 1] : d)
const AS_JSON = argv.includes("--json")
const LANG = argValue("--lang")!
const CANDIDATE = argValue("--candidate")!
const ONLY_REPO = argValue("--repo")
const SAMPLE = parseInt(argValue("--sample", "400")!, 10)

if (!LANG || !CANDIDATE || !existsSync(CANDIDATE)) {
  console.error("usage: measure-grammar-recovery.ts --lang <lane> --candidate <wasm> [--repo X] [--sample N] [--json]")
  process.exit(2)
}

const F11 = path.join(ROOT, "script", "m14", "verify-grammar-leaves.ts")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

/** The lane's corpus list, read out of F11's LANES rather than duplicated. */
function f11Lane(lang: string): { wasm: string; repos: string[]; sample: number } {
  const src = readFileSync(F11, "utf8")
  const at = src.indexOf("const LANES")
  if (at < 0) throw new Error("measure-grammar-recovery: LANES not found in verify-grammar-leaves.ts")
  // Each entry is `  <lang>: { wasm: "...", repos: [...], sample: N },`
  const entry = new RegExp(`\\n\\s{2}"?${lang}"?:\\s*\\{([^}]*)\\}`).exec(src.slice(at))
  if (!entry) {
    throw new Error(
      `measure-grammar-recovery: lane "${lang}" has no entry in verify-grammar-leaves.ts LANES. ` +
        `Add it there first — this instrument reads the gate's corpus list rather than keeping its own, so a ` +
        `screening measurement can never be taken against a different corpus than the gate it screens for.`,
    )
  }
  const body = entry[1]
  const wasm = /wasm:\s*"([^"]+)"/.exec(body)?.[1]
  const repos = [...(/repos:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] as string)
  const sample = parseInt(/sample:\s*(\d+)/.exec(body)?.[1] ?? "400", 10)
  if (!wasm || repos.length === 0) throw new Error(`measure-grammar-recovery: could not read lane "${lang}"'s wasm/repos from F11`)
  return { wasm, repos, sample }
}

const lane = f11Lane(LANG)
const pinnedWasm = path.join(ROOT, lane.wasm)

// ---------------------------------------------------------------------------
// Content categories. Chosen because they are what an ANALYZER reads to emit
// symbols and relationships — a name, a member access, an argument, a call — and
// they are the counts that moved on the refused candidate. They are node TYPES, so
// this is grammar-agnostic and does not encode one grammar's vocabulary.
// ---------------------------------------------------------------------------
const CATEGORIES: Record<string, RegExp> = {
  identifiers: /^(identifier|type_identifier|field_identifier|property_identifier|statement_identifier|word|namespace_identifier)$/,
  members: /^(field_expression|member_expression|selector|attribute|field|property|object_reference|table_path)$/,
  calls: /^(call|invocation|function_call|method_invocation|command|macro_invocation)$/,
  terms: /^(term|literal|number_literal|string_literal|word_literal|_literal)$/,
  types: /^(type|type_identifier|type_annotation|predefined_type|sized_type_specifier|type_specifier)$/,
  blocks: /^(block|statement_block|declaration_list|compound_statement|body|field_list|class_body)$/,
}

await WTS.Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const pinnedLang = await WTS.Language.load(readFileSync(pinnedWasm))
const candLang = await WTS.Language.load(readFileSync(CANDIDATE))

function parse(lang: any, src: string) {
  const p = new (WTS.Parser as any)()
  p.setLanguage(lang)
  const t = p.parse(src)
  const cats: Record<string, number> = {}
  for (const k of Object.keys(CATEGORIES)) cats[k] = 0
  let errors = 0
  let missing = 0
  let named = 0
  const st: any[] = [t.rootNode]
  while (st.length) {
    const n = st.pop()
    named++
    if (n.type === "ERROR") errors++
    if (n.isMissing) missing++
    for (const [k, re] of Object.entries(CATEGORIES)) if (re.test(n.type)) cats[k]++
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) st.push(c)
    }
  }
  p.delete?.()
  return { errors, missing, named, cats, damaged: errors + missing > 0 }
}

type Row = { repo: string; rel: string; bytes: number; pinned: any; cand: any }
const rows: Row[] = []
const repos = ONLY_REPO ? [ONLY_REPO] : lane.repos

for (const repo of repos) {
  const dir = path.join(CORPUS, repo)
  if (!existsSync(dir)) {
    console.error(`measure-grammar-recovery: corpus ${repo} not under ${CORPUS} — skipped`)
    continue
  }
  // The product's own routing decides membership, exactly as F10 and F11 do it.
  const { detectLanguageFromPath } = await import("../../src/ast/language-detection")
  const files = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => detectLanguageFromPath(f) === LANG)
    .sort()
    .slice(0, SAMPLE)
  for (const rel of files) {
    const src = readFileSync(path.join(dir, rel), "utf8")
    rows.push({ repo, rel, bytes: src.length, pinned: parse(pinnedLang, src), cand: parse(candLang, src) })
  }
}

const sum = (rs: Row[], side: "pinned" | "cand") =>
  rs.reduce(
    (a, r) => {
      a.damaged += r[side].damaged ? 1 : 0
      a.errors += r[side].errors
      a.missing += r[side].missing
      a.named += r[side].named
      for (const k of Object.keys(CATEGORIES)) a.cats[k] += r[side].cats[k]
      return a
    },
    { damaged: 0, errors: 0, missing: 0, named: 0, cats: Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, 0])) } as any,
  )

// The split is the whole point: recovery only matters where the grammar already fails.
const cleanPinned = rows.filter((r) => !r.pinned.damaged)
const damagedPinned = rows.filter((r) => r.pinned.damaged)

const pct = (a: number, b: number) => (b === 0 ? null : Number(((100 * a) / b).toFixed(1)))

/** A file loses MATERIAL structure when its surviving named nodes drop by >= 25%. */
const MATERIAL_LOSS = 25

const block = (label: string, rs: Row[]) => {
  const p = sum(rs, "pinned")
  const c = sum(rs, "cand")
  // The distribution, which is the statistic that matters. Per-file deltas are
  // relative to that file's OWN pinned count, so a small file cannot be masked by a
  // large one and a large file cannot carry a small one.
  const perFile = rs
    .map((r) => {
      const base = r.pinned.named
      const delta = base === 0 ? 0 : Number((((r.cand.named - base) / base) * 100).toFixed(1))
      return { repo: r.repo, rel: r.rel, pinnedNamed: base, candNamed: r.cand.named, deltaPct: delta }
    })
    .sort((a, b) => a.deltaPct - b.deltaPct)
  const material = perFile.filter((f) => f.deltaPct <= -MATERIAL_LOSS)
  const gained = perFile.filter((f) => f.deltaPct > 0)
  return {
    population: label,
    files: rs.length,
    damagedPinned: p.damaged,
    damagedCandidate: c.damaged,
    errors: { pinned: p.errors, candidate: c.errors, deltaPct: pct(c.errors - p.errors, p.errors) },
    missing: { pinned: p.missing, candidate: c.missing, deltaPct: pct(c.missing - p.missing, p.missing) },
    // Aggregate, kept for contrast only — see the header. It is reported LAST and
    // never used for the verdict.
    aggregateNamedNodes: { pinned: p.named, candidate: c.named, deltaPct: pct(c.named - p.named, p.named) },
    aggregateStructure: Object.fromEntries(
      Object.keys(CATEGORIES).map((k) => [k, { pinned: p.cats[k], candidate: c.cats[k], deltaPct: pct(c.cats[k] - p.cats[k], p.cats[k]) }]),
    ),
    // The distribution — the verdict is computed from THIS.
    distribution: {
      materialLossThresholdPct: -MATERIAL_LOSS,
      filesLosingMaterialStructure: material.length,
      filesLosingMaterialStructurePct: pct(material.length, rs.length),
      filesGainingStructure: gained.length,
      medianFileDeltaPct: perFile.length ? perFile[Math.floor(perFile.length / 2)].deltaPct : null,
      worstFiles: perFile.slice(0, 12),
      worstFilesTruncated: Math.max(0, material.length - 12),
    },
  }
}

const report = {
  schemaVersion: 1,
  instrument: "m60-grammar-recovery",
  lang: LANG,
  pinned: { file: path.basename(pinnedWasm), bytes: readFileSync(pinnedWasm).length, nodeTypes: pinnedLang.nodeTypeCount },
  candidate: { file: path.basename(CANDIDATE), bytes: readFileSync(CANDIDATE).length, nodeTypes: candLang.nodeTypeCount },
  corpora: repos,
  corpusListSource: "script/m14/verify-grammar-leaves.ts LANES (parsed, not copied)",
  sample: { limit: SAMPLE, filesDrawn: rows.length },
  populations: [block("damaged-under-pinned (the recovery population)", damagedPinned), block("clean-under-pinned (G2's population, shown for contrast)", cleanPinned)],
  verdict: null as string | null,
  policy:
    "Screening signal, not a gate. It reports surviving named-node counts split by whether the PINNED grammar already damages the file, because on a damaged population that structure is the only output the product will ever have. It never renders pass/fail: 'enough structure' is F11's judgement against a real analyzer run, and this instrument exists to make candidate SELECTION predictive rather than retrospective. A candidate whose error counts improve while surviving structure on the damaged population collapses is the failure this was built to catch — it is the sql 0.4.7 case, where sites fell 2504->2271 and 84 symbols and 150 relationships were destroyed.",
}

const dmg = report.populations[0]
if (dmg.files > 0) {
  // The verdict reads the DISTRIBUTION, never the aggregate. On the refused
  // @l1xnan candidate the aggregate said -1.4% and the distribution says a ninth of
  // the files lost everything; a screening signal that averages away its own failure
  // is worse than no signal.
  const d = dmg.distribution
  const errDelta = dmg.errors.deltaPct ?? 0
  const n = d.filesLosingMaterialStructure
  const worst = d.worstFiles[0]
  report.verdict =
    n > 0 && errDelta > -5
      ? `SUSPECT — ${n}/${dmg.files} file(s) (${d.filesLosingMaterialStructurePct}%) on the recovery population lose >=${d.materialLossThresholdPct}% of their surviving structure, while the aggregate moves only ${dmg.aggregateNamedNodes.deltaPct ?? "?"}% and errors move ${errDelta > 0 ? "+" : ""}${errDelta}%. That is the sql-0.4.7 signature exactly: the count-level view is flat or better while the product's only output collapses on the files it collapses on. Worst: ${worst?.rel} (${worst?.pinnedNamed} -> ${worst?.candNamed} named nodes). Adjudicate with F11.`
      : n > 0
        ? `SUSPECT — ${n}/${dmg.files} file(s) lose >=${d.materialLossThresholdPct}% of their structure on the recovery population. Worst: ${worst?.rel}. Adjudicate with F11.`
        : `no concentrated recovery loss — ${d.filesGainingStructure} file(s) gained structure, median per-file delta ${d.medianFileDeltaPct}%. F11 still decides.`
}

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`grammar recovery — ${LANG}: ${path.basename(pinnedWasm)} (${report.pinned.nodeTypes} types) vs ${path.basename(CANDIDATE)} (${report.candidate.nodeTypes} types)`)
  console.log(`corpora: ${repos.join(", ")}  (list read from ${report.corpusListSource})\n`)
  for (const pop of report.populations) {
    console.log(`${pop.population}`)
    console.log(`  files ${pop.files}   damaged ${pop.damagedPinned} -> ${pop.damagedCandidate}   errors ${pop.errors.pinned} -> ${pop.errors.candidate} (${pop.errors.deltaPct > 0 ? "+" : ""}${pop.errors.deltaPct ?? "?"}%)`)
    const dd = pop.distribution
    console.log(`  DISTRIBUTION (the verdict reads this):`)
    console.log(`    files losing >=${dd.materialLossThresholdPct}% of their structure : ${dd.filesLosingMaterialStructure}/${pop.files}  (${dd.filesLosingMaterialStructurePct ?? "?"}%)`)
    console.log(`    files gaining structure                    : ${dd.filesGainingStructure}`)
    console.log(`    median per-file delta                      : ${dd.medianFileDeltaPct > 0 ? "+" : ""}${dd.medianFileDeltaPct ?? "?"}%`)
    for (const f of dd.worstFiles.slice(0, 6)) {
      console.log(`      ${String(f.deltaPct).padStart(7)}%  ${f.pinnedNamed} -> ${f.candNamed}  ${f.repo}/${f.rel}`)
    }
    if (dd.worstFilesTruncated) console.log(`      ... and ${dd.worstFilesTruncated} more`)
    console.log(`  aggregate (CONTRAST ONLY — it averaged away the refused candidate):`)
    console.log(`    named nodes ${pop.aggregateNamedNodes.pinned} -> ${pop.aggregateNamedNodes.candidate} (${pop.aggregateNamedNodes.deltaPct > 0 ? "+" : ""}${pop.aggregateNamedNodes.deltaPct ?? "?"}%)`)
    for (const [k, v] of Object.entries(pop.aggregateStructure as any)) {
      console.log(`      ${k.padEnd(12)} ${String(v.pinned).padStart(6)} -> ${String(v.candidate).padStart(6)}  ${String(v.deltaPct > 0 ? "+" : "") + (v.deltaPct ?? "?") + "%"}`)
    }
    console.log("")
  }
  console.log(`  ${report.verdict}`)
}
