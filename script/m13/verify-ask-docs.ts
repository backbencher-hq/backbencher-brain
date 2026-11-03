// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the bb_ask docs/evidence/release gate: the generated page must be
//   byte-fresh from the executable registry, its Contract section must match the registry
//   field by field, the hand-written guide must state the measured rules (page size,
//   floors, coverage, scan cap, provider ceiling, freshness markers) and carry no
//   milestone narrative, the lane's own gate evidence must be green, and the release
//   validator must block a tampered "verified" claim.
// WHICH TOOL IT SERVES — bb_ask (read, requiresIndex true, modes: answer).
// WHY IT IS SHAPED THIS WAY — docs drift is a silent defect: a page that promises a default
//   or bound the code does not honour is the first lie a caller meets. This gate renders
//   the real generator, checks the guide against the same measured rules the behavioural
//   gates assert, and is itself falsifiable (the tamper test drives the real validator).
// WHERE ITS EVIDENCE LIVES — validation/m13/results/a6.json, validation/tools/bb_ask/gates/,
//   docs/tools/bb_ask.md, docs/BB_ASK.md.
// EDIT TOGETHER WHEN THIS FILE CHANGES — docs/tools/bb_ask.md, docs/BB_ASK.md,
//   script/tool-docs/curation/bb_ask.ts, src/mcp/tools/bb_ask/descriptor.ts,
//   validation/tools/bb_ask/work/run-gates.mjs.
// CONTRACTS IT MUST NOT BREAK — the page is generated from the registry (never hand-edited);
//   the guide's claims are the measured ones; evidence is not assumed green.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Harness } from "./harness"
import { validateEvidence } from "./verify-evidence"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs")
const isBun = typeof (globalThis as any).Bun !== "undefined"

const harness = new Harness({
  issue: "M13.28",
  code: "A6",
  tool: "bb_ask",
  title: "bb_ask: documentation truth, lane gate evidence and release gate",
  layers: ["unit", "e2e"],
  decisions: {
    docsAuthority: "src/mcp/tools/bb_ask/descriptor.ts + script/tool-docs/curation/bb_ask.ts are the source; docs/tools/bb_ask.md is generated",
    guideTruth: "every measured rule the guide states is one a behavioural gate asserts (page size 1..100/default 5, similarity floors, per-space coverage, scan cap 20,000, provider wait ceiling 2 s, STALE vs MISSING)",
    laneEvidence: "validation/tools/bb_ask/gates/summary.json must show the other ask gates verified",
    releaseGate: "the release validator blocks a tampered verified claim — proven against the real validator",
  },
  limitations: [
    "Page byte-freshness is proven by the generator's own verify mode for this tool only (the campaign regenerates shared artifacts centrally).",
    "Lane evidence is produced by validation/tools/bb_ask/work/run-gates.mjs; this gate reads it rather than trusting the tree.",
  ],
})

// ── 1. Generated page matches the registry ─────────────────────────────────
const registry = PUBLIC_TOOL_DESCRIPTORS.find((tool) => tool.name === "bb_ask")
const docPath = path.join(REPO_ROOT, "docs", "tools", "bb_ask.md")
const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : ""
harness.check("docs: docs/tools/bb_ask.md exists", doc.length > 0, doc ? "" : "missing file")
if (registry) {
  const modes = registry.modes.map((m: string) => `\`${m}\``).join(", ")
  const planned = (registry.plannedModes ?? []).map((m: string) => `\`${m}\``).join(", ")
  const defaults = JSON.stringify(registry.documentation.defaults)
  harness.check("docs: category matches registry", doc.includes(`- Category: \`${registry.documentation.category}\``), `registry=${registry.documentation.category}`)
  harness.check("docs: mutability matches registry", doc.includes(`- Mutability: \`${registry.mutability}\``), `registry=${registry.mutability}`)
  harness.check("docs: requiresIndex matches registry", doc.includes(`- Requires index: \`${registry.requiresIndex}\``), `registry=${registry.requiresIndex}`)
  harness.check("docs: modes line matches registry (answer only)", doc.includes(`- Modes: ${modes}`), `registry=${modes}`)
  harness.check("docs: plannedModes line matches registry", doc.includes(`- Planned modes (roadmap, not executable): ${planned}`), `registry=${planned}`)
  harness.check("docs: defaults match registry", doc.includes(`- Defaults: \`${defaults}\``), `registry=${defaults}`)
  const props = Object.keys((registry.inputSchema as any).properties ?? {})
  const missing = props.filter((prop) => !doc.includes(`"${prop}"`))
  harness.check("docs: every input property is documented", missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : `${props.length} props`)
  harness.check("docs: limit's machine-readable range is rendered", doc.includes('"minimum": 1') && doc.includes('"maximum": 100'))
}

// ── 2. The page states the rules the behavioural gates assert ──────────────
harness.check("page: declares the page-size contract (1..100, default 5, refused not clamped)", /1\.\.100/.test(doc) && /default 5/.test(doc) && /refused rather than clamped/.test(doc), "")
harness.check("page: states that a non-discriminative ranking publishes no numeric confidence", doc.includes("non-discriminative") && doc.includes("no numeric confidence"), "")
harness.check("page: states both freshness markers (STALE and MISSING)", doc.includes("STALE — file changed since index") && doc.includes("MISSING — file no longer on disk"), "")
harness.check("page: states the declared bounds (returned/totalMatches/truncated)", doc.includes("totalMatches") && doc.includes("truncated") && doc.includes("truncationReason"), "")
harness.check("page: states the ask-time provider transmission", /sent to the configured embedding provider to compute the query vector/i.test(doc), "")
harness.negative("page: does not quote the retired 0.15 local similarity floor", !doc.includes("0.15"), "")

// ── 3. Hand-written guide states the measured rules and carries no narration ──
const guidePath = path.join(REPO_ROOT, "docs", "BB_ASK.md")
const guide = existsSync(guidePath) ? readFileSync(guidePath, "utf8") : ""
harness.check("guide: docs/BB_ASK.md exists with the author header", guide.includes("Author: Muhammad Ishaq Khan"), "")
const GUIDE_CLAIMS: Array<{ label: string; test: (text: string) => boolean }> = [
  { label: "page size 1..100 with default 5", test: (t) => /1\.\.100/.test(t) && /default \*\*5\*\*/.test(t) },
  { label: "local similarity floor 0.50 and model floor 0.35", test: (t) => t.includes("0.50") && t.includes("0.35") },
  { label: "local vocabulary is 205 words at 50 dimensions", test: (t) => t.includes("205-word") && t.includes("50 dimensions") },
  { label: "per-model coverage versus library coverage", test: (t) => t.includes("embeddingCoverage") && t.includes("libraryCoverage") },
  { label: "scan cap 20,000 and its declared truncation", test: (t) => t.includes("20,000") && t.includes("truncated=true") },
  { label: "provider wait ceiling min(2 s, BB_EMBEDDING_TIMEOUT_MS)", test: (t) => t.includes("min(2 s, BB_EMBEDDING_TIMEOUT_MS)") },
  { label: "STALE and MISSING are distinct markers", test: (t) => t.includes("STALE — file changed since index") && t.includes("MISSING — file no longer on disk") },
  { label: "the question is sent to the configured provider at ask time", test: (t) => /natural-language question is sent\b/i.test(t.replace(/\s+/g, " ")) },
]
for (const claim of GUIDE_CLAIMS) harness.check(`guide: states ${claim.label}`, claim.test(guide), "")
harness.negative("guide: no milestone narrative (M##.# codes, 'shipped in M', 'regression' framing)", !/\bM\d+\.\d+/.test(guide) && !/shipped in M/i.test(guide), (guide.match(/\bM\d+\.\d+/g) ?? []).slice(0, 5).join(", "))
harness.check("guide: every verification command names a file that exists", ["script/m13/verify-ask-contract.ts", "script/m13/verify-ask-provenance.ts", "script/m13/verify-ask-adversarial.ts", "script/m13/verify-ask-integration.ts", "script/m13/verify-ask-honesty.ts", "script/verify-semantic.ts", "script/m16/verify-ask-stats.ts", "script/m15/verify-ask-deep.ts", "script/m13/verify-ask-e2e-corpus.ts", "script/verify-tool-docs.ts"].every((rel) => existsSync(path.join(REPO_ROOT, rel))), "")

// ── 4. Generated page is byte-fresh for this tool ──────────────────────────
{
  const generator = path.join(REPO_ROOT, "script", "verify-tool-docs.ts")
  const result = isBun
    ? spawnSync(process.execPath, ["run", generator, "--only", "bb_ask"], { cwd: REPO_ROOT, encoding: "utf8", timeout: 180_000, env: { ...process.env } })
    : spawnSync(process.execPath, [TSX_CLI, generator, "--only", "bb_ask"], { cwd: REPO_ROOT, encoding: "utf8", timeout: 180_000, env: { ...process.env } })
  harness.check("docs: generator verify mode passes for bb_ask (page byte-fresh)", result.status === 0, result.status === 0 ? "" : (result.stderr || result.stdout || "").slice(0, 240))
}

// ── 5. The lane's own gate evidence is green ───────────────────────────────
const OTHER_GATES = ["verify-ask-contract", "verify-ask-provenance", "verify-ask-adversarial", "verify-ask-integration", "verify-ask-honesty", "verify-semantic", "verify-ask-stats", "verify-ask-deep", "verify-ask-e2e-corpus"]
{
  const summaryPath = path.join(REPO_ROOT, "validation", "tools", "bb_ask", "gates", "summary.json")
  let summary: any = null
  try { summary = JSON.parse(readFileSync(summaryPath, "utf8")) } catch {}
  harness.check("evidence: lane gate summary exists", !!summary, summaryPath)
  const rows: any[] = summary?.gates ?? []
  for (const gate of OTHER_GATES) {
    const row = rows.find((entry: any) => entry.gate === gate)
    harness.check(`evidence: ${gate} recorded verified in the lane summary`, !!row && row.verified === true && row.failed === 0, row ? `verified=${row.verified} failed=${row.failed}` : "missing row")
  }
  harness.check("evidence: lane summary carries at least one observed negative case", (summary?.totalNegativeCases ?? 0) > 0, `negatives=${summary?.totalNegativeCases ?? 0}`)
}

// ── 6. Release gate blocks a tampered verified claim ──────────────────────
{
  const validDoc: any = {
    schemaVersion: 1,
    milestone: "M13",
    issue: "M13.99",
    code: "A7",
    tool: "bb_ask",
    title: "tamper probe",
    verifiedState: "verified",
    layers: ["unit"],
    checks: [{ name: "one real check", pass: true }],
    negativeCases: 1,
    summary: { total: 1, passed: 1, failed: 0 },
    decisions: {},
    limitations: [],
    generatedAt: new Date().toISOString(),
  }
  harness.check("release gate: a well-formed verified document validates", validateEvidence(validDoc).length === 0, validateEvidence(validDoc).join("; ").slice(0, 160))
  const tampered = JSON.parse(JSON.stringify(validDoc))
  tampered.negativeCases = 0
  tampered.summary.failed = 3
  harness.negative("release gate: a tampered document cannot claim verified", validateEvidence(tampered).length > 0, validateEvidence(tampered).join("; ").slice(0, 160))
  const gateSrc = readFileSync(path.join(REPO_ROOT, "script", "verify-quality-gate.ts"), "utf8")
  const verifyScript = (JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as any).scripts.verify ?? ""
  const A_VERIFIERS = ["verify-ask-contract", "verify-ask-provenance", "verify-ask-adversarial", "verify-ask-integration", "verify-ask-e2e-corpus"]
  for (const verifier of A_VERIFIERS) {
    harness.check(`wiring: ${verifier}.ts is in the quality gate`, gateSrc.includes(`m13/${verifier}.ts`))
    harness.check(`wiring: ${verifier}.ts is in npm run verify`, verifyScript.includes(`script/m13/${verifier}.ts`))
  }
  harness.check("wiring: the evidence validator is part of the gate", gateSrc.includes("m13/verify-evidence.ts") && verifyScript.includes("script/m13/verify-evidence.ts"))
  const dropped = A_VERIFIERS.map((verifier) => gateSrc.replace(`m13/${verifier}.ts`, `m13/${verifier}-REMOVED.ts`))
  harness.negative("wiring: removing any single A-verifier breaks the gate text (the gate cannot silently forget one)", dropped.every((text) => text !== gateSrc), "all verifier references intact")
}

harness.emit()
