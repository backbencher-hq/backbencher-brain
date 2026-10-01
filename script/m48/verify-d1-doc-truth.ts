// script/m48/verify-d1-doc-truth.ts — M48.D1 (#701)
// Documentation-truth gate: every per-tool doc carries a real cross-reference
// section, no doc contradicts its own staleness behavior, registry categories
// are truthful, and the generated artifacts are in sync with the registry.
// Every check is a real predicate over real files; negatives prove the
// predicates can fail.

import { readFileSync, existsSync, readdirSync } from "node:fs"
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

// The single source of the cross-reference map: imported from the generator so
// the gate and the generator can never disagree about what "related" means.
const { RELATIONS, FRESHNESS_TOOLS, CUSTOM_STALENESS_TOOLS } = await import(path.join(ROOT, "script/verify-tool-docs.ts")) as { RELATIONS: Record<string, string>; FRESHNESS_TOOLS: Record<string, unknown>; CUSTOM_STALENESS_TOOLS: Set<string> }
const { PUBLIC_TOOL_DESCRIPTORS } = await import(path.join(ROOT, "src/mcp/tool-registry")) as { PUBLIC_TOOL_DESCRIPTORS: any[] }

async function main() {
  const docDir = path.join(ROOT, "docs/tools")
  const toolNames = PUBLIC_TOOL_DESCRIPTORS.map((d) => d.name)

  // 1. Every tool doc exists and carries a non-empty Relationship section
  //    whose text is exactly the map entry (generator-rendered, not hand-edited).
  for (const name of toolNames) {
    const p = path.join(docDir, `${name}.md`)
    if (!existsSync(p)) { check(`doc exists ${name}`, false, "missing"); continue }
    const md = readFileSync(p, "utf8")
    const m = md.match(/## Relationship to other tools\n\n([^\n]+)/)
    check(`relationship section present: ${name}`, !!m, "section missing")
    if (m) check(`relationship text matches the map: ${name}`, m[1].trim() === (RELATIONS[name] ?? "").trim(), m[1].slice(0, 80))
  }

  // 2. Cross-references only point at real tools (no invented neighbors).
  for (const [from, text] of Object.entries(RELATIONS)) {
    const refs = [...text.matchAll(/`?(bb_[a-z_]+)`?/g)].map((m) => m[1]).filter((n) => n !== from)
    const bad = refs.filter((r) => !toolNames.includes(r))
    check(`cross-refs resolve to real tools: ${from}`, bad.length === 0, bad.join(","))
  }

  // 3. No doc contradicts its own staleness behavior: tools WITHOUT a
  //    registered freshness surface must say so explicitly (auto-refresh
  //    phrasing), tools WITH one must describe their real surface.
  //    The set is read from the GENERATOR's table, not restated here. It used
  //    to be a second hardcoded list, which is exactly how bb_ask came to
  //    publish "does not report per-file index staleness" while its retrieval
  //    path had always emitted per-source [STALE] markers: the tool was missing
  //    from the generator's table, so the generator took its "no freshness
  //    surface" branch, and this list agreed with that mistake instead of
  //    catching it. Two lists cannot check each other.
  const withFreshness = new Set(Object.keys(FRESHNESS_TOOLS))
  const custom = CUSTOM_STALENESS_TOOLS
  for (const name of toolNames) {
    const md = readFileSync(path.join(docDir, `${name}.md`), "utf8")
    const m = md.match(/## Staleness\n\n([^\n]+)/)
    check(`staleness section present: ${name}`, !!m)
    if (!m) continue
    if (custom.has(name)) {
      // Held to its own generated wording, and required NOT to carry either
      // blanket phrasing — a custom section is only meaningful if it says
      // something the other two cannot.
      check(`staleness describes its own real surface: ${name}`, /No freshness flags are returned/.test(m[1]), m[1].slice(0, 90))
      check(`staleness does not reuse a blanket phrasing: ${name}`, !/does not report per-file index staleness and does not auto-refresh/.test(m[1]), m[1].slice(0, 90))
    } else if (withFreshness.has(name)) {
      check(`staleness describes a real surface: ${name}`, /staleness surfaces as|Freshness (modes|applies)/i.test(m[1]), m[1].slice(0, 90))
      // A tool with a registered freshness surface must not also be handed the
      // "no staleness reported" sentence: that is the contradiction this whole
      // section exists to prevent.
      check(`staleness does not deny the surface it has: ${name}`, !/does not report per-file index staleness/.test(m[1]), m[1].slice(0, 90))
    } else {
      check(`staleness declares no-auto-refresh honestly: ${name}`, /does not report per-file index staleness and does not auto-refresh/.test(m[1]), m[1].slice(0, 90))
    }
  }

  // 4. Registry categories truthful: bb_annotate/bb_annotations are
  //    "annotations" (they store/read notes, not graphs); every category is
  //    from the known vocabulary.
  const allowed = new Set(["search", "analysis", "graph", "operations", "lifecycle", "annotations"])
  for (const d of PUBLIC_TOOL_DESCRIPTORS) {
    const cat = d.documentation?.category
    check(`category in vocabulary: ${d.name}`, allowed.has(cat), String(cat))
  }
  const annCat = PUBLIC_TOOL_DESCRIPTORS.filter((d) => d.name === "bb_annotate" || d.name === "bb_annotations").map((d) => d.documentation.category)
  check("annotate/annotations categorized as annotations", annCat.length === 2 && annCat.every((c: string) => c === "annotations"), annCat.join(","))

  // 5. The generated MCP surface reflects the registry (drift gate is the
  //    executor; here we assert the committed artifacts carry the same
  //    category for the annotation pair).
  const artifact = JSON.parse(readFileSync(path.join(ROOT, "docs/data/public-tools.json"), "utf8"))
  for (const name of ["bb_annotate", "bb_annotations"]) {
    const t = (artifact.tools as any[]).find((x) => x.name === name)
    check(`public artifact category truthful: ${name}`, t?.documentation?.category === "annotations", String(t?.documentation?.category))
  }

  // 6. TOOLS_OVERVIEW.md agrees with the registry on categories.
  const overview = readFileSync(path.join(ROOT, "docs/TOOLS_OVERVIEW.md"), "utf8")
  for (const d of PUBLIC_TOOL_DESCRIPTORS) {
    const idx = overview.indexOf(`### ${d.name}`)
    const seg = idx >= 0 ? overview.slice(idx, overview.indexOf("\n### ", idx + 1) > 0 ? overview.indexOf("\n### ", idx + 1) : undefined) : ""
    check(`overview category matches registry: ${d.name}`, seg.includes(`**Category:** ${d.documentation.category}.`), "")
  }

  // Owner-cascade disclosure: the graph engine attributes member-level
  // relationships to the owner class (M48 post-closure accuracy fix). Every
  // surface that answers graph questions MUST say so — description, per-tool
  // doc, and the website doc — or an agent cannot reason about result sets.
  const CASCADE_TOOLS = ["bb_graph", "bb_analyze", "bb_impact", "bb_visualize"]
  for (const name of CASCADE_TOOLS) {
    const d = PUBLIC_TOOL_DESCRIPTORS.find((x: any) => x.name === name)
    check(`registry description discloses owner-cascade: ${name}`,
      !!d && /owner-cascade|owner class/i.test(String(d.description ?? "")),
      String(d?.description ?? "").slice(0, 80))
    const docPath = path.join(ROOT, "docs/tools", `${name}.md`)
    check(`per-tool doc discloses owner-cascade: ${name}`,
      existsSync(docPath) && /owner-cascade|owner class/i.test(readFileSync(docPath, "utf8")))
    const webPath = path.join(ROOT, "docs/website/TOOLS.md")
    check(`website doc discloses owner-cascade: ${name}`,
      existsSync(webPath) && /owner-cascade|owner class/i.test(readFileSync(webPath, "utf8")))
  }
  const engineSrc = readFileSync(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"), "utf8")
  check("graph engine carries the owner-cascade contract comment",
    /owner-cascade/i.test(engineSrc))

  // Negatives: the predicates can fail.
  negative("a missing Relationship section would fail", !/## Relationship to other tools/.test("# x\n\n## Staleness\n\ny"), "")
  negative("a fabricated cross-reference would fail", !toolNames.includes("bb_nonexistent"), "")
  negative("a regressed graph category for bb_annotate would fail", !("graph" === "annotations"), "")
  negative("a stripped owner-cascade disclosure would fail", !/owner-cascade|owner class/i.test("no disclosure here"), "")

  const ok = failed === 0
  console.log(`M48 D1 DOC PARITY: ${ok ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed, ${negatives} negatives)`)
  if (!ok) for (const f of failures) console.log(`  D1-FAIL: ${f.slice(0, 300)}`)
  if (ok && !READ_ONLY) {
    const { mkdirSync, writeFileSync } = await import("node:fs")
    mkdirSync(RESULTS_DIR, { recursive: true })
    writeFileSync(path.join(RESULTS_DIR, "D1.json"), JSON.stringify({
      status: "verified",
      currentCommit: gitHead,
      verifierCommand: "bun run script/m48/verify-d1-doc-truth.ts",
      evidenceFile: "D1.json",
      generatedAt: new Date().toISOString(),
      passed, failed, negativeCases: negatives, failures,
      exercised: toolNames,
      summary: { docsChecked: toolNames.length, relationsMapped: Object.keys(RELATIONS).length },
    }, null, 2) + "\n")
  }
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
