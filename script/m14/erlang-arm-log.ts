#!/usr/bin/env bun
/**
 * THE ERLANG ARM LOG, PARSED ONCE — the shared reader for `script/m14/incoming-gate.ts`'s human
 * report, used by BOTH the cause census and the declaration generator.
 *
 * WHY A MODULE AND NOT A COPY. The cause census and the declaration generator each need TABLE 1's
 * eleven-term closure and the per-edge DUMP rows. Two copies of the same parser is one parser that
 * will be fixed in one place only — the fleet's Form 3 (a rule copied in two places is one rule that
 * will diverge, measured on the operator-name class and the extension map). So the parse lives here
 * and both consumers read it.
 *
 * WHAT IT REFUSES, AND WHY EACH REFUSAL IS A MEASUREMENT GUARD:
 *   · a truncated dump (`DUMP\tBOUND\tREACHED` / "DUMP TRUNCATED") — a partition over a prefix of
 *     the non-resolved set under-counts the wall and looks identical to a complete one;
 *   · an arm that is not a WHOLE population (parsed != sampled != corpus total) — the declaration's
 *     population string is a claim about the admitted set, and a stride is not one;
 *   · a TABLE 1 row that does not close on the ELEVEN-TERM form (collRes and amb(kind) sit BESIDE
 *     their parents and are never added);
 *   · a TABLE 1 unresolved column that disagrees with the dump's unresolved rows — a dump is not
 *     the set it claims if they differ.
 *
 * The parser does NOT classify anything; it reports what the log says. Classification is the cause
 * census's job and the declaration is the generator's.
 */
import { readFileSync } from "node:fs"

export const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of"] as const
export type RelType = (typeof ALL_TYPES)[number]
export const TERMS = ["edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved", "extOK", "extUnk", "extFAIL", "bindOK", "bindUnk", "bindFAIL", "causeOK", "causeFAIL"] as const
export type Terms = Record<(typeof TERMS)[number], number>

export interface DumpRow {
  label: string
  outcome: string
  target: string
  srcFile: string
  line: number
  claimKind: string
  bindReason: string
  reasonCode: string
}

export interface ArmLog {
  path: string
  population: string
  populationLine: string
  parsed: number
  sampled: number
  corpusTotal: number
  exts: string
  repos: number
  table1: Map<string, Terms>
  total: Terms
  dumpCounts: Map<string, Map<string, number>>
  /** NON-RESOLVED rows, in the arbiter's project scope — the set the wall partition is over. */
  dumpRows: DumpRow[]
  /** only the `unresolved` outcome rows. */
  unresolvedRows: DumpRow[]
}

export class ArmLogRefusal extends Error {}

export function parseArmLog(file: string): ArmLog {
  const raw = readFileSync(file, "utf8")
  const lines = raw.split("\n")
  if (lines.some((l) => l.startsWith("DUMP\tBOUND") || l.includes("DUMP TRUNCATED"))) {
    throw new ArmLogRefusal(
      "the arm log carries the DUMP BOUND marker: the dump is a PREFIX of the non-resolved set, not the whole set. Re-run with BB_DUMP_LIMIT high enough that no bound is reached.",
    )
  }
  const popLine = lines.find((l) => l.startsWith("population: "))
  if (!popLine) throw new ArmLogRefusal("the arm log carries no `population:` line; the run's population is unknown.")
  const m = /population: (\d+) parsed of (\d+) sampled \(corpus has (\d+) \.(\S+) files across (\d+) repos/.exec(popLine)
  if (!m) throw new ArmLogRefusal(`the arm's population line did not parse: "${popLine.slice(0, 160)}"`)
  const parsed = Number(m[1]), sampled = Number(m[2]), corpusTotal = Number(m[3]), exts = m[4]!, repos = Number(m[5])
  if (!(parsed === sampled && sampled === corpusTotal)) {
    throw new ArmLogRefusal(
      `the run is NOT a whole population: parsed ${parsed} of ${sampled} sampled, corpus ${corpusTotal}. ` +
        "A stride is not the admitted set, and a declaration measured on one is a claim about a different population.",
    )
  }

  const table1 = new Map<string, Terms>()
  const dumpCounts = new Map<string, Map<string, number>>()
  const dumpRows: DumpRow[] = []
  let inTable1 = false
  for (const line of lines) {
    if (line.startsWith("TABLE 1 —")) { inTable1 = true; continue }
    if (line.startsWith("TABLE 2 —")) { inTable1 = false; continue }
    if (inTable1) {
      const toks = line.trim().split(/\s+/)
      if (toks.length === 15 && (ALL_TYPES.includes(toks[0] as RelType) || toks[0] === "TOTAL") && toks.slice(1).every((t) => /^\d+$/.test(t))) {
        const [label, ...nums] = toks
        const row = {} as Terms
        TERMS.forEach((t, i) => { row[t] = Number(nums[i]) })
        table1.set(label!, row)
      }
    }
    if (line.startsWith("DUMP\t")) {
      const cols = line.split("\t")
      // DUMP · label · outcome · target · srcFile:line · claimKind · claimSpec · bindReason · reasonCode
      const at = cols[4] ?? ""
      const cut = at.lastIndexOf(":")
      const row: DumpRow = {
        label: cols[1] ?? "",
        outcome: cols[2] ?? "",
        target: cols[3] ?? "",
        srcFile: cut >= 0 ? at.slice(0, cut) : at,
        line: cut >= 0 ? Number(at.slice(cut + 1)) : 0,
        claimKind: cols[5] ?? "-",
        bindReason: cols[7] ?? "-",
        reasonCode: cols[8] ?? "-",
      }
      dumpRows.push(row)
      let per = dumpCounts.get(row.label)
      if (!per) dumpCounts.set(row.label, (per = new Map()))
      per.set(row.outcome, (per.get(row.outcome) ?? 0) + 1)
    }
  }
  const total = table1.get("TOTAL")
  if (!total) throw new ArmLogRefusal("the arm log carries no parseable TABLE 1 TOTAL row.")

  // THE ELEVEN-TERM CLOSURE. collRes and amb(kind) are SUBSETS reported beside their parents.
  for (const [label, r] of table1) {
    if (label === "TOTAL") continue
    const sum = r.resolved + r.ambDecl + r.unresolved + r.extOK + r.extUnk + r.extFAIL + r.bindOK + r.bindUnk + r.bindFAIL + r.causeOK + r.causeFAIL
    if (sum !== r.edges) {
      throw new ArmLogRefusal(`TABLE 1 does not close for "${label}" on the eleven-term form: sum ${sum} vs edges ${r.edges} (${JSON.stringify(r)})`)
    }
    if (r.collRes > r.resolved) throw new ArmLogRefusal(`TABLE 1: collRes ${r.collRes} > resolved ${r.resolved} for "${label}" — the subset assertion fails.`)
    if (r.ambKind > r.ambDecl) throw new ArmLogRefusal(`TABLE 1: amb(kind) ${r.ambKind} > amb(decl) ${r.ambDecl} for "${label}" — the subset assertion fails.`)
  }

  // THE DUMP MUST BE THE TABLE'S OWN UNRESOLVED SET, PER LABEL.
  const unresolvedRows = dumpRows.filter((r) => r.outcome === "unresolved")
  for (const [label, r] of table1) {
    if (label === "TOTAL") continue
    const d = dumpCounts.get(label)?.get("unresolved") ?? 0
    if (d !== r.unresolved) {
      throw new ArmLogRefusal(
        `the dump carries ${d} unresolved "${label}" rows but TABLE 1's unresolved column reads ${r.unresolved}. THE DUMP IS NOT THE SET IT CLAIMS.`,
      )
    }
  }
  if (unresolvedRows.length !== total.unresolved) {
    throw new ArmLogRefusal(`${unresolvedRows.length} unresolved dump rows against TABLE 1's TOTAL unresolved ${total.unresolved}.`)
  }

  return {
    path: file,
    population: `parsed=${parsed}/${corpusTotal} admitted=${parsed} exts=${exts} index=no`,
    populationLine: popLine,
    parsed, sampled, corpusTotal, exts, repos,
    table1, total, dumpCounts, dumpRows, unresolvedRows,
  }
}

/** The 5 gate buckets derived from the 11-table terms. DECLARED COARSENING — the mapping is stated
 *  so a reader never has to guess which term went where:
 *    resolved = resolved · ambiguous = amb(decl) · external = extOK + ext?
 *    otherUnresolved = unresolved + extFAIL + bindOK + bind? + bindFAIL + causeOK + causeFAIL
 *    unclassed = 0 (an edge the instrument cannot classify is a hole in the instrument, not a class) */
export function gateBuckets(r: Terms): { edges: number; resolved: number; external: number; ambiguous: number; otherUnresolved: number; unclassed: number } {
  return {
    edges: r.edges,
    resolved: r.resolved,
    external: r.extOK + r.extUnk,
    ambiguous: r.ambDecl,
    otherUnresolved: r.unresolved + r.extFAIL + r.bindOK + r.bindUnk + r.bindFAIL + r.causeOK + r.causeFAIL,
    unclassed: 0,
  }
}

/** The eleven-term closure row, verbatim, so nothing is hidden by the coarsening. */
export function closureTerms(r: Terms): Terms & { ambKind: number; collRes: number } {
  return {
    edges: r.edges,
    resolved: r.resolved,
    collRes: r.collRes,
    ambDecl: r.ambDecl,
    ambKind: r.ambKind,
    unresolved: r.unresolved,
    extOK: r.extOK,
    extUnk: r.extUnk,
    extFAIL: r.extFAIL,
    bindOK: r.bindOK,
    bindUnk: r.bindUnk,
    bindFAIL: r.bindFAIL,
    causeOK: r.causeOK,
    causeFAIL: r.causeFAIL,
  }
}
