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
import { optionalCorpusMissingMessage, resolveOptionalCorpus } from "../lib/optional-corpus.ts"

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
  // The three giants were literal paths on the owner's other laptop. None of them exists
  // here, and this gate reported 0/16 with no explanation — it walked paths that were
  // never there. Now resolved through script/lib/optional-corpus.ts (env override first,
  // then the known locations), so a machine that HAS a clone uses it and a machine that
  // does not says so.
  const giants = [
    { tag: "aspnetcore", path: resolveOptionalCorpus("aspnetcore", "BB_ASPNET_REPO") },
    { tag: "paperclip", path: resolveOptionalCorpus("paperclip", "BB_PAPERCLIP_REPO") },
    { tag: "intellij-community", path: resolveOptionalCorpus("intellij-community", "BB_GIANT_REPO") },
  ]

  for (const a of anchors) {
    ck("S1: anchor corpus " + a.tag + " reachable", existsSync(a.path), a.path)
  }
  for (const g of giants) {
    // A DECLARED BLOCK, not a bare FAIL: "this clone is not on this machine" and "the
    // clone is here and the measurement failed" must not read the same.
    ck(
      "S1: giant corpus " + g.tag + " reachable",
      g.path !== null,
      g.path ?? optionalCorpusMissingMessage(g.tag, g.tag === "aspnetcore" ? "BB_ASPNET_REPO" : g.tag === "paperclip" ? "BB_PAPERCLIP_REPO" : "BB_GIANT_REPO"),
    )
  }

  // The checks above RECORD a missing corpus and do not stop; the loop after this walks
  // every path. Same shape as the m15 `winner` defect and the m19 giant gates fixed
  // earlier today: a non-aborting guard followed by unguarded use. Filter first.
  const present = anchors.filter((a) => existsSync(a.path)).concat(
    giants.filter((g): g is { tag: string; path: string } => g.path !== null).map((g) => ({ tag: g.tag, path: g.path })),
  )
  const absent = giants.filter((g) => g.path === null).map((g) => g.tag)
  if (absent.length > 0) {
    console.log("  S1: not measured on this machine (declared, not failed): " + absent.join(", "))
  }

  const fileCounts: any[] = []
  for (const c of present) {
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