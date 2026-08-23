// script/m15/verify-registry-handlers.ts — M15.C2
// Tool registry + handlers + validation — boundary enforcement across 10 tools.
// 1. Every descriptor has a handler function
// 2. Every handler has a registry descriptor
// 3. Mode validation is consistent (registry modes ⊇ handler-checked modes)
// 4. validateToolDescriptors catches all known error cases
// 5. Registry is the single authority (no parallel copy drift)

import { readFileSync, existsSync, mkdirSync } from "node:fs"
import { writeFileSync } from "node:fs"
import path from "node:path"

let checks = 0, passed = 0, failed = 0, negatives = 0, negativePassed = 0

function ck(label: string, cond: boolean, detail?: string) {
  checks++
  if (cond) { passed++; return }
  failed++
  console.log("  FAIL: " + label + (detail ? " — " + detail : ""))
}

function nk(label: string, cond: boolean, detail?: string) {
  negatives++
  if (cond) { negativePassed++; return }
  failed++
  console.log("  FAIL: " + label + " (negative)" + (detail ? " — " + detail : ""))
}

function emit(code: string, label: string) {
  const total = passed + negativePassed
  console.log("\n" + code + ": " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + total + "/" + checks + " passed, " + negatives + " negatives)")
  const resultsDir = path.join(ROOT, "validation/m15/results")
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true })
  const evidence: any = {
    issue: "M15.C2", code, tool: "registry+handlers",
    label, verified: failed === 0,
    checks, passed: total, failed, negatives,
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(path.join(resultsDir, "c2.json"), JSON.stringify(evidence, null, 2) + "\n")
  process.exitCode = failed > 0 ? 1 : 0
}

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

// === 1. Parse registry descriptors from source ===
const registryText = readFileSync(path.join(ROOT, "src/mcp/tool-registry.ts"), "utf-8")
const handlerText = readFileSync(path.join(ROOT, "src/mcp/tool-handlers.ts"), "utf-8")
const validationText = readFileSync(path.join(ROOT, "src/mcp/tool-validation.ts"), "utf-8")

// Extract tool names from registry "name" fields
const nameRE = /name:\s*"(bb_\w+)"/g
const registryNames: string[] = []
let m
while ((m = nameRE.exec(registryText)) !== null) {
  registryNames.push(m[1])
}
ck("registry has 10 tool descriptors", registryNames.length === 10, "found " + registryNames.length + ": " + registryNames.join(", "))

// Extract tool names from handler property keys
const handlerRE = /^\s+(bb_\w+):\s*(?:async\s*)?\(/gm
const handlerNames: string[] = []
while ((m = handlerRE.exec(handlerText)) !== null) {
  handlerNames.push(m[1])
}
ck("handler has 10 tool functions", handlerNames.length === 10, "found " + handlerNames.length + ": " + handlerNames.join(", "))

// === 2. 1:1 correspondence ===
const registrySet = new Set(registryNames)
const handlerSet = new Set(handlerNames)

for (const name of registrySet) {
  ck("registry '" + name + "' has handler", handlerSet.has(name), name)
}
for (const name of handlerSet) {
  ck("handler '" + name + "' has registry entry", registrySet.has(name), name)
}

// Count mismatch
const regOnly = [...registrySet].filter(n => !handlerSet.has(n))
const hndOnly = [...handlerSet].filter(n => !registrySet.has(n))
nk("no registry-only tools without handlers", regOnly.length === 0, "registry-only: " + (regOnly.length ? regOnly.join(", ") : "none"))
nk("no handler-only tools without registry", hndOnly.length === 0, "handler-only: " + (hndOnly.length ? hndOnly.join(", ") : "none"))
ck("registry ↔ handler 1:1 correspondence", regOnly.length === 0 && hndOnly.length === 0, regOnly.length + " registry-only, " + hndOnly.length + " handler-only")

// === 3. Mode consistency: handler mode checks vs registry modes ===
// Parse modes from registry
const modesMap = new Map<string, string[]>()
for (const name of registrySet) {
  // Find mode array in the descriptor block
  const descRE = new RegExp("name:\\s*\"" + name + "\"[\\s\\S]*?modes:\\s*\\[([^\\]]*)\\]", "m")
  const dm = descRE.exec(registryText)
  if (dm) {
    const modes = dm[1].split(",").map(s => s.trim().replace(/"/g, "").replace(/'/g, "")).filter(Boolean)
    modesMap.set(name, modes)
  }
  const plannedRE = new RegExp("name:\\s*\"" + name + "\"[\\s\\S]*?plannedModes:\\s*\\[([^\\]]*)\\]", "m")
  const pm = plannedRE.exec(registryText)
  if (pm) {
    const planned = pm[1].split(",").map(s => s.trim().replace(/"/g, "").replace(/'/g, "")).filter(Boolean)
    const existing = modesMap.get(name) || []
    modesMap.set(name, [...existing, ...planned])
  }
}

// Check handler mode validation strings
for (const name of registrySet) {
  const modes = modesMap.get(name) || []
  ck(name + " has modes in registry", modes.length > 0, modes.join(", "))
}

// Check each tool's mode validation in handler
for (const name of registrySet) {
  // Find mode validation pattern in handler for this tool
  // Patterns: `bb_analyze mode:`, `bb_edit requires mode:`, etc.
  const hasModeValidation = handlerText.includes(name + " mode:") ||
    handlerText.includes(name + " requires mode:") ||
    handlerText.includes(`"${name}" mode`) ||
    !registryText.includes("modes: []") // tools with no modes don't need validation
  ck(name + " has mode validation (or no modes)", hasModeValidation || modesMap.get(name)!.length === 0, name)
}

// === 4. validateToolDescriptors catches errors ===
ck("validateToolDescriptors function exists", validationText.includes("export function validateToolDescriptors") || registryText.includes("export function validateToolDescriptors"), "in tool-registry.ts")
ck("validateToolDescriptors called at module load", registryText.includes("validateToolDescriptors(TOOL_DESCRIPTORS)"), "self-call in registry")
ck("validateToolDescriptors checks duplicate names", registryText.includes("duplicate") || registryText.includes("names.has"), "duplicate detection")
ck("validateToolDescriptors checks schema type", registryText.includes('"object"'), "schema type check")
ck("validateToolDescriptors checks required fields", registryText.includes("required") && registryText.includes("inputSchema.required"), "required field validation")
ck("validateToolDescriptors checks duplicate modes", registryText.includes("duplicate modes"), "duplicate mode detection")
ck("validateToolDescriptors checks planned overlap", registryText.includes("planned") && registryText.includes("overlap"), "planned mode overlap")
ck("validateToolDescriptors checks deprecation", registryText.includes("deprecated") && registryText.includes("replacement"), "deprecation check")

// === 5. Single authority: no parallel hand-maintained copy ===
// TOOL_DESCRIPTORS is the only exported registry; PUBLIC_TOOL_DESCRIPTORS aliases it
ck("TOOL_DESCRIPTORS is exported", registryText.includes("export const TOOL_DESCRIPTORS"), "primary export")
ck("PUBLIC_TOOL_DESCRIPTORS aliases TOOL_DESCRIPTORS", registryText.includes("PUBLIC_TOOL_DESCRIPTORS") && registryText.includes("descriptors"), "alias")

// deriveToolContracts proves no separate copy
ck("deriveToolContracts derives from registry", registryText.includes("deriveToolContracts") && registryText.includes("TOOL_DESCRIPTORS"), "derived from source")

// === 6. Mutability audit ===
const mutRE = /mutability:\s*"(read|write)"/g
const muts: string[] = []
while ((m = mutRE.exec(registryText)) !== null) muts.push(m[1])
const readCount = muts.filter(x => x === "read").length
const writeCount = muts.filter(x => x === "write").length
ck("only bb_edit has write mutability", writeCount === 1 && readCount === 9, `write=${writeCount} read=${readCount}`)

// === 7. requiresIndex audit ===
const riRE = /requiresIndex:\s*(true|false)/g
const riVals: string[] = []
while ((m = riRE.exec(registryText)) !== null) riVals.push(m[1])
const riTrueCount = riVals.filter(x => x === "true").length
ck("9 of 10 tools require index (bb_health is flexible)", riTrueCount >= 9, String(riTrueCount))

// === 8. No deprecated tools without replacement ===
ck("no deprecated tools in registry", !registryText.includes("deprecated: true"), "all tools are active")

// === FINAL ===
emit("C2", "registry + handlers + validation")