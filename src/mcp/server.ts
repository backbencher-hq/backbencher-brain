// Universal MCP server on brain-core. Stdio transport with explicit read,
// index-mutation, and source-mutation tool metadata.
import { resolve } from "node:path"
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
  } catch (error: any) {
    // P2-6: an index written by an older bb build is a DECLARED, remediated
    // refusal (SchemaIncompatibleError names the DB, schema version, missing
    // columns and `bb index --post`). Collapsing it into "No index found" would
    // tell the user to re-index a project that is indexed — the wrong cause and
    // the wrong remedy. Every other error keeps the existing generic wording.
    if (error?.code === "BB_SCHEMA_INCOMPATIBLE") throw error
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

/**
 * Declare WHICH PROJECT every answer came from.
 *
 * THE DEFECT THIS FIXES. bb can be told `--dir X` while the caller is working in Y. It then
 * answers about X: no error, no warning, and a query for a symbol that exists only in Y comes
 * back as `totalMatches=0` -- which reads exactly like "that symbol does not exist".
 *
 * Measured on this machine: an MCP server launched with `--dir /home/ishaq2321/ProxiCall`
 * answered `bb_search runArm` with zero matches, while the same binary at backbencher-brain
 * returned 6. An agent (and a human) can spend hours concluding the tool is useless when it
 * has been answering about a different repository the whole time.
 *
 * A "no results" that really means "wrong repository" is the most dangerous shape of wrong
 * answer: confident, well-formed, and it tells the caller to stop looking. So every answer
 * now names its project, in the same machine-readable style the tools already use:
 *
 *   * JSON answers get a top-level `project` field (they are objects by contract);
 *   * text answers get a trailing `[project] <root>` line, beside the existing `[match-set]`.
 *
 * This does not RE-ROOT anything. Declaring provenance is the part that turns a silent wrong
 * answer into a visible one; choosing to re-root instead would be a larger design change and
 * would be wrong for callers who legitimately serve a project they are not sitting in.
 */
export function stampProvenance(
  result: { content: Array<{ type: "text"; text: string }>; isError?: boolean },
  projectPath: string,
): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  // Resolved so two spellings of one directory (trailing slash, `..`, symlink) compare equal.
  const root = (() => {
    try {
      return resolve(projectPath)
    } catch {
      return projectPath
    }
  })()
  return {
    ...result,
    content: result.content.map((part) => {
      const text = part.text ?? ""
      // JSON answers: an object at top level. `bb_health` answers as prose key:value lines and
      // already names the project; stretching this to guess at every format would be worse
      // than leaving those alone.
      const trimmed = text.trim()
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>
          if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
            if ("project" in parsed) return part
            parsed.project = root
            return { ...part, text: JSON.stringify(parsed, null, 2) }
          }
        } catch {
          // Not JSON after all: fall through to the text form.
        }
      } else if (trimmed.startsWith("[")) {
        // A JSON ARRAY is still JSON. Appending a text line would make the payload
        // unparseable for a caller that asked for a list — the one thing this function must
        // never do is break a well-formed answer while adding provenance. Arrays carry no
        // place for a `project` field, so they are left exactly as they are.
        return part
      }
      if (/^\[project\] /m.test(text)) return part
      return { ...part, text: `${text}\n[project] ${root}` }
    }),
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
      const notIndexed = await indexRequirementRefusal(context, descriptor, argumentsObject)
      if (notIndexed !== null) return { content: [{ type: "text", text: notIndexed }], isError: true }
      const result = await handler(argumentsObject, context)
      return stampProvenance(result, context.projectPath)
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
