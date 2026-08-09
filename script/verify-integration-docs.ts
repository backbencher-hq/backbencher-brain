import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PUBLIC_TOOL_DESCRIPTORS } from "../src/mcp/tool-registry"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const guide = readFileSync(resolve(root, "docs/MCP_CLI_INDEXER_GUIDE.md"), "utf8")
const readme = readFileSync(resolve(root, "README.md"), "utf8")
let failures = 0
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}`) }
}
for (const section of ["Mental Model", "Entry Points", "Project Identity", "What The Indexer Is", "Full index lifecycle", "Incremental indexing", "CLI", "MCP Server Lifecycle", "Host Setup", "Public Tool Reference", "Evidence Semantics", "Integration Guarantees And Risks", "Verification", "Deferred Analyzer Internals"]) {
  check(`guide includes ${section}`, guide.includes(section))
}
for (const tool of PUBLIC_TOOL_DESCRIPTORS) check(`${tool.name} is documented`, guide.includes(`### \`${tool.name}\``))
for (const host of ["Claude Desktop", "Claude Code", "VS Code", "Cursor", "opencode"]) check(`${host} host guidance exists`, guide.includes(`### ${host}`))
check("guide names stdio transport", guide.includes("StdioServerTransport"))
check("guide names shared CLI gateway", guide.includes("bb tool"))
check("README links guide", readme.includes("MCP_CLI_INDEXER_GUIDE.md"))
check("guide documents stdout protection", guide.includes("MCP stdio safety"))
console.log(failures === 0 ? "INTEGRATION DOCS: PASS" : `INTEGRATION DOCS: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
