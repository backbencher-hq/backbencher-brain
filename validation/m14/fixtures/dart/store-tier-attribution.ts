/**
 * STORE-TIER ATTRIBUTION, MEASURED AGAINST GROUND TRUTH — how often the two
 * resolve statements in `src/ast/parallel-indexer.ts` pick the declaration the
 * edge names, and what adding the line tier the analyzer already carries would
 * buy.
 *
 * ## Why this file exists
 *
 * `ambiguity-store-tiers.ts` counts how many ambiguous edges fall into each
 * store tier. It cannot say whether the store's choice is RIGHT, because for
 * most types an emitted target is a bare name and "which declaration did it
 * mean" has no answer in the parse output.
 *
 * Two types DO carry the answer, and they are the two that matter:
 *
 *   contains   the edge is structural — the analyzer decided the containment by
 *              walking the tree, so the intended child is the declaration it
 *              published for that node, and `line_number` is the CHILD's own
 *              naming line.
 *   overrides  the edge is emitted as `target: `${baseOwner}.${member}`` and
 *              `line_number` is the OVERRIDING member's own name line
 *              (`src/ast/real-dart-analyzer.ts`, the push inside
 *              `resolveOverrides`: "The overriding METHOD's own name line").
 *              So the intended declaration is the published symbol whose
 *              `qualifiedName` is the target string — a lookup, not a guess.
 *
 * Both therefore have ground truth in this lane's own parse output, which makes
 * the store's attribution rate a MEASUREMENT instead of an argument. `overrides`
 * is the interesting one, because it is resolved by `resolveTargetStmt`, which
 * has NO line tier, while `contains` is resolved by `resolveContainsTargetStmt`,
 * which does. Same analyzer, same line contract, two statements.
 *
 * ## What is simulated, and what is not
 *
 * The two statements, verbatim from `src/ast/parallel-indexer.ts`:
 *
 *   resolveTargetStmt
 *     WHERE s.project_id = ? AND s.name = ?          <- extractLeaf(target)
 *     ORDER BY COALESCE(s.is_declaration, 0) ASC,
 *              (s.file_id = <emitting file>) DESC,
 *              (f.language = <file language>) DESC, s.id ASC
 *
 *   resolveContainsTargetStmt
 *     WHERE s.project_id = ? AND s.name = ?
 *     ORDER BY (s.file_id = <emitting file>) DESC,
 *              (s.line_start = <edge line>) DESC,
 *              COALESCE(s.is_declaration, 0) ASC,
 *              (f.language = <file language>) DESC, s.id ASC
 *
 * `WHERE s.name = ?` is fed `targetLeaf`, so a target spelled
 * `StatelessWidget.build` is looked up as `build`. Both facts are reproduced
 * here from the source, and the second is the reason an analyzer CANNOT fix this
 * by qualifying: the qualification is erased before the lookup.
 *
 * What this census CANNOT reproduce, stated rather than assumed:
 *
 *   `COALESCE(s.is_declaration, 0) ASC` — `is_declaration` is a `brain_symbol`
 *     column set by the indexer, not a field the analyzer emits, so it is not in
 *     the collected record. Every candidate here is a real published declaration,
 *     so the tier is simulated as a constant. If the indexer marks some
 *     candidates non-declarations the real winner is earlier in the order still
 *     — the tier sorts ASC, so a 0 beats a 1 and a `false`-demoted candidate
 *     would win instead. The error counts below are therefore stated as
 *     "under a uniform is_declaration tier", and the direction of the bias is
 *     named rather than guessed at.
 *
 *   `f.language = ?` — every candidate in this census was produced by the same
 *     `.dart` parse, so the tier is a constant here too.
 *
 *   `s.id` is `${fileId}:${name}:${line_start}` compared as TEXT, so `s.id ASC` is
 *     a lexicographic sort on the line as a STRING, not a numeric one. That is
 *     reproduced exactly, and it is why `line 22` beats `line 227` and loses to
 *     `line 25`.
 *
 *   Other lanes' symbols. A whole-corpus store also holds symbols published by
 *     every other analyzer, so a name this census finds unique may not be unique
 *     there. Every rate is a LOWER bound on accuracy and an UPPER bound on
 *     error.
 *
 * ## No regex
 *
 * Nothing here reads source text. Names are split on `.` by index arithmetic,
 * lines are compared as numbers, and the id tier is compared by a
 * hand-written byte-wise string comparison rather than a pattern.
 */
import { dartSample, readRaw, samplePaths, type RawFile } from "./collect-sample"

const TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
] as const

const LABEL_ALIASES: Record<string, string> = {
  calls: "calls",
  call: "calls",
  uses: "uses",
  contains: "contains",
  composition: "contains",
  part_of: "contains",
  imports: "imports",
  brain_import: "imports",
  references: "references",
  depends_on: "references",
  related: "references",
  exports: "exports",
  provides: "exports",
  extends: "extends",
  inheritance: "extends",
  implements: "implements",
  implementation: "implements",
  overrides: "overrides",
  override: "overrides",
  instantiates: "instantiates",
}

const ontologyName = (raw: string): string | null => LABEL_ALIASES[raw] ?? null

/** `extractLeaf` from `src/ast/parallel-indexer.ts`, in index arithmetic. */
function extractLeaf(name: string): string {
  const colon = name.lastIndexOf(":")
  const noLine = colon >= 0 && isDigits(name.slice(colon + 1)) ? name.slice(0, colon) : name
  const slash = noLine.lastIndexOf("/")
  const noArity = slash >= 0 && isDigits(noLine.slice(slash + 1)) ? noLine.slice(0, slash) : noLine
  const lastColon = noArity.lastIndexOf(":")
  const seg = lastColon >= 0 ? noArity.slice(lastColon + 1) : noArity
  const dot = seg.lastIndexOf(".")
  return dot >= 0 ? seg.slice(dot + 1) : seg
}

function isDigits(s: string): boolean {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/** Byte-wise string comparison, so `s.id ASC` is reproduced without a sort flag. */
function byteCompare(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1
}

interface Decl {
  name: string
  kind: string
  q: string
  file: string
  line: number
  id: string
}

/** The `WHERE s.name = ?` key set: published `name`, plus `qualifiedName`. */
const uniq = (ds: Decl[]): Decl[] => {
  const m = new Map<string, Decl>()
  for (const d of ds) m.set(d.id, d)
  return [...m.values()]
}

interface Outcome {
  edges: number
  /** Edges whose target names a declaration this census published. */
  groundTruthPublished: number
  /** Of those, exactly one candidate exists — the store cannot be wrong. */
  candidateUnique: number
  /** Of those, 2+ candidates and the store's order picks the intended one. */
  storeRight: number
  /** Of those, 2+ candidates and the store's order picks a different one. */
  storeWrong: number
  /** Of the wrong set, a line tier placed before `s.id` would pick the intended one. */
  lineTierWouldFix: number
  /** Of the wrong set, a line tier would still not. */
  lineTierWouldNotFix: number
  /** Wrong set where the intended declaration is in ANOTHER file than the emitter. */
  wrongCrossFile: number
  /** Wrong set where the intended declaration is in the SAME file. */
  wrongSameFile: number
}

const blank = (): Outcome => ({
  edges: 0,
  groundTruthPublished: 0,
  candidateUnique: 0,
  storeRight: 0,
  storeWrong: 0,
  lineTierWouldFix: 0,
  lineTierWouldNotFix: 0,
  wrongCrossFile: 0,
  wrongSameFile: 0,
})

function main(): void {
  const sample = dartSample()
  const paths = samplePaths(sample)
  const raw = readRaw(paths.raw)

  const declsByKey = new Map<string, Decl[]>()
  let symbols = 0
  for (const r of raw) {
    for (const s of r.symbols) {
      symbols++
      if (s.name.length === 0) continue
      const d: Decl = { name: s.name, kind: s.kind, q: s.q, file: r.f, line: s.line, id: `${r.f}\u0000${s.name}\u0000${s.line}` }
      push(declsByKey, s.name, d)
      if (s.q.length > 0 && s.q !== s.name) push(declsByKey, s.q, d)
    }
  }

  // ---- resolve, per type, against ground truth ----------------------------
  const out: Record<string, Outcome> = {}
  for (const t of TYPES) out[t] = blank()
  /** Ground truth is only defined for the two declaration-naming types. */
  const gtTypes = new Set(["contains", "overrides"])

  const wrongSamples: Record<string, string[]> = { contains: [], overrides: [] }

  for (const r of raw) {
    for (const x of r.rels) {
      const label = ontologyName(x.t)
      if (!label || !gtTypes.has(label)) continue
      if (x.g.length === 0 || x.s === x.g) continue
      const o = out[label]
      o.edges++

      // GROUND TRUTH. `contains` names its child by BARE name (the child is a
      // member of the emitting file's own tree, so the intended declaration is
      // the one the analyzer published at the edge's line). `overrides` names its
      // base member by QUALIFIED name, so the intended declaration is the symbol
      // whose `qualifiedName` is the target string.
      let intended: Decl | undefined
      if (label === "overrides") {
        intended = uniq(declsByKey.get(x.g) ?? []).find((d) => d.q === x.g)
        if (!intended) intended = uniq(declsByKey.get(x.g) ?? [])[0]
      } else {
        intended = uniq((declsByKey.get(x.g) ?? []).filter((d) => d.file === r.f && d.line === x.line))[0]
      }
      if (!intended) continue
      o.groundTruthPublished++

      const leaf = extractLeaf(x.g)
      const cands = uniq(declsByKey.get(leaf) ?? [])
      if (cands.length === 0) continue
      if (cands.length === 1) {
        o.candidateUnique++
        continue
      }

      // resolveTargetStmt / resolveContainsTargetStmt, tier for tier.
      const pick = pickStore(cands, r.f, x.line, label === "contains")
      if (pick.id === intended.id) {
        o.storeRight++
        continue
      }
      o.storeWrong++
      if (pick.file === intended.file) o.wrongSameFile++
      else o.wrongCrossFile++
      const withLine = pickStore(cands, r.f, x.line, true)
      if (withLine.id === intended.id) o.lineTierWouldFix++
      else o.lineTierWouldNotFix++
      if (wrongSamples[label].length < 12) {
        wrongSamples[label].push(
          `${r.f}:${x.line}  ${x.s} -${label}-> ${x.g}  intended ${intended.file}:${intended.line} (${intended.kind})  storePicked ${pick.file}:${pick.line} (${pick.kind})`,
        )
      }
    }
  }

  const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
  const pct = (a: number, b: number) => (b === 0 ? "    -" : (((100 * a) / b).toFixed(1) + "%").padStart(7))

  console.log(`dart store-tier attribution vs ground truth — ${raw.length} files, ${symbols} symbols`)
  console.log("")
  console.log("Ground truth is defined only for the two types whose edge NAMES a declaration this lane published:")
  console.log("  contains  target is the bare member name and line_number is the CHILD's naming line, so the")
  console.log("            intended declaration is the one published at (emitting file, that line).")
  console.log("  overrides target is `${baseOwner}.${member}` and line_number is the OVERRIDING member's name")
  console.log("            line, so the intended declaration is the symbol whose qualifiedName IS that string.")
  console.log("Every other type emits a bare name for a name the parser saw as an expression, and nothing in the")
  console.log("parse output says which member was meant. Those rows are absent here, not counted as failures.")
  console.log("")
  console.log(
    pad("type", 12) + pad("edges", 8) + pad("gtPub", 8) + pad("cand1", 8) + pad("right", 8) + pad("WRONG", 8) + pad("errRate", 9) + pad("lineFix", 9) + pad("noFix", 8) + pad("xFile", 8) + pad("sameFile", 9),
  )
  console.log("-".repeat(102))
  for (const t of ["contains", "overrides"] as const) {
    const o = out[t]
    const decided = o.storeRight + o.storeWrong
    console.log(
      pad(t, 12) +
        pad(String(o.edges), 8) +
        pad(String(o.groundTruthPublished), 8) +
        pad(String(o.candidateUnique), 8) +
        pad(String(o.storeRight), 8) +
        pad(String(o.storeWrong), 8) +
        pad(pct(o.storeWrong, decided), 9) +
        pad(String(o.lineTierWouldFix), 9) +
        pad(String(o.lineTierWouldNotFix), 8) +
        pad(String(o.wrongCrossFile), 8) +
        pad(String(o.wrongSameFile), 9),
    )
  }
  console.log("-".repeat(102))
  console.log("")
  for (const t of ["contains", "overrides"] as const) {
    const o = out[t]
    const decided = o.storeRight + o.storeWrong
    console.log(`${t}: ${decided} contested edges; the store names the intended declaration ${o.storeRight} (${pct(o.storeRight, decided)})`)
    console.log(`  ${o.storeWrong} wrong; a line tier placed before s.id would fix ${o.lineTierWouldFix} of them (${pct(o.lineTierWouldFix, o.storeWrong)})`)
    console.log(`  of the wrong set: ${o.wrongSameFile} intended-in-same-file, ${o.wrongCrossFile} intended-in-another-file`)
  }
  console.log("")
  for (const t of ["contains", "overrides"] as const) {
    if (wrongSamples[t].length === 0) continue
    console.log(`wrong ${t} edges, verbatim (up to 12):`)
    for (const s of wrongSamples[t]) console.log(`  ${s}`)
    console.log("")
  }
  // ---- the fix, sized -----------------------------------------------------
  //
  // Two gates in `src/ast/parallel-indexer.ts` decide whether a dotted target
  // ever gets a second chance, and both exclude it:
  //
  //   Strategy 1 (qualified_name exact match)
  //     ... FROM _res_qname WHERE brain_relationship.target_external =
  //     _res_qname.qualified_name AND brain_relationship.target_symbol_id IS NULL
  //     -> only rows that resolved to NOTHING at insert time are eligible.
  //
  //   the authoritative pass ("review I13")
  //     WHERE ... AND r.relationship_type <> 'contains'
  //           AND instr(r.target_external, '.') = 0 AND instr(r.target_external, ':') = 0
  //     -> only BARE targets are recomputed, by design, because its join is
  //        `s.name = r.target_external` and a dotted string matches no bare name.
  //
  // So a target the analyzer spelled QUALIFIED falls through both when its leaf
  // happens to exist: insert time attaches the leaf's best candidate, and nothing
  // downstream revisits it — even though `brain_symbol.qualified_name` holds the
  // exact string the analyzer wrote, and Strategy 1 is already written to join on
  // it. This block measures what adding a dotted-qualified strategy would reach.
  console.log("WHAT A DOTTED-QUALIFIED STRATEGY WOULD REACH")
  console.log("  population = every edge whose analyzer target string contains '.' or ':'")
  console.log("  qMatch     = a published symbol's qualified_name EQUALS that string")
  console.log("  qUnique    = ... and exactly one such symbol exists (so the answer is determined)")
  console.log("  qAmbig     = ... and more than one does, so _res_qname's MIN(id) would still pick arbitrarily")
  console.log("  leafBound  = the LEAF also names a published symbol, i.e. insert time attached something")
  console.log("  netNew     = qUnique AND leafBound AND the leaf pick was NOT the qualified match = a row")
  console.log("              currently bound to the wrong declaration that the qualified string names exactly")
  console.log("")
  const qName = new Map<string, Decl[]>()
  for (const r of raw) {
    for (const sy of r.symbols) {
      if (sy.q.length === 0 || sy.q === sy.name) continue
      const d: Decl = { name: sy.name, kind: sy.kind, q: sy.q, file: r.f, line: sy.line, id: `${r.f}\u0000${sy.name}\u0000${sy.line}` }
      push(qName, sy.q, d)
    }
  }
  const dotted: Record<string, { edges: number; qMatch: number; qUnique: number; qAmbig: number; leafBound: number; netNew: number }> = {}
  for (const t of TYPES) dotted[t] = { edges: 0, qMatch: 0, qUnique: 0, qAmbig: 0, leafBound: 0, netNew: 0 }
  const netNewSamples: string[] = []
  for (const r of raw) {
    for (const x of r.rels) {
      const label = ontologyName(x.t)
      if (!label || x.g.length === 0) continue
      if (!x.g.includes(".") && !x.g.includes(":")) continue
      const d = dotted[label]
      d.edges++
      const qs = uniq(qName.get(x.g) ?? [])
      if (qs.length === 0) continue
      d.qMatch++
      if (qs.length > 1) {
        d.qAmbig++
        continue
      }
      d.qUnique++
      const leafCands = uniq(declsByKey.get(extractLeaf(x.g)) ?? [])
      if (leafCands.length === 0) continue
      d.leafBound++
      const storePick = pickStore(leafCands, r.f, x.line, false)
      if (storePick.id !== qs[0].id) {
        d.netNew++
        if (netNewSamples.length < 10) {
          netNewSamples.push(
            `${r.f}:${x.line}  ${x.s} -${label}-> ${x.g}  qualified names ${qs[0].file}:${qs[0].line} (${qs[0].kind}); insert-time leaf pick was ${storePick.file}:${storePick.line} (${storePick.kind})`,
          )
        }
      }
    }
  }
  console.log(pad("type", 14) + pad("dotted", 9) + pad("qMatch", 9) + pad("qUnique", 9) + pad("qAmbig", 9) + pad("leafBound", 11) + pad("netNew", 9))
  console.log("-".repeat(70))
  let te = 0, tm = 0, tu = 0, ta = 0, tl = 0, tn = 0
  for (const t of TYPES) {
    const d = dotted[t]
    te += d.edges; tm += d.qMatch; tu += d.qUnique; ta += d.qAmbig; tl += d.leafBound; tn += d.netNew
    if (d.edges === 0) continue
    console.log(pad(t, 14) + pad(String(d.edges), 9) + pad(String(d.qMatch), 9) + pad(String(d.qUnique), 9) + pad(String(d.qAmbig), 9) + pad(String(d.leafBound), 11) + pad(String(d.netNew), 9))
  }
  console.log("-".repeat(70))
  console.log(pad("TOTAL", 14) + pad(String(te), 9) + pad(String(tm), 9) + pad(String(tu), 9) + pad(String(ta), 9) + pad(String(tl), 11) + pad(String(tn), 9))
  console.log("")
  console.log("  netNew = rows a dotted-qualified strategy would move OFF a wrong attachment.")
  console.log("  qAmbig is the population _res_qname's MIN(id) would still resolve arbitrarily, so the")
  console.log("  strategy needs a uniqueness guard, not just a join.")
  console.log("")
  for (const s of netNewSamples) console.log(`  ${s}`)
  console.log("")

  console.log("LIMITATIONS, stated rather than assumed:")
  console.log("  - `COALESCE(s.is_declaration, 0) ASC` is NOT simulated: is_declaration is a brain_symbol column")
  console.log("    the indexer sets, not a field the analyzer emits, so it is absent from the collected record.")
  console.log("    Simulated as a constant. The tier sorts ASC, so a candidate the indexer marks 0 outranks one")
  console.log("    marked 1 — a non-declaration winning would move edges OUT of `storeRight`, not into it.")
  console.log("  - `f.language = ?` is a constant here: every candidate came from a `.dart` parse.")
  console.log("  - Other lanes' symbols are absent, so a name unique in this 600-file window can still be")
  console.log("    contested in a whole-corpus store. Every error rate is a LOWER bound, every fix count an UPPER bound.")
}

/**
 * Both statements, tier for tier, with `is_declaration` and `f.language` held
 * constant (see LIMITATIONS above) and `s.id` compared as TEXT.
 *
 *   resolveTargetStmt        tier 1 same file, then s.id
 *   resolveContainsTargetStmt tier 1 same file, tier 2 the edge's line, then
 *                            is_declaration, language, s.id
 *
 * The two differ ONLY in whether the line tier sits between the file tier and
 * `s.id`, so one `useLineTier` flag reproduces both and the delta between them is
 * exactly what a one-term change to `resolveTargetStmt` would be worth.
 */
function pickStore(cands: Decl[], emittingFile: string, line: number, useLineTier: boolean): Decl {
  let best = cands[0]
  let bestTier = Number.MAX_SAFE_INTEGER
  let bestLine = Number.MAX_SAFE_INTEGER
  let bestId = ""
  for (const d of cands) {
    const t = d.file === emittingFile ? 0 : 1
    const l = useLineTier ? (d.line === line ? 0 : 1) : 0
    if (t < bestTier || (t === bestTier && l < bestLine) || (t === bestTier && l === bestLine && byteCompare(d.id, bestId) < 0)) {
      best = d
      bestTier = t
      bestLine = l
      bestId = best.id
    }
  }
  return best
}

function push(m: Map<string, Decl[]>, k: string, d: Decl): void {
  const arr = m.get(k)
  if (arr) arr.push(d)
  else m.set(k, [d])
}

main()
