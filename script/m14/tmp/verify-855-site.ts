// Verify the #855 SITE directly (the aggregate callee audit no longer draws
// `liftF` into its top-12, so the aggregate cannot speak for it):
//   1. the row at TimeT.scala:148 must exist with a RESOLVABLE source
//   2. bb_graph's callers answer for `liftF` must include line 148
//   3. name the source symbol it was attributed to, and its metadata
import * as fs from "fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const FILE_REL = "kernel-testkit/shared/src/main/scala/cats/effect/kernel/testkit/TimeT.scala"
const REPO = "/home/ishaq2321/bb_tests/repositories/cats-effect"

const dirs = fs
  .readdirSync("/tmp")
  .filter((d) => d.startsWith("m59-acc-data-"))
  .map((d) => `/tmp/${d}`)
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
console.log(`candidate data dirs: ${dirs.slice(0, 3).join(", ")}`)

const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
const pid = getProjectId(REPO) as any

for (const dir of dirs.slice(0, 4)) {
  const dbPath = path.join(dir, "projects", pid, "brain.db")
  if (!fs.existsSync(dbPath)) {
    console.log(`   ${dir}: no index for this repo`)
    continue
  }
  process.env.BB_DATA_DIR = dir
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const craw: any = await BrainDatabase.getRawInstance(pid)
  console.log(`\n===== ${dir}`)

  const rows = craw
    .prepare(
      `SELECT r.id, r.line_number ln, r.source_symbol_id ss, r.source_external se, r.target_symbol_id ts, r.metadata md,
              s.name sname, s.line_start sline
       FROM brain_relationship r
       LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
       LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
       WHERE r.id LIKE '%TimeT.scala%' AND r.line_number = 148`,
    )
    .all()
  console.log(`   rows at TimeT.scala:148: ${rows.length}`)
  for (const r of rows)
    console.log(
      `      ${r.id.split(":").slice(-3).join(":")} | src=${r.sname ?? "NULL"}(L${r.sline ?? "-"}) src_ext=${r.se ?? "-"} tgt=${r.ts ? "resolved" : "NULL"} meta=${r.md ?? "-"}`,
    )

  // the tool's own answer
  try {
    const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))
    const t: any = await graphTraversal(pid, "liftF", {})
    const direct = (t.callers ?? []).filter((x: any) => (x.depth ?? 0) === 0)
    const sites = direct.map((x: any) => `${x.callSite?.file?.split("/").slice(-1)[0]}:${x.callSite?.line}`)
    console.log(`   tool: root=${String(t.root?.name ?? t.root?.id).split(":").slice(-2).join(":")} direct callers=${direct.length}`)
    console.log(`   tool sites: ${JSON.stringify(sites)}`)
    const timeTSites = direct
      .filter((x: any) => String(x.callSite?.file ?? "").includes("TimeT.scala"))
      .map((x: any) => x.callSite?.line)
      .sort((a: any, b: any) => a - b)
    console.log(`   >>> TimeT.scala sites reported by the tool: ${JSON.stringify(timeTSites)}  (source has 56,60,130,148)`)
  } catch (e: any) {
    console.log(`   graphTraversal failed: ${e?.message}`)
  }
}
