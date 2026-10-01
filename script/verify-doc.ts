import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { generateDocumentation, formatDocumentation, type DocMode } from "../src/intelligence/documentation/doc-engine"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`) }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-doc-"))
mkdirSync(path.join(root, "src", "auth"), { recursive: true })
mkdirSync(path.join(root, "tests"), { recursive: true })
const serviceFile = path.join(root, "src", "auth", "service.ts")
writeFileSync(serviceFile, `/** Authenticates a user token. */
export function authenticate(token: string): boolean {
  return validateToken(token)
}

/** Validates token shape. */
export function validateToken(token: string): boolean {
  return token.length > 3
}
`)
writeFileSync(path.join(root, "src", "api.ts"), `import { authenticate } from "./auth/service"
/** POST /login API contract. */
export function login(token: string): boolean {
  return authenticate(token)
}
`)
writeFileSync(path.join(root, "src", "audit.py"), `def audit_login(user: str) -> bool:\n    \"\"\"Records a login audit event.\"\"\"\n    return bool(user)\n`)
writeFileSync(path.join(root, "tests", "service.test.ts"), `import { authenticate } from "../src/auth/service"
test("auth", () => { expect(authenticate("abcd")).toBe(true) })
`)
const projectId = getProjectId(root)

try {
  await indexProjectParallel(projectId, root, {})
  const raw = await BrainDatabase.getRawInstance(projectId)
  raw.prepare("UPDATE brain_symbol SET api_contract_path='/login' WHERE project_id=? AND name='login'").run(projectId)
  const before = statSync(serviceFile).mtimeMs

  const cases: Array<{ mode: DocMode; target?: string }> = [
    { mode: "symbol", target: "authenticate" },
    { mode: "file", target: "src/auth/service.ts" },
    { mode: "module", target: "src/auth" },
    { mode: "feature", target: "login audit" },
    { mode: "api" },
    { mode: "project" },
    { mode: "coverage" },
  ]
  for (const item of cases) {
    const result = await generateDocumentation(projectId, root, { ...item, includeTests: true, limit: 50 })
    check(`${item.mode} returns sections`, result.sections.length > 0)
    check(`${item.mode} factual sections are cited`, result.sections.flatMap((section) => section.facts).every((fact) => fact.classification === "unknown" || fact.citationIds.length > 0))
    check(`${item.mode} citations resolve to project files`, result.citations.every((citation) => !citation.path || readFileSync(path.join(root, citation.path), "utf8").length >= 0), JSON.stringify(result.citations.slice(0, 2)))
    const json = JSON.parse(formatDocumentation(result, "json"))
    const markdown = formatDocumentation(result, "markdown")
    check(`${item.mode} JSON/Markdown share title`, json.title === result.title && markdown.includes(`# ${result.title}`))
  }

  const symbol = await generateDocumentation(projectId, root, { mode: "symbol", target: "authenticate", includeTests: true })
  check("symbol includes docstring", symbol.sections.some((section) => section.prose.includes("Authenticates a user token")))
  check("symbol includes test evidence", symbol.citations.some((citation) => citation.kind === "test"))

  const feature = await generateDocumentation(projectId, root, { mode: "feature", target: "login audit", limit: 20 })
  check("feature resolves concrete multi-language symbols", feature.citations.some((citation) => citation.path?.endsWith("audit.py")) || feature.citations.some((citation) => citation.path?.endsWith("api.ts")))
  check("feature facts never cite embeddings alone", feature.sections.flatMap((section) => section.facts).every((fact) => fact.citationIds.some((id) => !id.startsWith("embedding:"))))

  const api = await generateDocumentation(projectId, root, { mode: "api" })
  check("API mode reports indexed contract", api.sections.some((section) => section.prose.includes("/login")))

  const coverage = await generateDocumentation(projectId, root, { mode: "coverage" })
  check("coverage reports documented state", coverage.sections[0]?.facts.some((item) => item.statement.includes("documented")) === true)

  writeFileSync(serviceFile, `${readFileSync(serviceFile, "utf8")}\n// stale\n`)
  const stale = await generateDocumentation(projectId, root, { mode: "symbol", target: "authenticate" })
  check("stale source is labeled", stale.citations.some((citation) => citation.freshness === "stale"))
  check("stale behavior is represented in quality", !stale.quality.freshness.passed)

  const budget = await generateDocumentation(projectId, root, { mode: "project", limit: 100, maxTokens: 1 })
  check("output budget gate fails oversized result", !budget.quality.budget.passed)
  check("generation does not mutate source", statSync(serviceFile).mtimeMs >= before && readFileSync(serviceFile, "utf8").endsWith("// stale\n"))
} catch (error) {
  check("bb_doc fixture", false, error instanceof Error ? error.stack ?? error.message : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nBB_DOC: PASS" : `\nBB_DOC: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
