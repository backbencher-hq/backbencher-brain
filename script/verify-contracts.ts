import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { BrainDatabase } from "../src/brain/database"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { deriveToolContracts } from "../src/mcp/tool-registry"
import { createContractFixture } from "./fixtures/contract-fixture"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`)
  }
}

function textOf(result: any): string {
  return (result?.content ?? []).map((item: any) => item.text ?? "").join("\n")
}

const root = mkdtempSync(path.join(tmpdir(), "bb-contract-"))
const fixture = createContractFixture(root)
const projectId = getProjectId(root)
const isBun = typeof Bun !== "undefined"

try {
  await indexProjectParallel(projectId, root, {})

  const transport = new StdioClientTransport({
    command: isBun ? "bun" : "npx",
    args: isBun
      ? [path.resolve("src/mcp/server.ts"), "--dir", root]
      : ["tsx", path.resolve("src/mcp/server.ts"), "--dir", root],
    cwd: process.cwd(),
    stderr: "pipe",
  })
  const client = new Client({ name: "contract-baseline", version: "1.0.0" })
  await client.connect(transport)

  const listed = await client.listTools()
  const byName = new Map(listed.tools.map((tool: any) => [tool.name, tool]))
  const contracts = deriveToolContracts()
  check("exact public tool count", listed.tools.length === contracts.length, `got ${listed.tools.length}`)

  for (const contract of contracts) {
    const tool: any = byName.get(contract.name)
    check(`${contract.name} is registered`, !!tool)
    if (!tool) continue
    const properties = Object.keys(tool.inputSchema?.properties ?? {}).sort()
    const expectedProperties = [...contract.properties].sort()
    const required = [...(tool.inputSchema?.required ?? [])].sort()
    const expectedRequired = [...contract.required].sort()
    check(`${contract.name} properties frozen`, JSON.stringify(properties) === JSON.stringify(expectedProperties), `got ${properties.join(",")}`)
    check(`${contract.name} required fields frozen`, JSON.stringify(required) === JSON.stringify(expectedRequired), `got ${required.join(",")}`)
  }

  // The count comes from `deriveToolContracts()` (live registry), and the
  // live-list comparison above is the contract that matters. The literal `10`
  // that used to stand here rotted when the surface grew to 16 (M22 added
  // bb_index; M28 added graph/impact/cross-language/annotate/annotations), and a
  // check that fails on a legitimate addition is a check nobody reads. What this
  // line is FOR is uniqueness — one contract per tool, no duplicate names.
  const contractNames = contracts.map((tool) => tool.name)
  check("every derived tool contract is unique", new Set(contractNames).size === contractNames.length, `${contracts.length} contracts, ${new Set(contractNames).size} distinct`)

  let result: any = await client.callTool({ name: "bb_search", arguments: { query: "duplicateName", limit: 1 } })
  const firstPage = textOf(result)
  check("bb_search honors explicit limit", firstPage.split("\n").filter((line) => line.includes("duplicateName")).length === 1, firstPage.slice(0, 180))

  result = await client.callTool({ name: "bb_search", arguments: { query: "duplicateName", limit: 1, offset: 1 } })
  const secondPage = textOf(result)
  check("bb_search accepts pagination offset", secondPage.includes("duplicateName") || secondPage.includes("no results"), secondPage.slice(0, 180))

  result = await client.callTool({ name: "bb_select", arguments: { symbolName: "missingContractSymbol" } })
  check("removed alias returns unknown tool", result.isError === true && textOf(result).includes("unknown tool: bb_select"))

  result = await client.callTool({ name: "bb_health", arguments: {} })
  check("bb_health default output includes counts and freshness", /files=\d+ symbols=\d+ relationships=\d+ imports=\d+/.test(textOf(result)) && textOf(result).includes("freshness:"), textOf(result).slice(0, 180))

  writeFileSync(fixture.sourceFile, `${readFileSync(fixture.sourceFile, "utf8")}\n// stale marker\n`)
  // M43/M71 changed this contract: a read now AUTO-REFRESHES the stale files it
  // is about to answer from (within budget, BB_NO_AUTO_REFRESH), so the default
  // answer has nothing stale left to mark and `[STALE]` moved to the opt-out
  // door. Asserting `[STALE]` on the default path asserted the pre-M43 behaviour
  // — and it could not have passed since; the property it was protecting is
  // asserted in the second leg, where the marker still exists.
  result = await client.callTool({ name: "bb_search", arguments: { query: "handleRequest" } })
  const autoText = textOf(result)
  check("bb_search refreshes a stale file before answering", /auto-refreshed \d+ files?/.test(autoText), autoText.slice(0, 200))
  check("and therefore reports no [STALE] marker for it", autoText.includes("handleRequest") && !autoText.includes("[STALE]"), autoText.slice(0, 200))

  writeFileSync(fixture.sourceFile, `${readFileSync(fixture.sourceFile, "utf8")}\n// stale marker again\n`)
  result = await client.callTool({ name: "bb_search", arguments: { query: "handleRequest", refresh: false } })
  const optOutText = textOf(result)
  check("bb_search reports stale indexed files when refresh is opted out", optOutText.includes("[STALE]"), optOutText.slice(0, 200))
  check("and names the opt-out as the reason it did not refresh", /auto-refresh disabled \(BB_NO_AUTO_REFRESH or refresh=false\)/.test(optOutText), optOutText.slice(-200))

  result = await client.callTool({ name: "bb_health", arguments: { refresh: true, wait: true } })
  check("bb_health refreshes before canonical mutation", !result.isError && /symbols=\d+/.test(textOf(result)), textOf(result).slice(0, 180))

  result = await client.callTool({ name: "bb_edit", arguments: { mode: "write", filePath: "src/contract-new.ts", content: "export const contractNew = true\n" } })
  check("bb_edit write reports indexed mutation", textOf(result).includes('"reindexed": true'), textOf(result))
  check("bb_edit write side effect reaches disk", readFileSync(path.join(root, "src", "contract-new.ts"), "utf8").includes("contractNew"))

  result = await client.callTool({ name: "bb_edit", arguments: { mode: "update", symbolName: "helper", newContent: "export function helper(): number { return 99 }\n" } })
  check("bb_edit update reports reindex", textOf(result).includes('"mode": "update"') && textOf(result).includes('"reindexed": true'), textOf(result))

  result = await client.callTool({ name: "bb_edit", arguments: { mode: "insert", targetSymbolName: "handleRequest", position: "after", newContent: "export const insertedContract = true\n" } })
  check("bb_edit insert reports mode", textOf(result).includes('"mode": "insert"'), textOf(result))

  result = await client.callTool({ name: "bb_edit", arguments: { mode: "delete", symbolName: "orphanedFunction" } })
  check("bb_edit delete reports reindex", textOf(result).includes('"mode": "delete"') && textOf(result).includes('"reindexed": true'), textOf(result))

  result = await client.callTool({ name: "bb_edit", arguments: { mode: "refactor", symbolName: "handleRequest", newName: "handleRequestContract" } })
  check("bb_edit refactor reports mode", textOf(result).includes('"mode": "refactor"'), textOf(result))
  check("mutation sequence changed fixture only", readFileSync(fixture.sourceFile, "utf8").includes("handleRequestContract"))

  await client.close()
} catch (error) {
  check("contract baseline session", false, error instanceof Error ? error.stack ?? error.message : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nCONTRACT BASELINE: PASS" : `\nCONTRACT BASELINE: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
