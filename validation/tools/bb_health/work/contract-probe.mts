// Phase A contract probe: every bb_health option/mode/refusal through the real
// validation layer + the split handler, on an isolated fixture. Records what the
// tool actually does (not what the descriptor says).
import { mkdirSync, writeFileSync, rmSync, appendFileSync } from "node:fs"
import path from "node:path"
import { descriptor } from "../../../../src/mcp/tools/bb_health/descriptor"
import { handler } from "../../../../src/mcp/tools/bb_health/handler"
import { validateToolArguments } from "../../../../src/mcp/tool-validation"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"

const REPO = path.resolve(import.meta.dirname ?? ".", "../../../..")
const work = path.join(REPO, "validation/tools/bb_health/work")
const proj = path.join(work, "proj-matrix")
const projectId = getProjectId(proj)

mkdirSync(path.join(proj, "src"), { recursive: true })
for (let i = 0; i < 5; i++) writeFileSync(path.join(proj, "src", `f${i}.ts`), `export function fn${i}(): number { return ${i} }\n`)
await indexProjectParallel(projectId as any, proj, {})
const ctx = { projectPath: proj, projectId }

type Row = { case: string; args: unknown; validation: "ok" | "refused"; refusal?: string; isError?: boolean; healthy?: boolean; textHead?: string; notes?: string }
const rows: Row[] = []

async function run(name: string, args: Record<string, unknown>, opts: { skipValidate?: boolean } = {}) {
  const row: Row = { case: name, args }
  let validated: Record<string, unknown> | null = null
  try {
    validated = validateToolArguments(descriptor as any, args)
    row.validation = "ok"
  } catch (e: any) {
    row.validation = "refused"
    row.refusal = String(e?.message ?? e)
    rows.push(row)
    return row
  }
  try {
    const res: any = await handler(validated!, ctx)
    row.isError = res?.isError === true
    row.healthy = res?.healthy
    row.textHead = String((res?.content ?? []).map((c: any) => c.text ?? "").join("\n")).slice(0, 160).replace(/\n/g, " | ")
  } catch (e: any) {
    row.isError = true
    row.textHead = `THROWN: ${String(e?.message ?? e)}`
  }
  rows.push(row)
  return row
}

// ── contract matrix ─────────────────────────────────────────────────────────
await run("default", {})
await run("verbose", { verbose: true })
await run("history", { history: true, limit: 5 })
await run("history limit=0", { history: true, limit: 0 })
await run("limit without history (accepted and ignored?)", { limit: 5 })
await run("wait:false without refresh (accepted and ignored?)", { wait: false })
await run("sampleSize with freshness=complete (accepted and ignored?)", { freshness: "complete", sampleSize: 3 })
await run("sampleSize=0", { sampleSize: 0 })
await run("freshness=bogus", { freshness: "bogus" })
await run("unknown option complete=true", { complete: true } as any)
await run("includeAnalysisRuns", { includeAnalysisRuns: true })
await run("integrity", { integrity: true })
await run("checkUnindexed", { checkUnindexed: true })
await run("paths empty", { paths: [] })
await run("paths 51 entries", { paths: Array.from({ length: 51 }, (_, i) => `src/f${i}.ts`) })
await run("paths duplicate", { paths: ["src/f0.ts", "src/f0.ts"] })
await run("paths escape", { paths: ["../outside.ts"] })
await run("paths absolute in-project", { paths: [path.join(proj, "src/f1.ts")] })

// paths: five-state fixture
writeFileSync(path.join(proj, "src", "f0.ts"), "export function fn0(): number { return 99 }\n") // stale
rmSync(path.join(proj, "src", "f1.ts")) // indexed then deleted -> gone
writeFileSync(path.join(proj, "src", "new.ts"), "export function brandNew(): number { return 1 }\n") // not-indexed
const fiveState = await run("paths five-state", { paths: ["src/f2.ts", "src/f0.ts", "src/f1.ts", "src/new.ts", "does/not/exist.ts"] })
if (fiveState.textHead) {
  // capture the raw JSON block for detail
  const res: any = await handler({ paths: ["src/f2.ts", "src/f0.ts", "src/f1.ts", "src/new.ts", "does/not/exist.ts"] }, ctx)
  fiveState.notes = String((res?.content ?? []).map((c: any) => c.text ?? "").join("\n")).split("\n").slice(0, 9).join(" | ")
}

// refresh matrix (mutates only the isolated fixture)
await run("refresh wait=true", { refresh: true })
await run("wait:false without refresh, second sample", { wait: true })
await run("force wait=false (detached, fixture only)", { force: true, wait: false })

console.log(JSON.stringify({ descriptorModes: descriptor.modes, cases: rows }, null, 2))
