import { PUBLIC_TOOL_DESCRIPTORS, TOOL_DESCRIPTORS, deriveToolContracts } from "../src/mcp/tool-registry"
import { createToolHandlers } from "../src/mcp/tool-handlers"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void { if (condition) console.log(`  ok: ${label}`); else { failures++; console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`) } }

const publicNames = PUBLIC_TOOL_DESCRIPTORS.map((tool) => tool.name)
const targetNames = deriveToolContracts().map((tool) => tool.name)
// M22.E1 grew the surface to 11 tools (bb_index). Per the M13.01 doctrine the
// executable registry is the single contract authority, so the expected count
// is derived from it — the invariant is "registry == contracts, non-empty",
// not a hardcoded historical number that goes stale on every intentional addition.
check("public descriptor count matches contract authority", publicNames.length === targetNames.length && publicNames.length > 0, String(publicNames.length))
check("public descriptors match target contracts", JSON.stringify([...publicNames].sort()) === JSON.stringify([...targetNames].sort()), publicNames.join(","))
check("all public tools have centralized handlers", publicNames.every((name) => Boolean(createToolHandlers()[name])))
check("registry contains only public tools", TOOL_DESCRIPTORS.length === PUBLIC_TOOL_DESCRIPTORS.length)
check("public descriptions are distinct", new Set(PUBLIC_TOOL_DESCRIPTORS.map((tool) => tool.description)).size === publicNames.length)
check("composite modes are unique", PUBLIC_TOOL_DESCRIPTORS.every((tool) => new Set(tool.modes).size === tool.modes.length))

console.log(failures === 0 ? "\nPUBLIC SURFACE: PASS" : `\nPUBLIC SURFACE: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
