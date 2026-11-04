// Universal MCP server on brain-core. Stdio transport with explicit read,
// index-mutation, and source-mutation tool metadata.
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { BrainDatabase } from "../brain/database"
import { getProjectId } from "../util/project-id"
import { BACKBENCHER_BRAIN_VERSION } from "../version"
import { createToolHandlers, type ToolContext } from "./tool-handlers"
import { TOOL_DESCRIPTORS, PUBLIC_TOOL_DESCRIPTORS, toMcpToolList, type ToolDescriptor } from "./tool-registry"
import { validateToolArguments } from "./tool-validation"

// ─────────────────────────────────────────────────────────────────────────────
// STDOUT IS THE MCP JSON-RPC CHANNEL. Never write anything else to it.
//
// The engines behind the tools log through the default console (the indexer's
// worker-pool banner, the relationship resolver's bounded-resolution summary).
// In a CLI run those lines belong on stdout. Under `bb mcp` they would sit
// between JSON-RPC messages and poison strict clients — measured: two distinct
// non-JSON lines per client (`[brain] ✓ worker pool available…` and
// `bounded: resolved …`), which a tolerant client classifies but a strict one
// rejects. Redirect the console's informational writes to stderr for this
// process only; the transport writes through process.stdout.write and is
// untouched.
// ─────────────────────────────────────────────────────────────────────────────
{
  const toStderr = (...args: unknown[]): void => {
    try {
      process.stderr.write(args.map((value) => (typeof value === "string" ? value : String(value))).join(" ") + "\n")
    } catch {
      // A closed stderr must never make a tool call fail.
    }
  }
  console.log = toStderr
  console.info = toStderr
  console.debug = toStderr
}

const handlers = createToolHandlers()
const descriptors = new Map(TOOL_DESCRIPTORS.map((descriptor) => [descriptor.name, descriptor]))

async function ensureIndexed(context: ToolContext): Promise<string | null> {
  try {
    const raw = await BrainDatabase.getRawInstance(context.projectId, { readonly: true })
    const files = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(context.projectId) as any).c ?? 0
    if (files === 0) {
      return `No index found for ${context.projectPath}. Run: bb index "${context.projectPath}" (or restart bb mcp after indexing).`
    }
    return null
  } catch {
    return `No index found for ${context.projectPath}. Run: bb index "${context.projectPath}".`
  }
}

/**
 * M71.D6: the index gate is per MODE, not per tool.
 *
 * `requiresIndex` is a tool-level boolean, and for bb_edit that was a refusal
 * with no work behind it: the server blocked EVERY call on a project with no
 * index — including `write`, which resolves no symbol, plans from the request
 * and the disk, and reindexes the file it wrote. Measured before the fix: all
 * five modes answered "No index found" over the wire while the engine below
 * would have created the file and indexed it, so an agent could not create the
 * first file of a new project with the tool that exists to create files.
 *
 * The rule is the registered one (`indexFreeModes`), not a list kept here:
 *   - a mode the registry marks index-free passes the gate;
 *   - a call with no `mode` at all (or an unregistered one — validateToolArguments
 *     rejects those) is still treated as needing the index, which is the old
 *     behavior and the conservative direction;
 *   - a tool with no free modes answers exactly as before.
 *
 * The refusal is also a refusal now. It used to be returned with no `isError`,
 * so an MCP client that branches on that flag saw a successful tool result whose
 * text happened to say the tool did not run — for a WRITE tool, a false success
 * is the worst possible reading. `isError: true` is the same shape every handler
 * refusal already uses.
 */
async function indexRequirementRefusal(
  context: ToolContext,
  descriptor: ToolDescriptor,
  args: Record<string, unknown>,
): Promise<string | null> {
  if (!descriptor.requiresIndex) return null
  const free = descriptor.indexFreeModes ?? []
  const mode = typeof args.mode === "string" ? args.mode : undefined
  if (mode !== undefined && free.includes(mode)) return null
  const notIndexed = await ensureIndexed(context)
  if (notIndexed === null) return null
  if (free.length === 0) return notIndexed
  // A caller blocked from `update` should learn that `write` works, not only
  // that they cannot proceed — the refusal names both halves of the rule.
  const blocked = descriptor.modes.filter((m) => !free.includes(m))
  const names = (modes: readonly string[]): string => modes.map((m) => `\`${m}\``).join(", ")
  return `${notIndexed} ${descriptor.name} needs that index for ${names(blocked)}; ${names(free)} ${free.length === 1 ? "does" : "do"} not need an index and ${free.length === 1 ? "works" : "work"} now.`
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
      const notIndexed = await indexRequirementRefusal(context, descriptor, argumentsObject)
      if (notIndexed !== null) return { content: [{ type: "text", text: notIndexed }], isError: true }
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
