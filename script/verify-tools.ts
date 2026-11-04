// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the one command that proves the public tool surface before
//   release: build, typecheck, the script-typecheck ratchet, the documentation
//   chain, and every deterministic per-tool gate in its canonical runtime.
// WHICH TOOLS IT SERVES — all sixteen public MCP tools (the gate list is the
//   per-tool verification set, grouped by the milestone that owns each gate).
// WHY IT IS SHAPED THIS WAY — the gates live in different runtimes (bun and node)
//   and some need a clean data dir; running them by hand is how a red gets missed.
//   Each gate runs with an isolated BB_DATA_DIR and a writable HOME, its canonical
//   runner, and a bounded timeout; failures are collected, never abort the run, and
//   the summary names every one. Environment-dependent gates are DECLARED below
//   with the condition they need — they are not silently skipped.
// WHERE ITS EVIDENCE LIVES — validation/release/VERIFY-TOOLS.json.
// EDIT TOGETHER WHEN THIS CHANGES — package.json (verify:tools), the per-tool gate
//   files listed in GATES, docs/README.md "Verifying a doc".
// CONTRACTS IT MUST NOT BREAK — exit 0 only when the build, typechecks, docs chain
//   and every included tool gate passed at the recorded HEAD; an excluded gate is
//   printed with its reason on every run.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const EVIDENCE = path.join(ROOT, "validation", "release", "VERIFY-TOOLS.json")

type Runner = "bun run" | "npx tsx"
interface Gate { group: string; runner: Runner; script: string }
interface ExcludedGate { script: string; reason: string }

const GATES: Gate[] = [
  { group: "m13", runner: "bun run", script: "script/m13/verify-analyze-docs.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-analyze-e2e-corpus.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-analyze-handler.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-analyze-modes.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-ask-adversarial.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-ask-contract.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-ask-docs.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-ask-e2e-corpus.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-ask-honesty.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-ask-integration.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-ask-provenance.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-contract-authority.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-doc-docs.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-doc-e2e-corpus.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-doc-facts.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-doc-modes.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-edit-atomicity.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-edit-batch.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-edit-body.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-edit-boundary.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-edit-corpus.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-edit-docs.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-edit-e2e.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-edit-freshness.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-edit-honesty.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-edit-integration.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-edit-mask.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-edit-rename.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-edit-unit.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-evidence.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-health-docs.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-health-e2e-corpus.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-health-integrity.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-health-mutability.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-health-refresh.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-health-verbose.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-migrate-accuracy.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-migrate-docs.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-migrate-e2e-corpus.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-patterns-contract.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-patterns-docs.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-patterns-e2e-corpus.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-patterns-orphans.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-patterns-rules.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-safety-primitives.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-search-corpus.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-search-docs.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-search-e2e.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-search-honesty.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-security-adversarial.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-security-contract.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-security-docs.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-security-handler.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-visualize-contract.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-visualize-docs.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-visualize-e2e-corpus.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-visualize-fidelity.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-visualize-honesty.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-visualize-options.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-visualize-owner-fold.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-visualize-target-literals.ts" },
  { group: "m13", runner: "bun run", script: "script/m13/verify-visualize-views.ts" },
  { group: "m15", runner: "bun run", script: "script/m15/verify-analyze-deep.ts" },
  { group: "m15", runner: "bun run", script: "script/m15/verify-ask-deep.ts" },
  { group: "m15", runner: "bun run", script: "script/m15/verify-contracts.ts" },
  { group: "m15", runner: "bun run", script: "script/m15/verify-doc-deep.ts" },
  { group: "m15", runner: "bun run", script: "script/m15/verify-edit-classification.ts" },
  { group: "m15", runner: "bun run", script: "script/m15/verify-edit-crossfile.ts" },
  { group: "m15", runner: "bun run", script: "script/m15/verify-edit-e2e-docs.ts" },
  { group: "m15", runner: "bun run", script: "script/m15/verify-edit-mask.ts" },
  { group: "m15", runner: "bun run", script: "script/m15/verify-edit-regex.ts" },
  { group: "m15", runner: "bun run", script: "script/m15/verify-health-deep.ts" },
  { group: "m15", runner: "bun run", script: "script/m15/verify-patterns-deep.ts" },
  { group: "m15", runner: "bun run", script: "script/m15/verify-registry-handlers.ts" },
  { group: "m15", runner: "bun run", script: "script/m15/verify-safety-primitives.ts" },
  { group: "m15", runner: "bun run", script: "script/m15/verify-search-complete.ts" },
  { group: "m15", runner: "bun run", script: "script/m15/verify-security-deep.ts" },
  { group: "m15", runner: "bun run", script: "script/m15/verify-visualize-migrate-deep.ts" },
  { group: "m16", runner: "bun run", script: "script/m16/verify-ask-stats.ts" },
  { group: "m16", runner: "bun run", script: "script/m16/verify-closure-gate.ts" },
  { group: "m16", runner: "bun run", script: "script/m16/verify-docs-truth.ts" },
  { group: "m16", runner: "bun run", script: "script/m16/verify-edit-real-repo.ts" },
  { group: "m16", runner: "bun run", script: "script/m16/verify-embedding-lifecycle.ts" },
  { group: "m16", runner: "bun run", script: "script/m16/verify-tool-runs.ts" },
  { group: "m20", runner: "bun run", script: "script/m20/verify-cross-tool-parity.ts" },
  { group: "m20", runner: "bun run", script: "script/m20/verify-doc-citations.ts" },
  { group: "m20", runner: "bun run", script: "script/m20/verify-doc-examples-diagrams.ts" },
  { group: "m20", runner: "bun run", script: "script/m20/verify-doc-modes.ts" },
  { group: "m20", runner: "bun run", script: "script/m20/verify-migration-mappings.ts" },
  { group: "m20", runner: "bun run", script: "script/m20/verify-migration-methodology.ts" },
  { group: "m20", runner: "bun run", script: "script/m20/verify-migration-order.ts" },
  { group: "m20", runner: "bun run", script: "script/m20/verify-patterns-orphan-semantics.ts" },
  { group: "m20", runner: "bun run", script: "script/m20/verify-patterns-pagination-history.ts" },
  { group: "m20", runner: "bun run", script: "script/m20/verify-patterns-parameter-scan.ts" },
  { group: "m20", runner: "bun run", script: "script/m20/verify-security-adversarial.ts" },
  { group: "m20", runner: "bun run", script: "script/m20/verify-security-flow-boundary.ts" },
  { group: "m20", runner: "bun run", script: "script/m20/verify-security-history.ts" },
  { group: "m26", runner: "npx tsx", script: "script/m26/verify-hub-group-order.ts" },
  { group: "m28", runner: "npx tsx", script: "script/m28/verify-index-portability.ts" },
  { group: "m28", runner: "npx tsx", script: "script/m28/verify-project-registry-honesty.ts" },
  { group: "m28", runner: "npx tsx", script: "script/m28/verify-schema-repair.ts" },
  { group: "m28", runner: "npx tsx", script: "script/m28/verify-surface-parity.ts" },
  { group: "m40", runner: "bun run", script: "script/m40/verify-a1-post-entry.ts" },
  { group: "m40", runner: "bun run", script: "script/m40/verify-a3-write-parity.ts" },
  { group: "m40", runner: "bun run", script: "script/m40/verify-a5-flag-semantics.ts" },
  { group: "m40", runner: "bun run", script: "script/m40/verify-a6-health-refresh.ts" },
  { group: "m40", runner: "bun run", script: "script/m40/verify-a7-cli-parity.ts" },
  { group: "m40", runner: "bun run", script: "script/m40/verify-import-resolution.ts" },
  { group: "m43", runner: "bun run", script: "script/m43/verify-a1-mcp-auto-refresh.ts" },
  { group: "m43", runner: "bun run", script: "script/m43/verify-a2-cli-auto-refresh.ts" },
  { group: "m43", runner: "bun run", script: "script/m43/verify-a3-flag-semantics.ts" },
  { group: "m43", runner: "bun run", script: "script/m43/verify-arbiter-typecheck.ts" },
  { group: "m43", runner: "bun run", script: "script/m43/verify-p1-index-lock.ts" },
  { group: "m48", runner: "bun run", script: "script/m48/l1-hub-smoke.ts" },
  { group: "m48", runner: "bun run", script: "script/m48/verify-c2-edge-mutations.ts" },
  { group: "m48", runner: "bun run", script: "script/m48/verify-d1-doc-truth.ts" },
  { group: "m48", runner: "bun run", script: "script/m48/verify-governance.ts" },
  { group: "m48", runner: "bun run", script: "script/m48/verify-h1-ghosts.ts" },
  { group: "m48", runner: "bun run", script: "script/m48/verify-l1-hub-guard.ts" },
  { group: "m48", runner: "bun run", script: "script/m48/verify-p1-impact-unity.ts" },
  { group: "m48", runner: "bun run", script: "script/m48/verify-p2-honesty-fields.ts" },
  { group: "m48", runner: "bun run", script: "script/m48/verify-p3-agreement.ts" },
  { group: "m48", runner: "bun run", script: "script/m48/verify-p4-param-matrix.ts" },
  { group: "m48", runner: "bun run", script: "script/m48/verify-w1-website-tools.ts" },
  { group: "m57", runner: "bun run", script: "script/m57/verify-t1-classifier.ts" },
  { group: "m57", runner: "bun run", script: "script/m57/verify-t2-consumers.ts" },
  { group: "m57", runner: "bun run", script: "script/m57/verify-t3-scope-all.ts" },
  { group: "m57", runner: "bun run", script: "script/m57/verify-t5-predicate-unity.ts" },
  { group: "m65", runner: "bun run", script: "script/m65/verify-edge-kind-scoping.ts" },
  { group: "m65", runner: "bun run", script: "script/m65/verify-graph-blindspots.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-mcp.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-mcp-e2e.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-tool-registry.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-public-surface.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-tool-docs.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-tool-page-claims.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-integration-docs.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-contract-diff.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-contracts.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-search-modes.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-graph.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-analyze.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-patterns.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-security.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-edit.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-health.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-doc.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-visualize-migrate.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-tool-history.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-test-intel.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-test-quality.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-analysis-history.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-freshness.ts" },
  { group: "surface", runner: "bun run", script: "script/verify-cli-surface.ts" },
  { group: "m28", runner: "bun run", script: "script/m28/verify-mcp-stdout.ts" },
]

/** Gates that cannot run on a clean checkout: the condition each one needs. */
const EXCLUDED: ExcludedGate[] = [
  { script: "script/m15/verify-matrix-coverage-closure.ts", reason: "requires GitHub API (gh) for issue count — network unavailable" },
  { script: "script/m20/verify-corpus-registry.ts", reason: "external corpus sidecar (intellij snapshot) not present on a clean checkout" },
  { script: "script/m20/verify-governance.ts", reason: "milestone governance stamp — refreshed in the release evidence pass" },
  { script: "script/m20/verify-real-repo-ledger.ts", reason: "instrument over external corpora (slow, corpus-dependent)" },
  { script: "script/m26/verify-external-arm-plan.ts", reason: "external corpus arm — corpus not present on a clean checkout" },
  { script: "script/m26/verify-governance.ts", reason: "milestone governance stamp — refreshed in the release evidence pass" },
  { script: "script/m40/verify-a2-bounded-post.ts", reason: "worker-crash fixture — needs the crash-injection environment" },
  { script: "script/m40/verify-a8-config.ts", reason: "worker-crash fixture — needs the crash-injection environment" },
  { script: "script/m40/verify-a9-purge.ts", reason: "declared gate for pool-worker purge API — known gap, tracked in M40 ledger" },
  { script: "script/m40/verify-closure.ts", reason: "milestone closure — run in the release checklist after the full evidence pass" },
  { script: "script/m40/verify-governance.ts", reason: "milestone governance stamp — refreshed in the release evidence pass" },
  { script: "script/m43/verify-a4-corpus.ts", reason: "index-lock corpus — needs the external corpus" },
  { script: "script/m43/verify-closure.ts", reason: "milestone closure — run in the release checklist after the full evidence pass" },
  { script: "script/m43/verify-governance.ts", reason: "milestone governance stamp — refreshed in the release evidence pass" },
  { script: "script/m48/verify-c1-corpus.ts", reason: "real-repo corpus gate — needs the five external corpora (run in the release checklist)" },
  { script: "script/m48/verify-closure.ts", reason: "milestone closure — run in the release checklist after the full evidence pass" },
  { script: "script/m55/verify-evidence-tree-clean.ts", reason: "IDE/LSP campaign gates (live editor rig) — not the public MCP tool surface" },
  { script: "script/m55/verify-governance.ts", reason: "IDE/LSP campaign gates (live editor rig) — not the public MCP tool surface" },
  { script: "script/m55/verify-hover-coverage-redteam.ts", reason: "IDE/LSP campaign gates (live editor rig) — not the public MCP tool surface" },
  { script: "script/m55/verify-hover-coverage.ts", reason: "IDE/LSP campaign gates (live editor rig) — not the public MCP tool surface" },
  { script: "script/m55/verify-tiers.ts", reason: "IDE/LSP campaign gates (live editor rig) — not the public MCP tool surface" },
  { script: "script/m55/verify-type-inference.ts", reason: "IDE/LSP campaign gates (live editor rig) — not the public MCP tool surface" },
  { script: "script/m57/verify-closure.ts", reason: "requires the M57 governance evidence (GitHub registration)" },
  { script: "script/m57/verify-governance.ts", reason: "requires GitHub API (gh) for issue registration — network unavailable" },
  { script: "script/m57/verify-t4-corpus-identity.ts", reason: "corpus identity gate — needs the recorded corpus set" },
  { script: "script/m65/verify-refresh-resolution.ts", reason: "analyzer fleet coverage (50 lanes vs FLEET-48 fixtures) — analyzer portfolio, not the tool surface" },
]

const args = new Set(process.argv.slice(2))
const LIST_ONLY = args.has("--list")
const SKIP_DOCS = args.has("--skip-docs")
const SKIP_BUILD = args.has("--no-build")
const ONLY = [...args].find((a) => a.startsWith("--only="))?.slice("--only=".length)

function head(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" }
}

function runPhase(label: string, command: string, timeoutMs = 1_800_000): { ok: boolean; ms: number; tail: string } {
  if (LIST_ONLY) { console.log(`  [phase] ${label}: ${command}`); return { ok: true, ms: 0, tail: "" } }
  const started = Date.now()
  const result = spawnSync(command, { cwd: ROOT, shell: true, encoding: "utf8", timeout: timeoutMs, env: { ...process.env } })
  const ms = Date.now() - started
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  const ok = result.status === 0
  const tail = output.trim().split("\n").slice(-6).join("\n")
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label} (${Math.round(ms / 1000)}s)`)
  if (!ok) console.log(tail.split("\n").map((l) => "      " + l).join("\n"))
  return { ok, ms, tail }
}

function runGate(gate: Gate): { ok: boolean; ms: number; tail: string } {
  const scratch = mkdtempSync(path.join(tmpdir(), "bb-verify-tools-"))
  const dataDir = path.join(scratch, "data")
  const home = path.join(scratch, "home")
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(home, { recursive: true })
  if (LIST_ONLY) {
    console.log(`  ${gate.group.padEnd(8)} ${gate.runner} ${gate.script}`)
    rmSync(scratch, { recursive: true, force: true })
    return { ok: true, ms: 0, tail: "" }
  }
  const started = Date.now()
  const result = spawnSync(`${gate.runner} ${gate.script}`, {
    cwd: ROOT,
    shell: true,
    encoding: "utf8",
    timeout: 1_500_000,
    env: { ...process.env, BB_DATA_DIR: dataDir, HOME: home, BB_NO_AUTO_REFRESH: "1" },
  })
  const ms = Date.now() - started
  rmSync(scratch, { recursive: true, force: true })
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  const ok = result.status === 0
  const tail = output.trim().split("\n").slice(-8).join("\n")
  console.log(`  ${ok ? "PASS" : "FAIL"} ${gate.group.padEnd(8)} ${path.basename(gate.script)} (${Math.round(ms / 1000)}s)`)
  if (!ok) console.log(tail.split("\n").map((l) => "      " + l).join("\n"))
  return { ok, ms, tail }
}

const commit = head()
console.log(`VERIFY TOOLS — ${GATES.length} gates at ${commit}`)
if (ONLY) console.log(`filter: --only=${ONLY}`)
console.log("\nDeclared environment-dependent gates (not run here; condition stated):")
for (const gate of EXCLUDED) console.log(`  SKIP ${gate.script}\n       ${gate.reason}`)

const phases: Array<{ name: string; ok: boolean; ms: number }> = []
if (!LIST_ONLY) {
  console.log("\nPHASES")
  if (!SKIP_BUILD) phases.push({ name: "build", ...runPhase("build (npm run build)", "npm run build") })
  phases.push({ name: "typecheck-src", ...runPhase("typecheck src (tsc --noEmit)", "npx tsc --noEmit") })
  phases.push({ name: "script-typecheck-ratchet", ...runPhase("script typecheck ratchet", "bun run script/m14/verify-script-typecheck-baseline.ts") })
  if (!SKIP_DOCS) phases.push({ name: "docs", ...runPhase("docs chain (npm run docs:verify)", "npm run docs:verify", 2_700_000) })
}

const selected = ONLY ? GATES.filter((g) => g.script.includes(ONLY) || g.group === ONLY) : GATES
console.log(`\nTOOL GATES (${selected.length})`)
const results: Array<{ gate: Gate; ok: boolean; ms: number }> = []
for (const gate of selected) {
  const result = runGate(gate)
  results.push({ gate, ok: result.ok, ms: result.ms })
}

const failedPhases = phases.filter((p) => !p.ok)
const failedGates = results.filter((r) => !r.ok)
const payload = {
  commit,
  generatedAt: new Date().toISOString(),
  phases,
  gates: results.map((r) => ({ ...r.gate, ok: r.ok, ms: r.ms })),
  excluded: EXCLUDED,
  totals: { gates: results.length, failed: failedGates.length, phases: phases.length, failedPhases: failedPhases.length },
}
if (!LIST_ONLY) {
  mkdirSync(path.dirname(EVIDENCE), { recursive: true })
  writeFileSync(EVIDENCE, JSON.stringify(payload, null, 2) + "\n")
  console.log(`\nVERIFY TOOLS: ${failedGates.length === 0 && failedPhases.length === 0 ? "PASS" : "FAIL"} — ${results.length - failedGates.length}/${results.length} gates, ${phases.length - failedPhases.length}/${phases.length} phases`)
  if (failedGates.length) console.log("failed gates: " + failedGates.map((r) => r.gate.script).join(", "))
  if (failedPhases.length) console.log("failed phases: " + failedPhases.map((p) => p.name).join(", "))
  process.exitCode = failedGates.length === 0 && failedPhases.length === 0 ? 0 : 1
}
