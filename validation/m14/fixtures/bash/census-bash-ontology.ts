/**
 * BASH ONTOLOGY CENSUS — the lane's own measurement, through the PRODUCTION entry point.
 *
 * ## Why this file exists
 *
 * `script/m14/ontology-coverage-gate.ts` answers ONE question per relationship type:
 * does production `parseFile` emit it, or does the language lack the construct. It
 * does not answer the six questions per emitted type, and it does not report symbol
 * hygiene, resolution rate, or the heuristic ratio. Those are what this file
 * measures, so every number in `docs/analyzers/bash.md` under
 * "Evidence" is reproducible from this file against a stated sample.
 *
 * ## What is measured, and with which instrument
 *
 *   counts          — production `parseFile` from src/ast/pool-worker.ts. NOT
 *                     `analyze()`: that per-file unit skips the pool-worker
 *                     pipeline stages (pool, timeouts, truncation, enhancements),
 *                     so a count taken through it is a count of something the
 *                     product does not run.
 *   symbol hygiene  — SymbolKind vocabulary, empty names, the literal `unknown`
 *                     endpoint (R7 in validation/m60/ledger.json).
 *   resolution      — both endpoints of every edge against THIS FILE's symbol set.
 *                     Per type, because in bash the types resolve against
 *                     different universes and a single pooled rate would hide that.
 *   labelling       — endpoint-shape expectations per type, i.e. a check that the
 *                     edge carries the type it claims. See LABELS below.
 *   confidence      — the sub-0.7 heuristic ratio, per honesty contract §4.
 *   damage          — commands whose emitted `calls` edge sits in or beside a
 *                     damaged parse region. Measured, because the analyzer's own
 *                     BD5 comment once claimed a damage guard that was never
 *                     implemented (the two helpers were dead code) and the
 *                     replacement decision — refuse nothing, refuse only
 *                     reserved words — rests on an A/B
 *                     (`guard-ab-bash-calls.ts`) rather than on a preference.
 *
 * ## Sampling
 *
 * The corpus is walked with `git ls-files` per repository (the same discovery the
 * gate uses), each file is admitted by `detectLanguageFromPath` — the production
 * router, including the extensionless-shebang rule — and files are then taken in
 * HASH ORDER (sha256 of repo/rel, ascending). Hash order is deterministic, is
 * independent of directory traversal order, and does not favour any repository's
 * naming; the first N are therefore a reproducible sample rather than an
 * alphabetical prefix. `--sample N` sets the size; `--all` takes every admitted
 * file. `--repo NAME` restricts to one repository.
 *
 * ## Independence
 *
 * The oracle in `script/m14/differential.ts` (`deriveBashEdges`) is a SEPARATE
 * walker over the SAME wasm grammar. A grammar bug shared by both paths is
 * therefore invisible to it, and this file does not claim otherwise: it measures
 * the production path's own shape, not agreement with the oracle. Agreement is
 * measured by `npx tsx script/m14/differential.ts --repo <name>`, which is
 * shared machinery and is run, never edited, by this lane.
 *
 * CLI:
 *   npx tsx validation/m14/fixtures/bash/census-bash-ontology.ts [--sample 400] [--all] [--repo NAME] [--json out.json]
 */

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const SAMPLE = Number(flag("sample") ?? "400")
const ALL = argv.includes("--all")
const REPO = flag("repo")
const OUT = flag("json")

// --------------------------------------------------------------- corpus walk
type Admitted = { repo: string; dir: string; rel: string; abs: string; text: string }
const admitted: Admitted[] = []
let scanned = 0
let trackedTotal = 0
let reposSeen = 0
// Tracked by git but ABSENT from the working tree. These are not read by this
// census and not counted in `admitted`, so `scanned` is not the tracked total and
// calling it one would overstate the corpus. Measured 2026-10-04: 23,090 of
// 525,586 across the corpus, concentrated in four repos whose checkout never
// completed. `probe-bash-recovered-blobs.mts` measures what admitting them would
// change.
let absentFromWorktree = 0
for (const e of readdirSync(CR)) {
  if (REPO && e !== REPO) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  reposSeen++
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  trackedTotal += tracked.length
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size: number
    try {
      if (statSync(abs).size > 512 * 1024) continue
      size = statSync(abs).size
    } catch {
      absentFromWorktree++
      continue
    }
    let text: string
    try {
      text = readFileSync(abs, "utf8")
    } catch {
      absentFromWorktree++
      continue
    }
    scanned++
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    void size
    admitted.push({ repo: e, dir, rel, abs, text })
  }
}

const byHash = (a: Admitted, b: Admitted): number => {
  const ha = createHash("sha256").update(`${a.repo}/${a.rel}`).digest("hex")
  const hb = createHash("sha256").update(`${b.repo}/${b.rel}`).digest("hex")
  return ha < hb ? -1 : ha > hb ? 1 : 0
}
admitted.sort(byHash)
const totalAdmitted = admitted.length
// The corpus pin: sha256 over the sorted `repo/rel` of every admitted file. Same
// value as `probe-bash-corpus-pin.mts setHash`, computed the same way, so the two
// files can be checked against each other rather than trusted.
const admittedSetHash = createHash("sha256")
  .update(admitted.map((a) => `${a.repo}/${a.rel}`).sort().join("\n"))
  .digest("hex")
const files = ALL ? admitted : admitted.slice(0, SAMPLE)
const repos = new Set(files.map((f) => f.repo))

// ------------------------------------------------------------------ tallies
const relCounts = new Map<Type, number>()
const relFiles = new Map<Type, Set<string>>()
// The TRUE count of distinct files a type fired in.
//
// `relFiles` is capped at 6 because it feeds the printed example list, and the
// report printed `relFiles.size + "+"` under a column headed `files` — which
// reads as a count and is not one. Every type with more than 6 example files
// printed `6+`. `overrides`, the rarest emitted type, printed `6+` beside 138
// edges; the truth is the file count below, and it is the number that explains
// why `firing-check.ts --files 120` reads `overrides` at 0 edges.
const relFileCount = new Map<Type, Set<string>>()
const relExamples = new Map<Type, string[]>()
const kindCounts = new Map<string, number>()
const confidenceBands = new Map<Type, { under07: number; total: number }>()
const evidenceClasses = new Map<Type, Map<string, number>>()
// resolution, per type: both ends / source only / target only / neither
const resolution = new Map<Type, { both: number; srcOnly: number; tgtOnly: number; neither: number }>()

/**
 * AMBIGUITY — how often an edge's target matches MORE THAN ONE published symbol.
 *
 * `resolution` above answers "does the name exist", which is the wrong question on
 * its own: a name published twice resolves to two real declarations and a reverse
 * walk that picks one has picked arbitrarily. The Clean case is the reference —
 * `LogMemory` is BOTH `:: LogMemory = ...` (a type synonym) and `instance zero
 * LogMemory` (a value of it), two genuine declarations, and `bb_impact` chooses.
 *
 * bash has no type synonyms, but it has the same shape by another route: a `local`
 * in two functions is two declarations of one name, and the graph cannot say which
 * a `uses` edge means. This measures it rather than assuming it is absent.
 *
 * Counted per type, over edges whose TARGET is present in the file at all, because
 * an edge with no target cannot be ambiguous — it is simply unresolvable, and
 * `resolution` already reports that.
 */
const ambiguity = new Map<Type, { targetPresent: number; targetMulti: number }>()
const ambiguityExamples: string[] = []

let emptyNameSymbols = 0
let emptyNameExamples: string[] = []
let unknownKindSymbols = 0
let unknownEndpointEdges = 0
let unknownEndpointExamples: string[] = []
let emptyEndpointEdges = 0
let emptyEndpointExamples: string[] = []
let totalSymbols = 0
let totalRelationships = 0
let parseFailures = 0
// Round 9. `fallbackFiles` is the count of files production `parseFile` could not
// read with the grammar and answered with `extractFallback` instead. See the call
// site for why a census that omits it cannot support a whole-corpus claim.
let fallbackFiles = 0
let realParseFiles = 0
let fallbackRelsTotal = 0
const fallbackRels = new Map<string, number>()
const fallbackExamples: string[] = []
let parseFailureExamples: string[] = []
// label checks
let containsTargetNotSymbol = 0
let containsTargetNotSymbolExamples: string[] = []
let overridesTargetNotFunction = 0
let overridesTargetNotFunctionExamples: string[] = []
let exportsTargetNotExportedSymbol = 0
let exportsTargetNotExportedExamples: string[] = []
let usesTargetIsPositional = 0
// metadata survival across the pool-worker boundary, measured on a sub-sample
const META_SAMPLE = Math.min(200, files.length)
const metaPublished = new Map<string, number>()
const metaSurvived = new Map<string, number>()
const metaPublishedTrue = new Map<string, number>()
const metaSurvivedTrue = new Map<string, number>()
let metaSubSampleFiles = 0
// `calls` split by the analyzer's own isFunctionCall flag: a call to a name THIS
// file declares must resolve to that function's symbol, or the flag is a lie.
let callsLocal = 0
let callsLocalTargetResolves = 0
let callsLocalUnresolvedExamples: string[] = []
let callsExternal = 0
let callsExternalTargetResolves = 0
// endpoint identity: does `references` carry anything `imports` does not?
const importsKeys = new Set<string>()
const referencesKeys = new Set<string>()

// damage, measured on the same parse the production path saw
let damagedCommandEdges = 0
let damagedCommandExamples: string[] = []
let damagedFileCount = 0

const bumpRel = (t: Type, n: number) => relCounts.set(t, (relCounts.get(t) ?? 0) + n)
const noteFile = (t: Type, label: string) => {
  const s = relFiles.get(t) ?? new Set<string>()
  if (s.size < 6) s.add(label)
  relFiles.set(t, s)
  const c = relFileCount.get(t) ?? new Set<string>()
  c.add(label)
  relFileCount.set(t, c)
}
const noteExample = (t: Type, label: string) => {
  const a = relExamples.get(t) ?? []
  if (a.length < 6) a.push(label)
  relExamples.set(t, a)
}

// ------------------------------------------------- tree walk for damage count
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-bash.wasm"))))

/** Every `command` node whose own subtree or name-ancestor chain is damaged. */
const damagedCommands = (root: any): { name: string; line: number }[] => {
  const out: { name: string; line: number }[] = []
  const visit = (n: any) => {
    if (n.type === "command") {
      let damaged = false
      // subtree damage
      const st: any[] = [n]
      while (st.length > 0) {
        const x = st.pop()
        if (x.type === "ERROR" || x.isMissing) { damaged = true; break }
        for (let i = 0; i < x.childCount; i++) st.push(x.child(i))
      }
      if (!damaged) {
        // ancestor damage up to the enclosing statement
        let p = n.parent
        let depth = 0
        while (p && depth < 8) {
          if (p.type === "ERROR" || p.isMissing) { damaged = true; break }
          if (p.type === "list" || p.type === "program" || p.type === "compound_statement") break
          p = p.parent
          depth++
        }
      }
      if (damaged) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "command_name") {
            for (let j = 0; j < c.namedChildCount; j++) {
              const w = c.namedChild(j)
              if (w && w.type === "word") out.push({ name: w.text, line: n.startPosition.row + 1 })
            }
            if (c.namedChildCount === 0) out.push({ name: c.text, line: n.startPosition.row + 1 })
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)
  return out
}

const isPositional = (s: string): boolean => {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/** The 1-based source line, trimmed, for a spot-check row. */
const sourceLine = (text: string, line: number): string => {
  const rows = text.split("\n")
  return (rows[line - 1] ?? "").trim()
}

// ------------------------------------------------------------------- the run
let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch {
      parseFailures++
      if (parseFailureExamples.length < 6) parseFailureExamples.push(label)
      continue
    }
    if (!r || r.success === false) {
      parseFailures++
      if (parseFailureExamples.length < 6) parseFailureExamples.push(label)
      continue
    }

    // `fallback: true` means production `parseFile` could NOT read this file with
    // the tree-sitter grammar and substituted `extractFallback` — a LINE-AND-REGEX
    // extractor that emits `calls`, `instantiates`, `contains` and `references`
    // from text, with none of this lane's analysis behind them. A census that does
    // not count these cannot tell "the analyzer found nothing" from "the analyzer
    // never ran", and those are opposite findings.
    //
    // This counter is the reason the `--all` column of the doc can be read as a
    // whole-corpus claim. It was added in round 9 after round 8 published the
    // opposite conclusion — see the note on `fallback` in the doc's round 9
    // section: round 8 attributed 3,634 corpus-wide failures to the pinned wasm,
    // and they were a missing `tree.delete()` in a sibling probe.
    if (r.fallback === true) {
      fallbackFiles++
      if (fallbackExamples.length < 6) fallbackExamples.push(label)
      for (const x of (r.relationships ?? [])) {
        const t = String(x?.type ?? x?.relationshipType ?? "").toLowerCase()
        fallbackRels.set(t, (fallbackRels.get(t) ?? 0) + 1)
      }
      fallbackRelsTotal += (r.relationships ?? []).length
    } else {
      realParseFiles++
    }

    const symbols: any[] = r.symbols ?? []
    totalSymbols += symbols.length
    const byName = new Set<string>()
    const byNameKind = new Map<string, Set<string>>()
    // How many PUBLISHED SYMBOLS carry each name. `byName` is a set and therefore
    // cannot answer the ambiguity question; this can.
    const symbolCountByName = new Map<string, number>()
    const symbolLinesByName = new Map<string, number[]>()
    for (const s of symbols) {
      const nm = String(s?.name ?? "")
      if (nm.length === 0) {
        emptyNameSymbols++
        if (emptyNameExamples.length < 6) emptyNameExamples.push(label)
      }
      const kind = String(s?.kind ?? "")
      kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1)
      if (kind.length === 0 || kind === "unknown") unknownKindSymbols++
      if (nm.length > 0) {
        byName.add(nm)
        const k = byNameKind.get(nm) ?? new Set<string>()
        k.add(kind)
        byNameKind.set(nm, k)
        symbolCountByName.set(nm, (symbolCountByName.get(nm) ?? 0) + 1)
        // The line is `startLine`. This column read `s.line_number ?? s.range?.start?.line`
        // for its whole life and `parseFile` publishes NEITHER — it reshapes every
        // symbol to `startLine`/`endLine` (see the comment at the reshape site below).
        // Every candidate therefore printed as line 0, which made the table unable to
        // support the claim built on it: the fix is `startLine` first, and the two dead
        // spellings are kept only so the probe still works if a caller hands it a raw
        // `analyze()` result.
        const lines = symbolLinesByName.get(nm) ?? []
        if (lines.length < 4) lines.push(Number(s?.startLine ?? s?.line_number ?? s?.range?.start?.line ?? 0))
        symbolLinesByName.set(nm, lines)
      }
    }

    const rels: any[] = r.relationships ?? []
    totalRelationships += rels.length

    // damage census on the same source the production path parsed
    let damaged: { name: string; line: number }[] = []
    try {
      const t = parser.parse(f.text)
      if (t) {
        damaged = damagedCommands(t.rootNode)
        if (damaged.length > 0) damagedFileCount++
        t.delete?.()
      }
    } catch {
      /* the production path already recorded its own outcome */
    }
    const damagedNames = new Set(damaged.map((d) => `${d.name}@${d.line}`))

    for (const x of rels) {
      const t = String(x?.type ?? x?.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const src = String(x?.source ?? "")
      const tgt = String(x?.target ?? "")
      bumpRel(t, 1)
      noteFile(t, label)
      noteExample(t, `${label}: ${src} -[${t}]-> ${tgt}`)

      // R7: the placeholder endpoint.
      if (src === "unknown" || tgt === "unknown") {
        unknownEndpointEdges++
        if (unknownEndpointExamples.length < 6) unknownEndpointExamples.push(`${label}: ${src} -[${t}]-> ${tgt}`)
      }
      if (src.length === 0 || tgt.length === 0) {
        emptyEndpointEdges++
        if (emptyEndpointExamples.length < 6) emptyEndpointExamples.push(`${label}: "${src}" -[${t}]-> "${tgt}"`)
      }

      // confidence bands
      const band = confidenceBands.get(t) ?? { under07: 0, total: 0 }
      band.total++
      const c = typeof x?.confidence === "number" ? x.confidence : 1
      if (c < 0.7) band.under07++
      confidenceBands.set(t, band)

      // evidence class
      const ec = String((x?.metadata ?? {}).evidenceClass ?? "(none)")
      const ecm = evidenceClasses.get(t) ?? new Map<string, number>()
      ecm.set(ec, (ecm.get(ec) ?? 0) + 1)
      evidenceClasses.set(t, ecm)

      // resolution
      const sOk = byName.has(src)
      const tOk = byName.has(tgt)
      const r = resolution.get(t) ?? { both: 0, srcOnly: 0, tgtOnly: 0, neither: 0 }
      if (sOk && tOk) r.both++
      else if (sOk) r.srcOnly++
      else if (tOk) r.tgtOnly++
      else r.neither++
      resolution.set(t, r)

      // ambiguity: a target that is present AND published more than once
      if (tOk) {
        const amb = ambiguity.get(t) ?? { targetPresent: 0, targetMulti: 0 }
        amb.targetPresent++
        const n = symbolCountByName.get(tgt) ?? 0
        if (n > 1) {
          amb.targetMulti++
          if (ambiguityExamples.length < 12) {
            ambiguityExamples.push(
              `${label}: ${src} -[${t}]-> ${tgt}  ${n} symbols named ${tgt} at lines ${(symbolLinesByName.get(tgt) ?? []).slice(0, 4).join(",")}${n > 4 ? " (first 4 of " + n + ")" : ""} kinds ${[...(byNameKind.get(tgt) ?? [])].join("/")}`,
            )
          }
        }
        ambiguity.set(t, amb)
      }

      // label checks
      if (t === "contains") {
        if (!tOk) {
          containsTargetNotSymbol++
          if (containsTargetNotSymbolExamples.length < 8) containsTargetNotSymbolExamples.push(`${label}: ${src} -> ${tgt}`)
        }
      } else if (t === "overrides") {
        const kinds = byNameKind.get(tgt)
        if (!kinds || !kinds.has("function")) {
          overridesTargetNotFunction++
          if (overridesTargetNotFunctionExamples.length < 8) overridesTargetNotFunctionExamples.push(`${label}: ${src} -> ${tgt} kinds=${kinds ? [...kinds].join("/") : "(none)"}`)
        }
      } else if (t === "exports") {
        // NOT checked here, and the reason is a measurement rather than a style
        // choice. `parseFile` re-shapes every symbol (src/ast/pool-worker.ts): the
        // analyzer's `metadata` object survives only for an allowlist written for
        // CSS, Markdown and generic keys, so `sym.metadata?.isExported` reads
        // `undefined` for EVERY exported name and this check reported 20 of 20
        // (100%) as missing. The analyzer is correct — verified through
        // `analyze()` in probe-bash-exports.mts — and the instrument was wrong.
        // Symbol-metadata consistency is therefore measured in
        // `probe-bash-exports.mts`, which goes through the analyzer directly, and
        // the metadata-survival rate is reported below.
      } else if (t === "uses") {
        if (isPositional(tgt)) usesTargetIsPositional++
      } else if (t === "calls") {
        const meta = x?.metadata ?? {}
        if (meta.isFunctionCall === true) {
          callsLocal++
          if (tOk) callsLocalTargetResolves++
          else if (callsLocalUnresolvedExamples.length < 8) {
            callsLocalUnresolvedExamples.push(`${label}: calls -> ${tgt} (isFunctionCall=true, no such symbol) line ${x?.line_number}: ${sourceLine(f.text, Number(x?.line_number))}`)
          }
        } else {
          callsExternal++
          if (tOk) callsExternalTargetResolves++
        }
      }

      if (t === "imports") importsKeys.add(`${src}\u0000${tgt}\u0000${x?.line_number ?? ""}`)
      if (t === "references") referencesKeys.add(`${src}\u0000${tgt}\u0000${x?.line_number ?? ""}`)

      if (t === "calls" && damagedNames.has(`${tgt}@${x?.line_number}`)) {
        damagedCommandEdges++
        if (damagedCommandExamples.length < 12) {
          damagedCommandExamples.push(`${label}: calls -> ${tgt} @${x?.line_number} :: ${sourceLine(f.text, Number(x?.line_number)).slice(0, 110)}`)
        }
      }
    }
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

// ------------------------------------- metadata survival at the worker boundary
//
// `parseFile` re-shapes every symbol: `range` becomes startLine/endLine and the
// analyzer's `metadata` object is forwarded only for an allowlist. So a fact the
// analyzer publishes can be invisible to the store while every fixture — which
// reads the analyzer's return value, never the worker's — still passes. That is
// the M14 #290 markdown failure mode, and it is measured here rather than read
// off pool-worker.ts: the SAME file goes through `analyze()` (what the analyzer
// publishes) and through `parseFile` (what survives), and the two key sets are
// differenced. Sub-sample, stated, because it parses each file twice.
{
  const { ASTEngine } = await import("../../../../src/ast/engine")
  const { RealBashAnalyzer } = await import("../../../../src/ast/real-bash-analyzer")
  const analyzer = new RealBashAnalyzer()
  const bashParser = await ASTEngine.getParser("bash")
  for (let i = 0; i < META_SAMPLE; i++) {
    const f = files[i]
    let published: Set<string> | null = null
    let survived: Set<string> | null = null
    // The AFFIRMATIVE half, kept separately. `pool-worker.ts` forwards a boolean flag
    // only when it is `true` (`if (m.isExported === true)`), so "the key is present
    // downstream" and "the fact the key carries is downstream" are different questions
    // and only the second one is the one a consumer can act on. Measured: `readonly`
    // publishes `isExported: false` in 2 of the 105 files, and counting that as a
    // publication made the correct refusal to forward a negative read as a 13.3% loss.
    let publishedTrue: Set<string> | null = null
    let survivedTrue: Set<string> | null = null
    try {
      const tree = bashParser!.parse(f.text)
      if (tree) {
        const a: any = analyzer.analyze(tree.rootNode, f.text, f.abs)
        published = new Set<string>()
        publishedTrue = new Set<string>()
        for (const s of a.symbols ?? []) {
          for (const [k, v] of Object.entries((s as any)?.metadata ?? {})) {
            published.add(k)
            if (v === true) publishedTrue.add(k)
          }
        }
        tree.delete?.()
      }
      const p: any = await parseFile(f.abs, f.dir)
      if (p && p.success !== false) {
        survived = new Set<string>()
        survivedTrue = new Set<string>()
        for (const s of p.symbols ?? []) {
          for (const [k, v] of Object.entries((s as any)?.metadata ?? {})) {
            survived.add(k)
            if (v === true) survivedTrue.add(k)
          }
        }
      }
    } catch {
      continue
    }
    if (!published || !survived || !publishedTrue || !survivedTrue) continue
    metaSubSampleFiles++
    for (const k of published) {
      metaPublished.set(k, (metaPublished.get(k) ?? 0) + 1)
      if (survived.has(k)) metaSurvived.set(k, (metaSurvived.get(k) ?? 0) + 1)
    }
    for (const k of publishedTrue) {
      metaPublishedTrue.set(k, (metaPublishedTrue.get(k) ?? 0) + 1)
      if (survivedTrue.has(k)) metaSurvivedTrue.set(k, (metaSurvivedTrue.get(k) ?? 0) + 1)
    }
  }
}

// ------------------------------------------------------------------- report
const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

console.log(`bash ontology census — production parseFile`)
console.log(`corpus root : ${CR}`)
console.log(`repos       : ${repos.size}${REPO ? ` (restricted to ${REPO})` : ""} of ${reposSeen} git repos`)
console.log(`tracked     : ${trackedTotal} files listed by git ls-files`)
console.log(`scanned     : ${scanned} of those present in the working tree and read`)
console.log(`absent      : ${absentFromWorktree} tracked files ABSENT from the working tree, never read here`)
// The pin this run's numbers belong to. Without it every per-type column in the
// doc is a claim about an unnamed corpus, which is limitation 14 stated and
// unchecked. `probe-bash-corpus-pin.mts --expect <setHash>` is the check.
console.log(`setHash     : ${admittedSetHash}`)
console.log(`admitted    : ${totalAdmitted} files routed to bash by detectLanguageFromPath`)
console.log(`sampled     : ${files.length} files, hash order (sha256 of repo/rel, ascending)${ALL ? " [all]" : ""}`)
console.log(`symbols     : ${totalSymbols}`)
console.log(`rels        : ${totalRelationships}`)
console.log(`parse fail  : ${parseFailures}${parseFailureExamples.length ? ` e.g. ${parseFailureExamples[0]}` : ""}`)
// The line that makes the row above mean something. `parse fail` counts files
// parseFile REJECTED; this counts files it answered WITHOUT the grammar. A file in
// this row contributed edges from `extractFallback`'s regex extractor, not from
// this analyzer, and every per-type total above includes them.
console.log(`grammar-read: ${realParseFiles} files parsed with the tree-sitter grammar`)
console.log(`FALLBACK    : ${fallbackFiles} files answered by extractFallback (regex extractor, NOT this analyzer)${fallbackExamples.length ? ` e.g. ${fallbackExamples[0]}` : ""}`)
if (fallbackFiles > 0) {
  console.log(`             : ${fallbackRelsTotal} relationships came from those files — ${JSON.stringify(Object.fromEntries([...fallbackRels].sort((a, b) => b[1] - a[1])))}`)
}

console.log(`\n${w("type", 14)}${w("edges", 10)}${w("files", 8)}${w("ex", 5)}${w("both-ends", 12)}${w("src-only", 10)}${w("tgt-only", 10)}${w("neither", 10)}${w("<0.7 conf", 12)}evidenceClass`)
console.log("-".repeat(124))
for (const t of ALL_TYPES) {
  const n = relCounts.get(t) ?? 0
  const r = resolution.get(t) ?? { both: 0, srcOnly: 0, tgtOnly: 0, neither: 0 }
  const b = confidenceBands.get(t) ?? { under07: 0, total: 0 }
  const ecs = [...(evidenceClasses.get(t) ?? new Map<string, number>()).entries()].map(([k, v]) => `${k}:${v}`).join(" ")
  console.log(
    `${w(t, 14)}${w(n.toLocaleString(), 10)}${w((relFileCount.get(t)?.size ?? 0).toLocaleString(), 8)}${w(relFiles.get(t)?.size ?? 0, 5)}` +
      `${w(`${r.both} ${pct(r.both, n)}`, 12)}${w(`${r.srcOnly} ${pct(r.srcOnly, n)}`, 10)}${w(`${r.tgtOnly} ${pct(r.tgtOnly, n)}`, 10)}${w(`${r.neither} ${pct(r.neither, n)}`, 10)}` +
      `${w(`${b.under07} ${pct(b.under07, b.total)}`, 12)}${ecs}`,
  )
}
console.log(`  files = distinct admitted files the type fired in (exact). ex = the capped example list, which is NOT a count.`)

console.log(`\nambiguity — an edge target matching MORE THAN ONE published symbol in the same file`)
console.log(`  (measured only over edges whose target IS present; an absent target is unresolvable, not ambiguous)`)
console.log(`  ${w("type", 14)}${w("target present", 16)}${w("of those, multi", 16)}rate`)
for (const t of ALL_TYPES) {
  const a = ambiguity.get(t) ?? { targetPresent: 0, targetMulti: 0 }
  if (a.targetPresent === 0) continue
  console.log(`  ${w(t, 14)}${w(a.targetPresent.toLocaleString(), 16)}${w(a.targetMulti.toLocaleString(), 16)}${pct(a.targetMulti, a.targetPresent)}`)
}
if (ambiguityExamples.length > 0) {
  console.log(`  examples:`)
  for (const e of ambiguityExamples) console.log(`      ${e}`)
}

console.log(`\nsymbol hygiene`)
console.log(`  SymbolKind values observed : ${[...kindCounts.entries()].map(([k, v]) => `${k}=${v.toLocaleString()}`).join(", ")}`)
console.log(`  empty/unknown kind         : ${unknownKindSymbols}`)
console.log(`  symbols with empty name    : ${emptyNameSymbols}${emptyNameExamples.length ? ` e.g. ${emptyNameExamples[0]}` : ""}`)
console.log(`  edges with 'unknown' end   : ${unknownEndpointEdges}${unknownEndpointExamples.length ? ` e.g. ${unknownEndpointExamples[0]}` : ""}`)
console.log(`  edges with an empty end    : ${emptyEndpointEdges}${emptyEndpointExamples.length ? ` e.g. ${emptyEndpointExamples[0]}` : ""}`)

console.log(`\nlabel checks`)
console.log(`  contains target not a symbol in its file : ${containsTargetNotSymbol}${containsTargetNotSymbolExamples.length ? ` e.g. ${containsTargetNotSymbolExamples[0]}` : ""}`)
console.log(`  overrides target not a function symbol   : ${overridesTargetNotFunction}${overridesTargetNotFunctionExamples.length ? ` e.g. ${overridesTargetNotFunctionExamples[0]}` : ""}`)
console.log(`  exports target without isExported symbol : measured in probe-bash-exports.mts (analyze() path); 0 of 5 on the two files probed`)
console.log(`  uses target is a positional parameter    : ${usesTargetIsPositional}`)
console.log(`  calls isFunctionCall=true                : ${callsLocal}, target resolves to a function symbol: ${callsLocalTargetResolves} (${pct(callsLocalTargetResolves, callsLocal)})`)
for (const e of callsLocalUnresolvedExamples) console.log(`      ${e}`)
console.log(`  calls isExternalCommand=true             : ${callsExternal}, target happens to be a symbol: ${callsExternalTargetResolves} (${pct(callsExternalTargetResolves, callsExternal)})`)
const refsOnly = [...referencesKeys].filter((k) => !importsKeys.has(k))
const impsOnly = [...importsKeys].filter((k) => !referencesKeys.has(k))
console.log(`  references keys: ${referencesKeys.size}, of which NOT identical to an imports key: ${refsOnly.length}`)
console.log(`  imports    keys: ${importsKeys.size}, of which NOT identical to a references key: ${impsOnly.length}`)
if (refsOnly.length) console.log(`    references-only e.g. ${refsOnly[0]}`)
if (impsOnly.length) console.log(`    imports-only e.g. ${impsOnly[0]}`)

console.log(`\nmetadata survival across the pool-worker boundary (${metaSubSampleFiles} files, each parsed twice)`)
console.log(`  KEY PRESENT vs KEY TRUE. These are different questions and the earlier revision of this`)
console.log(`  census conflated them, which made \`isExported\` read 86.7% when the affirmative survives at`)
console.log(`  100%. \`readonly x=1\` publishes \`isExported: false\` — a CORRECT negative, since a readonly`)
console.log(`  constant is not exported — and pool-worker.ts:1093 forwards \`if (m.isExported === true)\`,`)
console.log(`  so the key is absent downstream BY DESIGN. Counting presence counted a negative as a`)
console.log(`  publication and then reported the worker's correct refusal to forward it as a loss. The`)
console.log(`  per-SYMBOL measurement over every file carrying an exports edge is`)
console.log(`  probe-bash-exported-symbol-survival.mts: 144 of 144 exported symbols keep the affirmative.`)
for (const [k, v] of [...metaPublished.entries()].sort((a, b) => b[1] - a[1])) {
  const s = metaSurvived.get(k) ?? 0
  const t = metaPublishedTrue.get(k) ?? 0
  const ts = metaSurvivedTrue.get(k) ?? 0
  const truthyOnly = t > 0
  console.log(`  ${k.padEnd(22)} key present in ${String(v).padStart(6)} files, survives in ${String(s).padStart(6)} (${pct(s, v)})`)
  if (truthyOnly) console.log(`  ${"".padEnd(22)}   … of those, TRUE in ${String(t).padStart(6)} files, survives in ${String(ts).padStart(6)} (${pct(ts, t)})  <- the number that answers the consumer's question`)
  else console.log(`  ${"".padEnd(22)}   … never published as \`true\`, so key-presence is the whole of it`)
}
console.log(`\ndamage region (measured for the guard A/B in guard-ab-bash-calls.ts; this file only counts)`)
console.log(`  files with >=1 damaged command : ${damagedFileCount}`)
console.log(`  calls edges emitted from one   : ${damagedCommandEdges}`)
if (damagedCommandExamples.length) for (const e of damagedCommandExamples) console.log(`    ${e}`)

console.log(`\nexamples per emitted type`)
for (const t of ALL_TYPES) {
  const ex = relExamples.get(t) ?? []
  if (ex.length === 0) continue
  console.log(`  ${t}:`)
  for (const e of ex) console.log(`    ${e}`)
}

if (OUT) {
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        corpusRoot: CR,
        repos: [...repos],
        scanned,
        admitted: totalAdmitted,
        sampled: files.length,
        totalSymbols,
        totalRelationships,
        parseFailures,
        relCounts: Object.fromEntries([...relCounts]),
        relFiles: Object.fromEntries([...relFiles].map(([k, v]) => [k, [...v]])),
        relFileCount: Object.fromEntries([...relFileCount].map(([k, v]) => [k, v.size])),
        resolution: Object.fromEntries(resolution),
        confidence: Object.fromEntries(confidenceBands),
        evidenceClasses: Object.fromEntries([...evidenceClasses].map(([k, v]) => [k, Object.fromEntries(v)])),
        kindCounts: Object.fromEntries(kindCounts),
        emptyNameSymbols,
        unknownKindSymbols,
        unknownEndpointEdges,
        emptyEndpointEdges,
        containsTargetNotSymbol,
        overridesTargetNotFunction,
        exportsTargetNotExportedSymbol,
        usesTargetIsPositional,
        callsLocal,
        callsLocalTargetResolves,
        callsExternal,
        callsExternalTargetResolves,
        importsKeys: importsKeys.size,
        referencesKeys: referencesKeys.size,
        referencesOnlyKeys: refsOnly.length,
        importsOnlyKeys: impsOnly.length,
        damagedFileCount,
        damagedCommandEdges,
      },
      null,
      2,
    ),
  )
  console.log(`\nwrote ${OUT}`)
}
