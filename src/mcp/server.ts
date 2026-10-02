// Universal MCP server on brain-core. Stdio transport with explicit read,
// index-mutation, and source-mutation tool metadata.
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { BrainDatabase } from "../brain/database"
import { getProjectId } from "../cli/index"
import { BACKBENCHER_BRAIN_VERSION } from "../version"
import { createToolHandlers, type ToolContext } from "./tool-handlers"
import { TOOL_DESCRIPTORS, PUBLIC_TOOL_DESCRIPTORS, toMcpToolList } from "./tool-registry"
import { validateToolArguments } from "./tool-validation"

const handlers = createToolHandlers()
const descriptors = new Map(TOOL_DESCRIPTORS.map((descriptor) => [descriptor.name, descriptor]))

async function ensureIndexed(context: ToolContext): Promise<string | null> {
  try {
    const raw = await BrainDatabase.getRawInstance(context.projectId)
    const files = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(context.projectId) as any).c ?? 0
    if (files === 0) {
      return `No index found for ${context.projectPath}. Run: bb index "${context.projectPath}" (or restart bb mcp after indexing).`
    }
    return null
  } catch {
    return `No index found for ${context.projectPath}. Run: bb index "${context.projectPath}".`
  }
}

export async function startMcpServer(projectPath: string): Promise<void> {
  // `getProjectId` is imported at MODULE scope. It looks like a cycle —
// cli/index.ts dynamically imports this module to start the server — and moving
// the import inside this function was tried as a fix. It was reverted: measured,
// the lazy version was no better, and it added a second way for the two entries
// to diverge. The real defect was in cli/index.ts's entry guard
// (`import.meta.main` is undefined under `node --import tsx`, so `runCli` was
// never called from the source entry); that is fixed there, and the divergence
// between `node bin/bb mcp` and the source entry is asserted by
// test/cli-surface/packaging.ts.
  const context: ToolContext = { projectPath, projectId: getProjectId(projectPath) }
  const server = new Server(
    { name: "backbencher-brain", version: BACKBENCHER_BRAIN_VERSION },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toMcpToolList(PUBLIC_TOOL_DESCRIPTORS) as any }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const descriptor = descriptors.get(request.params.name)
    const handler = handlers[request.params.name]
    if (!descriptor || !handler) {
      return { content: [{ type: "text", text: `unknown tool: ${request.params.name}` }], isError: true }
    }

    try {
      const argumentsObject = validateToolArguments(descriptor, request.params.arguments ?? {})
      if (descriptor.requiresIndex) {
        const notIndexed = await ensureIndexed(context)
        if (notIndexed) return { content: [{ type: "text", text: notIndexed }] }
      }
      const result = await handler(argumentsObject, context)
      return result
    } catch (error: any) {
      return { content: [{ type: "text", text: `error: ${error?.message ?? String(error)}` }], isError: true }
    }
  })

  await server.connect(new StdioServerTransport())
}

// Self-execution entry: `bun src/mcp/server.ts --dir <path>` starts the server.
if (import.meta.main) {
  const dirArg = process.argv.findIndex((argument) => argument === "--dir")
  const directory = dirArg !== -1 ? process.argv[dirArg + 1] : process.cwd()
  startMcpServer(directory).catch((error) => {
    console.error("MCP server failed:", error?.message ?? String(error))
    process.exit(1)
  })
}
