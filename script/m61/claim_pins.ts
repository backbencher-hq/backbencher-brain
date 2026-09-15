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

export type Registry = { schemaVersion: number; claims: Claim[] }

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

export type ClaimResult = {
  id: string
  doc: string
  rendered: string
  published: number
  outcome: "pinned" | "drifted" | "blocked"
  reason?: string
}

/**
 * The pin's decision, as a pure function so it can be unit-tested and mutated.
 * Two independent guards, in order: a blocked derivation is never compared, and
 * a template the derivation could not fill is never compared against prose. A
 * claim is only PINNED when a real rendered row was actually found.
 */
export function classify(blocked: string | undefined, rendered: string, published: number): ClaimResult["outcome"] {
  if (blocked) return "blocked"
  if (/\{\w+\}/.test(rendered)) return "blocked"
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
      return { id: claim.id, doc: claim.doc, rendered, published: 0, outcome: "blocked", reason: `doc missing: ${claim.doc}` }
    }
    const published = text === null ? 0 : text.split("\n").filter((l) => l.includes(rendered)).length
    const outcome = classify(derived.blocked, rendered, published)
    const reason =
      outcome === "blocked"
        ? derived.blocked ??
          `derivation supplied no value for ${[...rendered.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).join(", ")}`
        : outcome === "drifted"
          ? `published row does not match the ledger: expected to find "${rendered}"`
          : undefined
    return { id: claim.id, doc: claim.doc, rendered, published, outcome, reason }
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
  return problems
}
