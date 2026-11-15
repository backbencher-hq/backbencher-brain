// Phase A residual probes: inbound relationship statements, T2 project bound,
// auto-refresh file-budget decline via a file-mode directory target.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import path from "node:path"
import { TOOL_DESCRIPTORS } from "../../../../src/mcp/tool-registry"
import { validateToolArguments } from "../../../../src/mcp/tool-validation"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"

const REPO = path.resolve(import.meta.dirname, "../../../..")
const out: any[] = []
const rec = (id: string, detail: unknown) => { out.push({ id, detail }); console.log(id, "—", typeof detail === "string" ? detail : JSON.stringify(detail)) }

// (a) inbound relationship statements
{
  const root = mkdtempSync(path.join(REPO, "validation/tools/bb_doc/work", "rel-"))
  mkdirSync(path.join(root, "src"))
  writeFileSync(path.join(root, "src", "math.ts"), "export function add(a: number, b: number): number { return a + b }\n")
  writeFileSync(path.join(root, "src", "app.ts"), "import { add } from './math'\nexport function main(): number { return add(1, 2) }\n")
  const pid = getProjectId(root)
  await indexProjectParallel(pid, root, {})
  const h = createToolHandlers().bb_doc
  const r: any = await h({ mode: "symbol", target: "add", format: "json" }, { projectPath: root, projectId: pid } as any)
  const j = JSON.parse(r.content[0].text)
  const relFacts = j.sections.flatMap((s: any) => s.facts).filter((f: any) => f.citationIds.some((id: string) => (j.citations ?? []).some((c: any) => c.id === id && c.kind === "relationship")))
  rec("F1.symbol-add-relationship-facts", relFacts.map((f: any) => f.statement))
  const r2: any = await h({ mode: "symbol", target: "main", format: "json" }, { projectPath: root, projectId: pid } as any)
  const j2 = JSON.parse(r2.content[0].text)
  const rel2 = j2.sections.flatMap((s: any) => s.facts).filter((f: any) => f.citationIds.some((id: string) => (j2.citations ?? []).some((c: any) => c.id === id && c.kind === "relationship")))
  rec("F1.symbol-main-relationship-facts", rel2.map((f: any) => f.statement))
  
  rmSync(root, { recursive: true, force: true })
}
