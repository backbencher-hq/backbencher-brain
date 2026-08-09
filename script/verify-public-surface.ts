import { PUBLIC_TOOL_DESCRIPTORS, TOOL_DESCRIPTORS } from "../src/mcp/tool-registry"
import { createToolHandlers } from "../src/mcp/tool-handlers"
import { TARGET_TOOL_CONTRACTS } from "../src/contracts/tool-contracts"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void { if (condition) console.log(`  ok: ${label}`); else { failures++; console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`) } }

const publicNames = PUBLIC_TOOL_DESCRIPTORS.map((tool) => tool.name)
const targetNames = TARGET_TOOL_CONTRACTS.map((tool) => tool.name)
check("exactly ten public descriptors", publicNames.length === 10)
check("public descriptors match target contracts", JSON.stringify([...publicNames].sort()) === JSON.stringify([...targetNames].sort()), publicNames.join(","))
check("all public tools have centralized handlers", publicNames.every((name) => Boolean(createToolHandlers()[name])))
check("registry contains only public tools", TOOL_DESCRIPTORS.length === PUBLIC_TOOL_DESCRIPTORS.length)
check("public descriptions are distinct", new Set(PUBLIC_TOOL_DESCRIPTORS.map((tool) => tool.description)).size === 10)
check("composite modes are unique", PUBLIC_TOOL_DESCRIPTORS.every((tool) => new Set(tool.modes).size === tool.modes.length))

console.log(failures === 0 ? "\nPUBLIC SURFACE: PASS" : `\nPUBLIC SURFACE: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
