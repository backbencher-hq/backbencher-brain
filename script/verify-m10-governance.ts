import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const document = readFileSync(resolve(root, "docs/M10-EVIDENCE-GOVERNANCE.md"), "utf8")
let failures = 0
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}`) }
}

for (const disposition of ["keep", "migrate", "improve", "quarantine", "remove"]) {
  check(`decision class ${disposition}`, document.includes(`\`${disposition}\``))
}
for (const evidence of ["indexed", "inferred", "semantic_candidate", "static_finding", "runtime_artifact", "unknown", "stale"]) {
  check(`evidence class ${evidence}`, document.includes(`\`${evidence}\``))
}
for (const issue of [116, 118, 113, 117, 114, 121, 120, 115]) {
  check(`ordered issue #${issue}`, document.includes(`issues/${issue}`))
}
for (const command of ["npm run typecheck", "npm run build", "npm run docs:verify", "npm run verify"]) {
  check(`closure command ${command}`, document.includes(command))
}
for (const field of ["Required artifact:", "Fixture(s):", "Baseline comparison:", "Public contract impact:", "Deletion/reachability review:", "Residual risks:", "Commit/PR:"]) {
  check(`closure evidence ${field}`, document.includes(field))
}
check("claim policy rejects WORLD'S FIRST", document.includes("WORLD’S FIRST"))
check("claim policy rejects revolutionary", document.includes("“revolutionary”"))
check("empty results are not clean evidence", document.includes("hard-coded empty result is not evidence"))
check("only final audit closes M10", document.includes("Only this issue may close M10"))
check("machine-readable final audit required", document.includes("machine-readable companion"))

console.log(failures === 0 ? "M10 GOVERNANCE: PASS" : `M10 GOVERNANCE: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
