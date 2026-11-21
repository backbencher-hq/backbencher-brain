// ─────────────────────────────────────────────────────────────────────────────
// M72 — bb_security answer contract (shared by the matrix gate and the Phase-0
// verification gates).
//
// WHAT THIS FILE IS — the parser/predicate for the strings bb_security is
//   REQUIRED to render in Phase 0. The contract is defined by the Lead
//   (docs/m72-security-rebuild/PHASE-0.md acceptance criteria and the per-project
//   language declaration); this module is the one place the gates check it, so a
//   matrix row and a Phase-0 assertion cannot drift apart.
// WHICH TOOL IT SERVES — bb_security.
// WHY IT EXISTS — the answer contract is the whole Phase-0 deliverable: an
//   `unsupported` language must say "not scanned" (a clean zero is not an
//   answer), a `leads` language must carry the banner + registry tier line and
//   never use finding/exploit vocabulary, and a `scan` language must render a
//   finding with an evidence locator. The gates call this against a REAL handler
//   answer; the negative controls call it against synthetic BAD answers to prove
//   the predicate can go red (a check that cannot fail is not a check).
// WHERE ITS EVIDENCE LIVES — validation/languages/results/tool-matrix.json,
//   validation/m72/results/**.
// EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_security/handler.ts,
//   src/intelligence/security/rebuild/registry.ts, script/verify-language-tool-
//   matrix.ts, script/m72/verify-security-matrix.ts.
// CONTRACTS IT MUST NOT BREAK — the tier line is compared against the REGISTRY's
//   own output, never a copied constant; a `leads` row fails on finding/exploit
//   vocabulary; an `unsupported` row without the "not scanned" declaration fails
//   even when the census is a clean zero; every predicate above has a negative
//   control in the gate that proves it can fail.
// ─────────────────────────────────────────────────────────────────────────────
import { formatSecurityTierDeclaration } from "../../../src/intelligence/security/rebuild/registry"
import type { SecurityTier } from "../../../src/intelligence/security/rebuild/spec-types"

/** First line of every live bb_security answer (Phase 0 banner). */
export const SECURITY_BANNER = "⚠️  LEXICAL TOKEN CO-OCCURRENCE — NOT DATA FLOW; NOT A VULNERABILITY FINDING"

/** Prefix of the per-project declaration for languages with no executable model. */
export const NOT_SCANNED_MARKER = "not scanned by bb_security (no executable source model):"

/** Prefix of the per-project declaration for the leads tier. */
export const LEADS_TIER_MARKER = "leads tier:"

export interface LanguageComposition {
  /** Number of leads-tier languages the project is expected to contain. */
  leadLanguages: number
  /** Language ids expected in the "not scanned" declaration, sorted. */
  unsupportedLanguages: string[]
}

export interface SecurityAnswerVerdict {
  ok: boolean
  failures: string[]
  observed: {
    firstLine: string
    tierLine: string | null
    leadLanguagesDeclared: number | null
    unsupportedDeclared: string[]
    leadLines: number
    criticalLabels: number
    confirmedWords: number
    confirmedClaims: number
    findingLines: number
    tierLineMatchesRegistry: boolean
  }
}

function parseFirstLine(text: string): string {
  return (text.split("\n")[0] ?? "").replace(/\r$/, "")
}

function findTierLine(lines: string[]): string | null {
  // The registry declaration's opening label changed when bettercap issue 12 was
  // fixed: the old line said `tiers: 0 scan / 39 leads / …`, which read as a
  // contradiction two lines above a body line saying `0 stored lead(s)` because
  // the two numbers measure different things. The unit is now in the label —
  // `tiers (analyzer registry census, project-independent): …` — and this finder
  // still looked for the retired `tiers: ` prefix, so it returned null and the
  // contract reported "missing/incorrect registry tier line" about an answer
  // that carried the declaration byte-for-byte. Match the label, not one
  // historical spelling of it; the exact-equality check against
  // formatSecurityTierDeclaration() below is what pins the content.
  return lines.find((line) => line.startsWith("tiers ") || line.startsWith("tiers:")) ?? null
}

function findLeadsLine(lines: string[]): string | null {
  return lines.find((line) => line.startsWith(LEADS_TIER_MARKER)) ?? null
}

function parseLeadsCount(line: string | null): number | null {
  if (!line) return null
  const match = line.match(/^leads tier: (\d+) language\(s\) present; lexical output only$/)
  return match ? Number(match[1]) : null
}

function parseNotScanned(line: string | null): { languages: string[]; reason: string } | null {
  if (!line) return null
  const rest = line.slice(NOT_SCANNED_MARKER.length).trim()
  const [languagesPart, ...reasonParts] = rest.split(" — ")
  const languages = (languagesPart ?? "")
    .split(",")
    .map((language) => language.trim().toLowerCase())
    .filter(Boolean)
    .sort()
  return { languages, reason: reasonParts.join(" — ").trim() }
}

function sorted(values: string[]): string[] {
  return [...values].map((value) => value.trim().toLowerCase()).filter(Boolean).sort()
}

function sameSet(left: string[], right: string[]): boolean {
  return sorted(left).join(",") === sorted(right).join(",")
}

/**
 * Check one bb_security answer against the tier contract.
 *
 * `expected` describes the language composition of the indexed project: for the
 * matrix gate that is exactly one language (the row's), which is what proves the
 * declaration is derived from the index rather than printed unconditionally.
 */
export function checkSecurityAnswerContract(args: {
  tier: SecurityTier
  language: string
  text: string
  expected?: LanguageComposition
}): SecurityAnswerVerdict {
  const language = args.language.trim().toLowerCase()
  const lines = args.text.split("\n")
  const firstLine = parseFirstLine(args.text)
  const tierLineValue = findTierLine(lines)
  const leadsLine = findLeadsLine(lines)
  const notScannedLine = lines.find((line) => line.startsWith(NOT_SCANNED_MARKER)) ?? null
  const notScanned = parseNotScanned(notScannedLine)
  const registryDeclaration = formatSecurityTierDeclaration()
  const tierLineMatchesRegistry = tierLineValue !== null && tierLineValue.trimEnd() === registryDeclaration
  const criticalLabels = lines.filter((line) => line.includes("[critical]")).length
  const confirmedWords = lines.reduce((count, line) => count + (line.match(/\bconfirmed\b/gi)?.length ?? 0), 0)
  // A negation ("not confirmed exploitable paths") is honesty vocabulary, not a
  // claim; only an un-negated occurrence counts as a surviving claim.
  const confirmedClaims = lines.filter((line) => /\bconfirmed\b/i.test(line) && !/not confirmed/i.test(line)).length
  const leadLines = lines.filter((line) => /^ {2}\[/.test(line)).length
  const findingLines = lines.filter((line) => /^ {2}\[(critical|high|medium|low)\] finding: /.test(line)).length

  const failures: string[] = []
  if (firstLine !== SECURITY_BANNER) {
    failures.push(`first line is not the Phase-0 banner: ${JSON.stringify(firstLine.slice(0, 80))}`)
  }
  if (!tierLineMatchesRegistry) {
    failures.push(`missing/incorrect registry tier line (expected ${JSON.stringify(registryDeclaration)})`)
  }

  const expectedComposition = args.expected

  if (args.tier === "unsupported") {
    if (!notScanned) {
      // The Phase-0 defect: an unsupported language answered with a clean-looking
      // census and no declaration. A clean zero is NOT a valid answer.
      failures.push("unsupported language has no 'not scanned by bb_security' declaration (a clean zero is not an answer)")
    } else {
      if (!notScanned.languages.includes(language)) {
        failures.push(`not-scanned declaration does not name the language: expected ${language}, declared ${notScanned.languages.join(",") || "<none>"}`)
      }
      if (!notScanned.reason) failures.push("not-scanned declaration carries no reason")
    }
    if (expectedComposition) {
      if (!sameSet(notScanned?.languages ?? [], expectedComposition.unsupportedLanguages)) {
        failures.push(`not-scanned languages ${JSON.stringify(notScanned?.languages ?? [])} != expected ${JSON.stringify(sorted(expectedComposition.unsupportedLanguages))}`)
      }
      if (expectedComposition.leadLanguages === 0) {
        if (parseLeadsCount(leadsLine) !== null) failures.push(`leads-tier declaration present for a project with no leads language`)
      } else if (parseLeadsCount(leadsLine) !== expectedComposition.leadLanguages) {
        failures.push(`leads-tier count ${String(parseLeadsCount(leadsLine))} != expected ${expectedComposition.leadLanguages}`)
      }
    }
  }

  if (args.tier === "leads") {
    if (parseLeadsCount(leadsLine) === null) {
      failures.push("leads answer has no 'leads tier: N language(s) present; lexical output only' declaration")
    } else if (expectedComposition && parseLeadsCount(leadsLine) !== expectedComposition.leadLanguages) {
      failures.push(`leads-tier count ${String(parseLeadsCount(leadsLine))} != expected ${expectedComposition.leadLanguages}`)
    }
    if (criticalLabels > 0) failures.push(`leads answer renders ${criticalLabels} [critical] label(s); the lead path must not claim a critical finding`)
    if (confirmedClaims > 0) failures.push(`leads answer contains ${confirmedClaims} un-negated "confirmed" claim(s); leads are not confirmed`)
    for (const line of lines) {
      if (!/^ {2}\[/.test(line)) continue
      const leadLine = line.match(/^ {2}\[(exec|high|medium|low)\] (lead:|unvalidated )/)
      if (!leadLine) failures.push(`lead/observation line uses finding vocabulary: ${line.trim().slice(0, 100)}`)
    }
    if (expectedComposition && !sameSet(notScanned?.languages ?? [], expectedComposition.unsupportedLanguages)) {
      failures.push(`not-scanned languages ${JSON.stringify(notScanned?.languages ?? [])} != expected ${JSON.stringify(sorted(expectedComposition.unsupportedLanguages))}`)
    }
  }

  if (args.tier === "scan") {
    // Phase 2 fixes the exact scan answer shape (the per-language fixture gate
    // owns vulnerable/clean/sanitized expectations); Phase 0 only requires that
    // a scan answer renders a finding with a severity and an evidence locator —
    // never a leads-only answer under a scan tier.
    if (findingLines === 0) failures.push("scan-tier answer renders no `  [severity] finding: …` line")
    const located = lines.filter((line) => /^ {2}\[(critical|high|medium|low)\] finding: /.test(line) && /@ .+:\d+/.test(line)).length
    if (located === 0) failures.push("scan-tier answer renders no finding with a file:line locator")
    if (parseLeadsCount(leadsLine) !== null) failures.push("scan-tier answer declares a leads tier; a scan language must not be described as lexical leads")
    if (criticalLabels > 0) failures.push("scan-tier answer uses the Phase-0 `[critical]` label; scan findings use severity labels")
  }

  return {
    ok: failures.length === 0,
    failures,
    observed: {
      firstLine,
      tierLine: tierLineValue,
      leadLanguagesDeclared: parseLeadsCount(leadsLine),
      unsupportedDeclared: notScanned?.languages ?? [],
      leadLines,
      criticalLabels,
      confirmedWords,
      confirmedClaims,
      findingLines,
      tierLineMatchesRegistry,
    },
  }
}

/**
 * Check the project-wide bb_security answer over a multi-language project: the
 * declaration must name exactly the unsupported languages indexed and count
 * exactly the leads-tier languages, so the aggregate answer cannot be a constant.
 * The aggregate answer's lead/observation block is not vocabulary-checked here
 * (it legitimately carries the negation "not confirmed exploitable paths"); the
 * per-language contract above is what enforces the strict lead-path vocabulary.
 */
export function checkProjectWideSecurityAnswer(args: {
  text: string
  expected: LanguageComposition
}): SecurityAnswerVerdict {
  const lines = args.text.split("\n")
  const firstLine = parseFirstLine(args.text)
  const tierLineValue = findTierLine(lines)
  const leadsCount = parseLeadsCount(findLeadsLine(lines))
  const notScanned = parseNotScanned(lines.find((line) => line.startsWith(NOT_SCANNED_MARKER)) ?? null)
  const registryDeclaration = formatSecurityTierDeclaration()
  const tierLineMatchesRegistry = tierLineValue !== null && tierLineValue.trimEnd() === registryDeclaration
  const criticalLabels = lines.filter((line) => line.includes("[critical]")).length
  const failures: string[] = []
  if (firstLine !== SECURITY_BANNER) failures.push(`first line is not the Phase-0 banner: ${JSON.stringify(firstLine.slice(0, 80))}`)
  if (!tierLineMatchesRegistry) failures.push(`missing/incorrect registry tier line (expected ${JSON.stringify(registryDeclaration)})`)
  if (args.expected.leadLanguages === 0) {
    if (leadsCount !== null) failures.push(`leads-tier declaration present for a project with no leads language`)
  } else if (leadsCount !== args.expected.leadLanguages) {
    failures.push(`leads-tier count ${String(leadsCount)} != expected ${args.expected.leadLanguages}`)
  }
  if (!sameSet(notScanned?.languages ?? [], args.expected.unsupportedLanguages)) {
    failures.push(`not-scanned languages ${JSON.stringify(notScanned?.languages ?? [])} != expected ${JSON.stringify(sorted(args.expected.unsupportedLanguages))}`)
  }
  if (criticalLabels > 0) failures.push(`project-wide lead answer renders ${criticalLabels} [critical] label(s)`)
  return {
    ok: failures.length === 0,
    failures,
    observed: {
      firstLine,
      tierLine: tierLineValue,
      leadLanguagesDeclared: leadsCount,
      unsupportedDeclared: notScanned?.languages ?? [],
      leadLines: lines.filter((line) => /^ {2}\[/.test(line)).length,
      criticalLabels,
      confirmedWords: 0,
      confirmedClaims: 0,
      findingLines: 0,
      tierLineMatchesRegistry,
    },
  }
}

/** The registry's own declaration text — exported so gates never copy the counts. */
export function securityTierLine(): string {
  return formatSecurityTierDeclaration()
}
