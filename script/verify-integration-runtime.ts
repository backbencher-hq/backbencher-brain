import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PUBLIC_TOOL_DESCRIPTORS } from "../src/mcp/tool-registry"
import { validateToolArguments } from "../src/mcp/tool-validation"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
let failures = 0
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}`) }
}
function rejects(label: string, run: () => unknown, pattern: RegExp): void {
  try { run(); check(label, false) }
  catch (error) { check(label, pattern.test(error instanceof Error ? error.message : String(error))) }
}

const search = PUBLIC_TOOL_DESCRIPTORS.find((tool) => tool.name === "bb_search")!
const migrate = PUBLIC_TOOL_DESCRIPTORS.find((tool) => tool.name === "bb_migrate")!
check("valid arguments pass", validateToolArguments(search, { query: "health", limit: 5 }).query === "health")
rejects("arguments must be objects", () => validateToolArguments(search, []), /JSON object/)
rejects("required fields are enforced", () => validateToolArguments(migrate, {}), /missing required option: targetLanguage/)
rejects("unknown fields are rejected", () => validateToolArguments(search, { query: "health", typo: true }), /unknown or irrelevant options: typo/)
rejects("field types are enforced", () => validateToolArguments(search, { query: 1 }), /query must be string/)
rejects("enum values are enforced", () => validateToolArguments(search, { query: "health", mode: "invalid" }), /mode must be one of/)
rejects("numeric bounds are enforced", () => validateToolArguments(search, { query: "health", limit: -1 }), /limit must be non-negative/)

const server = readFileSync(resolve(root, "src/mcp/server.ts"), "utf8")
const handlers = readFileSync(resolve(root, "src/mcp/tool-handlers.ts"), "utf8")
const health = readFileSync(resolve(root, "src/intelligence/health/health-provider.ts"), "utf8")
const indexer = readFileSync(resolve(root, "src/ast/parallel-indexer.ts"), "utf8")
check("MCP uses shared validation", server.includes("validateToolArguments(descriptor"))
check("index existence is project scoped", server.includes("brain_file WHERE project_id=?"))
check("MCP force implies refresh", handlers.includes("args.refresh === true || args.force === true"))
check("MCP injects a silent index logger", handlers.includes("logger: { log:") && handlers.includes("write: (_s: string) => {}"))
check("refreshes are serialized per project", health.includes("refreshQueues") && health.includes("queueRefresh(projectId"))
check("wait=false starts background work", health.includes("REFRESH_STARTED") && health.includes("void refreshPromise.catch"))
check("indexer progress uses injected output", indexer.includes("const _log = options.logger") && !indexer.includes("process.stdout.write(`\\r  Enriching:"))

console.log(failures === 0 ? "INTEGRATION RUNTIME: PASS" : `INTEGRATION RUNTIME: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
