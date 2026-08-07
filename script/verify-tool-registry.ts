import packageJson from "../package.json"
import { execFileSync } from "node:child_process"
import { CURRENT_MCP_TOOL_CONTRACTS } from "../src/contracts/tool-contracts"
import { createToolHandlers } from "../src/mcp/tool-handlers"
import {
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
check("registry count matches frozen baseline", TOOL_DESCRIPTORS.length === CURRENT_MCP_TOOL_CONTRACTS.length)
check("MCP list derives from registry", listed.length === TOOL_DESCRIPTORS.length && listed.every((tool, index) => tool.name === TOOL_DESCRIPTORS[index]?.name))
check("handler coverage is exact", Object.keys(handlers).sort().join(",") === TOOL_DESCRIPTORS.map((descriptor) => descriptor.name).sort().join(","))
check("package and server version source agree", BACKBENCHER_BRAIN_VERSION === packageJson.version)
const compiledVersion = execFileSync(process.execPath, ["bin/bb", "--version"], { encoding: "utf8" }).trim()
check("compiled CLI version uses package source", compiledVersion === packageJson.version, compiledVersion)

const serialized = serializeToolMetadata()
const parsed = JSON.parse(serialized)
check("metadata is serializable without handlers", Array.isArray(parsed) && parsed.length === TOOL_DESCRIPTORS.length && !serialized.includes("handler"))
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
