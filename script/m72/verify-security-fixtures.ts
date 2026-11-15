// ─────────────────────────────────────────────────────────────────────────────
// M72 Phase-2a gate — per-language fixture oracle (spec lanes' expectations).
//
// WHAT THIS FILE IS — the fixture gate for every `validation/m72/fixtures/<language>/`
//   directory: the owner-authored README states the expected lead
//   (`Expected lead: <vulnerability> rule=<rule id>`, severity when declared),
//   and the gate runs the REAL `analyzeSymbol` engine over the three fixture
//   files and asserts:
//     * vulnerable -> at least one lead, and one whose rule id + vulnerability
//       (and severity when the README declares it) match the expectation;
//     * clean      -> zero leads;
//     * sanitized  -> zero leads.
//   A missing directory, README, expectation, or fixture file is a FAIL — never a
//   silent skip — and the gate records a per-language table in evidence.
// WHY IT EXISTS — Phase 2 promotion to `scan` requires a per-language fixture
//   oracle (PLAN §6 / LANGUAGES.md promotion protocol). Without this gate the
//   fixtures are prose and the tier registry can be promoted by assertion.
// WHERE ITS EVIDENCE LIVES — validation/m72/results/fixtures.json.
// EDIT TOGETHER WHEN THIS CHANGES — validation/m72/fixtures/**,
//   src/intelligence/security/rebuild/{engine,specs}, registry.ts,
//   docs/m72-security-rebuild/PHASE-2.md.
// CONTRACTS IT MUST NOT BREAK — the language set is DERIVED from the fixture
//   directories and reconciled with the registry's leads tier; expectations are
//   read from the owner README, never re-authored here; a missing expectation is
//   a red row; negative controls prove the predicate can fail (mutated rule id,
//   injected lead on a clean file) and can pass (correct expectation).
//
// COMMAND: npx tsx script/m72/verify-security-fixtures.ts
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..")
const FIXTURES = join(ROOT, "validation", "m72", "fixtures")
const EVIDENCE = join(ROOT, "validation", "m72", "results", "fixtures.json")

/** Vulnerabilities the spec-types contract may emit (kept in sync with spec-types.ts). */
const VULNERABILITIES = [
  "sql_injection",
  "command_injection",
  "code_injection",
  "path_traversal",
  "xss",
  "insecure_deserialization",
  "ssrf",
  "open_redirect",
  "weak_crypto",
  "pii_leak",
] as const
const SEVERITIES = ["critical", "high", "medium", "low"] as const

interface Expectation {
  vulnerability: string | null
  rule: string | null
  severity: string | null
  severityDeclared: boolean
  raw: string
}

interface FixtureLanguageRow {
  language: string
  tier: string | null
  specResolved: boolean
  expectation: Expectation | null
  vulnerable: { file: string | null; leads: number; ruleIds: string[]; matched: boolean; failures: string[] }
  clean: { file: string | null; leads: number; ok: boolean; failures: string[] }
  sanitized: { file: string | null; leads: number; ok: boolean; failures: string[] }
  ok: boolean
  failures: string[]
}

interface CheckRow { id: string; label: string; ok: boolean; detail: string }

const checks: CheckRow[] = []
function check(id: string, label: string, ok: boolean, detail = ""): boolean {
  checks.push({ id, label, ok, detail })
  return ok
}

/**
 * Parse the README expectation. Owners write it in two shapes:
 *   `Expected lead: rule `python.cmd.os_shell`, vulnerability `command_injection`, severity `critical``
 *   `Expected lead: command_injection rule=c.sink.system`
 * and the marker can wrap across lines; whitespace is normalised first.
 */
function parseExpectation(readme: string): Expectation | null {
  const normalized = readme.replace(/\s+/g, " ")
  const marker = normalized.search(/expected\s+lead\s*:/i)
  if (marker < 0) return null
  let window = normalized.slice(marker, marker + 500)
  // Cut the window before the clean/sanitized bullets so a later sentence cannot
  // supply the expected rule.
  const cleanCut = window.search(/[-–]\s*`?clean\./i)
  if (cleanCut > 20) window = window.slice(0, cleanCut)
  const rule =
    window.match(/rule\s*[=:]\s*`?([A-Za-z0-9_./:-]+)`?/i)?.[1] ??
    window.match(/rule\s+`([A-Za-z0-9_./:-]+)`/i)?.[1] ??
    window.match(/[`"]([A-Za-z0-9_./:-]+\.[A-Za-z0-9_./:-]+)[`"]/)?.[1] ??
    null
  const vulnerability = VULNERABILITIES.find((value) => new RegExp(`\\b${value}\\b`).test(window)) ?? null
  const severity = SEVERITIES.find((value) => new RegExp(`severity\\s*\`?${value}\\b`, "i").test(window)) ?? null
  return {
    vulnerability,
    rule,
    severity,
    severityDeclared: /severity/i.test(window),
    raw: window.slice(0, 220),
  }
}

function fixtureFile(dir: string, prefix: string): string | null {
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  return entries.find((file) => file.toLowerCase().startsWith(`${prefix}.`)) ?? null
}

/** Pure predicate: evaluate one language's three fixtures against its expectation. */
function evaluateLanguage(args: {
  language: string
  dir: string
  readme: string | null
  files: { vulnerable: string | null; clean: string | null; sanitized: string | null }
  analyze: (language: string, source: string, file: string) => Array<{ ruleId: string; vulnerability: string; severity: string }>
}): Omit<FixtureLanguageRow, "language" | "tier" | "specResolved"> {
  const failures: string[] = []
  const expectation = args.readme === null ? null : parseExpectation(args.readme)
  if (args.readme === null) failures.push("missing README.md (an expectation is required)")
  else if (expectation === null) failures.push("README has no `Expected lead:` line (missing expectation = FAIL)")
  else {
    if (!expectation.rule) failures.push("expectation does not name a rule id")
    if (!expectation.vulnerability) failures.push("expectation does not name a vulnerability")
  }

  const leadsFor = (file: string | null) => {
    if (!file) return [] as Array<{ ruleId: string; vulnerability: string; severity: string }>
    return args.analyze(args.language, readFileSync(join(args.dir, file), "utf8"), file)
  }
  const vulnerableFile = args.files.vulnerable
  const cleanFile = args.files.clean
  const sanitizedFile = args.files.sanitized
  const vulnerableLeads = leadsFor(vulnerableFile)
  const cleanLeads = leadsFor(cleanFile)
  const sanitizedLeads = leadsFor(sanitizedFile)

  const vulnerableFailures: string[] = []
  if (!vulnerableFile) vulnerableFailures.push("missing vulnerable.<ext> fixture")
  if (vulnerableLeads.length === 0) vulnerableFailures.push("vulnerable fixture emitted no lead")
  const matchedLead = expectation
    ? vulnerableLeads.find(
        (lead) =>
          (expectation.rule === null || lead.ruleId === expectation.rule) &&
          (expectation.vulnerability === null || lead.vulnerability === expectation.vulnerability),
      ) ?? null
    : null
  const matched = matchedLead !== null
  if (vulnerableFile && vulnerableLeads.length > 0 && !matched) {
    vulnerableFailures.push(
      `no lead matches the expectation (expected ${expectation?.rule ?? "?"}/${expectation?.vulnerability ?? "?"}, observed ${vulnerableLeads.map((lead) => `${lead.ruleId}/${lead.vulnerability}`).join(",") || "none"})`,
    )
  }
  if (matched && expectation?.severityDeclared && expectation.severity && matchedLead && matchedLead.severity !== expectation.severity) {
    vulnerableFailures.push(`severity ${matchedLead.severity} != declared ${expectation.severity}`)
  }
  const cleanFailures: string[] = []
  if (!cleanFile) cleanFailures.push("missing clean.<ext> fixture")
  else if (cleanLeads.length > 0) cleanFailures.push(`clean fixture emitted ${cleanLeads.length} lead(s): ${cleanLeads.map((lead) => lead.ruleId).join(",")}`)
  const sanitizedFailures: string[] = []
  if (!sanitizedFile) sanitizedFailures.push("missing sanitized.<ext> fixture")
  else if (sanitizedLeads.length > 0) sanitizedFailures.push(`sanitized fixture emitted ${sanitizedLeads.length} lead(s): ${sanitizedLeads.map((lead) => lead.ruleId).join(",")}`)

  failures.push(...vulnerableFailures, ...cleanFailures, ...sanitizedFailures)
  return {
    expectation,
    vulnerable: {
      file: vulnerableFile,
      leads: vulnerableLeads.length,
      ruleIds: vulnerableLeads.map((lead) => `${lead.ruleId}/${lead.vulnerability}/${lead.severity}`),
      matched,
      failures: vulnerableFailures,
    },
    clean: { file: cleanFile, leads: cleanLeads.length, ok: cleanFailures.length === 0, failures: cleanFailures },
    sanitized: { file: sanitizedFile, leads: sanitizedLeads.length, ok: sanitizedFailures.length === 0, failures: sanitizedFailures },
    ok: failures.length === 0,
    failures,
  }
}

async function main(): Promise<number> {
  const engine = await import("../../src/intelligence/security/rebuild/engine")
  const registry = await import("../../src/intelligence/security/rebuild/registry")

  const dirs = (() => {
    try {
      return readdirSync(FIXTURES).filter((name) => statSync(join(FIXTURES, name)).isDirectory()).sort()
    } catch {
      return []
    }
  })()
  const registryCounts = registry.securityTierCounts()
  const codeLanguageCount = registryCounts.total - registryCounts.unsupported
  check("fixtures.derive", "the fixture tree derives one directory per non-unsupported language", dirs.length === codeLanguageCount, `dirs=${dirs.length} expected=${codeLanguageCount}`)
  const expectedLanguages = Object.keys(registry.LANGUAGE_SECURITY_ENTRIES)
    .filter((language) => registry.securityTierFor(language) !== "unsupported")
    .sort()
  check("fixtures.reconcile", "fixture directories equal the registry's non-unsupported languages",
    dirs.join(",") === expectedLanguages.join(","),
    `fixtures=${dirs.length} registry-non-unsupported=${expectedLanguages.length} missing=${expectedLanguages.filter((language) => !dirs.includes(language)).join(",") || "none"}`)

  const rows: FixtureLanguageRow[] = []
  for (const language of dirs) {
    const dir = join(FIXTURES, language)
    const spec = engine.analysisSpecFor(language)
    const readmePath = join(dir, "README.md")
    const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : null
    const evaluated = evaluateLanguage({
      language,
      dir,
      readme,
      files: {
        vulnerable: fixtureFile(dir, "vulnerable"),
        clean: fixtureFile(dir, "clean"),
        sanitized: fixtureFile(dir, "sanitized"),
      },
      analyze: (lang, source, file) =>
        engine.analyzeSymbol({ language: lang, source, file }).map((lead: { ruleId: string; vulnerability: string; severity: string }) => ({
          ruleId: lead.ruleId,
          vulnerability: lead.vulnerability,
          severity: lead.severity,
        })),
    })
    rows.push({
      language,
      tier: registry.securityTierFor(language),
      specResolved: spec !== null,
      ...evaluated,
    })
    if (!spec) {
      rows[rows.length - 1]!.failures.push("no spec resolves for this language")
      rows[rows.length - 1]!.ok = false
    }
  }

  const failedRows = rows.filter((row) => !row.ok)
  check("fixtures.per-language", "every language's vulnerable/clean/sanitized fixtures match its README expectation",
    failedRows.length === 0,
    failedRows.map((row) => `${row.language}: ${row.failures.join("; ")}`).join(" | ") || `${rows.length}/${rows.length} languages pass`)

  // ── negative controls: the predicate can go red (and green) ──────────────
  const pythonDir = join(FIXTURES, "python")
  const pythonReadme = existsSync(join(pythonDir, "README.md")) ? readFileSync(join(pythonDir, "README.md"), "utf8") : null
  const pythonFiles = {
    vulnerable: fixtureFile(pythonDir, "vulnerable"),
    clean: fixtureFile(pythonDir, "clean"),
    sanitized: fixtureFile(pythonDir, "sanitized"),
  }
  if (pythonReadme && pythonFiles.vulnerable && pythonFiles.clean && pythonFiles.sanitized) {
    const analyze = (language: string, source: string, file: string) =>
      engine.analyzeSymbol({ language, source, file }).map((lead: { ruleId: string; vulnerability: string; severity: string }) => ({
        ruleId: lead.ruleId,
        vulnerability: lead.vulnerability,
        severity: lead.severity,
      }))
    const correct = evaluateLanguage({ language: "python", dir: pythonDir, readme: pythonReadme, files: pythonFiles, analyze })
    const mutated = pythonReadme.replace(/rule\s*`?python\.[A-Za-z0-9_.:-]+`?/, "rule `python.rule.that.does.not.exist`")
    const mutatedVerdict = evaluateLanguage({
      language: "python",
      dir: pythonDir,
      readme: mutated,
      files: pythonFiles,
      analyze,
    })
    const injected = evaluateLanguage({
      language: "python",
      dir: pythonDir,
      readme: pythonReadme,
      files: pythonFiles,
      // A lead on the CLEAN fixture must make the row red, even though the rule
      // id is the expected one.
      analyze: (language, source, file) =>
        /clean\./i.test(file) ? [{ ruleId: "python.cmd.os_shell", vulnerability: "command_injection", severity: "critical" }] : analyze(language, source, file),
    })
    check("negative.mutated-rule", "a mutated expected rule id makes the row fail (predicate can go red)",
      correct.ok && mutatedVerdict.ok === false && mutatedVerdict.failures.some((failure) => failure.includes("no lead matches")),
      mutatedVerdict.failures[0] ?? "no failure reported")
    check("negative.clean-lead", "a lead on a clean fixture makes the row fail (predicate can go red)",
      injected.ok === false && injected.clean.failures.length > 0,
      injected.clean.failures[0] ?? "no failure reported")
  } else {
    check("negative.mutated-rule", "python fixtures exist for the negative controls", false, "python fixture expected")
  }

  // ── summary + evidence ──────────────────────────────────────────────────
  const failures = checks.filter((row) => !row.ok)
  let head = "unknown"
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    head = "unknown"
  }
  mkdirSync(dirname(EVIDENCE), { recursive: true })
  writeFileSync(
    EVIDENCE,
    JSON.stringify(
      {
        probe: "m72-security-fixtures",
        what: "per-language fixture oracle: README `Expected lead: <vulnerability> rule=<rule id>` vs the real analyzeSymbol over vulnerable/clean/sanitized fixtures (whole-file body)",
        generatedAt: new Date().toISOString(),
        head,
        command: "npx tsx script/m72/verify-security-fixtures.ts",
        languages: rows.length,
        registryCounts: { scan: registryCounts.scan, leads: registryCounts.leads, unsupported: registryCounts.unsupported, total: registryCounts.total },
        checks: checks.length,
        passed: checks.filter((row) => row.ok).length,
        failed: failures.length,
        bodyMode: "whole-file",
        rows,
        failures: failures.map((row) => `${row.id}: ${row.label} — ${row.detail}`),
        checksDetail: checks,
      },
      null,
      2,
    ) + "\n",
  )

  console.log("")
  for (const row of rows) console.log(`  ${row.ok ? "PASS" : "FAIL"}  ${row.language.padEnd(13)} tier=${String(row.tier).padEnd(11)} vulnerable=${row.vulnerable.leads} clean=${row.clean.leads} sanitized=${row.sanitized.leads}${row.ok ? "" : ` — ${row.failures.join("; ")}`}`)
  for (const row of checks) {
    if (!row.ok) console.log(`  ${row.id} FAIL — ${row.detail}`)
  }
  const verdict = failures.length === 0 ? "PASS" : "FAIL"
  console.log(`\nM72 SECURITY FIXTURES: ${verdict} — ${rows.length} languages, ${checks.length} checks, ${checks.filter((row) => row.ok).length} passed, ${failures.length} failed`)
  console.log(`  evidence: validation/m72/results/fixtures.json`)
  return failures.length === 0 ? 0 : 1
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
