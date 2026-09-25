import packageJson from "../package.json"
import { execFileSync } from "node:child_process"
import { createToolHandlers } from "../src/mcp/tool-handlers"
import {
  deriveToolContracts,
  serializeToolMetadata,
  TOOL_DESCRIPTORS,
  toMcpToolList,
  validateToolDescriptors,
  type ToolDescriptor,
} from "../src/mcp/tool-registry"
import { BACKBENCHER_BRAIN_VERSION } from "../src/version"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`)
  }
}

function expectValidationFailure(label: string, descriptors: readonly ToolDescriptor[], message: string): void {
  try {
    validateToolDescriptors(descriptors)
    check(label, false, "validation unexpectedly passed")
  } catch (error) {
    check(label, error instanceof Error && error.message.includes(message), error instanceof Error ? error.message : String(error))
  }
}

const listed = toMcpToolList()
const handlers = createToolHandlers()
check("registry count matches derived contract", TOOL_DESCRIPTORS.length === deriveToolContracts().length)
check("MCP list derives from registry", listed.length === TOOL_DESCRIPTORS.length && listed.every((tool, index) => tool.name === TOOL_DESCRIPTORS[index]?.name))
check("handler coverage is exact", Object.keys(handlers).sort().join(",") === TOOL_DESCRIPTORS.map((descriptor) => descriptor.name).sort().join(","))
check("package and server version source agree", BACKBENCHER_BRAIN_VERSION === packageJson.version)
const compiledVersion = execFileSync(process.execPath, ["bin/bb", "--version"], { encoding: "utf8" }).trim()
check("compiled CLI version uses package source", compiledVersion === packageJson.version, compiledVersion)

const serialized = serializeToolMetadata()
const parsed = JSON.parse(serialized)
// M50.A5 (#768): the original form of this check was a substring test —
// `!serialized.includes("handler")` — which any legitimate prose defeats
// (bb_search's description says "the handler auto-refreshes …"). It could not
// pass, so it was ignored, and a red gate is indistinguishable from a green
// one once people stop reading. The property it MEANS is structural: the
// advertised metadata carries no executable handler reference. Assert that
// directly — no handler-ish KEY at any depth, no function values, and the
// payload must survive a JSON round-trip unchanged.
function handlerLeaks(node: unknown, at = "$"): string[] {
  if (typeof node === "function") return [`${at} (function value)`]
  if (Array.isArray(node)) return node.flatMap((value, index) => handlerLeaks(value, `${at}[${index}]`))
  if (node && typeof node === "object") {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => {
      const here = /^(handler|handlers|fn|function|implementation)$/i.test(key) ? [`${at}.${key} (handler key)`] : []
      return [...here, ...handlerLeaks(value, `${at}.${key}`)]
    })
  }
  return []
}
const leaks = handlerLeaks(parsed)
check(
  "metadata is serializable without handler references",
  Array.isArray(parsed) &&
    parsed.length === TOOL_DESCRIPTORS.length &&
    leaks.length === 0 &&
    JSON.stringify(JSON.parse(serialized)) === JSON.stringify(parsed),
  leaks.join(", "),
)

// "Serializable without handlers" is a claim about the DATA, not about English
// prose. JSON.stringify drops function values, so a leaked handler can only
// ever surface as a `handler` key — the previous raw substring test instead
// fired on the word "handler" in bb_search's description (which honestly
// documents its auto-refresh path), a false positive that could only be
// silenced by censoring a true sentence. Scan for the key itself, at any
// depth, in both the live descriptors and their serialization.
function hasHandlerKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasHandlerKey)
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, nested]) => key === "handler" || hasHandlerKey(nested))
  }
  return false
}

check(
  "metadata is serializable without handlers",
  Array.isArray(parsed) &&
    parsed.length === TOOL_DESCRIPTORS.length &&
    !hasHandlerKey(TOOL_DESCRIPTORS) &&
    !hasHandlerKey(parsed) &&
    !/"handler"\s*:/.test(serialized),
  `descriptor keys: ${[...new Set(TOOL_DESCRIPTORS.flatMap((descriptor) => Object.keys(descriptor)))].join(",")}`,
)
// The predicate must be able to fail: a real handler key is caught, while a
// description that mentions handlers in words is not the failure mode.
check(
  "handler-key detector is sensitive (a real leak would be caught)",
  hasHandlerKey({ nested: [{ handler: {} }] }) && !hasHandlerKey({ description: "the handler refreshes files" }),
)
check("mutability is explicit", TOOL_DESCRIPTORS.every((descriptor) => ["read", "index", "write"].includes(descriptor.mutability)))
check("documentation metadata is complete", TOOL_DESCRIPTORS.every((descriptor) => descriptor.documentation.summary && descriptor.documentation.category && Array.isArray(descriptor.documentation.examples)))

const base = TOOL_DESCRIPTORS[0]!
expectValidationFailure("duplicate names rejected", [base, { ...base }], "duplicate or empty tool name")
expectValidationFailure(
  "undeclared required fields rejected",
  [{ ...base, name: "invalid-required", inputSchema: { ...base.inputSchema, required: ["missing"] } }],
  "required field missing is not declared",
)
expectValidationFailure("duplicate modes rejected", [{ ...base, name: "invalid-modes", modes: ["symbols", "symbols"] }], "duplicate modes")
expectValidationFailure("duplicate aliases rejected", [{ ...base, name: "invalid-aliases", aliases: ["old", "old"] }], "duplicate aliases")
expectValidationFailure("deprecated tools require replacements", [{ ...base, name: "invalid-deprecated", deprecated: true, replacement: undefined }], "deprecated tools require a replacement")

console.log(failures === 0 ? "\nTOOL REGISTRY: PASS" : `\nTOOL REGISTRY: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
