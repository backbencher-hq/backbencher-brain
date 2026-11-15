// Author: Muhammad Ishaq Khan
// WHAT THIS FILE IS — index the T0 (polyglot) and T1 (n100 scale) fixtures into
// this tool's own data directory, once, so a latency run measures calls rather
// than indexing and never touches the shared reference index.
// WHICH TOOL IT SERVES — bb_graph (read, requiresIndex true, modes: graph).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_graph/results/index-fixtures.json.
// CONTRACTS IT MUST NOT BREAK — writes only under BB_DATA_DIR (this tool's
// validation data directory); never the shared reference index.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../../src/util/project-id"
import { indexProjectParallel } from "../../../src/ast/parallel-indexer"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const FIR = [
  ["T0", path.join(ROOT, "test/fixtures/polyglot")],
  ["T1", path.join(ROOT, ".perf-fixtures/bb-scale/n100")],
] as const
const out: any[] = []
const quiet = { log: () => {}, write: () => {}, error: () => {} }
for (const [tier, fixture] of FIR) {
  const pid = getProjectId(fixture)
  const started = performance.now()
  await indexProjectParallel(pid as any, fixture, { logger: quiet as any })
  out.push({ tier, fixture: path.relative(ROOT, fixture), projectId: pid, indexMs: Math.round(performance.now() - started) })
  console.log(`${tier}: ${pid} indexed in ${out[out.length - 1].indexMs} ms`)
}
mkdirSync(path.join(ROOT, "validation/tools/bb_graph/results"), { recursive: true })
writeFileSync(path.join(ROOT, "validation/tools/bb_graph/results/index-fixtures.json"), JSON.stringify({ dataDir: process.env.BB_DATA_DIR, runs: out }, null, 2))
