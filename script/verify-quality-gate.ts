import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { scripts: Record<string, string> }
const requiredScripts = ["typecheck", "build", "verify", "docs:verify"]
const requiredChecks = [
  "verify-m10-governance.ts", "verify-m10-baseline.ts", "verify-evidence-governance.ts", "verify-intelligence-consolidation.ts", "verify-analysis-governance.ts", "verify-m10-benchmarks.ts", "verify-deletion-safety.ts", "verify-contract-diff.ts", "verify-m10-final-audit.ts", "verify-core.ts", "verify-engine.ts", "verify-index.ts", "verify-embed.ts", "verify-freshness.ts",
  "verify-schema.ts", "verify-tool-registry.ts", "verify-public-surface.ts", "verify-tool-docs.ts",
  "verify-search-modes.ts", "verify-semantic.ts", "verify-graph.ts", "verify-analyze.ts", "verify-patterns.ts",
  "verify-security.ts", "verify-test-intel.ts", "verify-test-quality.ts", "verify-analysis-history.ts", "verify-edit.ts",
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
check("public MCP surface is exact ten", readFileSync(resolve(root, "src/mcp/tool-registry.ts"), "utf8").includes('"bb_health"'))
check("canonical artifact exists", readFileSync(resolve(root, "docs/data/public-tools.json"), "utf8").includes('"schemaVersion": 1'))
check("verification matrix exists", readFileSync(resolve(root, "docs/VERIFICATION.md"), "utf8").includes("Runtime Matrix"))
console.log(failures === 0 ? "QUALITY GATE CONFIG: PASS" : `QUALITY GATE CONFIG: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
