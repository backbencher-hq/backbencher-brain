// script/m59/probe-line-absence-by-language.ts — M59.A7 (#825) clarification
//
// What "13 lanes are not resolved" MEANS, demonstrated end to end on real code
// from the corpus, in two independent layers:
//
//   LAYER 1 (analyzer): parse real files, count relationships that carry a
//           call-site line. This is the emission itself — no DB, no tool.
//   LAYER 2 (tool): index a real slice, ask `bb_graph` for a real function's
//           callers through the real MCP wire, and print the line each caller
//           reports. If layer 1 emits nothing, layer 2 can only be null.
//
// Languages compared: python (declared unlined) vs java (declared lined), so the
// difference is visible side by side rather than asserted.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS = "$HOME/fixtures/repositories"
const DATA_ROOT = mkdtempSync(path.join(tmpdir(), "m59-noline-data-"))
process.env.BB_DATA_DIR = DATA_ROOT

const LANES = [
  { lang: "python", repo: "requests", ext: ".py", expect: "unlined" },
  { lang: "rust", repo: "ripgrep", ext: ".rs", expect: "unlined" },
  { lang: "go", repo: "go-tools", ext: ".go", expect: "unlined" },
  { lang: "java", repo: "clojure", ext: ".java", expect: "lined" },
  { lang: "scala", repo: "cats-effect", ext: ".scala", expect: "lined" },
] as const

function walk(root: string, ext: string, cap: number): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length && out.length < cap) {
    const dir = stack.pop()!
    let entries: string[] = []
    try { entries = [...readdirSync(dir)].sort() } catch { continue }
    for (const e of entries) {
      if (out.length >= cap) break
      if ([".git", "node_modules", "target", "dist", "build", "vendor", "third_party"].includes(e)) continue
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
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
  const { PUBLIC_TOOL_DESCRIPTORS } = await import(path.join(ROOT, "src/mcp/tool-registry.ts"))
  const { validateToolArguments } = await import(path.join(ROOT, "src/mcp/tool-validation.ts"))

  const handlers: any = createToolHandlers()
  const descriptors = new Map<string, any>((PUBLIC_TOOL_DESCRIPTORS as any[]).map((d) => [d.name, d]))
  const call = async (name: string, args: any, ctx: any) => {
    try {
      const r: any = await handlers[name](validateToolArguments(descriptors.get(name), args), ctx)
      return (Array.isArray(r?.content) ? r.content : []).map((b: any) => String(b?.text ?? "")).join("\n")
    } catch (e: any) {
      return `error: ${e?.message}`
    }
  }

  const results: any[] = []

  // ── LAYER 1: what the analyzer emits ──────────────────────────────────────
  const analyzer: Record<string, any> = {}
  for (const lane of LANES) {
    const files = walk(path.join(CORPUS, lane.repo), lane.ext, 40)
    let rels = 0
    let withLine = 0
    const noLineExamples: string[] = []
    for (const f of files) {
      let res: any
      try { res = await ASTEngine.parseFile(f, readFileSync(f, "utf8")) } catch { continue }
      for (const r of res?.relationships ?? []) {
        rels++
        if (typeof r.line_number === "number" && r.line_number > 0) withLine++
        else if (noLineExamples.length < 2) noLineExamples.push(`${f.replace(CORPUS + "/", "")}: ${String(r.source ?? r.from ?? "?")} → ${String(r.target ?? r.to ?? "?")} (${String(r.type ?? "")})`)
      }
    }
    analyzer[lane.lang] = { filesParsed: files.length, relationships: rels, withLine, coveragePct: rels ? Number(((withLine / rels) * 100).toFixed(1)) : null, noLineExamples }
  }

  // ── LAYER 2: what the tool answers, on an indexed slice ───────────────────
  const tool: Record<string, any> = {}
  for (const lane of LANES) {
    const proj = mkdtempSync(path.join(tmpdir(), `m59-noline-${lane.lang}-`))
    mkdirSync(path.join(proj, "src"), { recursive: true })
    const files = walk(path.join(CORPUS, lane.repo), lane.ext, 60)
    const copied = new Map<string, string>()
    files.forEach((f, i) => {
      const rel = `src/f${String(i).padStart(3, "0")}${lane.ext}`
      writeFileSync(path.join(proj, rel), readFileSync(f, "utf8"))
      copied.set(rel, f)
    })
    writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: `slice-${lane.lang}`, version: "1.0.0" }))
    const pid = getProjectId(proj) as any
    await indexProjectParallel(pid, proj, {})
    const ctx = { projectId: pid, projectPath: proj }

    // Pick the symbol that RECEIVES the most calls in the slice, from the DB
    // itself — so the question put to the tool is one the index can answer.
    // (Picking by text regex chose junk names like `u`/`get`, which is an
    // instrument defect, not a finding: the tool was asked about nothing.)
    const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
    const db: any = await BrainDatabase.getRawInstance(pid)
    const top: any = db
      .prepare(
        `SELECT s.name name, COUNT(*) c
         FROM brain_relationship r JOIN brain_symbol s ON s.id = r.target_symbol_id
         WHERE r.relationship_type IN ('calls','call')
         GROUP BY s.name ORDER BY c DESC LIMIT 1`,
      )
      .get()
    const stored: any = db
      .prepare(
        `SELECT COUNT(*) total, SUM(CASE WHEN r.line_number > 0 THEN 1 ELSE 0 END) withLine
         FROM brain_relationship r
         JOIN brain_symbol src ON src.id = r.source_symbol_id
         JOIN brain_file f ON f.id = src.file_id
         WHERE r.relationship_type IN ('calls','call')`,
      )
      .get()
    if (!top) { tool[lane.lang] = { storedCallEdges: stored, error: "no call edges in the slice" }; continue }

    const raw = await call("bb_graph", { symbol: top.name, maxDepth: 1 }, ctx)
    let parsed: any = null
    try { parsed = JSON.parse(raw) } catch {}
    const edges: any[] = parsed?.callers ?? []
    const withLine = edges.filter((e) => e?.callSite?.line !== null && e?.callSite?.line !== undefined).length
    tool[lane.lang] = {
      storedCallEdges: { total: stored?.total ?? null, withLine: stored?.withLine ?? null },
      question: `bb_graph { symbol: "${top.name}", maxDepth: 1 } (${top.c} stored call edges target it)`,
      callerEdgesReturned: edges.length,
      callerEdgesWithRealLine: withLine,
      firstFourLines: edges.slice(0, 4).map((e) => e?.callSite?.line ?? null),
      head: raw.replace(/\s+/g, " ").slice(0, 180),
    }
  }

  const out = { probe: "M59.A7 — line emission vs tool answer, real corpus, per language", at: new Date().toISOString(), dataDir: DATA_ROOT, analyzerLayer: analyzer, toolLayer: tool }
  const OUT = path.join(ROOT, "validation/m59/results/probe-line-absence-by-language.json")
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
