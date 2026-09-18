// script/m59/probe-cap-real-corpus.ts — M59.A12 (#888), real corpus leg
//
// The fixture gate proves the mechanism; this proves it on code nobody wrote for
// the test. For real repos:
//   1. index a slice,
//   2. find the symbols with the MOST stored call sites (independent SQL),
//   3. ask `bb_graph` through the real wire,
//   4. compare what the tool DECLARED (truncated / edgeLimit / callersIfUncapped)
//      with the independent count.
//
// The two numbers come from different places on purpose: the tool's number comes
// out of the traversal, the check comes out of a standalone COUNT over the same
// database. They must agree, and the tool must never present the returned floor
// as the total.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS = "$HOME/fixtures/repositories"
const DATA_ROOT = mkdtempSync(path.join(tmpdir(), "m59-capcorpus-data-"))
process.env.BB_DATA_DIR = DATA_ROOT

const LANES = [
  { lang: "scala", repo: "cats-effect", ext: ".scala" },
  { lang: "java", repo: "clojure", ext: ".java" },
] as const
const CAP = Number(process.argv.find((a) => a.startsWith("--files="))?.split("=")[1] ?? 150)
const TOP_N = 4

function walk(root: string, ext: string, cap: number): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length && out.length < cap) {
    const dir = stack.pop()!
    let entries: string[] = []
    try { entries = [...readdirSync(dir)].sort() } catch { continue }
    for (const e of entries) {
      if (out.length >= cap) break
      if ([".git", "node_modules", "target", "dist", "build", "vendor"].includes(e)) continue
      const p = path.join(dir, e)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) stack.push(p)
      else if (p.endsWith(ext)) out.push(p)
    }
  }
  return out
}

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
  const { PUBLIC_TOOL_DESCRIPTORS } = await import(path.join(ROOT, "src/mcp/tool-registry.ts"))
  const { validateToolArguments } = await import(path.join(ROOT, "src/mcp/tool-validation.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

  const handlers: any = createToolHandlers()
  const descriptors = new Map<string, any>((PUBLIC_TOOL_DESCRIPTORS as any[]).map((d) => [d.name, d]))
  const call = async (name: string, args: any, ctx: any) => {
    try {
      const r: any = await handlers[name](validateToolArguments(descriptors.get(name), args), ctx)
      const text = (Array.isArray(r?.content) ? r.content : []).map((b: any) => String(b?.text ?? "")).join("\n")
      let parsed: any = null
      try { parsed = JSON.parse(text) } catch {}
      return { isError: r?.isError === true, parsed, text }
    } catch (e: any) {
      return { isError: true, parsed: null, text: `error: ${e?.message}` }
    }
  }

  const results: any[] = []
  for (const lane of LANES) {
    const proj = mkdtempSync(path.join(tmpdir(), `m59-capcorpus-${lane.lang}-`))
    mkdirSync(path.join(proj, "src"), { recursive: true })
    const files = walk(path.join(CORPUS, lane.repo), lane.ext, CAP)
    files.forEach((f, i) => writeFileSync(path.join(proj, `src/f${String(i).padStart(3, "0")}${lane.ext}`), readFileSync(f, "utf8")))
    writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: `slice-${lane.lang}`, version: "1.0.0" }))
    const pid = getProjectId(proj) as any
    await indexProjectParallel(pid, proj, {})
    const ctx = { projectId: pid, projectPath: proj }
    const db: any = await BrainDatabase.getRawInstance(pid)

    // Independent SQL: the symbols with the most stored call sites, and the
    // count of the rows the traversal's own query would consider (same joins).
    const top: any[] = db
      .prepare(
        `SELECT s.name name, s.id sid, COUNT(*) n
         FROM brain_relationship r JOIN brain_symbol s ON s.id = r.target_symbol_id AND s.project_id = r.project_id
         WHERE r.relationship_type IN ('calls','call')
         GROUP BY s.id HAVING n > 200 ORDER BY n DESC LIMIT ${TOP_N}`,
      )
      .all()

    for (const t of top) {
      const independent: any = db
        .prepare(
          `SELECT COUNT(*) n FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id
           JOIN brain_file f ON f.id = s.file_id
           WHERE r.relationship_type IN ('calls','call') AND r.target_symbol_id = ?`,
        )
        .get(t.sid)
      const res = await call("bb_graph", { symbol: t.name, maxDepth: 1 }, ctx)
      const s = res.parsed?.summary ?? {}
      const edges: any[] = res.parsed?.callers ?? []
      results.push({
        lang: lane.lang,
        symbol: t.name,
        independentSqlCount: independent?.n ?? null,
        storedTargetCount: t.n,
        tool: {
          returnedEdges: edges.length,
          truncated: s.truncated,
          truncationReason: s.truncationReason ?? null,
          edgeLimit: s.edgeLimit ?? null,
          callersIfUncapped: s.callersIfUncapped ?? null,
          totalCallers: s.totalCallers ?? null,
        },
        declaredTotalMatchesIndependent: s.callersIfUncapped === (independent?.n ?? null),
        floorNotPresentedAsTotal: s.truncated === true ? s.callersIfUncapped !== s.totalCallers : true,
      })
    }
    // Symbols under the cap must NOT be declared truncated — recorded once per
    // lane so the probe also carries a negative.
    const small: any = db
      .prepare(
        `SELECT s.name name, COUNT(*) n FROM brain_relationship r
         JOIN brain_symbol s ON s.id = r.target_symbol_id AND s.project_id = r.project_id
         WHERE r.relationship_type IN ('calls','call')
         GROUP BY s.id HAVING n BETWEEN 1 AND 20 ORDER BY n DESC LIMIT 1`,
      )
      .get()
    if (small) {
      const res = await call("bb_graph", { symbol: small.name, maxDepth: 1 }, ctx)
      results.push({
        lang: lane.lang,
        symbol: small.name,
        storedTargetCount: small.n,
        negative: true,
        tool: {
          returnedEdges: (res.parsed?.callers ?? []).length,
          truncated: res.parsed?.summary?.truncated ?? null,
          callersIfUncapped: res.parsed?.summary?.callersIfUncapped ?? null,
        },
        declaredTotalMatchesIndependent: true,
        floorNotPresentedAsTotal: res.parsed?.summary?.truncated === false,
      })
    }
  }

  const out = {
    probe: "M59.A12 (#888) — declared cap and true total on real repos",
    at: new Date().toISOString(),
    command: `npx tsx script/m59/probe-cap-real-corpus.ts --files=${CAP}`,
    corpus: LANES.map((l) => `${l.lang}:${l.repo}@${CAP}files`),
    results,
    allTotalsAgree: results.filter((r) => !r.negative).every((r) => r.declaredTotalMatchesIndependent),
    allFloorsLabelled: results.every((r) => r.floorNotPresentedAsTotal),
  }
  const OUT = path.join(ROOT, "validation/m59/results/cap-real-corpus.json")
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
