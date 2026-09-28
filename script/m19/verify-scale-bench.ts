// script/m19/verify-scale-bench.ts - M19.S1 (scale benchmark).
// Measures the current indexing pipeline's honest baselines:
//   - anchor corpora from the M18 benchmark (rake, lodash, element-plus):
//     index wall-time, file count, symbol count
//   - giant corpora (aspnetcore, paperclip, intellij-community): file counts
//     here; indexing them is S2/S3
// The machine is recorded so the numbers stay comparable.
// CAN FAIL; no auto-pass.

import { writeFileSync, readFileSync, mkdirSync, existsSync, mkdtempSync, cpSync, rmSync } from "node:fs"
import { tmpdir, cpus, totalmem } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"

let checks = 0
let passed = 0
let failed = 0
function ck(label: string, cond: boolean, detail?: string) {
  checks++
  if (cond) passed++
  else { failed++; console.log("  FAIL: " + label + (detail ? " - " + detail : "")) }
}

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m19/results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

const MACHINE = {
  platform: process.platform,
  arch: process.arch,
  cpu: (cpus() || []).slice(0, 2).map((c) => c.model.trim()).join(" | "),
  ramGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
}

function countFiles(dir: string): number | null {
  try {
    const out = execFileSync("find", [dir, "-path", "*/.git", "-prune", "-o", "-type", "f", "-print"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    return out.split("\n").filter((l) => l.trim().length > 0).length
  } catch {
    return null
  }
}

async function indexCorpus(tag: string, source: string) {
  if (!existsSync(source)) return null
  const tmp = mkdtempSync(path.join(tmpdir(), "m19s1-"))
  try {
    cpSync(source, tmp, { recursive: true })
    const pid = getProjectId(tmp)
    process.env.BB_EMBEDDING_BATCH_LIMIT = "1"
    const t0 = Date.now()
    await indexProjectParallel(pid, tmp, {})
    const wallMs = Date.now() - t0
    delete process.env.BB_EMBEDDING_BATCH_LIMIT
    const raw = await BrainDatabase.getRawInstance(pid)
    const symbols = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(pid) as any).c
    const files = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(pid) as any).c
    return { repo: tag, files, symbols, ms: wallMs, seconds: wallMs / 1000 }
  } catch (e: any) {
    console.log("  (index failed for " + tag + ": " + (e?.message || e) + ")")
    return null
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function main() {
  console.log("-- S1  scale benchmark (measured, not assumed) --")
  console.log("    machine: " + MACHINE.platform + "/" + MACHINE.arch + " cpu=" + MACHINE.cpu + " ram=" + MACHINE.ramGb + "GB")

  const bench = JSON.parse(readFileSync(path.join(ROOT_DIR, "validation/m18/benchmark/benchmark.json"), "utf8"))
  const anchors = (bench.corpora || []).map((c: any) => ({ tag: c.tag, path: c.source }))
  const giants = [
    { tag: "aspnetcore", path: "$HOME/aspnetcore" },
    { tag: "paperclip", path: "$HOME/paperclip" },
    { tag: "intellij-community", path: "$HOME/intellij-community" },
  ]

  for (const a of anchors) ck("S1: anchor corpus " + a.tag + " reachable", existsSync(a.path), a.path)
  for (const g of giants) ck("S1: giant corpus " + g.tag + " reachable", existsSync(g.path), g.path)

  const fileCounts: any[] = []
  for (const c of anchors.concat(giants)) {
    const n = countFiles(c.path)
    fileCounts.push({ tag: c.tag, kind: c.tag === "rake" || c.tag === "lodash" || c.tag === "element-plus" ? "anchor" : "giant", files: n, path: c.path })
    ck("S1: " + c.tag + " file count measured and non-empty", n !== null && n > 0, "files=" + n)
  }

  const indexed: any[] = []
  for (const a of anchors) {
    const r = await indexCorpus(a.tag, a.path)
    if (r) {
      indexed.push(r)
      ck("S1: indexed " + a.tag + " with measured rows", r.files > 0 && r.symbols > 0, JSON.stringify(r))
    } else {
      ck("S1: " + a.tag + " index produced a result", false)
    }
  }

  ck("S1: at least one anchor indexed with a measured time", indexed.length >= 1, "indexed=" + indexed.length)

  const firstMeasured = indexed[0] ?? { repo: "anchor-corpora", files: 0, symbols: 0, ms: 0 }
  const measured = {
    repo: firstMeasured.repo,
    files: firstMeasured.files,
    symbols: firstMeasured.symbols,
    ms: firstMeasured.ms,
    machine: MACHINE,
    fileCounts,
    indexedAnchors: indexed,
    curve: indexed.map((r) => ({ repo: r.repo, files: r.files, symbols: r.symbols, ms: r.ms })),
  }

  const e = {
    issue: "M19.S1", code: "S1", tool: "indexing pipeline (scale baseline)",
    title: "scale benchmark - measured baselines at anchor + giant corpora",
    verified: failed === 0, checks, passed, failed,
    measured,
    negatives: [
      "Wall-time is hardware-bound (machine recorded); not portable.",
      "Giant file counts are DISCOVERY here - indexing them is S2/S3.",
      "Element-plus is the largest INDEXED anchor; intellij is not indexed in this verifier.",
    ],
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(path.join(RESULTS_DIR, "S1.json"), JSON.stringify(e, null, 2) + "\n")
  console.log("S1: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed)")
  process.exit(failed === 0 ? 0 : 1)
}

await main()