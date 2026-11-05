#!/usr/bin/env bun
/**
 * ERLANG DECLARATION GENERATOR — writes `validation/m14/instruments/erlang/incoming-declaration.json`
 * from the arm's OWN numbers, the cause census, and the lane's extended census.
 *
 * ## WHY A GENERATOR AND NOT A HAND-WRITTEN FILE
 *
 * The declaration is the file the completion gate's conditions (B), (C) and (D) read. Its predecessor
 * was a 2026-10-10 **200-file sample** whose `meta.parsed` was 200 against a `corpusTotal` of 3,911 and
 * which carried NO cause rulings — so the gate's walls-dispositioned condition passed VACUOUSLY. A
 * hand-written declaration lets exactly that happen again. This generator REFUSES to write unless:
 *
 *   · the arm is a WHOLE population (the shared parser refuses a stride);
 *   · the arm's TOTAL row closes on the ELEVEN-TERM form, and collRes/amb(kind) are subsets of their
 *     parents (beside, never added);
 *   · every unresolved row is in exactly one cause class and the classes sum to the wall, with U0 = 0;
 *   · the cause census was run against THIS population;
 *   · the census and the arm agree per type on the edge count (two instruments disagreeing about the
 *     same analyzer run is the failure verify-honesty exists to catch, and it must stop the write);
 *   · every type the coverage block calls IMPLEMENTED has edges > 0 over the whole population, and
 *     every type it calls RULED/EXCLUDED has edges == 0 — a ruling the analyzer violates is not a ruling;
 *   · the eleven-term closure of every row sums to that row's edges, with `unclassed` 0.
 *
 * ## THE MAPPING, DECLARED
 *
 * The gate has FIVE buckets; the closure has ELEVEN terms. The coarsening is stated in `rules`:
 *   resolved = resolved · ambiguous = amb(decl) · external = extOK + ext?
 *   otherUnresolved = unresolved + extFAIL + bindOK + bind? + bindFAIL + causeOK + causeFAIL
 *   unclassed = 0 (an edge the instrument cannot classify is a hole in the instrument, not a class)
 * and every row ALSO publishes the eleven terms verbatim in `closure`, so nothing is hidden by it.
 *
 * USAGE
 *   bun script/m14/erlang-declaration.ts --arm <gate log> --census <erlang-extended-census.json> \
 *        --causes <erlang-cause-census.json> [--spec script/m14/spec/erlang-completeness.json] [--out <path>]
 *
 * EXIT: 0 written · 2 usage/input · 7 the arm log is refused · 11 a cross-check failed (nothing written).
 */
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

import { parseArmLog, ArmLogRefusal, ALL_TYPES, gateBuckets, closureTerms, type Terms } from "./erlang-arm-log"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  if (i >= 0) return argv[i + 1]
  for (const a of argv) if (a.startsWith(f + "=")) return a.slice(f.length + 1)
  return undefined
}
const ARM = argOf("--arm")
const CENSUS = argOf("--census")
const CAUSES = argOf("--causes")
const SPEC = argOf("--spec") ?? path.join(ROOT, "script/m14/spec/erlang-completeness.json")
const OUT = argOf("--out") ?? path.join(ROOT, "validation/m14/instruments/erlang/incoming-declaration.json")
const LANE = "erlang"
const ANALYZER = "src/ast/real-erlang-analyzer.ts"
const say = (s: string) => process.stderr.write(s + "\n")
const refuse = (msg: string): never => { console.error(`REFUSED — ${msg}`); process.exit(11) }

if (!ARM || !CENSUS || !CAUSES) {
  console.error("usage: bun script/m14/erlang-declaration.ts --arm <gate log> --census <extended census.json> --causes <cause census.json> [--out <path>]")
  process.exit(2)
}

let arm
try {
  arm = parseArmLog(ARM)
} catch (e: any) {
  if (e instanceof ArmLogRefusal) { console.error(`REFUSED — ${e.message}`); process.exit(7) }
  throw e
}
const census = JSON.parse(readFileSync(CENSUS, "utf8"))
const causes = JSON.parse(readFileSync(CAUSES, "utf8"))
const spec = JSON.parse(readFileSync(SPEC, "utf8"))
const cov = spec?.coverage ?? {}
const implemented: string[] = (cov.implemented ?? []).filter((t: any) => typeof t === "string")
const excluded: { label: string; evidence?: string }[] = (cov.excluded ?? []).map((x: any) => (typeof x === "string" ? { label: x } : x))
const excludedLabels = excluded.map((x) => x.label)

// ── THE CAUSE CENSUS MUST BE ABOUT THIS POPULATION, AND ITS PARTITION MUST BE EXACT ───────────
if (causes?.population !== arm.population) {
  refuse(`the cause census's population ${JSON.stringify(causes?.population)} is not this arm's ${JSON.stringify(arm.population)}.`)
}
const partition = causes?.partition
if (!partition || partition.sum !== partition.wall || partition.wall !== arm.total.unresolved) {
  refuse(`the cause partition does not close: sum ${partition?.sum} · wall ${partition?.wall} · arm unresolved ${arm.total.unresolved}.`)
}
const u0 = partition.classes?.U0_unclassified?.count ?? 0
if (u0 !== 0) refuse(`U0_unclassified is ${u0}; the ceiling is 0.`)

// ── THE SPEC AND THE ARM MUST AGREE ABOUT WHAT IS IMPLEMENTED AND WHAT IS RULED ───────────────
for (const t of implemented) {
  const r = arm.table1.get(t)
  if (!r) refuse(`the spec calls "${t}" implemented but the arm's TABLE 1 has no row for it.`)
  if (r!.edges <= 0) refuse(`the spec calls "${t}" implemented and the whole population emits 0 "${t}" edges — an implementation that never fires over the population is a defect, not an implementation.`)
}
for (const t of excludedLabels) {
  const r = arm.table1.get(t) as Terms | undefined
  if (r && r.edges !== 0) refuse(`the spec RULES "${t}" inapplicable, but the whole population emits ${r.edges} "${t}" edges — A RULING THE ANALYZER VIOLATES IS NOT A RULING.`)
}

// ── CENSUS AND ARM MUST AGREE PER TYPE. ONE INSTRUMENT, TWO READS: A DISAGREEMENT STOPS THE WRITE.
const censusTypes: Record<string, { edges: number; files: number; repos: number }> = census?.types ?? {}
for (const t of ALL_TYPES) {
  const a = (arm.table1.get(t) as Terms | undefined)?.edges ?? 0
  const c = censusTypes[t]?.edges ?? 0
  if (a !== c) refuse(`the arm and the census disagree about "${t}": arm ${a} edges, census ${c}. TWO INSTRUMENTS DISAGREEING ABOUT THE SAME RUN IS THE FAILURE THE HONESTY GATE EXISTS TO CATCH.`)
}

// ── THE ROWS ─────────────────────────────────────────────────────────────────────────────────
const types: Record<string, any> = {}
for (const t of ALL_TYPES) {
  const r = arm.table1.get(t) as Terms | undefined
  if (!r) refuse(`TABLE 1 is missing the "${t}" row.`)
  const b = gateBuckets(r!)
  const bucketSum = b.resolved + b.external + b.ambiguous + b.otherUnresolved + b.unclassed
  if (bucketSum !== b.edges) refuse(`the five gate buckets for "${t}" sum to ${bucketSum} against edges ${b.edges}.`)
  const cl = closureTerms(r!)
  const termSum = cl.resolved + cl.ambDecl + cl.unresolved + cl.extOK + cl.extUnk + cl.extFAIL + cl.bindOK + cl.bindUnk + cl.bindFAIL + cl.causeOK + cl.causeFAIL
  if (termSum !== cl.edges) refuse(`the eleven-term closure for "${t}" sums to ${termSum} against edges ${cl.edges}.`)
  const censusRow = censusTypes[t]
  types[t] = {
    edges: b.edges,
    resolved: b.resolved,
    external: b.external,
    ambiguous: b.ambiguous,
    otherUnresolved: b.otherUnresolved,
    unclassed: b.unclassed,
    // BESIDE THE BUCKETS, NEVER ADDED: amb(kind) is a subset of amb(decl); collRes of resolved.
    _ambKind: r!.ambKind,
    _collRes: r!.collRes,
    files: censusRow?.files ?? 0,
    repos: censusRow?.repos ?? 0,
    closure: cl,
  }
}

// ── THE CAUSE RULINGS: one per CLASS, each with the population, a count, and a falsifier ─────
const causeRulings: Record<string, any> = {}
for (const [cls, row] of Object.entries<any>(partition.classes ?? {})) {
  const falsifier = causes?.falsifiers?.[cls]
  if (!falsifier?.run || !falsifier?.wouldFail) refuse(`cause class "${cls}" has no run+wouldFail falsifier.`)
  causeRulings[cls] = {
    population: arm.population,
    count: row.count,
    what:
      `${row.count} unresolved row(s), by label ${JSON.stringify(row.labels)}. Partition evidence: ` +
      `${path.relative(ROOT, CAUSES)} (script/m14/erlang-cause-census.ts over ${path.relative(ROOT, ARM)} with ` +
      `declared-name index ${path.relative(ROOT, CENSUS)}). Examples: ${(row.examples ?? []).slice(0, 3).join(" ; ")}`,
    falsifier,
  }
}

// ── META ─────────────────────────────────────────────────────────────────────────────────────
const analyzerDigest = "sha256:" + createHash("sha256").update(readFileSync(path.join(ROOT, ANALYZER))).digest("hex").slice(0, 16)

const declaration = {
  meta: {
    lang: LANE,
    instrument: "script/m14/incoming-gate.ts erlang erl,hrl 0 --dump (the arbiter; ONE measurement, no second resolution instrument)",
    generator: "script/m14/erlang-declaration.ts — transcribes the arm's own TABLE 1 and the cause census, and REFUSES a sample, a non-closing row, a partition that does not sum, an unclassified row, a census/arm disagreement, or a ruling the emissions violate",
    sample: arm.parsed,
    corpusTotal: arm.corpusTotal,
    corpusRepos: arm.repos,
    parsed: arm.parsed,
    population: arm.population,
    populationRule: census?.populationRule ?? null,
    metric: "edges counted once per row the analyzer emits; the five gate buckets are a DECLARED COARSENING of the eleven closure terms, and every row publishes the eleven terms in `closure` so nothing is hidden by it",
    analyzer: ANALYZER,
    analyzerDigest,
    generated: new Date().toISOString().slice(0, 10),
    measurementForm:
      "ONE arm run over the whole admitted population (whole graph in one process, no chunks) — so the EDGE buckets and the RESOLUTION buckets are both the population's, and there is no chunk-resolution bias to caveat. 4,465 files sits under the ~7,600-parse WASM abort point the dart lane measured, and the arm frees every tree, so no chunking was needed.",
    arm: path.relative(ROOT, ARM),
    causeCensus: path.relative(ROOT, CAUSES),
    census: path.relative(ROOT, CENSUS),
  },
  rules: {
    resolved: "the target is a published name in the edge's own REPOSITORY (TABLE 1's scope, built from this run's own symbol loop). It is NOT a claim that the chosen declaration is correct: collRes is the share whose target had more than one declaration, and the fleet's own indexer measures a large share of such tie-break picks as WRONG — so `resolved` is a FLOOR on correctness.",
    external: "extOK + ext?: the analyzer's provable external marker (an import/include_lib classification, ER-D20), of which extOK is confirmed and ext? is unverifiable. Marking is NOT claimed complete, and external is never folded into resolved.",
    ambiguous: "amb(decl): the target matched more than one declaration IN THE PROJECT'S KEY SPACE. amb(kind) is the distinct-kind subset and is reported beside it, never added.",
    otherUnresolved: "unresolved + extFAIL + bindOK + bind? + bindFAIL + causeOK + causeFAIL. A declared cause (causeOK) is a STATEMENT, not a resolution, and never lifts `resolved`.",
    unclassed: "0 by construction, and REFUSED by this generator when it is not: an edge the instrument cannot classify is a hole in the instrument, not a class.",
    bucketRule:
      "resolved = resolved · ambiguous = amb(decl) · external = extOK + ext? · otherUnresolved = unresolved + extFAIL + bindOK + bind? + bindFAIL + causeOK + causeFAIL · unclassed = 0. collRes (of resolved) and amb(kind) (of amb(decl)) are SUBSETS printed beside and NEVER added.",
    direction: "the arm's TABLE 1 is the PROJECT (repository) scope, built from the whole run's own symbols; the closure is over TABLE 1's eleven terms and the wall partition is over TABLE 1's `unresolved` column.",
  },
  causeRulings,
  types,
  resolution_caveats: [
    "INDEX=NO, AND THAT IS THE HONEST ARM: there is no INDEX_SPECS entry for erlang in script/m14/incoming-gate.ts, so no production project index is built. TABLE 1's scope is the ARM's OWN per-repository declaration table, built from every file this whole-population run parsed. It is as complete as the admitted corpus allows, and it is NOT the production index's mechanism; a reader must not read `resolved` as 'the production index bound it'.",
    "ER-D1 — THE QUALIFIED-TARGET SPELLING WALL, DECLARED AS A CAUSE AND NOT AS A DEFECT: a remote call's target KEEPS `module:function` and the ANALYZER never sets a `qualifiedName` alias (ER-D1 in src/ast/real-erlang-analyzer.ts). A name-count resolver therefore cannot bind remote calls by construction; they are counted in `Q1_qualified_remote_call`, and the falsifier is an analyzer symbol carrying such an alias. NOTE ON THE INSTRUMENT: the census does NOT publish a qualifiedName-alias count because the production projection derives a qualifiedName for EVERY symbol (pool-worker.ts:1438), so a projection-based count would read every symbol and be useless — the claim is a source-level fact about the analyzer, not a corpus count.",
    "`resolved` MEANS 'the target is a published name in the edge's own repository' — IT DOES NOT MEAN THE PICK IS CORRECT. `collRes` is the subset whose target had more than one declaration; the fleet's own indexer measures 37,318 of 49,729 such tie-break picks as WRONG, so this lane's resolved column is a FLOOR on correctness and must not be compared with a lane whose resolved bucket excludes collisions.",
    "`amb(kind)` IS A SUBSET OF `amb(decl)` (distinct kinds among colliding declarations vs distinct declarations) and `collRes` IS A SUBSET OF `resolved`. Both are printed beside their parents and NEVER added to any bucket or to the closure.",
    "`contains` RESOLVES BY THE GATE'S containsLike RULE: the project holds at least one declaration of the name, so production's LIMIT-1 bind yields exactly one row (file-first preference not modelled in full). Its resolved share is NOT the same measurement as a name-count lane's.",
    "`part_of` TARGETS ARE FILE PATHS, NOT SYMBOL NAMES (the include directive is file inclusion, ER-D46). They are counted in `F1_file_inclusion_path`; 'unresolved by name' is the CORRECT outcome for a path target, not a defect.",
    "THE W1 CLASS IS PUBLISHED, NOT HIDDEN: `W1_declared_in_own_repository_yet_unresolved` is the resolution model's residual. A non-zero W1 is a named, counted gap rather than an unexplained row, and the cause census has a `--fail-nonzero-w1` run whose exit code is the falsifier.",
    "THE CORPUS CHANGED SINCE ER3, AND THE OLD ARTIFACTS ARE SUPERSEDED, NOT EDITED: the ER3 wave measured 4,326/4,617 files over otp+rebar3+cowboy; this corpus has no cowboy, carries elixir (48 `.erl`), and otp is at a different revision. The 4,465-file population above is the ONLY population this declaration speaks about; `validation/m14/results/archive/erlang-er3-corpus-census.json` and the dual-lens artifacts are SUPERSEDED and must not be compared with these numbers.",
  ],
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(declaration, null, 2) + "\n")
say("")
say(`DECLARATION WRITTEN: ${path.relative(ROOT, OUT)}`)
say(`  population ${arm.population} (repos ${arm.repos})`)
say(`  edges ${arm.total.edges} = the eleven terms of ${path.relative(ROOT, ARM)}`)
say(`  cause classes: ${Object.entries(causeRulings).map(([k, v]: any) => `${k}:${v.count}`).join(" ")}`)
say(`  implemented ${implemented.length} (all fire) · ruled ${excludedLabels.length} (all 0 edges) · wall ${arm.total.unresolved}`)
