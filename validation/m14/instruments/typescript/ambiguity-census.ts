/**
 * AMBIGUITY CENSUS — per-type counts of edges whose endpoints do not resolve to
 * real symbols, on a real corpus, through the PRODUCTION path.
 *
 * ## Why this file exists
 *
 * An edge that names nothing is not a small defect. `bb_graph` answers "what
 * calls this" by walking stored edges; an edge whose target binds to no symbol
 * is an edge that answers with a name a consumer must resolve again, and the
 * second resolution is the one that guesses. `bb_impact` walks the reverse of
 * the same edges, so an unresolvable endpoint is a place where the impact set
 * is silently smaller than the truth. The programme-wide question this census
 * answers is therefore not "how many edges" but, PER TYPE, "of the edges this
 * type emits, how many have both endpoints bound to a symbol that actually
 * exists".
 *
 * The measurement is per type because the ratio is a property of the TYPE, not
 * of the file. `contains` is computed from `ownerName` on symbols the analyzer
 * just published, so it resolves by construction. `calls` reduces a callee to a
 * leaf name, so its target is a NAME and resolution depends on whether anything
 * in scope declares that name. One pooled percentage would average a type that
 * cannot fail with a type that usually cannot succeed, and hide both.
 *
 * ## Comparable across languages
 *
 * The AMBIGUITY_FLEET lane runs this same instrument shape over other analyzers.
 * Three things are held fixed so the numbers are comparable, and each one is a
 * decision that could otherwise silently differ:
 *
 *   1. PRODUCTION PATH. `getParser` -> `parser.parse` -> `analyzer.analyze`,
 *      the same sequence `pool-worker.ts` runs. Not `analyze()` on a hand-built
 *      node, and not a re-implementation of the walk.
 *   2. TWO SCOPES, BOTH REPORTED, NEVER MIXED. WITHIN-FILE resolves an endpoint
 *      against the symbols that same `analyze()` call published. CORPUS resolves
 *      it against every symbol published by every file in this run. These answer
 *      different questions and a percentage over their union is not a number
 *      about anything — so the table prints both, and the gap between them is
 *      itself reported (it is the cross-file reach, which is a fact about the
 *      corpus, not about the analyzer).
 *   3. THE POPULATION IS DERIVED, NOT WRITTEN DOWN. `collectFiles` walks the
 *      corpus directory. A hand-written `FILES = [...]` array rots silently: a
 *      file added beside it is never scanned, and the instrument keeps reporting
 *      its number with total confidence. Every table here prints the population
 *      it counted over, next to the count, per the standing rule in
 *      docs/M14-HONESTY-CONTRACT.md ("an instrument must declare the population
 *      it covered").
 *
 * ## No regex
 *
 * The signal filter is `String.includes` on declaration keywords, which cannot
 * match inside a comment as a false POSITIVE can be constructed to, and every
 * structural decision is made from `node.type` on the tree-sitter AST. There is
 * not one regular expression in this file, and `script/m14/no-regex-gate.sh`
 * is the check for that claim.
 *
 * ## Usage
 *
 *   bun validation/m14/fixtures/typescript/ambiguity-census.ts [nfiles]
 *
 * Environment:
 *   BB_TS_CORPUS   corpus root            (default /home/ishaq2321/bb_tests/repositories)
 *   BB_TS_REPO     corpus subdirectory    (default element-plus)
 *   BB_TS_SAVE     write JSON to this path
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { getParser } from "../../../../src/ast/engine"
import { RealTypeScriptAnalyzer } from "../../../../src/ast/real-typescript-analyzer"

const CORPUS_ROOT = process.env.BB_TS_CORPUS ?? "/home/ishaq2321/bb_tests/repositories"
const CORPUS_DIR = process.env.BB_TS_REPO ?? "element-plus"
const NFILES = Number(process.argv[2] ?? process.env.NFILES ?? 400)
const SAVE = process.env.BB_TS_SAVE

const DIR = join(CORPUS_ROOT, CORPUS_DIR)
const EXTS = [".ts", ".tsx", ".mts", ".cts"]
// Same code-bearing signal set firing-check-v2 uses for this lane, so the two
// instruments sample the same population and their numbers can be compared.
const SIGNALS = ["function ", "export ", "class ", "const "]
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".pnpm-store", "coverage"])
const MAX_BYTES = 400_000

const TYPES = [
  "calls", "uses", "contains", "imports", "references", "exports",
  "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof TYPES)[number]

interface Row {
  edges: number
  srcEmpty: number
  tgtEmpty: number
  srcPlaceholder: number
  tgtPlaceholder: number
  selfLoop: number
  withinSrc: number
  withinTgt: number
  withinBoth: number
  withinNeither: number
  ambiguousTgt: number
  corpusSrc: number
  corpusTgt: number
  corpusBoth: number
  corpusNeither: number
  corpusMultiTgt: number
  lowConfidence: number
  confSum: number
  /** Confidence x100 histogram: confidence is 0..1, so the key is an integer. */
  confHist: Map<number, number>
  /** evidenceClass values seen on this type's edges; "" when the edge carries none. */
  evidenceClass: Map<string, number>
  /** Edges whose confidence < 1 with NO machine-readable reason code (contract §4.1). */
  belowOneNoReason: number
  /** Distinct (source,target) pairs, so a self-loop count can be separated from a pair count. */
  pairs: Set<string>
}

function blank(): Row {
  return {
    edges: 0, srcEmpty: 0, tgtEmpty: 0, srcPlaceholder: 0, tgtPlaceholder: 0, selfLoop: 0,
    withinSrc: 0, withinTgt: 0, withinBoth: 0, withinNeither: 0, ambiguousTgt: 0,
    corpusSrc: 0, corpusTgt: 0, corpusBoth: 0, corpusNeither: 0, corpusMultiTgt: 0,
    lowConfidence: 0, confSum: 0,
    confHist: new Map(), evidenceClass: new Map(), belowOneNoReason: 0, pairs: new Set(),
  }
}

/** A reason code is a STRING field whose value names the inference. Read by identity. */
const REASON_KEYS = [
  "reason", "reasonCode", "reason_code", "evidenceClass", "evidence_class",
  "relationshipType", "why", "evidence", "matchStrategy", "match_strategy",
  "confidenceReason", "confidence_reason",
]

/** R7 placeholder literal. Compared by string identity, not by pattern. */
function isPlaceholder(s: string): boolean {
  return s === "unknown"
}

/**
 * THE KEY AN ENDPOINT BINDS AGAINST.
 *
 * The first version of this census read `symbol.qualifiedName` and reported
 * `overrides` at 0.0% within-file resolution on vuejs — 71 edges, none
 * resolvable. That number was an artefact of the instrument, and it is worth
 * recording exactly why, because the wrong reading of it is "71 fabricated
 * edges", which would have been a serious and completely wrong finding.
 *
 * `RealTypeScriptAnalyzer` never assigns `qualifiedName`. It assigns `scope`,
 * and PRODUCTION derives the qualified name from it, in `pool-worker.ts:930`:
 *
 *     qualifiedName: s.qualifiedName || s.metadata?.fqn
 *                     || (s.scope ? `${s.scope}.${s.name}` : s.name)
 *
 * A census that reads `qualifiedName` off `analyze()` output is reading a field
 * no analyzer in the fleet populates — `grep -c qualifiedName` is 0 across
 * real-typescript, real-javascript, real-go, real-java and real-python — and so
 * it silently measures "does the analyzer set a field it does not set" and
 * reports 0% for every dotted endpoint in the language.
 *
 * This function therefore applies the SAME derivation production applies. The
 * precedence chain is copied from `pool-worker.ts:930` rather than
 * reimplemented, because a reimplementation is a second thing that can drift.
 */
function productionQualifiedName(s: any): string {
  const q = String(s?.qualifiedName ?? "")
  if (q.length > 0) return q
  const fqn = String(s?.metadata?.fqn ?? "")
  if (fqn.length > 0) return fqn
  const scope = String(s?.scope ?? "")
  return scope.length > 0 ? `${scope}.${String(s?.name ?? "")}` : String(s?.name ?? "")
}

/**
 * DERIVED population. Walks the corpus directory; never a hand-written list.
 * Returns the files AND the counts that went into the filter, so a reader can
 * see how many were rejected and why rather than trusting NFILES.
 */
function collectFiles(dir: string, want: number): { files: string[]; seen: number; tooBig: number; noSignal: number; wrongExt: number; walkError: number } {
  const files: string[] = []
  let seen = 0, tooBig = 0, noSignal = 0, wrongExt = 0, walkError = 0
  const walk = (d: string, depth: number): void => {
    if (files.length >= want || depth > 24) return
    let ents: ReturnType<typeof readdirSync>
    try {
      ents = readdirSync(d, { withFileTypes: true })
    } catch {
      walkError++
      return
    }
    for (const e of ents) {
      if (files.length >= want) return
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p, depth + 1)
        continue
      }
      if (!EXTS.some((x) => e.name.endsWith(x))) { wrongExt++; continue }
      seen++
      let size = 0
      let src = ""
      try {
        size = statSync(p).size
        if (size >= MAX_BYTES) { tooBig++; continue }
        src = readFileSync(p, "utf8")
      } catch {
        walkError++
        continue
      }
      if (!SIGNALS.some((s) => src.includes(s))) { noSignal++; continue }
      files.push(p)
    }
  }
  walk(dir, 0)
  return { files, seen, tooBig, noSignal, wrongExt, walkError }
}

function pct(n: number, d: number): string {
  if (d === 0) return "  n/a"
  return ((100 * n) / d).toFixed(1).padStart(5) + "%"
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length)
}

async function main(): Promise<void> {
  const pop = collectFiles(DIR, NFILES)
  console.log("=".repeat(104))
  console.log("AMBIGUITY CENSUS — real-typescript-analyzer, production path (getParser -> parse -> analyze)")
  console.log("=".repeat(104))
  console.log(`corpus root      ${CORPUS_ROOT}`)
  console.log(`corpus dir       ${CORPUS_DIR}  (${DIR})`)
  console.log(`requested        ${NFILES}`)
  // THE POPULATION, declared next to the counts. See header §3.
  console.log(`POPULATION       ${pop.files.length} files admitted`)
  console.log(`  derived by     recursive readdir walk of ${DIR}`)
  console.log(`  extensions     ${EXTS.join(" ")}`)
  console.log(`  excluded dirs  ${[...SKIP_DIRS].join(" ")}`)
  console.log(`  size cap       ${MAX_BYTES} bytes`)
  console.log(`  code-bearing   at least one of: ${SIGNALS.map((s) => JSON.stringify(s)).join(" ")}`)
  console.log(`  rejected       ${pop.seen} candidate files examined · ${pop.noSignal} no code signal · ${pop.tooBig} over size cap · ${pop.wrongExt} other extensions · ${pop.walkError} unreadable`)
  console.log()

  const parser = await getParser("typescript")
  const perType = new Map<Type, Row>()
  for (const t of TYPES) perType.set(t, blank())

  // CORPUS-WIDE symbol universe. name -> how many DISTINCT declarations share it.
  const corpusNames = new Map<string, number>()
  // Which files contributed each type, so a verdict can name its files.
  const typeFiles = new Map<Type, Set<string>>()
  for (const t of TYPES) typeFiles.set(t, new Set())

  const anyTypeFiles = new Set<string>()
  let parsed = 0, failed = 0
  let totalSymbols = 0
  let errorNodeFiles = 0
  const failures: string[] = []
  const globalSamples = new Map<Type, string[]>()
  for (const t of TYPES) globalSamples.set(t, [])

  for (const f of pop.files) {
    let content: string
    try {
      content = readFileSync(f, "utf8")
    } catch {
      failed++
      failures.push(`${f}: unreadable`)
      continue
    }
    let res: any
    try {
      const pr = await parser.parse(content, f)
      res = new RealTypeScriptAnalyzer().analyze(pr.rootNode as any, content, f)
    } catch (e) {
      failed++
      failures.push(`${f}: ${String(e).slice(0, 90)}`)
      continue
    }
    parsed++
    const rel = relative(DIR, f)
    const symbols: any[] = Array.isArray(res?.symbols) ? res.symbols : []
    totalSymbols += symbols.length

    // WITHIN-FILE universe: what this analyze() call published.
    const within = new Set<string>()
    for (const s of symbols) {
      const n = String(s?.name ?? "")
      if (n.length === 0) continue
      const owner = String(s?.ownerName ?? "")
      // The key SPACES one declaration answers to. Built as a set first: the
      // qualified name and the dotted `Owner.member` form are often the SAME
      // string, and incrementing both made one declaration count as two, which
      // reported 100% "ambiguous target" on `overrides` — a type that resolves at
      // 100% and cannot be ambiguous within a file. An ambiguity count that goes
      // up when resolution goes up is measuring the tally, not the corpus.
      const keys = new Set<string>()
      keys.add(n)
      const q = productionQualifiedName(s)
      if (q.length > 0) keys.add(q)
      // The dotted `Owner.member` form, which is what `overrides` emits and what
      // `ownerName` + `name` describe.
      if (owner.length > 0) keys.add(`${owner}.${n}`)
      for (const k of keys) within.add(k)
      // CORPUS-WIDE count is DISTINCT DECLARATIONS, so each symbol contributes 1
      // to each DISTINCT key it answers to, and 0 to a key another key of its own
      // already covered.
      for (const k of keys) corpusNames.set(k, (corpusNames.get(k) ?? 0) + 1)
    }

    if ((res?.parseErrors?.length ?? 0) > 0) errorNodeFiles++

    const rels: any[] = Array.isArray(res?.relationships) ? res.relationships : []
    let fileProduced = false
    for (const r of rels) {
      const t = String(r?.type ?? r?.relationshipType ?? "") as Type
      if (!TYPES.includes(t)) continue
      const row = perType.get(t)!
      row.edges++
      if (!fileProduced) { anyTypeFiles.add(rel); fileProduced = true }
      typeFiles.get(t)!.add(rel)

      const src = String(r?.source ?? "")
      const tgt = String(r?.target ?? "")
      if (src.length === 0) row.srcEmpty++
      if (tgt.length === 0) row.tgtEmpty++
      if (isPlaceholder(src)) row.srcPlaceholder++
      if (isPlaceholder(tgt)) row.tgtPlaceholder++
      if (src.length > 0 && src === tgt) row.selfLoop++

      const conf = typeof r?.confidence === "number" ? r.confidence : 1
      row.confSum += conf
      if (conf < 0.7) row.lowConfidence++
      row.confHist.set(Math.round(conf * 100), (row.confHist.get(Math.round(conf * 100)) ?? 0) + 1)
      row.pairs.add(`${src}\u0000${tgt}`)
      // Question 5 of the six: evidenceClass/confidence right. Contract §4.1
      // requires a machine-readable reason code on anything below 1.0. The keys
      // are enumerated, not matched by pattern, and a value is accepted on
      // identity as a non-empty string — so this cannot be fooled by a
      // coincidence of characters and cannot miss a reason stored under a name
      // this list forgot, because an unknown name simply reads as "no reason".
      if (conf < 1) {
        let reason = ""
        const meta = (r?.metadata ?? {}) as Record<string, unknown>
        for (const k of REASON_KEYS) {
          const v = meta[k]
          if (typeof v === "string" && v.length > 0) { reason = v; break }
          if (v && typeof v === "object") {
            const sub = Object.values(v as Record<string, unknown>)
            if (sub.some((x) => typeof x === "string" && x.length > 0)) { reason = k; break }
          }
        }
        if (reason.length === 0) row.belowOneNoReason++
      }
      const ec = (r?.metadata ?? {}) as Record<string, unknown>
      const ecv = typeof ec.evidenceClass === "string" && ec.evidenceClass.length > 0 ? ec.evidenceClass : "(none)"
      row.evidenceClass.set(ecv, (row.evidenceClass.get(ecv) ?? 0) + 1)

      if (src.length > 0 && within.has(src)) row.withinSrc++
      if (tgt.length > 0 && within.has(tgt)) row.withinTgt++
      if (src.length > 0 && tgt.length > 0 && within.has(src) && within.has(tgt)) row.withinBoth++
      if (src.length > 0 && tgt.length > 0 && !within.has(src) && !within.has(tgt)) row.withinNeither++

      if (tgt.length > 0 && within.has(tgt)) {
        // Ambiguous WITHIN this file: the name is published more than once here.
        let n = 0
        for (const s of symbols) {
          const nm = String(s?.name ?? "")
          if (nm === tgt || productionQualifiedName(s) === tgt ||
              (String(s?.ownerName ?? "").length > 0 && `${s.ownerName}.${nm}` === tgt)) n++
        }
        if (n > 1) row.ambiguousTgt++
      }

      const cSrc = src.length > 0 ? (corpusNames.get(src) ?? 0) : 0
      const cTgt = tgt.length > 0 ? (corpusNames.get(tgt) ?? 0) : 0
      if (cSrc > 0) row.corpusSrc++
      if (cTgt > 0) row.corpusTgt++
      if (cSrc > 0 && cTgt > 0) row.corpusBoth++
      if (src.length > 0 && tgt.length > 0 && cSrc === 0 && cTgt === 0) row.corpusNeither++
      if (cTgt > 1) row.corpusMultiTgt++

      if (globalSamples.get(t)!.length < 4 && (cTgt === 0 || cSrc === 0 || cTgt > 1)) {
        globalSamples.get(t)!.push(`${rel}  ${t}  ${src} -> ${tgt}`)
      }
    }
  }

  // ORDER OF ANALYSIS vs ORDER OF RESOLUTION. corpusNames accumulates as the walk
  // proceeds, so a corpus-wide verdict on file 3 was computed against a universe
  // of files 1..3 only. That is stated here rather than hidden: the corpus-scope
  // column is therefore a LOWER BOUND, which is the safe direction for an
  // "unresolved" count (a later file could only add names, never remove them).
  console.log(`parsed           ${parsed}/${pop.files.length} files  (${failed} failed)`)
  console.log(`symbols          ${totalSymbols} published`)
  console.log(`files with parse errors  ${errorNodeFiles}/${parsed}`)
  if (failures.length) {
    console.log(`failures (first 5):`)
    for (const x of failures.slice(0, 5)) console.log(`  ${x}`)
  }
  console.log(`files producing >=1 relationship  ${anyTypeFiles.size}`)
  console.log()

  console.log("-".repeat(104))
  console.log("PER TYPE — edges, then endpoint resolution, per scope. within=this analyze() call's symbols. corpus=every symbol this run published.")
  console.log("-".repeat(104))
  console.log(
    pad("type", 14) + pad("edges", 9) + pad("files", 8) +
    pad("w/in-both", 12) + pad("w/in-neither", 15) +
    pad("corp-both", 12) + pad("corp-neither", 14) +
    pad("multi-tgt", 11) + pad("empty-name", 12) + pad("R7-ph", 8),
  )
  const summary: Record<string, unknown> = {}
  for (const t of TYPES) {
    const r = perType.get(t)!
    const n = r.edges
    const fs = typeFiles.get(t)!.size
    if (n === 0) {
      console.log(pad(t, 14) + pad("0", 9) + pad(String(fs), 8) + "  (fired on 0 edges — see the construct probe table)")
      summary[t] = { verdict: "NO EDGES", files: fs }
      continue
    }
    console.log(
      pad(t, 14) + pad(String(n), 9) + pad(String(fs), 8) +
      pad(pct(r.withinBoth, n), 12) + pad(pct(r.withinNeither, n), 15) +
      pad(pct(r.corpusBoth, n), 12) + pad(pct(r.corpusNeither, n), 14) +
      pad(pct(r.corpusMultiTgt, n), 11) + pad(String(r.srcEmpty + r.tgtEmpty), 12) +
      pad(String(r.srcPlaceholder + r.tgtPlaceholder), 8),
    )
    summary[t] = {
      edges: n, files: fs,
      withinBoth: r.withinBoth, withinNeither: r.withinNeither,
      withinSrcOnly: r.withinSrc - r.withinBoth, withinTgtOnly: r.withinTgt - r.withinBoth,
      corpusBoth: r.corpusBoth, corpusNeither: r.corpusNeither,
      corpusSrcOnly: r.corpusSrc - r.corpusBoth, corpusTgtOnly: r.corpusTgt - r.corpusBoth,
      corpusMultiTgt: r.corpusMultiTgt, withinAmbiguousTgt: r.ambiguousTgt,
      emptyEndpoints: r.srcEmpty + r.tgtEmpty,
      placeholderEndpoints: r.srcPlaceholder + r.tgtPlaceholder,
      selfLoops: r.selfLoop,
      distinctPairs: r.pairs.size,
      lowConfidence: r.lowConfidence,
      meanConfidence: Number((r.confSum / n).toFixed(4)),
      confidenceHistogram: Object.fromEntries([...r.confHist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k / 100), v])),
      evidenceClassHistogram: Object.fromEntries([...r.evidenceClass.entries()].sort((a, b) => b[1] - a[1])),
      belowOneWithoutReasonCode: r.belowOneNoReason,
      sampleFiles: [...typeFiles.get(t)!].slice(0, 12),
      unresolvedSamples: globalSamples.get(t)!,
    }
  }
  console.log("-".repeat(104))

  // ── QUESTION 5, per type: confidence distribution and evidenceClass.
  // Printed separately from the resolution table because the two answer
  // different questions and averaging them hides a type that emits one
  // deterministic edge and a type that emits 40,000 heuristic ones.
  console.log()
  console.log("CONFIDENCE / EVIDENCE (question 5: is evidenceClass and confidence right?)")
  console.log("  conf x100 as an integer key; reason = machine-readable code present when confidence < 1.0")
  console.log(pad("type", 14) + pad("edges", 9) + pad("mean", 8) + pad("<0.7", 8) + pad("<1.0", 9) + pad("no-reason", 11) + "confidence histogram")
  for (const t of TYPES) {
    const r = perType.get(t)!
    if (r.edges === 0) { console.log(pad(t, 14) + "0 edges"); continue }
    const belowOne = [...r.confHist.entries()].filter(([k]) => k < 100).reduce((a, [, v]) => a + v, 0)
    const hist = [...r.confHist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${(k / 100).toFixed(2)}:${v}`).join(" ")
    console.log(
      pad(t, 14) + pad(String(r.edges), 9) + pad((r.confSum / r.edges).toFixed(3), 8) +
      pad(String(r.lowConfidence), 8) + pad(String(belowOne), 9) + pad(String(r.belowOneNoReason), 11) + hist,
    )
  }
  console.log()
  console.log("evidenceClass per type (an edge with none is shown as (none))")
  for (const t of TYPES) {
    const r = perType.get(t)!
    if (r.edges === 0) continue
    const list = [...r.evidenceClass.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v} (${pct(v, r.edges).trim()})`)
    console.log(`  ${pad(t, 14)}${list.join("  ")}`)
  }

  // Standalone rules R7 checks anywhere in the fleet.
  let r7 = 0, emptyName = 0, selfLoops = 0, lowConf = 0, totalEdges = 0
  for (const t of TYPES) {
    const r = perType.get(t)!
    r7 += r.srcPlaceholder + r.tgtPlaceholder
    emptyName += r.srcEmpty + r.tgtEmpty
    selfLoops += r.selfLoop
    lowConf += r.lowConfidence
    totalEdges += r.edges
  }
  console.log()
  console.log("R7 / HONESTY CHECKS over all emitted edges")
  console.log(`  total edges                    ${totalEdges}`)
  console.log(`  endpoint === "unknown" (R7)    ${r7}`)
  console.log(`  empty endpoint names           ${emptyName}`)
  console.log(`  self loops (source === target) ${selfLoops}`)
  console.log(`  confidence < 0.7 (heuristic)   ${lowConf}  ${pct(lowConf, totalEdges)}`)
  console.log()

  console.log("UNRESOLVED-ENDPOINT SAMPLES (per type, first 4)")
  let anySample = false
  for (const t of TYPES) {
    const s = globalSamples.get(t)!
    if (!s.length) continue
    anySample = true
    console.log(`  ${t}:`)
    for (const line of s) console.log(`    ${line}`)
  }
  if (!anySample) console.log("  (none: every endpoint of every emitted edge resolved)")

  if (SAVE) {
    writeFileSync(SAVE, JSON.stringify({
      corpus: DIR, requested: NFILES, admitted: pop.files.length,
      population: { seen: pop.seen, noSignal: pop.noSignal, tooBig: pop.tooBig, wrongExt: pop.wrongExt, walkError: pop.walkError },
      parsed, failed, totalSymbols, errorNodeFiles,
      corpusScopeIsLowerBound: true,
      totals: { totalEdges, r7, emptyName, selfLoops, lowConf },
      perType: summary,
      files: pop.files.map((f) => relative(DIR, f)),
    }, null, 2) + "\n")
    console.log(`\nwrote ${SAVE}`)
  }
}

await main()
