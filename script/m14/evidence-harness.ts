/**
 * M14.0.F2 — Evidence Harness v2
 *
 * The ONLY sanctioned way to write validation/m14/results/*.json.
 * Agents write code; this harness writes evidence. Hand-edited results are
 * invalid by definition (drift test regenerates and compares bytes).
 *
 * Honesty properties enforced here (docs/M14-HONESTY-CONTRACT.md):
 *   - canonical schema: missing required fields => rejected
 *   - claimLevel is the strict L0-L5 enum — no synonyms, no "done", no "green"
 *   - limitations[] must be non-empty OR carry an explicit justification
 *   - banned-vocabulary lint over every string in the artifact (contract §1)
 *   - deterministic output: sorted keys + commit-time timestamp =>
 *     regeneration at the same HEAD is byte-identical (drift = tampering)
 *
 * CLI:
 *   bun run script/m14/evidence-harness.ts validate            # gate all results
 *   bun run script/m14/evidence-harness.ts selftest            # prove rejections work
 */
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const RESULTS_DIR = path.join(ROOT, "validation", "m14", "results")

export const CLAIM_LEVELS = ["L0", "L1", "L2", "L3", "L4", "L5"] as const
export type ClaimLevel = (typeof CLAIM_LEVELS)[number]

// Contract §1 — banned verdict vocabulary. Word-boundary matched, case-insensitive.
export const BANNED_TERMS = [
  "perfect", "perfection", "complete", "fully done", "production-ready",
  "bulletproof", "rock-solid", "battle-tested",
  "extensively tested", "thoroughly reviewed",
  "should work", "expected to pass",
  "100% coverage", "100% verified",
]

export interface Check {
  id: string
  description: string
  /** `retired` is for a finding that is DECIDED rather than outstanding: a mutant
   *  that cannot be made fixtureable any more, retired with a written-down reason
   *  and its transform kept so restoring it is a one-line change. It stays VISIBLE in
   *  the artifact so nothing is hidden, and it is excluded from any failure count —
   *  filing a decision as a defect is what makes a register lie. Additive: every
   *  existing artifact uses only `pass`/`fail` and remains valid. */
  status: "pass" | "fail" | "retired"
  detail?: string
}
export interface Limitation {
  description: string
  justification?: string // required if this evidence claims L4+ with no other limitations? always recommended
}
export interface EvidenceInput {
  issueId: string
  title: string
  claimLevel: ClaimLevel
  layers: string[]
  checks: Check[]
  limitations: Limitation[]
  reviewers?: string[]
  corpusPins?: Record<string, string> // repo -> commit SHA
  mutationLog?: { mutant: string; injectedAt: string; caughtBy: string }[]
  data?: Record<string, unknown> // tool-specific payload (sorted deterministically)
}

export interface Validation {
  ok: boolean
  errors: string[]
  warnings: string[]
}

// ---------- deterministic serialization ----------
function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2)
}
function sortValue(v: unknown): any {
  if (Array.isArray(v)) return v.map(sortValue)
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as any).sort()) out[k] = sortValue((v as any)[k])
    return out
  }
  return v
}
function gitCommit(): string {
  return execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()
}
function gitCommitTime(): string {
  return execSync("git log -1 --format=%cI", { cwd: ROOT }).toString().trim()
}

// ---------- lint ----------
export function lintBanned(text: string): string[] {
  const hits: string[] = []
  for (const term of BANNED_TERMS) {
    const re = new RegExp(`\\b${term.replace(/[-]/g, "\\-")}\\b`, "i")
    if (re.test(text)) hits.push(term)
  }
  return hits
}
function collectStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v)
  else if (Array.isArray(v)) v.forEach(x => collectStrings(x, out))
  else if (v && typeof v === "object") Object.values(v).forEach(x => collectStrings(x, out))
  return out
}

// ---------- emit ----------
export function emitEvidence(input: EvidenceInput, resultsDir = RESULTS_DIR): string {
  const artifact = {
    schemaVersion: 2,
    issueId: input.issueId,
    title: input.title,
    governance: "docs/M14-HONESTY-CONTRACT.md",
    commit: gitCommit(),
    committedAt: gitCommitTime(),
    runtime: `node ${process.version}`,
    claimLevel: input.claimLevel,
    layers: input.layers,
    checks: input.checks,
    limitations: input.limitations.length ? input.limitations : [{ description: "__NONE__" }],
    ...(input.reviewers ? { reviewers: input.reviewers } : {}),
    ...(input.corpusPins ? { corpusPins: input.corpusPins } : {}),
    ...(input.mutationLog ? { mutationLog: input.mutationLog } : {}),
    ...(input.data ? { data: input.data } : {}),
  }
  const validation = validateArtifact(artifact)
  if (!validation.ok) {
    throw new Error(`Refusing to emit invalid evidence for ${input.issueId}:\n` + validation.errors.join("\n"))
  }
  fs.mkdirSync(resultsDir, { recursive: true })
  const file = path.join(resultsDir, `${input.issueId}.json`)
  // M49 #761 (process gate): evidence files are shared across agents/laptops —
  // a mid-write crash (or a killed parallel run) previously left TRUNCATED
  // evidence that read as empty baselines, and stale evidence could masquerade
  // as fresh at an unrelated HEAD. Writes are now ATOMIC (tmp+rename: readers
  // never see a partial file) and every artifact carries its lineage
  // (regeneratedAtCommit + timestamp) so gate consumers can detect staleness.
  const lineage = {
    ...artifact,
    regeneratedAtCommit: gitCommit(),
    regeneratedAt: new Date().toISOString(),
  }
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, stableStringify(lineage) + "\n")
  fs.renameSync(tmp, file)
  return file
}

// ---------- validate ----------
export function validateArtifact(a: any): Validation {
  const errors: string[] = []
  const warnings: string[] = []

  const req: [string, boolean][] = [
    ["schemaVersion", typeof a?.schemaVersion === "number"],
    ["issueId", typeof a?.issueId === "string" && /^M14\./.test(a.issueId)],
    ["title", typeof a?.title === "string" && a.title.length > 0],
    ["governance", a?.governance === "docs/M14-HONESTY-CONTRACT.md"],
    ["commit", typeof a?.commit === "string" && /^[0-9a-f]{40}$/.test(a.commit)],
    ["committedAt", typeof a?.committedAt === "string"],
    ["claimLevel", CLAIM_LEVELS.includes(a?.claimLevel)],
    ["layers", Array.isArray(a?.layers)],
    ["checks", Array.isArray(a?.checks) && a.checks.length > 0],
    ["limitations", Array.isArray(a?.limitations)],
  ]
  for (const [name, ok] of req) if (!ok) errors.push(`missing/invalid required field: ${name}`)

  if (a?.limitations?.length === 1 && a.limitations[0]?.description === "__NONE__") {
    warnings.push("limitations explicitly empty — justification REQUIRED for dynamic languages (contract §3)")
    if (typeof a?.data?.limitationsJustification !== "string" || !a.data.limitationsJustification) {
      errors.push("empty limitations without data.limitationsJustification is dishonest (contract §3)")
    }
  }
  if (a?.claimLevel === "L4" || a?.claimLevel === "L5") {
    if (!Array.isArray(a?.mutationLog) || a.mutationLog.length < 3) {
      errors.push(`${a?.claimLevel} requires >=3 mutationLog entries (contract closure #3)`)
    }
  }
  for (const c of a?.checks ?? []) {
    if (!c?.id || !c?.description || !["pass", "fail", "retired"].includes(c?.status)) {
      errors.push(`malformed check entry: ${JSON.stringify(c)?.slice(0, 80)}`)
    }
  }

  // Banned-vocabulary lint over AGENT-AUTHORED claim fields only. Arbitrary
  // data payloads (corpus source lines, quoted file content, targets) are
  // EVIDENCE, not claims - a corpus comment saying 'complete the loop' must
  // not fail the gate. Claim fields are exactly where an agent could inject
  // a verdict.
  const claimFields = [
    a?.title ?? "",
    ...(a?.checks ?? []).map((c: any) => `${c?.description ?? ""} ${c?.detail ?? ""}`),
    ...(a?.limitations ?? []).flatMap((l: any) => [l?.description ?? "", l?.justification ?? ""]),
    ...(a?.mutationLog ?? []).map((m: any) => `${m?.description ?? ""} ${m?.detail ?? ""}`),
  ]
  const banned = new Set<string>()
  for (const s of claimFields) for (const hit of lintBanned(s)) banned.add(hit)
  if (banned.size) errors.push(`banned vocabulary present (contract §1): ${[...banned].join(", ")}`)

  return { ok: errors.length === 0, errors, warnings }
}

export function validateFile(file: string): Validation {
  let parsed: any
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (e) {
    return { ok: false, errors: [`unparseable JSON: ${(e as Error).message}`], warnings: [] }
  }
  // legacy schema (schemaVersion 1, e.g. pre-harness F1 output) is rejected: migrate
  if (parsed?.schemaVersion !== 2) {
    return { ok: false, errors: [`unsupported schemaVersion (${parsed?.schemaVersion}) — regenerate via harness v2`], warnings: [] }
  }
  return validateArtifact(parsed)
}

// ---------- selftest: prove the validator rejects dishonesty ----------
export function selftest(): boolean {
  const base: EvidenceInput = {
    issueId: "M14.9.SELFTEST",
    title: "harness selftest artifact",
    claimLevel: "L2",
    layers: ["grammar-conformance"],
    checks: [{ id: "s1", description: "synthetic check", status: "pass" }],
    limitations: [{ description: "selftest fixture limitation" }],
  }
  const tmp = fs.mkdtempSync("/tmp/opencode/m14-selftest-")

  // 1. valid artifact passes
  const goodFile = path.join(tmp, "good.json")
  fs.writeFileSync(goodFile, stableStringify(buildArtifact(base)))
  const rGood = validateFile(goodFile)

  // 2. determinism: same input => byte-identical
  const goodFile2 = path.join(tmp, "good2.json")
  fs.writeFileSync(goodFile2, stableStringify(buildArtifact(base)))

  // 3. missing fields rejected
  const bad1 = { ...buildArtifact(base) } as any
  delete bad1.claimLevel

  // 4. fake claim level rejected
  const bad2 = { ...buildArtifact(base), claimLevel: "PERFECT" }

  // 5. banned vocabulary rejected
  const bad3input = { ...base, title: "this makes the analyzer bulletproof and complete" }
  const bad3 = buildArtifact(bad3Input(bad3input))

  // 6. empty limitations without justification rejected
  const bad4 = buildArtifact({ ...base, limitations: [] } as any)

  // 7. L5 without mutationLog rejected
  const bad5 = buildArtifact({ ...base, claimLevel: "L5" })

  const results: [string, Validation][] = [
    ["valid artifact accepted", rGood],
    ["determinism (byte-identical)", { ok: fs.readFileSync(goodFile, "utf8") === fs.readFileSync(goodFile2, "utf8"), errors: [], warnings: [] }],
    ["missing claimLevel rejected", invert(validateArtifact(bad1))],
    ["fake claim level rejected", invert(validateArtifact(bad2))],
    ["banned vocabulary rejected", invert(validateArtifact(bad3))],
    ["empty limitations rejected", invert(validateArtifact(bad4))],
    ["L5 without mutations rejected", invert(validateArtifact(bad5))],
  ]
  let allOk = true
  for (const [name, r] of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  selftest: ${name}`)
    if (!r.ok) { allOk = false; r.errors.forEach(e => console.log("      ", e)) }
  }
  fs.rmSync(tmp, { recursive: true, force: true })
  return allOk

  function buildArtifact(inp: EvidenceInput): any {
    return JSON.parse(stableStringify(assemble(inp)))
  }
  function bad3Input(i: any): EvidenceInput { return i as EvidenceInput }
  function assemble(inp: EvidenceInput): any {
    return {
      schemaVersion: 2,
      issueId: inp.issueId,
      title: inp.title,
      governance: "docs/M14-HONESTY-CONTRACT.md",
      commit: gitCommit(),
      committedAt: gitCommitTime(),
      runtime: `node ${process.version}`,
      claimLevel: inp.claimLevel,
      layers: inp.layers,
      checks: inp.checks,
      limitations: inp.limitations.length ? inp.limitations : [{ description: "__NONE__" }],
      ...(inp.data ? { data: inp.data } : {}),
    }
  }
  function invert(r: Validation): Validation {
    return { ok: !r.ok, errors: r.ok ? ["expected rejection but artifact passed"] : [], warnings: [] }
  }
}

// ---------- CLI ----------
if (import.meta.main) {
  const cmd = process.argv[2]
  if (cmd === "selftest") {
    process.exit(selftest() ? 0 : 2)
  } else if (cmd === "validate") {
    const files = fs.existsSync(RESULTS_DIR)
      ? fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith(".json")).map(f => path.join(RESULTS_DIR, f))
      : []
    if (!files.length) { console.error("no evidence files found"); process.exit(2) }
    let failed = 0
    for (const f of files) {
      const r = validateFile(f)
      console.log(`${r.ok ? "PASS" : "FAIL"}  ${path.basename(f)}${r.warnings.length ? "  (warnings: " + r.warnings.length + ")" : ""}`)
      if (!r.ok) { failed++; r.errors.forEach(e => console.log("      ", e)) }
      else r.warnings.forEach(w => console.log("   warn:", w))
    }
    console.log(`\n${files.length - failed}/${files.length} evidence files valid`)
    process.exit(failed ? 3 : 0)
  } else {
    console.log("usage: evidence-harness.ts validate|selftest")
    process.exit(1)
  }
}
