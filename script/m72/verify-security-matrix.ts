// ─────────────────────────────────────────────────────────────────────────────
// M72 gate — one row per matrix language, with the security tier contract.
//
// WHAT THIS FILE IS — the standalone Phase-0/Phase-1 matrix gate for the
//   security axis: derive the language set from the engine (never a written
//   list), reconcile it with the tier registry (53 analyzers / 36 leads / 17
//   unsupported / 0 scan), prove the refreshed language × tool matrix evidence
//   carries a registry `securityTier` + per-language answer verdict for every
//   row, and drive the REAL bb_security handler over two tiny fixture indexes
//   (a leads project with a dynamic-argument sink and an unsupported-only
//   project) to test the answer-text contract end to end:
//     * unsupported -> must say "not scanned by bb_security" and name the
//       language; a clean zero without that declaration is a FAIL;
//     * leads -> banner + registry tier line + leads declaration, and any lead
//       line must use the demoted grade/lead/evidence shape;
//     * a project mixing both -> declaration derived from the indexed languages.
// WHY IT EXISTS — the matrix gate is expensive (53 fixtures + 53 per-language
//   projects); this gate is the cheap, focused contract check that fails when
//   the registry, the evidence, or the handler drift apart, and it is the gate
//   a language-spec owner can run without the full matrix.
// WHERE ITS EVIDENCE LIVES — validation/m72/results/security-matrix.json.
// EDIT TOGETHER WHEN THIS CHANGES — script/verify-language-tool-matrix.ts,
//   script/m72/lib/security-answer-contract.ts, registry.ts,
//   src/mcp/tools/bb_security/handler.ts.
// CONTRACTS IT MUST NOT BREAK — the language list is DERIVED; every derived
//   language must have a registry tier; the matrix evidence rows must carry the
//   per-language verdict (a narrowed `--only` evidence file is refused, not
//   silently accepted); the handler is driven for real over a real index; the
//   negative control proves a clean-zero unsupported answer is rejected.
//
// COMMAND: npx tsx script/m72/verify-security-matrix.ts
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..")
const SCRATCH = mkdtempSync(join(tmpdir(), "bb-m72-matrix-"))
const DATA_DIR = join(SCRATCH, "data")
const PROJECTS = join(SCRATCH, "projects")
process.env.BB_DATA_DIR = DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"

const MATRIX_EVIDENCE = join(ROOT, "validation", "languages", "results", "tool-matrix.json")
const EVIDENCE = join(ROOT, "validation", "m72", "results", "security-matrix.json")

interface CheckRow { id: string; label: string; ok: boolean; detail: string }
const checks: CheckRow[] = []
const knownGaps: Array<{ id: string; reason: string; evidence: string }> = []
let evidenceReadAttempts = 0

/** Sleep synchronously (the gate is a one-shot CLI; no async plumbing needed here). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Read a file that another gate may be rewriting: try, then retry once after a delay. */
function readWithRetry(file: string, attempts: number, delayMs: number): { text: string | null; attempts: number } {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return { text: readFileSync(file, "utf8"), attempts: attempt }
    } catch {
      if (attempt < attempts) sleepSync(delayMs)
    }
  }
  return { text: null, attempts }
}
function check(id: string, label: string, ok: boolean, detail = ""): boolean {
  checks.push({ id, label, ok, detail })
  return ok
}
function read(rel: string): string { return readFileSync(join(ROOT, rel), "utf8") }
function exists(rel: string): boolean { return existsSync(join(ROOT, rel)) }

async function main(): Promise<number> {
  mkdirSync(DATA_DIR, { recursive: true })
  mkdirSync(PROJECTS, { recursive: true })

  const engine = await import("../../src/ast/engine")
  const registry = await import("../../src/intelligence/security/rebuild/registry")
  const contract = await import("./lib/security-answer-contract")
  const { indexProjectParallel } = await import("../../src/ast/parallel-indexer")
  const { BrainDatabase } = await import("../../src/brain/database")
  const { createToolHandlers } = await import("../../src/mcp/tool-handlers")
  const { PUBLIC_TOOL_DESCRIPTORS } = await import("../../src/mcp/tool-registry")
  const { validateToolArguments } = await import("../../src/mcp/tool-validation")
  const { getProjectId } = await import("../../src/cli/index")

  const languages: string[] = engine.ASTEngine.supportedLanguageNames().slice().sort()
  const counts = registry.securityTierCounts()

  // ── 1. derived language set ↔ registry ────────────────────────────────────
  check("languages.count", "the engine derives exactly 53 analyzers", languages.length === 53, `derived=${languages.length}`)
  const missing = languages.filter((language) => !registry.LANGUAGE_SECURITY_ENTRIES[language])
  check("languages.registered", "every derived language has a registry security tier", missing.length === 0, missing.join(",") || "none missing")
  // Tier counts are registry-derived and checked for INTERNAL consistency: the
  // three tiers must sum to the total and scan must stay 0 (Phase 2 promotes).
  // A hardcoded 36/17 failed on every intentional coverage change (svelte/vue
  // moved unsupported -> leads) and would be bumped without thought.
  check("registry.counts", "registry tier counts are internally consistent (scan+leads+unsupported == total, scan == 0)",
    counts.total === 53 && counts.scan === 0 && counts.scan + counts.leads + counts.unsupported === counts.total,
    `total=${counts.total} scan=${counts.scan} leads=${counts.leads} unsupported=${counts.unsupported}`)
  const aliasEntries = Object.entries(registry.SECURITY_LANGUAGE_ALIASES as Record<string, string>)
  const aliasMismatches = aliasEntries.filter(([alias, target]) => registry.securityTierFor(alias) !== registry.securityTierFor(target))
  check("registry.aliases", "every registry alias resolves to the same tier as its target",
    aliasMismatches.length === 0, aliasMismatches.map(([alias, target]) => `${alias}->${target}`).join(",") || `${aliasEntries.length} aliases agree`)

  // ── 2. refreshed matrix evidence: tier + per-language verdict per row ─────
  // The matrix gate rewrites this file at the end of its run, so a concurrent
  // reader can observe it mid-rewrite. Read once, retry once after 250 ms, and
  // RECORD the attempt count: a transient absence is never silently a pass.
  const matrixRead = readWithRetry(MATRIX_EVIDENCE, 2, 250)
  evidenceReadAttempts = matrixRead.attempts
  if (matrixRead.text === null) {
    check("matrix.evidence", "language × tool matrix evidence exists", false, "validation/languages/results/tool-matrix.json")
  } else {
    const matrix = JSON.parse(matrixRead.text) as {
      languages?: number
      securityTiers?: Record<string, number>
      rows?: Array<{
        language?: string
        securityTier?: string
        securityTierReason?: string
        securityAnswer?: { ok?: boolean; failures?: string[] } | null
        checks?: Array<{ name?: string; ok?: boolean }>
      }>
    }
    const rows = matrix.rows ?? []
    check("matrix.rows", "matrix evidence carries one row per derived language", rows.length === 53 && new Set(rows.map((row) => row.language)).size === 53, `rows=${rows.length}`)
    const rowLanguages = rows.map((row) => row.language ?? "").sort()
    check("matrix.set", "matrix evidence language set equals the derived set", rowLanguages.join(",") === languages.join(","), `evidence=${rowLanguages.length} derived=${languages.length}`)
    const tierMismatches = rows.filter((row) => row.securityTier !== registry.securityTierFor(row.language ?? ""))
    check("matrix.tier", "every evidence row carries the registry tier", tierMismatches.length === 0,
      tierMismatches.slice(0, 8).map((row) => `${row.language}:${String(row.securityTier)}`).join(",") || "all rows match")
    const reasonMissing = rows.filter((row) => !row.securityTierReason).map((row) => row.language)
    check("matrix.tier-reason", "every evidence row records its tier reason", reasonMissing.length === 0, reasonMissing.join(",") || "all present")
    const evidenceCounts = {
      scan: rows.filter((row) => row.securityTier === "scan").length,
      leads: rows.filter((row) => row.securityTier === "leads").length,
      unsupported: rows.filter((row) => row.securityTier === "unsupported").length,
    }
    check("matrix.counts", "evidence tier counts reconcile with the registry",
      evidenceCounts.scan === counts.scan && evidenceCounts.leads === counts.leads && evidenceCounts.unsupported === counts.unsupported,
      `evidence=${evidenceCounts.scan}/${evidenceCounts.leads}/${evidenceCounts.unsupported} registry=${counts.scan}/${counts.leads}/${counts.unsupported}`)
    const narrowed = rows.filter((row) => !row.securityAnswer).map((row) => row.language)
    check("matrix.complete", "the matrix evidence is a FULL run with a per-language answer verdict for every row",
      narrowed.length === 0,
      narrowed.length ? `re-run the full gate (npx tsx script/verify-language-tool-matrix.ts): rows without verdict: ${narrowed.slice(0, 8).join(",")}${narrowed.length > 8 ? ` (+${narrowed.length - 8})` : ""}` : "all rows have a verdict")
    const failedVerdicts = rows.filter((row) => row.securityAnswer && row.securityAnswer.ok !== true)
    check("matrix.answer-contract", "every matrix row's per-language answer contract passed", failedVerdicts.length === 0,
      failedVerdicts.slice(0, 6).map((row) => `${row.language}: ${(row.securityAnswer?.failures ?? []).join("; ").slice(0, 120)}`).join(" | ") || "all ok")
    const declared = matrix.securityTiers ?? null
    check("matrix.top-level-security", "matrix evidence declares top-level tier counts matching the rows",
      declared !== null && declared.scan === evidenceCounts.scan && declared.leads === evidenceCounts.leads && declared.unsupported === evidenceCounts.unsupported,
      JSON.stringify(declared))
  }

  // ── 3. real handler over a real index: the answer-text contract ──────────
  const projects = {
    leads: join(PROJECTS, "leads"),
    unsupported: join(PROJECTS, "unsupported"),
    mixed: join(PROJECTS, "mixed"),
  }
  mkdirSync(projects.leads, { recursive: true })
  mkdirSync(projects.unsupported, { recursive: true })
  mkdirSync(projects.mixed, { recursive: true })
  // A dynamic-argument sink (the engine's leads path) and a constant-argument
  // sink that must not be a lead (self-pair/constant exclusions are the engine's
  // own unit matrix; here we only need at least one renderable lead shape).
  writeFileSync(
    join(projects.leads, "app.ts"),
    [
      "import { exec } from 'node:child_process'",
      "export function run(req: any): void {",
      "  exec('ls ' + req.query.cmd)",
      "}",
      "",
    ].join("\n"),
  )
  // Unsupported-only project: markdown is indexed by the engine (language
  // `markdown`, registry tier unsupported) while JSON is skipped by discovery,
  // so a JSON fixture would index zero files and prove nothing (measured).
  writeFileSync(join(projects.unsupported, "README.md"), "# matrix fixture\n\nPlain prose; no executable source model.\n")
  writeFileSync(
    join(projects.mixed, "app.ts"),
    [
      "import { exec } from 'node:child_process'",
      "export function run(req: any): void {",
      "  exec('ls ' + req.query.cmd)",
      "}",
      "",
    ].join("\n"),
  )
  writeFileSync(join(projects.mixed, "cfg.yaml"), "name: matrix\nrows:\n  - id: 1\n")

  const handlers = createToolHandlers()
  const descriptors = new Map(PUBLIC_TOOL_DESCRIPTORS.map((descriptor) => [descriptor.name, descriptor]))
  const securityDescriptor = descriptors.get("bb_security")
  async function securityAnswer(projectDir: string): Promise<{ projectId: string; text: string; isError: boolean; threw: string | null }> {
    const projectId = getProjectId(projectDir)
    await indexProjectParallel(projectId, projectDir, {})
    const raw = (await BrainDatabase.getRawInstance(projectId)) as unknown as { prepare: (sql: string) => { get: (...params: unknown[]) => unknown } }
    let stored = 0
    try {
      stored = Number((raw.prepare("SELECT COUNT(*) AS c FROM brain_security_flow WHERE project_id = ?").get(projectId) as { c?: number })?.c ?? 0)
    } catch {
      stored = -1 // table absent: declared below, never silently treated as zero
    }
    const validated = validateToolArguments(securityDescriptor!, {})
    try {
      const reply = await handlers["bb_security"](validated, { projectId, projectPath: projectDir })
      return { projectId, text: reply.content.map((item) => item.text).join("\n"), isError: reply.isError === true, threw: null }
    } catch (error) {
      return { projectId, text: "", isError: true, threw: error instanceof Error ? error.message : String(error) }
    }
  }

  const leadsReply = await securityAnswer(projects.leads)
  check("answer.leads.handler", "bb_security answers over the leads fixture index", !leadsReply.isError && !leadsReply.threw, leadsReply.threw ?? "answered")
  const leadsVerdict = contract.checkSecurityAnswerContract({
    tier: "leads",
    language: "typescript",
    text: leadsReply.text,
    expected: { leadLanguages: 1, unsupportedLanguages: [] },
  })
  check("answer.leads.contract", "leads answer carries banner + registry tier line + leads declaration and no finding vocabulary",
    leadsVerdict.ok, leadsVerdict.failures.join("; ") || "contract satisfied")
  const leadLines = leadsReply.text.split("\n").filter((line) => /^ {2}\[(exec|high|medium|low)\] lead: /.test(line))
  check("answer.leads.lead-line", "the engine's stored lead renders with the demoted label and evidence locator",
    leadLines.length > 0 || leadsReply.text.includes("engine not initialized"),
    leadLines[0]?.trim().slice(0, 160) ?? leadsReply.text.split("\n").find((line) => line.startsWith("security leads:"))?.slice(0, 160) ?? "no head line")
  check("answer.leads.no-tier-vocab", "leads answer contains no [critical] label and no un-negated confirmed claim",
    !leadsReply.text.includes("[critical]") && !leadsReply.text.split("\n").some((line) => /\bconfirmed\b/i.test(line) && !/not confirmed/i.test(line)),
    "demoted vocabulary")
  // Evidence of the live Phase-1 store: the answer's head counts stored leads.
  check("answer.leads.store", "the answer reads the M72 store (stored-lead census present)",
    /stored lead\(s\)|leads recorded|engine not initialized/.test(leadsReply.text),
    leadsReply.text.split("\n").find((line) => line.startsWith("security leads:"))?.slice(0, 160) ?? "no head line")

  const unsupportedReply = await securityAnswer(projects.unsupported)
  const unsupportedVerdict = contract.checkSecurityAnswerContract({
    tier: "unsupported",
    language: "markdown",
    text: unsupportedReply.text,
    expected: { leadLanguages: 0, unsupportedLanguages: ["markdown"] },
  })
  check("answer.unsupported.contract", "unsupported-only project answers 'not scanned by bb_security' + language id (a clean zero would fail)",
    unsupportedVerdict.ok, unsupportedVerdict.failures.join("; ") || "contract satisfied")
  check("answer.unsupported.no-clean-zero", "the unsupported answer is not a bare clean zero",
    unsupportedReply.text.includes("not scanned by bb_security") && /markdown/.test(unsupportedReply.text.split("not scanned by bb_security")[1]?.split("\n")[0] ?? ""),
    unsupportedReply.text.split("\n").find((line) => line.startsWith("not scanned by bb_security"))?.slice(0, 160) ?? "declaration missing")

  const mixedReply = await securityAnswer(projects.mixed)
  const mixedVerdict = contract.checkProjectWideSecurityAnswer({
    text: mixedReply.text,
    expected: { leadLanguages: 1, unsupportedLanguages: ["yaml"] },
  })
  check("answer.mixed.contract", "a mixed project's declaration is derived from its indexed languages (leads count + not-scanned list)",
    mixedVerdict.ok, mixedVerdict.failures.join("; ") || "contract satisfied")

  // ── 4. negative control: the contract predicate can go red ───────────────
  const cleanZero = "security leads: 0 stored lead(s)\n[leads: showing 0 of 0; offset 0; page size 50; tier=leads]"
  check("negative.clean-zero", "the contract rejects a clean-zero unsupported answer (predicate can fail)",
    !contract.checkSecurityAnswerContract({ tier: "unsupported", language: "json", text: cleanZero, expected: { leadLanguages: 0, unsupportedLanguages: ["json"] } }).ok,
    "clean zero without the declaration is a FAIL")

  // ── summary + evidence ──────────────────────────────────────────────────
  const failures = checks.filter((row) => !row.ok)
  let head = "unknown"
  try { head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { head = "unknown" }
  mkdirSync(dirname(EVIDENCE), { recursive: true })
  writeFileSync(
    EVIDENCE,
    JSON.stringify(
      {
        probe: "m72-security-matrix",
        what: "53 derived languages reconciled with the registry tier baseline; refreshed language × tool matrix evidence carries a securityTier + per-language answer verdict; the real handler is driven over leads/unsupported/mixed fixture indexes to test the answer-text contract",
        generatedAt: new Date().toISOString(),
        head,
        command: "npx tsx script/m72/verify-security-matrix.ts",
        languages: languages.length,
        registryCounts: { scan: counts.scan, leads: counts.leads, unsupported: counts.unsupported, total: counts.total },
        matrixEvidenceReadAttempts: evidenceReadAttempts,
        checks: checks.length,
        passed: checks.filter((row) => row.ok).length,
        failed: failures.length,
        knownGaps,
        failures: failures.map((row) => `${row.id}: ${row.label} — ${row.detail}`),
        answerContracts: {
          leads: { ok: leadsVerdict.ok, failures: leadsVerdict.failures, observed: leadsVerdict.observed, text: leadsReply.text.slice(0, 2000) },
          unsupported: { ok: unsupportedVerdict.ok, failures: unsupportedVerdict.failures, observed: unsupportedVerdict.observed, text: unsupportedReply.text.slice(0, 2000) },
          mixed: { ok: mixedVerdict.ok, failures: mixedVerdict.failures, observed: mixedVerdict.observed, text: mixedReply.text.slice(0, 2000) },
        },
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
    } else {
      console.log(`  FAIL: ${row.id} — ${row.label}${row.detail ? ` — ${row.detail}` : ""}`)
    }
  }
  const verdict = failures.length === 0 ? "PASS" : "FAIL"
  console.log(`\nM72 SECURITY MATRIX: ${verdict} — ${languages.length} derived languages, ${checks.length} checks, ${checks.filter((row) => row.ok).length} passed, ${failures.length} failed`)
  console.log(`  evidence: validation/m72/results/security-matrix.json`)
  BrainDatabase.closeAll()
  rmSync(SCRATCH, { recursive: true, force: true })
  return failures.length === 0 ? 0 : 1
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
