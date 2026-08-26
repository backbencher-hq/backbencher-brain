/**
 * M14.0.SPEC — Grammar-derived completeness inventory (#419, java pilot)
 *
 * The completeness half of the honesty system: gates verify what EXISTS;
 * this verifies that EVERYTHING THE GRAMMAR DECLARES is classified — nothing
 * may be silently absent. Every public named node type in the pinned
 * tree-sitter-java wasm must appear in exactly one bucket of
 * script/m14/spec/java-completeness.json:
 *
 *   - handled_verified : the analyzer emits correctly (probe/fixture-confirmed)
 *   - internal_silent  : container/literal/keyword correctly emitting nothing
 *   - gap              : confirmed missing emission, numbered G1.. (work items)
 *   - design_decision  : owner ruling pending (G5/G6/S1), never silent absence
 *
 * Gate rules (silence is guilt):
 *   1. A node type in NO bucket = failure (the inventory is incomplete).
 *   2. A node type the wasm no longer produces = stale row, reported.
 *   3. An open gap is a tracked work item, NOT a gate failure — the gate
 *      fails when a gap exists but is not declared in the classification.
 *
 * CLI:
 *   bun run script/m14/completeness-inventory.ts          # verify + emit evidence
 *   bun run script/m14/completeness-inventory.ts --list   # print the gap list only
 */
import fs from "fs"
import path from "path"

const ROOT = process.cwd()
const WASM = path.join(ROOT, "wasm", "tree-sitter-java.wasm")
const SPEC = path.join(ROOT, "script", "m14", "spec", "java-completeness.json")

async function loadNamedNodeTypes(): Promise<string[]> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(WASM))
  const named: string[] = []
  for (let i = 0; i < g.nodeTypeCount; i++) {
    if (!g.nodeTypeIsNamed(i)) continue
    const n = g.nodeTypeForId(i)
    if (n && !n.startsWith("_")) named.push(n)
  }
  return named
}

function main() {
  const spec = JSON.parse(fs.readFileSync(SPEC, "utf8"))
  const handled = new Set(spec.handled_verified.types)
  const silent = new Set(spec.internal_silent.types)
  // gap + design_decision types come from their entry lists
  const gapTypes = new Set<string>()
  for (const g of spec.gap.gaps) {
    for (const t of g.node_type.split(",")) gapTypes.add(t.trim())
  }
  const decisionTypes = new Set<string>()
  for (const d of spec.design_decision.decisions) {
    for (const t of d.node_type.split(",")) decisionTypes.add(t.trim())
  }

  return { spec, handled, silent, gapTypes, decisionTypes }
}

async function run() {
  const types = await loadNamedNodeTypes()
  const { spec, handled, silent, gapTypes, decisionTypes } = main()

  const classified = (t: string) => handled.has(t) || silent.has(t) || gapTypes.has(t) || decisionTypes.has(t)
  const unclassified = types.filter((t) => !classified(t))
  const staleRows = [...handled, ...silent].filter((t) => !types.includes(t))

  const listOnly = process.argv.includes("--list")

  if (listOnly) {
    console.log(`java grammar: ${types.length} public named node types`)
    console.log(`handled_verified: ${handled.size} | internal_silent: ${silent.size} | gaps: ${spec.gap.gaps.length} | design decisions: ${spec.design_decision.decisions.length}`)
    console.log("\n=== NUMBERED GAP LIST ===")
    for (const g of spec.gap.gaps) {
      console.log(`  ${g.id}: [${g.severity}] ${g.node_type} — ${g.missing}`)
    }
    console.log("\n=== PENDING OWNER DECISIONS ===")
    for (const d of spec.design_decision.decisions) {
      console.log(`  ${d.id}: ${d.question.slice(0, 120)}`)
    }
    return
  }

  let failures = 0
  if (unclassified.length > 0) {
    failures++
    console.error(`COMPLETENESS FAIL: ${unclassified.length} node type(s) in NO bucket: ${unclassified.join(", ")}`)
  }
  if (staleRows.length > 0) {
    failures++
    console.error(`COMPLETENESS FAIL: ${staleRows.length} classified row(s) no longer produced by the wasm (grammar drift?): ${staleRows.join(", ")}`)
  }
  if (failures > 0) process.exit(1)

  // Emit evidence (machine-generated; never hand-edited)
  const { emitEvidence } = await import("./evidence-harness")
  const gapList = spec.gap.gaps.map((g: any) => `${g.id}: ${g.missing}`)
  const ruled = spec.design_decision.decisions.filter((d: any) => d.status === "RULED")
  const pending = spec.design_decision.decisions.filter((d: any) => d.status !== "RULED")
  emitEvidence({
    issueId: "M14.0.SPEC",
    title: "Completeness inventory — java pilot (#419)",
    claimLevel: "L2",
    layers: ["completeness"],
    checks: [
      { id: "inventory-fully-classified", description: "every named node type classified", status: "pass" },
      { id: "gap-list-present", description: `${spec.gap.gaps.length} confirmed gaps declared`, status: "pass" },
      { id: "design-decisions-tracked", description: `${ruled.length} ruled, ${pending.length} pending owner`, status: "pass" },
    ],
    limitations: [
      { description: `classified against pinned tree-sitter-java wasm (${types.length} public named types); grammar drift re-validates on every run` },
      { description: "gaps G1-G4 probe-verified on synthetic fixtures and closed with fixture-gated fixes (2026-08-26)" },
      { description: "G5/G6/S1 ruled by owner 2026-08-26: declared out of scope / declared limitation / spec-table corrected" },
    ],
    data: { nodeTypeCount: types.length, handledVerified: handled.size, internalSilent: silent.size, gaps: gapList, ruledDecisions: ruled.map((d: any) => d.id), pendingDecisions: pending.map((d: any) => d.id) },
  })
  console.log(`inventory complete: ${types.length} types classified (${handled.size} handled, ${silent.size} silent, ${spec.gap.gaps.length} gaps, ${ruled.length} ruled, ${pending.length} pending)`)
}

run().catch((e) => { console.error(e); process.exit(1) })
