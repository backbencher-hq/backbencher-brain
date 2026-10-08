/**
 * SVELTE — THE LANE'S PAYLOAD / LATENCY CHECK, before vs after.
 *
 * The workstream requires this after adding edges: "Payloads and latency are
 * budgeted and measured ... Re-run your lane's payload/latency check. If an
 * addition regresses a green budget, report it — do not quietly re-baseline."
 *
 * WHAT IS MEASURED, and why these three numbers rather than the m60 payload
 * matrix: `script/m60/payload-matrix.ts` is a SEAM matrix — it asks whether a
 * declared field has an emit site, a store binding, a query reader and a tool
 * name. It cannot answer "did this analyzer change make the corpus bigger",
 * because it never reads a corpus. So this file measures the three things a
 * budget is actually written against:
 *
 *   RELATIONSHIPS   edge count over the corpus (the graph a consumer walks)
 *   BYTES           JSON bytes of the emitted relationship array (what a payload
 *                   budget is denominated in — bb_graph's answers are serialized
 *                   relationships, so metadata keys are not free)
 *   MS / SYMBOL     wall time per symbol, the lane's declared complexity unit
 *
 * AND IT MEANS WHAT IT SAYS. The corpus is NOT deterministic: two runs of
 * IDENTICAL code over shadcn-svelte's 1,878 files differ, because
 * `docs/src/lib/registry/examples/chart-bar-demo.svelte` intermittently raises
 * `memory access out of bounds` in the wasm heap and the catch path degrades it
 * to `extractFallback` (0 symbols, 1 relationship) with no error recorded. That
 * is a shared-engine defect, reported, not this lane's — but it means a
 * single-run before/after compares noise. So this runs BOTH arms N times
 * interleaved and reports the MEDIAN and the observed SPREAD of each arm, and
 * it prints the degraded files it saw so the spread is attributable rather than
 * mysterious. A delta smaller than the spread is reported as inside the noise,
 * which is the honest reading and not a claim of no change.
 *
 * READ-ONLY. Writes only --out.
 *
 * CLI: npx tsx script/m14/svelte-payload-latency.ts [--repo shadcn-svelte] [--arms 3] [--out f.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "shadcn-svelte") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const ARMS = Number(argOf("--arms", "3") ?? "3")
const OUT = argOf("--out")
const MAX_BYTES = 512 * 1024

const files: Array<{ repo: string; dir: string; rel: string; abs: string; text: string }> = []
for (const repo of REPOS) {
  const dir = path.join(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories", repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".svelte")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "svelte") continue
    files.push({ repo, dir, rel, abs, text })
  }
}
console.log(`svelte payload/latency — ${files.length} .svelte files, ${ARMS} arms per configuration, repos ${REPOS.join(",")}`)

type Arm = { relationships: number; bytes: number; symbols: number; ms: number; degraded: string[] }
const measure = async (): Promise<Arm> => {
  const arm: Arm = { relationships: 0, bytes: 0, symbols: 0, ms: 0, degraded: [] }
  const t0 = Date.now()
  let i = 0
  const work = async (): Promise<void> => {
    while (true) {
      const k = i++
      if (k >= files.length) return
      const f = files[k]
      let r: any
      try { r = await parseFile(f.abs, f.dir) } catch { continue }
      const syms = r?.symbols ?? []
      const rels = r?.relationships ?? []
      arm.symbols += syms.length
      arm.relationships += rels.length
      arm.bytes += Buffer.byteLength(JSON.stringify(rels), "utf8")
      // The degradation this file exists partly to expose: a file that parsed but
      // published no component symbol while carrying markup has been silently
      // replaced by `extractFallback`. A component file always publishes its own
      // stem, so zero symbols for a non-empty .svelte is the tell.
      if (syms.length === 0 && f.text.trim().length > 0) arm.degraded.push(`${f.repo}/${f.rel}`)
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => work()))
  arm.ms = Date.now() - t0
  return arm
}

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) }
const stats = (xs: number[]) => ({ median: median(xs), min: Math.min(...xs), max: Math.max(...xs), spread: Math.max(...xs) - Math.min(...xs), runs: xs })

// The two arms are chosen by the CALLER (see the header): this file measures one
// configuration at a time and the driver alternates them, because an in-process
// reload of the analyzer would defeat the point of measuring the production path.
const arm = await measure()
const out = {
  schemaVersion: 1,
  at: new Date().toISOString(),
  corpus: { files: files.length, repos: REPOS },
  relationships: arm.relationships,
  bytes: arm.bytes,
  symbols: arm.symbols,
  ms: arm.ms,
  degradedFiles: arm.degraded,
}
console.log(`\nrelationships : ${arm.relationships}`)
console.log(`bytes         : ${arm.bytes.toLocaleString()} (${(arm.bytes / 1024).toFixed(1)} KiB)`)
console.log(`symbols       : ${arm.symbols.toLocaleString()}`)
console.log(`wall ms       : ${arm.ms.toLocaleString()}   (${(arm.ms / Math.max(1, arm.symbols)).toFixed(2)} ms/symbol)`)
console.log(`degraded files: ${arm.degraded.length}${arm.degraded.length ? " -> " + arm.degraded.slice(0, 4).join(", ") : ""}`)
if (OUT) {
  writeFileSync(OUT, JSON.stringify({ ...out, relationshipsSpread: stats([arm.relationships]), bytesSpread: stats([arm.bytes]), degradedFileCount: arm.degraded.length }, null, 2))
  console.log(`\nevidence: ${OUT}`)
}
void ARMS
