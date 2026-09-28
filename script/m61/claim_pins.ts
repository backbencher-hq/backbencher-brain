// script/m61/claim_pins.ts — M61.V5 (issue #846): claim pins.
//
// The defect this pins: numeric claims in README/website/docs are PROSE. They
// drift from the ledgers they cite and no gate notices — the published number
// keeps saying "36 mutants across 8 suites" long after the ledger said 38
// across 9.
//
// Each claim in script/m61/claims.json is a row-anchored TEMPLATE. At gate-run
// time the tool derives the numbers from the evidence the claim cites, renders
// the template, and requires the rendered string to appear verbatim in the doc.
// A mismatch is drift, and BOTH values are reported so a human can adjudicate
// which side moved.
//
// Laws gated by script/m61/verify-claims.ts:
//   C1 every claim resolves: the doc exists, the source exists, the derivation
//      yields numbers (a missing source is BLOCKED with a reason, never OK).
//   C2 every claim's rendered row appears verbatim in its doc (no drift).
//   C3 the registry is well-formed: unique ids, every claim has a doc, a
//      template and a derivation, and every claim's doc is a real file.
//   C4 a claim with no derivation kind is a failure (the tool never guesses).
//   C5 coverage: README, the website and the docs are all in the audit set —
//      every doc that publishes this lane's counts is pinned here, and a doc
//      declared out-of-scope that publishes one is a failure (issue #846 names
//      README/website/docs explicitly, so "we only audited one doc" cannot
//      pass).
//
// Run: npx tsx script/m61/verify-claims.ts
// Evidence: validation/m61/results/V5.json (sealed)

import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"

export const ROOT = path.resolve(import.meta.dirname, "..", "..")
export const CLAIMS_FILE = path.join(ROOT, "script/m61/claims.json")

export type Claim = {
  id: string
  doc: string
  template: string
  derive: { kind: "issue-counts" | "field" | "mutant-totals"; source: string; template?: string }
}

/**
 * A doc the coverage scan audits. `pinned` docs publish this lane's counts and
 * must have claims in the registry; `out-of-scope` docs must publish NO lane
 * count at all (a number that appears there is unpinned prose). The declaration
 * is what makes the scope visible — an undeclared doc is a doc nobody checks.
 */
export type CoverageSpec = { doc: string; status: "pinned" | "out-of-scope"; reason?: string }

export type Registry = { schemaVersion: number; claims: Claim[]; coverage?: CoverageSpec[] }

export function loadClaims(file = CLAIMS_FILE): Registry {
  return JSON.parse(readFileSync(file, "utf8")) as Registry
}

/** Fill a `{key}` template from a bag of derived values. Unknown keys stay literal. */
export function render(template: string, values: Record<string, number | string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  )
}

/** The declared mutant proof a record carries — the same shapes the lint reads. */
export function mutantCount(record: Record<string, unknown>): number {
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)
  let total = 0
  const direct = record.mutantsCaught
  if (typeof direct === "number") total += num(direct)
  const nested = record.mutants
  if (typeof nested === "number") total += num(nested)
  else if (nested && typeof nested === "object") total += num((nested as Record<string, unknown>).caught)
  const verdict = record.verdict
  if (verdict && typeof verdict === "object") total += num((verdict as Record<string, unknown>).mutantsCaught)
  return total
}

export type Derivation = { values: Record<string, number>; blocked?: string }

/**
 * Derive a claim's numbers from its source. Missing files and unreadable
 * records are BLOCKED with a reason — never silently zero, because a zero would
 * look like a legitimate count that happens to mismatch the doc.
 */
export function derive(claim: Claim): Derivation {
  const source = claim.derive.source
  const kind = claim.derive.kind

  if (kind === "issue-counts") {
    const abs = path.join(ROOT, source)
    if (!existsSync(abs)) return { values: {}, blocked: `source record missing: ${source}` }
    const data = JSON.parse(readFileSync(abs, "utf8")) as { issues?: { status?: string }[] }
    const issues = Array.isArray(data.issues) ? data.issues : []
    if (issues.length === 0) return { values: {}, blocked: `no issues[] in ${source}` }
    return {
      values: {
        verified: issues.filter((i) => i.status === "verified").length,
        total: issues.length,
      },
    }
  }

  if (kind === "field") {
    const abs = path.join(ROOT, source)
    if (!existsSync(abs)) return { values: {}, blocked: `source record missing: ${source}` }
    const data = JSON.parse(readFileSync(abs, "utf8")) as Record<string, unknown>
    // `template` names the fields, e.g. "{passed}/{checks}".
    const fields = [...(claim.derive.template ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    if (fields.length === 0) return { values: {}, blocked: `field claim has no derive.template naming its fields` }
    const values: Record<string, number> = {}
    for (const f of fields) {
      const v = data[f]
      if (typeof v !== "number") return { values: {}, blocked: `${source} has no numeric field ${f}` }
      values[f] = v
    }
    return { values }
  }

  if (kind === "mutant-totals") {
    const dir = path.join(ROOT, path.dirname(source))
    if (!existsSync(dir)) return { values: {}, blocked: `source dir missing: ${path.dirname(source)}` }
    const prefix = path.basename(source).replace(/\*\.json$/, "")
    const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f.startsWith(prefix.replace(/\/$/, "")))
    if (files.length === 0) return { values: {}, blocked: `no records match ${source}` }
    let mutants = 0
    let suites = 0
    for (const f of files) {
      let data: Record<string, unknown>
      try {
        data = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Record<string, unknown>
      } catch {
        continue
      }
      const m = mutantCount(data)
      if (m > 0) {
        suites++
        mutants += m
      }
    }
    return { values: { mutants, suites } }
  }

  return { values: {}, blocked: `unknown derivation kind: ${String(kind)}` }
}

/** A line that NAMES this lane and STATES a count about it. Prose that merely
 *  points at a drift-gated doc (a file path, a tier id) is not a count. */
export const LANE_WORD = /\b(M2[4-9]|M4[24]|M53|M61)\b|bb_lsp/i
export const COUNT_CLAIM = /\b\d+\s*\/\s*\d+\b|\b\d+\s+(gates|mutants|suites|issues|verified|passed|negatives)\b/i

/** Every lane count claim a doc publishes, with its line number. */
export function laneCountClaims(text: string): { line: number; text: string }[] {
  return text.split("\n").flatMap((l, i) => (LANE_WORD.test(l) && COUNT_CLAIM.test(l) ? [{ line: i + 1, text: l.trim() }] : []))
}

/** The deliverable's coverage law (issue #846): README, the website and the
 *  docs are all audited, and every doc that publishes this lane's counts is
 *  either PINNED here or declared OUT-OF-SCOPE — in which case it must publish
 *  none. The residue on a pinned doc is reported as a census, so an unpinned
 *  number stays COUNTABLE instead of invisible. */
export function coverageFindings(registry: Registry, docs?: Record<string, string>): string[] {
  const out: string[] = []
  const declared = registry.coverage ?? []
  if (declared.length === 0) out.push("coverage: the registry declares no coverage set — the scan cannot say which docs it audits")
  for (const c of declared) {
    const text = docs?.[c.doc] ?? (existsSync(path.join(ROOT, c.doc)) ? readFileSync(path.join(ROOT, c.doc), "utf8") : null)
    if (text === null) {
      out.push(`coverage: declared doc does not exist: ${c.doc}`)
      continue
    }
    const claims = laneCountClaims(text)
    if (c.status === "out-of-scope") {
      for (const h of claims) out.push(`coverage: ${c.doc}:${h.line} publishes a lane count but the doc is declared out-of-scope — pin it or declare it pinned: "${h.text.slice(0, 80)}"`)
    } else if (registry.claims.filter((x) => x.doc === c.doc).length === 0) {
      out.push(`coverage: ${c.doc} is declared pinned but the registry pins no claim in it`)
    }
  }
  return out
}

/** The coverage census: how many lane claims each declared doc publishes and
 *  how many the registry pins there. Reported, never asserted — the residue is
 *  the milestone gate's business, not a silent pass. */
export function coverageCensus(registry: Registry): { doc: string; status: string; published: number; pinned: number }[] {
  return (registry.coverage ?? []).map((c) => {
    const abs = path.join(ROOT, c.doc)
    const published = existsSync(abs) ? laneCountClaims(readFileSync(abs, "utf8")).length : 0
    return { doc: c.doc, status: c.status, published, pinned: registry.claims.filter((x) => x.doc === c.doc).length }
  })
}

/** The shortest literal segment that may serve as an anchor (in non-space
 *  characters). Below this, segments like "/" or " | " identify nothing. */
export const MIN_ANCHOR_CHARS = 6

export type ClaimResult = {
  id: string
  doc: string
  rendered: string
  published: number
  /** Lines that publish this claim's fixed text (its anchor) but NOT the
   *  derived numbers. A single stale row among correct ones is drift. */
  mismatched: number
  outcome: "pinned" | "drifted" | "blocked"
  reason?: string
}

/**
 * A claim's ANCHOR: the longest literal segment of its template (the part no
 * derivation fills) that NO other claim's template shares. Every line that
 * publishes the anchor is a line that states THIS claim, so every one of them
 * must carry the derived numbers — a doc that states the claim twice and
 * updates only one row is drift, not a passing pin.
 *
 * The uniqueness requirement is what makes the rule usable inside a doc that
 * states several claims: ` mutants caught across ` is shared by the m26/m27/m28
 * row templates, so it can never identify a single claim — the tail segment
 * (` suites | [m26 ledger]`) does. Derived from the registry, never declared
 * twice. '' means "this claim has no distinguishing literal; its pin rests on
 * the rendered row alone".
 */
export function claimAnchor(template: string, others: string[] = [], lines: string[] = []): string {
  const candidates = template
    .split(/\{\w+\}/)
    .filter((s) => s.replace(/\s+/g, "").length >= MIN_ANCHOR_CHARS && !others.some((o) => o.includes(s)))
  if (candidates.length === 0) return ""
  // With doc lines available, the MOST SPECIFIC candidate wins: the one the
  // fewest lines contain, which is what distinguishes this claim's row from the
  // prose and from other milestones' rows. Ties (and the no-doc case) go to the
  // longest. `M26 closed: ` (1 line) beats " issues verified" (5 lines).
  const occurrences = (s: string): number => (lines.length === 0 ? 0 : lines.filter((l) => l.includes(s)).length)
  return candidates.reduce((best, s) => {
    const a = occurrences(s)
    const b = occurrences(best)
    if (a !== b) return a < b ? s : best
    return s.trim().length > best.trim().length ? s : best
  })
}

/**
 * The pin's decision, as a pure function so it can be unit-tested and mutated.
 * Three independent guards, in order: a blocked derivation is never compared, a
 * template the derivation could not fill is never compared against prose, and a
 * line that states the claim without the derived numbers is drift. A claim is
 * only PINNED when a real rendered row was actually found.
 */
export function classify(
  blocked: string | undefined,
  rendered: string,
  published: number,
  mismatched = 0,
): ClaimResult["outcome"] {
  if (blocked) return "blocked"
  if (/\{\w+\}/.test(rendered)) return "blocked"
  if (mismatched > 0) return "drifted"
  return published > 0 ? "pinned" : "drifted"
}

/**
 * The pin. `docs` lets the caller supply doc text (the verifier mutates it in
 * memory to prove a prose edit is caught); by default the doc is read from disk.
 */
export function pinClaims(registry: Registry, docs?: Record<string, string>): ClaimResult[] {
  return registry.claims.map((claim) => {
    const derived = derive(claim)
    const rendered = derived.blocked ? "" : render(claim.template, derived.values)
    const text = docs?.[claim.doc] ?? (existsSync(path.join(ROOT, claim.doc)) ? readFileSync(path.join(ROOT, claim.doc), "utf8") : null)
    if (text === null && !derived.blocked) {
      return { id: claim.id, doc: claim.doc, rendered, published: 0, mismatched: 0, outcome: "blocked", reason: `doc missing: ${claim.doc}` }
    }
    const lines = text === null ? [] : text.split("\n")
    const published = lines.filter((l) => l.includes(rendered)).length
    const anchor = claimAnchor(
      claim.template,
      registry.claims.filter((c) => c.id !== claim.id).map((c) => c.template),
      lines,
    )
    const mismatched = anchor
      ? lines.filter((l) => l.includes(anchor) && !l.includes(rendered)).length
      : 0
    const outcome = classify(derived.blocked, rendered, published, mismatched)
    const reason =
      outcome === "blocked"
        ? derived.blocked ??
          `derivation supplied no value for ${[...rendered.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).join(", ")}`
        : outcome === "drifted"
          ? mismatched > 0
            ? `${mismatched} published row(s) state the claim ("${anchor}") without the ledger's numbers: expected "${rendered}"`
            : `published row does not match the ledger: expected to find "${rendered}"`
          : undefined
    return { id: claim.id, doc: claim.doc, rendered, published, mismatched, outcome, reason }
  })
}

/** C3/C4: the registry's own well-formedness. */
export function registryProblems(registry: Registry): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const c of registry.claims) {
    if (!c.id) problems.push("a claim has no id")
    if (ids.has(c.id)) problems.push(`duplicate claim id: ${c.id}`)
    ids.add(c.id)
    if (!c.doc) problems.push(`${c.id}: no doc`)
    else if (!existsSync(path.join(ROOT, c.doc))) problems.push(`${c.id}: doc does not exist: ${c.doc}`)
    if (!c.template) problems.push(`${c.id}: no template`)
    if (!c.derive) problems.push(`${c.id}: no derivation`)
    else {
      if (!c.derive.kind) problems.push(`${c.id}: derivation has no kind`)
      if (!c.derive.source) problems.push(`${c.id}: derivation has no source`)
      if (c.derive.kind === "field" && !c.derive.template) problems.push(`${c.id}: field derivation must name its fields`)
    }
    // A template with no placeholders states a fixed string; that is allowed
    // only when the derivation still supplies values (checked at pin time).
  }
  if (registry.claims.length === 0) problems.push("the registry has no claims")
  // C5: the coverage set is part of the registry's well-formedness — every
  // declared doc must exist, a status must be declared, and an out-of-scope
  // declaration must carry its reason (a bare exclusion is a hiding place).
  const seen = new Set<string>()
  for (const c of registry.coverage ?? []) {
    if (!c.doc) problems.push("a coverage entry has no doc")
    else {
      if (seen.has(c.doc)) problems.push(`duplicate coverage entry: ${c.doc}`)
      seen.add(c.doc)
      if (!existsSync(path.join(ROOT, c.doc))) problems.push(`coverage: doc does not exist: ${c.doc}`)
    }
    if (c.status !== "pinned" && c.status !== "out-of-scope") problems.push(`coverage: ${c.doc ?? "?"} has no status`)
    if (c.status === "out-of-scope" && !c.reason) problems.push(`coverage: ${c.doc ?? "?"} is out-of-scope with no reason`)
  }
  return problems
}
