// ─────────────────────────────────────────────────────────────────────────────
// M72 Phase-0 gate — the honesty-demotion contract of bb_security.
//
// WHAT THIS FILE IS — the static contract gate for Phase 0: the lead-generator
//   wording, the registry tier baseline (53 analyzers / 36 leads / 17
//   unsupported / 0 scan), the answer-surface strings the handler must render
//   (banner, registry tier line, per-project "not scanned" declaration, lead
//   labels), the public claim files, and the real-corpus `parameterized-sql-
//   negative` defect. It indexes nothing: this is the cheap gate that must pass
//   before any engine/store integration gate is meaningful.
// WHICH TOOL IT SERVES — bb_security (Phase 0 honesty demotion).
// WHY IT EXISTS — Phase 0 is a claims change. A claims change that is not
//   asserted against the files that carry the claims drifts on the next edit;
//   the exact strings are the contract (docs/m72-security-rebuild/PHASE-0.md
//   acceptance criteria 1, 2, 5).
// WHERE ITS EVIDENCE LIVES — validation/m72/results/phase0.json.
// EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_security/{handler,
//   descriptor}.ts, src/intelligence/security/rebuild/registry.ts, the generated
//   docs/website data, AGENTS.md onboarding block, and
//   validation/tools/bb_security/REAL-CORPUS.json.
// CONTRACTS IT MUST NOT BREAK — a rendered claim must be checked against the
//   source that renders it, never re-implemented here as prose; a KNOWN-GAP is
//   printed and recorded with an exact evidence path and never counted as a
//   pass; the real-corpus parameterized-SQL defect stays red as a KNOWN-GAP
//   until the Phase-1 engine and regenerated evidence land.
//
// COMMAND: npx tsx script/m72/verify-security-phase0.ts
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import {
  LANGUAGE_SECURITY_ENTRIES,
  SECURITY_LANGUAGE_ALIASES,
  formatSecurityTierDeclaration,
  securityEntryFor,
  securityTierCounts,
} from "../../src/intelligence/security/rebuild/registry"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..")
const EVIDENCE = join(ROOT, "validation", "m72", "results", "phase0.json")

// ── the contract strings (Lead-signed, docs/m72-security-rebuild/PHASE-0.md) ──
const BANNER = "⚠️  LEXICAL TOKEN CO-OCCURRENCE — NOT DATA FLOW; NOT A VULNERABILITY FINDING"
const NOT_SCANNED_PREFIX = "not scanned by bb_security (no executable source model):"
const LEADS_TIER_PREFIX = "leads tier:"

interface CheckRow { id: string; label: string; ok: boolean; detail: string }
interface KnownGapRow { id: string; label: string; reason: string; evidence: string; observed: string }

const checks: CheckRow[] = []
const knownGaps: KnownGapRow[] = []

function check(id: string, label: string, ok: boolean, detail = ""): boolean {
  checks.push({ id, label, ok, detail })
  return ok
}
function knownGap(id: string, label: string, reason: string, evidence: string, observed: string): void {
  knownGaps.push({ id, label, reason, evidence, observed })
  checks.push({ id, label: `${label} [KNOWN-GAP]`, ok: false, detail: `${reason} — evidence: ${evidence}` })
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
}
function exists(rel: string): boolean {
  return existsSync(join(ROOT, rel))
}
/** 1-based line number of the first literal occurrence, for evidence citations. */
function lineOf(text: string, needle: string): number {
  const idx = text.indexOf(needle)
  return idx < 0 ? 0 : text.slice(0, idx).split("\n").length
}

async function main(): Promise<number> {
  // ── A. registry tier baseline ────────────────────────────────────────────
  const counts = securityTierCounts()
  check("registry.total", "registry covers 53 analyzers", counts.total === 53, `total=${counts.total}`)
  check("registry.scan", "registry baseline has 0 scan languages (Phase 2 is the promotion gate)", counts.scan === 0, `scan=${counts.scan}`)
  // Tier counts are registry-derived, not typed here. A magic number would either
  // fail on every intentional coverage change (as 36/17 did when svelte and vue
  // moved from `unsupported` to `leads`) or be bumped without thought. The
  // invariant that matters is that the three tiers sum to the analyzer total and
  // that the declaration prints the SAME numbers the registry holds.
  check("registry.tier-sum", "scan + leads + unsupported equals the analyzer total",
    counts.scan + counts.leads + counts.unsupported === counts.total,
    `${counts.scan}+${counts.leads}+${counts.unsupported} vs ${counts.total}`)
  check("registry.lead-tier-present", "at least one language is tiered leads", counts.leads > 0, `leads=${counts.leads}`)
  const tierValues = Object.values(LANGUAGE_SECURITY_ENTRIES).map((entry) => entry.tier)
  check("registry.tiers", "every registry tier is one of scan|leads|unsupported",
    tierValues.every((tier) => tier === "scan" || tier === "leads" || tier === "unsupported"),
    `${new Set(tierValues).size} distinct tier value(s)`)
  const emptyReasons = Object.entries(LANGUAGE_SECURITY_ENTRIES).filter(([, entry]) => !entry.reason.trim()).map(([language]) => language)
  check("registry.reasons", "every registry entry carries a reason (no silent tier)", emptyReasons.length === 0, emptyReasons.join(","))
  check("registry.aliases", "alias resolution is explicit (tsx resolves to the typescript entry)",
    securityEntryFor("tsx").tier === "leads" && SECURITY_LANGUAGE_ALIASES["tsx"] === "typescript",
    `tsx=${securityEntryFor("tsx").tier}`)

  // The exact declaration line is generated by the registry, not typed at the
  // call site; the matrix and handler both print this same function's output.
  // The counts in the regex are BUILT from the live registry, so the assertion
  // proves the printer agrees with the data rather than with a frozen string.
  const declaration = formatSecurityTierDeclaration()
  const expectedDeclaration = new RegExp(
    `^tiers: ${counts.scan} scan / ${counts.leads} leads / ${counts.unsupported} unsupported \\(of ${counts.total} analyzers\\)`,
  )
  check("registry.declaration", "formatSecurityTierDeclaration prints the counted tier line",
    expectedDeclaration.test(declaration) &&
      declaration.includes("unsupported languages are NOT scanned by bb_security"),
    declaration)

  // The 53 matrix languages (evidence rows) must be exactly the registry keys.
  const matrixEvidenceRel = "validation/languages/results/tool-matrix.json"
  if (!exists(matrixEvidenceRel)) {
    check("matrix.evidence", "matrix evidence exists to reconcile languages", false, matrixEvidenceRel)
  } else {
    const matrix = JSON.parse(read(matrixEvidenceRel)) as { rows?: Array<{ language?: string }> }
    const languages = (matrix.rows ?? []).map((row) => row.language ?? "").filter(Boolean).sort()
    const registryLanguages = Object.keys(LANGUAGE_SECURITY_ENTRIES).sort()
    const missingFromRegistry = languages.filter((language) => !(language in LANGUAGE_SECURITY_ENTRIES) && !(language in SECURITY_LANGUAGE_ALIASES))
    check("matrix.reconcile", "every matrix language resolves to a registry tier (53 rows)",
      languages.length === 53 && missingFromRegistry.length === 0, `rows=${languages.length} missing=${missingFromRegistry.join(",") || "none"}`)
    check("matrix.registry-set", "matrix language set equals the registry key set",
      languages.join(",") === registryLanguages.join(","),
      `matrix=${languages.length} registry=${registryLanguages.length}`)
  }

  // ── B. handler: the strings the answer renders ───────────────────────────
  const handlerRel = "src/mcp/tools/bb_security/handler.ts"
  const handler = exists(handlerRel) ? read(handlerRel) : ""
  check("handler.exists", "handler source exists", handler.length > 0, handlerRel)
  check("handler.banner", "handler renders the Phase-0 banner verbatim as the first answer line",
    handler.includes(BANNER) && handler.includes('banner + tierNote'), "banner first-line template")
  check("handler.tier-registry", "handler imports and calls the registry declaration (tier line is not hand-written)",
    handler.includes('from "../../../intelligence/security/rebuild/registry"') &&
      handler.includes("formatSecurityTierDeclaration()"),
    "formatSecurityTierDeclaration() call site")
  check("handler.unsupported-declaration", "handler renders the per-project 'not scanned' declaration for unsupported languages",
    handler.includes(`not scanned by bb_security (no executable source model):`) && handler.includes("projectLanguageDeclaration"),
    NOT_SCANNED_PREFIX)
  check("handler.leads-declaration", "handler renders the leads-tier declaration for leads languages",
    handler.includes(`leads tier:`) && handler.includes("language(s) present; lexical output only"), LEADS_TIER_PREFIX)
  check("handler.lead-label", "handler renders lead lines with the demoted grade label, never a finding claim",
    /\[\$\{gradeLabel\(finding\.severity\)\}\] lead:/.test(handler) && handler.includes('"exec"'),
    "] lead: template")
  check("handler.no-critical-literal", "handler renders no `[critical]` label (gradeLabel maps critical -> exec)",
    !handler.includes("[critical]") && /severity === "critical" \? "exec"/.test(handler), "critical -> exec mapping")
  // No `confirmed`-as-claim vocabulary in the answer path. Negations ("not
  // confirmed exploitable paths"), quoted persisted-state literals and code
  // comments are allowed; a bare claim on a rendered line is not.
  const claimLines = handler
    .split("\n")
    .map((line, index) => ({ line, no: index + 1 }))
    .filter(({ line }) => /\bconfirmed\b/i.test(line))
    .filter(({ line }) =>
      !/not confirmed/i.test(line) &&
      !/"confirmed"/.test(line) &&
      !/^\s*\/\//.test(line) &&
      !/^ \*/.test(line),
    )
  check("handler.no-confirmed-claim", "no `confirmed` claim survives in the rendered lead path",
    claimLines.length === 0, claimLines.map(({ no, line }) => `L${no}: ${line.trim().slice(0, 90)}`).join(" | "))
  check("handler.no-finding-claim", "the lead answer does not call a co-occurrence pair a finding",
    !handler.includes("] finding:") && !/resolved finding\(s\)/.test(handler), "no `] finding:` line")

  // ── C. descriptor: "lead generator", not a scanner ──────────────────────
  const descriptorRel = "src/mcp/tools/bb_security/descriptor.ts"
  const descriptor = exists(descriptorRel) ? read(descriptorRel) : ""
  check("descriptor.lead-generator", "descriptor description says lead generator", /lead generator/i.test(descriptor), "lead generator")
  check("descriptor.no-scanner-claim", "descriptor does not market a security scan",
    !/security scan/i.test(descriptor) && !/Taint-flow security scan/i.test(descriptor), "no `security scan` phrase")
  check("descriptor.no-dataflow-claim", "descriptor declares it does NOT perform data-flow analysis",
    descriptor.includes("does NOT perform data-flow analysis"), "does NOT perform data-flow analysis")
  check("descriptor.manual-validation", "descriptor requires manual validation of leads",
    descriptor.includes("leads require manual validation"), "manual validation")
  check("descriptor.unsupported-not-clean-zero", "descriptor states unsupported languages are not scanned, never a clean zero",
    descriptor.includes("not scanned, never as a clean zero"), "declared unsupported contract")

  // ── D. onboarding: the phrase users copy into their projects ────────────
  const onboardRel = "src/cli/onboard.ts"
  const onboard = exists(onboardRel) ? read(onboardRel) : ""
  const onboardLine = onboard.split("\n").find((line) => line.includes("bb_security:")) ?? ""
  check("onboard.leads-wording", "onboard bb_security line describes security leads / manual validation",
    /security leads/i.test(onboardLine) && /manual validation/i.test(onboardLine), onboardLine.trim().slice(0, 160))
  check("onboard.old-phrase-gone", "onboard no longer says 'taint flows and injection findings'",
    !onboard.includes("taint flows and injection findings"), "old phrase absent")
  const agents = exists("AGENTS.md") ? read("AGENTS.md") : ""
  const agentsBlock = (agents.match(/<!-- bb:onboard:start -->([\s\S]*?)<!-- bb:onboard:end -->/) ?? ["", ""])[1] ?? ""
  check("agents.leads-wording", "AGENTS.md onboarding block describes security leads",
    /security leads/i.test(agentsBlock), agentsBlock.split("\n").find((line) => line.includes("bb_security"))?.trim().slice(0, 160) ?? "no bb_security row")
  check("agents.old-phrase-gone", "AGENTS.md onboarding block no longer says 'taint flows and injection findings'",
    !agentsBlock.includes("taint flows and injection findings"), "old phrase absent")

  // ── E. generated public docs/data: same claim as the descriptor ──────────
  const docsToolRel = "docs/tools/bb_security.md"
  const docsTool = exists(docsToolRel) ? read(docsToolRel) : ""
  check("docs.tool.no-scanner-claim", "docs/tools/bb_security.md no longer says 'Taint-flow security scan'",
    docsTool.length > 0 && !docsTool.includes("Taint-flow security scan"), "old phrase absent")
  check("docs.tool.lead-generator", "docs/tools/bb_security.md states lead generator",
    /lead generator/i.test(docsTool), "lead generator")
  const publicToolsRel = "docs/data/public-tools.json"
  const publicTools = exists(publicToolsRel) ? read(publicToolsRel) : ""
  check("docs.data.no-scanner-claim", "docs/data/public-tools.json no longer carries the Taint-flow security scan description",
    publicTools.length > 0 && !publicTools.includes("Taint-flow security scan"), "old phrase absent")
  check("docs.data.lead-generator", "docs/data/public-tools.json bb_security description states lead generator",
    /lead generator/i.test(publicTools), "lead generator")
  const websiteToolsRel = "website/src/data/tools.generated.ts"
  const websiteTools = exists(websiteToolsRel) ? read(websiteToolsRel) : ""
  check("website.no-scanner-claim", "generated website tool data no longer says 'Taint-flow security scan'",
    websiteTools.length > 0 && !websiteTools.includes("Taint-flow security scan"), "old phrase absent")
  // docs/BB_SECURITY.md is the reference page (answer-claims task-7 rewrite). It
  // is a declared KNOWN-GAP while that lane is open; the strict predicate flips
  // it to a hard FAIL the moment the file claims the wording but misses it again.
  const bbSecurityRel = "docs/BB_SECURITY.md"
  const bbSecurity = exists(bbSecurityRel) ? read(bbSecurityRel) : ""
  if (/lead generator/i.test(bbSecurity)) {
    check("reference.lead-generator", "docs/BB_SECURITY.md states the lead-generator framing", true, "lead generator")
  } else {
    knownGap(
      "reference.lead-generator",
      "docs/BB_SECURITY.md must state the lead-generator framing first",
      "reference page rewrite is the answer-claims Phase-0 lane (task-7) and has not landed in the working tree",
      bbSecurityRel,
      firstLineOf(bbSecurity),
    )
  }

  // ── F. real-corpus `parameterized-sql-negative` defect ──────────────────
  const realCorpusRel = "validation/tools/bb_security/REAL-CORPUS.json"
  if (!exists(realCorpusRel)) {
    check("realcorpus.exists", "REAL-CORPUS evidence exists", false, realCorpusRel)
  } else {
    const raw = read(realCorpusRel)
    const doc = JSON.parse(raw) as {
      adversarial?: Array<{
        id?: string
        pass?: boolean | null
        sqlInjectionLeads?: number
        parsed?: {
          // M72 lead-store shape (regenerated evidence)
          leadLines?: string[]
          storedLeads?: number | null
          leadCountByLabel?: Record<string, number>
          // legacy token-cooccurrence shape (pre-M72 evidence)
          findingLines?: string[]
          severityHead?: Record<string, number>
          observationLines?: string[]
        }
        text?: string
      }>
    }
    const negative = (doc.adversarial ?? []).find((row) => row.id === "parameterized-sql-negative")
    const line = lineOf(raw, '"parameterized-sql-negative"')
    check("realcorpus.case", "REAL-CORPUS records the parameterized-sql-negative case", Boolean(negative), `${realCorpusRel}:${line}`)
    if (negative) {
      const parsed = negative.parsed ?? {}
      // The evidence shape is part of the contract: an unrecognized shape must
      // FAIL, never be read as "no findings" (a silent pass).
      const m72Shape = Array.isArray(parsed.leadLines) || typeof parsed.storedLeads === "number"
      const legacyShape = Array.isArray(parsed.findingLines)
      let sqlInjectionLeads: string[] = []
      let strictSafe = false
      let shapeLabel = ""
      if (m72Shape) {
        shapeLabel = "M72 lead-store evidence (parsed.leadLines / parsed.storedLeads)"
        sqlInjectionLeads = (parsed.leadLines ?? []).filter((entry) => /sql injection/i.test(entry))
        const storedRaw = parsed.storedLeads
        const stored = typeof storedRaw === "number" ? storedRaw : Number.NaN
        strictSafe =
          Number.isNaN(stored) === false &&
          stored === 0 &&
          sqlInjectionLeads.length === 0 &&
          Number(negative.sqlInjectionLeads ?? 0) === 0
      } else if (legacyShape) {
        shapeLabel = "legacy token-cooccurrence evidence (parsed.findingLines)"
        sqlInjectionLeads = (parsed.findingLines ?? []).filter((entry) => /SQL injection/i.test(entry))
        const criticalHead = Number(parsed.severityHead?.critical ?? 0)
        strictSafe = sqlInjectionLeads.length === 0 && criticalHead === 0
      } else {
        shapeLabel = "unrecognized"
        check("realcorpus.shape",
          "REAL-CORPUS records a recognized evidence shape (M72 lead store or legacy findings)",
          false,
          `unrecognized parsed shape: ${Object.keys(parsed).join(",") || "<empty>"} — regenerate with validation/tools/bb_security/work/probe-real-corpus.ts`)
      }
      if (shapeLabel !== "unrecognized") {
        if (strictSafe) {
          check("realcorpus.parameterized-safe", "a parameterized safe query is not reported as a SQL-injection lead",
            true, `shape=${shapeLabel}`)
        } else {
          knownGap(
            "realcorpus.parameterized-safe",
            "a parameterized safe query must not be reported as a SQL-injection lead",
            shapeLabel === "unrecognized"
              ? "the recorded evidence shape is not recognized by this gate"
              : "the recorded REAL-CORPUS evidence still reports the parameterized query as a SQL-injection lead; regenerate it with validation/tools/bb_security/work/probe-real-corpus.ts (M72 lead store) — the strict predicate stays red until that evidence is regenerated",
            `${realCorpusRel}:${line}`,
            `${sqlInjectionLeads[0] ?? "no SQL-injection lead line"} (recorded pass=${String(negative.pass)})`,
          )
        }
        // The recorded `pass` flag must never bless the defect: a case that still
        // reports a SQL-injection lead cannot honestly be `pass: true`.
        const passFlagContradiction = !strictSafe && negative.pass === true
        if (passFlagContradiction) {
          knownGap(
            "realcorpus.pass-flag",
            "the recorded case cannot pass while it reports the parameterized query as SQL injection",
            "the recorded evidence still shows the SQL-injection lead with pass=true; this closes only when the evidence is regenerated and the predicate above turns green",
            `${realCorpusRel}:${line}`,
            `pass=true with ${sqlInjectionLeads.length || "unreported"} SQL-injection lead(s)`,
          )
        } else {
          check("realcorpus.pass-flag", "the recorded case cannot pass while it reports the parameterized query as SQL injection",
            true, `pass=${String(negative.pass)} consistent with a safe case`)
        }
      }
    }
  }

  // ── summary + evidence ──────────────────────────────────────────────────
  const failures = checks.filter((row) => !row.ok && !knownGaps.some((gap) => gap.id === row.id))
  const passed = checks.filter((row) => row.ok).length
  const gapChecks = checks.filter((row) => !row.ok && knownGaps.some((gap) => gap.id === row.id))
  const failed = failures.length

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
        probe: "m72-security-phase0",
        what: "Phase-0 honesty-demotion contract: registry tier baseline, answer-surface strings, public claim files, and the real-corpus parameterized-SQL defect",
        generatedAt: new Date().toISOString(),
        head,
        command: "npx tsx script/m72/verify-security-phase0.ts",
        checks: checks.length,
        passed,
        failed,
        knownGaps: knownGaps.length,
        knownGapChecks: gapChecks.length,
        failures: failures.map((row) => `${row.id}: ${row.label} — ${row.detail}`),
        knownGapEntries: knownGaps,
        rows: checks,
      },
      null,
      2,
    ) + "\n",
  )

  console.log("")
  for (const row of checks) {
    if (row.ok) {
      if (process.env.M72_VERBOSE) console.log(`  ok:   ${row.id} — ${row.label}`)
    } else if (knownGaps.some((gap) => gap.id === row.id)) {
      console.log(`  KNOWN-GAP: ${row.id} — ${row.label}`)
      console.log(`             reason: ${row.detail}`)
    } else {
      console.log(`  FAIL: ${row.id} — ${row.label}${row.detail ? ` — ${row.detail}` : ""}`)
    }
  }
  for (const gap of knownGaps) console.log(`  KNOWN-GAP evidence: ${gap.id} -> ${gap.evidence}`)

  const verdict = failed === 0 ? (knownGaps.length === 0 ? "PASS" : "PASS (with explicit KNOWN-GAP)") : "FAIL"
  console.log(
    `\nM72 PHASE-0 SECURITY CONTRACT: ${verdict} — ${checks.length} checks, ${passed} passed, ${failed} failed, ${knownGaps.length} KNOWN-GAP`,
  )
  console.log(`  evidence: validation/m72/results/phase0.json`)
  return failed === 0 ? 0 : 1
}

function firstLineOf(text: string): string {
  return (text.split("\n").find((line) => line.trim().length > 0) ?? "").trim().slice(0, 160)
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
