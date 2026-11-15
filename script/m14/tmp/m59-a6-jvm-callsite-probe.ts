// #824 probe (JVM half) — does the line the JVM analyzers now emit survive the
// store and reach `graphTraversal`, on a real index? Derived expectation comes
// from the fixture's own source lines, never from the pipeline.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const JAVA = [
  "package p;", // 1
  "", // 2
  "public class Chain {", // 3
  "  static int gamma() { return 1; }", // 4
  "", // 5
  "  static int beta() {", // 6
  "    int t = 1;", // 7
  "    return gamma() + t;", // 8
  "  }", // 9
  "}", // 10
].join("\n")

const SCALA = [
  "object Chain2 {", // 1
  "  def gamma(): Int = 1", // 2
  "", // 3
  "  def beta(): Int = {", // 4
  "    val t = 1", // 5
  "    gamma() + t", // 6
  "  }", // 7
  "}", // 8
].join("\n")

async function run(dir: string, rel: string, source: string, caller: string, callee: string): Promise<void> {
  const ws = mkdtempSync(path.join(tmpdir(), "m59-a6j-ws-"))
  const dataDir = mkdtempSync(path.join(tmpdir(), "m59-a6j-data-"))
  mkdirSync(path.join(ws, path.dirname(rel)), { recursive: true })
  writeFileSync(path.join(ws, rel), source)
  process.env.BB_DATA_DIR = dataDir

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))

  const projectId = getProjectId(ws)
  await indexProjectParallel(projectId, ws, {})

  const expected = source
    .split("\n")
    .findIndex((l) => l.includes(`${callee}()`)) + 1
  const g: any = await graphTraversal(projectId, caller, { direction: "callees", maxDepth: 3 })
  const edge = (g.callees ?? []).find((e: any) => g.nodes?.[e.to]?.name === callee)
  const { Database } = await import("bun:sqlite")
  const db = new Database(path.join(dataDir, "projects", projectId, "brain.db"), { readonly: true })
  const stored = db
    .query("SELECT line_number ln FROM brain_relationship WHERE relationship_type='calls'")
    .all() as any[]
  db.close()

  console.log(
    `${dir}: ${caller}->${callee} tool.callSite.line=${JSON.stringify(edge?.callSite?.line)} expected=${expected} | stored calls lines=${JSON.stringify(stored.map((s) => s.ln))}`,
  )
  rmSync(ws, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
}

await run("java", path.join("src", "Chain.java"), JAVA, "beta", "gamma")
await run("scala", path.join("src", "Chain2.scala"), SCALA, "beta", "gamma")
