// script/m44/hub-list-derivation.ts — M44.U2 (issue #689) derivation owner.
//
// PURE. No fs, no clock, no db: every caller (and every mutant) exercises the
// same code, so the verdict cannot differ by caller (the M62 A1 rule applied to
// a derived record).
//
// Why this exists (found during M62's lane convergence, 2026-09-17): U2's record
// (validation/m44/results/U2.json) was a DERIVED record with NO OWNER. The m26
// webview harness writes M26's V1 record; U2's copy was re-pinned BY HAND
// (commit d330eb4f: "U2.json (derived record, verifier = the webview harness)
// re-pinned from the fresh V1 run"). So U2's currentCommit froze at bbf9e69e,
// and when M62 changed U2's own subject (script/m26/graph-core.ts — the
// call-site address contract), M44's governance reported `U2:stale-commit` with
// no mechanical way to clear it. A hand re-pin is exactly the class M61 D-1
// outlaws ("one write path, one owner").
//
// Laws (gated by script/m44/verify-hub-list.ts):
//   L1 declaration:      the U2 declaration is the single owner of what U2
//                        claims; a missing or empty block is a failure.
//   L2 source-green:     a red source derives a RED U2 — never a green copy.
//   L3 source-named:     the source must be the record of the verifier the
//                        declaration names.
//   L4 numbers-derived:  U2's counts ARE the source's counts, copied — never
//                        restated — so the two records cannot disagree.
//   L5 pin-follows:      the derived record is pinned to the SOURCE's commit, so
//                        U2's freshness follows the harness run mechanically.
//   L6 derivation-named: the record names its source and the source's content
//                        hash, so the derivation stays auditable afterwards.

/** The subset of an evidence record this derivation reads. `undefined` is a
 *  legal value for every field: a malformed source must FAIL the derivation,
 *  never crash it (a gate that crashes cannot be judged). */
export type DerivedSource = {
  status?: unknown
  checks?: unknown
  passed?: unknown
  failed?: unknown
  realFailed?: unknown
  negativeCases?: unknown
  mutantsCaught?: unknown
  mutantsTotal?: unknown
  currentCommit?: unknown
  verifierCommand?: unknown
}

export type U2Declaration = {
  schemaVersion: number
  milestone: string
  issue: string
  authority: string
  note: string
  source: { record: string; verifierCommand: string }
  deliverable: Record<string, unknown>
  coverage: Record<string, unknown>
  keyboardParity: string
  cssStyling: string
  limitations: string[]
}

const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0
const isNonNegInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0
const isHex40 = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{40}$/.test(v)
const nonEmpty = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0

/** The declaration must actually declare something: an empty deliverable or
 *  coverage block would make "verified" mean nothing (L1). */
export function declarationErrors(decl: U2Declaration): string[] {
  const out: string[] = []
  if (decl?.schemaVersion !== 1) out.push("L1(declaration schemaVersion must be 1)")
  if (!nonEmpty(decl?.source?.record)) out.push("L1(declaration names no source record)")
  if (!nonEmpty(decl?.source?.verifierCommand)) out.push("L1(declaration names no source verifier)")
  if (Object.keys(decl?.deliverable ?? {}).length === 0) out.push("L1(declaration carries an empty deliverable block)")
  if (Object.keys(decl?.coverage ?? {}).length === 0) out.push("L1(declaration carries an empty coverage block)")
  if (!nonEmpty(decl?.keyboardParity)) out.push("L1(declaration carries no keyboard-parity statement)")
  if (!nonEmpty(decl?.cssStyling)) out.push("L1(declaration carries no styling statement)")
  if (!Array.isArray(decl?.limitations)) out.push("L1(declaration carries no limitations list)")
  return out
}

/**
 * Derive U2's record from the harness record. Pure: the caller supplies the
 * source, the declaration and the source's content hash; nothing is read here.
 * Returns the errors (empty ⇒ verified) and the record to seal.
 */
export function deriveU2(
  decl: U2Declaration,
  source: DerivedSource,
  sourceContentSha256: string | null,
): { errors: string[]; record: Record<string, unknown> } {
  const errors: string[] = [...declarationErrors(decl)]

  // L2 — a red source is a red derivation.
  if (source?.status !== "verified") errors.push(`L2(source is not verified: ${String(source?.status)})`)
  if (!isNonNegInt(source?.failed)) errors.push("L2(source reports no failed count)")
  else if (source.failed !== 0) errors.push(`L2(source run reports ${source.failed} failures)`)
  if (source?.realFailed !== undefined && source.realFailed !== 0) {
    errors.push(`L2(source reports realFailed=${String(source.realFailed)})`)
  }

  // L3 — the source must be the record of the verifier the declaration names.
  if (source?.verifierCommand !== decl?.source?.verifierCommand) {
    errors.push(`L3(source verifier is ${String(source?.verifierCommand)}, declaration names ${decl?.source?.verifierCommand})`)
  }

  // L4 — the numbers are the source's, or the derivation is a lie.
  if (!isPositiveInt(source?.checks)) errors.push("L4(source carries no positive checks count)")
  if (!isNonNegInt(source?.passed)) errors.push("L4(source carries no passed count)")
  if (isPositiveInt(source?.checks) && isNonNegInt(source?.passed) && source.passed > source.checks) {
    errors.push("L4(source passed exceeds checks)")
  }
  if (source?.mutantsCaught !== undefined && !isNonNegInt(source.mutantsCaught)) errors.push("L4(source mutantsCaught malformed)")

  // L5 — the pin follows the source's commit.
  if (!isHex40(source?.currentCommit)) errors.push("L5(source carries no 40-hex commit pin)")

  // L6 — the derivation must name its source and that source's hash.
  if (!nonEmpty(sourceContentSha256)) errors.push("L6(source content hash missing — the derivation could not be audited)")

  const verified = errors.length === 0
  const record: Record<string, unknown> = {
    issue: "M44.U2",
    code: "U2",
    milestone: "M44",
    status: verified ? "verified" : "known-gap",
    checks: source?.checks ?? 0,
    passed: source?.passed ?? 0,
    failed: isNonNegInt(source?.failed) ? source.failed : 0,
    realFailed: isNonNegInt(source?.realFailed) ? source.realFailed : 0,
    negativeCases: isNonNegInt(source?.negativeCases) ? source.negativeCases : 0,
    mutantsCaught: isNonNegInt(source?.mutantsCaught) ? source.mutantsCaught : 0,
    mutantsTotal: isNonNegInt(source?.mutantsTotal) ? source.mutantsTotal : 0,
    currentCommit: isHex40(source?.currentCommit) ? source.currentCommit : null,
    // The record is PRODUCED by this owner gate; the cross-lane link to the
    // proof that backs it is stated explicitly in `derivedFrom` (the lint's
    // attribution rule reads the producer here, the source below).
    verifierCommand: "npx tsx script/m44/verify-hub-list.ts",
    evidenceFile: "U2.json",
    generatedAt: new Date(0).toISOString(),
    deliverable: decl?.deliverable ?? {},
    coverage: decl?.coverage ?? {},
    keyboardParity: decl?.keyboardParity ?? "",
    cssStyling: decl?.cssStyling ?? "",
    derivedFrom: {
      record: decl?.source?.record ?? null,
      verifierCommand: decl?.source?.verifierCommand ?? null,
      contentSha256: sourceContentSha256,
      rule: "U2's acceptance is the m26 webview harness DOM suite; this record is its derivation (M44.U2 owner gate script/m44/verify-hub-list.ts)",
    },
    limitations: Array.isArray(decl?.limitations) ? decl.limitations : [],
    derivationErrors: errors,
  }
  return { errors, record }
}
