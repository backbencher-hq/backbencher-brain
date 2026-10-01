import { readFileSync } from "node:fs"

const specification = readFileSync(new URL("../docs/BB_DOC.md", import.meta.url), "utf8")
const examples = readFileSync(new URL("../docs/BB_DOC_EXAMPLES.md", import.meta.url), "utf8")
let failures = 0

function check(label: string, condition: boolean): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}`) }
}

const modes = ["symbol", "file", "module", "feature", "api", "project", "coverage"]
for (const mode of modes) {
  check(`${mode} mode is specified`, specification.includes(`\`${mode}\``))
  check(`${mode} mode has an example`, examples.includes(`\"mode\":\"${mode}\"`))
}

for (const classification of ["extracted", "inferred", "generated", "unknown"]) {
  check(`${classification} classification defined`, specification.toLowerCase().includes(`**${classification}**`))
}

for (const requirement of ["Citation", "freshness", "maxTokens", "QualityReport", "ReferenceMetadata", "bb_edit"]) {
  check(`${requirement} contract present`, specification.includes(requirement))
}

check("read-only behavior explicit", specification.includes("No source writes") && specification.includes("bb_edit"))
check("any refresh is bounded and declared", /auto-refresh/i.test(specification) && /within budget/i.test(specification) && /declares?\b|declared\b/i.test(specification))
check("stale behavior explicit", specification.includes("Stale evidence") && specification.includes("stale-evidence"))
check("unknowns are normative", examples.includes("Deployment topology is unknown") && examples.includes("HTTP status"))
check("website stable keys specified", specification.includes("snapshotId") && specification.includes("canonicalPath") && specification.includes("slugs"))
check("token limits specified", specification.includes("4,000 tokens") && specification.includes("16,000"))

console.log(failures === 0 ? "\nDOC DESIGN: PASS" : `\nDOC DESIGN: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
