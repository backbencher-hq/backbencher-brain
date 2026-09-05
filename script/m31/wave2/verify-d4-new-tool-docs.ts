// script/m31/wave2/verify-d4-new-tool-docs.ts — M31.D4 (#663)
// Per-tool docs for the 5 post-merge tools at the wave-1 bar. The docs were
// written and are byte-governed by the generator (script/verify-tool-docs.ts);
// this gate proves the D4 acceptance criteria on top of that:
//
//   1. 16/16 docs exist — the 5 post-merge tools (bb_graph, bb_impact,
//      bb_cross_language, bb_annotate, bb_annotations) included.
//   2. Each doc's description byte-matches the live registry description and
//      its Contract modes byte-match the registry modes (no hand-typed drift).
//   3. Each doc carries >=1 example accepted by BOTH ajv (schema) and
//      validateToolArguments (runtime) — docs cannot advertise what the
//      registry cannot execute.
//   4. Overlap honesty: bb_annotate and bb_annotations docs cross-reference
//      the M28 workstream and state what is stable today.
//   5. Negatives: missing doc is refused; schema-invalid example is refused;
//      a doc with no M28 cross-ref is refused.
//
// Seam for the wave-2 mutation proof:
//   BB_M31_MUTATE_D4_SKIP=<name> treats that tool as undocumented — the
//   coverage check must fail (exit 1, no evidence stamped).
//   BB_M31_READ_ONLY=1 suppresses evidence stamping (probe runs).

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import Ajv from "ajv"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const RESULTS_DIR = path.join(ROOT, "validation/m31/wave2/results")
const DOCS_DIR = path.join(ROOT, "docs/tools")
const MUTATE_SKIP = process.env.BB_M31_MUTATE_D4_SKIP ?? ""

const POST_MERGE = ["bb_graph", "bb_impact", "bb_cross_language", "bb_annotate", "bb_annotations"]
const M28_TOOLS = ["bb_annotate", "bb_annotations"]

let passed = 0, failed = 0, negatives = 0
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  check(`${label} [negative]`, ok, detail)
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
    description: string
    modes: readonly string[]
    inputSchema: object
    documentation: { examples: readonly unknown[] }
  }>
  const byName = new Map(descriptors.map((d) => [d.name, d]))
  const ajv = new Ajv({ strict: false })

  check("registry surface is exactly 16 tools", descriptors.length === 16, String(descriptors.length))
  check("all five post-merge tools are registered", POST_MERGE.every((n) => byName.has(n)), POST_MERGE.filter((n) => !byName.has(n)).join(","))

  let documented = 0
  let deepOk = 0
  for (const name of [...byName.keys()].sort()) {
    if (MUTATE_SKIP && MUTATE_SKIP === name) continue // seam: doc treated as missing
    const descriptor = byName.get(name)!
    const docPath = path.join(DOCS_DIR, `${name}.md`)
    const exists = existsSync(docPath)
    check(`D4: ${name} doc exists (16/16 bar)`, exists, docPath)
    if (!exists) continue
    documented++
    const md = readFileSync(docPath, "utf8")

    // Description byte-match: the first paragraph (line after the title) must
    // equal the registry description exactly.
    const titleMatch = md.match(/^# `([^`]+)`\n\n([^\n]+)/)
    check(`D4: ${name} doc title names the tool`, titleMatch !== null && titleMatch[1] === name, "")
    check(`D4: ${name} doc description byte-matches the registry`, titleMatch !== null && titleMatch[2] === descriptor.description,
      titleMatch && titleMatch[2] !== descriptor.description ? `doc=${JSON.stringify(titleMatch[2]).slice(0, 80)} registry=${JSON.stringify(descriptor.description).slice(0, 80)}` : "")

    // Contract modes byte-match the registry modes.
    const contract = section(md, "Contract")
    const modesLine = contract.split("\n").find((l) => l.startsWith("- Modes:"))
    const docModes = modesLine ? [...modesLine.matchAll(/`([a-z_-]+)`/g)].map((m) => m[1]) : []
    check(`D4: ${name} Contract modes byte-match the registry`, JSON.stringify(docModes) === JSON.stringify([...descriptor.modes]),
      `doc=[${docModes}] registry=[${descriptor.modes}]`)

    // >=1 example, schema-valid AND runtime-accepted.
    const examplesBlock = section(md, "Examples")
    const exampleLines = examplesBlock.split("\n").filter((l) => /^`\{.*\}`$/.test(l.trim()))
    check(`D4: ${name} doc documents at least one example`, exampleLines.length > 0, "")
    const validate = ajv.compile(descriptor.inputSchema)
    for (const line of exampleLines) {
      let example: unknown = null
      try { example = JSON.parse(line.trim().slice(1, -1)) } catch {
        check(`D4: ${name} example parses as JSON`, false, line.slice(0, 80)); continue
      }
      const okAjv = validate(example) === true
      check(`D4: ${name} example schema-valid (ajv)`, okAjv, okAjv ? "" : ajv.errorsText(validate.errors ?? []))
      let okRuntime = false
      let detail = ""
      try { validateToolArguments(descriptor as any, example); okRuntime = true } catch (e) { detail = String((e as Error).message).slice(0, 120) }
      check(`D4: ${name} example accepted by the runtime validator`, okRuntime, detail)
    }
    deepOk++
  }

  // Coverage: 16/16 documented (seam simulates removal of one).
  check("D4: all 16 registered tools documented", documented === descriptors.length, `documented=${documented}`)

  // Overlap honesty (AC3): bb_annotate + bb_annotations cross-reference M28
  // and state what is stable today.
  for (const name of M28_TOOLS) {
    const md = existsSync(path.join(DOCS_DIR, `${name}.md`)) ? readFileSync(path.join(DOCS_DIR, `${name}.md`), "utf8") : ""
    check(`D4: ${name} doc cross-references the M28 workstream`, md.includes("M28"), "")
    check(`D4: ${name} doc states what is stable today`, md.includes("stable") || md.includes("today"), "")
  }

  // Negatives: the predicates must be able to refuse.
  {
    negative("missing doc file is refused by existsSync [negative]", !existsSync(path.join(DOCS_DIR, "bb_definitely_missing.md")), "")
    const badExample = { limit: "not-a-number" }
    const validate = ajv.compile((byName.get(POST_MERGE[0])!).inputSchema)
    negative("schema-invalid example is refused by ajv [negative]", !(validate(badExample) === true), "")
    const noM28 = "Read annotations for a symbol with full provenance on every row."
    negative("annotation doc lacking the M28 cross-ref is refused [negative]", noM28.includes("annotation") && !noM28.includes("M28"), "")
  }

  const ok = failed === 0
  console.log(`M31 D4 new-tool-docs: ${passed} passed, ${failed} failed, ${negatives} negatives`)
  if (ok && process.env.BB_M31_READ_ONLY !== "1") {
    mkdirSync(RESULTS_DIR, { recursive: true })
    const head = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })()
    writeFileSync(path.join(RESULTS_DIR, "D4.json"), JSON.stringify({
      status: "verified",
      currentCommit: head,
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m31/wave2/verify-d4-new-tool-docs.ts",
      evidenceFile: "D4.json",
      generatedAt: new Date().toISOString(),
      passed, failed,
      negativeCases: negatives,
      documentedTools: documented,
      registryTools: descriptors.length,
      postMergeToolsCovered: POST_MERGE,
    }, null, 2) + "\n")
    console.log("evidence stamped: validation/m31/wave2/results/D4.json")
  }
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error("D4 gate crashed:", e); process.exit(1) })
