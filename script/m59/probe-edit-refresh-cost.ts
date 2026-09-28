// script/m59/probe-edit-refresh-cost.ts — M59.A11
//
// Real-repo measurement of the stale-file path in bb_edit. Fixture probes show
// the behaviour; this shows the COST and that it lands on code nobody wrote for
// the test.
//
//  1. index a real corpus slice (typescript repo)
//  2. append a real comment to one file that declares an exported symbol
//     (the exact "another tool touched this file" state)
//  3. call bb_edit through the wire-faithful path (validate → handler), dryRun
//  4. record: did it answer, in how long, and did it refresh only that file

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS = "$HOME/fixtures/repositories"
const DATA_ROOT = mkdtempSync(path.join(tmpdir(), "m59-editcost-data-"))
process.env.BB_DATA_DIR = DATA_ROOT

const REPO = path.join(CORPUS, "graphql-js")
const CAP = Number(process.argv.find((a) => a.startsWith("--files="))?.split("=")[1] ?? 150)

function pick(ext: string, cap: number): string[] {
  const out: string[] = []
  const stack = [REPO]
  while (stack.length && out.length < cap) {
    const dir = stack.pop()!
    for (const e of [...readdirSync(dir)].sort()) {
      if (["node_modules", ".git", "dist", "build"].includes(e)) continue
      const p = path.join(dir, e)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) stack.push(p)
      else if (p.endsWith(ext) ) out.push(p)
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

  const handlers: any = createToolHandlers()
  const descriptors = new Map<string, any>((PUBLIC_TOOL_DESCRIPTORS as any[]).map((d) => [d.name, d]))
  const call = async (name: string, args: any, ctx: any) => {
    const d = descriptors.get(name)
    try {
      const v = validateToolArguments(d, args)
      const r: any = await handlers[name](v, ctx)
      const text = (Array.isArray(r?.content) ? r.content : []).map((b: any) => String(b?.text ?? "")).join("\n")
      return { text, isError: r?.isError === true }
    } catch (e: any) {
      return { text: `error: ${e?.message}`, isError: true }
    }
  }

  // A slice is copied into its own project so appending a comment cannot touch
  // the pristine corpus.
  const proj = mkdtempSync(path.join(tmpdir(), "m59-editcost-"))
  mkdirSync(path.join(proj, "src"), { recursive: true })
  const files = pick(".ts", CAP)
  for (const f of files) writeFileSync(path.join(proj, "src", path.basename(f)), readFileSync(f, "utf8"))
  writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "slice", version: "1.0.0" }))

  const pid = getProjectId(proj) as any
  const t0 = Date.now()
  await indexProjectParallel(pid, proj, {})
  const indexMs = Date.now() - t0
  const ctx = { projectId: pid, projectPath: proj }

  // Pick a file with an exported function/class, and the symbol name from its text.
  const target = (() => {
    for (const f of readdirSync(path.join(proj, "src"))) {
      const p = path.join(proj, "src", f)
      const text = readFileSync(p, "utf8")
      const m = text.match(/export (?:function|class|const) ([A-Za-z_$][\w$]*)/)
      if (m) return { rel: `src/${f}`, name: m[1] }
    }
    return null
  })()
  if (!target) throw new Error("no exported symbol found in the slice")

  // Fresh read: the edit should work with no refresh at all.
  const fresh = await call("bb_edit", { mode: "update", symbolName: target.name, filePath: target.rel, newContent: "// dry-run probe\n", dryRun: true }, ctx)

  // Now the agent-real state: the file changed after indexing.
  appendFileSync(path.join(proj, target.rel), "\n// touched by another tool\n")
  const t1 = Date.now()
  const stale = await call("bb_edit", { mode: "update", symbolName: target.name, filePath: target.rel, newContent: "// dry-run probe\n", dryRun: true }, ctx)
  const staleMs = Date.now() - t1

  // And on a file that did NOT change, the refresh must not run.
  const other = readdirSync(path.join(proj, "src")).find((f) => `src/${f}` !== target.rel && /export (?:function|class|const) /.test(readFileSync(path.join(proj, "src", f), "utf8")))
  const otherName = other ? (readFileSync(path.join(proj, "src", other), "utf8").match(/export (?:function|class|const) ([A-Za-z_$][\w$]*)/)?.[1] ?? null) : null
  const t2 = Date.now()
  const untouched = otherName ? await call("bb_edit", { mode: "update", symbolName: otherName, filePath: `src/${other}`, newContent: "// dry-run probe\n", dryRun: true }, ctx) : null
  const untouchedMs = Date.now() - t2

  const out = {
    probe: "M59.A11 — bb_edit stale-file refresh, real repo slice",
    at: new Date().toISOString(),
    repo: REPO,
    sliceFiles: files.length,
    indexMs,
    target: target.rel,
    symbol: target.name,
    freshRead: { isError: fresh.isError, ms: null as number | null, head: fresh.text.replace(/\s+/g, " ").slice(0, 110) },
    afterExternalChange: { isError: stale.isError, ms: staleMs, head: stale.text.replace(/\s+/g, " ").slice(0, 160) },
    refreshTriggered: /refreshed stale index rows/.test(stale.text),
    untouchedFile: { symbol: otherName, isError: untouched?.isError ?? null, ms: untouchedMs, refreshTriggered: /refreshed stale index rows/.test(untouched?.text ?? "") },
    noSourceWrite: readFileSync(path.join(proj, target.rel), "utf8").endsWith("// touched by another tool\n"),
  }
  const OUT = path.join(ROOT, "validation/m59/results/probe-edit-refresh-cost.json")
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
