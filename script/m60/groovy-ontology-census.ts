/**
 * GROOVY ONTOLOGY CENSUS — the measurement half of `docs/analyzers/ONTOLOGY-WORKSTREAM.md`.
 *
 *   npx tsx script/m60/groovy-ontology-census.ts --out <path> [--max N] [--engine]
 *
 * ## What it measures, and why each column exists
 *
 * The workstream requires a verdict with a NUMBER behind it for all ten relationship
 * types, for three verdict shapes (EMITTED / RULED / GAP) plus six questions about every
 * type already emitted. Prose cannot decide any of them, so this instrument reads the
 * PRODUCTION entry (`pool-worker.parseFile`, which is what `parallel-indexer` stores) and
 * reports, per type:
 *
 *   total / files / sampleFiles  — the EMITTED verdict's count and provenance. A type with
 *                                  a branch but zero corpus rows is dead code, and this
 *                                  column is what says so.
 *   resolvesBothEnds             — question 5 (Resolved), computed with the SAME binding
 *                                  rules `parallel-indexer` applies at insert time. An
 *                                  aggregate rate mixes classes with opposite characters, so
 *                                  the rate is reported PER TYPE and never alone.
 *   evidenceClass                — question 6 (Confident). Reported as a histogram because
 *                                  "is 0.9 the right number" is unanswerable without knowing
 *                                  how many edges ride each tier.
 *   reasonCodes                  — the machine-readable half of the honesty contract's
 *                                  confidence rule (§4.1): a sub-1.0 edge must carry one.
 *   unknownTarget / emptyName / placeholderEnd — standing rule R7 and the §1-claim question.
 *                                  `unknownTarget` counts edges whose TARGET is the literal
 *                                  string "unknown"; `placeholderEnd` counts edges with an
 *                                  empty or sentinel source/target. These are reported even
 *                                  when zero, because a zero that was never measured is the
 *                                  defect the ontology gate exists to catch.
 *
 * ## Why it also records the engine path
 *
 * `--engine` adds `ASTEngine.parseFile` (the analyzer's own output before pool-worker's
 * noise filter) so a drop by the production filter is attributable to the filter rather
 * than to a guess. It is off by default because it doubles the parse cost.
 *
 * It is an INSTRUMENT, not a gate: it writes one file the caller names and asserts nothing.
 */

import { ASTEngine } from "../../src/ast/engine"
import { parseFile as productionParseFile } from "../../src/ast/pool-worker"
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined
const MAX = Number((argv.includes("--max") ? argv[argv.indexOf("--max") + 1] : "0")) || 0
const WITH_ENGINE = argv.includes("--engine")
const REPOS = ((process.env.BB_GROOVY_REPOS ?? "groovy").split(",")).map((s) => s.trim()).filter(Boolean)

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references", "exports",
  "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/** The graph names bb_graph / bb_impact read; a sentinel is a node that names no code. */
const SENTINELS = new Set(["", "(script)", "root", "global", "unknown", "self", "this", "super", "<global>"])

const leaf = (name: string): string => {
  const noLine = name.replace(/:\d+$/, "")
  const segs = noLine.split(":").filter((s) => s.length > 0)
  const last = segs[segs.length - 1] ?? ""
  const dots = last.split(".")
  return dots[dots.length - 1]
}

/**
 * parallel-indexer's insert-time binding, reproduced (exact name, leaf,
 * endsWith(:name), endsWith(.name), qualifiedName). Kept in this file rather than
 * imported so the instrument cannot drift WITH the indexer — a gate that calls the
 * code it audits is a tautology, and an instrument that cannot disagree is
 * decoration.
 */
function resolves(name: string, syms: Array<{ name: string; scope?: string }>): boolean {
  if (!name) return false
  if (syms.some((s) => s.name === name)) return true
  const l = leaf(name)
  if (syms.some((s) => s.name === l)) return true
  for (const s of syms) {
    if (name.endsWith(`:${s.name}`)) return true
    if (name.endsWith(`.${s.name}`)) return true
    const q = s.scope ? `${s.scope}.${s.name}` : s.name
    if (q && name === q) return true
    if (q && name.endsWith(`:${q}`)) return true
    if (q && q.endsWith(`.${l}`)) return true
  }
  return false
}

type Row = {
  total: number
  files: number
  sampleFiles: string[]
  bothEnds: number
  srcOnly: number
  tgtOnly: number
  neither: number
  sampleResolvable: string[]
  sampleUnresolved: string[]
  unknownTarget: number
  placeholderEnd: number
  selfEdge: number
  conf: Record<string, number>
  evidenceClass: Record<string, number>
  reasonCodes: Record<string, number>
  subOneNoReason: number
  noLine: number
}

function newRow(): Row {
  return {
    total: 0, files: 0, sampleFiles: [], bothEnds: 0, srcOnly: 0, tgtOnly: 0, neither: 0,
    sampleResolvable: [], sampleUnresolved: [], unknownTarget: 0, placeholderEnd: 0, selfEdge: 0,
    conf: {}, evidenceClass: {}, reasonCodes: {}, subOneNoReason: 0, noLine: 0,
  }
}

async function main(): Promise<void> {
  const files: Array<{ repo: string; abs: string }> = []
  for (const repo of REPOS) {
    const dir = join(ROOT, repo)
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = join(dir, rel)
      if (!rel.endsWith(".groovy") && !rel.endsWith(".gradle")) continue
      try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
      files.push({ repo, abs })
    }
  }
  files.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
  // `--from N` slices the SAME sorted universe the unsharded run uses, so N
  // shards are comparable and sum to the whole. It exists because the engine's
  // per-file watchdog (`[BB-HANG] parser stuck 120s`, src/ast/engine.ts) kills
  // the whole PROCESS on a wall-clock timeout: on a shared box running five
  // lanes, one queued file ends the entire census and every row after it is lost
  // silently. Sharding bounds that loss to one shard, and the shard digests are
  // recorded so a lost shard is visible in the merged artifact rather than
  // inferred from a total that came out short.
  const FROM = Number((argv.includes("--from") ? argv[argv.indexOf("--from") + 1] : "0")) || 0
  const selected = MAX > 0 ? files.slice(FROM, FROM + MAX) : (FROM > 0 ? files.slice(FROM) : files)

  const rows = new Map<Type, Row>()
  for (const t of ALL_TYPES) rows.set(t, newRow())
  const engineRows = new Map<Type, Row>()
  if (WITH_ENGINE) for (const t of ALL_TYPES) engineRows.set(t, newRow())

  let filesParsed = 0
  let filesWithParseError = 0
  let symbolTotal = 0
  const emptySymbolNames: string[] = []
  const filesSeenByType = new Map<Type, Set<string>>()
  for (const t of ALL_TYPES) filesSeenByType.set(t, new Set())

  const idx = { i: 0 }
  const CONCURRENCY = Number(process.env.BB_GROOVY_CENSUS_WORKERS ?? "6")
  async function worker(): Promise<void> {
    for (;;) {
      const k = idx.i++
      if (k >= selected.length) return
      const f = selected[k]
      let r: any
      try { r = await productionParseFile(f.abs) } catch { continue }
      filesParsed++
      if ((r.errors ?? []).length > 0) filesWithParseError++
      const syms = (r.symbols ?? []).map((s: any) => ({ name: String(s?.name ?? ""), scope: s?.scope }))
      symbolTotal += syms.length
      for (const s of syms) {
        if (!s.name || s.name.trim() === "") emptySymbolNames.push(`${f.repo}/${f.abs.split("/repositories/")[1] ?? f.abs}`)
      }
      for (const rel of (r.relationships ?? [])) {
        const t = String(rel.type ?? rel.relationshipType ?? "").toLowerCase() as Type
        if (!ALL_TYPES.includes(t)) continue
        const row = rows.get(t)!
        const src = String(rel.source ?? "")
        const tgt = String(rel.target ?? "")
        row.total++
        filesSeenByType.get(t)!.add(f.abs)
        if (row.sampleFiles.length < 4 && !row.sampleFiles.some((x) => x.endsWith(f.abs.split("/").pop()!))) {
          row.sampleFiles.push(`${f.repo}/${f.abs.replace(`${ROOT}/`, "")}`)
        }
        const sOk = resolves(src, syms)
        const tOk = resolves(tgt, syms)
        if (sOk && tOk) { row.bothEnds++; if (row.sampleResolvable.length < 6) row.sampleResolvable.push(`${src} -> ${tgt}`) }
        else if (sOk) { row.srcOnly++; if (row.sampleUnresolved.length < 6) row.sampleUnresolved.push(`src-only ${src} -> ${tgt}`) }
        else if (tOk) { row.tgtOnly++; if (row.sampleUnresolved.length < 6) row.sampleUnresolved.push(`tgt-only ${src} -> ${tgt}`) }
        else { row.neither++; if (row.sampleUnresolved.length < 6) row.sampleUnresolved.push(`neither ${src} -> ${tgt}`) }
        if (tgt === "unknown") row.unknownTarget++
        if (SENTINELS.has(src) || SENTINELS.has(tgt)) row.placeholderEnd++
        if (src === tgt && src !== "") row.selfEdge++
        const c = typeof rel.confidence === "number" ? rel.confidence.toFixed(2) : "absent"
        row.conf[c] = (row.conf[c] ?? 0) + 1
        const ec = String(rel.metadata?.evidenceClass ?? "(absent)")
        row.evidenceClass[ec] = (row.evidenceClass[ec] ?? 0) + 1
        const rc = rel.metadata?.reasonCode
        if (rc) row.reasonCodes[String(rc)] = (row.reasonCodes[String(rc)] ?? 0) + 1
        if (typeof rel.confidence === "number" && rel.confidence < 1 && !rc) row.subOneNoReason++
        if (typeof rel.line_number !== "number" || rel.line_number <= 0) row.noLine++
      }
      if (WITH_ENGINE) {
        let e: any
        try { e = await ASTEngine.parseFile(f.abs, readFileSync(f.abs, "utf8")) } catch { e = null }
        for (const rel of (e?.relationships ?? [])) {
          const t = String(rel.type ?? rel.relationshipType ?? "").toLowerCase() as Type
          if (!ALL_TYPES.includes(t)) continue
          engineRows.get(t)!.total++
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  for (const t of ALL_TYPES) rows.get(t)!.files = filesSeenByType.get(t)!.size

  const table = (m: Map<Type, Row>) =>
    ALL_TYPES.map((t) => {
      const r = m.get(t)!
      return {
        type: t,
        total: r.total,
        files: r.files,
        sampleFiles: r.sampleFiles,
        verdictShape: r.total > 0 ? "EMITTED" : "NOT EMITTED",
        resolvesBothEnds: r.bothEnds,
        pctBothEnds: +((r.bothEnds / Math.max(1, r.total)) * 100).toFixed(1),
        sourceOnly: r.srcOnly,
        targetOnly: r.tgtOnly,
        neitherEnd: r.neither,
        sampleResolvable: r.sampleResolvable,
        sampleUnresolved: r.sampleUnresolved,
        unknownTarget: r.unknownTarget,
        placeholderEnd: r.placeholderEnd,
        selfEdge: r.selfEdge,
        confidence: r.conf,
        evidenceClass: r.evidenceClass,
        reasonCodes: r.reasonCodes,
        subOneWithoutReasonCode: r.subOneNoReason,
        withoutLineNumber: r.noLine,
      }
    })

  const artifact = {
    instrument: "groovy-ontology-census",
    lane: "analyzer/GROOVY",
    entryPoint: "src/ast/pool-worker.ts parseFile (production; what parallel-indexer stores)",
    corpora: REPOS.map((r) => `${ROOT}/${r}`),
    slice: { from: FROM, max: MAX, universe: files.length },
    filesAdmitted: selected.length,
    filesParsed,
    filesWithParseErrorNodes: filesWithParseError,
    symbolsEmitted: symbolTotal,
    emptySymbolNames: emptySymbolNames.length,
    emptySymbolNameFiles: emptySymbolNames.slice(0, 8),
    resolutionRules: "parallel-indexer insert-time binding: exact name, leaf, endsWith(:name), endsWith(.name), qualifiedName.",
    productionPath: table(rows),
    ...(WITH_ENGINE ? { enginePath: table(engineRows) } : {}),
  }
  const text = JSON.stringify(artifact, null, 2)
  if (OUT) { writeFileSync(OUT, text + "\n"); process.stderr.write(`wrote ${OUT}\n`) }
  console.log(text)
}
main().catch((e) => { console.error(e); process.exit(1) })