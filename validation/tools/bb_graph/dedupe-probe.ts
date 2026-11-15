// Author: Muhammad Ishaq Khan
// WHAT THIS FILE IS — the fixture probe for the same-line, two-member call
// collapse: does one source line calling two members of one class emit two
// caller edges (each naming its member) or one collapsed "spelling variant"?
// WHICH TOOL IT SERVES — bb_graph (read, requiresIndex true, modes: graph).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_graph/results/dedupe-probe.json.
// CONTRACTS IT MUST NOT BREAK — writes only a temp fixture and its own data dir.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../../src/util/project-id"
import { indexProjectParallel } from "../../../src/ast/parallel-indexer"
import { createToolHandlers } from "../../../src/mcp/tool-handlers"

process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "bb-graph-dedupe-"))
const root = mkdtempSync(path.join(tmpdir(), "bb-graph-dedupe-fx-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(
  path.join(root, "src", "multi.ts"),
  "export class Multi {\n  a(): number { return 1 }\n  b(): number { return 2 }\n}\n" +
    "export function sameLineCaller(m: Multi): number {\n  return m.a() + m.b()\n}\n",
)
const pid = getProjectId(root) as any
const quiet = { log: () => {}, write: () => {}, error: () => {} } as any
await indexProjectParallel(pid, root, { logger: quiet })
const handlers = createToolHandlers() as any
const result = await handlers.bb_graph({ symbol: "Multi", direction: "callers", maxDepth: 1, relationshipTypes: ["calls"] }, { projectId: pid, projectPath: root })
const json = JSON.parse(result.content[0].text)
const out = {
  callers: json.callers.length,
  matchedMembers: json.callers.map((e: any) => e.matchedMember?.name ?? null),
  spellingVariantsCollapsed: json.summary.dedupedAtToolLayer.spellingVariantsCollapsed,
  cascadeRepeatsCollapsed: json.summary.dedupedAtToolLayer.cascadeRepeatsCollapsed,
  exactCallers: json.summary.exactCallers,
  cascadedCallers: json.summary.cascadedCallers,
}
writeFileSync(path.join(process.cwd(), "validation/tools/bb_graph/results/dedupe-probe.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify(out))
rmSync(root, { recursive: true, force: true })
rmSync(path.dirname(path.join(process.env.BB_DATA_DIR!, "projects", pid, "brain.db")), { recursive: true, force: true })
