// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the targeted mutant checks for bb_visualize: one small,
//   fast, in-process assertion per falsifiable contract, so a deliberately planted
//   defect can be shown RED before the fixed tree is shown GREEN.
// WHICH TOOL IT SERVES — bb_visualize (mutability read, requiresIndex true).
// WHY IT IS SHAPED THIS WAY — `probe.ts` drives the real door end to end, which is
//   the right final gate but too slow to run against every planted mutant; these
//   modes assert the SAME properties on the same fixture without the stdio spawn,
//   so the red-then-green table is cheap and still about the shipped code.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_visualize/results/mutants.json
//   (written by mutants.sh), validation/tools/bb_visualize/mutants.sh.
// EDIT TOGETHER WHEN THIS CHANGES — probe.ts (the same assertions on the door),
//   mutants.sh, and the engine/handler they exercise.
// CONTRACTS IT MUST NOT BREAK — writes only under validation/tools/bb_visualize/.
// ─────────────────────────────────────────────────────────────────────────────

import path from "node:path"
const HERE = path.resolve(import.meta.dirname ?? ".", ".")
process.env.BB_DATA_DIR = path.join(HERE, "bbdata")
process.env.BB_NO_AUTO_REFRESH = "1"
const mode = process.argv[2] ?? ""

const fail = (why: string) => { console.log(`CHECK FAIL (${mode}): ${why}`); process.exit(1) }
const pass = (why: string) => { console.log(`CHECK PASS (${mode}): ${why}`); process.exit(0) }

if (mode === "read-path-structural") {
  // The read-only boundary as a property of the shipped code: EVERY open the tool
  // performs passes the read-only option. A byte-comparison against a current
  // database cannot see this any more now that the opening path itself is idempotent
  // on an up-to-date index, so the falsifiable check is the call shape.
  const { readFileSync } = await import("node:fs")
  const files = ["src/intelligence/visualization/visualization-engine.ts", "src/mcp/tools/bb_visualize/handler.ts"]
  const offenders: string[] = []
  for (const file of files) {
    const source = readFileSync(path.join(HERE, "..", "..", "..", file), "utf8")
    const opens = source.match(/getRawInstance\([^)]*\)/g) ?? []
    for (const open of opens) if (!open.includes("readonly: true")) offenders.push(`${file}: ${open}`)
  }
  if (offenders.length === 0) pass("every index open in the engine and handler is read-only")
  else fail(`read-write open(s) present: ${offenders.join(" | ")}`)
}

if (mode === "read-path-engine") {
  // Spawned child so the module cache and database handle are fresh.
  const { execFileSync } = await import("node:child_process")
  const output = execFileSync(process.execPath, ["--import", "tsx", path.join(HERE, "read-path.ts"), "--child", "engine-visualize"], { cwd: path.resolve(HERE, "..", "..", ".."), encoding: "utf8", env: { ...process.env } })
  const line = output.trim().split("\n").filter((l) => l.trim().startsWith("{")).pop() ?? "{}"
  const parsed = JSON.parse(line)
  if (parsed.unchanged === true) pass("engine read left db+wal byte-identical")
  else fail(`engine read wrote the index: ${JSON.stringify(parsed.db?.[1] ?? parsed)}`)
}

const { fixtureContext, FIXTURE_DIR } = await import("./lib/fixture")
const { createToolHandlers } = await import("../../../src/mcp/tool-handlers")
const { BrainDatabase } = await import("../../../src/brain/database")
const { projectId } = await fixtureContext(FIXTURE_DIR, false)
const handlers = createToolHandlers()
const call = async (args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> => {
  const result: any = await handlers.bb_visualize(args, { projectId, projectPath: FIXTURE_DIR } as any)
  return { isError: result.isError === true, text: String(result.content?.[0]?.text ?? "") }
}

if (mode === "html-declared") {
  const { text } = await call({ format: "html" })
  if (text.includes("totalNodesAvailable") && text.includes("returnedNodes") && text.includes("declared")) pass("html payload carries the declared bounds")
  else fail("html payload lost the declared bounds")
}

if (mode === "kind-filter") {
  const { isError, text } = await call({ symbolKinds: ["class"], format: "json", maxNodes: 100 })
  if (isError) fail(`call refused: ${text.slice(0, 160)}`)
  const answer = JSON.parse(text)
  const offKind = answer.nodes.filter((node: any) => node.type !== "class")
  if (offKind.length === 0) pass(`every returned node is a class (${answer.nodes.length} nodes)`)
  else fail(`${offKind.length} non-class node(s) leaked past symbolKinds: ${offKind.map((n: any) => `${n.name}:${n.type}`).join(",")}`)
}

if (mode === "edge-complete") {
  const { isError, text } = await call({ format: "json" })
  if (isError) fail(`call refused: ${text.slice(0, 160)}`)
  const answer = JSON.parse(text)
  const raw = await BrainDatabase.getRawInstance(projectId as any, { readonly: true })
  const ids = answer.nodes.map((node: any) => String(node.id))
  const placeholders = ids.map(() => "?").join(",")
  const stored = Number((raw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id=? AND source_symbol_id IN (${placeholders}) AND target_symbol_id IN (${placeholders})`).get(projectId, ...ids, ...ids) as any)?.c ?? 0)
  const declared = Number(answer.considered.relationshipsBetweenSelectedNodes ?? -1)
  const folded = Number(answer.considered.ownerCascade?.rowsFolded ?? 0)
  if (declared >= stored && declared <= stored + folded) pass(`declared ${declared} reconciles with ${stored} stored rows + ${folded} folded`)
  else fail(`declared ${declared} does not reconcile with ${stored} stored rows + ${folded} folded (a slice of the table)`)
}

fail(`unknown mode ${mode}`)
