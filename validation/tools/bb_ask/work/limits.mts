// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — probes the `limit` contract and the answer payload budget of bb_ask: what
//   values are accepted at the door, how many sources each returns, how large the text payload
//   becomes, and whether a shortened/truncated answer declares itself.
// WHICH TOOL IT SERVES — bb_ask (read).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_ask/limits.json.
// EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_ask/descriptor.ts, handler.ts,
//   src/intelligence/search/quick-answer.ts.
//
// Usage: BB_DATA_DIR=<dir> BB_NO_AUTO_REFRESH=1 npx tsx limits.mts <projectDir> <out.json>

import { writeFileSync } from "node:fs"
import { getProjectId } from "../../../../src/util/project-id"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"
import { validateToolArguments } from "../../../../src/mcp/tool-validation"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../../../src/mcp/tool-registry"

const projectDir = process.argv[2]
const outPath = process.argv[3]
if (!projectDir || !outPath) {
  console.error("usage: limits.mts <projectDir> <out.json>")
  process.exit(2)
}
const projectId = getProjectId(projectDir)
const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_ask")!
const handler = createToolHandlers().bb_ask
const rows: any[] = []

async function probe(label: string, args: Record<string, unknown>) {
  let validation: string | null = null
  try {
    validateToolArguments(descriptor, args)
  } catch (error: any) {
    validation = String(error?.message ?? error)
  }
  if (validation) {
    rows.push({ label, args, rejectedAtDoor: validation })
    return
  }
  const t0 = performance.now()
  const result: any = await handler(args, { projectId, projectPath: projectDir } as any)
  const ms = Math.round((performance.now() - t0) * 100) / 100
  const text = (result?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  const sourceLines = text.split("\n").filter((line) => /^\d+\. /.test(line.trim()) || /^--- File: /.test(line))
  const facts: Record<string, string> = {}
  const retrieval = text.match(/\[retrieval: ([^\]]*)\]/)
  if (retrieval) for (const part of retrieval[1].split(", ")) {
    const eq = part.indexOf("=")
    if (eq > 0) facts[part.slice(0, eq)] = part.slice(eq + 1)
  }
  const prov = text.match(/\[provenance: ([^\]]*)\]/)
  if (prov) facts.provenance = prov[1].slice(0, 80)
  const conf = text.match(/confidence: ([0-9.]+)/)
  if (conf) facts.confidence = conf[1]
  rows.push({
    label,
    args,
    isError: result?.isError === true,
    ms,
    chars: text.length,
    sourceEntries: sourceLines.length,
    retrieval: facts,
    truncatedWordInText: /\btruncat/i.test(text),
    limitWasZeroNotice: /limit was 0/.test(text),
    firstLine: text.split("\n")[0]?.slice(0, 100),
  })
}

await probe("limit omitted (default 5)", { query: "how does request handling work" })
await probe("limit 0", { query: "how does request handling work", limit: 0 })
await probe("limit 1", { query: "how does request handling work", limit: 1 })
await probe("limit 3", { query: "how does request handling work", limit: 3 })
await probe("limit 500", { query: "how does request handling work", limit: 500 })
await probe("limit 100000", { query: "how does request handling work", limit: 5000 })
await probe("limit negative", { query: "how does request handling work", limit: -1 })
await probe("limit fractional", { query: "how does request handling work", limit: 2.5 })
await probe("limit string", { query: "how does request handling work", limit: "5" })
await probe("exact symbol name", { query: "handleImpactRequest" })
await probe("phrase limit 1", { query: "request handler", limit: 1 })
await probe("phrase limit 5", { query: "request handler" })
await probe("phrase limit 50", { query: "request handler", limit: 50 })
await probe("phrase limit 500", { query: "request handler", limit: 500 })
await probe("many-match limit 1", { query: "request", limit: 1 })
await probe("many-match limit 3", { query: "request", limit: 3 })
await probe("many-match default", { query: "request" })
await probe("many-match limit 50", { query: "request", limit: 50 })
await probe("many-match limit 500", { query: "request", limit: 500 })
await probe("many-match limit 2000", { query: "request", limit: 2000 })
await probe("aggregate question", { query: "how many functions are in this project" })
await probe("empty query", { query: "" })
await probe("whitespace query", { query: "   " })

const report = {
  projectDir,
  projectId,
  dataDir: process.env.BB_DATA_DIR ?? "(default ~/.bb)",
  descriptor: {
    description: descriptor.description,
    limitSchema: (descriptor.inputSchema as any).properties?.limit,
  },
  rows,
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
for (const r of rows) console.log(JSON.stringify(r))
