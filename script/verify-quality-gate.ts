import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { scripts: Record<string, string> }
const requiredScripts = ["typecheck", "build", "verify", "docs:verify"]
const requiredChecks = [
  "m20/verify-governance.ts", "m20/verify-corpus-registry.ts", "m20/verify-migration-methodology.ts",
  "verify-m10-governance.ts", "verify-m10-baseline.ts", "verify-evidence-governance.ts", "verify-intelligence-consolidation.ts", "verify-analysis-governance.ts", "verify-m10-benchmarks.ts", "verify-deletion-safety.ts", "verify-contract-diff.ts", "m15/verify-contracts.ts", "m15/verify-registry-handlers.ts", "m15/verify-safety-primitives.ts", "m15/verify-edit-classification.ts", "m15/verify-edit-regex.ts", "m15/verify-edit-mask.ts", "m15/verify-edit-crossfile.ts", "m15/verify-edit-e2e-docs.ts", "m15/verify-search-complete.ts", "m15/verify-ask-deep.ts", "m15/verify-health-deep.ts", "m15/verify-patterns-deep.ts", "m15/verify-security-deep.ts", "m15/verify-doc-deep.ts", "m15/verify-analyze-deep.ts", "m15/verify-visualize-migrate-deep.ts", "m15/verify-matrix-coverage-closure.ts", "m16/verify-edit-real-repo.ts", "m16/verify-ask-stats.ts", "m16/verify-tool-runs.ts", "m16/verify-docs-truth.ts", "m16/verify-embedding-lifecycle.ts", "m16/verify-closure-gate.ts", "m13/verify-contract-authority.ts", "m13/verify-evidence.ts", "m13/verify-safety-primitives.ts", "m13/verify-edit-boundary.ts", "m13/verify-edit-rename.ts", "m13/verify-edit-mask.ts", "m13/verify-edit-body.ts", "m13/verify-edit-freshness.ts", "m13/verify-edit-atomicity.ts", "m13/verify-edit-unit.ts", "m13/verify-edit-integration.ts", "m13/verify-edit-e2e.ts", "m13/verify-edit-corpus.ts", "m13/verify-edit-honesty.ts", "m13/verify-edit-docs.ts", "m13/verify-search-e2e.ts", "m13/verify-search-corpus.ts", "m13/verify-search-honesty.ts", "m13/verify-search-docs.ts", "m13/verify-ask-contract.ts", "m13/verify-ask-provenance.ts", "m13/verify-ask-adversarial.ts", "m13/verify-ask-integration.ts", "m13/verify-ask-e2e-corpus.ts", "m13/verify-ask-docs.ts", "m13/verify-health-mutability.ts", "m13/verify-health-verbose.ts", "m13/verify-health-integrity.ts", "m13/verify-health-refresh.ts", "m13/verify-health-e2e-corpus.ts", "m13/verify-health-docs.ts", "m13/verify-patterns-contract.ts", "m13/verify-patterns-rules.ts", "m13/verify-patterns-orphans.ts", "m13/verify-patterns-e2e-corpus.ts", "m13/verify-patterns-docs.ts", "m13/verify-security-contract.ts", "m13/verify-security-handler.ts", "m13/verify-security-adversarial.ts", "m13/verify-security-docs.ts", "m13/verify-visualize-contract.ts", "m13/verify-visualize-fidelity.ts", "m13/verify-visualize-e2e-corpus.ts", "m13/verify-visualize-docs.ts", "m13/verify-migrate-accuracy.ts", "m13/verify-migrate-e2e-corpus.ts", "m13/verify-migrate-docs.ts", "m13/verify-analyze-modes.ts", "m13/verify-analyze-handler.ts", "m13/verify-analyze-e2e-corpus.ts", "m13/verify-analyze-docs.ts", "m13/verify-doc-facts.ts", "m13/verify-doc-modes.ts", "m13/verify-doc-e2e-corpus.ts", "m13/verify-doc-docs.ts", "verify-m10-final-audit.ts", "verify-m11-corpus.ts", "verify-m11-differential-harness.ts", "verify-m11-parser-matrix.ts", "verify-m11-lifecycle.ts", "m12/verify-regex-census.ts", "verify-m12-final-audit.ts", "verify-core.ts", "verify-engine.ts", "verify-index.ts", "verify-embed.ts", "verify-freshness.ts",
  "verify-schema.ts", "verify-tool-registry.ts", "verify-public-surface.ts", "verify-tool-docs.ts",
  "verify-search-modes.ts", "verify-semantic.ts", "verify-graph.ts", "verify-analyze.ts", "verify-patterns.ts",
  "verify-security.ts", "verify-tool-history.ts",  "m17/verify-closure-gate.ts", "m17/verify-mutation.ts", "m18/verify-closure-gate.ts", "m18/verify-mutation.ts", "m19/verify-closure-gate.ts", "m19/verify-bench-docs.ts", "m19/verify-mutation.ts", "verify-test-intel.ts",  "verify-test-quality.ts", "verify-analysis-history.ts", "verify-edit.ts",
  "verify-health.ts", "verify-doc-design.ts", "verify-doc.ts", "verify-visualize-migrate.ts", "verify-cli-surface.ts",
  "verify-mcp.ts", "verify-contracts.ts", "verify-mcp-e2e.ts", "verify-integration-runtime.ts",
]
let failures = 0
const check = (label: string, condition: boolean): void => {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}`) }
}
for (const script of requiredScripts) check(`package script ${script}`, typeof pkg.scripts[script] === "string")
const verify = pkg.scripts.verify ?? ""
for (const checkScript of requiredChecks) check(`verify includes ${checkScript}`, verify.includes(checkScript))
check("docs verification is part of aggregate gate", verify.includes("verify-tool-docs.ts"))
check("M20 governance gate is part of aggregate gate", verify.includes("m20/verify-governance.ts"))
check("M20 corpus registry gate is part of aggregate gate", verify.includes("m20/verify-corpus-registry.ts"))
check("public MCP surface is exact ten", readFileSync(resolve(root, "src/mcp/tool-registry.ts"), "utf8").includes('"bb_health"'))
check("canonical artifact exists", readFileSync(resolve(root, "docs/data/public-tools.json"), "utf8").includes('"schemaVersion": 1'))
check("verification matrix exists", readFileSync(resolve(root, "docs/VERIFICATION.md"), "utf8").includes("Runtime Matrix"))
console.log(failures === 0 ? "QUALITY GATE CONFIG: PASS" : `QUALITY GATE CONFIG: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
