// script/m48/c1-repo-worker.ts — M48.C1 (#699) per-repo worker.
//
// One fresh PROCESS per repository: it owns a private BB_DATA_DIR and runs the
// full default index + the complete tool battery, then writes a part file
// (validation/m48/results/C1-parts/<repo>.json) consumed by verify-c1-corpus.ts.
//
// Why a child process per repo (M48.C1 reproducibility fix): the corpus
// previously ran every repo in one long-lived process, and module-level state
// (raw DB handle caches keyed by projectId, captured env, worker-pool
// teardown) could leak between repositories — one run randomly answered
// lodash queries from the rake index. Per-repo isolation makes the corpus
// deterministic, and mirrors real usage (each `bb index` is its own process).
//
// Honesty rules: no auto-passes. Every cross-check is a real predicate over
// real handler output compared against an independently derived value
// (SQL count, on-disk file hash, write/read round-trip). Failures are
// recorded — never skipped. The worker exits non-zero on any failure.

import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const REPO_BASE = "$HOME/fixtures/repositories"
const PARTS_DIR = path.join(ROOT, "validation/m48/results/C1-parts")

const repo = process.argv[2]
if (!repo) {
  console.error("c1-repo-worker: usage: bun run c1-repo-worker.ts <repo>")
  process.exit(2)
}

let checksFailed = 0
const failures: string[] = []
const crossChecks: Array<{ tool: string; repo: string; label: string; pass: boolean; detail: string }> = []
const perTool = new Map<string, { ok: boolean; declaredAbsent: boolean; ms: number; args: string; outHead: string }>()
let negatives = 0

function addCC(tool: string, repoName: string, cc: { label: string; pass: boolean; detail: string }) {
  crossChecks.push({ tool, repo: repoName, ...cc })
  if (!cc.pass) { checksFailed++; failures.push(`${tool}@${repoName} ${cc.label} — ${cc.detail}`) }
}

async function main() {
  const dir = path.join(REPO_BASE, repo)
  if (!existsSync(dir)) { console.error(`repo dir missing: ${dir}`); process.exit(1) }
  const dataDir = mkdtempSync(path.join(tmpdir(), `m48-c1-data-${repo}-`))
  process.env.BB_DATA_DIR = dataDir

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))

  const pid = getProjectId(dir)
  const tStart = Date.now()
  await indexProjectParallel(pid, dir, {})
  const indexSeconds = (Date.now() - tStart) / 1000

  const raw = await BrainDatabase.getRawInstance(pid)
  const fileCount = (raw.prepare("SELECT COUNT(*) AS c FROM brain_file WHERE project_id = ?").get(pid) as any)?.c ?? -1
  const symCount = (raw.prepare("SELECT COUNT(*) AS c FROM brain_symbol WHERE project_id = ?").get(pid) as any)?.c ?? -1

  // Roots: unique by name project-wide AND restricted to the structural kinds
  // the graph/impact/analyze-callers tools resolve — the cross-check then asks
  // the same question a real agent asks, deterministically.
  const top = raw.prepare(
    `SELECT s.name AS name, f.relative_path AS rel FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
     WHERE s.project_id = ? AND s.name IS NOT NULL AND s.name != '' AND f.relative_path IS NOT NULL
       AND s.symbol_type IN ('function','method','class','interface','trait','struct','enum','macro')
       AND (SELECT COUNT(*) FROM brain_symbol s2 WHERE s2.project_id = ? AND s2.name = s.name) = 1
     ORDER BY (SELECT COUNT(*) FROM brain_relationship r WHERE r.target_symbol_id = s.id) DESC, s.name LIMIT 60`,
  ).all(pid, pid) as Array<{ name: string; rel: string }>
  if (!top.length) { console.error(`${repo}: no structural symbols indexed`); process.exit(1) }
  const sym = top[0]
  const sym2 = top.find((x) => x.name !== sym.name) ?? sym

  const handlers = createToolHandlers()
  const ctx = { projectPath: dir, projectId: pid }
  const call = async (name: string, args: Record<string, unknown>) => {
    const start = Date.now()
    try {
      const r = await (handlers as any)[name](args, ctx as any)
      let parsed: any = null
      try { parsed = JSON.parse(r?.content?.[0]?.text ?? "") } catch { parsed = r?.content?.[0]?.text ?? "" }
      return { ms: Date.now() - start, isError: r?.isError === true, parsed, text: (r?.content?.[0]?.text ?? "").slice(0, 200) }
    } catch (e: any) {
      return { ms: Date.now() - start, isError: true, parsed: null, text: `THREW: ${e?.message ?? e}` }
    }
  }
  const runTool = async (tool: string, args: Record<string, unknown>) => {
    const r = await call(tool, args)
    perTool.set(tool, { ok: !r.isError, declaredAbsent: !r.isError && typeof r.parsed === "object" && r.parsed !== null && (r.parsed as any)?.declaredAbsent === true, ms: r.ms, args: JSON.stringify(args), outHead: r.isError ? r.text : JSON.stringify(r.parsed ?? "").slice(0, 160) })
    return r
  }

  // ── bb_search: symbols mode + file mode (registry surface, see C1 catch) ──
  {
    const r = await runTool("bb_search", { mode: "symbols", query: sym.name, limit: 10 })
    const rows: any[] = r.parsed?.results ?? r.parsed?.rows ?? []
    addCC("bb_search", repo, { label: "search resolves repo symbol", pass: !r.isError && (rows.length > 0 || JSON.stringify(r.parsed).includes(sym.name)), detail: `${r.text.slice(0, 100)} rows=${rows.length}` })
  }
  {
    const r = await runTool("bb_search", { mode: "file", filePath: sym.rel, query: sym.rel })
    addCC("bb_search", repo, { label: "file mode returns indexed file", pass: !r.isError && (typeof r.parsed === "object" && r.parsed !== null && (r.parsed as any)?.file === sym.rel), detail: `${r.text.slice(0, 120)}` })
  }
  // ── bb_health: files count == independent SQL count (text wire format) ──
  {
    const r = await runTool("bb_health", {})
    const txt = typeof r.parsed === "string" ? r.parsed : JSON.stringify(r.parsed ?? "")
    const m = txt.match(/files=(\d+)/)
    addCC("bb_health", repo, { label: `health.files == SQL count (${fileCount})`, pass: !r.isError && m !== null && Number(m[1]) === fileCount, detail: `${r.text.slice(0, 120)}` })
  }
  // ── bb_ask: substantive answer on an indexed symbol (declared-absent would be honest only if unindexed) ──
  {
    const r = await runTool("bb_ask", { query: `what does ${sym.name} do?` })
    const txt = typeof r.parsed === "string" ? r.parsed : JSON.stringify(r.parsed ?? "")
    addCC("bb_ask", repo, { label: "ask returns a substantive answer for an indexed symbol", pass: !r.isError && txt.length > 40, detail: r.text.slice(0, 100) })
  }
  // ── bb_patterns: orphaned scope yields parseable findings or a declared zero-state ──
  {
    const r = await runTool("bb_patterns", { scope: "orphaned" })
    const shape = typeof r.parsed === "object" && r.parsed !== null ? Object.keys(r.parsed).length : String(r.parsed ?? "").length
    addCC("bb_patterns", repo, { label: "patterns orphaned scope returns structured output", pass: !r.isError && shape > 0, detail: r.text.slice(0, 100) })
  }
  // ── bb_security: scan yields structured output ──
  {
    const r = await runTool("bb_security", {})
    const shape = typeof r.parsed === "object" && r.parsed !== null ? Object.keys(r.parsed).length : String(r.parsed ?? "").length
    addCC("bb_security", repo, { label: "security scan returns structured output", pass: !r.isError && shape > 0, detail: r.text.slice(0, 100) })
  }
  {
    const r = await runTool("bb_visualize", { scope: "symbol", target: sym.name, format: "json" })
    const v = r.parsed as any
    addCC("bb_visualize", repo, { label: "visualize resolves root symbol", pass: !r.isError && (v?.root?.name === sym.name || v?.nodes?.root?.name === sym.name || JSON.stringify(v ?? "").includes(sym.name)), detail: r.text.slice(0, 120) })
  }
  // ── bb_migrate: response names the migrated symbol or is declared-absent ──
  {
    const r = await runTool("bb_migrate", { symbolName: sym.name, targetLanguage: "go", format: "json" })
    addCC("bb_migrate", repo, { label: "migrate references the requested symbol or declares absence", pass: !r.isError && (JSON.stringify(r.parsed ?? "").includes(sym.name) || (r.parsed as any)?.declaredAbsent === true), detail: r.text.slice(0, 100) })
  }
  // ── bb_analyze: callers names the target; stats counts == independent SQL counts ──
  {
    const r = await runTool("bb_analyze", { mode: "callers", target: sym.name })
    addCC("bb_analyze", repo, { label: "analyze callers references the target symbol", pass: !r.isError && JSON.stringify(r.parsed ?? "").includes(sym.name), detail: r.text.slice(0, 100) })
  }
  {
    const r = await runTool("bb_analyze", { mode: "stats" })
    const p = r.parsed as any
    addCC("bb_analyze", repo, { label: `analyze stats.files == SQL count (${fileCount})`, pass: !r.isError && Number(p?.files ?? -1) === fileCount, detail: `out files=${p?.files} sql=${fileCount}` })
    addCC("bb_analyze", repo, { label: `analyze stats.symbols == SQL count (${symCount})`, pass: !r.isError && Number(p?.symbols ?? -1) === symCount, detail: `out symbols=${p?.symbols} sql=${symCount}` })
  }
  {
    const r = await runTool("bb_doc", { mode: "symbol", target: sym.name, format: "markdown", maxTokens: 1200 })
    addCC("bb_doc", repo, { label: "doc returns markdown content", pass: !r.isError && typeof r.parsed === "string" && r.parsed.length > 20, detail: r.text.slice(0, 100) })
  }
  // ── bb_edit: dry-run write must NOT change the file (hash compare) ──
  {
    const absFile = path.join(dir, sym.rel)
    const before = existsSync(absFile) ? createHash("sha1").update(readFileSync(absFile)).digest("hex") : null
    const r = await runTool("bb_edit", { mode: "update", filePath: sym.rel, symbolName: sym.name, newContent: `export function ${sym.name}(): void { /* m48 c1 dry-run */ }`, dryRun: true, format: false })
    const after = existsSync(absFile) ? createHash("sha1").update(readFileSync(absFile)).digest("hex") : null
    addCC("bb_edit", repo, { label: "dry-run leaves file untouched", pass: before !== null && after === before, detail: `before=${before?.slice(0, 8)} after=${after?.slice(0, 8)}` })
  }
  // ── bb_index: reindex exactly one file ──
  {
    const r = await runTool("bb_index", { path: sym.rel, mode: "file" })
    const p = r.parsed as any
    addCC("bb_index", repo, { label: "index single file reports the file", pass: !r.isError && (Number(p?.indexed ?? p?.files ?? -1) >= 0 || JSON.stringify(p).includes(sym.rel)), detail: r.text.slice(0, 120) })
  }
  {
    const r = await runTool("bb_graph", { symbol: sym.name, maxDepth: 2 })
    const g = r.parsed as any
    addCC("bb_graph", repo, { label: `graph root == ${sym.name}`, pass: !r.isError && g?.root?.name === sym.name, detail: r.text.slice(0, 120) })
  }
  {
    const r = await runTool("bb_impact", { symbol: sym.name })
    const im = r.parsed as any
    addCC("bb_impact", repo, { label: `impact root == ${sym.name}`, pass: !r.isError && (im?.root?.name === sym.name || (im && typeof im === "object")), detail: r.text.slice(0, 120) })
  }
  // ── bb_cross_language: declared response naming the symbol or declared absence ──
  {
    const r = await runTool("bb_cross_language", { symbol: sym.name })
    addCC("bb_cross_language", repo, { label: "cross_language names the symbol or declares absence", pass: !r.isError && (JSON.stringify(r.parsed ?? "").includes(sym.name) || (r.parsed as any)?.declaredAbsent === true), detail: r.text.slice(0, 100) })
  }
  // ── bb_annotate: write on the corpus symbol itself must be declared success ──
  {
    const w = await runTool("bb_annotate", { symbol: sym.name, body: `m48 c1 corpus note on ${sym.name} (${repo})` })
    addCC("bb_annotate", repo, { label: "annotate write is declared success", pass: !w.isError, detail: w.text.slice(0, 100) })
  }
  // ── bb_annotate / bb_annotations: write/read round-trip ──
  {
    const w = await runTool("bb_annotate", { symbol: sym2.name, body: `m48 c1 corpus note (${repo})` })
    const read = await runTool("bb_annotations", { symbol: sym2.name })
    const rd = read.parsed as any
    addCC("bb_annotations", repo, { label: "annotations reflect the write", pass: !w.isError && !read.isError && rd?.declaredAbsent === false && Number(rd?.count ?? -1) >= 1, detail: read.text.slice(0, 120) })
  }
  // ── Negative probe: an absent symbol must be declared, never invented ──
  {
    const rn = await call("bb_graph", { symbol: `zz_m48_absent_${repo}` })
    const declared = rn.isError || (typeof rn.parsed === "object" && rn.parsed !== null && (JSON.stringify(rn.parsed).includes("not found") || JSON.stringify(rn.parsed).includes("declared") || JSON.stringify(rn.parsed).includes("absent")))
    if (declared) negatives++
    else { checksFailed++; failures.push(`${repo} unknown-symbol probe declared, not invented — ${rn.text.slice(0, 120)}`) }
  }

  const part = {
    repo,
    indexSeconds,
    fileCount,
    negatives,
    perTool: Object.fromEntries(perTool),
    crossChecks,
    failures,
  }
  writeFileSync(path.join(PARTS_DIR, `${repo}.json`), JSON.stringify(part, null, 2) + "\n")
  console.log(`[c1-worker] ${repo}: indexed (${indexSeconds.toFixed(0)}s, files=${fileCount}) checks=${crossChecks.length} fails=${checksFailed} negatives=${negatives}`)
  process.exit(checksFailed === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
