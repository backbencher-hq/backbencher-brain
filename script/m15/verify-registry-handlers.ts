// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the C2 gate for the public tool surface: it proves the
//   registry descriptors and the handler modules correspond one-to-one, that the
//   descriptor schema validator rejects planted defects, and that the write/
//   index policy is pinned so a new tool cannot silently change it.
// WHY IT READS SOURCE MODULES INSTEAD OF PARSING THEM — the previous version
//   scanned `tool-registry.ts` / `tool-handlers.ts` as TEXT and asserted "10
//   tools", so it went green against a surface it was no longer describing and
//   then reported zero descriptors once the registry was split into per-tool
//   modules. A gate that parses another file's source is a second, weaker copy
//   of that file; this one imports the real registry and the real handlers.
// WHERE ITS EVIDENCE LIVES — validation/m15/results/c2.json.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tool-registry.ts,
//   src/mcp/tools/<tool>/descriptor.ts, src/mcp/tool-handlers.ts,
//   src/mcp/tools/<tool>/handler.ts.
// CONTRACTS IT MUST NOT BREAK — every check must be able to go red: the
//   negative controls below plant a defect and require the validator to throw.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import {
  TOOL_DESCRIPTORS,
  PUBLIC_TOOL_DESCRIPTORS,
  validateToolDescriptors,
  deriveToolContracts,
  toMcpToolList,
} from "../../src/mcp/tool-registry"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import type { ToolDescriptor } from "../../src/mcp/tool-registry"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

let checks = 0
let passed = 0
let failed = 0
let negatives = 0
let negativePassed = 0

function ck(label: string, cond: boolean, detail?: string): void {
  checks++
  if (cond) {
    passed++
    return
  }
  failed++
  console.log("  FAIL: " + label + (detail ? " — " + detail : ""))
}

function nk(label: string, cond: boolean, detail?: string): void {
  checks++
  negatives++
  if (cond) {
    negativePassed++
    return
  }
  failed++
  console.log("  FAIL: " + label + " (negative)" + (detail ? " — " + detail : ""))
}

function throws(fn: () => void): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

function emit(code: string, label: string): void {
  const total = passed + negativePassed
  console.log(
    "\n" + code + ": " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") +
      " (" + total + "/" + checks + " passed, " + negatives + " negatives)",
  )
  const resultsDir = path.join(ROOT, "validation/m15/results")
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true })
  const evidence = {
    issue: "M15.C2",
    code,
    tool: "registry+handlers",
    label,
    verified: failed === 0,
    toolCount: TOOL_DESCRIPTORS.length,
    checks,
    passed: total,
    failed,
    negatives,
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(path.join(resultsDir, "c2.json"), JSON.stringify(evidence, null, 2) + "\n")
  process.exitCode = failed > 0 ? 1 : 0
}

const registryNames = TOOL_DESCRIPTORS.map((descriptor) => descriptor.name)
const handler = createToolHandlers()
const handlerNames = Object.keys(handler).sort()

// === 1. The registry is the single authority ===
ck("registry is not empty", TOOL_DESCRIPTORS.length > 0)
ck("all descriptor names are unique", new Set(registryNames).size === registryNames.length)
ck(
  "PUBLIC_TOOL_DESCRIPTORS is the same set as TOOL_DESCRIPTORS",
  PUBLIC_TOOL_DESCRIPTORS.length === TOOL_DESCRIPTORS.length &&
    PUBLIC_TOOL_DESCRIPTORS.every((descriptor, index) => descriptor.name === registryNames[index]),
)
ck("the shipped registry passes its own validator", !throws(() => validateToolDescriptors(TOOL_DESCRIPTORS)))

// === 2. Descriptor ↔ handler one-to-one correspondence ===
const registrySet = new Set(registryNames)
const handlerSet = new Set(handlerNames)
const registryOnly = registryNames.filter((name) => !handlerSet.has(name))
const handlerOnly = handlerNames.filter((name) => !registrySet.has(name))
ck("every descriptor has a handler", registryOnly.length === 0, "registry-only: " + (registryOnly.join(", ") || "none"))
ck("every handler has a descriptor", handlerOnly.length === 0, "handler-only: " + (handlerOnly.join(", ") || "none"))
ck(
  "registry ↔ handler is one-to-one",
  registryOnly.length === 0 && handlerOnly.length === 0,
  registryOnly.length + " registry-only, " + handlerOnly.length + " handler-only",
)

// === 3. Schema hygiene every public descriptor must satisfy ===
ck(
  "every required field is a declared property",
  TOOL_DESCRIPTORS.every((descriptor) => {
    const properties = descriptor.inputSchema.properties ?? {}
    return (descriptor.inputSchema.required ?? []).every((required) => required in properties)
  }),
)
ck("every descriptor has at least one mode", TOOL_DESCRIPTORS.every((descriptor) => descriptor.modes.length > 0))
ck(
  "every descriptor carries a documentation summary and category",
  TOOL_DESCRIPTORS.every(
    (descriptor) => descriptor.documentation.summary.length > 0 && descriptor.documentation.category.length > 0,
  ),
)

// === 4. The policy is pinned on purpose: changing it must edit this file too ===
const writeTools = TOOL_DESCRIPTORS.filter((descriptor) => descriptor.mutability === "write")
  .map((descriptor) => descriptor.name)
  .sort()
ck(
  "write-capable tools are exactly bb_annotate, bb_edit, bb_index",
  JSON.stringify(writeTools) === JSON.stringify(["bb_annotate", "bb_edit", "bb_index"]),
  writeTools.join(", "),
)
const indexFree = TOOL_DESCRIPTORS.filter((descriptor) => !descriptor.requiresIndex)
  .map((descriptor) => descriptor.name)
  .sort()
ck(
  "index-free tools are exactly bb_annotate, bb_annotations, bb_health, bb_index",
  JSON.stringify(indexFree) === JSON.stringify(["bb_annotate", "bb_annotations", "bb_health", "bb_index"]),
  indexFree.join(", "),
)
ck(
  "no tool is deprecated without a replacement",
  TOOL_DESCRIPTORS.every((descriptor) => !descriptor.deprecated || descriptor.replacement !== undefined),
)

// === 5. Negative controls: the validator must reject planted defects ===
const base = TOOL_DESCRIPTORS[0] as ToolDescriptor
const withMutant = (patch: Partial<ToolDescriptor>): ToolDescriptor[] => [
  ...TOOL_DESCRIPTORS,
  { ...base, ...patch },
]
nk("validator rejects a duplicate descriptor", throws(() => validateToolDescriptors(withMutant({}))))
nk(
  "validator rejects a non-object input schema",
  throws(() =>
    validateToolDescriptors(
      withMutant({ name: "bb_mutant_schema", inputSchema: { type: "array" } as unknown as ToolDescriptor["inputSchema"] }),
    ),
  ),
)
nk(
  "validator rejects a required field that is not declared",
  throws(() =>
    validateToolDescriptors(
      withMutant({
        name: "bb_mutant_required",
        inputSchema: { type: "object", properties: {}, required: ["nope"] },
      }),
    ),
  ),
)
nk(
  "validator rejects duplicate modes",
  throws(() =>
    validateToolDescriptors(withMutant({ name: "bb_mutant_modes", modes: [base.modes[0], base.modes[0]] })),
  ),
)
nk(
  "validator rejects a deprecated tool without a replacement",
  throws(() =>
    validateToolDescriptors(withMutant({ name: "bb_mutant_deprecated", deprecated: true, replacement: undefined })),
  ),
)
nk(
  "validator rejects planned modes that overlap executable modes",
  throws(() => validateToolDescriptors(withMutant({ name: "bb_mutant_planned", plannedModes: [base.modes[0]] }))),
)
nk(
  "validator rejects indexFreeModes on a tool that never needs an index",
  throws(() =>
    validateToolDescriptors(
      withMutant({ name: "bb_mutant_free", requiresIndex: false, indexFreeModes: [base.modes[0]] }),
    ),
  ),
)

// === 6. Derived surfaces agree with the registry ===
const derived = deriveToolContracts()
ck(
  "deriveToolContracts covers every descriptor",
  derived.length === TOOL_DESCRIPTORS.length && derived.every((contract, index) => contract.name === registryNames[index]),
)
ck("toMcpToolList carries a schema for every descriptor", toMcpToolList().every((tool) => tool.inputSchema.type === "object"))

// === 7. The split is real: every tool has its own descriptor and handler module ===
const missingModules = TOOL_DESCRIPTORS.filter(
  (descriptor) =>
    !existsSync(path.join(ROOT, "src/mcp/tools", descriptor.name, "descriptor.ts")) ||
    !existsSync(path.join(ROOT, "src/mcp/tools", descriptor.name, "handler.ts")),
).map((descriptor) => descriptor.name)
ck("every tool owns a descriptor module and a handler module", missingModules.length === 0, missingModules.join(", "))

emit("C2", "registry + handlers + validation")
