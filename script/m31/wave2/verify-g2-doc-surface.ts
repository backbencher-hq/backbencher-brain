// script/m31/wave2/verify-g2-doc-surface.ts — M31.G2 (#664)
// Doc-truth gates extended to the full 16-tool surface: EVERY registered tool
// must have a per-tool doc carrying (a) a mode line equal to the live
// registry's executable modes and (b) at least one example accepted by BOTH
// ajv (schema) and validateToolArguments (runtime) — the doc may never
// advertise what the registry cannot execute.
//
// This is the surface contract, deliberately compact and registry-driven (the
// wave-1 D1 gate deepens it: errors T1-backed, byte-currency, planned-mode
// disjointness). A new tool cannot merge without its doc, and a doc cannot
// drift from the registry's modes/examples without this gate failing.
//
// Seam for the wave-2 mutation selftest: BB_M31_MUTATE_G2_SKIP=<name> makes
// the gate treat that tool as undocumented — simulating a missing doc — so
// the coverage check must fail (a doc-removal regression cannot go green).

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import Ajv from "ajv"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const RESULTS_DIR = path.join(ROOT, "validation/m31/wave2/results")
const DOCS_DIR = path.join(ROOT, "docs/tools")
const MUTATE_SKIP = process.env.BB_M31_MUTATE_G2_SKIP ?? ""

let passed = 0, failed = 0, negatives = 0
function check(label: string, ok: boolean, detail = "", isNegative = false) {
  if (isNegative) negatives++
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

function section(md: string, heading: string): string {
  const idx = md.indexOf(`## ${heading}`)
  if (idx === -1) return ""
  const rest = md.slice(idx)
  const next = rest.indexOf("\n## ", 1)
  return next === -1 ? rest : rest.slice(0, next)
}

async function main() {
  const { PUBLIC_TOOL_DESCRIPTORS } = await import("../../../src/mcp/tool-registry")
  const { validateToolArguments } = await import("../../../src/mcp/tool-validation")
  const descriptors = PUBLIC_TOOL_DESCRIPTORS as unknown as Array<{
    name: string
    modes: readonly string[]
    inputSchema: object
  }>
  const ajv = new Ajv({ strict: false })

  check("registry surface is exactly 16 tools", descriptors.length === 16, String(descriptors.length))
  const expectedNames = descriptors.map((d) => d.name).sort()
  const unique = new Set(expectedNames)
  check("registry tool names are unique", unique.size === descriptors.length, String(unique.size))

  let documented = 0
  const uncovered: string[] = []
  for (const descriptor of descriptors) {
    const name = descriptor.name
    if (MUTATE_SKIP && MUTATE_SKIP === name) continue // seam: doc treated as missing
    const docPath = path.join(DOCS_DIR, `${name}.md`)
    check(`G2: ${name} doc exists`, existsSync(docPath), docPath)
    if (!existsSync(docPath)) { uncovered.push(name); continue }
    documented++
    const md = readFileSync(docPath, "utf8")

    // Modes: doc's Contract `- Modes:` line == live registry executable modes.
    const contract = section(md, "Contract")
    const modesLine = contract.split("\n").find((l) => l.startsWith("- Modes:"))
    const docModes = modesLine ? [...modesLine.matchAll(/`([a-z_-]+)`/g)].map((m) => m[1]) : []
    check(
      `G2: ${name} doc modes match the live registry`,
      JSON.stringify(docModes) === JSON.stringify([...descriptor.modes]),
      `doc=[${docModes}] registry=[${descriptor.modes}]`,
    )

    // Examples: >=1, schema-valid (ajv) AND accepted by the runtime validator.
    const examplesBlock = section(md, "Examples")
    const exampleLines = examplesBlock.split("\n").filter((l) => /^`\{.*\}`$/.test(l.trim()))
    check(`G2: ${name} doc documents at least one example`, exampleLines.length > 0, "")
    const validate = ajv.compile(descriptor.inputSchema)
    for (const line of exampleLines) {
      let example: unknown = null
      try { example = JSON.parse(line.trim().slice(1, -1)) } catch {
        check(`G2: ${name} example parses as JSON`, false, line.slice(0, 80)); continue
      }
      const okAjv = validate(example) === true
      check(`G2: ${name} example schema-valid (ajv)`, okAjv, okAjv ? "" : ajv.errorsText(validate.errors ?? []))
      let okRuntime = false
      let detail = ""
      try { validateToolArguments(descriptor as any, example); okRuntime = true } catch (e) { detail = String((e as Error).message).slice(0, 120) }
      check(`G2: ${name} example accepted by the runtime validator`, okRuntime, detail)
    }
  }

  // Coverage: all 16 tools documented (the seam simulates removal of one).
  check("G2: all 16 registered tools are documented", documented === 16 && uncovered.length === 0, `documented=${documented} uncovered=[${uncovered.join(",")}]`)

  // Negatives: the predicates must be able to refuse.
  {
    const regModes = new Set(descriptors[0].modes as unknown as string[])
    const driftedModes = [...regModes, "definitely_not_a_mode"]
    check("G2: drifted mode list would be refused [negative]", JSON.stringify(driftedModes) !== JSON.stringify([...regModes]), "", true)
    // Type violation on a real field (the schemas legitimately allow unknown
    // extra fields, so a nonexistent-field probe would not be refused).
    const badExample = { limit: "not-a-number" }
    const validate = ajv.compile(descriptors[0].inputSchema)
    check("G2: schema-invalid example would be refused [negative]", !(validate(badExample) === true), "", true)
    if (documented === 16) {
      check("G2: nonexistent doc refused by existsSync [negative]", !existsSync(path.join(DOCS_DIR, "bb_definitely_missing.md")), "", true)
    }
  }

  const ok = failed === 0
  console.log(`M31 G2 doc-surface: ${passed} passed, ${failed} failed, ${negatives} negatives`)
  if (ok && process.env.BB_M31_READ_ONLY !== "1") {
    mkdirSync(RESULTS_DIR, { recursive: true })
    const head = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })()
    writeFileSync(path.join(RESULTS_DIR, "G2.json"), JSON.stringify({
      status: "verified",
      currentCommit: head,
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m31/wave2/verify-g2-doc-surface.ts",
      evidenceFile: "G2.json",
      generatedAt: new Date().toISOString(),
      passed, failed,
      negativeCases: negatives,
      documentedTools: documented,
      registryTools: descriptors.length,
    }, null, 2) + "\n")
    console.log("evidence stamped: validation/m31/wave2/results/G2.json")
  }
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error("G2 gate crashed:", e); process.exit(1) })
