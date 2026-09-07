// script/m48/verify-w1-website-tools.ts — M48.W1 (#702)
// Machine truth gate for docs/website/TOOLS.md — the document the website
// agent publishes. Proves: 16/16 registry tools present, no phantom/dead tool
// name, planned modes visibly marked non-executable, claims matching the
// registry, and the committed file in sync with the generator output.

import { readFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m48/results")
const READ_ONLY = process.env.BB_M48_READ_ONLY === "1"

let passed = 0, failed = 0, negatives = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  if (!ok) { failed++; failures.push(`[negative] ${label}${detail ? ` — ${detail}` : ""}`) }
}

const gitHead = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })()

const PHANTOMS = ["bb_select", "bb_update", "bb_delete", "bb_insert", "bb_write", "bb_refactor", "bb_refresh", "bb_relationships", "bb_test_quality", "bb_test_suggestions"]

async function main() {
  const { PUBLIC_TOOL_DESCRIPTORS } = await import(path.join(ROOT, "src/mcp/tool-registry")) as { PUBLIC_TOOL_DESCRIPTORS: any[] }
  const { RELATIONS } = await import(path.join(ROOT, "script/verify-tool-docs")) as { RELATIONS: Record<string, string> }
  const docPath = path.join(ROOT, "docs/website/TOOLS.md")
  check("website doc exists", existsSync(docPath), "run script/m48/website-doc.ts")
  if (!existsSync(docPath)) { finish(); return }
  const doc = readFileSync(docPath, "utf8")

  // 1. Coverage: every registry tool has a section; no phantom sections.
  const sections = [...doc.matchAll(/^### `(bb_[a-z_]+)`$/gm)].map((m) => m[1])
  const regNames = PUBLIC_TOOL_DESCRIPTORS.map((d) => d.name)
  const missing = regNames.filter((n) => !sections.includes(n))
  check("16/16 registry tools documented", missing.length === 0 && sections.length === regNames.length, `missing=${missing.join(",")} sections=${sections.length}`)
  const phantomSections = sections.filter((s) => !regNames.includes(s))
  check("no phantom tool sections", phantomSections.length === 0, phantomSections.join(","))

  // 2. Dead names: the replacement-history table is the ONLY legitimate place
  //    for legacy names — every other occurrence must be inside that table.
  const historyIdx = doc.indexOf("## Replacement history")
  const historyEnd = doc.indexOf("## Same question")
  for (const p of PHANTOMS) {
    const occurrences: number[] = []
    let i = doc.indexOf(p)
    while (i >= 0) { occurrences.push(i); i = doc.indexOf(p, i + 1) }
    const outside = occurrences.filter((pos) => pos < historyIdx || pos >= historyEnd)
    check(`dead name only in history table: ${p}`, outside.length === 0, `${outside.length} outside occurrences`)
  }

  // 3. Planned modes visibly marked: for each tool with plannedModes, the
  //    doc must contain the "not executable today" marker in its section.
  for (const d of PUBLIC_TOOL_DESCRIPTORS) {
    const planned: string[] = d.plannedModes ?? []
    const idx = doc.indexOf(`### \`${d.name}\``)
    const seg = idx >= 0 ? doc.slice(idx, doc.indexOf("\n### ", idx + 1) > 0 ? doc.indexOf("\n### ", idx + 1) : undefined) : ""
    if (planned.length > 0) {
      check(`planned modes marked non-executable: ${d.name}`, /Planned \(roadmap, \*\*not executable today\*\*\)/.test(seg) && planned.every((m) => seg.includes(`\`${m}\``)), planned.join(","))
    } else {
      check(`no advertised planned modes: ${d.name}`, !/not executable today/.test(seg), "")
    }
    // Per-tool facts match the registry.
    check(`category matches registry: ${d.name}`, seg.includes(`\`${d.documentation.category}\``), "")
    check(`mutability matches registry: ${d.name}`, seg.includes(`\`${d.mutability}\``), "")
    for (const m of d.modes ?? []) check(`mode listed: ${d.name}/${m}`, seg.includes(`\`${m}\``), "")
  }

  // 4. Structure: two-door explanation, same-question guidance, website-agent
  //    instruction comment, parity claim.
  check("website-agent instruction comment present", doc.startsWith("<!--") && doc.includes("WEBSITE AGENT INSTRUCTIONS"), "")
  check("two-door explanation present", /CLI `bb`/.test(doc) && /MCP tools `bb_\*`/.test(doc), "")
  check("parity-twin claim present", /parity twins/.test(doc), "")
  check("same-question guidance present", /## Same question, which tool\?/.test(doc), "")
  check("replacement history present", /## Replacement history/.test(doc), "")

  // 5. Sync: the committed doc is byte-identical to the generator output.
  {
    const { execFileSync: ex } = await import("node:child_process")
    const before = readFileSync(docPath)
    ex("bun", ["run", "script/m48/website-doc.ts"], { cwd: ROOT, stdio: "pipe" })
    const after = readFileSync(docPath)
    check("committed doc is generator-synced", before.equals(after), "run bun run script/m48/website-doc.ts and commit")
  }

  // 6. Every relationship sentence from the map appears in the doc.
  for (const [name, rel] of Object.entries(RELATIONS)) {
    check(`relationship rendered: ${name}`, doc.includes(rel), rel.slice(0, 60))
  }

  // Negatives: synthesize corrupted worlds and prove the real predicates
  // would fail on them.
  {
    // A phantom section injected into the doc shape must break the coverage
    // predicate (sections ⊄ registry).
    const fakeSections = [...sections, "bb_select"]
    negative("a phantom section would fail coverage", fakeSections.some((s) => !regNames.includes(s)), "")
    // A section with a planned mode but no marker must fail the marker regex.
    const fakeSeg = "### `bb_fake`\n\n- Modes: `plan`\nPlanned modes: explain."
    negative("an unmarked planned mode would fail", !/Planned \(roadmap, \*\*not executable today\*\*\)/.test(fakeSeg), "")
    // A dead name appearing outside the history table must be flagged by the
    // same occurrence-scan logic the main check uses.
    const fakeDoc = "# d\n\nbb_relationships is great\n\n## Replacement history\nx\n## Same question\ny"
    const hi = fakeDoc.indexOf("## Replacement history")
    const he = fakeDoc.indexOf("## Same question")
    const pos = fakeDoc.indexOf("bb_relationships")
    negative("a dead name outside the table would fail", pos < hi || pos >= he, "")
  }

  finish()

  function finish() {
    const ok = failed === 0
    console.log(`M48 W1 WEBSITE DOC: ${ok ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed, ${negatives} negatives)`)
    if (!ok) for (const f of failures) console.log(`  W1-FAIL: ${f.slice(0, 300)}`)
    if (ok && !READ_ONLY) {
      const { mkdirSync, writeFileSync } = require("node:fs")
      mkdirSync(RESULTS_DIR, { recursive: true })
      writeFileSync(path.join(RESULTS_DIR, "W1.json"), JSON.stringify({
        status: "verified",
        currentCommit: gitHead,
        verifierCommand: "bun run script/m48/verify-w1-website-tools.ts",
        evidenceFile: "W1.json",
        generatedAt: new Date().toISOString(),
        passed, failed, negativeCases: negatives, failures,
        exercised: regNames,
        summary: { toolsDocumented: sections.length, phantomsAudited: PHANTOMS.length, bytes: doc.length },
      }, null, 2) + "\n")
    }
    process.exit(ok ? 0 : 1)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
